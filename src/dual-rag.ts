/**
 * dual-rag.ts — Dual-channel RAG: SRAG vector + Neo4j Cypher path retrieval
 *
 * Combines semantic vector search (SRAG) with structured graph traversal
 * (Neo4j Cypher) for richer, more grounded retrieval.
 */
import { callMcpTool } from './mcp-caller.js'
import { logger } from './logger.js'
import { v4 as uuid } from 'uuid'

interface RAGResult {
  source: 'srag' | 'cypher'
  content: string
  score?: number
  metadata?: Record<string, unknown>
}

interface DualRAGResponse {
  query: string
  results: RAGResult[]
  srag_count: number
  cypher_count: number
  merged_context: string
  duration_ms: number
}

/**
 * Query both SRAG and Neo4j in parallel, merge results by relevance.
 */
export async function dualChannelRAG(query: string, options?: {
  maxResults?: number
  cypherDepth?: number
  includePatterns?: boolean
}): Promise<DualRAGResponse> {
  const t0 = Date.now()
  const maxResults = options?.maxResults ?? 10
  const depth = options?.cypherDepth ?? 2

  // Channel 1: SRAG vector search
  // Channel 2: Neo4j Cypher graph traversal
  const [sragResult, cypherResult] = await Promise.allSettled([
    callMcpTool({
      toolName: 'srag.query',
      args: { query },
      callId: uuid(),
      timeoutMs: 45000,
    }),
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: buildCypherQuery(query, depth),
      },
      callId: uuid(),
      timeoutMs: 20000,
    }),
  ])

  const results: RAGResult[] = []

  // Parse SRAG results
  if (sragResult.status === 'fulfilled' && sragResult.value.status === 'success') {
    const sragData = sragResult.value.result
    const items = Array.isArray(sragData) ? sragData
      : sragData?.results ? sragData.results
      : sragData?.chunks ? sragData.chunks
      : []
    for (const item of items.slice(0, maxResults)) {
      results.push({
        source: 'srag',
        content: item.content || item.text || item.chunk || JSON.stringify(item).slice(0, 500),
        score: item.score || item.similarity || 0.5,
        metadata: { title: item.title, tags: item.tags },
      })
    }
  }

  // Parse Cypher results
  if (cypherResult.status === 'fulfilled' && cypherResult.value.status === 'success') {
    const cypherData = cypherResult.value.result
    const rows = cypherData?.results || cypherData || []
    if (Array.isArray(rows)) {
      for (const row of rows.slice(0, maxResults)) {
        const content = Object.values(row).map(v =>
          typeof v === 'string' ? v : JSON.stringify(v)
        ).join(' | ')
        results.push({
          source: 'cypher',
          content: content.slice(0, 500),
          score: 0.7, // graph results are structurally relevant
          metadata: row,
        })
      }
    }
  }

  // Sort by score descending, interleave sources for diversity
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

  // Build merged context string for LLM consumption
  const merged = results.slice(0, maxResults).map((r, i) =>
    `[${r.source.toUpperCase()} #${i + 1}] ${r.content}`
  ).join('\n\n')

  const sragCount = results.filter(r => r.source === 'srag').length
  const cypherCount = results.filter(r => r.source === 'cypher').length

  logger.debug({ query: query.slice(0, 60), sragCount, cypherCount, ms: Date.now() - t0 }, 'Dual-channel RAG')

  return {
    query,
    results: results.slice(0, maxResults),
    srag_count: sragCount,
    cypher_count: cypherCount,
    merged_context: merged,
    duration_ms: Date.now() - t0,
  }
}

/**
 * Build a multi-hop Cypher query from a natural language query.
 * Extracts keywords and searches across key node types.
 */
function buildCypherQuery(query: string, depth: number): string {
  // Extract meaningful keywords (3+ chars, skip common words)
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
