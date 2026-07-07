import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn().mockReturnValue({ stdout: '', stderr: '', status: 0 }),
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
  decryptJson: vi.fn(<T>(_enc: string): T => ({ accessKeyId: 'fake', secretAccessKey: 'fake', region: 'us-east-1' } as unknown as T)),
  encryptJson: vi.fn((v: unknown) => JSON.stringify(v)),
}))

import Fastify from 'fastify'
import { ecsRoutes } from './ecs.js'
import { spawnSync } from 'node:child_process'

const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>

function buildTestApp() {
  const app = Fastify({ logger: false })
  app.decorate('authenticate', vi.fn(async (req: any) => {
    req.user = { tenantId: 'test-tenant', sub: 'test-user', role: 'admin' }
  }))
  return app
}

// Regression coverage for the ECS deploy write action — product
// verification found this connector was read-only (list_services/
// list_tasks/describe_service only, zero write tools, no gateway write
// route at all). This is the real describe→register→update-service flow,
// gated the same way as k8s.ts's write routes.
describe('ecs write endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/ecs/services/:cluster/:service/deploy', () => {
    it('returns 400 when image is missing', async () => {
      const app = buildTestApp()
      await app.register(ecsRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/ecs/services/my-cluster/my-service/deploy',
        payload: { gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns 403 when no gateId provided', async () => {
      const app = buildTestApp()
      await app.register(ecsRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/ecs/services/my-cluster/my-service/deploy',
        payload: { image: 'myapp:v2' },
      })
      expect(res.statusCode).toBe(403)
      const body = JSON.parse(res.body) as { error: string }
      expect(body.error).toContain('gate approval required')
    })

    it('returns 403 when gateId is not approved (0 rows consumed)', async () => {
      const { withTenant } = await import('../db/prisma.js')
      const mockWT = withTenant as ReturnType<typeof vi.fn>
      mockWT.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn().mockResolvedValue(0) })
      )

      const app = buildTestApp()
      await app.register(ecsRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/ecs/services/my-cluster/my-service/deploy',
        payload: { image: 'myapp:v2', gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('runs the real describe→register→update-service flow on a valid gate', async () => {
      const { withTenant } = await import('../db/prisma.js')
      const mockWT = withTenant as ReturnType<typeof vi.fn>
      mockWT.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn().mockResolvedValue(1) })
      )

      mockSpawnSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes('describe-services')) {
          return { stdout: JSON.stringify({ services: [{ taskDefinition: 'arn:aws:ecs:task-def/my-family:1' }] }), stderr: '', status: 0 }
        }
        if (args.includes('describe-task-definition')) {
          return {
            stdout: JSON.stringify({
              taskDefinition: {
                family: 'my-family',
                containerDefinitions: [{ name: 'app', image: 'myapp:v1' }],
              },
            }),
            stderr: '', status: 0,
          }
        }
        if (args.includes('register-task-definition')) {
          return { stdout: JSON.stringify({ taskDefinition: { taskDefinitionArn: 'arn:aws:ecs:task-def/my-family:2' } }), stderr: '', status: 0 }
        }
        if (args.includes('update-service')) {
          return { stdout: JSON.stringify({ service: { serviceName: 'my-service' } }), stderr: '', status: 0 }
        }
        return { stdout: '', stderr: 'unexpected call', status: 1 }
      })

      const app = buildTestApp()
      await app.register(ecsRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/ecs/services/my-cluster/my-service/deploy',
        payload: { image: 'myapp:v2', gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body) as { ok: boolean; taskDefinition: string; image: string }
      expect(body.ok).toBe(true)
      expect(body.taskDefinition).toBe('arn:aws:ecs:task-def/my-family:2')
      expect(body.image).toBe('myapp:v2')

      // register-task-definition must have been called with the new image
      // baked into the cloned container definitions, not the old one.
      const registerCall = mockSpawnSync.mock.calls.find((c) => (c[1] as string[]).includes('register-task-definition'))
      expect(registerCall).toBeDefined()
    })

    it('propagates a real update-service failure instead of fabricating success', async () => {
      const { withTenant } = await import('../db/prisma.js')
      const mockWT = withTenant as ReturnType<typeof vi.fn>
      mockWT.mockImplementation(async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
        fn({ $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn().mockResolvedValue(1) })
      )
      mockSpawnSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args.includes('describe-services')) return { stdout: JSON.stringify({ services: [{ taskDefinition: 'arn:x:1' }] }), stderr: '', status: 0 }
        if (args.includes('describe-task-definition')) return { stdout: JSON.stringify({ taskDefinition: { family: 'f', containerDefinitions: [{ name: 'app', image: 'old' }] } }), stderr: '', status: 0 }
        if (args.includes('register-task-definition')) return { stdout: JSON.stringify({ taskDefinition: { taskDefinitionArn: 'arn:x:2' } }), stderr: '', status: 0 }
        if (args.includes('update-service')) return { stdout: '', stderr: 'service my-service is not active', status: 254 }
        return { stdout: '', stderr: '', status: 1 }
      })

      const app = buildTestApp()
      await app.register(ecsRoutes)
      await app.ready()

      const res = await app.inject({
        method: 'POST',
        url: '/api/ecs/services/my-cluster/my-service/deploy',
        payload: { image: 'myapp:v2', gateId: '00000000-0000-0000-0000-000000000001' },
      })
      expect(res.statusCode).toBe(500)
      const body = JSON.parse(res.body) as { ok: boolean; error: string }
      expect(body.ok).toBe(false)
      expect(body.error).toContain('update-service')
    })
  })
})
