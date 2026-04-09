/**
 * phantom-bom.ts — PhantomBOMExtractor Service
 *
 * Uses repomix to pack external repos → direct DeepSeek LLM extraction →
 * MERGE PhantomBOMRun + PhantomComponent nodes into Neo4j.
 *
 * Pipeline:
 *   npx repomix --remote <repo> --stdout --style plain
 *     → Packed repo text (token-optimised, no binaries)
 *     → DeepSeek LLM: extract structured BOM JSON
 *     → Neo4j MERGE: PhantomBOMRun + PhantomComponent + [:EXTRACTED]
 *
 * Confidence thresholds:
 *   ≥80  — auto-accept
 *   70-79 — borderline (flagged)
 *   <70  — low confidence (HITL recommended)
 *
 * Node labels: PhantomBOMRun, PhantomComponent
 * All PhantomComponent nodes get needsEmbedding: true
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
