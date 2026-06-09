import type { ToolDefinition } from './provider.js'

export interface IConnectorAgent {
  readonly connectorType: string
  readonly tools: ConnectorTool[]
}

export interface ConnectorTool {
  definition: ToolDefinition
  execute(params: Record<string, unknown>, credentials: Record<string, unknown>): Promise<unknown>
  write: boolean
}
