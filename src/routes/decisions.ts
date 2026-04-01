/**
 * routes/decisions.ts — Decision Certification Engine (LIN-536)
 *
 * Converts arbitrated assemblies into verified architecture decisions
 * with full lineage and production proof.
 *
 * POST /api/decisions/certify     — Certify a decision from assembly
 * GET  /api/decisions              — List certified decisions
 * GET  /api/decisions/:id          — Get decision with lineage
 * GET  /api/decisions/:id/lineage  — Full lineage chain visualization
 */
import { Router, Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'
import { callCognitive } from '../cognitive-proxy.js'
import { broadcastSSE } from '../sse.js'

export const decisionsRouter = Router()

const REDIS_PREFIX = 'orchestrator:decision:'
const REDIS_INDEX = 'orchestrator:decisions:index'
const TTL_SECONDS = 7776000 // 90 days — decisions are long-lived

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface LineageEntry {
  stage: 'signal' | 'pattern' | 'block' | 'assembly' | 'arbitration' | 'decision'
  node_id: string
  node_type: string
  name: string
  timestamp?: string
}

interface ProductionProof {
  deploy_sha?: string
  service_health?: Record<string, string>
  test_results?: { passed: number; failed: number; total: number }
  verified_at: string
  verified_by: string
}

interface DecisionCertificate {
  $id: string
  $schema: string
  title: string
  summary: string
  rationale: string
  assembly_id: string
  lineage_chain: LineageEntry[]
  evidence_refs: string[]
  arbitration_outcome: string
  production_proof: ProductionProof
  certified_at: string
  certifier_agent: string
  status: 'certified' | 'superseded' | 'revoked'
  tags: string[]
}

/* ─── Redis Helpers ──────────────────────────────────────────────────────── */

async function storeDecision(decision: DecisionCertificate): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    await redis.set(`${REDIS_PREFIX}${decision.$id}`, JSON.stringify(decision), 'EX', TTL_SECONDS)
    await redis.sadd(REDIS_INDEX, decision.$id)
    return true
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis store failed for decision')
    return false
  }
}

async function loadDecision(id: string): Promise<DecisionCertificate | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${REDIS_PREFIX}${id}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function listAllIds(): Promise<string[]> {
  const redis = getRedis()
  if (!redis) return []
  try {
    return await redis.smembers(REDIS_INDEX)
  } catch {
    return []
  }
}

/* ─── Lineage Builder ────────────────────────────────────────────────────── */

async function buildLineageChain(assemblyId: string): Promise<LineageEntry[]> {
  const lineage: LineageEntry[] = []

  try {
    // Traverse from Assembly → Blocks → Patterns → Signals
    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `MATCH (a:Assembly {id: $assemblyId})
OPTIONAL MATCH (a)-[:COMPOSED_OF]->(b)
WHERE b:Block OR b:ArchitectureBlock OR b:LegoBlock
OPTIONAL MATCH (b)-[:DERIVED_FROM|EXTRACTED_FROM]->(p)
WHERE p:Pattern OR p:Signal OR p:StrategicInsight
RETURN a.id AS asm_id, a.name AS asm_name, a.created_at AS asm_ts,
       b.id AS block_id, b.name AS block_name, labels(b)[0] AS block_type, b.created_at AS block_ts,
       p.id AS source_id, p.name AS source_name, labels(p)[0] AS source_type, p.createdAt AS source_ts
ORDER BY b.name`,
        params: { assemblyId },
      },
      callId: uuid(),
      timeoutMs: 15000,
    })

    if (result.status === 'success') {
      const records = Array.isArray(result.result) ? result.result
        : Array.isArray((result.result as any)?.records) ? (result.result as any).records
        : []

      // Assembly entry
      if (records.length > 0) {
        const r = records[0]
        lineage.push({
          stage: 'assembly',
          node_id: String(r.asm_id ?? assemblyId),
          node_type: 'Assembly',
          name: String(r.asm_name ?? assemblyId),
          timestamp: r.asm_ts ? String(r.asm_ts) : undefined,
        })
      }

      // Blocks and their sources
      const seenBlocks = new Set<string>()
      const seenSources = new Set<string>()

      for (const r of records as any[]) {
        if (r.block_id && !seenBlocks.has(String(r.block_id))) {
          seenBlocks.add(String(r.block_id))
          lineage.push({
            stage: 'block',
            node_id: String(r.block_id),
            node_type: String(r.block_type ?? 'Block'),
            name: String(r.block_name ?? r.block_id),
            timestamp: r.block_ts ? String(r.block_ts) : undefined,
          })
        }

        if (r.source_id && !seenSources.has(String(r.source_id))) {
          seenSources.add(String(r.source_id))
          const sourceType = String(r.source_type ?? 'Unknown')
          const stage = sourceType.includes('Signal') ? 'signal' as const
            : sourceType.includes('Pattern') ? 'pattern' as const
            : 'signal' as const

          lineage.push({
            stage,
            node_id: String(r.source_id),
            node_type: sourceType,
            name: String(r.source_name ?? r.source_id),
            timestamp: r.source_ts ? String(r.source_ts) : undefined,
          })
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err), assemblyId }, 'Failed to build lineage chain')
  }

  return lineage
}

/* ─── POST /certify — Certify a decision ─────────────────────────────────── */

decisionsRouter.post('/certify', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>

  if (!body.assembly_id || !body.title) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: assembly_id, title', status_code: 400 },
    })
    return
  }

  const assemblyId = String(body.assembly_id)
  const title = String(body.title)
  const now = new Date().toISOString()
  const decisionId = `widgetdc:decision:${uuid()}`

  // Step 1: Build lineage chain from assembly
  const lineageChain = await buildLineageChain(assemblyId)

  // Step 2: Generate rationale via LLM
  let rationale = String(body.rationale ?? '')
  let summary = String(body.summary ?? '')

  if (!rationale || !summary) {
    try {
      const result = await callCognitive('analyze', {
        prompt: `You are a decision certifier for an architecture synthesis platform.

Decision: "${title}"
Assembly: ${assemblyId}
Lineage: ${lineageChain.length} nodes traced (${lineageChain.map(l => `${l.stage}:${l.name}`).join(' → ')})
${body.context ? `Context: ${JSON.stringify(body.context)}` : ''}

Generate:
1. A concise summary (1-2 sentences)
2. A rationale explaining why this decision was made based on the evidence chain

Reply as JSON: {"summary": "...", "rationale": "..."}`,
        context: { assembly_id: assemblyId, lineage: lineageChain },
        agent_id: 'orchestrator',
      }, 20000)

      const text = String(result ?? '')
      const match = text.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        if (!summary) summary = parsed.summary ?? title
        if (!rationale) rationale = parsed.rationale ?? 'Auto-certified based on assembly lineage'
      }
    } catch {
      if (!summary) summary = title
      if (!rationale) rationale = 'Certified from accepted assembly with verified lineage'
    }
  }

  // Step 3: Collect production proof
  const proof: ProductionProof = {
    verified_at: now,
    verified_by: String(body.certifier ?? 'orchestrator:decision-engine'),
  }

  // Try to get current deploy SHA and health
  try {
    const [healthResult] = await Promise.allSettled([
      fetch('https://orchestrator-production-c27e.up.railway.app/health', { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
    ])
    if (healthResult.status === 'fulfilled') {
      const h = healthResult.value as Record<string, unknown>
      proof.service_health = {
        orchestrator: String(h.status ?? 'unknown'),
        redis: h.redis_enabled ? 'connected' : 'disconnected',
        rlm: h.rlm_available ? 'available' : 'unavailable',
      }
    }
  } catch { /* non-critical */ }

  if (body.test_results && typeof body.test_results === 'object') {
    proof.test_results = body.test_results as ProductionProof['test_results']
  }
  if (body.deploy_sha) proof.deploy_sha = String(body.deploy_sha)

  // Step 4: Create certificate
  const certificate: DecisionCertificate = {
    $id: decisionId,
    $schema: 'widgetdc:decision:v1',
    title,
    summary,
    rationale,
    assembly_id: assemblyId,
    lineage_chain: lineageChain,
    evidence_refs: Array.isArray(body.evidence_refs)
      ? (body.evidence_refs as string[])
      : lineageChain.map(l => l.node_id),
    arbitration_outcome: String(body.arbitration_outcome ?? 'accepted'),
    production_proof: proof,
    certified_at: now,
    certifier_agent: String(body.certifier ?? 'orchestrator:decision-engine'),
    status: 'certified',
    tags: Array.isArray(body.tags) ? body.tags as string[] : [],
  }

  await storeDecision(certificate)

  // Step 5: Persist immutably to Neo4j
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `CREATE (d:Decision {
  id: $id, title: $title, summary: $summary, rationale: $rationale,
  assembly_id: $assemblyId, status: 'certified',
  certified_at: datetime(), certifier_agent: $certifier,
  lineage_depth: $lineageDepth, evidence_count: $evidenceCount
})
WITH d
MATCH (a:Assembly {id: $assemblyId})
CREATE (d)-[:BASED_ON]->(a)
WITH d
UNWIND $evidenceIds AS eid
MATCH (e) WHERE e.id = eid
CREATE (d)-[:CERTIFIED_BY_EVIDENCE]->(e)`,
        params: {
          id: decisionId,
          title,
          summary,
          rationale,
          assemblyId,
          certifier: certificate.certifier_agent,
          lineageDepth: lineageChain.length,
          evidenceCount: certificate.evidence_refs.length,
          evidenceIds: certificate.evidence_refs.slice(0, 20), // Cap for query size
        },
      },
      callId: uuid(),
      timeoutMs: 15000,
    })
  } catch (err) {
    logger.warn({ err: String(err), decision_id: decisionId }, 'Failed to write decision to Neo4j')
  }

  // Broadcast
  broadcastSSE('decision-certified', {
    decision_id: decisionId,
    title,
    assembly_id: assemblyId,
    lineage_depth: lineageChain.length,
  })

  logger.info({
    decision_id: decisionId,
    title,
    assembly_id: assemblyId,
    lineage_depth: lineageChain.length,
  }, 'Decision certified')

  res.status(201).json({ success: true, data: certificate })
})

/* ─── GET / — List decisions ─────────────────────────────────────────────── */

decisionsRouter.get('/', async (req: Request, res: Response) => {
  const statusFilter = req.query.status as string | undefined
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50')), 1), 200)
  const offset = Math.max(parseInt(String(req.query.offset ?? '0')), 0)

  const allIds = await listAllIds()
  const redis = getRedis()

  if (!redis || allIds.length === 0) {
    res.json({ decisions: [], total: 0, limit, offset })
    return
  }

  const decisions: DecisionCertificate[] = []
  try {
    const pipeline = redis.pipeline()
    for (const id of allIds) {
      pipeline.get(`${REDIS_PREFIX}${id}`)
    }
    const results = await pipeline.exec()
    if (results) {
      for (const [err, raw] of results) {
        if (!err && typeof raw === 'string') {
          try { decisions.push(JSON.parse(raw)) } catch { /* skip */ }
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis pipeline failed for decisions list')
  }

  let filtered = decisions
  if (statusFilter) {
    filtered = filtered.filter(d => d.status === statusFilter)
  }

  // Sort newest first
  filtered.sort((a, b) => b.certified_at.localeCompare(a.certified_at))

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)

  res.json({ decisions: page, total, limit, offset })
})

/* ─── GET /:id — Single decision ─────────────────────────────────────────── */

decisionsRouter.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id

  // Check for /lineage suffix
  if (id === 'lineage') {
    // This shouldn't match — /:id/lineage is handled below
    res.status(400).json({ success: false, error: 'Provide a decision ID' })
    return
  }

  const decision = await loadDecision(id)
  if (!decision) {
    res.status(404).json({ success: false, error: 'Decision not found' })
    return
  }
  res.json({ success: true, data: decision })
})

/* ─── GET /:id/lineage — Full lineage visualization ──────────────────────── */

decisionsRouter.get('/:id/lineage', async (req: Request, res: Response) => {
  const decision = await loadDecision(req.params.id)
  if (!decision) {
    res.status(404).json({ success: false, error: 'Decision not found' })
    return
  }

  // Group lineage by stage
  const stages: Record<string, LineageEntry[]> = {}
  for (const entry of decision.lineage_chain) {
    if (!stages[entry.stage]) stages[entry.stage] = []
    stages[entry.stage].push(entry)
  }

  res.json({
    success: true,
    data: {
      decision_id: decision.$id,
      title: decision.title,
      certified_at: decision.certified_at,
      assembly_id: decision.assembly_id,
      lineage_chain: decision.lineage_chain,
      lineage_by_stage: stages,
      depth: decision.lineage_chain.length,
      stages_covered: Object.keys(stages),
      production_proof: decision.production_proof,
    },
  })
})
