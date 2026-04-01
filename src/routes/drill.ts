/**
 * routes/drill.ts — Drill Stack Navigation (G4.15–G4.19)
 *
 * Hierarchical navigation: Domain → Segment → Framework → KPI → Trend → Recommendation
 * Redis-backed session state, Neo4j graph traversal, Obsidian MOC generation.
 */
import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { getRedis } from '../redis.js'
import { config } from '../config.js'
import { logger } from '../logger.js'

export const drillRouter = Router()

const DRILL_PREFIX = 'orchestrator:drill:'
const SESSION_TTL = 3600 // 1 hour

/* ─── Types (G4.15) ──────────────────────────────────────────────────────── */

interface DrillLevel {
  level: string
  id: string
  label: string
}

interface DrillContext {
  stack: DrillLevel[]
  current_level: string
  current_id: string
  current_label: string
  domain: string
}

interface DrillChild {
  id: string
  label: string
  type: string
  count?: number
}

/* ─── Neo4j helper ────────────────────────────────────────────────────────── */

const MCP_TIMEOUT_MS = 12000

interface McpResult {
  ok: boolean
  data?: unknown
  error?: string
}

async function callMcp(tool: string, payload: Record<string, unknown>): Promise<McpResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS)

  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({ tool, payload }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return { ok: false, error: `MCP ${tool} returned ${res.status}` }
    }

    const data = await res.json()
    return { ok: true, data }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `MCP ${tool} failed: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

function extractRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (Array.isArray(d.records)) return d.records as Record<string, unknown>[]
    if (Array.isArray(d.data)) return d.data as Record<string, unknown>[]
    if (Array.isArray(d.results)) return d.results as Record<string, unknown>[]
  }
  return []
}

/* ─── Level hierarchy ─────────────────────────────────────────────────────── */

const LEVEL_ORDER = ['domain', 'segment', 'framework', 'kpi', 'trend', 'recommendation'] as const

function nextLevel(current: string): string | null {
  const idx = LEVEL_ORDER.indexOf(current as typeof LEVEL_ORDER[number])
  return idx >= 0 && idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] : null
}

/**
 * Build the Cypher query to fetch children for a given level + node.
 * Uses parameterized queries only — never string interpolation.
 */
function childrenQuery(level: string, id: string): { query: string; params: Record<string, string> } | null {
  switch (level) {
    case 'domain':
      return {
        query: `MATCH (d:ConsultingDomain {name: $name})-[:HAS_SEGMENT]->(s) RETURN s.name AS label, elementId(s) AS id, 'segment' AS level`,
        params: { name: id },
      }
    case 'segment':
      return {
        query: `MATCH (s {name: $name})-[:HAS_FRAMEWORK]->(f:ConsultingFramework) RETURN f.name AS label, elementId(f) AS id, 'framework' AS level`,
        params: { name: id },
      }
    case 'framework':
      return {
        query: `MATCH (f:ConsultingFramework {name: $name})-[:HAS_KPI]->(k:KPI) RETURN k.name AS label, elementId(k) AS id, 'kpi' AS level`,
        params: { name: id },
      }
    case 'kpi':
      return {
        query: `MATCH (k:KPI {name: $name})-[:HAS_TREND]->(t) RETURN t.name AS label, elementId(t) AS id, 'trend' AS level`,
        params: { name: id },
      }
    case 'trend':
      return {
        query: `MATCH (t {name: $name})-[:HAS_RECOMMENDATION]->(r) RETURN r.name AS label, elementId(r) AS id, 'recommendation' AS level`,
        params: { name: id },
      }
    default:
      return null
  }
}

/**
 * Also support domains that link directly to frameworks (no segment layer).
 */
function domainFrameworksFallback(): { query: string; params: Record<string, string> } {
  return {
    query: `MATCH (d:ConsultingDomain {name: $name})-[:HAS_FRAMEWORK]->(f:ConsultingFramework) RETURN f.name AS label, elementId(f) AS id, 'framework' AS level`,
    params: { name: '' }, // filled at call site
  }
}

async function fetchChildren(level: string, label: string): Promise<DrillChild[]> {
  const q = childrenQuery(level, label)
  if (!q) return []

  const result = await callMcp('graph.read_cypher', { query: q.query, params: q.params })
  if (!result.ok) {
    logger.warn({ level, label, error: result.error }, 'Drill children query failed')
    return []
  }

  let records = extractRecords(result.data)

  // Fallback: domain → framework directly (skip segment) if no segments found
  if (level === 'domain' && records.length === 0) {
    const fb = domainFrameworksFallback()
    fb.params.name = label
    const fbResult = await callMcp('graph.read_cypher', { query: fb.query, params: fb.params })
    if (fbResult.ok) {
      records = extractRecords(fbResult.data)
    }
  }

  return records.map(r => ({
    id: String(r.id ?? ''),
    label: String(r.label ?? ''),
    type: String(r.level ?? nextLevel(level) ?? 'unknown'),
    count: typeof r.count === 'number' ? r.count : undefined,
  }))
}

/* ─── Redis session helpers ───────────────────────────────────────────────── */

async function saveContext(sessionId: string, ctx: DrillContext): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    await redis.set(`${DRILL_PREFIX}${sessionId}`, JSON.stringify(ctx), 'EX', SESSION_TTL)
    return true
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis save failed for drill context')
    return false
  }
}

async function loadContext(sessionId: string): Promise<DrillContext | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${DRILL_PREFIX}${sessionId}`)
    return raw ? (JSON.parse(raw) as DrillContext) : null
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis load failed for drill context')
    return null
  }
}

function buildBreadcrumbs(ctx: DrillContext): DrillLevel[] {
  return [
    ...ctx.stack,
    { level: ctx.current_level, id: ctx.current_id, label: ctx.current_label },
  ]
}

/* ─── G4.16: POST /start — Begin a drill session ─────────────────────────── */

drillRouter.post('/start', async (req: Request, res: Response) => {
  const { domain } = req.body as { domain?: string }

  if (!domain) {
    res.status(400).json({ success: false, error: 'Missing required field: domain' })
    return
  }

  const sessionId = randomUUID()
  const ctx: DrillContext = {
    stack: [],
    current_level: 'domain',
    current_id: domain,
    current_label: domain,
    domain,
  }

  const saved = await saveContext(sessionId, ctx)
  if (!saved) {
    res.status(503).json({ success: false, error: 'Redis not available' })
    return
  }

  const children = await fetchChildren('domain', domain)

  logger.info({ session_id: sessionId, domain, children_count: children.length }, 'Drill session started')

  res.json({
    success: true,
    session_id: sessionId,
    context: ctx,
    children,
    breadcrumbs: buildBreadcrumbs(ctx),
  })
})

/* ─── G4.16: POST /down — Drill into a child level ───────────────────────── */

drillRouter.post('/down', async (req: Request, res: Response) => {
  const { session_id, target_id, target_level } = req.body as {
    session_id?: string
    target_id?: string
    target_level?: string
  }

  if (!session_id || !target_id || !target_level) {
    res.status(400).json({ success: false, error: 'Missing required fields: session_id, target_id, target_level' })
    return
  }

  const ctx = await loadContext(session_id)
  if (!ctx) {
    res.status(404).json({ success: false, error: 'Drill session not found or expired' })
    return
  }

  // Push current position onto stack
  ctx.stack.push({
    level: ctx.current_level,
    id: ctx.current_id,
    label: ctx.current_label,
  })

  // Move to target
  ctx.current_level = target_level
  ctx.current_id = target_id
  ctx.current_label = target_id // label = name in Neo4j

  await saveContext(session_id, ctx)

  const children = await fetchChildren(target_level, target_id)

  logger.info({ session_id, target_level, target_id, depth: ctx.stack.length }, 'Drill down')

  res.json({
    success: true,
    context: ctx,
    children,
    breadcrumbs: buildBreadcrumbs(ctx),
  })
})

/* ─── G4.16: POST /up — Navigate up one level ────────────────────────────── */

drillRouter.post('/up', async (req: Request, res: Response) => {
  const { session_id } = req.body as { session_id?: string }

  if (!session_id) {
    res.status(400).json({ success: false, error: 'Missing required field: session_id' })
    return
  }

  const ctx = await loadContext(session_id)
  if (!ctx) {
    res.status(404).json({ success: false, error: 'Drill session not found or expired' })
    return
  }

  if (ctx.stack.length === 0) {
    res.status(400).json({ success: false, error: 'Already at top level' })
    return
  }

  // Pop from stack
  const parent = ctx.stack.pop()!
  ctx.current_level = parent.level
  ctx.current_id = parent.id
  ctx.current_label = parent.label

  await saveContext(session_id, ctx)

  const children = await fetchChildren(ctx.current_level, ctx.current_label)

  logger.info({ session_id, level: ctx.current_level, label: ctx.current_label }, 'Drill up')

  res.json({
    success: true,
    context: ctx,
    children,
    breadcrumbs: buildBreadcrumbs(ctx),
  })
})

/* ─── G4.16: GET /children — List children at current level ───────────────── */

drillRouter.get('/children', async (req: Request, res: Response) => {
  const sessionId = req.query.session_id as string

  if (!sessionId) {
    res.status(400).json({ success: false, error: 'Missing required query param: session_id' })
    return
  }

  const ctx = await loadContext(sessionId)
  if (!ctx) {
    res.status(404).json({ success: false, error: 'Drill session not found or expired' })
    return
  }

  const children = await fetchChildren(ctx.current_level, ctx.current_label)

  res.json({
    success: true,
    children,
    context: ctx,
    breadcrumbs: buildBreadcrumbs(ctx),
  })
})

/* ─── G4.18–G4.19: GET /moc — Map of Content generation ──────────────────── */

drillRouter.get('/moc', async (req: Request, res: Response) => {
  const domain = req.query.domain as string

  if (!domain) {
    res.status(400).json({ success: false, error: 'Missing required query param: domain' })
    return
  }

  // Full hierarchy query
  const hierarchyQuery = `
    MATCH (d:ConsultingDomain {name: $domain})
    OPTIONAL MATCH (d)-[:HAS_FRAMEWORK]->(f:ConsultingFramework)
    OPTIONAL MATCH (f)-[:HAS_KPI]->(k:KPI)
    RETURN d.name AS domain_name, f.name AS framework_name, k.name AS kpi_name, k.value AS kpi_value, k.trend AS kpi_trend
    ORDER BY f.name, k.name
  `

  const result = await callMcp('graph.read_cypher', {
    query: hierarchyQuery,
    params: { domain },
  })

  if (!result.ok) {
    res.status(502).json({ success: false, error: result.error ?? 'Neo4j query failed' })
    return
  }

  const records = extractRecords(result.data)

  // Group by framework
  const frameworks = new Map<string, { kpis: Array<{ name: string; value: string; trend: string }> }>()

  for (const rec of records) {
    const fName = rec.framework_name ? String(rec.framework_name) : null
    if (!fName) continue

    if (!frameworks.has(fName)) {
      frameworks.set(fName, { kpis: [] })
    }

    const kName = rec.kpi_name ? String(rec.kpi_name) : null
    if (kName) {
      frameworks.get(fName)!.kpis.push({
        name: kName,
        value: String(rec.kpi_value ?? ''),
        trend: trendArrow(rec.kpi_trend as string | undefined),
      })
    }
  }

  // Build Obsidian-compatible markdown
  const lines: string[] = []
  lines.push(`# ${domain} — Map of Content`)
  lines.push('')
  lines.push(`> Generated: ${new Date().toISOString()}`)
  lines.push(`> Source: WidgeTDC Neo4j Knowledge Graph`)
  lines.push('')

  // Frameworks section
  if (frameworks.size > 0) {
    lines.push('## Frameworks')
    lines.push('')
    for (const [fName, fData] of frameworks) {
      lines.push(`- [[${fName}]] (${fData.kpis.length} KPIs)`)
    }
    lines.push('')

    // KPIs section
    lines.push('## KPIs')
    lines.push('')
    for (const [fName, fData] of frameworks) {
      if (fData.kpis.length === 0) continue
      lines.push(`### ${fName}`)
      lines.push('')
      for (const kpi of fData.kpis) {
        const valueStr = kpi.value ? `: ${kpi.value} ${kpi.trend}` : ` ${kpi.trend}`
        lines.push(`- ${kpi.name}${valueStr}`)
      }
      lines.push('')
    }
  } else {
    lines.push('*No frameworks found for this domain.*')
    lines.push('')
  }

  // Also query for recommendations under this domain
  const recsQuery = `
    MATCH (d:ConsultingDomain {name: $domain})-[:HAS_FRAMEWORK]->(f)-[:HAS_KPI]->(k)-[:HAS_RECOMMENDATION]->(r)
    RETURN r.name AS rec_name, r.description AS rec_desc, elementId(r) AS rec_id
    LIMIT 20
  `

  const recsResult = await callMcp('graph.read_cypher', { query: recsQuery, params: { domain } })
  const recs = recsResult.ok ? extractRecords(recsResult.data) : []

  if (recs.length > 0) {
    lines.push('## Recommendations')
    lines.push('')
    for (const rec of recs) {
      const name = String(rec.rec_name ?? 'Unnamed')
      const desc = rec.rec_desc ? ` — ${String(rec.rec_desc)}` : ''
      const id = String(rec.rec_id ?? '')
      lines.push(`- [${name}](obsidian://widgetdc-open?artifact=${encodeURIComponent(id)})${desc}`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push(`*Map of Content for ${domain} — WidgeTDC Adoption Blueprint*`)

  logger.info({ domain, frameworks: frameworks.size, records: records.length }, 'MOC generated')

  res.type('text/markdown').send(lines.join('\n'))
})

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function trendArrow(trend?: string): string {
  if (!trend) return '→'
  const t = trend.toLowerCase()
  if (t === 'up' || t === 'rising' || t === 'increasing') return '↑'
  if (t === 'down' || t === 'falling' || t === 'decreasing') return '↓'
  return '→'
}
