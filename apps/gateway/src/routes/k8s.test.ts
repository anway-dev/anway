import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock hoists to top — factory must not reference outer variables
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn().mockReturnValue({ stdout: 'ok', status: 0 }),
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
import { spawnSync } from 'node:child_process'

const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>

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
      mockSpawnSync.mockReturnValue({ stdout: 'deployment restarted', status: 0 })

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
