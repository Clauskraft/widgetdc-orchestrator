/**
 * canvas-builder-tool.ts — `canvas_builder` MCP tool executor.
 *
 * UC4 of the delegated-chasing-minsky plan: sibling of `produce_document`.
 * Resolves a free-form chat brief to a canvas session and returns an
 * embed URL that host surfaces (Open WebUI, LibreChat, Office add-ins)
 * iframe into the chat transcript.
 *
 * Wire format:  snake_case, matches @widgetdc/contracts CanvasIntent /
 *               CanvasResolution.
 * Upstream:     POST {backendUrl}/api/mrp/canvas/resolve
 *               Authorization: Bearer ${BACKEND_API_KEY}
 * Fallback:     On 404 (backend UC5 not yet deployed) or unreachable upstream,
 *               synthesize a deterministic stub CanvasResolution so chat
 *               surfaces can still exercise the contract. Same loopback
 *               fallback philosophy as produce-tool.ts.
 */
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { logger } from '../logger.js'

// ── Types (mirror @widgetdc/contracts@>=0.5.0) ─────────────────────────
export type BuilderTrack =
  | 'textual'
  | 'slide_flow'
  | 'diagram'
  | 'architecture'
  | 'graphical'
  | 'code'
  | 'experiment'

export type PaneId = 'canvas' | 'markdown' | 'slides' | 'drawio' | 'split'

export type ComplianceTier = 'public' | 'internal' | 'legal' | 'health'

export interface CanvasIntent {
  user_text: string
  surface_hint?: 'pane' | 'full' | 'overlay'
  sequence_step?: number
  prior_track?: BuilderTrack
  compliance_tier?: ComplianceTier
  host_origin?: string
  agent_id?: string
}

export interface CanvasResolution {
  track: BuilderTrack
  initial_pane: PaneId
  canvas_session_id: string
  embed_url: string
  pre_seeded_nodes?: Array<Record<string, unknown>>
  rationale: string[]
  fold_strategy?: string
  bom_version: '2.0'
  resolved_at: string
}

interface CanvasBuilderArgs {
  brief?: unknown
  surface_hint?: unknown
  sequence_step?: unknown
  prior_track?: unknown
  compliance_tier?: unknown
  host_origin?: unknown
  agent_id?: unknown
}

const VALID_TRACKS: BuilderTrack[] = [
  'textual',
  'slide_flow',
  'diagram',
  'architecture',
  'graphical',
  'code',
  'experiment',
]

const VALID_TIERS: ComplianceTier[] = ['public', 'internal', 'legal', 'health']

// ── Pure helpers (exported for unit tests) ─────────────────────────────

/**
 * Build a validated CanvasIntent from raw tool arguments. Unknown/invalid
 * enum values are dropped silently so the configurator can apply defaults.
 */
export function buildIntentFromArgs(args: CanvasBuilderArgs): CanvasIntent {
  const userText = typeof args.brief === 'string' ? args.brief.trim() : ''
  const intent: CanvasIntent = {
    user_text: userText,
  }

  if (
    typeof args.surface_hint === 'string' &&
    (args.surface_hint === 'pane' || args.surface_hint === 'full' || args.surface_hint === 'overlay')
  ) {
    intent.surface_hint = args.surface_hint
  }

  if (
    typeof args.sequence_step === 'number' &&
    Number.isInteger(args.sequence_step) &&
    args.sequence_step >= 0
  ) {
    intent.sequence_step = args.sequence_step
  }

  if (typeof args.prior_track === 'string' && VALID_TRACKS.includes(args.prior_track as BuilderTrack)) {
    intent.prior_track = args.prior_track as BuilderTrack
  }

  if (
    typeof args.compliance_tier === 'string' &&
    VALID_TIERS.includes(args.compliance_tier as ComplianceTier)
  ) {
    intent.compliance_tier = args.compliance_tier as ComplianceTier
  }

  if (typeof args.host_origin === 'string' && args.host_origin.trim()) {
    intent.host_origin = args.host_origin.trim()
  }

  if (typeof args.agent_id === 'string' && args.agent_id.trim()) {
    intent.agent_id = args.agent_id.trim()
  }

  return intent
}

/**
 * Derive the widgetdc-canvas embed URL for a given track + session.
 * Keeps the mapping in one place so host surfaces and unit tests can
 * reference the same canonical URL shape.
 */
export function deriveEmbedUrl(track: BuilderTrack, sessionId: string): string {
  const base = 'https://widgetdc-canvas.up.railway.app'
  const paneForTrack: Record<BuilderTrack, string> = {
    textual: 'markdown',
    slide_flow: 'slides',
    diagram: 'drawio',
    architecture: 'canvas',
    graphical: 'canvas',
    code: 'split',
    experiment: 'split',
  }
  const pane = paneForTrack[track]
  return `${base}/?session=${encodeURIComponent(sessionId)}&track=${encodeURIComponent(track)}&pane=${encodeURIComponent(pane)}`
}

/**
 * Cheap heuristic track selector used only by the stub fallback. The real
 * ranking lives in backend CanvasIntentConfigurator; this is intentionally
 * dumb so tests can pin deterministic output.
 */
export function pickTrackFromBrief(brief: string, priorTrack?: BuilderTrack): BuilderTrack {
  if (priorTrack && VALID_TRACKS.includes(priorTrack)) return priorTrack
  const s = brief.toLowerCase()
  if (/slide|deck|presentation|pptx/.test(s)) return 'slide_flow'
  if (/diagram|flowchart|drawio|bpmn|sequence/.test(s)) return 'diagram'
  if (/architecture|system design|c4|pattern/.test(s)) return 'architecture'
  if (/graph|mind\s?map|react.?flow|canvas/.test(s)) return 'graphical'
  if (/code|refactor|function|typescript|python/.test(s)) return 'code'
  if (/experiment|hypothesis|a\/?b test|inventor/.test(s)) return 'experiment'
  return 'textual'
}

function paneForTrack(track: BuilderTrack): PaneId {
  switch (track) {
    case 'textual': return 'markdown'
    case 'slide_flow': return 'slides'
    case 'diagram': return 'drawio'
    case 'architecture': return 'canvas'
    case 'graphical': return 'canvas'
    case 'code': return 'split'
    case 'experiment': return 'split'
  }
}

/**
 * Produce a deterministic stub CanvasResolution used when the backend
 * CanvasIntentConfigurator endpoint is not yet deployed (404) or
 * unreachable (timeout / connection-refused).
 */
export function synthesizeStubResolution(intent: CanvasIntent, reason: string): CanvasResolution {
  const track = pickTrackFromBrief(intent.user_text, intent.prior_track)
  const sessionId = randomUUID()
  const initialPane = paneForTrack(track)
  const rationale = [
    `stub:${reason}`,
    intent.prior_track ? `sticky_prior_track:${intent.prior_track}` : `heuristic_track:${track}`,
    intent.sequence_step && intent.sequence_step > 0 ? `sequence_step:${intent.sequence_step}` : 'sequence_step:0',
  ]
  return {
    track,
    initial_pane: initialPane,
    canvas_session_id: sessionId,
    embed_url: deriveEmbedUrl(track, sessionId),
    rationale,
    bom_version: '2.0',
    resolved_at: new Date().toISOString(),
  }
}

// ── Tool executor ──────────────────────────────────────────────────────

export async function executeCanvasBuilder(args: CanvasBuilderArgs): Promise<string> {
  const intent = buildIntentFromArgs(args)

  if (!intent.user_text) {
    return JSON.stringify({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'brief is required (min 1 char)' },
    })
  }

  const url = `${config.backendUrl}/api/mrp/canvas/resolve`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify(intent),
      signal: AbortSignal.timeout(110000),
    })

    if (response.status === 404) {
      // UC5 backend endpoint not yet deployed — stub so contract still exercisable.
      logger.warn({ url }, 'canvas_builder: backend 404, using stub resolution')
      const stub = synthesizeStubResolution(intent, 'backend_404')
      return JSON.stringify({ success: true, stub: true, resolution: stub })
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logger.warn({ status: response.status, body: text.slice(0, 200) }, 'canvas_builder: upstream !ok')
      return JSON.stringify({
        success: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: `canvas resolver returned HTTP ${response.status}`,
          status_code: response.status,
        },
      })
    }

    const body = (await response.json()) as Partial<CanvasResolution> & { error?: unknown }

    if (!body.canvas_session_id || !body.track || !body.embed_url) {
      logger.warn({ body }, 'canvas_builder: upstream body missing required fields, falling back to stub')
      const stub = synthesizeStubResolution(intent, 'upstream_body_incomplete')
      return JSON.stringify({ success: true, stub: true, resolution: stub })
    }

    return JSON.stringify({
      success: true,
      stub: false,
      resolution: body,
      summary: [
        `Resolved canvas session ${body.canvas_session_id.slice(0, 8)} (${body.track}).`,
        `Initial pane: ${body.initial_pane}.`,
        `Embed: ${body.embed_url}`,
      ].join(' '),
    })
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'canvas_builder: fetch failed, using stub',
    )
    const stub = synthesizeStubResolution(intent, 'upstream_unreachable')
    return JSON.stringify({ success: true, stub: true, resolution: stub })
  }
}

// ── Exported for unit tests ────────────────────────────────────────────
export const __test__ = {
  buildIntentFromArgs,
  deriveEmbedUrl,
  pickTrackFromBrief,
  synthesizeStubResolution,
  VALID_TRACKS,
}
