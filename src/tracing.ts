/**
 * tracing.ts — OpenTelemetry setup for MCP call instrumentation (LIN-589).
 *
 * Activates when OTEL_EXPORTER_OTLP_ENDPOINT is set. Otherwise no-op.
 * Must be imported BEFORE any other module in index.ts.
 *
 * Usage: just `import './tracing.js'` as first line in index.ts.
 * Spans are created in mcp-caller.ts via the OTel API.
 */
import { trace, SpanStatusCode, type Tracer, type Span } from '@opentelemetry/api'

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'widgetdc-orchestrator'

// ─── Conditional SDK setup ─────────────────────────────────────────────────

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
if (endpoint) {
  // Dynamic imports to avoid loading SDK when not needed
  Promise.all([
    import('@opentelemetry/sdk-trace-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/semantic-conventions'),
  ]).then(([{ NodeTracerProvider, BatchSpanProcessor }, { OTLPTraceExporter }, { Resource }, semconv]) => {
    const ATTR_SERVICE_NAME = semconv.ATTR_SERVICE_NAME ?? 'service.name'
    const provider = new NodeTracerProvider({
      resource: new Resource({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    })

    provider.addSpanProcessor(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))
    )
    provider.register()

    console.log(`📡 OTel tracing active → ${endpoint}`)
  }).catch(err => {
    console.warn(`⚠️ OTel setup failed (non-fatal): ${err}`)
  })
}

// ─── Public tracer + helpers ───────────────────────────────────────────────

export const mcpTracer: Tracer = trace.getTracer('mcp-caller', '1.0.0')

/**
 * Wrap an async operation in an OTel span.
 * When no SDK is registered, this is a zero-cost no-op.
 */
export async function withMcpSpan<T>(
  toolName: string,
  callId: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return mcpTracer.startActiveSpan(`mcp.${toolName}`, async (span) => {
    span.setAttribute('mcp.tool', toolName)
    span.setAttribute('mcp.call_id', callId)

    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      span.end()
    }
  })
}
