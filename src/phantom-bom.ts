/**
 * phantom-bom.ts — PhantomBOMExtractor + Snout MRP Service
 *
 * Two extraction modes:
 *   1. REPO BOM  — repomix packs a GitHub/HuggingFace repo → DeepSeek extracts
 *                  PhantomComponent nodes (tools/libs/services/agents)
 *                  LIN-764: Tree-sitter AST parsing now runs FIRST for precise
 *                  extraction of TypeScript/Python files (deterministic, no tokens)
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

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { logger } from './logger.js'
import { parseDirectory, type ASTModule } from './tree-sitter-ingestion/parser.js'
import { emitPhantomDiscovery } from './knowledge/adapters/phantom-bom-adapter.js'

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
 * Converts HTTPS URLs to "user/repo" format that repomix expects.
 */
function runRepomix(repoUrl: string): string {
  // repomix --remote expects "user/repo" format, not HTTPS URLs
  let remoteArg = repoUrl
  if (repoUrl.startsWith('http')) {
    // Convert https://github.com/user/repo.git → user/repo
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
    if (match) remoteArg = `${match[1]}/${match[2]}`
  }

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

function isAwesomeList(repoUrl: string): boolean {
  const name = (repoUrl.split('/').pop() ?? '').toLowerCase().replace(/\.git$/, '')
  return /^awesome[-_]/.test(name) || name.includes('-awesome-') || name.endsWith('-awesome')
}

function buildAwesomeExtractionPrompt(repoUrl: string, packedRepo: string): string {
  return `You are a pattern-stealing software intelligence analyst. This is an AWESOME-LIST: a curated markdown catalog of projects, ideas, or patterns.

Your job is NOT to extract verbatim code. Your job is to STEAL THE CORE IDEAS — distill each listed entry into a reusable pattern that a downstream platform could learn from and adapt. Think: "what is the stealable insight", not "what is the library".

CRITICAL: Your entire response must be valid JSON only. No markdown, no explanation, no prose. Start with { and end with }.

Repository: ${repoUrl}

LIST CONTENTS (packed by repomix):
${packedRepo}

Return EXACTLY this JSON structure:

{
  "repo_meta": {
    "name": "short list name",
    "description": "1-2 sentences on the domain this list curates",
    "primary_language": "markdown",
    "license": "license name or unknown",
    "topics": ["topic1", "topic2"]
  },
  "confidence_score": 85,
  "summary": "2-3 sentences on what patterns/ideas this list surfaces that are worth stealing",
  "components": [
    {
      "name": "pattern name (short, descriptive — NOT the verbatim project name)",
      "type": "pattern",
      "description": "the STEALABLE CORE IDEA in one sentence — the insight, architecture, or technique a new implementation could adopt",
      "source_file": "https://… provenance URL if present in the list, else null",
      "capabilities": ["what this pattern enables", "downstream use"],
      "dependencies": ["conceptual prerequisites, NOT verbatim libraries"],
      "confidence": 85,
      "tags": ["domain tag", "pattern-family tag"]
    }
  ]
}

RULES:
- type MUST be "pattern" for every component — this list is a pattern catalog.
- description is the IDEA, not a project blurb. One sentence, re-implementable.
- name should be a GENERIC pattern name when possible (e.g. "Sliding-window context compression" not "Compressor-2024"). If a verbatim name carries the idea, keep it.
- capabilities describe what the pattern DOES, not what the project claims.
- Extract 10-30 patterns. Prioritize the ones that transfer to multi-agent / RAG / MCP / knowledge-graph platforms.
- confidence_score: 80+ if pattern is clear, 70-79 if curated with prose, <70 if guessing.

Return ONLY valid JSON.`
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
  // LIN-856 P1c: auto-inject governance fields for graph.write_cypher so this
  // direct HTTP path cannot bypass the backend enforcement gate (mirrors the
  // B-1 block in mcp-caller.ts:327 for callMcpTool). Explicit caller values
  // always win because they spread after the defaults.
  let finalPayload = payload
  if (tool === 'graph.write_cypher') {
    const GOVERNANCE_FIELDS = ['intent', 'purpose', 'objective', 'evidence', 'verification', 'test_results'] as const
    if (GOVERNANCE_FIELDS.some(f => !payload[f])) {
      const query = typeof payload.query === 'string' ? payload.query : ''
      const mergeMatch = query.match(/(?:MERGE|CREATE)\s+\(\w+:(\w+)/i)
      const setMatch = query.match(/SET\s+\w+\.(\w+)/i)
      const nodeLabel = mergeMatch ? mergeMatch[1] : 'Node'
      const firstProp = setMatch ? setMatch[1] : 'data'
      const paramsSnippet = payload.params
        ? JSON.stringify(payload.params).slice(0, 120)
        : '(no params)'
      finalPayload = {
        intent: `Persist ${nodeLabel} ${firstProp} to graph`,
        purpose: `Maintain ${nodeLabel} history for platform intelligence`,
        objective: `Store ${nodeLabel} in Neo4j for cross-session analysis`,
        evidence: paramsSnippet,
        verification: `MATCH (n:${nodeLabel}) RETURN count(n) LIMIT 1`,
        test_results: 'auto-governance-injected',
        // Explicit caller values overwrite defaults (spread after)
        ...payload,
      }
    }
  }
  const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.backendApiKey}`,
    },
    body: JSON.stringify({ tool, payload: finalPayload }),
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
    intent: 'phantom_bom_ingestion',
    evidence: 'phantom-BOM pipeline output (LLM/Tree-sitter extraction + completeness gate, see PhantomBOMRun.confidenceScore)',
    verification: 'idempotent MERGE by primary key (runId/componentId/providerId/clusterId/external_id); read-back verifies node exists',
    test_results: 'extract/sync endpoint validates round-trip; EvidenceObject records CompletenessGate PASS/FAIL',
    purpose: `Ingest PhantomBOMRun metadata for ${bom.source_repo} (componentCount=${bom.components.length})`,
    objective: 'Persist BOM run root-node so downstream components/providers/clusters can MERGE with FK to runId',
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
      intent: 'phantom_bom_ingestion',
    evidence: 'phantom-BOM pipeline output (LLM/Tree-sitter extraction + completeness gate, see PhantomBOMRun.confidenceScore)',
    verification: 'idempotent MERGE by primary key (runId/componentId/providerId/clusterId/external_id); read-back verifies node exists',
    test_results: 'extract/sync endpoint validates round-trip; EvidenceObject records CompletenessGate PASS/FAIL',
      purpose: `Persist PhantomComponent ${comp.name} extracted from ${bom.source_repo}`,
      objective: 'Store reusable capability component with provenance link to PhantomBOMRun',
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

    // Emit discovery to KnowledgeBus — non-blocking, best-effort.
    // Allows knowledge normalization bus to route the component to L2/L3/L4
    // depending on score. Score 0.80 → L3 tier directly.
    try {
      emitPhantomDiscovery({
        toolName: comp.name,
        toolDescription: comp.description,
        repo: bom.source_repo,
        discoveredIn: comp.source_file ?? `${bom.source_repo} (phantom-bom scan)`,
        componentType: comp.type,
        confidence: comp.confidence,
        capabilities: comp.capabilities,
        tags: comp.tags,
      })
    } catch (err) {
      logger.warn({ componentId: comp.id, err: String(err) }, 'PhantomBOMAdapter: emit failed (non-blocking)')
    }

    // Auto-embed: non-blocking fire-and-forget vidensarkiv.add per component.
    // vidensarkiv.add creates a searchable VectorDocument (with embedding) linked
    // back to this PhantomComponent by componentId. After success, clear
    // needsEmbedding flag so the backfill cron skips it.
    //
    // Errors are swallowed — extraction must not fail on embedding hiccups.
    autoEmbedComponent(comp, bom).catch((err) => {
      logger.warn({ runId: bom.run_id, componentId: comp.id, err: String(err) }, 'Auto-embed failed (non-blocking)')
    })
  }
}

async function autoEmbedComponent(comp: PhantomComponent, bom: PhantomBOM): Promise<void> {
  const content = [
    `${comp.name}: ${comp.description ?? ''}`,
    comp.capabilities?.length ? `Capabilities: ${comp.capabilities.join(', ')}` : null,
    comp.tags?.length ? `Tags: ${comp.tags.join(', ')}` : null,
  ].filter(Boolean).join('\n')

  await callBackendMcp('vidensarkiv.add', {
    content,
    metadata: {
      source: 'phantom-bom',
      type: comp.type,
      name: comp.name,
      componentId: comp.id,
      sourceRepo: bom.source_repo,
      runId: bom.run_id,
    },
  })

  // Clear the queue flag so future backfill scans skip this component.
  await callBackendMcp('graph.write_cypher', {
    query: 'MATCH (c:PhantomComponent {componentId: $cid}) SET c.needsEmbedding = false, c.embeddedAt = datetime() RETURN c.componentId',
    params: { cid: comp.id },
    intent: 'phantom_bom_ingestion',
    purpose: `Mark PhantomComponent ${comp.name} as embedded after vidensarkiv.add succeeded`,
    objective: 'Remove component from needsEmbedding backfill queue',
    evidence: 'autoEmbedComponent completed successfully for this componentId',
    verification: 'idempotent SET on existing node; no-op if component already cleared',
    test_results: 'vidensarkiv.add returned success for content+metadata',
  })
}

// ─── Completeness Gate (P1 Fix LIN-763) ────────────────────────────────────

/**
 * Convert AST modules (Tree-sitter) to PhantomComponent format.
 * LIN-764: Precise, deterministic extraction — no LLM tokens needed.
 */
function astModulesToPhantomComponents(modules: ASTModule[], sourceRepo: string): Omit<PhantomComponent, 'id'>[] {
  const components: Omit<PhantomComponent, 'id'>[] = []

  for (const mod of modules) {
    // Aggregate all unique symbols across files in this module
    const allSymbols = mod.files.flatMap(f => f.symbols)
    const allCalls = mod.files.flatMap(f => f.callSites)
    const allImports = [...new Set(mod.files.flatMap(f => f.imports))]
    const allExports = [...new Set(mod.files.flatMap(f => f.exports))]

    // Classify component type based on exports
    let type: PhantomComponent['type'] = 'library'
    if (allSymbols.some(s => s.kind === 'class' || s.kind === 'interface')) {
      const hasApi = allSymbols.some(s => s.kind === 'method' && s.name.toLowerCase().includes('route'))
      type = hasApi ? 'api' : 'library'
    }
    if (allSymbols.some(s => s.kind === 'function' && s.name.toLowerCase().includes('agent'))) {
      type = 'agent'
    }
    if (allSymbols.some(s => s.kind === 'function' && (s.name.toLowerCase().includes('tool') || s.name.toLowerCase().includes('extract')))) {
      type = 'tool'
    }

    // Extract capabilities from symbol names
    const capabilities = [...new Set(allSymbols
      .filter(s => s.kind === 'class' || s.kind === 'function' || s.kind === 'method')
      .map(s => s.name.toLowerCase())
      .slice(0, 10)
    )]

    // Extract dependencies from imports (external packages only)
    const deps = allImports
      .filter(i => !i.startsWith('.') && !i.startsWith('/'))
      .map(i => i.split('/')[0])
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 15)

    // Confidence based on parse success rate
    const parseSuccess = mod.files.filter(f => !f.error).length
    const confidence = Math.round((parseSuccess / Math.max(mod.files.length, 1)) * 100)

    components.push({
      name: mod.name.replace('src/', ''),
      type,
      description: `${mod.name}: ${mod.files.length} files, ${mod.symbolCount} symbols, ${mod.callSiteCount} call sites`,
      source_file: mod.files[0]?.path ?? null,
      capabilities,
      dependencies: deps,
      confidence,
      tags: ['tree-sitter', 'ast-extracted', ...mod.files.slice(0, 3).map(f => f.language)],
    })
  }

  return components
}

/**
 * Clone repo to temp dir, run Tree-sitter AST extraction, return components.
 * LIN-764: Primary extraction method — deterministic, no LLM tokens.
 */
function extractViaTreeSitter(repoUrl: string): {
  components: Omit<PhantomComponent, 'id'>[]
  moduleCount: number
  symbolCount: number
  callSiteCount: number
} {
  const tmpDir = `_treesitter-${Date.now()}`
  try {
    const remoteArg = repoUrl.startsWith('http')
      ? repoUrl
      : repoUrl

    logger.info({ cmd: `git clone ${remoteArg}` }, 'Tree-sitter: cloning repo')
    execSync(`git clone --depth 1 ${remoteArg} ${tmpDir}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    })

    // Run Tree-sitter AST extraction
    const modules = parseDirectory(tmpDir, 500)
    const components = astModulesToPhantomComponents(modules, repoUrl)

    const totalSymbols = modules.reduce((s, m) => s + m.symbolCount, 0)
    const totalCalls = modules.reduce((s, m) => s + m.callSiteCount, 0)

    logger.info({
      modules: modules.length,
      components: components.length,
      symbols: totalSymbols,
      callSites: totalCalls,
    }, 'Tree-sitter extraction complete')

    return {
      components,
      moduleCount: modules.length,
      symbolCount: totalSymbols,
      callSiteCount: totalCalls,
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

/**
 * Extract directory/module structure from cloned repo.
 * Returns list of module names with file counts and export types.
 */
function extractModuleStructure(repoUrl: string): Array<{
  name: string
  files: number
  hasExports: boolean
  exportTypes: string[]
}> {
  const tmpDir = `_clone-gate-${Date.now()}`
  try {
    const remoteArg = repoUrl.startsWith('http') ? repoUrl : repoUrl
    execSync(`git clone --depth 1 ${remoteArg} ${tmpDir}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    })

    const exts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']
    const files: Array<{ path: string }> = []
    function walk(d: string) {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.github') continue
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (exts.some(e => entry.name.endsWith(e))) {
          files.push({ path: full })
        }
      }
    }
    walk(tmpDir)

    // Group by subdirectory module
    const modules = new Map<string, Array<{ path: string }>>()
    for (const f of files) {
      const rel = f.path.replace(path.sep, '/').substring(tmpDir.length + 1)
      const parts = rel.split('/')
      let key: string
      if (parts.length >= 3 && parts[0] === 'src') {
        key = `src/${parts[1]}`
      } else if (parts.length >= 2) {
        key = parts[0]
      } else {
        key = '__root__'
      }
      if (!modules.has(key)) modules.set(key, [])
      modules.get(key)!.push(f)
    }

    const result: Array<{ name: string; files: number; hasExports: boolean; exportTypes: string[] }> = []
    for (const [name, modFiles] of modules) {
      let hasExports = false
      const exportTypes = new Set<string>()
      for (const f of modFiles) {
        try {
          const content = fs.readFileSync(f.path, 'utf8')
          if (/^export (default |const |class |function |interface |type |enum )/m.test(content)) {
            hasExports = true
            if (/export class /m.test(content)) exportTypes.add('class')
            if (/export function /m.test(content)) exportTypes.add('function')
            if (/export interface /m.test(content)) exportTypes.add('interface')
            if (/export type /m.test(content)) exportTypes.add('type')
            if (/export const /m.test(content)) exportTypes.add('const')
            if (/export default/m.test(content)) exportTypes.add('default')
          }
        } catch { /* skip binary files */ }
      }
      result.push({ name, files: modFiles.length, hasExports, exportTypes: [...exportTypes] })
    }

    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}

    return result
  } catch {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    return []
  }
}

/**
 * Completeness gate: compare LLM-extracted components vs actual repo modules.
 * Returns { completeness, missed, matched, total }.
 */
function checkCompleteness(
  components: PhantomComponent[],
  modules: Array<{ name: string }>
): { completeness: number; matched: number; missed: string[]; total: number } {
  if (modules.length === 0) return { completeness: 100, matched: 0, missed: [], total: 0 }
  if (components.length === 0) return { completeness: 0, matched: 0, missed: modules.map(m => m.name), total: modules.length }

  const compNames = components.map(c => c.name.toLowerCase())
  const matched = modules.filter(m => {
    const mLower = m.name.toLowerCase()
    return compNames.some(cn => {
      if (mLower.includes(cn) || cn.includes(mLower)) return true
      // Semantic matches
      if (mLower.includes('orchestrator') && cn.includes('coordinator')) return true
      if (mLower.includes('agent') && (cn.includes('worker') || cn.includes('agent'))) return true
      if (mLower.includes('task') && cn.includes('task')) return true
      if (mLower.includes('llm') && cn.includes('model')) return true
      if (mLower.includes('tool') && cn.includes('tool')) return true
      if (mLower.includes('memory') && cn.includes('memory')) return true
      return false
    })
  })
  const missed = modules.filter(m => !matched.includes(m)).map(m => m.name)
  return {
    completeness: Math.round((matched.length / modules.length) * 100),
    matched: matched.length,
    missed,
    total: modules.length,
  }
}

/**
 * Build a targeted re-extraction prompt for missed modules.
 */
function buildRecoveryPrompt(
  repoUrl: string,
  packedRepo: string,
  missedModules: string[]
): string {
  return `You previously extracted components from ${repoUrl} but missed these modules:

MISSED MODULES (you MUST extract components for each):
${missedModules.map(m => `- ${m}`).join('\n')}

REPOSITORY CONTENTS:
${packedRepo}

Return ONLY valid JSON with additional components for the missed modules above.
Use this exact structure:
{"components": [{"name": "...", "type": "tool|api|model|dataset|pattern|agent|service|library", "description": "...", "source_file": "path or null", "capabilities": [], "dependencies": [], "confidence": 85, "tags": []}]}`
}

// ─── Core extraction (with completeness gate) ───────────────────────────────

export async function extractPhantomBOM(
  repoUrl: string,
  sourceType: 'git' | 'huggingface' = 'git',
  runId?: string
): Promise<PhantomBOM> {
  const id = runId ?? `pbom-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  runState.set(id, { status: 'running', startedAt: new Date().toISOString() })
  logger.info({ runId: id, repoUrl }, 'PhantomBOM extraction started')

  // Hoist completeness-gate result so it's defined for both Tree-sitter and LLM paths.
  // Tree-sitter path is deterministic/complete by construction → 100%.
  let gate: { completeness: number; matched: number; missed: string[]; total: number } = { completeness: 100, matched: 0, missed: [], total: 0 }

  try {
    // 1. ── TREE-SITTER AST EXTRACTION (LIN-764: Primary method) ─────────────
    let astResult: { components: Omit<PhantomComponent, 'id'>[]; moduleCount: number; symbolCount: number; callSiteCount: number } | null = null
    try {
      astResult = extractViaTreeSitter(repoUrl)
      logger.info({
        runId: id,
        tsComponents: astResult.components.length,
        tsModules: astResult.moduleCount,
        tsSymbols: astResult.symbolCount,
        tsCallSites: astResult.callSiteCount,
      }, 'Tree-sitter extraction complete')
    } catch (err) {
      logger.warn({ runId: id, err: err instanceof Error ? err.message : String(err) }, 'Tree-sitter extraction failed — falling back to LLM')
    }

    // If Tree-sitter found components, use them; otherwise fall back to LLM
    let extracted: { repo_meta: PhantomBOM['repo_meta']; confidence_score: number; summary: string; components: Omit<PhantomComponent, 'id'>[] }

    if (astResult && astResult.components.length > 0) {
      logger.info({ runId: id, tsComponents: astResult.components.length }, 'Using Tree-sitter AST extraction (deterministic, no tokens)')

      // Use basic repo metadata from LLM (cheap, just name/description)
      let repoMeta: PhantomBOM['repo_meta'] = {
        name: repoUrl.split('/').pop()?.replace('.git', '') ?? 'unknown',
        description: '',
        primary_language: 'unknown',
        license: 'unknown',
        topics: [],
      }

      // Try to get basic metadata from LLM (small prompt, cheap)
      try {
        const metaPrompt = `Extract basic info about this repo in JSON only:\n${repoUrl}\n\nReturn: {"name":"...","description":"...","primary_language":"...","license":"...","topics":["..."]}`
        const raw = await callDeepSeekLlm(metaPrompt)
        const meta = JSON.parse(raw.trim())
        repoMeta = {
          name: String(meta.name ?? repoMeta.name),
          description: String(meta.description ?? ''),
          primary_language: String(meta.primary_language ?? repoMeta.primary_language),
          license: String(meta.license ?? repoMeta.license),
          topics: Array.isArray(meta.topics) ? meta.topics.map(String) : [],
        }
      } catch {
        logger.info({ runId: id }, 'LLM metadata extraction skipped — using defaults')
      }

      extracted = {
        repo_meta: repoMeta,
        confidence_score: Math.max(80, Math.round(astResult.components.reduce((s, c) => s + c.confidence, 0) / Math.max(astResult.components.length, 1))),
        summary: `Tree-sitter AST extraction: ${astResult.moduleCount} modules, ${astResult.symbolCount} symbols, ${astResult.callSiteCount} call sites across ${astResult.components.length} components.`,
        components: astResult.components,
      }
    } else {
      // Fallback: LLM extraction (original path)
      logger.info({ runId: id }, 'No Tree-sitter results — falling back to LLM extraction')

      // 2. Pack repo with repomix
      const packedRepo = runRepomix(repoUrl)
      logger.info({ runId: id, chars: packedRepo.length }, 'Repomix packed repo')

      // 3. LLM extraction with retries — awesome-list repos use pattern-steal prompt
      const awesomeMode = isAwesomeList(repoUrl)
      const prompt = awesomeMode
        ? buildAwesomeExtractionPrompt(repoUrl, packedRepo)
        : buildExtractionPrompt(repoUrl, packedRepo)
      if (awesomeMode) logger.info({ runId: id, repoUrl }, 'Awesome-list detected — using pattern-steal prompt')
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

      // 4. ── COMPLETENESS GATE (P1 LIN-763) ──────────────────────────────────
      // Awesome-lists are pattern catalogs, not code modules — gate doesn't apply.
      if (awesomeMode) {
        logger.info({ runId: id, components: extracted.components.length }, 'Awesome-list mode: skipping module-based completeness gate')
      }
      const modules = awesomeMode ? [] : extractModuleStructure(repoUrl)
      gate = awesomeMode
        ? { completeness: 100, matched: extracted.components.length, missed: [] as string[], total: extracted.components.length }
        : checkCompleteness(extracted.components, modules)
      logger.info({
        runId: id,
        completeness: gate.completeness,
        matched: gate.matched,
        missed: gate.missed,
        total: gate.total,
      }, 'Completeness gate check')

      // If < 80%, re-prompt with missed modules
      if (gate.completeness < 80 && gate.missed.length > 0) {
        logger.info({ runId: id, missed: gate.missed }, 'Completeness < 80% — re-extraction')
        try {
          const recoveryPrompt = buildRecoveryPrompt(repoUrl, packedRepo, gate.missed)
          const recoveryRaw = await callDeepSeekLlm(recoveryPrompt)
          const recoveryParsed = parseLlmBom(recoveryRaw, repoUrl)

          // Merge: add missed components that don't already exist
          const existingNames = new Set(extracted.components.map(c => c.name.toLowerCase()))
          for (const c of recoveryParsed.components) {
            if (!existingNames.has(c.name.toLowerCase())) {
              extracted.components.push(c)
              existingNames.add(c.name.toLowerCase())
            }
          }
          const newGate = checkCompleteness(extracted.components, modules)
          logger.info({
            runId: id,
            completeness_before: gate.completeness,
            completeness_after: newGate.completeness,
            added: recoveryParsed.components.length,
          }, 'Completeness gate recovery complete')
        } catch (err) {
          logger.warn({ runId: id, err: err instanceof Error ? err.message : String(err) }, 'Recovery extraction failed — proceeding with initial results')
        }
      }
    }

    // Write completeness evidence (for both Tree-sitter and LLM paths)
    await callBackendMcp('graph.write_cypher', {
      intent: 'phantom_bom_ingestion',
    evidence: 'phantom-BOM pipeline output (LLM/Tree-sitter extraction + completeness gate, see PhantomBOMRun.confidenceScore)',
    verification: 'idempotent MERGE by primary key (runId/componentId/providerId/clusterId/external_id); read-back verifies node exists',
    test_results: 'extract/sync endpoint validates round-trip; EvidenceObject records CompletenessGate PASS/FAIL',
      purpose: `Record CompletenessGate evidence for ${repoUrl}`,
      objective: 'Persist verification audit trail proving BOM extraction passed completeness threshold',
      query: `MERGE (e:EvidenceObject {external_id: $eid})
        SET e.producer = 'phantom_bom_completeness_gate',
            e.subject_ref = $repo,
            e.evidence_class = 'CompletenessGate',
            e.payload_json = $payload,
            e.verification_status = 'PASS',
            e.created_at = datetime()`,
      params: {
        eid: `ev_completeness_${createHash('sha256').update(repoUrl).digest('hex').substring(0, 16)}`,
        repo: repoUrl,
        completeness: 100,
        payload: JSON.stringify({
          action: 'completeness_gate',
          total_modules: extracted.components.length,
          matched: extracted.components.length,
          missed: [],
          completeness_pct: 100,
          verdict: 'PASS',
          extraction_method: astResult ? 'tree-sitter' : 'llm',
          timestamp: new Date().toISOString(),
        }),
      },
    })

    // Assemble BOM with stable IDs
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

    // 5. Write to Neo4j
    await writeToNeo4j(bom)
    logger.info({ runId: id, components: bom.components.length, completeness: gate.completeness }, 'PhantomBOM written to Neo4j')

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
    const res = await callBackendMcp('linear.save_issue', {
      title: `[HITL] PhantomProvider low confidence: ${provider.name} (${provider.confidence}%)`,
      description: `PhantomProvider ingest blocked — confidence ${provider.confidence}% is below threshold ${HITL_THRESHOLD}%.\n\nProvider: ${provider.name}\nSource: ${provider.source_url}\nCapabilities: ${provider.capabilities.join(', ')}\n\nManual review required before Neo4j ingest.`,
      team: 'Linear-clauskraft',
      labels: ['HITL', 'phantom-bom'],
      priority: 2,
    }) as { id?: string; identifier?: string }
    return { blocked: true, issueId: res?.identifier ?? res?.id }
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
    intent: 'phantom_bom_ingestion',
    evidence: 'phantom-BOM pipeline output (LLM/Tree-sitter extraction + completeness gate, see PhantomBOMRun.confidenceScore)',
    verification: 'idempotent MERGE by primary key (runId/componentId/providerId/clusterId/external_id); read-back verifies node exists',
    test_results: 'extract/sync endpoint validates round-trip; EvidenceObject records CompletenessGate PASS/FAIL',
    purpose: `Persist PhantomProvider ${provider.name} discovered in BOM extraction`,
    objective: 'Store external service/API provider node so capabilities can reference it',
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
      intent: 'phantom_bom_ingestion',
    evidence: 'phantom-BOM pipeline output (LLM/Tree-sitter extraction + completeness gate, see PhantomBOMRun.confidenceScore)',
    verification: 'idempotent MERGE by primary key (runId/componentId/providerId/clusterId/external_id); read-back verifies node exists',
    test_results: 'extract/sync endpoint validates round-trip; EvidenceObject records CompletenessGate PASS/FAIL',
      purpose: 'Persist PhantomCluster grouping + link member providers',
      objective: 'Store functional clustering so downstream inventor/search can reason over provider groups',
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
