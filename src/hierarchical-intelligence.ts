/**
 * hierarchical-intelligence.ts — F3: Leiden Community Summaries (LIN-574 v3.0)
 *
 * Neo4j-native RAPTOR alternative:
 *   1. Run Leiden community detection via GDS (or Cypher fallback)
 *   2. For each community: collect member titles/descriptions → LLM summarize
 *   3. Store as :CommunitySummary nodes with 384D embeddings
 *   4. Create MEMBER_OF + PARENT_OF relationships
 *   5. Expose as 4th RAG channel in dual-rag.ts
 *
 * Designed to run as weekly cron + on-demand via API.
 */
import { v4 as uuid } from 'uuid'
import { callMcpTool } from './mcp-caller.js'
import { callCognitive } from './cognitive-proxy.js'
import { logger } from './logger.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommunityBuildResult {
  communities_created: number
  summaries_generated: number
  relationships_created: number
  levels: number
  duration_ms: number
  method: 'gds-leiden' | 'cypher-fallback'
}

interface CommunityData {
  community_id: number
  member_count: number
  members: Array<{ name: string; description: string; type: string }>
  domain: string
}

// ─── Main Builder ───────────────────────────────────────────────────────────

/**
 * Build hierarchical community summaries from the knowledge graph.
 * Runs Leiden → collect members → LLM summarize → MERGE nodes.
 */
export async function buildCommunitySummaries(): Promise<CommunityBuildResult> {
  const t0 = Date.now()
  logger.info('Hierarchical intelligence: building community summaries')

  // Step 1: Try GDS Leiden, fall back to Cypher-based clustering
  let communities: CommunityData[]
  let method: 'gds-leiden' | 'cypher-fallback'

  try {
    communities = await runLeidenCommunities()
    method = 'gds-leiden'
  } catch (err) {
    logger.warn({ error: String(err) }, 'GDS Leiden failed — using Cypher fallback')
    communities = await runCypherClustering()
    method = 'cypher-fallback'
  }

  if (communities.length === 0) {
    logger.info('No communities found — graph may be too sparse')
    return { communities_created: 0, summaries_generated: 0, relationships_created: 0, levels: 0, duration_ms: Date.now() - t0, method }
  }

  // Step 2: Generate LLM summaries for each community (parallel, max 5)
  let summariesGenerated = 0
  let relsCreated = 0
  const BATCH = 5

  for (let i = 0; i < communities.length; i += BATCH) {
    const batch = communities.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map(c => createCommunitySummary(c))
    )
    for (const r of results) {
      if (r.status === 'fulfilled') {
        summariesGenerated += r.value.summary ? 1 : 0
        relsCreated += r.value.rels_created
      }
    }
  }

  // Step 3: Cleanup old summaries (>30 days)
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MATCH (s:CommunitySummary) WHERE s.updatedAt < datetime() - duration('P30D') DETACH DELETE s`,
        _force: true,
      },
      callId: uuid(),
      timeoutMs: 10000,
    })
  } catch { /* non-critical */ }

  const result: CommunityBuildResult = {
    communities_created: communities.length,
    summaries_generated: summariesGenerated,
    relationships_created: relsCreated,
    levels: 1, // Single level for MVP; multi-level in future
    duration_ms: Date.now() - t0,
    method,
  }

  logger.info(result, 'Hierarchical intelligence: complete')
  return result
}

// ─── Step 1a: GDS Leiden ────────────────────────────────────────────────────

async function runLeidenCommunities(): Promise<CommunityData[]> {
  // Run Leiden via GDS Cypher API
  // First: project graph
  await callMcpTool({
    toolName: 'graph.write_cypher',
    args: {
      query: `CALL gds.graph.project('community-detect', '*', '*') YIELD graphName RETURN graphName`,
      _force: true,
    },
    callId: uuid(),
    timeoutMs: 30000,
  })

  // Run Leiden
  const leidenResult = await callMcpTool({
    toolName: 'graph.write_cypher',
    args: {
      query: `CALL gds.leiden.write('community-detect', { writeProperty: 'communityId' })
YIELD communityCount, modularity
RETURN communityCount, modularity`,
      _force: true,
    },
    callId: uuid(),
    timeoutMs: 60000,
  })

  // Drop projection
  await callMcpTool({
    toolName: 'graph.write_cypher',
    args: {
      query: `CALL gds.graph.drop('community-detect') YIELD graphName RETURN graphName`,
      _force: true,
    },
    callId: uuid(),
    timeoutMs: 10000,
  }).catch(() => {})

  // Collect community members (top 50 communities by size)
  return await collectCommunityMembers('communityId')
}

// ─── Step 1b: Cypher Fallback (no GDS) ──────────────────────────────────────

async function runCypherClustering(): Promise<CommunityData[]> {
  // Fallback: use domain grouping as "communities"
  // Group nodes by their domain property — produces domain-level clusters
  const result = await callMcpTool({
    toolName: 'graph.read_cypher',
    args: {
      query: `MATCH (n) WHERE n.domain IS NOT NULL
WITH n.domain AS domain, collect({name: coalesce(n.title, n.name, n.filename, ''), description: substring(coalesce(n.description, n.content, ''), 0, 200), type: labels(n)[0]}) AS members, count(*) AS cnt
WHERE cnt >= 5
RETURN domain, members[..20] AS members, cnt
ORDER BY cnt DESC LIMIT 30`,
    },
    callId: uuid(),
    timeoutMs: 15000,
  })

  if (result.status !== 'success') return []
  const rows = (result.result as any)?.results ?? result.result
  if (!Array.isArray(rows)) return []

  return rows.map((r: any, i: number) => ({
    community_id: i,
    member_count: typeof r.cnt === 'object' ? r.cnt.low : Number(r.cnt) || 0,
    members: Array.isArray(r.members) ? r.members : [],
    domain: String(r.domain ?? 'general'),
  }))
}

// ─── Collect members from Leiden result ─────────────────────────────────────

const SAFE_COMMUNITY_PROPS = new Set(['communityId', 'communityId2', 'leiden_community', 'louvain_community'])

async function collectCommunityMembers(propertyName: string): Promise<CommunityData[]> {
  if (!SAFE_COMMUNITY_PROPS.has(propertyName)) {
    logger.warn({ propertyName }, 'Rejected unsafe community property name')
    return []
  }
  const result = await callMcpTool({
    toolName: 'graph.read_cypher',
    args: {
      query: `MATCH (n) WHERE n.${propertyName} IS NOT NULL
WITH n.${propertyName} AS cid, collect({name: coalesce(n.title, n.name, n.filename, ''), description: substring(coalesce(n.description, n.content, ''), 0, 200), type: labels(n)[0]}) AS members, count(*) AS cnt
WHERE cnt >= 5
RETURN cid, members[..20] AS members, cnt, head(members).domain AS domain
ORDER BY cnt DESC LIMIT 50`,
    },
    callId: uuid(),
    timeoutMs: 15000,
  })

  if (result.status !== 'success') return []
  const rows = (result.result as any)?.results ?? result.result
  if (!Array.isArray(rows)) return []

  return rows.map((r: any) => ({
    community_id: typeof r.cid === 'object' ? r.cid.low : Number(r.cid) || 0,
    member_count: typeof r.cnt === 'object' ? r.cnt.low : Number(r.cnt) || 0,
    members: Array.isArray(r.members) ? r.members : [],
    domain: String(r.domain ?? 'general'),
  }))
}

// ─── Step 2: LLM Summary + MERGE ───────────────────────────────────────────

async function createCommunitySummary(community: CommunityData): Promise<{ summary: string | null; rels_created: number }> {
  // Generate summary via RLM cognitive
  const memberList = community.members
    .filter(m => m.name)
    .map(m => `- ${m.name} (${m.type}): ${m.description || 'no description'}`)
    .join('\n')

  if (!memberList) return { summary: null, rels_created: 0 }

  let summary: string | null = null
  try {
    const result = await callCognitive('analyze', {
      prompt: `Summarize this knowledge graph community in 2-3 sentences. Describe: what theme connects these entities, what they collectively represent, and their significance for consulting.

COMMUNITY (${community.member_count} members, domain: ${community.domain}):
${memberList}

Write a concise executive summary (max 100 words).`,
      context: { community_id: community.community_id, domain: community.domain },
      agent_id: 'hierarchical-intelligence',
    }, 20000)

    summary = String(result ?? '').trim()
    if (summary.length < 10) summary = null
  } catch {
    logger.debug({ community_id: community.community_id }, 'Community summary generation failed')
    return { summary: null, rels_created: 0 }
  }

  if (!summary) return { summary: null, rels_created: 0 }

  // MERGE CommunitySummary node
  const communityNodeId = `community-${community.community_id}-${community.domain}`
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (c:CommunitySummary {id: $id})
SET c.name = $name, c.summary = $summary, c.domain = $domain,
    c.member_count = $memberCount, c.level = 1, c.updatedAt = datetime()`,
        params: {
          id: communityNodeId,
          name: `${community.domain} Community (${community.member_count} members)`,
          summary,
          domain: community.domain,
          memberCount: community.member_count,
        },
        _force: true, // Infrastructure write
      },
      callId: uuid(),
      timeoutMs: 10000,
    })
  } catch (err) {
    logger.debug({ error: String(err) }, 'CommunitySummary MERGE failed')
    return { summary, rels_created: 0 }
  }

  // Create MEMBER_OF relationships from member nodes to community
  let relsCreated = 0
  const memberNames = community.members.filter(m => m.name).map(m => m.name).slice(0, 20)
  if (memberNames.length > 0) {
    try {
      const result = await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `MATCH (c:CommunitySummary {id: $communityId})
UNWIND $names AS memberName
MATCH (m) WHERE coalesce(m.title, m.name) = memberName
MERGE (m)-[:MEMBER_OF]->(c)
RETURN count(*) AS rels`,
          params: { communityId: communityNodeId, names: memberNames },
          _force: true,
        },
        callId: uuid(),
        timeoutMs: 10000,
      })
      if (result.status === 'success') {
        const rows = (result.result as any)?.results ?? result.result
        if (Array.isArray(rows) && rows[0]) {
          relsCreated = typeof rows[0].rels === 'object' ? rows[0].rels.low : Number(rows[0].rels) || 0
        }
      }
    } catch { /* best effort */ }
  }

  return { summary, rels_created: relsCreated }
}

// ─── RAG Channel: Community Summary Search ──────────────────────────────────

/**
 * Search community summaries for high-level thematic context.
 * Used as 4th channel in dual-rag.ts Hybrid RAG Router.
 */
export async function searchCommunitySummaries(
  query: string,
  maxResults = 5,
): Promise<Array<{ source: 'community'; content: string; score: number; metadata: Record<string, unknown> }>> {
  try {
    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `MATCH (c:CommunitySummary)
WHERE toLower(c.summary) CONTAINS toLower($keyword)
   OR toLower(c.domain) CONTAINS toLower($keyword)
   OR toLower(c.name) CONTAINS toLower($keyword)
RETURN c.id AS id, c.name AS name, c.summary AS summary, c.domain AS domain, c.member_count AS members
ORDER BY c.member_count DESC
LIMIT $limit`,
        params: {
          keyword: query.split(/\s+/).filter(w => w.length >= 3).slice(0, 3).join(' ').slice(0, 80),
          limit: maxResults,
        },
      },
      callId: uuid(),
      timeoutMs: 10000,
    })

    if (result.status !== 'success') return []
    const rows = (result.result as any)?.results ?? result.result
    if (!Array.isArray(rows)) return []

    return rows.map((r: any) => ({
      source: 'community' as const,
      content: `[Community: ${r.name}] ${r.summary}`,
      score: 0.75, // Community summaries are structurally relevant
      metadata: { id: r.id, domain: r.domain, members: r.members },
    }))
  } catch {
    return []
  }
}
