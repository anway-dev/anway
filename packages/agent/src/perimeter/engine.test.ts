import { describe, expect, it } from 'vitest'
import { UserId } from '@anvay/types'
import type { ToolCall } from '../interfaces/provider.js'
import { AgentPerimeter } from './engine.js'
import type { ConnectorManifest, UserPerimeter } from './engine.js'

function makeCall(name: string, resource?: string): ToolCall {
  return { id: 'tc-1', name, args: resource ? { resource } : {} }
}

const userId = UserId('user-1')

const manifests: ConnectorManifest[] = [
  {
    connectorId: 'github',
    mode: 'read-write',
    capabilities: { read: ['*'], write: ['org/repo-a', 'org/repo-b'] },
  },
  {
    connectorId: 'k8s-prod',
    mode: 'read-write',
    capabilities: { read: ['*'], write: ['deployments/*'] },
  },
  {
    connectorId: 'datadog',
    mode: 'read',
    capabilities: { read: ['*'], write: [] },
  },
]

const userPerimeter: UserPerimeter = {
  userId,
  connectors: [
    { connectorId: 'github', read: ['*'], write: ['org/repo-a'] },
    { connectorId: 'k8s-prod', read: ['*'], write: ['deployments/app1'] },
    { connectorId: 'datadog', read: ['*'], write: [] },
  ],
}

const perimeter = new AgentPerimeter(userPerimeter, manifests)

describe('AgentPerimeter.allows', () => {
  it('allows read tool call on connector in perimeter with wildcard read scope', () => {
    expect(perimeter.allows(makeCall('github.list_prs'))).toBe(true)
  })

  it('blocks tool call on connector NOT in perimeter', () => {
    expect(perimeter.allows(makeCall('linear.list_issues'))).toBe(false)
  })

  it('allows write tool call where user has write scope on that resource', () => {
    expect(perimeter.allows(makeCall('github.create_pr', 'org/repo-a'))).toBe(true)
  })

  it('blocks write tool call where user has NO write scope on that resource', () => {
    expect(perimeter.allows(makeCall('github.create_pr', 'org/repo-b'))).toBe(false)
  })

  it('allows wildcard read scope to match any resource', () => {
    expect(perimeter.allows(makeCall('k8s-prod.get_pod', 'pods/payments-api-xyz'))).toBe(true)
  })

  it('allows write call that matches prefix wildcard scope', () => {
    // user has write: ['deployments/app1'], connector manifest write: ['deployments/*']
    // intersection keeps only ['deployments/app1'] — exact match required
    expect(perimeter.allows(makeCall('k8s-prod.restart_pod', 'deployments/app1'))).toBe(true)
  })

  it('blocks write call for resource outside specific scope', () => {
    expect(perimeter.allows(makeCall('k8s-prod.restart_pod', 'deployments/app2'))).toBe(false)
  })

  it('blocks write call on read-only connector (datadog)', () => {
    expect(perimeter.allows(makeCall('datadog.create_monitor'))).toBe(false)
  })
})

describe('AgentPerimeter.hardBlock', () => {
  it('returns a typed HardBlock with correct shape', () => {
    const call = makeCall('linear.create_issue')
    const block = perimeter.hardBlock(call, 'not in perimeter')
    expect(block._tag).toBe('HardBlock')
    expect(block.reason).toBe('not in perimeter')
    expect(block.toolCall).toBe(call)
    expect(block.rule).toMatch(/perimeter:linear/)
  })
})

describe('AgentPerimeter.resolveCapabilities', () => {
  it('static factory produces equivalent perimeter', () => {
    const p = AgentPerimeter.resolveCapabilities(userPerimeter, manifests)
    expect(p.allows(makeCall('github.list_prs'))).toBe(true)
    expect(p.allows(makeCall('linear.list_issues'))).toBe(false)
  })
})
