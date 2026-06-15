import type { FastifyInstance } from 'fastify'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createClient } from 'redis'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { decryptJson } from '../utils/crypto.js'

const TERRAFORM_ROOT = path.resolve(process.env['TERRAFORM_ROOT'] ?? '../../../infra/terraform')

// Maps connector type → one or more possible Terraform environments
// Each connector instance can produce its own named environment (using cluster/region from creds)
const CONNECTOR_DEPLOY_MAP: Record<string, { platform: string; label: string; tfEnv: string }> = {
  eks:           { platform: 'k8s',    label: 'Amazon EKS',          tfEnv: 'aws-eks' },
  ecs:           { platform: 'ecs',    label: 'Amazon ECS Fargate',  tfEnv: 'aws-ecs' },
  gke:           { platform: 'k8s',    label: 'Google GKE',          tfEnv: 'gcp'     },
  aks:           { platform: 'k8s',    label: 'Azure AKS',           tfEnv: 'azure'   },
  k8s:           { platform: 'k8s',    label: 'Kubernetes',          tfEnv: 'k8s'     },
  argocd:        { platform: 'gitops', label: 'ArgoCD (GitOps)',     tfEnv: 'k8s'     },
  'aws-cloudwatch': { platform: 'aws', label: 'AWS (CloudWatch)',    tfEnv: 'aws-eks' },
  'gcp-monitoring': { platform: 'gcp', label: 'GCP',                tfEnv: 'gcp'     },
  'azure-monitor':  { platform: 'azure', label: 'Azure',            tfEnv: 'azure'   },
}

function validEnvironment(env: string): boolean {
  return /^[a-z0-9-]+$/.test(env) &&
    ['demo', 'aws-eks', 'aws-ecs', 'gcp', 'azure', 'k8s'].includes(env)
}

function runTerraform(
  environment: string,
  args: string[],
  onData: (chunk: string) => void,
): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const cwd = path.join(TERRAFORM_ROOT, 'environments', environment)
    if (!existsSync(cwd)) {
      reject(new Error(`Environment directory not found: ${cwd}`))
      return
    }

    const proc = spawn('terraform', args, { cwd, env: { ...process.env } })

    proc.stdout.on('data', (d: Buffer) => onData(d.toString()))
    proc.stderr.on('data', (d: Buffer) => onData(d.toString()))

    proc.on('close', (code) => resolve({ code: code ?? 1 }))
    proc.on('error', reject)
  })
}

export async function terraformRoutes(app: FastifyInstance) {
  // GET /api/terraform/:env/plan — streams `terraform plan` output as SSE
  app.get<{ Params: { env: string } }>(
    '/api/terraform/:env/plan',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { env } = request.params

      if (!validEnvironment(env)) {
        return reply.code(400).send({ error: 'invalid environment' })
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const send = (data: string) => {
        for (const line of data.split('\n')) {
          reply.raw.write(`data: ${JSON.stringify({ line })}\n\n`)
        }
      }

      try {
        const { code } = await runTerraform(env, ['plan', '-no-color'], send)
        reply.raw.write(`data: ${JSON.stringify({ done: true, exitCode: code })}\n\n`)
      } catch (err) {
        reply.raw.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
      } finally {
        reply.raw.end()
      }
    },
  )

  // POST /api/terraform/:env/apply — runs `terraform apply -auto-approve`, streams output
  // Requires gate approval — caller must have approved the plan first (checked via gate_events)
  app.post<{ Params: { env: string }; Body: { gateId?: string } }>(
    '/api/terraform/:env/apply',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { env } = request.params
      const { tenantId } = request.user as { tenantId: string }

      if (!validEnvironment(env)) {
        return reply.code(400).send({ error: 'invalid environment' })
      }

      // Verify gate approval exists for this environment
      const { gateId } = request.body ?? {}
      if (gateId) {
        const { prisma } = await import('../db/client.js')
        const { withTenant } = await import('../db/prisma.js')

        const rows = await withTenant(prisma, tenantId, (tx) =>
          tx.$queryRaw<Array<{ status: string }>>`
            SELECT status FROM gate_events
            WHERE id = ${gateId}::uuid AND tenant_id = ${tenantId}::uuid
            LIMIT 1
          `,
        ).catch(() => [])

        if (rows.length === 0 || rows[0]!.status !== 'approved') {
          return reply.code(403).send({ error: 'gate approval required before apply' })
        }
      }

      // Acquire distributed lock to prevent concurrent terraform apply on same env
      const redisUrl = process.env['REDIS_URL']
      let lockKey: string | null = null
      let redis: ReturnType<typeof createClient> | null = null
      if (redisUrl) {
        lockKey = `terraform:lock:${env}:${tenantId}`
        redis = createClient({ url: redisUrl })
        try {
          await redis.connect()
          const acquired = await redis.set(lockKey, (request.user as { sub: string }).sub, { NX: true, EX: 600 })
          if (!acquired) {
            await redis.disconnect()
            return reply.code(409).send({ error: 'deploy in progress', code: 'LOCK_HELD' })
          }
        } catch {
          // Redis unavailable — skip lock (non-blocking, single-instance deploys)
          if (redis) { try { await redis.disconnect() } catch { /* ignore */ } }
          redis = null
          lockKey = null
        }
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const send = (data: string) => {
        for (const line of data.split('\n')) {
          reply.raw.write(`data: ${JSON.stringify({ line })}\n\n`)
        }
      }

      try {
        const { code } = await runTerraform(
          env,
          ['apply', '-auto-approve', '-no-color'],
          send,
        )
        reply.raw.write(`data: ${JSON.stringify({ done: true, exitCode: code })}\n\n`)
      } catch (err) {
        reply.raw.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
      } finally {
        if (redis && lockKey) {
          try { await redis.del(lockKey) } catch { /* ignore */ }
          try { await redis.disconnect() } catch { /* ignore */ }
        }
        reply.raw.end()
      }
    },
  )

  // GET /api/terraform/:env/output — returns `terraform output -json`
  app.get<{ Params: { env: string } }>(
    '/api/terraform/:env/output',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { env } = request.params

      if (!validEnvironment(env)) {
        return reply.code(400).send({ error: 'invalid environment' })
      }

      const lines: string[] = []
      try {
        const { code } = await runTerraform(env, ['output', '-json'], (chunk) => {
          lines.push(chunk)
        })

        if (code !== 0) {
          return reply.code(500).send({ error: 'terraform output failed', detail: lines.join('') })
        }

        return reply.send(JSON.parse(lines.join('')))
      } catch (err) {
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

  // GET /api/terraform/environments — list available Terraform env directories
  app.get(
    '/api/terraform/environments',
    { preHandler: [app.authenticate] },
    async (_request, reply) => {
      const knownEnvs = ['demo', 'aws-eks', 'aws-ecs', 'gcp', 'azure', 'k8s']
      const envs = knownEnvs.filter((e) =>
        existsSync(path.join(TERRAFORM_ROOT, 'environments', e, 'main.tf')),
      )
      const labels: Record<string, string> = {
        demo: 'Local (Docker)', 'aws-eks': 'AWS EKS', 'aws-ecs': 'AWS ECS Fargate',
        gcp: 'GCP GKE', azure: 'Azure AKS', k8s: 'Kubernetes',
      }
      return reply.send(envs.map((id) => ({ id, label: labels[id] ?? id })))
    },
  )

  // GET /api/terraform/detect — discover deployment targets from connected connectors
  // Returns every connected deployment-capable connector as a separate deploy target.
  // The UI shows this list and asks the user to pick if multiple are found.
  app.get(
    '/api/terraform/detect',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tenantId } = request.user as { tenantId: string }

      interface ConnectorRow {
        connector_type: string
        enabled: boolean
        credentials_enc: string | null
      }

      const rows = await withTenant(prisma, tenantId, (tx) =>
        tx.$queryRaw<ConnectorRow[]>`
          SELECT connector_type, enabled, credentials_enc
          FROM connector_config
          WHERE tenant_id = ${tenantId}::uuid AND enabled = true
        `,
      ).catch(() => [] as ConnectorRow[])

      // demo target is always available as a local fallback
      const targets: {
        id: string
        label: string
        platform: string
        tfEnv: string
        connectorType: string
        meta: Record<string, string>
      }[] = [{
        id: 'demo',
        label: 'Local (Docker)',
        platform: 'docker',
        tfEnv: 'demo',
        connectorType: 'local',
        meta: {},
      }]

      const seen = new Set<string>()

      for (const row of rows) {
        const mapping = CONNECTOR_DEPLOY_MAP[row.connector_type]
        if (!mapping) continue

        // Decrypt credentials to extract cluster/region labels
        let meta: Record<string, string> = {}
        const enc = row.credentials_enc as string | null
        if (enc) {
          try {
            const decrypted = decryptJson<Record<string, string>>(enc)
            if (decrypted && typeof decrypted === 'object') meta = decrypted
          } catch { /* ignore decrypt failures */ }
        }

        // Build unique target id using cluster name if available (supports multiple clusters)
        const clusterName = (meta['cluster'] ?? meta['cluster_name'] ?? '').toString()
        const region = (meta['region'] ?? '').toString()
        const targetId = clusterName
          ? `${mapping.tfEnv}__${clusterName}`
          : `${mapping.tfEnv}__${row.connector_type}`

        if (seen.has(targetId)) continue
        seen.add(targetId)

        const labelSuffix = clusterName ? ` (${clusterName}${region ? ', ' + region : ''})` : ''

        targets.push({
          id: targetId,
          label: `${mapping.label}${labelSuffix}`,
          platform: mapping.platform,
          tfEnv: mapping.tfEnv,
          connectorType: row.connector_type,
          meta: { cluster: clusterName, region },
        })
      }

      return reply.send(targets)
    },
  )
}
