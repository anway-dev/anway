import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// kubectl() is now async (real spawn, not spawnSync — blocking the whole
// gateway event loop for up to 30s per call was a real production risk on
// a multi-tenant process). Fake ChildProcess mirrors editor.test.ts's
// established pattern: stdout/stderr are EventEmitters, 'close' fires on
// the next tick with the exit code the test configures via
// nextSpawnResult.
let nextSpawnResult: { stdout: string; status: number | null } = { stdout: 'ok', status: 0 }
const spawnCalls: Array<{ cmd: string; args: string[] }> = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args })
    const child = new EventEmitter() as any
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    const { stdout, status } = nextSpawnResult
    process.nextTick(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout))
      child.emit('close', status)
    })
    return child
  }),
}))

vi.mock('../db/prisma.js', () => {
  const qr = vi.fn()
  const er = vi.fn()
  return {
    prisma: {},
    withTenant: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: qr, $executeRaw: er })
    ),
  }
})

vi.mock('../utils/crypto.js', () => ({
  decryptJson: vi.fn(<T>(_enc: string): T => ({ kubeconfig: '/fake/kubeconfig' } as unknown as T)),
  encryptJson: vi.fn((v: unknown) => JSON.stringify(v)),
}))

import Fastify from 'fastify'
import { k8sRoutes } from './k8s.js'

function buildTestApp() {
  const app = Fastify({ logger: false })
  app.decorate('authenticate', vi.fn(async (req: any) => {
    req.user = {
      tenantId: 'test-tenant',
      sub: 'test-user',
      role: 'admin',
    }
  }))
  return app
}

describe('k8s write endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spawnCalls.length = 0
    nextSpawnResult = { stdout: 'ok', status: 0 }
  })

  describe('POST /api/k8s/pods/:namespace/:name/restart', () => {
    it('returns 403 when no gateId provided', async () => {
      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/pods/default/myapp/restart',
        payload: {},
      })
      expect(res.statusCode).toBe(403)
      const body = JSON.parse(res.body) as { error: string }
      expect(body.error).toContain('gate approval required')
    })

    it('returns 403 when gateId is not approved (0 rows consumed)', async () => {
      const { withTenant } = await import('../db/prisma.js')
      const mockWT = withTenant as ReturnType<typeof vi.fn>
      mockWT.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => {
        return fn({
          $queryRaw: vi.fn().mockResolvedValue([]),
          $executeRaw: vi.fn().mockResolvedValue(0), // no rows consumed → gate invalid
        })
      })

      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/pods/default/myapp/restart',
        payload: { gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('executes kubectl on valid gate and returns success', async () => {
      // Need to import the mocked withTenant and configure it
      const { withTenant } = await import('../db/prisma.js')
      const mockWT = withTenant as ReturnType<typeof vi.fn>
      mockWT.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => {
        return fn({
          $queryRaw: vi.fn().mockResolvedValue([{ credentials_enc: 'enc', connector_type: 'k8s' }]),
          $executeRaw: vi.fn().mockResolvedValue(1), // gate consumed
        })
      })
      nextSpawnResult = { stdout: 'deployment restarted', status: 0 }

      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/pods/default/myapp/restart',
        payload: { gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body) as { ok: boolean; action: string }
      expect(body.ok).toBe(true)
      expect(body.action).toBe('restart')
    })
  })

  describe('POST /api/k8s/deployments/:namespace/:name/deploy', () => {
    it('returns 400 when image is missing', async () => {
      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/deployments/default/myapp/deploy',
        payload: { gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns 403 when no gateId provided', async () => {
      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/deployments/default/myapp/deploy',
        payload: { image: 'myapp:v2' },
      })
      expect(res.statusCode).toBe(403)
      const body = JSON.parse(res.body) as { error: string }
      expect(body.error).toContain('gate approval required')
    })

    it('returns 403 when gateId is not approved (0 rows consumed)', async () => {
      const { withTenant } = await import('../db/prisma.js')
      const mockWT = withTenant as ReturnType<typeof vi.fn>
      mockWT.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => {
        return fn({
          $queryRaw: vi.fn().mockResolvedValue([]),
          $executeRaw: vi.fn().mockResolvedValue(0),
        })
      })

      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/deployments/default/myapp/deploy',
        payload: { image: 'myapp:v2', gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('runs kubectl set image on a valid gate — real regression for the missing deploy-new-image action (product verification found restart/scale never changed the image at all)', async () => {
      const { withTenant } = await import('../db/prisma.js')
      const mockWT = withTenant as ReturnType<typeof vi.fn>
      mockWT.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => {
        return fn({
          $queryRaw: vi.fn().mockResolvedValue([{ credentials_enc: 'enc', connector_type: 'k8s' }]),
          $executeRaw: vi.fn().mockResolvedValue(1),
        })
      })
      nextSpawnResult = { stdout: 'deployment.apps/myapp image updated', status: 0 }

      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/deployments/default/myapp/deploy',
        payload: { image: 'myapp:v2', gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body) as { ok: boolean; action: string; image: string }
      expect(body.ok).toBe(true)
      expect(body.action).toBe('deploy')
      expect(body.image).toBe('myapp:v2')
      // Real kubectl invocation — `*=image` sets every container by default.
      // arrayContaining (not exact equality) since the real kubeconfig
      // credential path prepends `--kubeconfig <path>` before these args.
      const kubectlCall = spawnCalls.find((c) => c.cmd === 'kubectl')
      expect(kubectlCall).toBeDefined()
      expect(kubectlCall!.args).toEqual(
        expect.arrayContaining(['set', 'image', 'deployment/myapp', '*=myapp:v2', '-n', 'default']),
      )
    })
  })

  describe('POST /api/k8s/deployments/:namespace/:name/scale', () => {
    it('returns 400 for negative replicas', async () => {
      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/deployments/default/myapp/scale',
        payload: { replicas: -1, gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('POST /api/k8s/nodes/:name/cordon', () => {
    it('returns 403 when no gateId provided', async () => {
      const app = buildTestApp()
      await app.register(k8sRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/k8s/nodes/node-1/cordon',
        payload: {},
      })
      expect(res.statusCode).toBe(403)
    })
  })
})
