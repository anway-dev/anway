import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

// bootstrap.ts calls `gcloud` via child_process.execFile, wrapped with
// util.promisify — same custom-symbol mock technique already established
// in argocd's/azure-monitor's bootstrap.test.ts.
const execFileMock = vi.fn()
;(execFileMock as unknown as Record<symbol, unknown>)[promisify.custom] = execFileMock

vi.mock('child_process', () => ({ execFile: execFileMock }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, writeFileSync: vi.fn() }
})

const { GcpMonitoringBootstrap } = await import('./bootstrap.js')

const tenantId = '00000000-0000-0000-0000-000000000001' as any

describe('GcpMonitoringBootstrap', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    vi.unstubAllGlobals()
  })

  // Regression test: runGcloud previously swallowed EVERY gcloud CLI
  // failure as null — invalid/expired service account credentials looked
  // identical to "no credentials configured at all" (the one legitimate
  // empty case).
  it('throws when real credentials were provided but the gcloud CLI call still fails', async () => {
    execFileMock.mockRejectedValue(new Error('PERMISSION_DENIED: caller does not have permission'))
    const kg = new FakeKG()
    await expect(new GcpMonitoringBootstrap(kg).bootstrap(tenantId, 'conn-1', {
      google_application_credentials: '/fake/key.json',
    })).rejects.toThrow(/GCP Monitoring bootstrap/)
  })

  it('treats a failure with no credentials configured as legitimately empty, not fatal', async () => {
    execFileMock.mockRejectedValue(new Error('gcloud: command not found'))
    const kg = new FakeKG()
    const result = await new GcpMonitoringBootstrap(kg).bootstrap(tenantId, 'conn-1', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('may not be authenticated')
  })

  it('bootstraps real alert policies into entities on success', async () => {
    execFileMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('list')) {
        return { stdout: JSON.stringify([{ name: 'projects/p/alertPolicies/1', displayName: 'high-cpu', enabled: true }]), stderr: '' }
      }
      if (args.includes('print-access-token')) return { stdout: 'fake-token\n', stderr: '' }
      return { stdout: '{}', stderr: '' }
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ events: [] }) })))
    const kg = new FakeKG()
    const result = await new GcpMonitoringBootstrap(kg).bootstrap(tenantId, 'conn-1', {
      google_application_credentials: '/fake/key.json', project_id: 'p',
    })
    expect(result.entitiesUpserted).toBe(1)
    expect(kg.entities.some((e) => e.name === 'high-cpu')).toBe(true)
  })

  it('treats a 403 from the Service Health API as a legitimate API-not-enabled gap, not fatal', async () => {
    execFileMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes('list')) return { stdout: '[]', stderr: '' }
      if (args.includes('print-access-token')) return { stdout: 'fake-token\n', stderr: '' }
      return { stdout: '{}', stderr: '' }
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
    const kg = new FakeKG()
    const result = await new GcpMonitoringBootstrap(kg).bootstrap(tenantId, 'conn-1', {
      google_application_credentials: '/fake/key.json', project_id: 'p',
    })
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('API may not be enabled')
  })
})
