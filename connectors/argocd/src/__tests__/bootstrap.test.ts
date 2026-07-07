import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promisify } from 'node:util'
import { FakeKnowledgeGraph as FakeKG } from '@anway/agent/testing'

// bootstrap.ts calls `argocd` via child_process.execFile, wrapped with
// util.promisify. Node's real child_process.execFile carries a custom
// util.promisify.custom implementation that resolves { stdout, stderr }
// (rather than promisify's generic single-callback-arg assumption) — the
// mock below replicates that so promisify(execFileMock) behaves the same
// way bootstrap.ts's real promisify(execFile) does.
const execFileMock = vi.fn()
;(execFileMock as unknown as Record<symbol, unknown>)[promisify.custom] = execFileMock

vi.mock('child_process', () => ({ execFile: execFileMock }))

const { ArgocdBootstrap } = await import('../bootstrap.js')

const tenantId = '00000000-0000-0000-0000-000000000001' as any

describe('ArgocdBootstrap', () => {
  beforeEach(() => { execFileMock.mockReset() })

  it('returns an empty, successful result when the argocd CLI binary is genuinely not installed (ENOENT)', async () => {
    const enoent = Object.assign(new Error('spawn argocd ENOENT'), { code: 'ENOENT' })
    execFileMock.mockRejectedValue(enoent)
    const kg = new FakeKG()
    const result = await new ArgocdBootstrap(kg).bootstrap(tenantId, 'test-connector', {})
    expect(result.entitiesUpserted).toBe(0)
    expect(result.relationshipsUpserted).toBe(0)
    expect(result.episodeHints).toContain('ArgoCD CLI not available')
  })

  it('throws on a real CLI failure (non-zero exit — auth/connection error) instead of returning an empty result', async () => {
    const realFailure = Object.assign(new Error('Command failed: argocd app list -o json\nrpc error: code = Unauthenticated'), { code: 1 })
    execFileMock.mockRejectedValue(realFailure)
    const kg = new FakeKG()
    await expect(new ArgocdBootstrap(kg).bootstrap(tenantId, 'test-connector', {})).rejects.toThrow('ArgoCD bootstrap')
  })

  it('throws when the CLI exits 0 but returns non-JSON output', async () => {
    execFileMock.mockResolvedValue({ stdout: 'not json', stderr: '' })
    const kg = new FakeKG()
    await expect(new ArgocdBootstrap(kg).bootstrap(tenantId, 'test-connector', {})).rejects.toThrow('non-JSON output')
  })

  it('creates Deploy→DEPLOYED_TO→Service using the real entity ids upsertEntity returned', async () => {
    execFileMock.mockResolvedValue({
      stdout: JSON.stringify([
        { metadata: { name: 'payments-api' }, spec: { destination: { namespace: 'prod' } }, status: { sync: { status: 'Synced' } } },
      ]),
      stderr: '',
    })
    const kg = new FakeKG()
    const result = await new ArgocdBootstrap(kg).bootstrap(tenantId, 'test-connector', {})
    expect(result.entitiesUpserted).toBeGreaterThan(0)
    expect(result.relationshipsUpserted).toBeGreaterThan(0)
    expect(kg.relationships.some(r =>
      r.relType === 'DEPLOYED_TO' &&
      r.fromEntityId === 'Deploy:payments-api' &&
      r.toEntityId === 'Service:payments-api',
    )).toBe(true)
  })
})
