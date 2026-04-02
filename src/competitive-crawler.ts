/**
 * competitive-crawler.ts — Competitive Phagocytosis MVP (LIN-566)
 *
 * Weekly cron crawls 5 competitors' public docs/changelogs/OpenAPI specs,
 * extracts capabilities, maps to Neo4j, generates gap reports.
 *
 * Targets (public data only):
 *   1. Palantir AIP — developer docs
 *   2. Dust.tt — public docs
 *   3. Glean — public docs
 *   4. LangGraph — docs
 *   5. Copilot Studio — MS Learn docs
 */
import { v4 as uuid } from 'uuid'
import { getRedis } from './redis.js'
import { callMcpTool } from './mcp-caller.js'
import { chatLLM } from './llm-proxy.js'
import { logger } from './logger.js'
import { broadcastSSE } from './sse.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CompetitorTarget {
  name: string
  slug: string
  urls: string[]
}

export interface ExtractedCapability {
  $id: string
  competitor: string
  capability: string
  category: string
  evidence_url: string
  extracted_at: string
}

export interface GapReport {
  $id: string
  total_capabilities_found: number
  by_competitor: Record<string, number>
  gaps: Array<{
    capability: string
    competitors_with: string[]
    widgetdc_has: boolean
  }>
  strengths: string[]
  generated_at: string
}

// ─── Competitor Targets ─────────────────────────────────────────────────────

export const COMPETITOR_TARGETS: CompetitorTarget[] = [
  {
    name: 'Palantir AIP',
    slug: 'palantir',
    urls: [
      'https://www.palantir.com/docs/foundry/api/',
      'https://www.palantir.com/platforms/aip/',
    ],
  },
  {
    name: 'Dust.tt',
    slug: 'dust',
    urls: [
      'https://docs.dust.tt/',
      'https://dust.tt/changelog',
    ],
  },
  {
    name: 'Glean',
    slug: 'glean',
    urls: [
      'https://developers.glean.com/docs/overview',
      'https://www.glean.com/product',
    ],
  },
  {
    name: 'LangGraph',
    slug: 'langgraph',
    urls: [
      'https://langchain-ai.github.io/langgraph/concepts/',
      'https://langchain-ai.github.io/langgraph/how-tos/',
    ],
  },
  {
    name: 'Copilot Studio',
    slug: 'copilot-studio',
    urls: [
      'https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio',
    ],
  },
]

// ─── Web Fetcher ────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return plain text content (HTML stripped).
 * Respects robots.txt spirit: identifies as WidgeTDC research bot, no auth bypass.
 */
async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'WidgeTDC-Research/1.0 (competitive analysis; public docs only)',
      'Accept': 'text/html,application/json,text/plain',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  })

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)

  const contentType = res.headers.get('content-type') ?? ''
  const raw = await res.text()

  // Strip HTML tags, scripts, styles — keep text content
  if (contentType.includes('html')) {
    return raw
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .trim()
      .slice(0, 15000) // Cap at 15K chars for LLM context
  }

  return raw.slice(0, 15000)
}

// ─── Capability Extractor ───────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a competitive intelligence analyst. Given web page content from a competitor, extract specific technical capabilities they offer.

Rules:
- List ONLY capabilities explicitly mentioned in the content
- Each capability must be a specific, concrete feature (not marketing fluff)
- Focus on: APIs, agent/orchestration features, AI/LLM capabilities, security, knowledge management, integrations
- Return as a bulleted list, one capability per line, starting with "- "
- Maximum 20 capabilities per page
- If the page has no relevant technical content, return "NO_CAPABILITIES_FOUND"

Competitor: {competitor}
URL: {url}
Page content:
{content}`

/**
 * Fetch actual web pages and extract capabilities using LLM analysis.
 * Pipeline: HTTP fetch → strip HTML → LLM extraction → parse bullets.
 */
async function extractCapabilities(target: CompetitorTarget): Promise<ExtractedCapability[]> {
  const capabilities: ExtractedCapability[] = []

  for (const url of target.urls) {
    try {
      // Step 1: Fetch the actual web page
      logger.info({ competitor: target.name, url }, 'Fetching competitor page')
      const pageText = await fetchPageText(url)

      if (pageText.length < 100) {
        logger.warn({ competitor: target.name, url, length: pageText.length }, 'Page too short — skipping')
        continue
      }

      // Step 2: Use LLM to extract capabilities from real page content
      const prompt = EXTRACTION_PROMPT
        .replace('{competitor}', target.name)
        .replace('{url}', url)
        .replace('{content}', pageText.slice(0, 12000))

      const llmResult = await chatLLM({
        provider: 'deepseek', // cheap + fast for extraction
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      })

      if (!llmResult.content || llmResult.content.includes('NO_CAPABILITIES_FOUND')) {
        logger.info({ competitor: target.name, url }, 'No capabilities found on page')
        continue
      }

      // Step 3: Parse bullet-point capabilities from LLM response
      const lines = llmResult.content.split('\n').filter((l: string) => l.trim().startsWith('-') || l.trim().startsWith('*'))
      for (const line of lines.slice(0, 20)) {
        const cap = line.replace(/^[\s\-\*]+/, '').trim()
        if (cap.length > 10 && cap.length < 200) {
          capabilities.push({
            $id: `capability:${target.slug}:${uuid().slice(0, 8)}`,
            competitor: target.name,
            capability: cap,
            category: categorizeCapability(cap),
            evidence_url: url,
            extracted_at: new Date().toISOString(),
          })
        }
      }

      logger.info({ competitor: target.name, url, capabilities: lines.length }, 'Extracted capabilities from page')
    } catch (err) {
      logger.warn({ competitor: target.name, url, err: String(err) }, 'Capability extraction failed for URL')
    }
  }

  return capabilities
}

function categorizeCapability(cap: string): string {
  const lower = cap.toLowerCase()
  if (lower.includes('api') || lower.includes('endpoint') || lower.includes('rest') || lower.includes('graphql')) return 'api'
  if (lower.includes('agent') || lower.includes('orchestrat') || lower.includes('workflow')) return 'orchestration'
  if (lower.includes('rag') || lower.includes('search') || lower.includes('retrieval') || lower.includes('knowledge')) return 'knowledge'
  if (lower.includes('security') || lower.includes('auth') || lower.includes('compliance') || lower.includes('rbac')) return 'security'
  if (lower.includes('llm') || lower.includes('model') || lower.includes('ai') || lower.includes('inference')) return 'ai'
  if (lower.includes('deploy') || lower.includes('scale') || lower.includes('monitor')) return 'platform'
  return 'general'
}

// ─── Neo4j Persistence ──────────────────────────────────────────────────────

async function persistCapabilities(capabilities: ExtractedCapability[]): Promise<number> {
  let persisted = 0

  for (const cap of capabilities) {
    try {
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `
            MERGE (c:CompetitorCapability {competitor: $competitor, capability: $capability})
            SET c.category = $category,
                c.evidence_url = $evidence_url,
                c.extracted_at = datetime($extracted_at),
                c.updated_at = datetime()
            MERGE (comp:Competitor {name: $competitor})
            MERGE (comp)-[:HAS_CAPABILITY]->(c)
          `,
          params: {
            competitor: cap.competitor,
            capability: cap.capability,
            category: cap.category,
            evidence_url: cap.evidence_url,
            extracted_at: cap.extracted_at,
          },
        },
        callId: uuid(),
        timeoutMs: 10000,
      })
      persisted++
    } catch (err) {
      logger.warn({ err: String(err), competitor: cap.competitor }, 'Failed to persist capability')
    }
  }

  return persisted
}

// ─── Gap Analysis ───────────────────────────────────────────────────────────

async function analyzeGaps(capabilities: ExtractedCapability[]): Promise<GapReport> {
  const byCompetitor: Record<string, number> = {}
  const capMap = new Map<string, string[]>()

  for (const cap of capabilities) {
    byCompetitor[cap.competitor] = (byCompetitor[cap.competitor] ?? 0) + 1
    const existing = capMap.get(cap.capability) ?? []
    existing.push(cap.competitor)
    capMap.set(cap.capability, existing)
  }

  // Check which capabilities WidgeTDC has (query our own tool registry)
  let widgetdcTools: string[] = []
  try {
    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: { query: "MATCH (t:Tool) RETURN t.name AS name LIMIT 200" },
      callId: uuid(),
      timeoutMs: 10000,
    })
    if (result.status === 'success') {
      const data = result.result as { results?: Array<{ name: string }> }
      widgetdcTools = (data?.results ?? []).map(r => r.name.toLowerCase())
    }
  } catch { /* non-critical */ }

  const gaps: GapReport['gaps'] = []
  for (const [capability, competitors] of capMap.entries()) {
    const hasIt = widgetdcTools.some(t =>
      capability.toLowerCase().includes(t) || t.includes(capability.toLowerCase().slice(0, 15))
    )
    if (!hasIt && competitors.length >= 2) {
      gaps.push({
        capability,
        competitors_with: competitors,
        widgetdc_has: false,
      })
    }
  }

  // Identify WidgeTDC strengths (things we have that competitors don't mention)
  const strengths = [
    'Triple-Protocol ABI (REST + MCP + OpenAPI)',
    'Mercury Folding (context compression)',
    'Neo4j Knowledge Graph with 17 domains',
    'Self-correcting graph agent',
    'Multi-agent chain engine (5 modes)',
  ]

  return {
    $id: `gap-report:${new Date().toISOString().slice(0, 10)}`,
    total_capabilities_found: capabilities.length,
    by_competitor: byCompetitor,
    gaps: gaps.slice(0, 30),
    strengths,
    generated_at: new Date().toISOString(),
  }
}

// ─── Main Runner ────────────────────────────────────────────────────────────

/**
 * Full competitive crawl cycle: extract → persist → analyze → report.
 */
export async function runCompetitiveCrawl(): Promise<GapReport> {
  logger.info('Starting competitive phagocytosis crawl')

  const allCapabilities: ExtractedCapability[] = []

  for (const target of COMPETITOR_TARGETS) {
    const caps = await extractCapabilities(target)
    allCapabilities.push(...caps)
    logger.info({ competitor: target.name, capabilities: caps.length }, 'Extracted capabilities')
  }

  const persisted = await persistCapabilities(allCapabilities)
  const report = await analyzeGaps(allCapabilities)

  // Cache report in Redis (only if we got results — don't mask failures with empty cache)
  const redis = getRedis()
  if (redis && allCapabilities.length > 0) {
    await redis.set('orchestrator:competitive-report', JSON.stringify(report), 'EX', 604800).catch(() => {}) // 7 day TTL
  } else if (redis && allCapabilities.length === 0) {
    logger.warn('Competitive crawl returned zero capabilities — not caching empty report')
  }

  // Broadcast via SSE
  broadcastSSE('competitive-report', report)

  logger.info({
    total_capabilities: allCapabilities.length,
    persisted,
    gaps: report.gaps.length,
  }, 'Competitive phagocytosis crawl complete')

  return report
}
