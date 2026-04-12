/**
 * adaptive-rag-router.ts — V7: GraphRAG-Anywhere Router
 *
 * Strategy selector that picks the optimal retrieval strategy per query:
 *   - simple: single-hop, known entity → graphrag + srag
 *   - multi-hop: complex reasoning → graphrag + cypher + community
 *   - ppr: personalized pagerank → cypher + graphrag
 *   - community: community detection → community + srag
 *
 * Falls back to existing adaptive_rag_query transparently.
 * Caller always gets AgentResponse, never raw RAG.
 *
 * V6 hook: nightly skill-corpus-sync populates prompts used by router.
 */
import { logger } from '../logger.js'
import type { AgentRequest, AgentResponse } from '@widgetdc/contracts/agent'
import { agentSuccess, agentFailure } from '../agent/agent-interface.js'
import { getAdaptiveWeights } from './adaptive-rag.js'
import { deposit as pheromoneDeposit, sense as pheromoneSense } from '../swarm/pheromone-layer.js'
import { config } from '../config.js'

// ─── Adoption Layer v4 helpers ───────────────────────────────────────────────

async function mcpCall(tool: string, payload: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
      },
      body: JSON.stringify({ tool, payload }),
      signal: AbortSignal.timeout(10000),
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return data?.result ?? data
  } catch (err) {
    logger.warn({ err: String(err), tool }, 'mcpCall failed (adoption helper)')
    return null
  }
}

/** Write claim AgentMemory before work per ADOPTION_LAYER_v4 §1.1 */
async function writeClaim(agentId: string, scope: string, vprop: string, description: string) {
  await mcpCall('graph.write_cypher', {
    query: `MERGE (m:AgentMemory {agentId: $agentId, key: $key})
            SET m.value = $value, m.type = 'claim', m.vprop = $vprop,
                m.expiresAt = datetime() + duration('PT1H'),
                m.updatedAt = datetime()`,
    params: { agentId, key: `claim-${scope}-${Date.now()}`, value: description, vprop },
  })
}

/** Write closure broadcast after work per ADOPTION_LAYER_v4 §1.2 */
async function writeClosure(agentId: string, scope: string, vprop: string, outcome: string, summary: string) {
  await mcpCall('graph.write_cypher', {
    query: `MERGE (m:AgentMemory {agentId: $agentId, key: $key})
            SET m.value = $value, m.type = 'closure', m.vprop = $vprop,
                m.outcome = $outcome, m.updatedAt = datetime()`,
    params: { agentId, key: `closure-${scope}-${Date.now()}`, value: summary, vprop, outcome },
  })
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type RAGStrategy = 'simple' | 'multi-hop' | 'ppr' | 'community'

export interface RouteDecision {
  strategy: RAGStrategy
  confidence: number
  reasoning: string
  channels: string[]
  fallback_strategy: RAGStrategy
}

// ─── Strategy Heuristics ─────────────────────────────────────────────────────

/**
 * Classify a query into a retrieval strategy based on signal analysis.
 */
export function classifyStrategy(query: string): RouteDecision {
  const q = query.toLowerCase()
  const wordCount = q.split(/\s+/).length

  // Signal detection
  const hasMultipleEntities = (q.match(/["'][^"']+["']/g) || []).length >= 2
  const hasComparisonWords = /\b(compare|vs|versus|difference|similar|unlike)\b/i.test(q)
  const hasAggregationWords = /\b(all|total|count|sum|average|list|every|each)\b/i.test(q)
  const hasPathWords = /\b(path|connection|relationship|link|chain|route|between)\b/i.test(q)
  const hasComplexityMarkers = wordCount > 15 || hasMultipleEntities || hasComparisonWords

  // Community detection signals
  const hasCommunitySignals = /\b(cluster|group|category|pattern|trend|theme|common)\b/i.test(q)

  // PPR signals (specific entity lookup)
  const hasPPRSignals = /^["'][^"']+["']/.test(q.trim()) || /\b(find|get|show|lookup|retrieve)\b/i.test(q)

  // Decision logic
  if (hasComplexityMarkers && hasPathWords) {
    const weights = getAdaptiveWeightsSync()
    return {
      strategy: 'multi-hop',
      confidence: 0.75,
      reasoning: `Query has ${wordCount} words + path/relationship keywords → multi-hop traversal needed`,
      channels: weights.multi_hop_channels,
      fallback_strategy: 'simple',
    }
  }

  if (hasCommunitySignals && hasAggregationWords) {
    return {
      strategy: 'community',
      confidence: 0.65,
      reasoning: 'Query asks for patterns/clusters/trends → community detection strategy',
      channels: ['community', 'srag'],
      fallback_strategy: 'multi-hop',
    }
  }

  if (hasPPRSignals && !hasComplexityMarkers) {
    return {
      strategy: 'ppr',
      confidence: 0.7,
      reasoning: 'Specific entity lookup → personalized pagerank',
      channels: ['cypher', 'graphrag'],
      fallback_strategy: 'simple',
    }
  }

  // Default: simple strategy
  return {
    strategy: 'simple',
    confidence: 0.6,
    reasoning: `Simple query (${wordCount} words) → standard retrieval`,
    channels: getAdaptiveWeightsSync().simple_channels,
    fallback_strategy: 'multi-hop',
  }
}

/** Synchronous weights access (uses cached values) */
function getAdaptiveWeightsSync() {
  // Default weights — actual async loading happens at init
  return {
    simple_channels: ['graphrag', 'srag', 'cypher'],
    multi_hop_channels: ['graphrag', 'cypher', 'community', 'srag'],
    structured_channels: ['cypher', 'graphrag'],
    confidence_threshold: 0.4,
    updated_at: new Date().toISOString(),
    training_samples: 0,
  }
}

// ─── V6: Skill Corpus Sync ──────────────────────────────────────────────────

/**
 * Nightly crawl of awesome-lists → ingest into prompt library.
 * V6: "Self-updating SKILL.md corpus"
 *
 * MERGE on prompt content hash to prevent duplicate ingestion.
 * Respects GitHub API rate limits (60 req/hr unauthenticated).
 */
export interface CorpusSource {
  repo: string       // e.g., 'microsoft/PowerPlatform-Connectors'
  path: string       // e.g., 'connectors/README.md'
  category: string   // e.g., 'connector'
  tags: string[]
}

const DEFAULT_CORPUS_SOURCES: CorpusSource[] = [
  {
    repo: 'microsoft/PowerPlatform-Connectors',
    path: 'connectors/README.md',
    category: 'connector',
    tags: ['power-platform', 'connectors', 'microsoft'],
  },
  {
    repo: 'Hannibal046/Awesome-LLM',
    path: 'README.md',
    category: 'llm-tool',
    tags: ['llm', 'awesome-list', 'tools'],
  },
  {
    repo: 'dair-ai/Prompt-Engineering-Guide',
    path: 'README.md',
    category: 'prompt-pattern',
    tags: ['prompt-engineering', 'patterns', 'techniques'],
  },
]

export async function syncSkillCorpus(sources: CorpusSource[] = DEFAULT_CORPUS_SOURCES): Promise<{ ingested: number; skipped: number; errors: string[] }> {
  const results = { ingested: 0, skipped: 0, errors: [] as string[] }

  for (const source of sources) {
    try {
      // Fetch raw content from GitHub
      const rawUrl = `https://raw.githubusercontent.com/${source.repo}/main/${source.path}`
      const res = await fetch(rawUrl, {
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        results.errors.push(`${source.repo}: HTTP ${res.status}`)
        continue
      }

      const content = await res.text()
      if (content.length < 100) {
        results.skipped++
        continue
      }

      // Create content hash for dedup
      const hash = await hashContent(content)
      const title = `${source.category}: ${source.repo}/${source.path}`

      // Ingest via knowledge ingestion (uses MERGE for idempotency)
      const { ingestKnowledge } = await import('../prompts/prompt-library.js')
      const doc = await ingestKnowledge({
        title,
        content: content.slice(0, 10000), // Cap at 10KB
        source_type: 'url',
        source_path: `https://github.com/${source.repo}/blob/main/${source.path}`,
        tags: [...source.tags, 'corpus-sync', `hash:${hash.slice(0, 8)}`],
        word_count: content.split(/\s+/).length,
        metadata: { repo: source.repo, category: source.category, hash, synced_at: new Date().toISOString() },
      })

      if (doc) {
        results.ingested++
      } else {
        results.skipped++
      }

      // Rate limit: 1 req per source to avoid GitHub rate limiting
      if (sources.indexOf(source) < sources.length - 1) {
        await new Promise(r => setTimeout(r, 1000))
      }
    } catch (err) {
      results.errors.push(`${source.repo}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  logger.info(results, 'Skill corpus sync complete')
  return results
}

/** Simple content hash for dedup */
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── MCP Tool Handlers ───────────────────────────────────────────────────────

/**
 * V7: RAG Route — classify query and dispatch to optimal strategy.
 */
export async function handleRAGRoute(request: AgentRequest): Promise<AgentResponse> {
  try {
    const query = typeof request.context?.query === 'string' ? request.context.query : null
    if (!query) {
      return agentFailure(request, 'No query provided. Include query in context.query')
    }

    // ADOPTION_LAYER_v4 §2.1: audit.lessons at tool boot (best-effort, no throw)
    mcpCall('audit.lessons', { agentId: 'rag-router' }).catch(() => {})

    let decision = classifyStrategy(query)

    // ADOPTION_LAYER_v4 §2.1 pheromone-weighted strategy selection:
    // if recent ATTRACTION trail on a strategy scores higher than classifier's pick, switch.
    try {
      const senseRes = await pheromoneSense({ domain: 'rag', agentId: 'rag-router' } as any)
      const strongest = (senseRes as any)?.strongest ?? null
      if (strongest?.metadata?.strategy && strongest.intensity > 0.7
          && strongest.metadata.strategy !== decision.strategy
          && decision.confidence < 0.8) {
        decision = { ...decision, strategy: strongest.metadata.strategy, reasoning: `${decision.reasoning} + pheromone-override` }
      }
    } catch { /* pheromone miss — keep classifier pick */ }

    // Execute via existing adaptive_rag_query with chosen channels
    const { queryAdaptiveRAG } = await import('./adaptive-rag.js')
    const results = await queryAdaptiveRAG(query, {
      channels: decision.channels,
      limit: typeof request.context.limit === 'number' ? request.context.limit : 10,
    })

    // ADOPTION_LAYER_v4 §2.1 post-outcome pheromone deposit (SUCCESS → attraction)
    try {
      await pheromoneDeposit({
        agentId: 'rag-router', type: 'STATUS', domain: 'rag',
        intensity: Math.min(1, results.length / 10),
        message: `RAG route via ${decision.strategy} → ${results.length} results`,
        metadata: { strategy: decision.strategy, channels: decision.channels, query_len: query.length },
      } as any)
    } catch { /* */ }

    const lines = [
      `# RAG Route Decision`,
      ``,
      `**Query:** ${query.slice(0, 100)}${query.length > 100 ? '...' : ''}`,
      `**Strategy:** ${decision.strategy}`,
      `**Confidence:** ${decision.confidence}`,
      `**Reasoning:** ${decision.reasoning}`,
      `**Channels:** ${decision.channels.join(', ')}`,
      `**Fallback:** ${decision.fallback_strategy}`,
      ``,
      `## Results (${results.length} found)`,
      ``,
    ]

    for (const r of results.slice(0, 5)) {
      const score = (r as any).confidence ?? (r as any).score ?? 'N/A'
      const source = (r as any).source ?? (r as any).channel ?? 'unknown'
      const text = (r as any).content ?? (r as any).text ?? ''
      lines.push(`### [${score}] ${source}`)
      lines.push(text.slice(0, 200))
      lines.push('')
    }

    return agentSuccess(request, lines.join('\n'), { input: 0, output: lines.length * 10 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}

/**
 * V6: Skill Corpus Sync — trigger nightly sync.
 */
export async function handleCorpusSync(request: AgentRequest): Promise<AgentResponse> {
  const scope = `corpus-${new Date().toISOString().slice(0, 13)}`
  try {
    // ADOPTION_LAYER_v4 §1.1 claim-before-work + §2.5 audit.lessons at boot
    await writeClaim('corpus-sync', scope, 'V6', 'Nightly skill corpus sync')
    mcpCall('audit.lessons', { agentId: 'corpus-sync' }).catch(() => {})

    const result = await syncSkillCorpus()

    // ADOPTION_LAYER_v4 §2.1 pheromone deposit on ingestion
    try {
      await pheromoneDeposit({
        agentId: 'corpus-sync', type: 'INTEL', domain: 'prompts',
        intensity: Math.min(1, result.ingested / 20),
        message: `Ingested ${result.ingested} prompts from awesome-lists`,
        metadata: { ingested: result.ingested, skipped: result.skipped, errors: result.errors.length },
      } as any)
    } catch { /* */ }

    // Closure broadcast
    await writeClosure('corpus-sync', scope, 'V6',
      result.errors.length > 0 ? 'partial' : 'success',
      JSON.stringify({ ingested: result.ingested, skipped: result.skipped, errors: result.errors.length }))
    const lines = [
      `# Skill Corpus Sync`,
      ``,
      `**Ingested:** ${result.ingested}`,
      `**Skipped:** ${result.skipped}`,
      `**Errors:** ${result.errors.length}`,
      ``,
    ]
    if (result.errors.length > 0) {
      lines.push(`## Errors`)
      result.errors.forEach(e => lines.push(`- ${e}`))
    }
    return agentSuccess(request, lines.join('\n'), { input: 0, output: lines.length * 10 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}
