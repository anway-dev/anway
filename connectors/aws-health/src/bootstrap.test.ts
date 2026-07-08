import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IKnowledgeGraph } from '@anway/agent'

const mockExecFileSync = vi.fn()
vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

import { AwsHealthBootstrap } from './bootstrap.js'

beforeEach(() => {
  mockExecFileSync.mockReset()
})

function fakeKg(): IKnowledgeGraph {
  return {
    upsertEntity: vi.fn(async () => 'entity-id'),
    upsertRelationship: vi.fn(async () => 'rel-id'),
  } as unknown as IKnowledgeGraph
}

describe('AwsHealthBootstrap', () => {
  // Regression test: runAws previously used execSync with a template-string
  // command (shell-injection-shaped) and swallowed EVERY failure as null —
  // a completely broken connector (bad credentials) looked identical to an
  // account without a Business/Enterprise support plan (the one
  // legitimate, already-documented empty case).
  it('throws on a real AWS CLI failure instead of reporting a false-clean empty success', async () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('command failed') as Error & { stderr: string }
      err.stderr = 'An error occurred (InvalidClientTokenId) when calling the DescribeEvents operation'
      throw err
    })
    const bootstrap = new AwsHealthBootstrap(fakeKg())
    await expect(bootstrap.bootstrap('t-1' as any, 'conn-1', { accessKeyId: 'bad', secretAccessKey: 'bad' }))
      .rejects.toThrow(/AWS Health bootstrap/)
  })

  it('treats missing Business/Enterprise support plan as a legitimate empty result, not a fatal error', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('describe-events')) {
        const err = new Error('command failed') as Error & { stderr: string }
        err.stderr = 'An error occurred (SubscriptionRequiredException) when calling the DescribeEvents operation'
        throw err
      }
      return Buffer.from('[]')
    })
    const bootstrap = new AwsHealthBootstrap(fakeKg())
    const result = await bootstrap.bootstrap('t-1' as any, 'conn-1', { accessKeyId: 'ok', secretAccessKey: 'ok' })
    expect(result.entitiesUpserted).toBe(0)
    expect(result.episodeHints.join(' ')).toContain('Business/Enterprise support plan')
  })

  it('passes CloudWatch describe-alarms query as a real argv array, not a shell-quoted string', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('describe-events')) return Buffer.from(JSON.stringify({ events: [] }))
      if (args.includes('describe-alarms')) {
        // The JMESPath value must appear as its own argv element with no
        // surrounding quote characters — execFileSync never invokes a
        // shell to strip them.
        expect(args).toContain('MetricAlarms[*]')
        expect(args.some((a) => a.includes('"'))).toBe(false)
        return Buffer.from(JSON.stringify([{ AlarmName: 'high-error-rate', StateValue: 'ALARM', MetricName: 'Errors', Namespace: 'AWS/Lambda' }]))
      }
      return Buffer.from('[]')
    })
    const bootstrap = new AwsHealthBootstrap(fakeKg())
    const result = await bootstrap.bootstrap('t-1' as any, 'conn-1', { accessKeyId: 'ok', secretAccessKey: 'ok' })
    expect(result.entitiesUpserted).toBe(1)
  })
})
