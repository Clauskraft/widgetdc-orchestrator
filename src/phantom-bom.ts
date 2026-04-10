/**
 * phantom-bom.ts — PhantomBOMExtractor + Snout MRP Service
 *
 * Two extraction modes:
 *   1. REPO BOM  — repomix packs a GitHub/HuggingFace repo → DeepSeek extracts
 *                  PhantomComponent nodes (tools/libs/services/agents)
 *   2. PROVIDER  — structured ingest of LLM providers → PhantomProvider nodes
 *                  with dual-path parsing (regex fast + LLM deep)
 *
 * MRP Engine:
 *   generatePhantomClusters() groups PhantomProvider nodes into PhantomCluster
 *   nodes using strategy-based scoring:
 *     score = 0.5×avg_conf + 0.3×min(count/5,1) + 0.2×avg_uptime
 *
 * HITL Gate:
 *   confidence < 70 → blocked, Linear issue created with label HITL
 *   confidence ≥ 70 → auto-ingest to Neo4j
 *
 * CVE Cross-check:
 *   After provider ingest, link to existing CVE nodes in graph
 *
 * Node labels: PhantomBOMRun, PhantomComponent, PhantomProvider, PhantomCluster
 * All phantom nodes get needsEmbedding: true
 */

import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { config } from './config.js'
import { logger } from './logger.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhantomComponent {
  id: string               // 'phantom-' + sha256(sourceRepo+name+type)[:16]
  name: string
  type: 'tool' | 'api' | 'model' | 'dataset' | 'pattern' | 'agent' | 'service' | 'library'
  description: string
  source_file: string | null
  capabilities: string[]
  dependencies: string[]
  confidence: number       // 0-100
  tags: string[]
}

export interface PhantomBOM {
  bom_version: '1.0'
  run_id: string
  source_repo: string
  source_type: 'git' | 'huggingface'
  ingestion_timestamp: string
  confidence_score: number  // 0-100 overall
  repo_meta: {
    name: string
    description: string
    primary_language: string
    license: string
    topics: string[]
  }
  components: PhantomComponent[]
  summary: string
}

export type PhantomBOMRunStatus = 'running' | 'completed' | 'failed'

// ─── Constants ────────────────────────────────────────────────────────────────

// repomix token cap — keep LLM prompt manageable
const REPOMIX_MAX_CHARS = 60_000
const LLM_TIMEOUT_MS = 120_000

// In-memory run state (process lifetime)
const runState = new Map<string, {
  status: PhantomBOMRunStatus
  bom?: PhantomBOM
  error?: string
  startedAt: string
}>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function phantomId(sourceRepo: string, name: string, type: string): string {
  const hash = createHash('sha256').update(sourceRepo + name + type).digest('hex').substring(0, 16)
  return `phantom-${hash}`
}

/**
 * Run repomix --remote <repoUrl> and return packed text output.
 * Falls back to github.com URL if bare "user/repo" format given.
 */
function runRepomix(repoUrl: string): string {
  // Accept both "https://github.com/user/repo" and "user/repo" shorthand
  const remoteArg = repoUrl.startsWith('http') ? repoUrl : repoUrl

  const cmd = `npx --yes repomix --remote "${remoteArg}" --stdout --style plain --quiet`
  logger.info({ cmd }, 'Running repomix')

  const raw = execSync(cmd, {
    timeout: 120_000,
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
  })

  const text = typeof raw === 'string' ? raw : raw.toString('utf8')
  // Truncate to cap
  return text.substring(0, REPOMIX_MAX_CHARS)
}

function buildExtractionPrompt(repoUrl: string, packedRepo: string): string {
  return `You are a software intelligence analyst. Analyze this repository and extract a structured Bill of Materials (BOM).

CRITICAL: Your entire response must be valid JSON only. No markdown, no explanation, no prose. Start with { and end with }.

Repository: ${repoUrl}

REPOSITORY CONTENTS (packed by repomix):
${packedRepo}

Return EXACTLY this JSON structure:

{
  "repo_meta": {
    "name": "short repo name",
    "description": "1-2 sentence description",
    "primary_language": "main programming language",
    "license": "license name or unknown",
    "topics": ["topic1", "topic2"]
  },
  "confidence_score": 85,
  "summary": "2-3 sentences on what this repo does and why it matters for AI/ML practitioners",
  "components": [
    {
      "name": "component name",
      "type": "tool",
      "description": "what this component does",
      "source_file": "path/to/file or null",
      "capabilities": ["capability1", "capability2"],
      "dependencies": ["dep1", "dep2"],
      "confidence": 90,
      "tags": ["tag1", "tag2"]
    }
  ]
}

type must be exactly one of: tool, api, model, dataset, pattern, agent, service, library
Extract 5-20 meaningful components. confidence_score: 80+ if well-documented, 70-79 if partial, <70 if guessing.
Return ONLY valid JSON.`
}

async function callDeepSeekLlm(prompt: string): Promise<string> {
  const apiKey = config.deepseekApiKey
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured')

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a precise JSON-only software analyst. Never output anything except valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DeepSeek LLM failed: ${res.status} — ${text.substring(0, 200)}`)
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = data?.choices?.[0]?.message?.content ?? ''
  if (!content) throw new Error('DeepSeek returned empty content')
  return content
}

function parseLlmBom(raw: string, repoUrl: string): {
  repo_meta: PhantomBOM['repo_meta']
  confidence_score: number
  summary: string
  components: Omit<PhantomComponent, 'id'>[]
} {
  let json = raw.trim()
  // Strip markdown fences if model added them despite instructions
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  }
  // Extract JSON object if prose surrounds it
  if (!json.startsWith('{')) {
    const match = json.match(/\{[\s\S]*\}/)
    if (match) json = match[0]
  }

  const parsed = JSON.parse(json)
  return {
    repo_meta: {
      name: String(parsed.repo_meta?.name ?? repoUrl.split('/').pop() ?? 'unknown'),
      description: String(parsed.repo_meta?.description ?? ''),
      primary_language: String(parsed.repo_meta?.primary_language ?? 'unknown'),
      license: String(parsed.repo_meta?.license ?? 'unknown'),
      topics: Array.isArray(parsed.repo_meta?.topics) ? parsed.repo_meta.topics.map(String) : [],
    },
    confidence_score: Math.max(0, Math.min(100, Number(parsed.confidence_score ?? 50))),
    summary: String(parsed.summary ?? ''),
    components: (Array.isArray(parsed.components) ? parsed.components : []).map((c: Record<string, unknown>) => ({
      name: String(c.name ?? 'unknown'),
      type: ['tool', 'api', 'model', 'dataset', 'pattern', 'agent', 'service', 'library'].includes(String(c.type))
        ? String(c.type) as PhantomComponent['type']
        : 'library',
      description: String(c.description ?? ''),
      source_file: c.source_file ? String(c.source_file) : null,
      capabilities: Array.isArray(c.capabilities) ? c.capabilities.map(String) : [],
      dependencies: Array.isArray(c.dependencies) ? c.dependencies.map(String) : [],
      confidence: Math.max(0, Math.min(100, Number(c.confidence ?? 50))),
      tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
    })),
  }
}

async function callBackendMcp(tool: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.backendApiKey}`,
    },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Backend MCP ${tool} failed: ${res.status} — ${text.substring(0, 200)}`)
  }
  return res.json()
}

async function writeToNeo4j(bom: PhantomBOM): Promise<void> {
  // MERGE PhantomBOMRun
  const runCypher = `
MERGE (r:PhantomBOMRun {runId: $runId})
SET r.sourceRepo = $sourceRepo,
    r.sourceType = $sourceType,
    r.ingestionTimestamp = datetime($ingestionTimestamp),
    r.confidenceScore = $confidenceScore,
    r.summary = $summary,
    r.repoName = $repoName,
    r.repoDescription = $repoDescription,
    r.primaryLanguage = $primaryLanguage,
    r.license = $license,
    r.topics = $topics,
    r.componentCount = $componentCount,
    r.updatedAt = datetime()
RETURN r.runId as runId`

  await callBackendMcp('graph.write_cypher', {
    query: runCypher,
    params: {
      runId: bom.run_id,
      sourceRepo: bom.source_repo,
      sourceType: bom.source_type,
      ingestionTimestamp: bom.ingestion_timestamp,
      confidenceScore: bom.confidence_score,
      summary: bom.summary,
      repoName: bom.repo_meta.name,
      repoDescription: bom.repo_meta.description,
      primaryLanguage: bom.repo_meta.primary_language,
      license: bom.repo_meta.license,
      topics: bom.repo_meta.topics,
      componentCount: bom.components.length,
    },
  })

  // MERGE each PhantomComponent + [:EXTRACTED] relationship
  for (const comp of bom.components) {
    const compCypher = `
MERGE (c:PhantomComponent {componentId: $componentId})
SET c.name = $name,
    c.type = $type,
    c.description = $description,
    c.sourceRepo = $sourceRepo,
    c.sourceFile = $sourceFile,
    c.capabilities = $capabilities,
    c.dependencies = $dependencies,
    c.confidence = $confidence,
    c.tags = $tags,
    c.needsEmbedding = true,
    c.updatedAt = datetime()
WITH c
MATCH (r:PhantomBOMRun {runId: $runId})
MERGE (r)-[:EXTRACTED]->(c)
RETURN c.componentId as id`

    await callBackendMcp('graph.write_cypher', {
      query: compCypher,
      params: {
        componentId: comp.id,
        name: comp.name,
        type: comp.type,
        description: comp.description,
        sourceRepo: bom.source_repo,
        sourceFile: comp.source_file,
        capabilities: comp.capabilities,
        dependencies: comp.dependencies,
        confidence: comp.confidence,
        tags: comp.tags,
        runId: bom.run_id,
      },
    })
  }
}

// ─── Core extraction ──────────────────────────────────────────────────────────

export async function extractPhantomBOM(
  repoUrl: string,
  sourceType: 'git' | 'huggingface' = 'git',
  runId?: string
): Promise<PhantomBOM> {
  const id = runId ?? `pbom-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  runState.set(id, { status: 'running', startedAt: new Date().toISOString() })
  logger.info({ runId: id, repoUrl }, 'PhantomBOM extraction started')

  try {
    // 1. Pack repo with repomix (no clone dir, no cleanup needed)
    const packedRepo = runRepomix(repoUrl)
    logger.info({ runId: id, chars: packedRepo.length }, 'Repomix packed repo')

    // 2. Build prompt and call DeepSeek with 2 retries on parse failure
    const prompt = buildExtractionPrompt(repoUrl, packedRepo)
    let extracted
    let lastError: Error | null = null

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await callDeepSeekLlm(prompt)
        extracted = parseLlmBom(raw, repoUrl)
        lastError = null
        logger.info({ runId: id, attempt, components: extracted.components.length }, 'LLM extraction parsed')
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        logger.warn({ runId: id, attempt, err: lastError.message }, 'LLM parse failed, retrying')
        if (attempt < 2) await new Promise(r => setTimeout(r, 3000 * (attempt + 1)))
      }
    }
    if (!extracted) throw lastError ?? new Error('LLM extraction failed after 3 attempts')

    // 3. Assemble BOM with stable IDs
    const bom: PhantomBOM = {
      bom_version: '1.0',
      run_id: id,
      source_repo: repoUrl,
      source_type: sourceType,
      ingestion_timestamp: new Date().toISOString(),
      confidence_score: extracted.confidence_score,
      repo_meta: extracted.repo_meta,
      summary: extracted.summary,
      components: extracted.components.map(c => ({
        ...c,
        id: phantomId(repoUrl, c.name, c.type),
      })),
    }

    // 4. Write to Neo4j
    await writeToNeo4j(bom)
    logger.info({ runId: id, components: bom.components.length }, 'PhantomBOM written to Neo4j')

    runState.set(id, { status: 'completed', bom, startedAt: runState.get(id)!.startedAt })
    return bom

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ runId: id, err: msg }, 'PhantomBOM extraction failed')
    runState.set(id, { status: 'failed', error: msg, startedAt: runState.get(id)!.startedAt })
    throw err
  }
}

export function getRunState(runId: string) {
  return runState.get(runId) ?? null
}

export function listRuns() {
  return Array.from(runState.entries()).map(([id, state]) => ({
    run_id: id,
    status: state.status,
    startedAt: state.startedAt,
    source_repo: state.bom?.source_repo,
    confidence_score: state.bom?.confidence_score,
    component_count: state.bom?.components.length,
    error: state.error,
  }))
}

// ─── Snout MRP: Provider Types ────────────────────────────────────────────────

export type GeoRestriction = 'global' | 'eu_only' | 'local_only' | 'cn_region'
export type CostModel = 'free' | 'per_token' | 'subscription' | 'unknown'
export type ProviderCapability = 'reasoning' | 'code' | 'vision' | 'text_generation' | 'embedding' | 'multimodal'
export type ClusterStrategy = 'eu_safe_reasoning' | 'cost_optimized_code' | 'local_only_privacy' | 'open_source_eu'

export interface PhantomProvider {
  id: string                       // 'prov-' + sha256(sourceUrl+name)[:16]
  name: string
  source_url: string
  source_type: 'github' | 'huggingface' | 'npm' | 'manual'
  geo_restriction: GeoRestriction
  primary_capability: ProviderCapability
  version: string
  context_window: number           // tokens, 0 = unknown
  cost_model: CostModel
  confidence: number               // 0-100
  capabilities: ProviderCapability[]
  cve_ids: string[]                // linked CVE node ids from graph
  raw_docs: string                 // first 2000 chars of raw documentation
  hitl_required: boolean           // true if confidence < HITL_THRESHOLD
  hitl_linear_issue?: string       // Linear issue id if HITL triggered
}

export interface PhantomCluster {
  id: string                       // 'cluster-' + strategy + '-' + timestamp
  strategy: ClusterStrategy
  score: number                    // 0-1 composite score
  member_count: number
  avg_confidence: number
  provider_ids: string[]
  created_at: string
}

// ─── Snout MRP: Constants ─────────────────────────────────────────────────────

const HITL_THRESHOLD = 70          // confidence below this triggers HITL gate
const CLUSTER_STRATEGIES: Record<ClusterStrategy, {
  label: string
  geoFilter: GeoRestriction[]
  capabilityFilter: ProviderCapability[]
  costFilter: CostModel[]
}> = {
  eu_safe_reasoning: {
    label: 'EU Safe Reasoning Pool',
    geoFilter: ['eu_only', 'global'],
    capabilityFilter: ['reasoning', 'text_generation'],
    costFilter: ['free', 'per_token', 'subscription'],
  },
  cost_optimized_code: {
    label: 'Cost-Optimized Code Generation',
    geoFilter: ['global', 'eu_only', 'local_only'],
    capabilityFilter: ['code', 'reasoning'],
    costFilter: ['free'],
  },
  local_only_privacy: {
    label: 'Local-Only Privacy Pool',
    geoFilter: ['local_only'],
    capabilityFilter: ['reasoning', 'code', 'text_generation', 'embedding'],
    costFilter: ['free'],
  },
  open_source_eu: {
    label: 'Open Source EU Cluster',
    geoFilter: ['eu_only', 'global'],
    capabilityFilter: ['reasoning', 'code', 'text_generation', 'vision', 'embedding', 'multimodal'],
    costFilter: ['free'],
  },
}

// ─── Snout MRP: Dual-Path Provider Parser ────────────────────────────────────

/**
 * Fast-path: regex-based extraction of structured facts from raw docs.
 * Returns partial PhantomProvider fields — merged with LLM deep-path.
 */
function regexProviderParse(rawDocs: string, sourceUrl: string): Partial<PhantomProvider> {
  const result: Partial<PhantomProvider> = {}

  // Context window (e.g. "128K tokens", "context window: 32768")
  const ctxMatch = rawDocs.match(/(\d+)[Kk]\s*(?:token|context)|context.{0,20}:\s*(\d+)/i)
  if (ctxMatch) {
    const raw = ctxMatch[1] ? Number(ctxMatch[1]) * 1024 : Number(ctxMatch[2])
    result.context_window = raw > 0 ? raw : 0
  }

  // Cost model
  if (/free|open.?source|self.?host/i.test(rawDocs)) result.cost_model = 'free'
  else if (/per.?token|\$/i.test(rawDocs)) result.cost_model = 'per_token'
  else if (/subscri/i.test(rawDocs)) result.cost_model = 'subscription'

  // Geo restriction
  if (/local|self.?host|offline/i.test(rawDocs)) result.geo_restriction = 'local_only'
  else if (/eu.only|gdpr|europe/i.test(rawDocs)) result.geo_restriction = 'eu_only'
  else if (/china|cn.region|\bcn\b/i.test(rawDocs)) result.geo_restriction = 'cn_region'

  // Capabilities
  const caps: ProviderCapability[] = []
  if (/reasoning|think|chain.of.thought/i.test(rawDocs)) caps.push('reasoning')
  if (/code|program|develop/i.test(rawDocs)) caps.push('code')
  if (/vision|image|visual/i.test(rawDocs)) caps.push('vision')
  if (/embed/i.test(rawDocs)) caps.push('embedding')
  if (/multimodal|multi.modal/i.test(rawDocs)) caps.push('multimodal')
  if (caps.length === 0) caps.push('text_generation')
  result.capabilities = caps

  // Version (e.g. "v1.2", "version 3.5", "-3.5-", "-large-")
  const verMatch = rawDocs.match(/v(\d+\.\d+(?:\.\d+)?)|version\s+(\d+\.\d+)|-(\d+\.\d+)-/i)
  result.version = verMatch ? (verMatch[1] ?? verMatch[2] ?? verMatch[3] ?? 'unknown') : 'unknown'

  return result
}

/**
 * Deep-path: LLM extracts structured provider BOM from raw docs.
 */
async function llmProviderParse(name: string, sourceUrl: string, rawDocs: string): Promise<Partial<PhantomProvider>> {
  const prompt = `You are a precise JSON-only AI provider analyst. Extract structured metadata about this AI model/provider.

Provider: ${name}
Source: ${sourceUrl}

DOCUMENTATION:
${rawDocs.substring(0, 3000)}

Return EXACTLY this JSON (no prose, no markdown):
{
  "version": "version string or unknown",
  "context_window": 128000,
  "cost_model": "free",
  "geo_restriction": "global",
  "primary_capability": "reasoning",
  "capabilities": ["reasoning", "code"],
  "confidence": 85
}

cost_model: free | per_token | subscription | unknown
geo_restriction: global | eu_only | local_only | cn_region
primary_capability and capabilities items: reasoning | code | vision | text_generation | embedding | multimodal
confidence: 80+ if well-documented, 70-79 partial, <70 if guessing`

  const raw = await callDeepSeekLlm(prompt)
  try {
    const parsed = JSON.parse(raw.trim())
    return {
      version: String(parsed.version ?? 'unknown'),
      context_window: Number(parsed.context_window ?? 0),
      cost_model: (['free', 'per_token', 'subscription', 'unknown'] as CostModel[]).includes(parsed.cost_model)
        ? parsed.cost_model as CostModel : 'unknown',
      geo_restriction: (['global', 'eu_only', 'local_only', 'cn_region'] as GeoRestriction[]).includes(parsed.geo_restriction)
        ? parsed.geo_restriction as GeoRestriction : 'global',
      primary_capability: parsed.primary_capability as ProviderCapability ?? 'text_generation',
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities as ProviderCapability[] : [],
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence ?? 50))),
    }
  } catch {
    return {}
  }
}

// ─── Snout MRP: CVE Cross-check ───────────────────────────────────────────────

async function cveCheck(providerName: string): Promise<string[]> {
  try {
    const res = await callBackendMcp('graph.read_cypher', {
      query: `MATCH (c:CVE) WHERE toLower(c.description) CONTAINS toLower($name) OR toLower(c.id) CONTAINS toLower($name) RETURN c.id as cveId LIMIT 10`,
      params: { name: providerName },
    }) as { results?: Array<{ cveId: string }> }
    return (res?.results ?? []).map(r => r.cveId).filter(Boolean)
  } catch {
    return []
  }
}

// ─── Snout MRP: HITL Gate ─────────────────────────────────────────────────────

async function hitlGate(provider: PhantomProvider): Promise<{ blocked: boolean; issueId?: string }> {
  if (provider.confidence >= HITL_THRESHOLD) return { blocked: false }

  // Create Linear issue
  try {
    const res = await callBackendMcp('linear.create_issue', {
      title: `[HITL] PhantomProvider low confidence: ${provider.name} (${provider.confidence}%)`,
      description: `PhantomProvider ingest blocked — confidence ${provider.confidence}% is below threshold ${HITL_THRESHOLD}%.\n\nProvider: ${provider.name}\nSource: ${provider.source_url}\nCapabilities: ${provider.capabilities.join(', ')}\n\nManual review required before Neo4j ingest.`,
      labels: ['HITL', 'phantom-bom'],
      priority: 2,
    }) as { issueId?: string }
    return { blocked: true, issueId: res?.issueId }
  } catch {
    return { blocked: true }
  }
}

// ─── Snout MRP: Provider Neo4j Write ─────────────────────────────────────────

async function writeProviderToNeo4j(provider: PhantomProvider): Promise<void> {
  const cypher = `
MERGE (p:PhantomProvider {providerId: $providerId})
SET p.name = $name,
    p.sourceUrl = $sourceUrl,
    p.sourceType = $sourceType,
    p.geoRestriction = $geoRestriction,
    p.primaryCapability = $primaryCapability,
    p.capabilities = $capabilities,
    p.version = $version,
    p.contextWindow = $contextWindow,
    p.costModel = $costModel,
    p.confidence = $confidence,
    p.cveIds = $cveIds,
    p.hitlRequired = $hitlRequired,
    p.hitlLinearIssue = $hitlLinearIssue,
    p.needsEmbedding = true,
    p.updatedAt = datetime()
RETURN p.providerId as id`

  await callBackendMcp('graph.write_cypher', {
    query: cypher,
    params: {
      providerId: provider.id,
      name: provider.name,
      sourceUrl: provider.source_url,
      sourceType: provider.source_type,
      geoRestriction: provider.geo_restriction,
      primaryCapability: provider.primary_capability,
      capabilities: provider.capabilities,
      version: provider.version,
      contextWindow: provider.context_window,
      costModel: provider.cost_model,
      confidence: provider.confidence,
      cveIds: provider.cve_ids,
      hitlRequired: provider.hitl_required,
      hitlLinearIssue: provider.hitl_linear_issue ?? null,
    },
  })
}

// ─── Snout MRP: extractProvider ───────────────────────────────────────────────

/**
 * Ingest an AI provider (model/API) into the graph.
 * Dual-path parse: regex fast-path merged with LLM deep-path.
 * HITL gate: blocks Neo4j write if confidence < 70.
 * CVE check: links to existing CVE nodes.
 */
export async function extractProvider(opts: {
  name: string
  source_url: string
  source_type: 'github' | 'huggingface' | 'npm' | 'manual'
  geo_restriction?: GeoRestriction
  primary_capability?: ProviderCapability
  raw_docs: string
}): Promise<{ provider: PhantomProvider; blocked: boolean; hitl_issue?: string; cve_count: number }> {
  const providerId = 'prov-' + createHash('sha256').update(opts.source_url + opts.name).digest('hex').substring(0, 16)
  logger.info({ providerId, name: opts.name }, 'PhantomProvider extraction started')

  // Dual-path parse — run in parallel, merge results
  const [regexResult, llmResult] = await Promise.all([
    Promise.resolve(regexProviderParse(opts.raw_docs, opts.source_url)),
    llmProviderParse(opts.name, opts.source_url, opts.raw_docs),
  ])

  // Merge: LLM wins on conflicts (more semantic), regex fills gaps
  const merged = { ...regexResult, ...llmResult }

  // CVE cross-check
  const cve_ids = await cveCheck(opts.name)

  const provider: PhantomProvider = {
    id: providerId,
    name: opts.name,
    source_url: opts.source_url,
    source_type: opts.source_type,
    geo_restriction: opts.geo_restriction ?? merged.geo_restriction ?? 'global',
    primary_capability: opts.primary_capability ?? merged.primary_capability ?? 'text_generation',
    version: merged.version ?? 'unknown',
    context_window: merged.context_window ?? 0,
    cost_model: merged.cost_model ?? 'unknown',
    confidence: merged.confidence ?? 50,
    capabilities: merged.capabilities ?? [],
    cve_ids,
    raw_docs: opts.raw_docs.substring(0, 2000),
    hitl_required: (merged.confidence ?? 50) < HITL_THRESHOLD,
    hitl_linear_issue: undefined,
  }

  // HITL gate
  const hitl = await hitlGate(provider)
  provider.hitl_required = hitl.blocked
  provider.hitl_linear_issue = hitl.issueId

  if (!hitl.blocked) {
    await writeProviderToNeo4j(provider)
    logger.info({ providerId, confidence: provider.confidence, cves: cve_ids.length }, 'PhantomProvider written to Neo4j')
  } else {
    logger.warn({ providerId, confidence: provider.confidence, issue: hitl.issueId }, 'PhantomProvider blocked by HITL gate')
  }

  return { provider, blocked: hitl.blocked, hitl_issue: hitl.issueId, cve_count: cve_ids.length }
}

// ─── Snout MRP: Phantom Cluster Generator ────────────────────────────────────

/**
 * MRP clustering engine. Queries all PhantomProvider nodes from Neo4j,
 * groups them by strategy, computes cluster score, writes PhantomCluster nodes.
 */
export async function generatePhantomClusters(): Promise<PhantomCluster[]> {
  logger.info('Generating PhantomClusters')

  // Fetch all providers from Neo4j
  // Note: WHERE hitlRequired = false has a Neo4j MCP parameter binding bug,
  // so we fetch all and filter in JS.
  const res = await callBackendMcp('graph.read_cypher', {
    query: `MATCH (p:PhantomProvider) RETURN p.providerId as id, p.geoRestriction as geo, p.capabilities as caps, p.costModel as cost, p.confidence as conf, p.hitlRequired as hitl`,
    params: {},
  }) as { results?: Array<{ id: string; geo: string; caps: string[]; cost: string; conf: number | { low: number; high: number }; hitl: boolean }> }

  const providers = res?.results ?? []
  if (providers.length === 0) return []

  // Unwrap Neo4j integer objects {low, high} → plain numbers and filter HITL-blocked
  const normalizedProviders = providers
    .filter(p => !p.hitl)  // Skip HITL-blocked providers
    .map(p => ({
      ...p,
      conf: typeof p.conf === 'object' && p.conf !== null ? (p.conf as { low: number }).low : (p.conf ?? 0),
    }))

  logger.info({ totalProviders: normalizedProviders.length, rawCount: providers.length }, 'PhantomCluster: loaded providers')

  const clusters: PhantomCluster[] = []

  for (const [strategy, def] of Object.entries(CLUSTER_STRATEGIES) as [ClusterStrategy, typeof CLUSTER_STRATEGIES[ClusterStrategy]][]) {
    const members = normalizedProviders.filter(p => {
      const geoOk = def.geoFilter.includes(p.geo as GeoRestriction)
      const costOk = def.costFilter.includes(p.cost as CostModel)
      const capOk = (p.caps ?? []).some(c => def.capabilityFilter.includes(c as ProviderCapability))
      logger.info({ provider: p.id, strategy, geo: p.geo, geoOk, cost: p.cost, costOk, caps: p.caps, capOk }, 'PhantomCluster: provider filter check')
      return geoOk && costOk && capOk
    })
    logger.info({ strategy, memberCount: members.length }, 'PhantomCluster: strategy members')

    if (members.length === 0) continue

    const avg_conf = members.reduce((s, p) => s + (p.conf ?? 0), 0) / members.length
    // score = 0.5×avg_conf/100 + 0.3×min(count/5,1) + 0.2×avg_uptime (uptime unknown → 0.8 default)
    const score = Math.round((0.5 * (avg_conf / 100) + 0.3 * Math.min(members.length / 5, 1) + 0.2 * 0.8) * 100) / 100

    const clusterId = `cluster-${strategy}-${Date.now()}`
    const cluster: PhantomCluster = {
      id: clusterId,
      strategy,
      score,
      member_count: members.length,
      avg_confidence: Math.round(avg_conf),
      provider_ids: members.map(p => p.id),
      created_at: new Date().toISOString(),
    }

    // MERGE PhantomCluster + link members
    await callBackendMcp('graph.write_cypher', {
      query: `
MERGE (cl:PhantomCluster {clusterId: $clusterId})
SET cl.strategy = $strategy,
    cl.strategyLabel = $strategyLabel,
    cl.score = $score,
    cl.memberCount = $memberCount,
    cl.avgConfidence = $avgConfidence,
    cl.providerIds = $providerIds,
    cl.createdAt = datetime($createdAt),
    cl.updatedAt = datetime()
RETURN cl.clusterId as id`,
      params: {
        clusterId,
        strategy,
        strategyLabel: def.label,
        score,
        memberCount: members.length,
        avgConfidence: Math.round(avg_conf),
        providerIds: members.map(p => p.id),
        createdAt: cluster.created_at,
      },
    })

    clusters.push(cluster)
    logger.info({ clusterId, strategy, members: members.length, score }, 'PhantomCluster created')
  }

  return clusters
}

// ─── Snout MRP: Provider Registry ────────────────────────────────────────────

export async function getProviderRegistry(): Promise<{
  total: number
  active: number
  hitl_blocked: number
  providers: Array<{ id: string; name: string; geo: string; capability: string; confidence: number; cves: number; hitl: boolean }>
}> {
  const res = await callBackendMcp('graph.read_cypher', {
    query: `MATCH (p:PhantomProvider) RETURN p.providerId as id, p.name as name, p.geoRestriction as geo, p.primaryCapability as cap, p.confidence as conf, size(p.cveIds) as cves, p.hitlRequired as hitl ORDER BY p.confidence DESC`,
    params: {},
  }) as { results?: Array<{ id: string; name: string; geo: string; cap: string; conf: number; cves: number; hitl: boolean }> }

  const rows = res?.results ?? []
  return {
    total: rows.length,
    active: rows.filter(r => !r.hitl).length,
    hitl_blocked: rows.filter(r => r.hitl).length,
    providers: rows.map(r => ({ id: r.id, name: r.name, geo: r.geo, capability: r.cap, confidence: r.conf, cves: r.cves, hitl: r.hitl })),
  }
}
