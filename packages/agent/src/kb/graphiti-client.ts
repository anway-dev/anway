import type { Episode, Fact } from '../interfaces/knowledge-graph.js'

export interface GraphitiClientConfig {
  baseUrl: string  // http://agent-service:8000
  tenantId: string
  /** Timeout for HTTP calls in ms (default: 5000) */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 5000

export class GraphitiClient {
  constructor(private readonly config: GraphitiClientConfig) {}

  async addEpisode(episode: Episode): Promise<void> {
    const resp = await fetch(`${this.config.baseUrl}/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': this.config.tenantId },
      body: JSON.stringify({
        name: episode.source,
        episode_body: episode.text,
        source_description: episode.source,
        reference_time: episode.timestamp.toISOString(),
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`graphiti addEpisode failed ${resp.status}: ${body}`)
    }
  }

  async getFacts(query: string, _tenantId?: string, at?: Date): Promise<Fact[]> {
    const params = new URLSearchParams({ query, ...(at ? { at: at.toISOString() } : {}) })
    const resp = await fetch(`${this.config.baseUrl}/facts?${params}`, {
      headers: { 'X-Tenant-Id': this.config.tenantId },
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT),
    })
    if (!resp.ok) return []
    try {
      return (await resp.json()) as Fact[]
    } catch {
      return []
    }
  }
}
