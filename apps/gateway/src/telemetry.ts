import { NodeSDK, resources } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'

const { Resource } = resources

let sdk: NodeSDK | null = null

export function startTelemetry(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return

  const exporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  })

  sdk = new NodeSDK({
    resource: new Resource({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'anvay-gateway',
      'service.version': process.env.APP_VERSION ?? '0.0.1',
    }),
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  })

  sdk.start()
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown()
    sdk = null
  }
}
