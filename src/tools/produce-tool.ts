/**
 * produce-tool.ts — `produce_document` MCP tool executor.
 *
 * Thin wrapper that calls the orchestrator's own /api/produce gateway
 * (same host, in-process). Exists as its own module so the chat / MCP
 * client surface stays decoupled from the HTTP route module.
 *
 * Wire format:  snake_case, matches @widgetdc/contracts@0.5.0 ProduceRequest.
 * Auth:         Bearer ${ORCHESTRATOR_API_KEY} (scope mrp:produce).
 * Output:       JSON string with order_id, plan_id, profile_id,
 *               artifact_base64, mime, cached, and a human-readable summary.
 *
 * Pattern mirrors apps/office-addin/src/backend/produceClient.ts (W7) but
 * speaks directly to the local orchestrator, not over the internet.
 */
import { config } from '../config.js'
import { logger } from '../logger.js'

interface DocumentSection {
  heading: string
  body: string
}

/**
 * Split a free-form brief into DocumentBom sections using very simple
 * heuristics. Mirrors apps/office-addin/src/backend/briefToSections.ts
 * but inline to avoid a cross-repo import.
 *
 * Priority:
 *  1. If the brief already has markdown headings ("## Something"), use those.
 *  2. Else split on blank-line paragraphs, one section per paragraph.
 *  3. Else fall back to a single untitled section.
 */
function briefToSections(brief: string): DocumentSection[] {
  const trimmed = brief.trim()
  if (!trimmed) return [{ heading: 'Overview', body: '' }]

  // Heading-driven split
  const headingRegex = /^#{1,6}\s+(.+)$/gm
  const matches = [...trimmed.matchAll(headingRegex)]
  if (matches.length >= 2) {
    const sections: DocumentSection[] = []
    for (let i = 0; i < matches.length; i++) {
      const heading = matches[i]![1]!.trim()
      const start = matches[i]!.index! + matches[i]![0].length
      const end = i + 1 < matches.length ? matches[i + 1]!.index! : trimmed.length
      const body = trimmed.slice(start, end).trim()
      sections.push({ heading, body })
    }
    return sections
  }

  // Paragraph-driven split
  const paragraphs = trimmed.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  if (paragraphs.length >= 2) {
    return paragraphs.map((body, idx) => ({
      heading: idx === 0 ? deriveHeading(body) : `Section ${idx + 1}`,
      body,
    }))
  }

  // Single section
  return [{ heading: deriveHeading(trimmed), body: trimmed }]
}

function deriveHeading(text: string): string {
  const firstLine = text.split('\n')[0]!.trim()
  if (firstLine.length <= 80) return firstLine
  return firstLine.slice(0, 77) + '...'
}

interface ProduceDocumentArgs {
  brief?: unknown
  product_type?: unknown
  format?: unknown
  title?: unknown
  language?: unknown
  compliance_tier?: unknown
  reasoning_depth?: unknown
  max_latency_ms?: unknown
  max_cost_usd?: unknown
  agent_id?: unknown
}

interface ProduceResponseBody {
  success?: boolean
  planId?: string
  profileId?: string
  order_id?: string
  order?: { order_id?: string }
  artifact?: {
    mime?: string
    path?: string
    bytes_base64?: string
    artifact_bytes?: string
  }
  cached?: boolean
  error?: { code?: string; message?: string; status_code?: number }
}

/**
 * Execute `produce_document` — forwards to local /api/produce.
 *
 * Returns a JSON string (the tool-executor contract is string-in / string-out).
 */
export async function executeProduceDocument(args: ProduceDocumentArgs): Promise<string> {
  // ── Validate inputs ─────────────────────────────────────────────────
  const brief = typeof args.brief === 'string' ? args.brief.trim() : ''
  if (!brief || brief.length < 20) {
    return JSON.stringify({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'brief is required (min 20 chars)' },
    })
  }

  const productType =
    typeof args.product_type === 'string' &&
    ['document', 'presentation', 'architecture', 'diagram', 'pdf', 'code'].includes(args.product_type)
      ? args.product_type
      : 'document'

  const format =
    typeof args.format === 'string' && ['docx', 'pdf', 'html', 'md'].includes(args.format)
      ? args.format
      : 'docx'

  const complianceTier =
    typeof args.compliance_tier === 'string' &&
    ['public', 'internal', 'legal', 'health'].includes(args.compliance_tier)
      ? args.compliance_tier
      : 'internal'

  const reasoningDepthRaw =
    typeof args.reasoning_depth === 'number' && Number.isInteger(args.reasoning_depth)
      ? args.reasoning_depth
      : 4
  const reasoningDepth = Math.max(1, Math.min(5, reasoningDepthRaw))

  // ── Build BOM ───────────────────────────────────────────────────────
  const sections = briefToSections(brief)
  const title =
    typeof args.title === 'string' && args.title.trim()
      ? args.title.trim()
      : sections[0]?.heading ?? brief.slice(0, 80)

  const bom =
    productType === 'document'
      ? {
          product_type: 'document',
          bom_version: '2.0',
          title,
          sections,
          format,
          citations: [] as string[],
          ...(typeof args.language === 'string' ? { language: args.language } : {}),
        }
      : {
          // Non-document product types take the brief verbatim — backend
          // composer is responsible for shaping.
          product_type: productType,
          bom_version: '2.0',
          title,
          brief,
        }

  const features = {
    task_type: 'compose' as const,
    compliance_tier: complianceTier,
    reasoning_depth: reasoningDepth,
    ...(typeof args.max_latency_ms === 'number' && args.max_latency_ms > 0
      ? { max_latency_ms: args.max_latency_ms }
      : {}),
    ...(typeof args.max_cost_usd === 'number' && args.max_cost_usd > 0
      ? { max_cost_usd: args.max_cost_usd }
      : {}),
    ...(typeof args.language === 'string' ? { language: args.language } : {}),
  }

  const payload = {
    product_type: productType,
    bom,
    _request_features: features,
    ...(typeof args.agent_id === 'string' ? { agent_id: args.agent_id } : {}),
  }

  // ── Call local /api/produce ─────────────────────────────────────────
  // Use the orchestrator's own port rather than the internet — this runs
  // inside the orchestrator process, so it's localhost + loopback.
  const port = config.port ?? 3000
  const url = `http://127.0.0.1:${port}/api/produce`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.orchestratorApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(170000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logger.warn({ status: response.status, body: text.slice(0, 200) }, 'produce_document: upstream !ok')
      return JSON.stringify({
        success: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: `produce gateway returned HTTP ${response.status}`,
          status_code: response.status,
        },
      })
    }

    const body = (await response.json()) as ProduceResponseBody

    if (!body.success) {
      return JSON.stringify({
        success: false,
        error: body.error ?? { code: 'PRODUCE_FAILED', message: 'produce returned success=false' },
      })
    }

    const orderId = body.order_id ?? body.order?.order_id
    const artifactBase64 = body.artifact?.bytes_base64 ?? body.artifact?.artifact_bytes
    const mime = body.artifact?.mime ?? mimeForFormat(format)
    const artifactPath = body.artifact?.path

    // Summary line is what the LLM will typically surface verbatim — keep it
    // tight and human-readable, with the download hint inline.
    const summary = [
      `Produced ${productType} "${title}" (${format}).`,
      orderId ? `order_id=${orderId}` : null,
      body.planId ? `plan_id=${body.planId}` : null,
      body.profileId ? `profile=${body.profileId}` : null,
      body.cached ? '(cached)' : null,
    ]
      .filter(Boolean)
      .join(' ')

    return JSON.stringify({
      success: true,
      summary,
      order_id: orderId,
      plan_id: body.planId,
      profile_id: body.profileId,
      cached: Boolean(body.cached),
      artifact: {
        mime,
        filename: `${sanitizeFilename(title)}.${format}`,
        base64: artifactBase64,
        path: artifactPath,
      },
    })
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'produce_document: fetch failed')
    return JSON.stringify({
      success: false,
      error: {
        code: 'UPSTREAM_UNREACHABLE',
        message: 'produce gateway unreachable',
        status_code: 502,
      },
    })
  }
}

function mimeForFormat(format: string): string {
  switch (format) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'pdf':
      return 'application/pdf'
    case 'html':
      return 'text/html'
    case 'md':
      return 'text/markdown'
    default:
      return 'application/octet-stream'
  }
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\-_\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'document'
}

// ── Exported for unit tests ────────────────────────────────────────────
export const __test__ = { briefToSections, mimeForFormat, sanitizeFilename }
