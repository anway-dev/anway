import type { Episode, Fact } from '../interfaces/knowledge-graph.js'

export interface GraphitiClientConfig {
  baseUrl: string  // http://agent-service:8000
  tenantId: string
}

export class GraphitiClient {
  constructor(private readonly config: GraphitiClientConfig) {}

  async addEpisode(episode: Episode): Promise<void> {
    await fetch(`${this.config.baseUrl}/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': this.config.tenantId },
      body: JSON.stringify({
        name: episode.source,
        episode_body: episode.text,
        source_description: episode.source,
        reference_time: episode.timestamp.toISOString(),
      }),
    })
  }

  async getFacts(query: string, at?: Date): Promise<Fact[]> {
    const params = new URLSearchParams({ query, ...(at ? { at: at.toISOString() } : {}) })
    const resp = await fetch(`${this.config.baseUrl}/facts?${params}`, {
      headers: { 'X-Tenant-Id': this.config.tenantId },
    })
    return resp.json() as Promise<Fact[]>
  }
}
