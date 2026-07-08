import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

// bootstrap.ts calls `az` via child_process.execFile, wrapped with
// util.promisify. Node's real child_process.execFile carries a custom
// util.promisify.custom implementation that resolves { stdout, stderr }
// (rather than promisify's generic single-callback-arg assumption) — same
// mock technique already established in argocd's bootstrap.test.ts.
const execFileMock = vi.fn()
;(execFileMock as unknown as Record<symbol, unknown>)[promisify.custom] = execFileMock

vi.mock('child_process', () => ({ execFile: execFileMock }))

const { AzureMonitorBootstrap } = await import('./bootstrap.js')

const tenantId = '00000000-0000-0000-0000-000000000001' as any

describe('AzureMonitorBootstrap', () => {
  beforeEach(() => { execFileMock.mockReset() })

  // Regression test: runAz previously swallowed EVERY az CLI failure as
  // null — invalid/expired service-principal credentials looked identical
  // to "no credentials configured at all" (the one legitimate empty case).
  it('throws when real credentials were provided but the az CLI call still fails', async () => {
    execFileMock.mockRejectedValue(Object.assign(new Error('command failed'), { stderr: 'AADSTS7000215: Invalid client secret' }))
    const kg = new FakeKG()
    await expect(new AzureMonitorBootstrap(kg).bootstrap(tenantId, 'conn-1', {
      clientId: 'real-client-id', clientSecret: 'wrong-secret', tenantId: 'real-tenant-id',
    })).rejects.toThrow(/Azure Monitor bootstrap/)
  })

  it('treats a failure with no credentials configured as legitimately empty, not fatal', async () => {
    execFileMock.mockRejectedValue(new Error('az: command not found'))
    const kg = new FakeKG()
    const result = await new AzureMonitorBootstrap(kg).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('may not be authenticated')
  })

  it('bootstraps real metric alert rules into entities on success', async () => {
    execFileMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('list')) {
        return { stdout: JSON.stringify([{ id: 'a1', name: 'high-latency', enabled: true, severity: 'high' }]), stderr: '' }
      }
      return { stdout: '{}', stderr: '' }
    })
    const kg = new FakeKG()
    const result = await new AzureMonitorBootstrap(kg).bootstrap(tenantId, 'conn-1', {
      clientId: 'c', clientSecret: 's', tenantId: 't',
    })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'high-latency')).toBe(true)
  })
})
