import type { ExecutableTool } from '@anvay/agent'

/**
 * Generic MCP connector — connects to any MCP server and auto-registers
 * its tools as Anvay ExecutableTool[].
 *
 * Usage:
 *   const adapter = new McpConnector({ url: 'http://mcp.linear.app', name: 'linear' })
 *   const tools = await adapter.getTools()
 *   await adapter.call('create_issue', { title: 'Fix bug' })
 */
export class McpConnector {
  private toolsCache: ExecutableTool[] | null = null

  constructor(
    private readonly config: {
      url: string
      name: string
      timeoutMs?: number
    },
  ) {}

  /**
   * Calls MCP tools/list and maps each result to an ExecutableTool.
   * Cached after first call — clear by calling again.
   */
  async getTools(): Promise<ExecutableTool[]> {
    if (this.toolsCache) return this.toolsCache

    const resp = await fetch(`${this.config.url}/tools/list`, {
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
    })
    if (!resp.ok) throw new Error(`MCP ${this.config.name} tools/list failed: ${resp.status}`)
    const body = (await resp.json()) as { tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] }

    const cfg = this.config
    this.toolsCache = body.tools.map((t) => {
      const toolName = `${cfg.name}.${t.name}`
      return {
        name: toolName,
        description: t.description ?? '',
        parameters: (t.inputSchema as Record<string, unknown>) ?? {},
        async run(args: Record<string, unknown>) {
          const result = await fetch(`${cfg.url}/tools/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: t.name, arguments: args }),
            signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
          })
          if (!result.ok) throw new Error(`MCP ${toolName} failed: ${result.status}`)
          const data = await result.json()
          return {
            source: `mcp:${cfg.name}`,
            fetched_at: new Date(),
            ttl: 60,
            freshness_score: 1.0,
            data,
          }
        },
      }
    })

    return this.toolsCache
  }

  /** Call a specific MCP tool by name. */
  async call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const tools = await this.getTools()
    const tool = tools.find((t) => t.name === `${this.config.name}.${toolName}`)
    if (!tool) throw new Error(`MCP tool "${toolName}" not found in ${this.config.name}`)
    return tool.run(args)
  }

  /** Health check — pings tools/list. */
  async health(): Promise<{ status: string; lastChecked: Date }> {
    try {
      await fetch(`${this.config.url}/tools/list`, {
        signal: AbortSignal.timeout(5000),
      })
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', lastChecked: new Date() }
    }
  }
}
