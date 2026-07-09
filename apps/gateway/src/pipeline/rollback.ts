// Real pipeline rollback execution — helm's native `helm rollback`.
//
// Confirmed via independent review: approving a pipeline_rollback gate
// previously executed NOTHING — decide-gate.ts returned "automatic
// execution is not implemented — re-deploy manually" after recording the
// approval. An approval flow for an action that can't execute teaches
// users the confirm button is decorative. The deploy stage is a helm
// release (pipeline.ts's `helm upgrade --install`), and helm keeps full
// revision history — `helm rollback <release> -n <ns>` (no revision =
// previous) is the real, native rollback for exactly this deploy path, no
// state reconstruction needed (the prior attempt piped a terraform state
// blob to a flag that takes a file path — removed as unfixable theater).

import { spawn } from 'node:child_process'
import { prisma } from '../db/client.js'
import { withTenant } from '../db/prisma.js'
import { resolveKubeconfigPath } from '../routes/pipeline.js'
import { appendAuditEvent } from '../routes/audit.js'
import pino from 'pino'

const log = pino({ name: 'pipeline-rollback' })

function helm(args: string[], kubeconfig: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn('helm', args, { env: { ...process.env, KUBECONFIG: kubeconfig } })
    let output = ''
    const timer = setTimeout(() => proc.kill(), 5 * 60_000)
    proc.stdout.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { output += d.toString() })
    proc.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output }) })
    proc.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, output: String(err) }) })
  })
}

export async function executePipelineRollback(
  tenantId: string,
  pipelineId: string,
  approvedBy: string,
): Promise<{ ok: boolean; detail: string }> {
  // Namespace resolution mirrors the deploy stage: pipeline metadata wins,
  // else the staging default. (The rollback gate doesn't carry an env
  // marker; a prod pipeline's metadata.namespace is set by its own deploy.)
  const rows = await withTenant(prisma, tenantId, (tx) =>
    tx.$queryRaw<Array<{ metadata: Record<string, unknown> | null }>>`
      SELECT metadata FROM pipelines WHERE id = ${pipelineId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `
  ).catch(() => [] as Array<{ metadata: Record<string, unknown> | null }>)
  const meta = rows[0]?.metadata ?? {}
  const namespace = (meta['namespace'] as string | undefined)
    ?? process.env['HELM_NAMESPACE_STAGING'] ?? 'anway-staging'
  const release = process.env['HELM_RELEASE'] ?? 'anway'

  const { path: kubeconfig, cleanup } = await resolveKubeconfigPath(tenantId)
  try {
    // No explicit revision → helm rolls back to the previous one.
    const result = await helm(['rollback', release, '--namespace', namespace, '--wait', '--timeout', '5m'], kubeconfig)

    // Reflect the outcome on the pipeline's own rollback stage run so the
    // UI shows what actually happened, not just the approval.
    await withTenant(prisma, tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE pipeline_stage_runs
        SET status = ${result.ok ? 'done' : 'failed'}, finished_at = NOW(),
            output = ${JSON.stringify({ type: 'rollback', executed: true, ok: result.ok, output: result.output.slice(0, 4000) })}::jsonb
        WHERE pipeline_id = ${pipelineId}::uuid AND tenant_id = ${tenantId}::uuid
          AND stage_id = 'rollback' AND status = 'waiting'
      `
    ).catch(() => 0)

    await appendAuditEvent({
      tenantId,
      userId: approvedBy,
      action: 'pipeline.rollback',
      resource: `${release}@${namespace}`,
      outcome: result.ok ? 'action_executed' : 'action_failed',
      metadata: { pipelineId, output: result.output.slice(0, 1000) },
    }).catch(() => {})

    log.info({ tenantId, pipelineId, namespace, ok: result.ok }, 'helm rollback executed')
    return { ok: result.ok, detail: result.output.slice(0, 2000) }
  } finally {
    cleanup()
  }
}
