import type { ConnectorCreds } from '@anvay/types'
import type { IConnectorAgent, ConnectorTool } from '@anvay/agent'


const TOOLS: ConnectorTool[] = [
  { definition: { name: 'get_flags', description: 'List feature flags', parameters: { type: 'object', properties: { project: { type: 'string' }, env: { type: 'string' } }, required: ['project', 'env'] } }, execute: () => Promise.resolve({ flags: [{ key:'new-checkout',name:'New Checkout',enabled:true,targeting:true }] }), write: false },
  {
    definition: { name: 'toggle_flag', description: 'Toggle a feature flag', parameters: { type: 'object', properties: { project: { type: 'string' }, flagKey: { type: 'string' }, env: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['project', 'flagKey', 'env', 'enabled'] } },
    execute: async (params, creds) => {
      const apiKey = (creds as ConnectorCreds).apiKey
      if (!apiKey) throw new Error('LaunchDarkly API key not configured')
      const res = await fetch(`https://app.launchdarkly.com/api/v2/flags/${String(params.project)}/${String(params.flagKey)}`, {
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
