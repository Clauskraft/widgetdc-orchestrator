/**
 * compound-hooks.ts — F4: Compound Feedback Loops (LIN-574 v3.0)
 *
 * Mandatory post-hooks for chain execution that create flywheel effects:
 *   1. Deliverable→Knowledge: write citations as graph edges after generation
 *   2. Auto-Enrichment: extract new entities from RAG answers, MERGE to graph
 *   3. Quality Signal: log confidence/outcome for adaptive RAG training
 *   4. Similarity Preference: log user selections for similarity tuning
 *
 * These hooks make every user action enrich the knowledge graph.
 */
import { v4 as uuid } from 'uuid'
import { callMcpTool } from './mcp-caller.js'
import { chatLLM } from './llm-proxy.js'
import { logger } from './logger.js'
import { getRedis } from './redis.js'

// ─── Hook 1: Deliverable→Knowledge ─────────────────────────────────────────

/**
 * After a deliverable is generated, write citation relationships back to graph.
 * Each citation becomes a :CITED_IN edge from the source entity to the deliverable.
 */
export async function hookDeliverableToKnowledge(
  deliverableId: string,
  title: string,
  citations: Array<{ source: string; title: string }>,
): Promise<number> {
  if (citations.length === 0) return 0

  let linked = 0
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (d:Deliverable {id: $deliverableId})
SET d.title = $title, d.createdAt = datetime()
WITH d
UNWIND $citations AS cit
MATCH (n) WHERE coalesce(n.title, n.name) CONTAINS cit.title
WITH d, n LIMIT 20
MERGE (n)-[:CITED_IN]->(d)
RETURN count(*) AS linked`,
        params: {
          deliverableId,
          title: title.slice(0, 200),
          citations: citations.slice(0, 15).map(c => ({ title: c.title.slice(0, 80) })),
        },
        _force: true,
      },
      callId: uuid(),
      timeoutMs: 10000,
    })
    linked = citations.length
  } catch (err) {
    logger.debug({ error: String(err) }, 'Deliverable→Knowledge hook failed')
  }

  logger.info({ deliverableId, citations: citations.length, linked }, 'Hook: Deliverable→Knowledge')
  return linked
}

// ─── Hook 2: Auto-Enrichment ────────────────────────────────────────────────

/**
 * After a RAG answer is generated, extract new entities not yet in the graph.
 * Fire-and-forget — enrichment is best-effort, never blocks the response.
 */
export function hookAutoEnrichment(answer: string, query: string): void {
  // Run async, don't block
  extractAndMerge(answer, query).catch(err =>
    logger.debug({ error: String(err) }, 'Auto-enrichment hook failed (non-blocking)')
  )
}

async function extractAndMerge(answer: string, query: string): Promise<void> {
  if (answer.length < 50) return

  const prompt = `Extract named entities. Reply ONLY as JSON, no markdown.\n{"entities": [{"name": "...", "type": "Organization|Regulation|Technology|Framework", "domain": "..."}]}\nMax 5. If none: {"entities": []}\n\nContent: ${answer.slice(0, 2000)}`

  // Cascading fallback: Mercury → Groq → Gemini
  let entities: any[] = []
  try {
    // Try Mercury first
    const mercResult = await callMcpTool({
      toolName: 'llm.generate',
      args: { prompt },
      callId: uuid(),
      timeoutMs: 10000,
    })
    const mercRaw = mercResult.result as any
    if (mercResult.status === 'success' && mercRaw?.success !== false) {
      const parsed = parseEnrichmentJSON(mercRaw?.content ?? '')
      if (parsed.length > 0) { entities = parsed }
    }
  } catch { /* Mercury failed */ }

  // Fallback: Groq
  if (entities.length === 0) {
    try {
      const groqResult = await chatLLM({ provider: 'groq', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 500 })
      entities = parseEnrichmentJSON(groqResult.content ?? '')
    } catch { /* Groq failed */ }
  }

  // Fallback: Gemini
  if (entities.length === 0) {
    try {
      const gemResult = await chatLLM({ provider: 'gemini', messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 500 })
      entities = parseEnrichmentJSON(gemResult.content ?? '')
    } catch { /* all failed */ }
  }

  if (entities.length === 0) return

  for (const entity of entities) {
    if (!entity.name || entity.name.length < 3) continue
    try {
      const ALLOWED_LABELS = new Set(['Knowledge', 'Concept', 'Entity', 'Tool', 'Agent', 'Decision', 'Strategy', 'Process', 'Technology', 'Organization', 'Person', 'Metric'])
      let safeLabel = (entity.type ?? 'Knowledge').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64)
      if (/^[0-9]/.test(safeLabel)) safeLabel = 'E_' + safeLabel
      if (!ALLOWED_LABELS.has(safeLabel)) safeLabel = 'Knowledge'
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `MERGE (n:${safeLabel} {name: $name})
ON CREATE SET n.domain = $domain, n.source = 'auto-enrichment', n.createdAt = datetime()
SET n.updatedAt = datetime()`,
          params: {
            name: entity.name,
            domain: entity.domain ?? 'general',
          },
        },
        callId: uuid(),
        timeoutMs: 5000,
      })
    } catch { /* individual entity merge failures are ok */ }
  }

  if (entities.length > 0) {
    logger.info({ count: entities.length }, 'Hook: Auto-enrichment — new entities merged')
  }
}

// ─── Hook 3: Quality Signal ─────────────────────────────────────────────────

/**
 * Log RAG routing outcome for adaptive feedback training.
 * Stores (query, strategy, channels, confidence) in Redis for weekly retraining.
 */
export async function hookQualitySignal(
  query: string,
  strategy: string,
  channels: string[],
  resultCount: number,
  confidenceAvg: number,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  try {
    const signal = JSON.stringify({
      query: query.slice(0, 200),
      strategy,
      channels,
      result_count: resultCount,
      confidence: confidenceAvg,
      timestamp: Date.now(),
    })
    await redis.lpush('orchestrator:rag-quality-signals', signal)
    await redis.ltrim('orchestrator:rag-quality-signals', 0, 9999) // Keep last 10K
  } catch { /* non-critical */ }
}

// ─── Hook 4: Similarity Preference ──────────────────────────────────────────

/**
 * Log when a user selects a similarity match (implicit preference signal).
 * Creates :PREFERRED_OVER edges in the graph over time.
 */
export async function hookSimilarityPreference(
  queryId: string,
  selectedMatchId: string,
  rejectedMatchIds: string[],
): Promise<void> {
  if (!selectedMatchId || rejectedMatchIds.length === 0) return

  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MATCH (selected {id: $selectedId})
UNWIND $rejectedIds AS rejId
MATCH (rejected {id: rejId})
MERGE (selected)-[p:PREFERRED_OVER]->(rejected)
ON CREATE SET p.count = 1, p.firstSeen = datetime()
SET p.count = coalesce(p.count, 0) + 1, p.lastSeen = datetime()`,
        params: {
          selectedId: selectedMatchId,
          rejectedIds: rejectedMatchIds.slice(0, 5),
        },
        _force: true,
      },
      callId: uuid(),
      timeoutMs: 5000,
    })
    logger.info({ selected: selectedMatchId, rejected: rejectedMatchIds.length }, 'Hook: Similarity preference logged')
  } catch { /* non-critical */ }
}

// ─── Shared JSON Parser ─────────────────────────────────────────────────────

function parseEnrichmentJSON(text: string): any[] {
  if (!text || text.length < 5) return []
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  try {
    const direct = JSON.parse(cleaned)
    if (Array.isArray(direct.entities)) return direct.entities.slice(0, 5)
  } catch { /* try regex */ }
  const match = cleaned.match(/\{[\s\S]*"entities"[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]).entities?.slice(0, 5) ?? [] } catch { /* failed */ }
  }
  return []
}
