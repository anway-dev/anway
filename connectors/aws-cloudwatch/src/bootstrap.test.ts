import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IKnowledgeGraph } from '@anway/agent'

const mockExecFileSync = vi.fn()
vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}))

import { AwsCloudwatchBootstrap } from './bootstrap.js'

beforeEach(() => {
  mockExecFileSync.mockReset()
})

function fakeKg(): IKnowledgeGraph {
  return {
    upsertEntity: vi.fn(async () => 'entity-id'),
    upsertRelationship: vi.fn(async () => 'rel-id'),
  } as unknown as IKnowledgeGraph
}

describe('AwsCloudwatchBootstrap', () => {
  // Regression test: runAws previously swallowed EVERY execFileSync
  // failure — bad credentials, network outage, malformed JSON — as null,
  // which every call site treats as "nothing to report". A completely
  // broken connector (expired credentials) bootstrapped as a plausible
  // "0 resources discovered" success, indistinguishable from a
  // legitimately quiet AWS account.
  it('throws on a real AWS CLI failure instead of reporting a false-clean empty success', async () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('command failed') as Error & { stderr: string }
      err.stderr = 'An error occurred (InvalidClientTokenId) when calling the DescribeInstances operation: The security token included in the request is invalid'
      throw err
    })
    const bootstrap = new AwsCloudwatchBootstrap(fakeKg())
    await expect(bootstrap.bootstrap('t-1' as any, 'conn-1', { accessKeyId: 'bad', secretAccessKey: 'bad' }))
      .rejects.toThrow(/AWS CloudWatch bootstrap/)
  })

  it('treats AccessDenied for one API as a legitimate scope gap, not a fatal error, and still reports other resources', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('describe-instances')) {
        const err = new Error('command failed') as Error & { stderr: string }
        err.stderr = 'An error occurred (UnauthorizedOperation) when calling the DescribeInstances operation'
        throw err
      }
      if (args.includes('list-clusters')) return Buffer.from(JSON.stringify({ clusterArns: [] }))
      if (args.includes('describe-alarms')) {
        return Buffer.from(JSON.stringify([{ AlarmName: 'high-error-rate', StateValue: 'ALARM', MetricName: 'Errors', Namespace: 'AWS/Lambda' }]))
      }
      return Buffer.from('[]')
    })
    const bootstrap = new AwsCloudwatchBootstrap(fakeKg())
    const result = await bootstrap.bootstrap('t-1' as any, 'conn-1', { accessKeyId: 'ok', secretAccessKey: 'ok' })
    expect(result.entitiesUpserted).toBe(1) // the one alarm, EC2 skipped due to scoped permissions
  })

  it('bootstraps real EC2/ECS/alarm data into entities on success', async () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('describe-instances')) {
        return Buffer.from(JSON.stringify([[{ InstanceId: 'i-123', InstanceType: 't3.micro', State: { Name: 'running' } }]]))
      }
      return Buffer.from('[]')
    })
    const bootstrap = new AwsCloudwatchBootstrap(fakeKg())
    const result = await bootstrap.bootstrap('t-1' as any, 'conn-1', { accessKeyId: 'ok', secretAccessKey: 'ok' })
    expect(result.entitiesUpserted).toBe(1)
  })
})
