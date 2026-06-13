export type {
  IModelProvider,
  IEmbeddingProvider,
  ToolDefinition,
  ToolCall,
  InferenceOptions,
  ChatResponse,
  StreamChunk,
  ProviderConfig,
  ProviderType,
} from './interfaces/provider.js'

export type {
  ISessionMemory,
  ConversationTurn,
  SessionContext,
  SessionMeta,
  MemoryConfig,
} from './interfaces/memory.js'

export type { IAuditSink, AuditEvent, AuditEventType } from './interfaces/audit.js'

export type {
  UserPerimeter,
  ConnectorScope,
  ConnectorManifest,
  HardBlock,
} from './perimeter/engine.js'

export { AgentPerimeter } from './perimeter/engine.js'

export type { TokenBudget, ModelCallRequest, TokenHardBlock, TokenLimitType } from './middleware/token-meter.js'

export { ProviderFactory } from './providers/factory.js'
export { providerRegistry } from './providers/registry.js'
export type { ProviderManifest, ProviderField } from './interfaces/provider.js'
export { RedisSessionMemory } from './memory/redis-session.js'
export { MemoryFactory } from './memory/factory.js'
export { createPerimeterMiddleware } from './middleware/perimeter.js'
export type { PerimeterCtx } from './middleware/perimeter.js'
export { createTokenMeterMiddleware } from './middleware/token-meter.js'

// Orchestrator — no Mastra types exported
export type { OrchestratorConfig, Orchestrator, ExecutableTool } from './orchestrator.js'
export { createOrchestrator, runSession } from './orchestrator.js'

// Specialist agent
export type { SpecialistAgentConfig, SpecialistAgent } from './specialist-agent.js'
export { createSpecialistAgent } from './specialist-agent.js'

// Gate (L2 Approve — V1 trust principle)
export type { IGateSink, GateEvent, GateDecision } from './gate/gate.js'
export { isWriteAction, pollGate } from './gate/gate.js'
export { InMemoryGateSink } from './gate/in-memory-gate-sink.js'


// Knowledge Graph
export type { IKnowledgeGraph, AgentContext } from './interfaces/knowledge-graph.js'
export { StructuralGraph } from './kb/structural-graph.js'
export { HybridKnowledgeGraph } from './kb/hybrid-knowledge-graph.js'
export { GraphitiClient } from './kb/graphiti-client.js'
export type { GraphitiClientConfig } from './kb/graphiti-client.js'
export type { PgPoolLike } from './kb/postgres-query.js'
export { createPostgresQueryFn } from './kb/postgres-query.js'

// Graph Builder Agent
export type { GraphEvent } from './graph-builder/events.js'
export type { GraphBuilderLogger } from './graph-builder/builder.js'
export { GraphBuilderAgent } from './graph-builder/builder.js'
export type { IConnectorBootstrap, ConnectorBootstrapResult } from './graph-builder/bootstrap.js'
export type { IConnectorAgent, ConnectorTool } from './interfaces/connector-agent.js'

// NOTE: the connector conformance harness (C0) is intentionally NOT exported here.
// It imports `vitest` at module top-level; pulling it into the main barrel drags
// vitest into every production import of @anvay/agent and crashes the gateway at
// startup. Import it via the dedicated subpath instead: `@anvay/agent/testing`.

// Agents
export { SREAgent } from './agents/sre.js'
export type { IncidentContext, TimelineEvent } from './agents/sre.js'
export { ProductAgent } from './agents/product.js'
export type { PRD, UserStory } from './agents/product.js'
export { TechSpecAgent } from './agents/techspec.js'
export type { TechSpec, Component, APIChange } from './agents/techspec.js'
export { BootstrapAgent } from './agents/bootstrap.js'
export type { BootstrapPlan, FileToCreate } from './agents/bootstrap.js'
export { TestAgent } from './agents/test.js'
export type { TestPlan, TestFile } from './agents/test.js'
export { ReviewAgent } from './agents/review.js'
export type { ReviewFindings, Finding } from './agents/review.js'
export { DeployAgent } from './agents/deploy.js'
export type { DeployPlan } from './agents/deploy.js'
export { OncallAgent } from './agents/oncall.js'
export type { ShiftBrief, IncidentSummary } from './agents/oncall.js'
export { BAAgent } from './agents/ba.js'
export type { AnalysisReport, MetricPoint } from './agents/ba.js'

// Tools
export { createGetIncidentContextTool } from './tools/incident-context.js'

// Scheduler
export type { IScheduler, ScheduledJob } from './scheduler/scheduler.js'
