import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ExecutableTool } from '@anvay/agent'

/**
 * Generic MCP connector — connects to any MCP server and auto-registers
 * its tools as Anvay ExecutableTool[].
 *
 * Uses official MCP SDK with JSON-RPC 2.0 transport (not raw REST).
 *
 * Usage:
 *   const adapter = new McpConnector({ url: 'http://mcp.linear.app', name: 'linear' })
 *   const tools = await adapter.getTools()
 *   await adapter.call('create_issue', { title: 'Fix bug' })
 */
export class McpConnector {
  private client: Client | null = null
  private toolsCache: ExecutableTool[] | null = null

  constructor(
    private readonly config: {
      url: string
      name: string
      timeoutMs?: number
    },
  ) {}

  private async getClient(): Promise<Client> {
    if (this.client) return this.client
    this.client = new Client({ name: 'anvay-mcp-adapter', version: '0.1.0' })
    const transport = new StreamableHTTPClientTransport(new URL(this.config.url))
    await this.client.connect(transport)
    return this.client
  }

  /**
   * Calls MCP tools/list and maps each result to an ExecutableTool.
   * Cached after first call — clear by calling again.
   */
  async getTools(): Promise<ExecutableTool[]> {
    if (this.toolsCache) return this.toolsCache

    const client = await this.getClient()
    const result = await client.listTools()
    const cfg = this.config

    this.toolsCache = result.tools.map((t) => {
      const toolName = `${cfg.name}.${t.name}`
      return {
        name: toolName,
        description: t.description ?? '',
        parameters: (t.inputSchema as Record<string, unknown>) ?? {},
        async run(args: Record<string, unknown>) {
          const callResult = await client.callTool({
            name: t.name,
            arguments: args,
          })
          return {
            source: `mcp:${cfg.name}`,
            fetched_at: new Date(),
            ttl: 60,
            freshness_score: 1.0,
            data: callResult.content ?? callResult,
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

  /** Health check — attempts to connect and list tools. */
  async health(): Promise<{ status: string; lastChecked: Date }> {
    try {
      const client = await this.getClient()
      await client.listTools()
      return { status: 'healthy', lastChecked: new Date() }
    } catch {
      return { status: 'unhealthy', lastChecked: new Date() }
    }
  }
}
