import type { ConnectorCreds } from '@anway/types'
import type { IConnectorAgent, ConnectorTool } from '@anway/agent'


interface LDEnvState { on?: boolean; targets?: unknown[]; rules?: unknown[] }
interface LDFlag { key: string; name?: string; environments?: Record<string, LDEnvState> }

// creds.baseUrl override — bootstrap.ts already respects this (defaults to
// https://app.launchdarkly.com); these tools previously hardcoded that URL
// unconditionally, so no fixture-server test or self-hosted LD-compatible
// endpoint could ever reach these calls.
function ldBase(creds: Record<string, unknown>): string {
  return (creds['baseUrl'] as string | undefined) || 'https://app.launchdarkly.com'
}

const TOOLS: ConnectorTool[] = [
  {
    // Hardcoded fake data previously — confirmed live via independent review
    // this is the only tool the orchestrator sees for this connector
    // (write:true tools are filtered out of chat in V1). Real LaunchDarkly
    // API v2.
    definition: { name: 'get_flags', description: 'List feature flags', parameters: { type: 'object', properties: { project: { type: 'string' }, env: { type: 'string' } }, required: ['project', 'env'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('LaunchDarkly API key not configured')
      const env = String(params.env)
      const res = await fetch(`${ldBase(creds)}/api/v2/flags/${String(params.project)}?env=${encodeURIComponent(env)}`, {
        headers: { Authorization: String(apiKey) },
      })
      if (!res.ok) throw new Error(`LaunchDarkly get_flags failed: HTTP ${res.status}`)
      const json = await res.json() as { items?: LDFlag[] }
      return {
        flags: (json.items ?? []).map(f => {
          const envState = f.environments?.[env]
          const hasTargeting = Boolean((envState?.targets?.length ?? 0) > 0 || (envState?.rules?.length ?? 0) > 0)
          return { key: f.key, name: f.name ?? f.key, enabled: envState?.on ?? false, targeting: hasTargeting }
        }),
      }
    },
    write: false,
  },
  {
    definition: { name: 'toggle_flag', description: 'Toggle a feature flag', parameters: { type: 'object', properties: { project: { type: 'string' }, flagKey: { type: 'string' }, env: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['project', 'flagKey', 'env', 'enabled'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('LaunchDarkly API key not configured')
      const res = await fetch(`${ldBase(creds)}/api/v2/flags/${String(params.project)}/${String(params.flagKey)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json; domain-model=launchdarkly.semanticpatch',
          Authorization: apiKey,
        },
        body: JSON.stringify({
          environmentKey: String(params.env),
          instructions: [{ kind: params.enabled ? 'turnFlagOn' : 'turnFlagOff' }],
        }),
      })
      if (!res.ok) throw new Error(`LaunchDarkly toggle_flag failed: HTTP ${res.status}`)
      return { ok: true }
    },
    write: true,
  },
]

export class LaunchdarklyAgent implements IConnectorAgent {
  readonly connectorType = 'launchdarkly'
  readonly tools = TOOLS
}
