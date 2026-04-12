/**
 * memory-consolidator.ts — Semantic dedup and consolidation of AgentMemory nodes.
 *
 * Extends existing AgentMemory node type (per ADR-004: no new node types).
 * Honors Gate 2 idempotency — MERGE not CREATE.
 * CoALA memory taxonomy: tier-aware TTL + consolidation rules.
 *
 * Relevance scoring: recency × importance × similarity × tier_weight
 */
import { logger } from '../logger.js'
import { config } from '../config.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export type CoalaTier = 'working' | 'short' | 'episodic' | 'semantic' | 'procedural'

export interface MemoryNode {
  elementId: string
  agentId: string
  key: string
  value: string
  type: string
  tier?: CoalaTier
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
  tier?: CoalaTier
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

export async function fetchAgentMemories(
  agentId: string,
  opts: { limit?: number; tier?: CoalaTier | CoalaTier[] } = {},
): Promise<MemoryNode[]> {
  const limit = opts.limit ?? 2000
  const tiers = opts.tier ? (Array.isArray(opts.tier) ? opts.tier : [opts.tier]) : null

  const tierFilter = tiers ? `AND m.tier IN $tiers` : ''

  const result = await mcpCall('graph.read_cypher', {
    query: `MATCH (m:AgentMemory {agentId: $agentId})
            WHERE true ${tierFilter}
            RETURN m.elementId AS elementId, m.agentId AS agentId, m.key AS key,
                   m.value AS value, m.type AS type, m.tier AS tier, m.tags AS tags,
                   toString(m.createdAt) AS createdAt, toString(m.updatedAt) AS updatedAt
            ORDER BY m.updatedAt DESC
            LIMIT $limit`,
    params: { agentId, limit, tiers },
  }) as { results?: Array<Record<string, unknown>> } | unknown

  const results = (result as any)?.results ?? (Array.isArray(result) ? result : [])
  return results.map((r: Record<string, unknown>) => ({
    elementId: String(r.elementId ?? ''),
    agentId: String(r.agentId ?? agentId),
    key: String(r.key ?? ''),
    value: String(r.value ?? ''),
    type: String(r.type ?? 'unknown'),
    tier: (r.tier ?? undefined) as CoalaTier | undefined,
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

// ─── Relevance scoring (CoALA tier-aware) ────────────────────────────────────

/**
 * Relevance = recency × importance × similarity × tier_weight
 *
 * CoALA tier weights:
 *   working:    0.1 (ephemeral, never consolidated)
 *   short:      0.5 (recent, consolidated daily)
 *   episodic:   1.0 (event traces, consolidated weekly) — existing default
 *   semantic:   1.2 (facts/patterns, never expired, merge via similarity)
 *   procedural: 1.1 (skills/routines, never expired, promoted via V9 quality loop)
 */
const TIER_WEIGHTS: Record<CoalaTier, number> = {
  working: 0.1,
  short: 0.5,
  episodic: 1.0,
  semantic: 1.2,
  procedural: 1.1,
}

const IMPORTANCE_WEIGHTS: Record<string, number> = {
  closure: 1.0,
  lesson: 0.9,
  claim: 0.8,
  insight: 0.7,
  heartbeat: 0.3,
  a2a_message: 0.4,
  default: 0.5,
}

/** CoALA tier defaults when type doesn't map cleanly */
const TYPE_TO_TIER: Record<string, CoalaTier> = {
  heartbeat: 'working',
  a2a_message: 'working',
  claim: 'short',
  wip: 'short',
  closure: 'episodic',
  broadcast: 'episodic',
  teaching: 'semantic',
  intelligence: 'semantic',
  insight: 'semantic',
  fact: 'semantic',
  lesson: 'semantic',
  skill: 'procedural',
  prompt: 'procedural',
  procedure: 'procedural',
}

/** CoALA TTL per tier (in days) */
const TIER_TTL_DAYS: Record<CoalaTier, number> = {
  working: 1 / 288,    // 5 minutes
  short: 1,            // 24 hours
  episodic: 30,        // 30 days
  semantic: 3650,      // ~10 years (effectively persistent)
  procedural: 3650,    // ~10 years (effectively persistent)
}

/** Whether this tier should be considered for consolidation expiry */
const TIER_CONSOLIDATABLE: Record<CoalaTier, boolean> = {
  working: false,       // never consolidated
  short: true,          // consolidated daily
  episodic: true,       // consolidated weekly
  semantic: false,      // never expired, merge via similarity only
  procedural: false,    // never expired, promoted via V9 quality loop
}

export function computeRelevance(
  updatedAt: string,
  type: string,
  tier?: CoalaTier,
  similarityToBest = 1.0,
): number {
  const resolvedTier = tier ?? TYPE_TO_TIER[type] ?? 'short'
  const tierWeight = TIER_WEIGHTS[resolvedTier] ?? 1.0

  const ageMs = Date.now() - new Date(updatedAt).getTime()
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24))
  const ttlDays = TIER_TTL_DAYS[resolvedTier] ?? 30
  const recency = Math.exp(-ageDays / ttlDays)
  const importance = IMPORTANCE_WEIGHTS[type] ?? IMPORTANCE_WEIGHTS.default
  return Math.round(recency * importance * tierWeight * similarityToBest * 1000) / 1000
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

// ─── Execute consolidation for an agent (CoALA tier-aware) ──────────────────

const MAX_MEMORIES_PER_AGENT = 1000

export async function consolidateAgent(
  agentId: string,
  opts: { tier?: CoalaTier | CoalaTier[] } = {},
): Promise<ConsolidationReport> {
  const t0 = Date.now()
  const memories = await fetchAgentMemories(agentId, { tier: opts.tier })
  const beforeCount = memories.length

  let merged = 0
  let expired = 0
  let pruned = 0

  // CoALA tier-aware expiry rules
  const now = Date.now()
  const expiryCandidates = memories.filter(m => {
    const tier = m.tier ?? TYPE_TO_TIER[m.type] ?? 'short'
    // Never expire non-consolidatable tiers
    if (!TIER_CONSOLIDATABLE[tier]) return false
    const ttlMs = TIER_TTL_DAYS[tier] * 24 * 60 * 60 * 1000
    const ageMs = now - new Date(m.updatedAt).getTime()
    return ageMs > ttlMs
  })

  for (const m of expiryCandidates) {
    try {
      await mcpCall('graph.write_cypher', {
        query: `MATCH (m:AgentMemory {agentId: $agentId, key: $key}) DETACH DELETE m`,
        params: { agentId, key: m.key },
      })
      expired++
    } catch {
      // Node may have been deleted by another process — skip silently
    }
  }

  // Step 2: Merge duplicates (only consolidatable tiers)
  const active = memories.filter(m => {
    if (expiryCandidates.includes(m)) return false
    const tier = m.tier ?? TYPE_TO_TIER[m.type] ?? 'short'
    return TIER_CONSOLIDATABLE[tier]
  })
  const groups = findDuplicates(active)

  for (const group of groups) {
    // Merge victim content into survivor
    const mergedValue = group.victims.map(v => v.value).join('\n---\n')
    const mergedTags = Array.from(new Set([
      ...(group.survivor.tags ?? []),
      ...group.victims.flatMap(v => v.tags ?? []),
    ]))

    // Warn on silent truncation instead of dropping data
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

    try {
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
    } catch {
      // Node may have been deleted — skip silently
    }
  }

  // Step 3: Enforce node budget (delete least relevant if over limit)
  const remaining = await fetchAgentMemories(agentId)
  if (remaining.length > MAX_MEMORIES_PER_AGENT) {
    // Score and sort by relevance
    const scored = remaining.map(m => {
      const tier = m.tier ?? TYPE_TO_TIER[m.type] ?? 'short'
      return {
        ...m,
        relevance: computeRelevance(m.updatedAt, m.type, tier),
      }
    })
    scored.sort((a, b) => a.relevance - b.relevance)

    const toPrune = scored.slice(0, scored.length - MAX_MEMORIES_PER_AGENT)
    for (const m of toPrune) {
      // Never prune semantic or procedural memories
      const tier = m.tier ?? TYPE_TO_TIER[m.type] ?? 'short'
      if (!TIER_CONSOLIDATABLE[tier]) continue

      try {
        await mcpCall('graph.write_cypher', {
          query: `MATCH (m:AgentMemory {agentId: $agentId, key: $key}) DETACH DELETE m`,
          params: { agentId, key: m.key },
        })
        pruned++
      } catch {
        // Node may have been deleted — skip silently
      }
    }
  }

  // Step 4: Backfill tier on nodes that lack it
  const needsTier = memories.filter(m => !m.tier)
  for (const m of needsTier) {
    const inferredTier = TYPE_TO_TIER[m.type] ?? 'short'
    try {
      await mcpCall('graph.write_cypher', {
        query: `MATCH (m:AgentMemory {agentId: $agentId, key: $key}) SET m.tier = $tier`,
        params: { agentId, key: m.key, tier: inferredTier },
      })
    } catch {
      // Node may have been deleted — skip silently
    }
  }

  const afterCount = (await fetchAgentMemories(agentId, { limit: 10 })).length
  const durationMs = Date.now() - t0

  const report: ConsolidationReport = {
    agentId,
    beforeCount,
    afterCount,
    merged,
    expired,
    pruned,
    relevanceThreshold: computeRelevance(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      'default',
      'episodic',
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

// ─── Memory search with CoALA tier-aware relevance scoring ───────────────────

export interface MemorySearchOpts {
  agentId?: string
  type?: string
  tier?: CoalaTier | CoalaTier[]    // CoALA tier filter
  tags?: string[]
  query?: string
  limit?: number
  minRelevance?: number
}

export async function searchMemories(opts: MemorySearchOpts): Promise<SearchResult[]> {
  const { agentId, type, tier, tags, query, limit = 50, minRelevance = 0 } = opts
  const tiers = tier ? (Array.isArray(tier) ? tier : [tier]) : null

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
  if (tiers && tiers.length > 0) {
    whereClauses.push('m.tier IN $tiers')
    params.tiers = tiers
  }
  if (tags && tags.length > 0) {
    whereClauses.push('ANY(t IN m.tags WHERE t IN $tags)')
    params.tags = tags
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  const result = await mcpCall('graph.read_cypher', {
    query: `MATCH (m:AgentMemory) ${where}
            RETURN m.elementId AS elementId, m.agentId AS agentId, m.key AS key,
                   m.value AS value, m.type AS type, m.tier AS tier, m.tags AS tags,
                   toString(m.createdAt) AS createdAt, toString(m.updatedAt) AS updatedAt
            ORDER BY m.updatedAt DESC
            LIMIT $limit`,
    params: { ...params, limit: limit * 3 },
  }) as { results?: Array<Record<string, unknown>> } | unknown

  const results = (result as any)?.results ?? (Array.isArray(result) ? result : [])
  const memories: MemoryNode[] = results.map((r: Record<string, unknown>) => ({
    elementId: String(r.elementId ?? ''),
    agentId: String(r.agentId ?? ''),
    key: String(r.key ?? ''),
    value: String(r.value ?? ''),
    type: String(r.type ?? 'unknown'),
    tier: (r.tier ?? undefined) as CoalaTier | undefined,
    tags: Array.isArray(r.tags) ? r.tags as string[] : undefined,
    createdAt: String(r.createdAt ?? ''),
    updatedAt: String(r.updatedAt ?? ''),
  }))

  // Score and filter by relevance (tier-aware)
  let scored = memories.map(m => {
    const resolvedTier = m.tier ?? TYPE_TO_TIER[m.type] ?? 'short'
    return {
      elementId: m.elementId,
      agentId: m.agentId,
      key: m.key,
      value: m.value,
      type: m.type,
      tier: m.tier,
      tags: m.tags,
      relevance: computeRelevance(m.updatedAt, m.type, resolvedTier),
      createdAt: m.createdAt,
    }
  })

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
