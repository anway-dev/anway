import { describe, it, expect, vi } from 'vitest'
import { isWriteAction, pollGate } from './gate.js'
import type { IGateSink } from './gate.js'

describe('isWriteAction', () => {
  it('identifies write action patterns', () => {
    expect(isWriteAction('create_incident')).toBe(true)
    expect(isWriteAction('deploy_service')).toBe(true)
    expect(isWriteAction('restart_pod')).toBe(true)
    expect(isWriteAction('delete_trigger')).toBe(true)
    expect(isWriteAction('update_config')).toBe(true)
    expect(isWriteAction('scale_deployment')).toBe(true)
    expect(isWriteAction('rollback_deploy')).toBe(true)
    expect(isWriteAction('merge_pr')).toBe(true)
    expect(isWriteAction('comment_on_pr')).toBe(true)
    expect(isWriteAction('run_runbook')).toBe(true)
    expect(isWriteAction('notify_oncall')).toBe(true)
  })

  it('identifies read actions as non-write', () => {
    expect(isWriteAction('list_prs')).toBe(false)
    expect(isWriteAction('get_metrics')).toBe(false)
    expect(isWriteAction('search_logs')).toBe(false)
    expect(isWriteAction('read_config')).toBe(false)
    expect(isWriteAction('unknown_tool')).toBe(true) // default-deny: unknown tools are writes
  })

  it('handles native connector __ separator for read tools', () => {
    expect(isWriteAction('prometheus__alerts')).toBe(false)
    expect(isWriteAction('prometheus__query')).toBe(false)
    expect(isWriteAction('prometheus__targets')).toBe(false)
    expect(isWriteAction('alertmanager__alerts')).toBe(false)
    expect(isWriteAction('alertmanager__silences')).toBe(false)
    expect(isWriteAction('loki__query')).toBe(false)
    expect(isWriteAction('loki__labels')).toBe(false)
    expect(isWriteAction('grafana__dashboards')).toBe(false)
    expect(isWriteAction('grafana__health')).toBe(false)
  })
})

describe('pollGate', () => {
  it('returns approved when poll returns approved immediately', async () => {
    const sink: IGateSink = {
      push: vi.fn(),
      poll: vi.fn().mockResolvedValue('approved'),
      record: vi.fn(),
      consume: vi.fn().mockResolvedValue(true),
    }
    const decision = await pollGate(sink, 'g1', 5000, 100)
    expect(decision._tag).toBe('approved')
  })

  it('returns rejected when poll returns rejected', async () => {
    const sink: IGateSink = {
      push: vi.fn(),
      poll: vi.fn().mockResolvedValue('rejected'),
      record: vi.fn(),
      consume: vi.fn().mockResolvedValue(true),
    }
    const decision = await pollGate(sink, 'g1', 5000, 100)
    expect(decision._tag).toBe('rejected')
  })

  it('returns timeout after timeout period', async () => {
    const sink: IGateSink = {
      push: vi.fn(),
      poll: vi.fn().mockResolvedValue(null), // never decided
      record: vi.fn(),
      consume: vi.fn().mockResolvedValue(true),
    }
    const decision = await pollGate(sink, 'g1', 300, 100)
    expect(decision._tag).toBe('timeout')
  })
})
