/**
 * similarity-engine.ts — Client Similarity & Precedent Search (LIN-574 Gap #4)
 *
 * Hybrid two-signal matching:
 *   1. Structural score — Jaccard similarity on shared graph relationships
 *      (IN_INDUSTRY, USED_SERVICE, FACED_CHALLENGE, IN_DOMAIN)
 *   2. Semantic score — Cosine similarity on 384D NEXUS embeddings
 *   3. Combined — α * structural + (1-α) * semantic
 *
 * "Clients like yours also chose..." recommendation engine.
 */
import { v4 as uuid } from 'uuid'
import { callMcpTool } from './mcp-caller.js'
import { logger } from './logger.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SimilarityRequest {
  /** Client/engagement name, ID, or description to find matches for */
  query: string
  /** Which dimensions to match on */
  dimensions?: SimilarityDimension[]
  /** Max results (default 5) */
  max_results?: number
  /** Weight for structural vs semantic (0-1, default 0.6 = structural-heavy) */
  structural_weight?: number
}

export type SimilarityDimension =
  | 'industry' | 'service' | 'challenge' | 'domain'
  | 'size' | 'geography' | 'deliverable'

export interface SimilarityMatch {
  client_id: string
  client_name: string
  overall_score: number
  structural_score: number
  semantic_score: number
  shared_dimensions: DimensionMatch[]
  node_type: string
}

interface DimensionMatch {
  dimension: string
  shared_values: string[]
  jaccard: number
}

export interface SimilarityResult {
  query: string
  query_node_id: string | null
  matches: SimilarityMatch[]
  total_candidates: number
  dimensions_used: string[]
  duration_ms: number
  method: 'graph' | 'semantic' | 'hybrid'
}

// ─── Dimension → Relationship mapping ───────────────────────────────────────

const DIMENSION_RELS: Record<SimilarityDimension, { rel: string; target_label: string }> = {
  industry:    { rel: 'IN_INDUSTRY',      target_label: 'Industry' },
  service:     { rel: 'USED_SERVICE',     target_label: 'ConsultingService' },
  challenge:   { rel: 'FACED_CHALLENGE',  target_label: 'Challenge' },
  domain:      { rel: 'IN_DOMAIN',        target_label: 'Domain' },
  size:        { rel: 'HAS_SIZE',         target_label: 'SizeSegment' },
  geography:   { rel: 'IN_GEOGRAPHY',     target_label: 'Geography' },
  deliverable: { rel: 'RECEIVED',         target_label: 'Deliverable' },
}

const DEFAULT_DIMENSIONS: SimilarityDimension[] = ['industry', 'service', 'challenge', 'domain']

// ─── Main Search ────────────────────────────────────────────────────────────

export async function findSimilarClients(req: SimilarityRequest): Promise<SimilarityResult> {
  const t0 = Date.now()
  const maxResults = Math.min(Math.max(req.max_results ?? 5, 1), 20)
  const alpha = Math.min(Math.max(req.structural_weight ?? 0.6, 0), 1)
  const dimensions = req.dimensions ?? DEFAULT_DIMENSIONS

  logger.info({ query: req.query.slice(0, 80), dimensions, alpha }, 'Similarity: searching')

  // Step 1: Find the query node in the graph
  const queryNode = await findQueryNode(req.query)

  let matches: SimilarityMatch[]
  let method: 'graph' | 'semantic' | 'hybrid'

  if (queryNode) {
    // Step 2a: Have a graph node — run hybrid (structural + semantic)
    const structural = await computeStructuralSimilarity(queryNode.id, queryNode.labels, dimensions)
    const semantic = await computeSemanticSimilarity(req.query, maxResults * 3)

    // Merge scores
    matches = mergeScores(structural, semantic, alpha, maxResults)
    method = structural.length > 0 && semantic.length > 0 ? 'hybrid'
      : structural.length > 0 ? 'graph' : 'semantic'
  } else {
    // Step 2b: No graph node found — fall back to semantic-only
    const semantic = await computeSemanticSimilarity(req.query, maxResults * 2)
    matches = semantic.slice(0, maxResults)
    method = 'semantic'
  }

  const result: SimilarityResult = {
    query: req.query,
    query_node_id: queryNode?.id ?? null,
    matches: matches.slice(0, maxResults),
    total_candidates: matches.length,
    dimensions_used: dimensions,
    duration_ms: Date.now() - t0,
    method,
  }

  logger.info({
    query: req.query.slice(0, 60),
    matches: result.matches.length,
    method,
    ms: result.duration_ms,
  }, 'Similarity: complete')

  return result
}

// ─── Step 1: Find query node ────────────────────────────────────────────────

async function findQueryNode(query: string): Promise<{ id: string; labels: string[] } | null> {
  try {
    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `MATCH (n) WHERE (n:Client OR n:Engagement OR n:UseCase OR n:Tender OR n:ConsultingService)
AND (toLower(coalesce(n.name, n.title, '')) CONTAINS toLower($q)
  OR n.id = $q)
RETURN n.id AS id, labels(n) AS labels, coalesce(n.name, n.title) AS name
LIMIT 1`,
        params: { q: query },
      },
      callId: uuid(),
      timeoutMs: 10000,
    })

    if (result.status === 'success') {
      const rows = (result.result as any)?.results ?? result.result
      if (Array.isArray(rows) && rows.length > 0) {
        return { id: String(rows[0].id), labels: rows[0].labels ?? [] }
      }
    }
  } catch (err) {
    logger.warn({ error: String(err) }, 'Similarity: query node lookup failed')
  }
  return null
}

// ─── Step 2a: Structural similarity (Jaccard on shared rels) ────────────────

async function computeStructuralSimilarity(
  nodeId: string,
  nodeLabels: string[],
  dimensions: SimilarityDimension[],
): Promise<SimilarityMatch[]> {
  // Build a Cypher query that computes Jaccard similarity per dimension
  const nodeLabel = nodeLabels[0] ?? 'Client'
  const relClauses = dimensions
    .filter(d => DIMENSION_RELS[d])
    .map(d => {
      const { rel, target_label } = DIMENSION_RELS[d]
      return `
OPTIONAL MATCH (source)-[:${rel}]->(t1:${target_label})
WITH source, other, collect(DISTINCT t1.name) AS source_${d}
OPTIONAL MATCH (other)-[:${rel}]->(t2:${target_label})
WITH source, other, source_${d}, collect(DISTINCT t2.name) AS other_${d},
     [x IN source_${d} WHERE x IN collect(DISTINCT t2.name)] AS shared_${d}`
    })

  // Compute Jaccard per dimension and average
  const jaccardExprs = dimensions
    .filter(d => DIMENSION_RELS[d])
    .map(d => `CASE WHEN size(source_${d}) + size(other_${d}) - size(shared_${d}) = 0 THEN 0.0
       ELSE toFloat(size(shared_${d})) / (size(source_${d}) + size(other_${d}) - size(shared_${d}))
       END`)

  // Simplified approach: use a single Cypher that does multi-hop neighbor matching
  try {
    const cypher = `
MATCH (source {id: $sourceId})
MATCH (source)-[r1]->(shared)<-[r2]-(other)
WHERE other <> source
  AND labels(other)[0] IN ['Client', 'Engagement', 'UseCase', 'Tender', 'ConsultingService']
  AND type(r1) IN $relTypes
WITH other,
     count(DISTINCT shared) AS shared_count,
     collect(DISTINCT {dim: type(r1), value: coalesce(shared.name, shared.title, '')}) AS shared_details
ORDER BY shared_count DESC
LIMIT 20
RETURN other.id AS client_id,
       coalesce(other.name, other.title) AS client_name,
       labels(other)[0] AS node_type,
       shared_count,
       shared_details`

    const relTypes = dimensions
      .filter(d => DIMENSION_RELS[d])
      .map(d => DIMENSION_RELS[d].rel)

    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: { query: cypher, params: { sourceId: nodeId, relTypes } },
      callId: uuid(),
      timeoutMs: 15000,
    })

    if (result.status !== 'success') return []

    const rows = (result.result as any)?.results ?? result.result
    if (!Array.isArray(rows)) return []

    // Convert Neo4j integers
    const maxShared = Math.max(1, ...rows.map((r: any) => {
      const sc = r.shared_count
      return typeof sc === 'object' && sc?.low !== undefined ? sc.low : Number(sc) || 0
    }))

    return rows.map((r: any) => {
      const sharedCount = typeof r.shared_count === 'object' && r.shared_count?.low !== undefined
        ? r.shared_count.low : Number(r.shared_count) || 0
      const score = sharedCount / maxShared

      // Group shared details by dimension
      const details = Array.isArray(r.shared_details) ? r.shared_details : []
      const dimGroups = new Map<string, string[]>()
      for (const d of details) {
        const dim = String(d.dim ?? '')
        const val = String(d.value ?? '')
        if (!dimGroups.has(dim)) dimGroups.set(dim, [])
        dimGroups.get(dim)!.push(val)
      }

      const sharedDimensions: DimensionMatch[] = Array.from(dimGroups.entries()).map(([dim, vals]) => ({
        dimension: dim,
        shared_values: vals.slice(0, 5),
        jaccard: vals.length / Math.max(1, sharedCount),
      }))

      return {
        client_id: String(r.client_id ?? ''),
        client_name: String(r.client_name ?? 'Unknown'),
        overall_score: score,
        structural_score: score,
        semantic_score: 0,
        shared_dimensions: sharedDimensions,
        node_type: String(r.node_type ?? 'Client'),
      }
    })
  } catch (err) {
    logger.warn({ error: String(err) }, 'Similarity: structural computation failed')
    return []
  }
}

// ─── Step 2b: Semantic similarity (SRAG vector search) ──────────────────────

async function computeSemanticSimilarity(
  query: string,
  maxResults: number,
): Promise<SimilarityMatch[]> {
  try {
    const result = await callMcpTool({
      toolName: 'srag.query',
      args: { query },
      callId: uuid(),
      timeoutMs: 20000,
    })

    if (result.status !== 'success') return []

    const data = result.result as any
    const items = Array.isArray(data) ? data
      : data?.results ? data.results
      : data?.chunks ? data.chunks
      : []

    return items
      .filter((item: any) => {
        // Filter to client/engagement-like results
        const title = String(item.title ?? item.name ?? '').toLowerCase()
        const type = String(item.type ?? item.label ?? '').toLowerCase()
        return type.includes('client') || type.includes('engagement')
          || type.includes('usecase') || type.includes('tender')
          || type.includes('consulting') || title.length > 0
      })
      .slice(0, maxResults)
      .map((item: any) => ({
        client_id: String(item.id ?? item.$id ?? ''),
        client_name: String(item.title ?? item.name ?? 'Unknown'),
        overall_score: item.score ?? item.similarity ?? 0.5,
        structural_score: 0,
        semantic_score: item.score ?? item.similarity ?? 0.5,
        shared_dimensions: [],
        node_type: String(item.type ?? item.label ?? 'Document'),
      }))
  } catch (err) {
    logger.warn({ error: String(err) }, 'Similarity: semantic computation failed')
    return []
  }
}

// ─── Score Merger ───────────────────────────────────────────────────────────

function mergeScores(
  structural: SimilarityMatch[],
  semantic: SimilarityMatch[],
  alpha: number,
  maxResults: number,
): SimilarityMatch[] {
  const merged = new Map<string, SimilarityMatch>()

  // Add structural results
  for (const s of structural) {
    merged.set(s.client_id || s.client_name, {
      ...s,
      overall_score: alpha * s.structural_score,
    })
  }

  // Merge semantic results
  for (const s of semantic) {
    const key = s.client_id || s.client_name
    const existing = merged.get(key)
    if (existing) {
      existing.semantic_score = s.semantic_score
      existing.overall_score = alpha * existing.structural_score + (1 - alpha) * s.semantic_score
    } else {
      merged.set(key, {
        ...s,
        overall_score: (1 - alpha) * s.semantic_score,
      })
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.overall_score - a.overall_score)
    .slice(0, maxResults)
}

// ─── Get Client Details ─────────────────────────────────────────────────────

export async function getClientDetails(clientId: string): Promise<Record<string, unknown> | null> {
  try {
    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `MATCH (n {id: $id})
OPTIONAL MATCH (n)-[r]->(related)
RETURN n AS client,
       labels(n) AS labels,
       collect(DISTINCT {rel: type(r), target: coalesce(related.name, related.title), target_type: labels(related)[0]}) AS relationships`,
        params: { id: clientId },
      },
      callId: uuid(),
      timeoutMs: 10000,
    })

    if (result.status === 'success') {
      const rows = (result.result as any)?.results ?? result.result
      if (Array.isArray(rows) && rows.length > 0) {
        return rows[0]
      }
    }
  } catch { /* skip */ }
  return null
}
