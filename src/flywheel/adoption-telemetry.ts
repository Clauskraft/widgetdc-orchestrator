/**
 * adoption-telemetry.ts — Runtime tool-usage telemetry for the MCP tool platform.
 *
 * Tracks which of the 32 canonical tools are actually called, how often, and
 * when they were last used. All state lives in Redis (no Neo4j writes here).
 *
 * Redis keys:
 *   orchestrator:telemetry:calls        ZSET  tool_name → lifetime call count
 *   orchestrator:telemetry:window:YYYYWW ZSET  tool_name → weekly call count (30d TTL)
 *   orchestrator:telemetry:last_called  HASH  tool_name → ISO timestamp
 *
 * Hooks: call recordToolCall(name) right after a successful tool dispatch.
 * Endpoint: GET /api/adoption/telemetry  (mounted on adoptionRouter in adoption.ts)
 */
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { TOOL_REGISTRY } from '../tools/tool-registry.js'

// ─── Constants ───────────────────────────────────────────────────────────────

const KEY_CALLS    = 'orchestrator:telemetry:calls'
const KEY_LAST     = 'orchestrator:telemetry:last_called'
const WINDOW_TTL   = 30 * 24 * 3600          // 30-day rolling window expiry (seconds)
const STALE_MS     = 30 * 24 * 3600 * 1000   // 30 days in ms

/** ISO 8601 week string YYYYWW — changes every Monday, correctly handles year boundaries */
function isoWeek(): string {
  const now = new Date()
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const dayNum = d.getUTCDay() || 7 // Sunday → 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum) // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}${String(week).padStart(2, '0')}`
}

/** Set of intelligence-namespace tool names (advanced utilisation metric) */
const ADVANCED_TOOLS = new Set(
  TOOL_REGISTRY.filter(t => t.namespace === 'intelligence').map(t => t.name)
)

// ─── recordToolCall — call site hook ────────────────────────────────────────

// Bulletproof W4: Throttled error logging (max 1 warning per 5 min per tool)
const lastErrorLog = new Map<string, number>()
const ERROR_THROTTLE_MS = 5 * 60 * 1000

/**
 * Increment call counters for a tool.  Fire-and-forget (errors are logged,
 * never thrown — the tool call itself has already succeeded by this point).
 */
export function recordToolCall(toolName: string): void {
  const redis = getRedis()
  if (!redis) return

  const windowKey = `orchestrator:telemetry:window:${isoWeek()}`
  const now = new Date().toISOString()

  redis.pipeline()
    .zincrby(KEY_CALLS, 1, toolName)
    .zincrby(windowKey, 1, toolName)
    .expire(windowKey, WINDOW_TTL)
    .hset(KEY_LAST, toolName, now)
    .exec()
    .catch((err: unknown) => {
      // Throttle: log each tool's error at most once per 5 min
      const nowMs = Date.now()
      const last = lastErrorLog.get(toolName) ?? 0
      if (nowMs - last > ERROR_THROTTLE_MS) {
        lastErrorLog.set(toolName, nowMs)
        logger.warn({ err: String(err), tool: toolName }, 'telemetry: Redis write failed (throttled)')
      }
    })
}

// ─── computeTelemetry — KPI calculation ─────────────────────────────────────

export interface ToolTelemetry {
  tool: string
  namespace: string
  lifetime_calls: number
  weekly_calls: number
  last_called: string | null
  stale: boolean     // not called in 30 days
  advanced: boolean  // intelligence-namespace tool
}

export interface TelemetrySummary {
  generated_at: string
  total_tools: number
  tools_called_ever: number
  tools_called_this_week: number
  zero_call_tools: string[]
  stale_tools: string[]            // called before, but not in 30 days
  hot_tools: Array<{ tool: string; calls: number }>  // top 5 by lifetime calls
  kpis: {
    utilisation_rate_pct: number        // % of tools called at least once this week
    advanced_utilisation_pct: number    // % of intelligence tools called this week
    zero_call_rate_pct: number          // % never called
    stale_rate_pct: number              // % called but dormant 30 days
  }
  tools: ToolTelemetry[]
}

export async function computeTelemetry(): Promise<TelemetrySummary> {
  const redis = getRedis()
  const allTools = TOOL_REGISTRY.map(t => t.name)
  const now = Date.now()

  // Defaults when Redis is unavailable
  const empty = (tool: string): ToolTelemetry => ({
    tool,
    namespace: TOOL_REGISTRY.find(t => t.name === tool)?.namespace ?? 'unknown',
    lifetime_calls: 0, weekly_calls: 0, last_called: null,
    stale: false, advanced: ADVANCED_TOOLS.has(tool),
  })

  if (!redis) {
    const tools = allTools.map(empty)
    return buildSummary(tools)
  }

  // Fetch lifetime counts + last-called timestamps in one pipeline
  const windowKey = `orchestrator:telemetry:window:${isoWeek()}`
  const [lifetimeRaw, weeklyRaw, lastRaw] = await Promise.all([
    redis.zrange(KEY_CALLS, 0, -1, 'WITHSCORES'),
    redis.zrange(windowKey, 0, -1, 'WITHSCORES'),
    redis.hgetall(KEY_LAST),
  ])

  // Parse sorted-set WITHSCORES output: [name, score, name, score, ...]
  const parseZSet = (raw: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (let i = 0; i < raw.length - 1; i += 2) {
      m.set(raw[i]!, parseInt(raw[i + 1]!, 10) || 0)
    }
    return m
  }

  const lifetimeCounts = parseZSet(lifetimeRaw)
  const weeklyCounts   = parseZSet(weeklyRaw)
  const lastCalled     = lastRaw ?? {}

  const tools: ToolTelemetry[] = allTools.map(name => {
    const ns   = TOOL_REGISTRY.find(t => t.name === name)?.namespace ?? 'unknown'
    const lc   = lastCalled[name] ?? null
    const life = lifetimeCounts.get(name) ?? 0
    const stale = life > 0 && lc !== null && (now - new Date(lc).getTime()) > STALE_MS
    return {
      tool: name, namespace: ns,
      lifetime_calls: life,
      weekly_calls: weeklyCounts.get(name) ?? 0,
      last_called: lc,
      stale,
      advanced: ADVANCED_TOOLS.has(name),
    }
  })

  return buildSummary(tools)
}

function buildSummary(tools: ToolTelemetry[]): TelemetrySummary {
  const total       = tools.length
  const calledEver  = tools.filter(t => t.lifetime_calls > 0)
  const calledWeek  = tools.filter(t => t.weekly_calls  > 0)
  const zeroCalls   = tools.filter(t => t.lifetime_calls === 0).map(t => t.tool)
  const stale       = tools.filter(t => t.stale).map(t => t.tool)
  const hotTools    = [...tools].sort((a, b) => b.lifetime_calls - a.lifetime_calls)
                        .slice(0, 5).map(t => ({ tool: t.tool, calls: t.lifetime_calls }))

  const advancedTools = tools.filter(t => t.advanced)
  const advancedUsed  = advancedTools.filter(t => t.weekly_calls > 0)

  return {
    generated_at: new Date().toISOString(),
    total_tools: total,
    tools_called_ever: calledEver.length,
    tools_called_this_week: calledWeek.length,
    zero_call_tools: zeroCalls,
    stale_tools: stale,
    hot_tools: hotTools,
    kpis: {
      utilisation_rate_pct:      pct(calledWeek.length,   total),
      advanced_utilisation_pct:  pct(advancedUsed.length, advancedTools.length),
      zero_call_rate_pct:        pct(zeroCalls.length,    total),
      stale_rate_pct:            pct(stale.length,        total),
    },
    tools,
  }
}

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10
}

// ─── Adoption Gap Detector (topic 8/15) ──────────────────────────────────────
// Surfaces high-value tools that are underused, with specific remediation hints.

export type GapType = 'zero-call' | 'stale' | 'low-frequency'

export interface AdoptionGap {
  tool: string
  namespace: string
  gap_type: GapType
  priority: 'high' | 'medium' | 'low'
  suggestion: string
  last_called: string | null
  lifetime_calls: number
}

/** Tool-specific onboarding suggestions keyed by namespace prefix */
const NAMESPACE_SUGGESTIONS: Record<string, string> = {
  intelligence: 'Wire into the intelligence-loop cron chain — high-signal tools benefit from scheduled activation',
  knowledge:    'Emit a KnowledgeBus event after each session fold to trigger this tool organically',
  graph:        'Add to graph-steward agent capabilities; graph tools thrive on regular reconciliation calls',
  cognitive:    'Include in the reason_deeply fallback path so it activates on complex queries',
  swarm:        'Hook into peer-eval.hookIntoExecution so pheromone/eval tools fire on every chain step',
  llm:          'Add as a cost-governance step in chain-engine.ts to surface cost data automatically',
  default:      'Register in agent-seeds.ts capabilities list so agents can discover and call this tool',
}

function suggestionFor(tool: string, namespace: string): string {
  for (const [prefix, hint] of Object.entries(NAMESPACE_SUGGESTIONS)) {
    if (prefix !== 'default' && (namespace.startsWith(prefix) || tool.startsWith(prefix))) return hint
  }
  return NAMESPACE_SUGGESTIONS.default!
}

function priorityFor(t: ToolTelemetry): AdoptionGap['priority'] {
  if (t.advanced) return 'high'
  if (t.namespace === 'intelligence') return 'high'
  if (t.lifetime_calls === 0) return 'medium'
  return 'low'
}

/**
 * Identify tools with an adoption gap — zero calls, stale, or low-frequency
 * relative to platform average — sorted by priority then namespace.
 *
 * Uses the last computed telemetry snapshot; pass a pre-fetched summary to
 * avoid a redundant Redis round-trip when called right after computeTelemetry().
 */
export async function detectAdoptionGaps(
  summary?: TelemetrySummary,
): Promise<AdoptionGap[]> {
  const s = summary ?? await computeTelemetry()
  const avgWeekly = s.tools.reduce((acc, t) => acc + t.weekly_calls, 0) / (s.total_tools || 1)
  const lowThreshold = Math.max(1, avgWeekly * 0.2) // bottom 20% of average

  const gaps: AdoptionGap[] = []

  for (const t of s.tools) {
    let gap_type: GapType | null = null

    if (t.lifetime_calls === 0) {
      gap_type = 'zero-call'
    } else if (t.stale) {
      gap_type = 'stale'
    } else if (t.weekly_calls < lowThreshold && (t.advanced || t.namespace === 'intelligence')) {
      gap_type = 'low-frequency'
    }

    if (!gap_type) continue

    gaps.push({
      tool: t.tool,
      namespace: t.namespace,
      gap_type,
      priority: priorityFor(t),
      suggestion: suggestionFor(t.tool, t.namespace),
      last_called: t.last_called,
      lifetime_calls: t.lifetime_calls,
    })
  }

  // Sort: high priority first, then zero-call before stale before low-frequency
  const ORDER: Record<string, number> = { 'zero-call': 0, stale: 1, 'low-frequency': 2 }
  const PRIO:  Record<string, number> = { high: 0, medium: 1, low: 2 }
  gaps.sort((a, b) =>
    PRIO[a.priority]! - PRIO[b.priority]! ||
    ORDER[a.gap_type]! - ORDER[b.gap_type]!
  )

  return gaps
}
