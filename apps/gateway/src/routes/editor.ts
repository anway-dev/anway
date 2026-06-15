import type { FastifyInstance } from 'fastify'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { writeFile, rm } from 'node:fs/promises'

// Restrict file access to these root directories
const ALLOWED_ROOTS: string[] = [
  process.env['EDITOR_ROOT'] ?? path.resolve(process.cwd(), '../..'),
  '/tmp/anvay-editor',
]

function isAllowedPath(target: string): boolean {
  const resolved = path.resolve(target)
  return ALLOWED_ROOTS.some((root) => resolved.startsWith(path.resolve(root)))
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

function buildLlmClient(): ((messages: object[]) => Promise<string>) | null {
  // Try Anthropic first
  if (process.env['ANTHROPIC_API_KEY']) {
    return async (messages) => {
      // Dynamic import — types not guaranteed at compile time
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk = await import('@anthropic-ai/sdk' as any).catch(() => null) as any
      if (!sdk) throw new Error('Anthropic SDK not installed')
      const client = new sdk.default({ apiKey: process.env['ANTHROPIC_API_KEY'] })
      const response = await client.messages.create({
        model: process.env['ANTHROPIC_MODEL'] ?? 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages,
      })
      return response.content[0]?.text ?? ''
    }
  }
  // Try OpenAI-compatible (OpenAI / Groq / LM Studio / Ollama)
  if (process.env['OPENAI_API_KEY'] || process.env['OPENAI_BASE_URL']) {
    return async (messages) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk = await import('openai' as any).catch(() => null) as any
      if (!sdk) throw new Error('OpenAI SDK not installed')
      const client = new sdk.default({
        apiKey: process.env['OPENAI_API_KEY'] ?? 'no-key',
        baseURL: process.env['OPENAI_BASE_URL'],
      })
      const res = await client.chat.completions.create({
        model: process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini',
        max_tokens: 2048,
        messages,
      })
      return res.choices[0]?.message?.content ?? ''
    }
  }
  return null
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
    { preHandler: [app.authenticate] },
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
    { preHandler: [app.authenticate] },
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

  // POST /api/editor/analyze — LLM analysis, returns SSE stream of findings + test plan
  app.post<{ Body: { content: string; filename: string; language?: string } }>(
    '/api/editor/analyze',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { content, filename, language } = request.body

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

      const llm = buildLlmClient()

      if (!llm) {
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

        const response = await llm([
          { role: 'user', content: `Review this ${language ?? ''} file "${filename}":\n\n\`\`\`\n${content}\n\`\`\`` },
        ])

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

  // POST /api/editor/run-tests — generate test code via LLM and run it
  app.post<{ Body: { content: string; filename: string; findings: object[]; testPlan: object[] } }>(
    '/api/editor/run-tests',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { content, filename, findings, testPlan } = request.body

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const sse = (data: object) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)

      sse({ type: 'status', message: 'Generating test code…' })

      const llm = buildLlmClient()

      if (!llm) {
        sse({ type: 'error', message: 'No LLM configured — cannot generate tests' })
        sse({ type: 'done' })
        reply.raw.end()
        return
      }

      let testCode = ''

      try {
        const findingsSummary = JSON.stringify(findings.slice(0, 10), null, 2)
        const planSummary = JSON.stringify(testPlan.slice(0, 10), null, 2)

        const response = await llm([{
          role: 'user',
          content: `Generate a self-contained Node.js test script (no external dependencies except built-in 'assert' and 'node:test' if available) to test this code.

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
        }])

        // Strip markdown code fences if present
        testCode = response.replace(/^```(?:javascript|js|node)?\n?/, '').replace(/\n?```$/, '').trim()

        sse({ type: 'status', message: 'Running tests…' })
        sse({ type: 'testCode', code: testCode })

        // Write test to temp file and execute
        const tmpDir = await import('node:os').then(m => m.tmpdir())
        const tmpFile = path.join(tmpDir, `anvay-test-${Date.now()}.mjs`)
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
