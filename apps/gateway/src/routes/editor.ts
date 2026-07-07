import type { FastifyInstance } from 'fastify'
import { requireRole } from '../plugins/rbac.js'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { writeFile, rm } from 'node:fs/promises'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { encryptJson, decryptJson } from '../utils/crypto.js'
import { ProviderFactory } from '@anway/agent'
import type { IModelProvider } from '@anway/agent'
import { providerConfigForTenant, resolveProviderConfig } from './chat.js'
import { appendAuditEvent } from './audit.js'

// Restrict file access to these root directories
const ALLOWED_ROOTS: string[] = [
  process.env['EDITOR_ROOT'] ?? path.resolve(process.cwd(), '../..'),
  '/tmp/anway-editor',
]

function isAllowedPath(target: string): boolean {
  const resolved = path.resolve(target)
  return ALLOWED_ROOTS.some((root) => {
    const r = path.resolve(root)
    return resolved === r || resolved.startsWith(r + path.sep)
  })
}

// Walks up from a file path looking for a `.git` directory, never leaving
// the editor's own allowed roots (so a crafted path can't walk out to some
// unrelated repo on the host).
function findGitRoot(startPath: string): string | null {
  let dir = existsSync(startPath) && statSync(startPath).isDirectory() ? startPath : path.dirname(startPath)
  for (let i = 0; i < 50; i++) {
    if (!isAllowedPath(dir)) return null
    if (existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

function gitExec(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, env: { ...process.env } })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    proc.on('error', reject)
  })
}

function detectLanguage(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.sh': 'bash', '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json', '.toml': 'toml',
    '.tf': 'hcl', '.md': 'markdown',
  }
  return map[ext] ?? 'plaintext'
}

// Confirmed live via product verification: this used to hand-roll direct
// @anthropic-ai/sdk / openai SDK calls gated on raw ANTHROPIC_API_KEY /
// OPENAI_API_KEY env vars only — completely bypassing this tenant's actual
// configured provider (provider_config table, same one chat.ts resolves).
// In this exact dev environment neither of those two env vars is set (the
// tenant is configured for DeepSeek via provider_config), so analyze/
// run-tests silently never had a real model — analyze degraded to
// static-only and run-tests errored outright. CLAUDE.md's model-agnostic
// mandate ("Orchestrator and agents call IModelProvider — never a provider
// SDK directly") applies here exactly like everywhere else in the app.
async function resolveEditorModel(tenantId: string): Promise<IModelProvider | null> {
  const dbConfig = await providerConfigForTenant(tenantId, prisma)
  const config = dbConfig ?? resolveProviderConfig()
  if (!config) return null
  return ProviderFactory.create(config)
}

async function callEditorLlm(model: IModelProvider, prompt: string, systemPrompt?: string): Promise<string> {
  const messages = systemPrompt
    ? [{ role: 'system' as const, content: systemPrompt }, { role: 'user' as const, content: prompt }]
    : [{ role: 'user' as const, content: prompt }]
  const resp = await model.chat(messages, [], { model: model.modelId, maxTokens: 2048, temperature: 0.2 })
  return resp.content
}

interface FileEntry {
  name: string
  path: string
  isDir: boolean
  depth: number
}

async function buildFileTree(rootPath: string, depth = 0, maxDepth = 3): Promise<FileEntry[]> {
  if (depth > maxDepth) return []

  const entries = await readdir(rootPath, { withFileTypes: true })
  const result: FileEntry[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

    const fullPath = path.join(rootPath, entry.name)
    result.push({
      name: entry.name,
      path: fullPath,
      isDir: entry.isDirectory(),
      depth,
    })

    if (entry.isDirectory() && depth < maxDepth) {
      const children = await buildFileTree(fullPath, depth + 1, maxDepth)
      result.push(...children)
    }
  }

  return result
}

export async function editorRoutes(app: FastifyInstance) {
  // GET /api/editor/files?path=<dir> — list directory tree
  app.get<{ Querystring: { path?: string } }>(
    '/api/editor/files',
    { preHandler: [app.authenticate, requireRole('admin', 'dev')] },
    async (request, reply) => {
      const reqPath = request.query.path

      if (!reqPath) {
        return reply.code(400).send({ error: 'path required' })
      }

      if (!isAllowedPath(reqPath) || !existsSync(reqPath)) {
        return reply.code(403).send({ error: 'path not allowed or not found' })
      }

      const s = await stat(reqPath)
      if (!s.isDirectory()) {
        return reply.code(400).send({ error: 'path must be a directory' })
      }

      const tree = await buildFileTree(reqPath)
      return reply.send(tree)
    },
  )

  // GET /api/editor/file?path=<file> — read file content
  app.get<{ Querystring: { path?: string } }>(
    '/api/editor/file',
    { preHandler: [app.authenticate, requireRole('admin', 'dev')] },
    async (request, reply) => {
      const reqPath = request.query.path

      if (!reqPath) {
        return reply.code(400).send({ error: 'path required' })
      }

      if (!isAllowedPath(reqPath) || !existsSync(reqPath)) {
        return reply.code(403).send({ error: 'path not allowed or not found' })
      }

      const s = await stat(reqPath)
      if (!s.isFile()) {
        return reply.code(400).send({ error: 'path must be a file' })
      }

      const content = await readFile(reqPath, 'utf-8')
      const filename = path.basename(reqPath)

      return reply.send({
        content,
        filename,
        path: reqPath,
        language: detectLanguage(filename),
        size: s.size,
      })
    },
  )

  // POST /api/editor/file — save edited content back to disk.
  // Previously did not exist at all: the editor could read files, run LLM
  // analysis and generated tests against an in-browser edit buffer, but had
  // no way to ever persist an edit — confirmed live via product
  // verification. Same ALLOWED_ROOTS containment as the read routes above;
  // real-file-write is audited (a real write action to the local
  // filesystem, distinct from the git commit/push write below).
  const MAX_SAVE_BYTES = 2 * 1024 * 1024 // 2MB — generous for source files, guards against accidental huge payloads
  app.post<{ Body: { path: string; content: string } }>(
    '/api/editor/file',
    { preHandler: [app.authenticate, requireRole('admin', 'dev')] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { path: reqPath, content } = request.body

      if (!reqPath || content === undefined) {
        return reply.code(400).send({ error: 'path and content required' })
      }
      if (Buffer.byteLength(content, 'utf-8') > MAX_SAVE_BYTES) {
        return reply.code(413).send({ error: `content exceeds ${MAX_SAVE_BYTES} byte limit` })
      }
      if (!isAllowedPath(reqPath)) {
        return reply.code(403).send({ error: 'path not allowed' })
      }
      // Existing target must be a real file (never silently create through a
      // directory path or overwrite something that isn't a plain file).
      if (existsSync(reqPath)) {
        const s = await stat(reqPath)
        if (!s.isFile()) return reply.code(400).send({ error: 'path must be a file' })
      } else if (!existsSync(path.dirname(reqPath))) {
        return reply.code(400).send({ error: 'parent directory does not exist' })
      }

      await writeFile(reqPath, content, 'utf-8')

      await appendAuditEvent({
        tenantId,
        userId,
        action: 'editor.file_saved',
        resource: reqPath,
        outcome: 'action_executed',
        metadata: { bytes: Buffer.byteLength(content, 'utf-8') },
      }).catch(() => {})

      return reply.send({ ok: true, path: reqPath, bytes: Buffer.byteLength(content, 'utf-8') })
    },
  )

  // POST /api/editor/clone — clone a real git repo (using the user's stored
  // credentials) into a scratch workspace so the editor can point at a repo
  // that isn't already checked out on disk, not just the fixed ALLOWED_ROOTS
  // default. Clones under /tmp/anway-editor/<sanitized>, which is itself one
  // of the two ALLOWED_ROOTS, so every subsequent read/save/commit call
  // against the cloned path passes the same containment check as everything
  // else in this file.
  const CLONE_ROOT = '/tmp/anway-editor'
  app.post<{ Body: { repoUrl: string; provider: string; branch?: string } }>(
    '/api/editor/clone',
    { preHandler: [app.authenticate, requireRole('admin', 'dev')] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { repoUrl, provider, branch } = request.body
      if (!repoUrl || !provider) return reply.code(400).send({ error: 'repoUrl and provider required' })

      let parsed: URL
      try {
        parsed = new URL(repoUrl)
      } catch {
        return reply.code(400).send({ error: 'repoUrl must be a valid URL' })
      }
      if (parsed.protocol !== 'https:') {
        return reply.code(400).send({ error: 'only https:// repo URLs are supported (credentials are injected as an HTTPS auth header)' })
      }

      const credRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ token_enc: string }>>`
          SELECT token_enc FROM user_git_credentials
          WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND provider = ${provider} LIMIT 1
        `
      ).catch(() => [])
      if (credRows.length === 0) return reply.code(400).send({ error: `no stored git credentials for provider ${provider}` })
      const token = decryptJson<string>(credRows[0]!.token_enc)

      // Deterministic, collision-resistant local dir name from host+path — no
      // user-controlled path traversal (URL.pathname is used, not raw input).
      const safeName = `${parsed.hostname}${parsed.pathname}`.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '')
      const localPath = path.join(CLONE_ROOT, safeName)

      if (existsSync(localPath)) {
        return reply.code(409).send({ error: 'already cloned', path: localPath })
      }
      await import('node:fs/promises').then(m => m.mkdir(CLONE_ROOT, { recursive: true }))

      const authHeader = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
      const cloneArgs = ['-c', `http.extraHeader=${authHeader}`, 'clone', '--depth', '1', ...(branch ? ['--branch', branch] : []), repoUrl, localPath]
      const result = await gitExec(cloneArgs, CLONE_ROOT)

      if (result.code !== 0) {
        return reply.code(500).send({ error: 'git clone failed', detail: result.stderr.slice(0, 2000) })
      }

      await appendAuditEvent({
        tenantId, userId,
        action: 'editor.repo_cloned',
        resource: repoUrl,
        outcome: 'action_executed',
        metadata: { localPath, branch: branch ?? null },
      }).catch(() => {})

      return reply.code(201).send({ ok: true, path: localPath })
    },
  )

  // POST /api/editor/build — real `docker build` (+ push if DOCKER_REGISTRY
  // is configured) for an arbitrary edited service, streamed as SSE.
  // Previously did not exist: pipeline.ts's own build stage is hardcoded to
  // this platform's own two images (apps/gateway, apps/web) — confirmed
  // live via product verification it isn't reusable for a user's own
  // service. Ungated (matches the established precedent in pipeline.ts:
  // build itself has no external effect beyond the tenant's own registry;
  // only the deploy step that follows is gated).
  app.post<{ Body: { servicePath: string; imageName: string; tag?: string } }>(
    '/api/editor/build',
    { preHandler: [app.authenticate, requireRole('admin', 'dev')] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { servicePath, imageName, tag } = request.body

      if (!servicePath || !imageName) {
        return reply.code(400).send({ error: 'servicePath and imageName required' })
      }
      if (!isAllowedPath(servicePath) || !existsSync(servicePath)) {
        return reply.code(403).send({ error: 'servicePath not allowed or not found' })
      }
      const dockerfilePath = path.join(servicePath, 'Dockerfile')
      if (!existsSync(dockerfilePath)) {
        return reply.code(400).send({ error: `no Dockerfile found at ${dockerfilePath}` })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      const sse = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)

      const registry = process.env['DOCKER_REGISTRY']
      const resolvedTag = tag ?? Date.now().toString(36)
      const image = registry ? `${registry}/${imageName}:${resolvedTag}` : `${imageName}:${resolvedTag}`

      const runStep = (label: string, args: string[], cwd: string, timeoutMs: number): Promise<void> =>
        new Promise((resolve, reject) => {
          sse({ type: 'log', line: `→ ${label} ${args.join(' ')}` })
          const child = spawn(label, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
          child.stdout.on('data', (d: Buffer) => sse({ type: 'log', line: d.toString().trim() }))
          child.stderr.on('data', (d: Buffer) => sse({ type: 'log', line: d.toString().trim() }))
          const timer = setTimeout(() => { child.kill(); reject(new Error(`${label} timed out`)) }, timeoutMs)
          child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${label} exited ${code}`)) })
          child.on('error', (err) => { clearTimeout(timer); reject(err) })
        })

      try {
        sse({ type: 'status', message: `Building ${image}…` })
        await runStep('docker', ['build', servicePath, '-t', image], servicePath, 30 * 60_000)

        let pushed = false
        if (registry) {
          sse({ type: 'status', message: `Pushing ${image}…` })
          await runStep('docker', ['push', image], servicePath, 5 * 60_000)
          pushed = true
        } else {
          sse({ type: 'log', line: 'DOCKER_REGISTRY not configured — built locally, not pushed. Deploy will only work if the k8s nodes can pull this image from the local docker daemon.' })
        }

        await appendAuditEvent({
          tenantId, userId, action: 'editor.build', resource: image,
          outcome: 'action_executed', metadata: { servicePath, pushed },
        }).catch(() => {})

        sse({ type: 'done', image, pushed })
      } catch (err) {
        await appendAuditEvent({
          tenantId, userId, action: 'editor.build', resource: image,
          outcome: 'action_failed', metadata: { servicePath, error: String(err) },
        }).catch(() => {})
        sse({ type: 'error', message: String(err) })
        sse({ type: 'done', image, pushed: false })
      }

      reply.raw.end()
    },
  )

  // POST /api/editor/commit — real git add+commit+push using the user's
  // stored git credentials. Previously did not exist at all despite the
  // editor collecting git tokens for exactly this purpose — confirmed live
  // via product verification that nothing anywhere in the gateway ever read
  // user_git_credentials except the routes that store/list/delete it.
  //
  // Gated the same way as terraform.ts's real apply route (atomic
  // gate_events consume with separation-of-duties: the approver cannot be
  // the same person requesting the push) — a real push to a real remote is
  // exactly the class of write action CLAUDE.md's V1 Trust Principle
  // requires gated, and this codebase's established pattern for that is the
  // gate_events atomic-consume flow, not a bespoke one-off.
  app.post<{ Body: { path: string; message: string; provider: string; gateId: string } }>(
    '/api/editor/commit',
    {
      preHandler: [app.authenticate, requireRole('admin', 'dev')],
      schema: {
        body: {
          type: 'object',
          required: ['path', 'message', 'provider', 'gateId'],
          properties: {
            path: { type: 'string' },
            message: { type: 'string', minLength: 1, maxLength: 500 },
            provider: { type: 'string' },
            gateId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { path: filePath, message, provider, gateId } = request.body

      if (!isAllowedPath(filePath) || !existsSync(filePath)) {
        return reply.code(403).send({ error: 'path not allowed or not found' })
      }

      const sentinel = '00000000-0000-0000-0000-000000000000'
      const consumed = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE gate_events
          SET status = 'consumed', decided_at = COALESCE(decided_at, NOW())
          WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid
            AND status = 'approved'
            AND created_at > NOW() - INTERVAL '24 hours'
            AND tool_args->>'target' = ${filePath}
            AND decided_by IS NOT NULL
            AND decided_by <> ${sentinel}::uuid
            AND decided_by <> ${userId}::uuid
        `
      ).catch(() => 0)
      if (Number(consumed) === 0) {
        return reply.code(403).send({ error: 'gate approval required before commit' })
      }

      const repoRoot = findGitRoot(filePath)
      if (!repoRoot) return reply.code(400).send({ error: 'path is not inside a git repository' })

      const credRows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<Array<{ token_enc: string; username: string | null; email: string | null }>>`
          SELECT token_enc, username, email FROM user_git_credentials
          WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND provider = ${provider} LIMIT 1
        `
      ).catch(() => [])
      if (credRows.length === 0) return reply.code(400).send({ error: `no stored git credentials for provider ${provider}` })
      const token = decryptJson<string>(credRows[0]!.token_enc)
      const gitUsername = credRows[0]!.username ?? 'anway-editor'
      const gitEmail = credRows[0]!.email ?? 'editor@anway.local'

      const relPath = path.relative(repoRoot, filePath)

      const addResult = await gitExec(['add', relPath], repoRoot)
      if (addResult.code !== 0) {
        return reply.code(500).send({ error: 'git add failed', detail: addResult.stderr.slice(0, 2000) })
      }

      const commitResult = await gitExec(
        ['-c', `user.name=${gitUsername}`, '-c', `user.email=${gitEmail}`, 'commit', '-m', message],
        repoRoot,
      )
      if (commitResult.code !== 0) {
        await appendAuditEvent({
          tenantId, userId, action: 'editor.commit', resource: relPath, outcome: 'action_failed',
          metadata: { message, error: commitResult.stderr.slice(0, 1000) },
        }).catch(() => {})
        return reply.code(500).send({ error: 'git commit failed', detail: commitResult.stderr.slice(0, 2000) })
      }

      const shaResult = await gitExec(['rev-parse', 'HEAD'], repoRoot)
      const sha = shaResult.stdout.trim()

      const branchResult = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)
      const branch = branchResult.stdout.trim() || 'HEAD'

      // http.extraHeader is scoped to this single invocation via -c — never
      // written to the repo's on-disk config, never appears in `git remote
      // -v`, never embedded in the remote URL.
      const authHeader = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
      const pushResult = await gitExec(['-c', `http.extraHeader=${authHeader}`, 'push', 'origin', branch], repoRoot)

      await appendAuditEvent({
        tenantId, userId,
        action: 'editor.commit',
        resource: relPath,
        outcome: pushResult.code === 0 ? 'action_executed' : 'action_failed',
        metadata: {
          sha, branch, message, pushed: pushResult.code === 0,
          ...(pushResult.code === 0 ? {} : { pushError: pushResult.stderr.slice(0, 1000) }),
        },
      }).catch(() => {})

      if (pushResult.code !== 0) {
        return reply.code(500).send({ ok: false, sha, committed: true, pushed: false, error: 'git push failed', detail: pushResult.stderr.slice(0, 2000) })
      }

      return reply.send({ ok: true, sha, branch, committed: true, pushed: true })
    },
  )

  // POST /api/editor/analyze — LLM analysis, returns SSE stream of findings + test plan
  app.post<{ Body: { content: string; filename: string; language?: string } }>(
    '/api/editor/analyze',
    { preHandler: [app.authenticate, requireRole('admin', 'dev')] },
    async (request, reply) => {
      const { content, filename, language } = request.body
      const { tenantId } = request.user as { tenantId: string }

      if (!content || !filename) {
        return reply.code(400).send({ error: 'content and filename required' })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const sse = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)

      sse({ type: 'status', message: 'Reading file structure…' })

      const model = await resolveEditorModel(tenantId)

      if (!model) {
        // No LLM configured — return structural findings from static analysis only
        sse({ type: 'status', message: 'No LLM configured — running static analysis…' })
        const findings = await staticAnalyze(content, filename)
        sse({ type: 'findings', findings })
        sse({ type: 'testPlan', testPlan: generateStaticTestPlan(findings) })
        sse({ type: 'done' })
        reply.raw.end()
        return
      }

      sse({ type: 'status', message: 'Analyzing code with AI…' })

      const systemPrompt = `You are a senior software engineer performing a code review. Analyze the provided code and return ONLY valid JSON with this exact structure:
{
  "findings": [
    {
      "line": <number — line number where the issue is>,
      "severity": "<error|warn|info>",
      "title": "<short title, max 6 words>",
      "body": "<detailed explanation, 1-3 sentences>",
      "test": "<specific test case description that would catch this bug>"
    }
  ],
  "testPlan": [
    {
      "id": "TC-001",
      "label": "<test description>",
      "generated": <true if this test was specifically generated to catch a found bug>
    }
  ],
  "confidence": <0.0-1.0 — your confidence in the analysis>,
  "summary": "<1 sentence summary of the main issues>"
}

Focus on: security vulnerabilities, race conditions, missing validation, error handling gaps, reliability issues. Generate test cases that would catch each bug.`

      try {
        sse({ type: 'status', message: 'Checking security issues…' })

        const response = await callEditorLlm(
          model,
          `Review this ${language ?? ''} file "${filename}":\n\n\`\`\`\n${content}\n\`\`\``,
          systemPrompt,
        )

        sse({ type: 'status', message: 'Generating test cases…' })

        // Extract JSON from response (LLM may wrap in ```json ... ```)
        const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, response]
        const jsonStr = (jsonMatch[1] ?? response).trim()

        let parsed: { findings: object[]; testPlan: object[]; confidence: number; summary: string }
        try {
          parsed = JSON.parse(jsonStr)
        } catch {
          // Fallback if JSON parse fails
          sse({ type: 'findings', findings: [] })
          sse({ type: 'testPlan', testPlan: [] })
          sse({ type: 'error', message: 'Could not parse LLM response as JSON' })
          sse({ type: 'done' })
          reply.raw.end()
          return
        }

        sse({ type: 'findings', findings: parsed.findings ?? [] })
        sse({ type: 'testPlan', testPlan: parsed.testPlan ?? [] })
        sse({ type: 'confidence', confidence: parsed.confidence ?? 0.5 })
        sse({ type: 'summary', summary: parsed.summary ?? '' })
        sse({ type: 'done' })
      } catch (err) {
        sse({ type: 'error', message: String(err) })
        sse({ type: 'done' })
      }

      reply.raw.end()
    },
  )

  // GET /api/editor/services — list Service entities from the knowledge graph for the service picker
  app.get('/api/editor/services', { preHandler: [app.authenticate, requireRole('admin', 'dev', 'sre')] }, async (request) => {
    const { tenantId } = request.user as { tenantId: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ id: string; name: string; metadata: Record<string, unknown>; updated_at: string }>>`
        SELECT id, name, metadata, updated_at FROM entities
        WHERE tenant_id = ${tenantId}::uuid AND type = 'Service'
        ORDER BY name ASC LIMIT 200
      `
    ).catch(() => [])
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      namespace: (r.metadata?.['namespace'] as string | undefined) ?? null,
      connectorCoordinates: (r.metadata?.['connectorCoordinates'] as Record<string, unknown> | undefined) ?? {},
      updatedAt: r.updated_at,
    }))
  })

  // GET /api/user/git-credentials — return configured providers (no token values)
  app.get('/api/user/git-credentials', { preHandler: [app.authenticate] }, async (request) => {
    const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
    const rows = await withTenant(prisma, tenantId, (tx) =>
      tx.$queryRaw<Array<{ provider: string; username: string | null; email: string | null; updated_at: string }>>`
        SELECT provider, username, email, updated_at FROM user_git_credentials
        WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid
        ORDER BY provider ASC
      `
    ).catch(() => [])
    return rows.map(r => ({ provider: r.provider, username: r.username, email: r.email, updatedAt: r.updated_at, configured: true }))
  })

  // PUT /api/user/git-credentials — store encrypted git token
  app.put<{ Body: { provider: string; token: string; username?: string; email?: string } }>(
    '/api/user/git-credentials',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { provider, token, username, email } = request.body
      if (!provider || !token) return reply.code(400).send({ error: 'provider and token required' })
      const VALID_PROVIDERS = new Set(['github', 'gitlab', 'bitbucket'])
      if (!VALID_PROVIDERS.has(provider)) return reply.code(400).send({ error: `provider must be one of: ${[...VALID_PROVIDERS].join(', ')}` })
      const tokenEnc = encryptJson(token)
      await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          INSERT INTO user_git_credentials (id, tenant_id, user_id, provider, username, email, token_enc, created_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantId}::uuid, ${userId}::uuid, ${provider}, ${username ?? null}, ${email ?? null}, ${tokenEnc}, now(), now())
          ON CONFLICT ON CONSTRAINT uq_user_git_cred
          DO UPDATE SET token_enc = ${tokenEnc}, username = ${username ?? null}, email = ${email ?? null}, updated_at = now()
        `
      )
      return { ok: true }
    },
  )

  // DELETE /api/user/git-credentials/:provider — remove stored git token
  app.delete<{ Params: { provider: string } }>(
    '/api/user/git-credentials/:provider',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId, sub: userId } = request.user as { tenantId: string; sub: string }
      const { provider } = request.params
      const deleted = await withTenant(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          DELETE FROM user_git_credentials
          WHERE tenant_id = ${tenantId}::uuid AND user_id = ${userId}::uuid AND provider = ${provider}
        `
      ).catch(() => 0)
      if (Number(deleted) === 0) return reply.code(404).send({ error: 'not found' })
      return reply.code(204).send()
    },
  )

  // POST /api/editor/run-tests — generate test code via LLM and run it
  app.post<{ Body: { content: string; filename: string; findings: object[]; testPlan: object[] } }>(
    '/api/editor/run-tests',
    { preHandler: [app.authenticate, requireRole('admin', 'dev')] },
    async (request, reply) => {
      const { content, filename, findings, testPlan } = request.body
      const { tenantId } = request.user as { tenantId: string }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const sse = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)

      sse({ type: 'status', message: 'Generating test code…' })

      const model = await resolveEditorModel(tenantId)

      if (!model) {
        sse({ type: 'error', message: 'No LLM configured — cannot generate tests' })
        sse({ type: 'done' })
        reply.raw.end()
        return
      }

      let testCode = ''

      try {
        const findingsSummary = JSON.stringify(findings.slice(0, 10), null, 2)
        const planSummary = JSON.stringify(testPlan.slice(0, 10), null, 2)

        const response = await callEditorLlm(
          model,
          `Generate a self-contained Node.js test script (no external dependencies except built-in 'assert' and 'node:test' if available) to test this code.

The script MUST:
1. Use only Node.js built-in modules (assert, node:test, or manual assertions)
2. Test the business logic by importing/requiring the code inline (embed a simplified version if needed)
3. Print results in this exact format for each test:
   PASS: <test id> <description> (<ms>ms)
   FAIL: <test id> <description> (<ms>ms) — <reason>
4. Exit with code 0 if all pass, non-zero if any fail

Findings to test against:
${findingsSummary}

Test plan:
${planSummary}

Source file (${filename}):
\`\`\`
${content.slice(0, 3000)}
\`\`\`

Return ONLY the Node.js test script, no explanation, no markdown.`,
        )

        // Strip markdown code fences if present
        testCode = response.replace(/^```(?:javascript|js|node)?\n?/, '').replace(/\n?```$/, '').trim()

        sse({ type: 'status', message: 'Running tests…' })
        sse({ type: 'testCode', code: testCode })

        // Write test to temp file and execute. Confirmed live via product
        // verification: the prompt above asks for "built-in 'assert' and
        // 'node:test'", which real models overwhelmingly answer with
        // classic `require(...)` CommonJS, not `import` — but this wrote
        // the file as `.mjs` (forces ES module scope), so a real generated
        // response failed immediately with "require is not defined in ES
        // module scope" before a single test could run. `.cjs` forces
        // CommonJS regardless of what the model outputs, matching the
        // actual real-world output shape for this prompt.
        const tmpDir = await import('node:os').then(m => m.tmpdir())
        const tmpFile = path.join(tmpDir, `anway-test-${Date.now()}.cjs`)
        await writeFile(tmpFile, testCode, 'utf-8')

        await new Promise<void>((resolve) => {
          const proc = spawn(process.execPath, [tmpFile], {
            timeout: 30_000,
            env: { ...process.env, NODE_ENV: 'test' },
          })

          let output = ''

          proc.stdout.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            output += text

            // Parse pass/fail lines as they stream
            for (const line of text.split('\n')) {
              const trimmed = line.trim()
              if (!trimmed) continue

              if (trimmed.startsWith('PASS:')) {
                const match = trimmed.match(/^PASS:\s*(\S+)\s+(.*?)\s+\((\d+)ms\)/)
                sse({
                  type: 'testResult',
                  result: {
                    id: match?.[1] ?? 'TC-?',
                    label: match?.[2] ?? trimmed,
                    status: 'pass',
                    ms: Number(match?.[3] ?? 0),
                  },
                })
              } else if (trimmed.startsWith('FAIL:')) {
                const match = trimmed.match(/^FAIL:\s*(\S+)\s+(.*?)\s+\((\d+)ms\)\s*—\s*(.*)/)
                sse({
                  type: 'testResult',
                  result: {
                    id: match?.[1] ?? 'TC-?',
                    label: match?.[2] ?? trimmed,
                    status: 'fail',
                    ms: Number(match?.[3] ?? 0),
                    reason: match?.[4] ?? '',
                  },
                })
              } else {
                sse({ type: 'terminal', line: trimmed })
              }
            }
          })

          proc.stderr.on('data', (chunk: Buffer) => {
            sse({ type: 'terminal', line: chunk.toString().trim() })
          })

          proc.on('close', async (code) => {
            await rm(tmpFile, { force: true })
            sse({ type: 'done', exitCode: code })
            resolve()
          })

          proc.on('error', async (err) => {
            await rm(tmpFile, { force: true })
            sse({ type: 'error', message: String(err) })
            sse({ type: 'done', exitCode: 1 })
            resolve()
          })
        })
      } catch (err) {
        sse({ type: 'error', message: String(err) })
        sse({ type: 'done', exitCode: 1 })
      }

      reply.raw.end()
    },
  )
}

// Static analysis fallback when no LLM is configured
function staticAnalyze(content: string, filename: string): object[] {
  const findings: object[] = []
  const lines = content.split('\n')

  lines.forEach((line, i) => {
    const lineNum = i + 1
    if (line.includes('Math.random()')) {
      findings.push({
        line: lineNum, severity: 'warn',
        title: 'Non-deterministic random usage',
        body: 'Math.random() produces unreliable IDs. Use crypto.randomUUID() for production.',
        test: 'Generate 1000 IDs and check for uniqueness and format',
      })
    }
    if (line.match(/\$\{.*req\.body/) || line.match(/eval\(/) || line.match(/exec\(/)) {
      findings.push({
        line: lineNum, severity: 'error',
        title: 'Potential injection risk',
        body: 'User input used unsafely.',
        test: 'Send malicious payload and verify it is rejected',
      })
    }
    if (line.match(/errorRate\s*=\s*0\.\d+/) || line.includes('Math.random() <')) {
      findings.push({
        line: lineNum, severity: 'error',
        title: 'Intentional error injection',
        body: 'Error rate is artificially set. Remove chaos injection from production code.',
        test: 'Call endpoint 100 times and verify error rate < 1%',
      })
    }
  })

  return findings
}

function generateStaticTestPlan(findings: object[]): object[] {
  const base = [
    { id: 'TC-001', label: 'Happy path — successful request', generated: false },
    { id: 'TC-002', label: 'Missing required fields → 400', generated: false },
    { id: 'TC-003', label: 'Invalid input types → 422', generated: true },
  ]

  findings.forEach((f, i) => {
    const finding = f as { test?: string }
    if (finding.test) {
      base.push({ id: `TC-${String(i + 4).padStart(3, '0')}`, label: finding.test, generated: true })
    }
  })

  return base
}
