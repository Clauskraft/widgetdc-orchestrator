/**
 * memory-consolidator.ts — Semantic dedup and consolidation of AgentMemory nodes.
 *
 * Extends existing AgentMemory node type (per ADR-004: no new node types).
 * Honors Gate 2 idempotency — MERGE not CREATE.
 * Enforces 30-day TTL + <1000 nodes/agent budget.
 *
 * Relevance scoring: recency × importance × similarity
 */
import { logger } from '../logger.js'
import { config } from '../config.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MemoryNode {
  elementId: string
  agentId: string
  key: string
  value: string
  type: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export interface ConsolidationReport {
  agentId: string
  beforeCount: number
  afterCount: number
  merged: number
  expired: number
  pruned: number
  relevanceThreshold: number
  durationMs: number
}

export interface SearchResult {
  elementId: string
  agentId: string
  key: string
  value: string
  type: string
  tags?: string[]
  relevance: number
  createdAt: string
}

// ─── MCP call helper ─────────────────────────────────────────────────────────

async function mcpCall(tool: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
    },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(30000),
  })
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return data?.result ?? data
}

// ─── Fetch AgentMemory nodes for an agent ────────────────────────────────────

export async function fetchAgentMemories(agentId: string, limit = 2000): Promise<MemoryNode[]> {
  const result = await mcpCall('graph.read_cypher', {
    query: `MATCH (m:AgentMemory {agentId: $agentId})
            RETURN m.elementId AS elementId, m.agentId AS agentId, m.key AS key,
                   m.value AS value, m.type AS type, m.tags AS tags,
                   toString(m.createdAt) AS createdAt, toString(m.updatedAt) AS updatedAt
            ORDER BY m.updatedAt DESC
            LIMIT $limit`,
    params: { agentId, limit },
  }) as { results?: Array<Record<string, unknown>> } | unknown

  const results = (result as any)?.results ?? (Array.isArray(result) ? result : [])
  return results.map((r: Record<string, unknown>) => ({
    elementId: String(r.elementId ?? ''),
    agentId: String(r.agentId ?? agentId),
    key: String(r.key ?? ''),
    value: String(r.value ?? ''),
    type: String(r.type ?? 'unknown'),
    tags: Array.isArray(r.tags) ? r.tags as string[] : undefined,
    createdAt: String(r.createdAt ?? ''),
    updatedAt: String(r.updatedAt ?? ''),
  }))
}

// ─── Text similarity (Jaccard on word tokens) ────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9æøå\s]/g, '').split(/\s+/).filter(Boolean))
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a)
  const setB = tokenize(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const t of setA) { if (setB.has(t)) intersection++ }
  return intersection / (setA.size + setB.size - intersection)
}

// ─── Relevance scoring ───────────────────────────────────────────────────────

/**
 * Relevance = recency × importance × similarity
 *
 * recency: exp(-ageDays / 30) → 1.0 for fresh, ~0.37 for 30 days old
 * importance: based on type (closure=1.0, claim=0.8, lesson=0.9, insight=0.7, default=0.5)
 * similarity: 1.0 for standalone, reduced for near-duplicates
 */
const IMPORTANCE_WEIGHTS: Record<string, number> = {
  closure: 1.0,
  lesson: 0.9,
  claim: 0.8,
  insight: 0.7,
  heartbeat: 0.3,
  a2a_message: 0.4,
  default: 0.5,
}

export function computeRelevance(
  updatedAt: string,
  type: string,
  similarityToBest = 1.0,
): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime()
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24))
  const recency = Math.exp(-ageDays / 30)
  const importance = IMPORTANCE_WEIGHTS[type] ?? IMPORTANCE_WEIGHTS.default
  return Math.round(recency * importance * similarityToBest * 1000) / 1000
}

// ─── Find and merge duplicates ──────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.6 // Jaccard threshold for considering nodes duplicates

export interface MergeGroup {
  survivor: MemoryNode
  victims: MemoryNode[]
  similarity: number
}

export function findDuplicates(memories: MemoryNode[]): MergeGroup[] {
  const groups: MergeGroup[] = []
  const used = new Set<string>()

  for (let i = 0; i < memories.length; i++) {
    if (used.has(memories[i].elementId)) continue
    const group: MergeGroup = { survivor: memories[i], victims: [], similarity: 0 }

    for (let j = i + 1; j < memories.length; j++) {
      if (used.has(memories[j].elementId)) continue
      const sim = jaccardSimilarity(memories[i].value, memories[j].value)
      if (sim >= SIMILARITY_THRESHOLD) {
        used.add(memories[j].elementId)
        group.victims.push(memories[j])
        group.similarity = Math.max(group.similarity, sim)
      }
    }

    if (group.victims.length > 0) {
      used.add(memories[i].elementId)
      groups.push(group)
    }
  }

  return groups
}

// ─── Execute consolidation for an agent ──────────────────────────────────────

const MAX_MEMORIES_PER_AGENT = 1000
const TTL_DAYS = 30

export async function consolidateAgent(agentId: string): Promise<ConsolidationReport> {
  const t0 = Date.now()
  const memories = await fetchAgentMemories(agentId)
  const beforeCount = memories.length

  let merged = 0
  let expired = 0
  let pruned = 0

  // Step 1: Expire old nodes (>30 days, except closure/lesson types)
  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const expiryCandidates = memories.filter(m =>
    m.updatedAt < cutoff &&
    m.type !== 'closure' &&
    m.type !== 'lesson'
  )

  for (const m of expiryCandidates) {
    await mcpCall('graph.write_cypher', {
      query: `MATCH (m:AgentMemory {agentId: $agentId, key: $key}) WHERE m.updatedAt < datetime($cutoff) DETACH DELETE m`,
      params: { agentId, key: m.key, cutoff },
    })
    expired++
  }

  // Step 2: Merge duplicates
  const active = memories.filter(m => !expiryCandidates.includes(m))
  const groups = findDuplicates(active)

  for (const group of groups) {
    // Merge victim content into survivor
    const mergedValue = group.victims.map(v => v.value).join('\n---\n')
    const mergedTags = [...new Set([
      ...(group.survivor.tags ?? []),
      ...group.victims.flatMap(v => v.tags ?? []),
    ])]

    // P1 fix: warn on silent truncation instead of dropping data
    const MAX_MERGED_VALUE = 4000
    let finalValue = mergedValue
    let truncated = false
    if (mergedValue.length > MAX_MERGED_VALUE) {
      finalValue = mergedValue.slice(0, MAX_MERGED_VALUE)
      truncated = true
      logger.warn({
        agentId,
        key: group.survivor.key,
        originalLength: mergedValue.length,
        truncatedTo: MAX_MERGED_VALUE,
        victims: group.victims.length,
      }, 'Memory consolidation truncated merged value')
    }

    await mcpCall('graph.write_cypher', {
      query: `MATCH (m:AgentMemory {agentId: $agentId, key: $key})
              SET m.value = $value, m.tags = $tags, m.updatedAt = datetime(),
                  m.consolidatedFrom = $victimCount, m.consolidatedAt = datetime(),
                  m.consolidationTruncated = $truncated`,
      params: {
        agentId,
        key: group.survivor.key,
        value: finalValue,
        tags: mergedTags,
        victimCount: group.victims.length,
        truncated,
      },
    })

    // Delete victim nodes (DETACH to handle relationships)
    for (const victim of group.victims) {
      await mcpCall('graph.write_cypher', {
        query: `MATCH (m:AgentMemory {agentId: $agentId, key: $key}) DETACH DELETE m`,
        params: { agentId, key: victim.key },
      })
    }
    merged += group.victims.length
  }

  // Step 3: Enforce node budget (delete least relevant if over limit)
  const remaining = await fetchAgentMemories(agentId)
  if (remaining.length > MAX_MEMORIES_PER_AGENT) {
    // Score and sort by relevance
    const scored = remaining.map(m => ({
      ...m,
      relevance: computeRelevance(m.updatedAt, m.type),
    }))
    scored.sort((a, b) => a.relevance - b.relevance)

    const toPrune = scored.slice(0, scored.length - MAX_MEMORIES_PER_AGENT)
    for (const m of toPrune) {
      await mcpCall('graph.write_cypher', {
        query: `MATCH (m:AgentMemory {agentId: $agentId, key: $key}) DETACH DELETE m`,
        params: { agentId, key: m.key },
      })
      pruned++
    }
  }

  // P1 fix: actual count via COUNT query (was capped at 10 via limited fetch)
  const countResult = await mcpCall('graph.read_cypher', {
    query: `MATCH (m:AgentMemory {agentId: $agentId}) RETURN count(m) AS total`,
    params: { agentId },
  }) as { results?: Array<Record<string, unknown>> } | unknown
  const countRows = (countResult as any)?.results ?? []
  const afterCount = Number((countRows[0] as Record<string, unknown> | undefined)?.total ?? 0)
  const durationMs = Date.now() - t0

  const report: ConsolidationReport = {
    agentId,
    beforeCount,
    afterCount,
    merged,
    expired,
    pruned,
    relevanceThreshold: computeRelevance(
      new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      'default',
    ),
    durationMs,
  }

  logger.info(report, 'Memory consolidation complete')
  return report
}

// ─── Consolidate all agents ─────────────────────────────────────────────────

export async function consolidateAll(): Promise<ConsolidationReport[]> {
  // Get all unique agentIds with AgentMemory nodes
  const result = await mcpCall('graph.read_cypher', {
    query: `MATCH (m:AgentMemory) RETURN DISTINCT m.agentId AS agentId ORDER BY m.agentId`,
    params: {},
  }) as { results?: Array<Record<string, unknown>> } | unknown

  const agentIds = ((result as any)?.results ?? (Array.isArray(result) ? result : []))
    .map((r: Record<string, unknown>) => String(r.agentId ?? ''))
    .filter(Boolean)

  const reports: ConsolidationReport[] = []
  for (const agentId of agentIds) {
    try {
      const report = await consolidateAgent(agentId)
      reports.push(report)
    } catch (err) {
      logger.error({ agentId, err: String(err) }, 'Consolidation failed for agent')
    }
  }

  return reports
}

// ─── Memory search with relevance scoring ────────────────────────────────────

export interface MemorySearchOpts {
  agentId?: string
  type?: string
  tags?: string[]
  query?: string
  limit?: number
  minRelevance?: number
}

export async function searchMemories(opts: MemorySearchOpts): Promise<SearchResult[]> {
  const { agentId, type, tags, query, limit = 50, minRelevance = 0 } = opts

  // Build Cypher query with filters
  let whereClauses: string[] = []
  let params: Record<string, unknown> = {}

  if (agentId) {
    whereClauses.push('m.agentId = $agentId')
    params.agentId = agentId
  }
  if (type) {
    whereClauses.push('m.type = $type')
    params.type = type
  }
  if (tags && tags.length > 0) {
    whereClauses.push('ANY(t IN m.tags WHERE t IN $tags)')
    params.tags = tags
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  const result = await mcpCall('graph.read_cypher', {
    query: `MATCH (m:AgentMemory) ${where}
            RETURN m.elementId AS elementId, m.agentId AS agentId, m.key AS key,
                   m.value AS value, m.type AS type, m.tags AS tags,
                   toString(m.createdAt) AS createdAt, toString(m.updatedAt) AS updatedAt
            ORDER BY m.updatedAt DESC
            LIMIT $limit`,
    params: { ...params, limit: limit * 3 }, // Fetch extra for relevance filtering
  }) as { results?: Array<Record<string, unknown>> } | unknown

  const results = (result as any)?.results ?? (Array.isArray(result) ? result : [])
  const memories: MemoryNode[] = results.map((r: Record<string, unknown>) => ({
    elementId: String(r.elementId ?? ''),
    agentId: String(r.agentId ?? ''),
    key: String(r.key ?? ''),
    value: String(r.value ?? ''),
    type: String(r.type ?? 'unknown'),
    tags: Array.isArray(r.tags) ? r.tags as string[] : undefined,
    createdAt: String(r.createdAt ?? ''),
    updatedAt: String(r.updatedAt ?? ''),
  }))

  // Score and filter by relevance
  let scored = memories.map(m => ({
    elementId: m.elementId,
    agentId: m.agentId,
    key: m.key,
    value: m.value,
    type: m.type,
    tags: m.tags,
    relevance: computeRelevance(m.updatedAt, m.type),
    createdAt: m.createdAt,
  }))

  // If query provided, add text similarity boost
  if (query) {
    scored = scored.map(s => {
      const textSim = jaccardSimilarity(query, s.value)
      const boosted = s.relevance * 0.7 + textSim * 0.3
      return { ...s, relevance: Math.round(boosted * 1000) / 1000 }
    })
  }

  scored = scored.filter(s => s.relevance >= minRelevance)
  scored.sort((a, b) => b.relevance - a.relevance)

  return scored.slice(0, limit)
}

// ─── Memory store with Gate 2 idempotency ────────────────────────────────────

export interface MemoryStoreOpts {
  agentId: string
  key: string
  value: string
  type?: string
  tags?: string[]
  scope?: string
}

/**
 * Store memory with MERGE idempotency (Gate 2).
 * If the same agentId+key exists, it updates rather than creates duplicate.
 */
export async function storeMemoryLongTerm(opts: MemoryStoreOpts): Promise<{ stored: boolean; key: string }> {
  const { agentId, key, value, type = 'insight', tags = [], scope } = opts
  const allTags = [...new Set([...tags, ...(scope ? [`scope:${scope}`] : [])])]

  await mcpCall('graph.write_cypher', {
    query: `MERGE (m:AgentMemory {agentId: $agentId, key: $key})
            SET m.value = $value, m.type = $type, m.tags = $tags,
                m.scope = $scope, m.updatedAt = datetime(),
                m.createdAt = COALESCE(m.createdAt, datetime())`,
    params: {
      agentId,
      key,
      value: value.slice(0, 4000), // Cap at 4KB
      type,
      tags: allTags,
      scope: scope ?? null,
    },
  })

  logger.info({ agentId, key, type, tags: allTags.length }, 'Long-term memory stored')
  return { stored: true, key }
}
