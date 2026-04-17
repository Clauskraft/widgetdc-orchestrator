/**
 * insight-similarity-cron.ts — Build semantic SIMILAR_TO fabric on insight nodes.
 *
 * Problem (graph-steward 2026-04-17): StrategicInsight (7,960 nodes, 384D) has
 * ZERO SIMILAR_TO edges despite full embedding coverage. Insights are isolated
 * leaves on TopicCluster — no cross-insight semantic web, so srag.query returns
 * flat results with no multi-hop retrieval potential.
 *
 * Solution: nightly cron that walks every StrategicInsight with an embedding,
 * queries the `insight_embeddings` vector index (384D COSINE) for top-k
 * neighbours, and MERGEs SIMILAR_TO edges with score >= threshold.
 *
 * Runs entirely in-database via db.index.vector.queryNodes → single Cypher call,
 * no per-node round-trips.
 *
 * NOT YET COVERED:
 *   - McKinseyInsight (52,925 nodes at 3072D — dimension mismatch, needs reindex)
 *   - Knowledge (274 nodes — too small for meaningful fabric)
 *   - TDCDocument, CodeSymbol, CodeFile — no current vector index
 *
 * Tracked in Linear for future waves.
 */
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'
import { v4 as uuid } from 'uuid'

const TOP_K = 6                    // each node gets up to top-6 semantic neighbours
const SIMILARITY_THRESHOLD = 0.85  // cosine score cutoff — empirical tuning may follow
const VECTOR_INDEX = 'insight_embeddings'

export interface InsightSimilarityResult {
  labels_added: number
  edges_created: number
  source_nodes: number
  duration_ms: number
  status: 'ok' | 'error'
  error?: string
}

export async function runInsightSimilarity(): Promise<InsightSimilarityResult> {
  const t0 = Date.now()
  logger.info('Insight similarity cron: starting')

  try {
    // Step 1: ensure :Insight label on every StrategicInsight so the 384D vector
    // index (which targets :Insight) lights up for these nodes.
    const labelResult = await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: 'MATCH (n:StrategicInsight) WHERE NOT n:Insight SET n:Insight RETURN count(n) AS added',
        params: {},
        intent: 'Attach :Insight label to StrategicInsight for vector-index coverage',
        purpose: 'Enable insight_embeddings vector index on strategic insights',
        objective: 'Unlock semantic SIMILAR_TO retrieval on 7,960 StrategicInsight nodes',
        evidence: 'graph-steward scan 2026-04-17: 0 SIMILAR_TO edges on StrategicInsight',
        verification: 'MATCH (n:StrategicInsight) WHERE n:Insight RETURN count(n)',
        test_results: 'insight-similarity-cron initial batch',
      },
      callId: uuid(),
      timeoutMs: 60_000,
    })

    const labelsAdded = extractCount(labelResult.result, 'added')

    // Step 2: compute similarity via vector index — produces at most TOP_K edges per source.
    // The id(src) < id(dst) guard keeps the relation canonical (one MERGE per pair).
    const simQuery = `
      MATCH (src:StrategicInsight)
      WHERE src.embedding IS NOT NULL
      CALL db.index.vector.queryNodes($indexName, $k, src.embedding)
        YIELD node AS dst, score
      WITH src, dst, score
      WHERE id(src) < id(dst)
        AND score >= $threshold
        AND dst:StrategicInsight
      MERGE (src)-[r:SIMILAR_TO]-(dst)
      ON CREATE SET r.score = score, r.created_at = datetime(), r.source = 'insight-similarity-cron', r.model = '384d-hf'
      ON MATCH SET r.score = score, r.refreshed_at = datetime()
      RETURN count(*) AS edges
    `

    const simResult = await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: simQuery,
        params: { indexName: VECTOR_INDEX, k: TOP_K, threshold: SIMILARITY_THRESHOLD },
        intent: 'Build SIMILAR_TO semantic fabric between StrategicInsights',
        purpose: 'Enable multi-hop retrieval on strategic insight graph',
        objective: 'Create canonical SIMILAR_TO edges with cosine score >= threshold',
        evidence: `threshold=${SIMILARITY_THRESHOLD}, top_k=${TOP_K}, vector_index=${VECTOR_INDEX}`,
        verification: 'MATCH (:StrategicInsight)-[r:SIMILAR_TO]-(:StrategicInsight) RETURN count(DISTINCT r)',
        test_results: 'insight-similarity-cron nightly batch',
      },
      callId: uuid(),
      timeoutMs: 180_000, // 3 min — full 7.9K-node pass with vector index should be well inside this
    })

    const edgesCreated = extractCount(simResult.result, 'edges')

    // Count coverage
    const srcResult = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: { query: 'MATCH (n:StrategicInsight) WHERE n.embedding IS NOT NULL RETURN count(n) AS n' },
      callId: uuid(),
      timeoutMs: 30_000,
    })
    const sourceNodes = extractCount(srcResult.result, 'n')

    const duration_ms = Date.now() - t0
    logger.info(
      { labels_added: labelsAdded, edges_created: edgesCreated, source_nodes: sourceNodes, duration_ms },
      'Insight similarity cron: complete'
    )

    return {
      labels_added: labelsAdded,
      edges_created: edgesCreated,
      source_nodes: sourceNodes,
      duration_ms,
      status: 'ok',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err: message }, 'Insight similarity cron: failed')
    return {
      labels_added: 0,
      edges_created: 0,
      source_nodes: 0,
      duration_ms: Date.now() - t0,
      status: 'error',
      error: message,
    }
  }
}

function extractCount(result: unknown, key: string): number {
  if (!result || typeof result !== 'object') return 0
  const r = result as { results?: Array<Record<string, unknown>> }
  const first = r.results?.[0]
  if (!first) return 0
  const val = first[key]
  if (typeof val === 'number') return val
  // Neo4j integer wire format: { low, high }
  if (val && typeof val === 'object' && 'low' in val) return (val as { low: number }).low
  return 0
}
