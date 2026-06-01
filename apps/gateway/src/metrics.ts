import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from 'prom-client'

export const registry = new Registry()

export const httpRequestDuration = new Histogram({
  name: 'anvay_gateway_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
})

export const httpRequestsTotal = new Counter({
  name: 'anvay_gateway_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
})

export const activeConnections = new Gauge({
  name: 'anvay_gateway_active_connections',
  help: 'Number of active connections',
  registers: [registry],
})

let metricsInitialized = false

export function initMetrics(): void {
  if (metricsInitialized) return
  metricsInitialized = true
  collectDefaultMetrics({ register: registry, prefix: 'anvay_gateway_' })
}

export async function getMetricsText(): Promise<string> {
  return registry.metrics()
}

export function getMetricsContentType(): string {
  return registry.contentType
}
