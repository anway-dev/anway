import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db/client.js', () => ({ prisma: {} }))

const qr = vi.fn()
const er = vi.fn()
vi.mock('../db/prisma.js', () => ({
  withTenant: vi.fn((_p: unknown, _t: string, fn: (tx: unknown) => unknown) =>
    fn({ $queryRaw: qr, $executeRaw: er })
  ),
}))

import { executeTriggerAction } from './actions.js'

beforeEach(() => {
  qr.mockReset()
  er.mockReset()
})

describe('block_deploy_gate', () => {
  it('binds the real pipeline_id/stage_id columns and the real "waiting" gate-pending status', async () => {
    // Regression test: this previously targeted nonexistent
    // pipeline_name/stage_name columns and checked status = 'pending'
    // instead of the real 'waiting' state pipeline.ts actually writes for
    // an awaiting-approval gate stage — every real call threw "column does
    // not exist" and was silently swallowed, so block_deploy_gate never
    // blocked a single real deploy.
    er.mockResolvedValue(1)

    const result = await executeTriggerAction('tenant-1', {
      type: 'block_deploy_gate',
      params: { pipelineId: 'pipe-uuid-1', env: 'prod' },
    })

    expect(result.ok).toBe(true)
    expect(er).toHaveBeenCalledTimes(1)
    const [strings, ...values] = er.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    const sql = strings.join('?')
    expect(sql).toContain('pipeline_id')
    expect(sql).toContain('stage_id')
    expect(sql).not.toContain('pipeline_name')
    expect(sql).not.toContain('stage_name')
    expect(sql).toContain("status = 'waiting'")
    expect(values).toEqual(['tenant-1', 'pipe-uuid-1', 'gate.prod'])
  })

  it('accepts an explicit stageId without requiring env', async () => {
    er.mockResolvedValue(1)
    const result = await executeTriggerAction('tenant-1', {
      type: 'block_deploy_gate',
      params: { pipelineId: 'pipe-uuid-1', stageId: 'gate.staging' },
    })
    expect(result.ok).toBe(true)
    const [, , , stageIdArg] = er.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    expect(stageIdArg).toBe('gate.staging')
  })

  it('fails cleanly when neither stageId nor env is provided', async () => {
    const result = await executeTriggerAction('tenant-1', {
      type: 'block_deploy_gate',
      params: { pipelineId: 'pipe-uuid-1' },
    })
    expect(result.ok).toBe(false)
    expect(er).not.toHaveBeenCalled()
  })

  it('fails cleanly when pipelineId is missing', async () => {
    const result = await executeTriggerAction('tenant-1', {
      type: 'block_deploy_gate',
      params: { env: 'prod' },
    })
    expect(result.ok).toBe(false)
    expect(er).not.toHaveBeenCalled()
  })
})
