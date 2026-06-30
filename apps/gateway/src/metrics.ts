import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from 'prom-client'

export const registry = new Registry()

export const httpRequestDuration = new Histogram({
  name: 'anway_gateway_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
})

export const httpRequestsTotal = new Counter({
  name: 'anway_gateway_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
})

export const activeConnections = new Gauge({
  name: 'anway_gateway_active_connections',
  help: 'Number of active connections',
  registers: [registry],
})

export const llmCallDuration = new Histogram({
  name: 'anway_llm_call_duration_seconds',
  help: 'LLM provider call duration in seconds',
  labelNames: ['provider', 'model'] as const,
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [registry],
})

export const gateDecisionsTotal = new Counter({
  name: 'anway_gate_decisions_total',
  help: 'Total gate decisions by outcome',
  labelNames: ['decision'] as const,
  registers: [registry],
})

export const connectorSyncLag = new Gauge({
  name: 'anway_connector_sync_lag_seconds',
  help: 'Seconds since last connector sync per connector type',
  labelNames: ['connector_type'] as const,
  registers: [registry],
})

let metricsInitialized = false

export function initMetrics(): void {
  if (metricsInitialized) return
  metricsInitialized = true
  collectDefaultMetrics({ register: registry, prefix: 'anway_gateway_' })
}

export async function getMetricsText(): Promise<string> {
  return registry.metrics()
}

export function getMetricsContentType(): string {
  return registry.contentType
}
