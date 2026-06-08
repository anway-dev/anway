import { describe, it, expect, vi } from 'vitest'

// Mock the MCP SDK before importing
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function (this: Record<string, unknown>) {
    this.connect = vi.fn().mockResolvedValue(undefined)
    this.listTools = vi.fn().mockResolvedValue({
      tools: [
        { name: 'create_issue', description: 'Create a Linear issue', inputSchema: { type: 'object' } },
        { name: 'search_issues', description: 'Search issues', inputSchema: {} },
      ],
    })
    this.callTool = vi.fn().mockResolvedValue({ content: 'done' })
    return this
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}))

import { McpConnector } from './connector.js'

describe('McpConnector', () => {
  it('getTools() maps MCP tools to ExecutableTool[]', async () => {
    const c = new McpConnector({ url: 'http://localhost:8000', name: 'linear' })
    const tools = await c.getTools()
    expect(tools).toHaveLength(2)
    expect(tools[0]?.name).toBe('linear.create_issue')
    expect(tools[0]?.description).toBe('Create a Linear issue')
    expect(tools[1]?.name).toBe('linear.search_issues')
  })

  it('run() calls MCP tools/call via SDK', async () => {
    const c = new McpConnector({ url: 'http://localhost:8000', name: 'linear' })
    const tools = await c.getTools()
    const result = await tools[0]!.run({ title: 'Test' })
    expect(result).toBeDefined()
    expect((result as Record<string, unknown>).source).toBe('mcp:linear')
  })
})
