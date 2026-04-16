/**
 * auto-tagger.ts — KB Auto-Tagger (topic 11/15)
 *
 * Enriches KnowledgeEvents with domain/category tags before L3/L4 promotion.
 * Pure function — no I/O, no side-effects. Plugged into knowledge/index.ts
 * onKnowledge handler right after scoring, before tier routing.
 *
 * Strategy:
 *   1. Keyword scan of title + content against domain dictionaries
 *   2. Source-based tags (inventor → ['protocol', 'evolved'], etc.)
 *   3. Score-based quality tier tag (top-tier / high-quality / standard)
 *   4. Dedup: merge with existing event.tags
 */

import type { KnowledgeEvent } from './knowledge-bus.js'

// ─── Domain dictionaries ──────────────────────────────────────────────────────

/** Maps a domain tag to signal keywords found in title/content */
const DOMAIN_SIGNALS: Record<string, string[]> = {
  'graph':         ['neo4j', 'cypher', 'graph', 'node', 'relationship', 'auradb', 'merge'],
  'rag':           ['rag', 'retrieval', 'embedding', 'vector', 'semantic', 'kg_rag', 'srag'],
  'llm':           ['llm', 'model', 'prompt', 'token', 'deepseek', 'openai', 'claude', 'groq', 'matrix'],
  'agent':         ['agent', 'capability', 'dispatch', 'registry', 'fleet', 'trust', 'peer-eval'],
  'chain':         ['chain', 'sequential', 'parallel', 'debate', 'adaptive', 'funnel', 'loop'],
  'memory':        ['memory', 'cortex', 'episodic', 'context', 'compress', 'fold', 'session'],
  'pheromone':     ['pheromone', 'stigmerg', 'attraction', 'repellent', 'trail', 'decay'],
  'cost':          ['cost', 'usd', 'token_count', 'budget', 'efficiency', 'governance'],
  'knowledge':     ['knowledge', 'kb', 'tier', 'l2', 'l3', 'l4', 'ingest', 'normali'],
  'tooling':       ['tool', 'mcp', 'executor', 'registry', 'call_mcp', 'payload'],
  'phantom':       ['phantom', 'bom', 'component', 'vidensarkiv', 'awesome-list'],
  'inventor':      ['inventor', 'evolution', 'mutation', 'fitness', 'island', 'map-elites'],
  'security':      ['auth', 'api_key', 'bearer', 'acl', 'governance', 'pii', 'compliance'],
  'monitoring':    ['health', 'metric', 'grafana', 'alert', 'anomaly', 'latency', 'sla'],
  'deployment':    ['railway', 'deploy', 'dist', 'build', 'nixpacks', 'ci', 'pr', 'branch'],
}

/** Source → auto-applied tags */
const SOURCE_TAGS: Record<string, string[]> = {
  inventor:     ['protocol', 'evolved', 'rl-optimized'],
  session_fold: ['session-insight', 'distilled'],
  phantom_bom:  ['component', 'bom'],
  commit:       ['git', 'changelog'],
  manual:       ['curated'],
}

/** Score thresholds → quality tier tag */
const QUALITY_TAGS: Array<{ min: number; tag: string }> = [
  { min: 0.85, tag: 'top-tier' },
  { min: 0.65, tag: 'high-quality' },
  { min: 0.45, tag: 'standard' },
]

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Return a new KnowledgeEvent with enriched tags.
 * Original event is not mutated.
 */
export function autoTag(event: KnowledgeEvent): KnowledgeEvent {
  const newTags = new Set(event.tags)

  const haystack = `${event.title} ${event.content.slice(0, 3000)} ${event.summary}`.toLowerCase()

  // 1. Domain signals
  for (const [domain, signals] of Object.entries(DOMAIN_SIGNALS)) {
    if (signals.some(s => haystack.includes(s))) {
      newTags.add(domain)
    }
  }

  // 2. Source tags
  const srcTags = SOURCE_TAGS[event.source] ?? []
  for (const t of srcTags) newTags.add(t)

  // 3. Quality tier
  if (event.score !== undefined) {
    for (const { min, tag } of QUALITY_TAGS) {
      if (event.score >= min) { newTags.add(tag); break }
    }
  }

  // 4. Repo tag (strip owner prefix if present)
  const repoSlug = event.repo.split('/').pop()
  if (repoSlug) newTags.add(`repo:${repoSlug}`)

  return { ...event, tags: [...newTags] }
}
