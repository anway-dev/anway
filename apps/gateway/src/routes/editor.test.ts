import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// ALLOWED_ROOTS is computed once at module load from EDITOR_ROOT. ESM
// evaluates all static imports (including editor.js, transitively, below)
// before this file's own top-level statements run — a plain
// `process.env[...] = ...` here would execute too late. vi.hoisted runs
// before any import, real or mocked.
const scratchRoot = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const path = require('node:path') as typeof import('node:path')
  const dir = mkdtempSync(path.join(tmpdir(), 'anway-editor-test-'))
  process.env['EDITOR_ROOT'] = dir
  return dir
})

// Fake ChildProcess for spawn-based git/docker calls — stdout/stderr are
// EventEmitters, `close` fires on the next tick with a code the test
// controls via the `nextSpawnExit` queue (git add/commit/push and docker
// build/push are each a separate spawn() call in the real code).
let nextSpawnExit: number[] = []
const spawnCalls: Array<{ cmd: string; args: string[] }> = []
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn((cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args })
      const child = new EventEmitter() as any
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      const code = nextSpawnExit.length > 0 ? nextSpawnExit.shift()! : 0
      process.nextTick(() => child.emit('close', code))
      return child
    }),
  }
})

vi.mock('../db/prisma.js', () => {
  const qr = vi.fn()
  const er = vi.fn()
  return {
    prisma: {},
    withTenant: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({ $queryRaw: qr, $executeRaw: er })),
  }
})

vi.mock('../utils/crypto.js', () => ({
  decryptJson: vi.fn(<T>(_enc: string): T => ('fake-git-token' as unknown as T)),
  encryptJson: vi.fn((v: unknown) => JSON.stringify(v)),
}))

vi.mock('./chat.js', () => ({
  providerConfigForTenant: vi.fn(async () => null),
  resolveProviderConfig: vi.fn(() => null),
}))

vi.mock('./audit.js', () => ({ appendAuditEvent: vi.fn(async () => {}) }))

import Fastify from 'fastify'
import { editorRoutes } from './editor.js'
import { withTenant } from '../db/prisma.js'

const mockWithTenant = withTenant as ReturnType<typeof vi.fn>

function buildTestApp() {
  const app = Fastify({ logger: false })
  app.decorate('authenticate', vi.fn(async (req: any) => {
    req.user = { tenantId: 'test-tenant', sub: 'test-user', role: 'admin' }
  }))
  return app
}

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

describe('editor write endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spawnCalls.length = 0
    nextSpawnExit = []
    mockWithTenant.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn().mockResolvedValue(0) })
    )
  })

  describe('POST /api/editor/file (save)', () => {
    it('writes real content to disk within the allowed root', async () => {
      const app = buildTestApp()
      await app.register(editorRoutes)
      await app.ready()

      const target = path.join(scratchRoot, 'saved.txt')
      const res = await app.inject({
        method: 'POST',
        url: '/api/editor/file',
        payload: { path: target, content: 'hello from test' },
      })
      expect(res.statusCode).toBe(200)
      const fs = await import('node:fs/promises')
      expect(await fs.readFile(target, 'utf-8')).toBe('hello from test')
    })

    it('rejects a path outside the allowed roots', async () => {
      const app = buildTestApp()
      await app.register(editorRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/editor/file',
        payload: { path: '/etc/passwd', content: 'pwned' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('rejects content over the size limit', async () => {
      const app = buildTestApp()
      await app.register(editorRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/editor/file',
        payload: { path: path.join(scratchRoot, 'big.txt'), content: 'x'.repeat(3 * 1024 * 1024) },
      })
      expect(res.statusCode).toBe(413)
    })
  })

  describe('POST /api/editor/commit', () => {
    it('returns 403 when the gate cannot be consumed (no approval)', async () => {
      mkdirSync(path.join(scratchRoot, 'repo', '.git'), { recursive: true })
      writeFileSync(path.join(scratchRoot, 'repo', 'file.txt'), 'content')

      const app = buildTestApp()
      await app.register(editorRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/editor/commit',
        payload: {
          path: path.join(scratchRoot, 'repo', 'file.txt'),
          message: 'a change',
          provider: 'github',
          gateId: '00000000-0000-0000-0000-000000000001',
        },
      })
      expect(res.statusCode).toBe(403)
      // Must never reach git at all without a consumed gate.
      expect(spawnCalls.length).toBe(0)
    })

    it('runs the real git add/commit/push sequence on a valid gate, with the token injected via a scoped http.extraHeader (never in the remote URL)', async () => {
      mkdirSync(path.join(scratchRoot, 'repo2', '.git'), { recursive: true })
      writeFileSync(path.join(scratchRoot, 'repo2', 'file.txt'), 'content')

      mockWithTenant.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
        fn({
          // First call: gate consume (executeRaw). Second: credentials lookup (queryRaw).
          $executeRaw: vi.fn().mockResolvedValue(1),
          $queryRaw: vi.fn().mockResolvedValue([{ token_enc: 'enc', username: 'tester', email: 'tester@test.local' }]),
        })
      )
      // git rev-parse HEAD / --abbrev-ref HEAD both use spawn too — return a
      // real-looking sha/branch via stdout so the response body is sane.
      nextSpawnExit = [0, 0, 0, 0, 0] // add, commit, rev-parse sha, rev-parse branch, push

      const app = buildTestApp()
      await app.register(editorRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/editor/commit',
        payload: {
          path: path.join(scratchRoot, 'repo2', 'file.txt'),
          message: 'a real change',
          provider: 'github',
          gateId: '00000000-0000-0000-0000-000000000001',
        },
      })
      expect(res.statusCode).toBe(200)

      const pushCall = spawnCalls.find((c) => c.args.includes('push'))
      expect(pushCall).toBeDefined()
      expect(pushCall!.args.some((a) => a.startsWith('http.extraHeader=Authorization: Basic'))).toBe(true)
      // The token must never appear as part of the remote URL/argv verbatim.
      expect(pushCall!.args.join(' ')).not.toContain('fake-git-token')
      const addCall = spawnCalls.find((c) => c.args[0] === 'add')
      expect(addCall!.args).toContain('file.txt')
    })
  })

  describe('POST /api/editor/build', () => {
    it('rejects a servicePath with no Dockerfile', async () => {
      mkdirSync(path.join(scratchRoot, 'no-dockerfile'), { recursive: true })
      const app = buildTestApp()
      await app.register(editorRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/editor/build',
        payload: { servicePath: path.join(scratchRoot, 'no-dockerfile'), imageName: 'test-image' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /api/editor/clone', () => {
    it('rejects a non-https repo URL', async () => {
      const app = buildTestApp()
      await app.register(editorRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/editor/clone',
        payload: { repoUrl: 'git@github.com:org/repo.git', provider: 'github' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 when no credentials are stored for the provider', async () => {
      mockWithTenant.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn() })
      )
      const app = buildTestApp()
      await app.register(editorRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/editor/clone',
        payload: { repoUrl: 'https://github.com/org/repo.git', provider: 'github' },
      })
      expect(res.statusCode).toBe(400)
    })
  })
})
