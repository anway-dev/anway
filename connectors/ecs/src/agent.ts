import { spawnSync } from 'node:child_process'
import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'

function awsCli(args: string[], creds: Record<string, unknown>): { stdout: string; status: number | null } {
  const env: Record<string, string> = {}
  if (creds['accessKeyId']) env['AWS_ACCESS_KEY_ID'] = String(creds['accessKeyId'])
  if (creds['secretAccessKey']) env['AWS_SECRET_ACCESS_KEY'] = String(creds['secretAccessKey'])
  if (creds['region']) env['AWS_DEFAULT_REGION'] = String(creds['region'])
  // Optional endpoint override (e.g. LocalStack) — aws CLI v2.13+ reads this
  // natively, no argv changes needed. Absent in production; only set for
  // local/test environments pointing at an AWS-API-compatible emulator.
  // Same pattern as aws-cloudwatch/aws-health — this connector was missing it.
  if (creds['endpointUrl']) env['AWS_ENDPOINT_URL'] = String(creds['endpointUrl'])
  const result = spawnSync('aws', args, { encoding: 'utf-8', timeout: 15_000, env: { ...process.env, ...env } })
  return { stdout: result.stdout ?? '', status: result.status }
}

const TOOLS: ConnectorTool[] = [
  {
    definition: {
      name: 'list_services',
      description: 'List ECS services in a cluster',
      parameters: {
        type: 'object',
        properties: { cluster: { type: 'string', description: 'ECS cluster name' } },
        required: ['cluster'],
      },
    },
    execute: async (params, creds) => {
      const cluster = String(params.cluster)
      const r = awsCli(['ecs', 'list-services', '--cluster', cluster, '--output', 'json'], creds as ConnectorCreds as Record<string, unknown>)
      if (r.status !== 0) return { services: [] }
      try {
        const data = JSON.parse(r.stdout) as { serviceArns?: string[] }
        return { services: (data.serviceArns ?? []).map(a => ({ arn: a, name: a.split('/').pop() ?? a })) }
      } catch { return { services: [] } }
    },
    write: false,
  },
  {
    definition: {
      name: 'list_tasks',
      description: 'List running ECS tasks in a cluster',
      parameters: {
        type: 'object',
        properties: {
          cluster: { type: 'string', description: 'ECS cluster name' },
          service: { type: 'string', optional: true, description: 'Filter by service name' },
        },
        required: ['cluster'],
      },
    },
    execute: async (params, creds) => {
      const cluster = String(params.cluster)
      const args = ['ecs', 'list-tasks', '--cluster', cluster, '--output', 'json']
      if (params.service) args.push('--service-name', String(params.service))
      const r = awsCli(args, creds as ConnectorCreds as Record<string, unknown>)
      if (r.status !== 0) return { tasks: [] }
      try {
        const data = JSON.parse(r.stdout) as { taskArns?: string[] }
        return { tasks: (data.taskArns ?? []).map(a => ({ arn: a, id: a.split('/').pop() ?? a })) }
      } catch { return { tasks: [] } }
    },
    write: false,
  },
  {
    definition: {
      name: 'describe_service',
      description: 'Describe an ECS service',
      parameters: {
        type: 'object',
        properties: {
          cluster: { type: 'string', description: 'ECS cluster name' },
          service: { type: 'string', description: 'Service name' },
        },
        required: ['cluster', 'service'],
      },
    },
    execute: async (params, creds) => {
      const cluster = String(params.cluster)
      const service = String(params.service)
      const r = awsCli(['ecs', 'describe-services', '--cluster', cluster, '--services', service, '--output', 'json'], creds as ConnectorCreds as Record<string, unknown>)
      if (r.status !== 0) return { services: [] }
      try {
        const data = JSON.parse(r.stdout) as { services?: Array<{ serviceName: string; desiredCount: number; runningCount: number; status: string }> }
        return { services: (data.services ?? []).map(s => ({ name: s.serviceName, desired: s.desiredCount, running: s.runningCount, status: s.status })) }
      } catch { return { services: [] } }
    },
    write: false,
  },
]

export class EcsAgent implements IConnectorAgent {
  readonly connectorType = 'ecs'
  readonly tools = TOOLS
}
