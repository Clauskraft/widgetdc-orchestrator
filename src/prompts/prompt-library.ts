/**
 * prompt-library.ts — Prompt library + knowledge ingestion (Phantom Week 5).
 *
 * Steals patterns from prompts.chat (MIT license) — 100% original implementation,
 * zero runtime dependency on prompts.chat.
 *
 * Stores prompts in Redis for fast retrieval and Neo4j :Prompt nodes for graph queries.
 * Each prompt has: id, title, content, category, tags, quality_score, usage_count.
 *
 * Also handles PDF knowledge ingestion → Neo4j KnowledgeDocument nodes via
 * the document converter pipeline (Week 3).
 *
 * Golden Rule: Steal IDEER og INDHOLD — aldrig runtime dependencies.
 */
import { getRedis, isRedisEnabled } from '../redis.js'
import { logger } from '../logger.js'
import { config } from '../config.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Prompt {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
  quality_score: number    // 0-1, computed from usage + feedback
  usage_count: number
  created_at: string
  updated_at: string
  author?: string
  variables?: string[]     // e.g. ['context', 'task', 'language']
}

export interface PromptQuery {
  category?: string
  tags?: string[]
  query?: string           // Full-text search in title/content
  min_quality?: number
  limit?: number
}

export interface KnowledgeDocument {
  id: string
  title: string
  content: string
  source_type: string      // 'pdf' | 'docx' | 'xlsx' | 'url' | 'manual'
  source_path: string
  language?: string
  tags: string[]
  headings: string[]
  word_count: number
  created_at: string
  metadata: Record<string, unknown>
}

// ─── Redis keys ──────────────────────────────────────────────────────────────

const REDIS_PROMPT_PREFIX = 'prompt:'
const REDIS_PROMPT_INDEX = 'prompts:index'
const REDIS_PROMPT_CATEGORY_PREFIX = 'prompt:cat:'
const REDIS_KNOWLEDGE_PREFIX = 'knowledge:'
const REDIS_KNOWLEDGE_INDEX = 'knowledge:index'
const REDIS_TTL_PROMPTS = 365 * 24 * 3600  // 1 year
const REDIS_TTL_KNOWLEDGE = 365 * 24 * 3600

// ─── Prompt categories (inspired by prompts.chat patterns) ───────────────────

export const PROMPT_CATEGORIES = [
  'code',           // Code generation, review, debugging
  'analysis',       // Data analysis, research, investigation
  'writing',        // Content creation, editing, translation
  'architecture',   // System design, patterns, decisions
  'testing',        // Test generation, TDD, QA
  'documentation',  // Docs, comments, API specs
  'governance',     // Policy, compliance, audit
  'memory',         // Memory management, context folding
  'agent',          // Agent coordination, dispatch
  'converter',      // Document conversion patterns
  'analytics',      // Metrics, monitoring, dashboards
  'general',        // Catch-all / miscellaneous
] as const

// ─── Seed prompts (built-in library based on WidgeTDC operational patterns) ──

const SEED_PROMPTS: Omit<Prompt, 'id' | 'created_at' | 'updated_at' | 'usage_count'>[] = [
  {
    title: 'Code Review',
    content: 'Review the following code for correctness, security, performance, and code quality. Identify bugs, vulnerabilities, and improvement opportunities. Provide specific line references and suggested fixes.',
    category: 'code',
    tags: ['review', 'quality', 'security'],
    quality_score: 0.9,
    variables: ['code', 'language'],
  },
  {
    title: 'Architecture Decision',
    content: 'Analyze the following architectural decision. Evaluate trade-offs, alternatives, risks, and long-term implications. Provide a recommendation with justification.',
    category: 'architecture',
    tags: ['decision', 'trade-offs', 'design'],
    quality_score: 0.85,
    variables: ['context', 'decision', 'alternatives'],
  },
  {
    title: 'Test Generation',
    content: 'Generate comprehensive tests for the following code. Include unit tests, edge cases, error paths, and integration scenarios. Use the existing test framework and conventions.',
    category: 'testing',
    tags: ['tests', 'coverage', 'edge-cases'],
    quality_score: 0.88,
    variables: ['code', 'framework'],
  },
  {
    title: 'Document Converter',
    content: 'Convert the following document to canonical text format. Extract headings, links, tables, and metadata. Preserve structure and semantics. Detect language automatically.',
    category: 'converter',
    tags: ['conversion', 'extraction', 'metadata'],
    quality_score: 0.82,
    variables: ['document', 'format'],
  },
  {
    title: 'Runtime Analysis',
    content: 'Analyze the following runtime metrics and identify anomalies, bottlenecks, and optimization opportunities. Provide actionable recommendations prioritized by impact.',
    category: 'analytics',
    tags: ['metrics', 'performance', 'anomaly'],
    quality_score: 0.87,
    variables: ['metrics', 'timeframe'],
  },
  {
    title: 'Agent Dispatch',
    content: 'Route the following task to the most capable agent based on capabilities, current load, and past performance. Provide the routing decision with justification and fallback chain.',
    category: 'agent',
    tags: ['routing', 'dispatch', 'capabilities'],
    quality_score: 0.84,
    variables: ['task', 'agents', 'constraints'],
  },
  {
    title: 'Memory Consolidation',
    content: 'Consolidate the following memory entries by semantic similarity. Merge duplicates, expire stale entries, and enforce the node budget. Report merged, expired, and pruned counts.',
    category: 'memory',
    tags: ['consolidation', 'dedup', 'ttl'],
    quality_score: 0.86,
    variables: ['memories', 'threshold', 'budget'],
  },
  {
    title: 'Governance Audit',
    content: 'Audit the following system state against governance policies. Identify violations, drift, and compliance gaps. Provide a remediation plan with priority and estimated effort.',
    category: 'governance',
    tags: ['audit', 'compliance', 'remediation'],
    quality_score: 0.91,
    variables: ['state', 'policies'],
  },
  {
    title: 'Knowledge Ingest',
    content: 'Ingest the following document into the knowledge base. Extract key insights, entities, and relationships. Classify by domain and link to existing knowledge nodes. Produce a summary with tags and confidence scores.',
    category: 'analysis',
    tags: ['knowledge', 'ingestion', 'classification'],
    quality_score: 0.83,
    variables: ['document', 'domain'],
  },
  {
    title: 'Contract Compliance',
    content: 'Verify the following implementation against the canonical contract. Check field names (snake_case), required fields, $id presence, additionalProperties:false, and enum values. Report any drift.',
    category: 'governance',
    tags: ['contract', 'compliance', 'validation'],
    quality_score: 0.89,
    variables: ['implementation', 'contract'],
  },
]

// ─── Utility ─────────────────────────────────────────────────────────────────

function promptId(): string {
  return `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function knowledgeId(): string {
  return `knowledge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Call backend MCP tool via Neural Bridge.
 */
async function mcpCall(tool: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
    },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(15000),
  })
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return data?.result ?? data
}

// ─── Prompt CRUD ─────────────────────────────────────────────────────────────

/**
 * Add a prompt to the library.
 * Stores in Redis and creates/updates Neo4j :Prompt node.
 */
export async function addPrompt(prompt: Omit<Prompt, 'id' | 'created_at' | 'updated_at' | 'usage_count'>): Promise<Prompt> {
  const now = new Date().toISOString()
  const id = promptId()
  const fullPrompt: Prompt = {
    ...prompt,
    id,
    created_at: now,
    updated_at: now,
    usage_count: 0,
  }

  // Store in Redis
  if (isRedisEnabled()) {
    const redis = getRedis()
    if (redis) {
      try {
        await redis.set(`${REDIS_PROMPT_PREFIX}${id}`, JSON.stringify(fullPrompt), 'EX', REDIS_TTL_PROMPTS)
        await redis.sadd(REDIS_PROMPT_INDEX, id)
        await redis.sadd(`${REDIS_PROMPT_CATEGORY_PREFIX}${prompt.category}`, id)
      } catch (err) {
        logger.warn({ err: String(err), prompt_id: id }, 'Failed to store prompt in Redis')
      }
    }
  }

  // Create Neo4j :Prompt node via MCP
  try {
    await mcpCall('graph.write_cypher', {
      query: `MERGE (p:Prompt {id: $id})
              SET p.title = $title, p.category = $category, p.content = $content,
                  p.tags = $tags, p.quality_score = $quality_score,
                  p.variables = $variables, p.author = $author,
                  p.updatedAt = datetime()`,
      params: {
        id,
        title: prompt.title,
        category: prompt.category,
        content: prompt.content.slice(0, 4000),
        tags: prompt.tags,
        quality_score: prompt.quality_score,
        variables: prompt.variables ?? [],
        author: prompt.author ?? 'system',
      },
    })
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to create Neo4j Prompt node (non-fatal)')
  }

  logger.info({ prompt_id: id, category: prompt.category, title: prompt.title }, 'Prompt added to library')
  return fullPrompt
}

/** Get a prompt by ID */
export async function getPrompt(id: string): Promise<Prompt | null> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return null

  try {
    const raw = await redis.get(`${REDIS_PROMPT_PREFIX}${id}`)
    return raw ? JSON.parse(raw) as Prompt : null
  } catch (err) {
    logger.warn({ err: String(err), prompt_id: id }, 'Failed to get prompt from Redis')
    return null
  }
}

/** Query prompts with filters */
export async function queryPrompts(q: PromptQuery): Promise<Prompt[]> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return []

  try {
    let ids: string[] = []

    // Start from category index if specified
    if (q.category) {
      ids = await redis.smembers(`${REDIS_PROMPT_CATEGORY_PREFIX}${q.category}`)
    } else {
      ids = await redis.smembers(REDIS_PROMPT_INDEX)
    }

    if (ids.length === 0) return []

    // Fetch all prompts (limit scan to avoid blocking)
    const prompts: Prompt[] = []
    for (const id of ids.slice(0, 200)) {
      const raw = await redis.get(`${REDIS_PROMPT_PREFIX}${id}`)
      if (raw) prompts.push(JSON.parse(raw))
    }

    // Apply filters
    let filtered = prompts

    if (q.tags && q.tags.length > 0) {
      filtered = filtered.filter(p => q.tags!.some(t => p.tags.includes(t)))
    }

    if (q.min_quality !== undefined) {
      filtered = filtered.filter(p => p.quality_score >= q.min_quality!)
    }

    if (q.query) {
      const queryLower = q.query.toLowerCase()
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(queryLower) ||
        p.content.toLowerCase().includes(queryLower)
      )
    }

    // Sort by quality score descending
    filtered.sort((a, b) => b.quality_score - a.quality_score)

    return filtered.slice(0, q.limit ?? 20)
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to query prompts')
    return []
  }
}

/** Record prompt usage (increments usage_count, adjusts quality score) */
export async function recordPromptUsage(id: string, wasHelpful: boolean = true): Promise<void> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return

  try {
    const raw = await redis.get(`${REDIS_PROMPT_PREFIX}${id}`)
    if (!raw) return

    const prompt: Prompt = JSON.parse(raw)
    prompt.usage_count++
    prompt.updated_at = new Date().toISOString()

    // Quality score: starts at seed value, adjusts based on feedback
    const alpha = 0.05 // Learning rate
    prompt.quality_score = prompt.quality_score + alpha * ((wasHelpful ? 1 : 0) - prompt.quality_score)
    prompt.quality_score = Math.max(0, Math.min(1, prompt.quality_score))

    await redis.set(`${REDIS_PROMPT_PREFIX}${id}`, JSON.stringify(prompt), 'EX', REDIS_TTL_PROMPTS)
  } catch (err) {
    logger.warn({ err: String(err), prompt_id: id }, 'Failed to record prompt usage')
  }
}

/** List all categories with prompt counts */
export async function listCategories(): Promise<Array<{ category: string; count: number }>> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return PROMPT_CATEGORIES.map(c => ({ category: c, count: 0 }))

  try {
    const categories: Array<{ category: string; count: number }> = []
    for (const cat of PROMPT_CATEGORIES) {
      const count = await redis.scard(`${REDIS_PROMPT_CATEGORY_PREFIX}${cat}`)
      categories.push({ category: cat, count })
    }
    return categories.filter(c => c.count > 0).sort((a, b) => b.count - a.count)
  } catch {
    return PROMPT_CATEGORIES.map(c => ({ category: c, count: 0 }))
  }
}

/** Seed the library with built-in prompts (idempotent) */
export async function seedPrompts(): Promise<number> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return 0

  try {
    const existingCount = await redis.scard(REDIS_PROMPT_INDEX)
    if (existingCount >= SEED_PROMPTS.length) return 0

    let added = 0
    for (const seed of SEED_PROMPTS) {
      const existing = await queryPrompts({ query: seed.title, limit: 1 })
      if (existing.length === 0) {
        await addPrompt(seed)
        added++
      }
    }

    logger.info({ added, total: SEED_PROMPTS.length }, 'Prompt library seeded')
    return added
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to seed prompts')
    return 0
  }
}

// ─── Knowledge ingestion (PDF → Neo4j KnowledgeDocument) ─────────────────────

/**
 * Ingest a converted document into the knowledge base.
 * Creates Neo4j :KnowledgeDocument node via MCP.
 * Uses document converter output (Week 3) as input.
 */
export async function ingestKnowledge(doc: {
  title: string
  content: string
  source_type: string
  source_path: string
  language?: string
  tags?: string[]
  headings?: string[]
  word_count?: number
  metadata?: Record<string, unknown>
}): Promise<KnowledgeDocument | null> {
  const id = knowledgeId()
  const now = new Date().toISOString()
  const tags = doc.tags ?? []
  const headings = doc.headings ?? []

  const knowledgeDoc: KnowledgeDocument = {
    id,
    title: doc.title,
    content: doc.content,
    source_type: doc.source_type,
    source_path: doc.source_path,
    language: doc.language,
    tags,
    headings,
    word_count: doc.word_count ?? 0,
    created_at: now,
    metadata: doc.metadata ?? {},
  }

  // Store in Redis
  if (isRedisEnabled()) {
    const redis = getRedis()
    if (redis) {
      try {
        await redis.set(`${REDIS_KNOWLEDGE_PREFIX}${id}`, JSON.stringify(knowledgeDoc), 'EX', REDIS_TTL_KNOWLEDGE)
        await redis.sadd(REDIS_KNOWLEDGE_INDEX, id)
      } catch (err) {
        logger.warn({ err: String(err), knowledge_id: id }, 'Failed to store knowledge doc in Redis')
      }
    }
  }

  // Create Neo4j :KnowledgeDocument node via MCP
  try {
    await mcpCall('graph.write_cypher', {
      query: `MERGE (k:KnowledgeDocument {id: $id})
              SET k.title = $title, k.content = $content, k.source_type = $source_type,
                  k.source_path = $source_path, k.language = $language, k.tags = $tags,
                  k.headings = $headings, k.word_count = $word_count,
                  k.createdAt = datetime(), k.updatedAt = datetime()`,
      params: {
        id,
        title: doc.title.slice(0, 500),
        content: doc.content.slice(0, 8000), // Neo4j string limit for properties
        source_type: doc.source_type,
        source_path: doc.source_path,
        language: doc.language ?? null,
        tags,
        headings: headings.slice(0, 50),
        word_count: doc.word_count ?? 0,
      },
    })

    logger.info({ knowledge_id: id, source_type: doc.source_type, word_count: doc.word_count }, 'Knowledge document ingested')
    return knowledgeDoc
  } catch (err) {
    logger.warn({ err: String(err), knowledge_id: id }, 'Failed to create Neo4j KnowledgeDocument node')
    return null
  }
}

/** Get a knowledge document by ID */
export async function getKnowledge(id: string): Promise<KnowledgeDocument | null> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return null

  try {
    const raw = await redis.get(`${REDIS_KNOWLEDGE_PREFIX}${id}`)
    return raw ? JSON.parse(raw) as KnowledgeDocument : null
  } catch (err) {
    logger.warn({ err: String(err), knowledge_id: id }, 'Failed to get knowledge from Redis')
    return null
  }
}

/** Query knowledge documents with filters */
export async function queryKnowledge(q: { tags?: string[]; query?: string; source_type?: string; limit?: number }): Promise<KnowledgeDocument[]> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return []

  try {
    const ids = await redis.smembers(REDIS_KNOWLEDGE_INDEX)
    if (ids.length === 0) return []

    const docs: KnowledgeDocument[] = []
    for (const id of ids.slice(0, 200)) {
      const raw = await redis.get(`${REDIS_KNOWLEDGE_PREFIX}${id}`)
      if (raw) docs.push(JSON.parse(raw))
    }

    let filtered = docs

    if (q.source_type) {
      filtered = filtered.filter(d => d.source_type === q.source_type)
    }

    if (q.tags && q.tags.length > 0) {
      filtered = filtered.filter(d => q.tags!.some(t => d.tags.includes(t)))
    }

    if (q.query) {
      const queryLower = q.query.toLowerCase()
      filtered = filtered.filter(d =>
        d.title.toLowerCase().includes(queryLower) ||
        d.content.toLowerCase().includes(queryLower)
      )
    }

    // Sort by word_count (larger docs first — proxy for richness)
    filtered.sort((a, b) => b.word_count - a.word_count)

    return filtered.slice(0, q.limit ?? 20)
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to query knowledge documents')
    return []
  }
}

/** List knowledge stats */
export async function knowledgeStats(): Promise<{ total: number; by_source_type: Record<string, number> }> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return { total: 0, by_source_type: {} }

  try {
    const ids = await redis.smembers(REDIS_KNOWLEDGE_INDEX)
    const bySource: Record<string, number> = {}

    for (const id of ids.slice(0, 500)) {
      const raw = await redis.get(`${REDIS_KNOWLEDGE_PREFIX}${id}`)
      if (raw) {
        const doc = JSON.parse(raw) as KnowledgeDocument
        bySource[doc.source_type] = (bySource[doc.source_type] || 0) + 1
      }
    }

    return { total: ids.length, by_source_type: bySource }
  } catch {
    return { total: 0, by_source_type: {} }
  }
}
