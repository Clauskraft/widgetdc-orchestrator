/**
 * phantom-bom.ts — PhantomBOMExtractor Service
 *
 * Clones external repos → scans key files → LLM entity extraction via RLM Engine →
 * MERGE PhantomBOMRun + PhantomComponent nodes into Neo4j.
 *
 * Design:
 *  - Confidence ≥ 80: auto-accept
 *  - Confidence 70-79: borderline (flagged in BOM)
 *  - Confidence < 70: low confidence (HITL recommended)
 *
 * Node labels: PhantomBOMRun, PhantomComponent
 * Relationship: (:PhantomBOMRun)-[:EXTRACTED]->(:PhantomComponent)
 *
 * All components get needsEmbedding: true for downstream reindex cron.
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, extname, basename } from 'path'
import { createHash } from 'crypto'
import { config } from './config.js'
import { logger } from './logger.js'
import { tmpdir } from 'os'

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

const KEY_FILE_PATTERNS = [
  // Documentation / entry points
  'README.md', 'README.rst', 'README.txt', 'ARCHITECTURE.md', 'DESIGN.md',
  // Package manifests
  'package.json', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Cargo.toml', 'go.mod',
  'requirements.txt', 'composer.json', 'pom.xml', 'build.gradle',
  // Config / deployment
  'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile',
  'railway.json', 'vercel.json', 'netlify.toml',
  // OpenAPI / schemas
  'openapi.yaml', 'openapi.json', 'openapi.yml',
  'swagger.yaml', 'swagger.json',
]

const KEY_CODE_EXTENSIONS = ['.ts', '.py', '.js', '.go', '.rs', '.java', '.cs', '.rb']
const MAX_CODE_FILES = 12
const MAX_FILE_CHARS = 8000
const MAX_TOTAL_CHARS = 40000
const LLM_TIMEOUT_MS = 120_000
const CLONE_TIMEOUT_MS = 60_000

// In-memory run state (survives for this process lifetime)
const runState = new Map<string, { status: PhantomBOMRunStatus; bom?: PhantomBOM; error?: string; startedAt: string }>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function phantomId(sourceRepo: string, name: string, type: string): string {
  const hash = createHash('sha256').update(sourceRepo + name + type).digest('hex').substring(0, 16)
  return `phantom-${hash}`
}

function safeStat(p: string) {
  try { return statSync(p) } catch { return null }
}

function collectKeyFiles(repoDir: string): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = []
  let totalChars = 0

  // 1. Priority: key file names (README, manifests, etc.)
  for (const pattern of KEY_FILE_PATTERNS) {
    const fullPath = join(repoDir, pattern)
    const s = safeStat(fullPath)
    if (s && s.isFile()) {
      try {
        const raw = readFileSync(fullPath, 'utf8')
        const truncated = raw.substring(0, MAX_FILE_CHARS)
        results.push({ path: pattern, content: truncated })
        totalChars += truncated.length
        if (totalChars >= MAX_TOTAL_CHARS) break
      } catch { /* skip unreadable */ }
    }
  }

  if (totalChars >= MAX_TOTAL_CHARS) return results

  // 2. Source code files: walk top 2 levels only (avoid deep src crawl)
  const codeCandidates: string[] = []
  const walkLevel = (dir: string, depth: number) => {
    if (depth > 2) return
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === '__pycache__' || entry === 'dist' || entry === 'build') continue
        const full = join(dir, entry)
        const s = safeStat(full)
        if (!s) continue
        if (s.isFile() && KEY_CODE_EXTENSIONS.includes(extname(entry))) {
          codeCandidates.push(full)
        } else if (s.isDirectory() && depth < 2) {
          walkLevel(full, depth + 1)
        }
      }
    } catch { /* skip unreadable dir */ }
  }
  walkLevel(repoDir, 0)

  // Sort: prefer shorter paths (root-level files), then alphabetical
  codeCandidates.sort((a, b) => {
    const depthA = a.split('/').length
    const depthB = b.split('/').length
    if (depthA !== depthB) return depthA - depthB
    return a.localeCompare(b)
  })

  let codeCount = 0
  for (const codePath of codeCandidates) {
    if (codeCount >= MAX_CODE_FILES) break
    if (totalChars >= MAX_TOTAL_CHARS) break
    // Skip if already captured as a key file
    const rel = codePath.replace(repoDir + '/', '')
    if (results.some(r => r.path === rel)) continue
    try {
      const raw = readFileSync(codePath, 'utf8')
      const truncated = raw.substring(0, MAX_FILE_CHARS)
      results.push({ path: rel, content: truncated })
      totalChars += truncated.length
      codeCount++
    } catch { /* skip */ }
  }

  return results
}

function buildExtractionPrompt(repoUrl: string, files: { path: string; content: string }[]): string {
  const fileBlocks = files.map(f =>
    `=== FILE: ${f.path} ===\n${f.content}\n`
  ).join('\n')

  return `You are a software intelligence analyst. Analyze this repository and extract a structured Bill of Materials (BOM).

Repository: ${repoUrl}

FILES:
${fileBlocks}

Extract and return a JSON object with this exact schema (no markdown, no explanation, just JSON):

{
  "repo_meta": {
    "name": "<repo name>",
    "description": "<1-2 sentence description>",
    "primary_language": "<main programming language>",
    "license": "<license or 'unknown'>",
    "topics": ["<tag1>", "<tag2>"]
  },
  "confidence_score": <integer 0-100 representing overall extraction confidence>,
  "summary": "<2-3 sentence summary of what this repo does and why it matters>",
  "components": [
    {
      "name": "<component name>",
      "type": "<one of: tool|api|model|dataset|pattern|agent|service|library>",
      "description": "<what this component does>",
      "source_file": "<file where this was found, or null>",
      "capabilities": ["<capability1>", "<capability2>"],
      "dependencies": ["<dep1>", "<dep2>"],
      "confidence": <integer 0-100>,
      "tags": ["<tag1>", "<tag2>"]
    }
  ]
}

Rules:
- Extract 3-15 meaningful components. Skip boilerplate files.
- type must be exactly one of: tool, api, model, dataset, pattern, agent, service, library
- confidence_score: 80+ if files clearly document the system, 70-79 if partial info, <70 if guessing
- Return ONLY valid JSON. No markdown fences, no explanation.`
}

async function callRlmLlm(prompt: string): Promise<string> {
  const body = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
    skill_id: 'cognitive-reasoning',
    provider: 'deepseek',
  }

  const res = await fetch(`${config.rlmUrl}/a2a/tasks/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.backendApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`RLM LLM call failed: ${res.status} — ${text.substring(0, 200)}`)
  }

  const data = await res.json() as { result?: { text?: string }; output?: string; text?: string }
  // RLM returns result.text or output or text depending on skill version
  const text = data?.result?.text ?? (data as Record<string, unknown>)?.output as string ?? data?.text ?? ''
  if (!text) throw new Error('RLM returned empty text')
  return text as string
}

function parseLlmBom(raw: string, repoUrl: string): { repo_meta: PhantomBOM['repo_meta']; confidence_score: number; summary: string; components: Omit<PhantomComponent, 'id'>[] } {
  // Strip markdown fences if model ignored instructions
  let json = raw.trim()
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  }

  const parsed = JSON.parse(json)
  return {
    repo_meta: {
      name: String(parsed.repo_meta?.name ?? basename(repoUrl)),
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

  const runParams = {
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
  }

  await callBackendMcp('graph.write_cypher', { query: runCypher, params: runParams })

  // MERGE each PhantomComponent + create relationship
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

    const compParams = {
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
    }

    await callBackendMcp('graph.write_cypher', { query: compCypher, params: compParams })
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

// ─── Core extraction ──────────────────────────────────────────────────────────

export async function extractPhantomBOM(
  repoUrl: string,
  sourceType: 'git' | 'huggingface' = 'git',
  runId?: string
): Promise<PhantomBOM> {
  const id = runId ?? `pbom-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  const cloneDir = join(tmpdir(), `phantom-bom-${id}`)

  runState.set(id, { status: 'running', startedAt: new Date().toISOString() })
  logger.info({ runId: id, repoUrl }, 'PhantomBOM extraction started')

  try {
    // 1. Clone repo (shallow, 1 commit only)
    mkdirSync(cloneDir, { recursive: true })
    const cloneCmd = sourceType === 'git'
      ? `git clone --depth 1 --single-branch ${repoUrl} ${cloneDir}`
      : `git clone --depth 1 https://huggingface.co/${repoUrl} ${cloneDir}`

    execSync(cloneCmd, { timeout: CLONE_TIMEOUT_MS, stdio: 'pipe' })
    logger.info({ runId: id }, 'Repo cloned')

    // 2. Collect key files
    const files = collectKeyFiles(cloneDir)
    logger.info({ runId: id, fileCount: files.length }, 'Files collected')

    if (files.length === 0) {
      throw new Error('No readable files found in repository')
    }

    // 3. Build prompt and call LLM
    const prompt = buildExtractionPrompt(repoUrl, files)
    const rawLlmOutput = await callRlmLlm(prompt)
    logger.info({ runId: id }, 'LLM extraction complete')

    // 4. Parse BOM
    const extracted = parseLlmBom(rawLlmOutput, repoUrl)

    // 5. Assemble full BOM with IDs
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

    // 6. Write to Neo4j
    await writeToNeo4j(bom)
    logger.info({ runId: id, components: bom.components.length }, 'PhantomBOM written to Neo4j')

    runState.set(id, { status: 'completed', bom, startedAt: runState.get(id)!.startedAt })
    return bom

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ runId: id, err: msg }, 'PhantomBOM extraction failed')
    runState.set(id, { status: 'failed', error: msg, startedAt: runState.get(id)!.startedAt })
    throw err
  } finally {
    // Always clean up clone dir
    try {
      if (existsSync(cloneDir)) rmSync(cloneDir, { recursive: true, force: true })
    } catch { /* cleanup failure is non-critical */ }
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
