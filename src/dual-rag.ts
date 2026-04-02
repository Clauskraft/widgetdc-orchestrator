/**
 * dual-rag.ts — Hybrid RAG Router (LIN-574 Intelligence Upgrade)
 *
 * Tri-channel retrieval with intelligent routing:
 *   1. autonomous.graphrag  — PRIMARY (best quality, agentic multi-hop)
 *   2. srag.query           — FALLBACK (fast semantic vector search)
 *   3. graph.read_cypher    — STRUCTURED (graph traversal for entity queries)
 *
 * Features:
 *   - Query complexity classification → routes to optimal channel(s)
 *   - LLM prompt pollution filter (P0 fix: vid-* entries with system prompts)
 *   - Confidence scoring with source attribution
 *   - Graceful degradation: graphrag → srag+cypher → cypher-only
 */
import { callMcpTool } from './mcp-caller.js'
import { logger } from './logger.js'
import { v4 as uuid } from 'uuid'

// ─── Types ──────────────────────────────────────────────────────────────────

interface RAGResult {
  source: 'graphrag' | 'srag' | 'cypher'
  content: string
  score: number
  metadata?: Record<string, unknown>
  filtered?: boolean
}

type QueryComplexity = 'simple' | 'multi_hop' | 'structured'

interface DualRAGResponse {
  query: string
  results: RAGResult[]
  srag_count: number
  cypher_count: number
  graphrag_count: number
  merged_context: string
  duration_ms: number
  route_strategy: QueryComplexity
  channels_used: string[]
  pollution_filtered: number
}

// ─── Pollution Filter (P0: LLM prompt contamination) ────────────────────────

const POLLUTION_PATTERNS = [
  /you are (?:a |an )?(?:helpful |expert |professional )/i,
  /^(?:system|assistant|human):/im,
  /\b(?:claude|chatgpt|gpt-4|openai)\s+(?:is|can|should|will)\b/i,
  /\bdo not (?:hallucinate|make up|fabricate)\b/i,
  /\byour (?:task|role|job|purpose) is to\b/i,
  /\brespond (?:in|with|using) (?:json|markdown|the following)\b/i,
  /\banswer (?:only|strictly|exclusively) (?:in|with|based)\b/i,
  /\b(?:ignore|disregard) (?:previous|all|any) (?:instructions|prompts)\b/i,
  /\byou (?:must|should|will) (?:always|never|only)\b/i,
  /\bas an ai (?:language )?model\b/i,
]

function isPolluted(text: string): boolean {
  if (!text || text.length < 20) return false
  let matchCount = 0
  for (const pattern of POLLUTION_PATTERNS) {
    if (pattern.test(text)) matchCount++
    if (matchCount >= 2) return true // 2+ pattern matches → polluted
  }
  return false
}

// ─── Query Complexity Classification ────────────────────────────────────────

function classifyQuery(query: string): QueryComplexity {
  const q = query.toLowerCase()

  // Structured: explicit entity/count/list/stat queries → cypher-heavy
  if (/\b(?:how many|count|list all|list the|total|statistics|stats)\b/.test(q)) {
    return 'structured'
  }
  if (/\b(?:match|where|return|node|relationship|label)\b/.test(q)) {
    return 'structured'
  }

  // Multi-hop: complex reasoning, comparison, strategy, analysis
  if (/\b(?:compare|versus|difference|between|trade-?off|pros and cons)\b/.test(q)) {
    return 'multi_hop'
  }
  if (/\b(?:strategy|roadmap|architecture|impact|implication|recommend)\b/.test(q)) {
    return 'multi_hop'
  }
  if (/\b(?:why|how does|what if|should we|evaluate|assess|analyze)\b/.test(q)) {
    return 'multi_hop'
  }
  if (q.split(/\s+/).length > 12) {
    return 'multi_hop' // long queries are typically complex
  }

  return 'simple'
}

// ─── Channel Callers ────────────────────────────────────────────────────────

async function callGraphRAG(query: string, maxResults: number): Promise<RAGResult[]> {
  const result = await callMcpTool({
    toolName: 'autonomous.graphrag',
    args: { question: query, max_evidence: maxResults },
    callId: uuid(),
    timeoutMs: 60000, // graphrag is slower but higher quality
  })

  if (result.status !== 'success') {
    logger.warn({ error: result.error_message }, 'autonomous.graphrag failed')
    return []
  }

  const data = result.result as any
  // autonomous.graphrag returns { answer, evidence[], confidence }
  const evidence = data?.evidence ?? data?.results ?? data?.chunks ?? []
  const answer = data?.answer ?? data?.synthesis ?? ''
  const confidence = data?.confidence ?? 0.8

  const results: RAGResult[] = []

  // Include the synthesized answer as top result
  if (answer && typeof answer === 'string' && answer.length > 20) {
    results.push({
      source: 'graphrag',
      content: answer,
      score: confidence,
      metadata: { type: 'synthesis', evidence_count: evidence.length },
    })
  }

  // Include supporting evidence
  if (Array.isArray(evidence)) {
    for (const item of evidence.slice(0, maxResults - 1)) {
      const content = item.content || item.text || item.chunk ||
        (typeof item === 'string' ? item : JSON.stringify(item).slice(0, 500))
      results.push({
        source: 'graphrag',
        content: typeof content === 'string' ? content : String(content),
        score: item.score ?? item.relevance ?? 0.75,
        metadata: { title: item.title, node_type: item.label || item.type },
      })
    }
  }

  return results
}

async function callSRAG(query: string, maxResults: number): Promise<RAGResult[]> {
  const result = await callMcpTool({
    toolName: 'srag.query',
    args: { query },
    callId: uuid(),
    timeoutMs: 45000,
  })

  if (result.status !== 'success') return []

  const sragData = result.result as any
  const items = Array.isArray(sragData) ? sragData
    : sragData?.results ? sragData.results
    : sragData?.chunks ? sragData.chunks
    : []

  const results: RAGResult[] = []
  for (const item of items.slice(0, maxResults)) {
    results.push({
      source: 'srag',
      content: item.content || item.text || item.chunk || JSON.stringify(item).slice(0, 500),
      score: item.score || item.similarity || 0.5,
      metadata: { title: item.title, tags: item.tags },
    })
  }
  return results
}

async function callCypher(query: string, maxResults: number, depth: number): Promise<RAGResult[]> {
  const result = await callMcpTool({
    toolName: 'graph.read_cypher',
    args: { query: buildCypherQuery(query, depth) },
    callId: uuid(),
    timeoutMs: 20000,
  })

  if (result.status !== 'success') return []

  const cypherData = result.result as any
  const rows = cypherData?.results || cypherData || []
  if (!Array.isArray(rows)) return []

  const results: RAGResult[] = []
  for (const row of rows.slice(0, maxResults)) {
    const content = Object.values(row).map(v =>
      typeof v === 'string' ? v : JSON.stringify(v)
    ).join(' | ')
    results.push({
      source: 'cypher',
      content: content.slice(0, 500),
      score: 0.7,
      metadata: row,
    })
  }
  return results
}

// ─── Main RAG Router ────────────────────────────────────────────────────────

/**
 * Hybrid RAG Router — routes queries to optimal channel(s) based on complexity.
 *
 * Routing strategy:
 *   simple    → graphrag primary, srag fallback
 *   multi_hop → graphrag primary + cypher supporting
 *   structured → cypher primary + graphrag context
 */
export async function dualChannelRAG(query: string, options?: {
  maxResults?: number
  cypherDepth?: number
  includePatterns?: boolean
  forceChannels?: ('graphrag' | 'srag' | 'cypher')[]
}): Promise<DualRAGResponse> {
  const t0 = Date.now()
  const maxResults = options?.maxResults ?? 10
  const depth = options?.cypherDepth ?? 2
  const complexity = classifyQuery(query)

  logger.info({ query: query.slice(0, 80), complexity }, 'Hybrid RAG: routing query')

  // Determine which channels to call based on complexity
  const channels = options?.forceChannels ?? getChannelsForComplexity(complexity)
  const channelPromises: Promise<RAGResult[]>[] = []
  const channelsUsed: string[] = []

  if (channels.includes('graphrag')) {
    channelPromises.push(callGraphRAG(query, maxResults))
    channelsUsed.push('graphrag')
  }
  if (channels.includes('srag')) {
    channelPromises.push(callSRAG(query, maxResults))
    channelsUsed.push('srag')
  }
  if (channels.includes('cypher')) {
    channelPromises.push(callCypher(query, maxResults, depth))
    channelsUsed.push('cypher')
  }

  // Execute channels in parallel
  const channelResults = await Promise.allSettled(channelPromises)

  let allResults: RAGResult[] = []
  for (const cr of channelResults) {
    if (cr.status === 'fulfilled') {
      allResults.push(...cr.value)
    }
  }

  // Fallback: if graphrag returned nothing, try srag if not already used
  if (allResults.filter(r => r.source === 'graphrag').length === 0 && !channels.includes('srag')) {
    logger.info('Hybrid RAG: graphrag returned empty, falling back to srag')
    const sragResults = await callSRAG(query, maxResults)
    allResults.push(...sragResults)
    channelsUsed.push('srag (fallback)')
  }

  // Apply pollution filter (P0: remove LLM prompt contamination)
  let pollutionFiltered = 0
  allResults = allResults.filter(r => {
    if (isPolluted(r.content)) {
      pollutionFiltered++
      logger.debug({ source: r.source, preview: r.content.slice(0, 60) }, 'Filtered polluted result')
      return false
    }
    return true
  })

  // Sort by score descending, prioritize graphrag results
  allResults.sort((a, b) => {
    // graphrag synthesis always first
    if (a.source === 'graphrag' && a.metadata?.type === 'synthesis') return -1
    if (b.source === 'graphrag' && b.metadata?.type === 'synthesis') return 1
    // Then by score
    return b.score - a.score
  })

  // Build merged context for LLM consumption
  const topResults = allResults.slice(0, maxResults)
  const merged = topResults.map((r, i) =>
    `[${r.source.toUpperCase()} #${i + 1}${r.score >= 0.8 ? ' ★' : ''}] ${r.content}`
  ).join('\n\n')

  const graphragCount = topResults.filter(r => r.source === 'graphrag').length
  const sragCount = topResults.filter(r => r.source === 'srag').length
  const cypherCount = topResults.filter(r => r.source === 'cypher').length

  const durationMs = Date.now() - t0
  logger.info({
    query: query.slice(0, 60),
    complexity,
    graphragCount,
    sragCount,
    cypherCount,
    pollutionFiltered,
    ms: durationMs,
  }, 'Hybrid RAG: complete')

  return {
    query,
    results: topResults,
    srag_count: sragCount,
    cypher_count: cypherCount,
    graphrag_count: graphragCount,
    merged_context: merged,
    duration_ms: durationMs,
    route_strategy: complexity,
    channels_used: channelsUsed,
    pollution_filtered: pollutionFiltered,
  }
}

// ─── Channel Selection ──────────────────────────────────────────────────────

function getChannelsForComplexity(complexity: QueryComplexity): ('graphrag' | 'srag' | 'cypher')[] {
  switch (complexity) {
    case 'simple':
      // graphrag primary, srag for breadth
      return ['graphrag', 'srag']
    case 'multi_hop':
      // graphrag for reasoning + cypher for structured context
      return ['graphrag', 'cypher']
    case 'structured':
      // cypher primary + graphrag for enrichment
      return ['cypher', 'graphrag']
  }
}

// ─── Cypher Builder ─────────────────────────────────────────────────────────

function buildCypherQuery(query: string, depth: number): string {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'how', 'what', 'which', 'where', 'when', 'why', 'can', 'does', 'will', 'not', 'all', 'has', 'have', 'been', 'our', 'their', 'its'])
  const keywords = query
    .toLowerCase()
    .replace(/[^a-zA-Z0-9æøåÆØÅ\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w))
    .slice(0, 5)

  if (keywords.length === 0) {
    return "MATCH (n:StrategicInsight) RETURN n.title AS title, n.domain AS domain LIMIT 5"
  }

  const kwConditions = keywords.map(kw =>
    `toLower(coalesce(n.title, n.name, n.description, '')) CONTAINS '${kw}'`
  ).join(' OR ')

  return `MATCH (n) WHERE (n:StrategicInsight OR n:Pattern OR n:Lesson OR n:Knowledge OR n:Memory OR n:TDCDocument)
AND (${kwConditions})
WITH n, labels(n)[0] AS label
OPTIONAL MATCH (n)-[r]-(m)
RETURN label,
       coalesce(n.title, n.name, n.filename) AS title,
       substring(coalesce(n.description, n.content, n.value, ''), 0, 300) AS content,
       type(r) AS rel,
       labels(m)[0] AS connected_to
LIMIT 15`
}
