import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
      // Confirmed live via independent review: silently returning empty on
      // a nonzero exit code or parse failure masks a real AWS CLI/auth
      // failure as "no services in this cluster". Throws now.
      if (r.status !== 0) throw new Error(`ECS list_services failed: aws CLI exited ${r.status}`)
      const data = JSON.parse(r.stdout) as { serviceArns?: string[] }
      return { services: (data.serviceArns ?? []).map(a => ({ arn: a, name: a.split('/').pop() ?? a })) }
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
      if (r.status !== 0) throw new Error(`ECS list_tasks failed: aws CLI exited ${r.status}`)
      const data = JSON.parse(r.stdout) as { taskArns?: string[] }
      return { tasks: (data.taskArns ?? []).map(a => ({ arn: a, id: a.split('/').pop() ?? a })) }
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
      if (r.status !== 0) throw new Error(`ECS describe_service failed: aws CLI exited ${r.status}`)
      const data = JSON.parse(r.stdout) as { services?: Array<{ serviceName: string; desiredCount: number; runningCount: number; status: string }> }
      return { services: (data.services ?? []).map(s => ({ name: s.serviceName, desired: s.desiredCount, running: s.runningCount, status: s.status })) }
    },
    write: false,
  },
  {
    definition: {
      name: 'deploy_service',
      description: 'Register a new task definition revision with the given image and update the service to it (force new deployment)',
      parameters: {
        type: 'object',
        properties: {
          cluster: { type: 'string' },
          service: { type: 'string' },
          image: { type: 'string' },
        },
        required: ['cluster', 'service', 'image'],
      },
    },
    // Matches apps/gateway/src/routes/ecs.ts's real POST .../deploy route
    // (same describe→register→update-service flow, gate-consume, audit
    // pattern) — reachable directly only through that route in V1, same as
    // K8sAgent's write tools.
    execute: async (params, creds) => {
      const c = creds as ConnectorCreds as Record<string, unknown>
      const cluster = String(params.cluster)
      const service = String(params.service)
      const image = String(params.image)

      const desc = awsCli(['ecs', 'describe-services', '--cluster', cluster, '--services', service, '--output', 'json'], c)
      if (desc.status !== 0) throw new Error(`ECS deploy_service failed: describe-services exited ${desc.status}`)
      const svcData = JSON.parse(desc.stdout) as { services?: Array<{ taskDefinition?: string }> }
      const currentTaskDefArn = svcData.services?.[0]?.taskDefinition
      if (!currentTaskDefArn) throw new Error(`ECS deploy_service failed: service ${service} not found in cluster ${cluster}`)

      const td = awsCli(['ecs', 'describe-task-definition', '--task-definition', currentTaskDefArn, '--output', 'json'], c)
      if (td.status !== 0) throw new Error(`ECS deploy_service failed: describe-task-definition exited ${td.status}`)
      const taskDef = (JSON.parse(td.stdout) as { taskDefinition: Record<string, unknown> }).taskDefinition
      const containerDefinitions = (taskDef.containerDefinitions as Array<Record<string, unknown>>).map(cd => ({ ...cd, image }))
      const registerPayload: Record<string, unknown> = {
        family: taskDef.family,
        containerDefinitions,
        ...(taskDef.taskRoleArn ? { taskRoleArn: taskDef.taskRoleArn } : {}),
        ...(taskDef.executionRoleArn ? { executionRoleArn: taskDef.executionRoleArn } : {}),
        ...(taskDef.networkMode ? { networkMode: taskDef.networkMode } : {}),
        ...(taskDef.volumes ? { volumes: taskDef.volumes } : {}),
        ...(taskDef.cpu ? { cpu: taskDef.cpu } : {}),
        ...(taskDef.memory ? { memory: taskDef.memory } : {}),
      }

      const tmpFile = path.join(tmpdir(), `anway-ecs-taskdef-${Date.now()}.json`)
      writeFileSync(tmpFile, JSON.stringify(registerPayload))
      let register: ReturnType<typeof awsCli>
      try {
        register = awsCli(['ecs', 'register-task-definition', '--cli-input-json', `file://${tmpFile}`, '--output', 'json'], c)
      } finally {
        try { unlinkSync(tmpFile) } catch { /* ignore */ }
      }
      if (register.status !== 0) throw new Error(`ECS deploy_service failed: register-task-definition exited ${register.status}`)
      const newTaskDefArn = (JSON.parse(register.stdout) as { taskDefinition: { taskDefinitionArn: string } }).taskDefinition.taskDefinitionArn

      const update = awsCli(['ecs', 'update-service', '--cluster', cluster, '--service', service, '--task-definition', newTaskDefArn, '--force-new-deployment', '--output', 'json'], c)
      return { ok: update.status === 0, taskDefinition: newTaskDefArn, output: update.status !== 0 ? 'aws ecs update-service failed' : '' }
    },
    write: true,
  },
]

export class EcsAgent implements IConnectorAgent {
  readonly connectorType = 'ecs'
  readonly tools = TOOLS
}
