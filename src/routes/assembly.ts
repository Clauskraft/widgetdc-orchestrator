/**
 * routes/assembly.ts — Assembly Composer API (LIN-534)
 *
 * Composes verified blocks from LegoFactory into ranked architecture assemblies.
 * POST /api/assembly/compose   — Compose blocks into assembly candidates
 * GET  /api/assembly           — List assemblies
 * GET  /api/assembly/:id       — Get single assembly
 *
 * Neo4j storage: Assembly nodes linked to constituent Block nodes.
 * Redis cache for recent assemblies.
 */
import { Router, Request, Response } from 'express'
import { v4 as uuid } from 'uuid'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'
import { callCognitive } from '../cognitive-proxy.js'

export const assemblyRouter = Router()

const REDIS_PREFIX = 'orchestrator:assembly:'
const REDIS_INDEX = 'orchestrator:assemblies:index'
const TTL_SECONDS = 2592000 // 30 days

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface BlockRef {
  block_id: string
  block_name: string
  block_type: string
  domain: string
}

interface AssemblyCandidate {
  $id: string
  $schema: string
  name: string
  description: string
  blocks: BlockRef[]
  missing_blocks: string[]       // Dependencies not found
  conflicts: ConflictEntry[]     // Contradictions between blocks
  scores: {
    coherence: number            // 0-1: how well blocks fit together
    coverage: number             // 0-1: domain coverage vs required
    conflict_count: number       // Lower is better
    composite: number            // Weighted combination
  }
  lineage: {
    source_query: string
    composed_at: string
    composed_by: string
    block_count: number
  }
  status: 'draft' | 'accepted' | 'rejected'
  created_at: string
  updated_at: string
}

interface ConflictEntry {
  block_a: string
  block_b: string
  conflict_type: 'contradictory' | 'overlapping' | 'incompatible'
  description: string
}

/* ─── Redis Helpers ──────────────────────────────────────────────────────── */

async function storeAssembly(assembly: AssemblyCandidate): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    await redis.set(`${REDIS_PREFIX}${assembly.$id}`, JSON.stringify(assembly), 'EX', TTL_SECONDS)
    await redis.sadd(REDIS_INDEX, assembly.$id)
    return true
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis store failed for assembly')
    return false
  }
}

async function loadAssembly(id: string): Promise<AssemblyCandidate | null> {
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

/* ─── POST /compose — Compose blocks into assembly candidates ────────────── */

assemblyRouter.post('/compose', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const blockIds = body.block_ids as string[] | undefined
  const query = String(body.query ?? body.context ?? '')
  const domains = body.domains as string[] | undefined
  const maxCandidates = Math.min(Math.max(Number(body.max_candidates ?? 3), 1), 10)

  // Step 1: Fetch blocks from Neo4j
  let blocks: BlockRef[] = []
  try {
    let cypher: string
    let params: Record<string, unknown> = {}

    if (blockIds && blockIds.length > 0) {
      // Fetch specific blocks by ID
      cypher = `MATCH (b) WHERE b.id IN $ids AND (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
RETURN b.id AS block_id, b.name AS block_name, labels(b)[0] AS block_type, b.domain AS domain
ORDER BY b.name`
      params = { ids: blockIds }
    } else if (domains && domains.length > 0) {
      // Fetch blocks by domain
      cypher = `MATCH (b) WHERE b.domain IN $domains AND (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
RETURN b.id AS block_id, b.name AS block_name, labels(b)[0] AS block_type, b.domain AS domain
ORDER BY b.domain, b.name LIMIT 50`
      params = { domains }
    } else {
      // Fetch all active blocks
      cypher = `MATCH (b) WHERE (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
RETURN b.id AS block_id, b.name AS block_name, labels(b)[0] AS block_type, b.domain AS domain
ORDER BY b.domain, b.name LIMIT 50`
    }

    const graphResult = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: { query: cypher, params },
      callId: uuid(),
      timeoutMs: 15000,
    })

    if (graphResult.status === 'success' && graphResult.result) {
      const records = Array.isArray(graphResult.result) ? graphResult.result
        : Array.isArray((graphResult.result as any)?.records) ? (graphResult.result as any).records
        : []
      blocks = records.map((r: any) => ({
        block_id: String(r.block_id ?? r.id ?? ''),
        block_name: String(r.block_name ?? r.name ?? 'Unknown'),
        block_type: String(r.block_type ?? r.type ?? 'Block'),
        domain: String(r.domain ?? 'general'),
      })).filter((b: BlockRef) => b.block_id)
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to fetch blocks from graph')
  }

  if (blocks.length === 0) {
    res.status(404).json({
      success: false,
      error: { code: 'NO_BLOCKS', message: 'No blocks found matching criteria', status_code: 404 },
    })
    return
  }

  // Step 2: Detect dependencies and conflicts via LLM analysis
  let analysis: { candidates: Array<{ name: string; description: string; block_ids: string[]; missing: string[]; conflicts: ConflictEntry[]; coherence: number; coverage: number }> } = { candidates: [] }

  try {
    const prompt = `You are an architecture assembly composer. Given these building blocks, compose ${maxCandidates} candidate architecture assemblies.

BLOCKS:
${blocks.map(b => `- ${b.block_id}: ${b.block_name} (${b.block_type}, domain: ${b.domain})`).join('\n')}

${query ? `CONTEXT: ${query}` : ''}

For each candidate assembly:
1. Select a coherent subset of blocks that work together
2. Identify missing dependencies (blocks that should exist but don't)
3. Detect conflicts between selected blocks
4. Score coherence (0-1) and coverage (0-1)

Reply as JSON:
{"candidates": [{"name": "...", "description": "...", "block_ids": ["..."], "missing": ["description of missing block"], "conflicts": [{"block_a": "id", "block_b": "id", "conflict_type": "contradictory|overlapping|incompatible", "description": "..."}], "coherence": 0.0, "coverage": 0.0}]}`

    const result = await callCognitive('analyze', {
      prompt,
      context: { blocks, query },
      agent_id: 'orchestrator',
    }, 30000)

    // Parse JSON from response
    const text = String(result ?? '')
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      analysis = JSON.parse(match[0])
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'LLM analysis failed, creating single assembly from all blocks')
    // Fallback: single assembly with all blocks
    analysis = {
      candidates: [{
        name: 'Default Assembly',
        description: 'All available blocks composed together',
        block_ids: blocks.map(b => b.block_id),
        missing: [],
        conflicts: [],
        coherence: 0.5,
        coverage: 0.5,
      }],
    }
  }

  // Step 3: Create AssemblyCandidate objects and store
  const assemblies: AssemblyCandidate[] = []
  const now = new Date().toISOString()

  for (const candidate of analysis.candidates.slice(0, maxCandidates)) {
    const assemblyId = `widgetdc:assembly:${uuid()}`
    const selectedBlocks = blocks.filter(b => candidate.block_ids.includes(b.block_id))
    const conflictCount = candidate.conflicts?.length ?? 0
    const coherence = Math.max(0, Math.min(1, candidate.coherence ?? 0.5))
    const coverage = Math.max(0, Math.min(1, candidate.coverage ?? 0.5))
    const composite = (coherence * 0.4 + coverage * 0.4 + Math.max(0, 1 - conflictCount * 0.2) * 0.2)

    const assembly: AssemblyCandidate = {
      $id: assemblyId,
      $schema: 'widgetdc:assembly:v1',
      name: candidate.name || 'Unnamed Assembly',
      description: candidate.description || '',
      blocks: selectedBlocks,
      missing_blocks: candidate.missing ?? [],
      conflicts: candidate.conflicts ?? [],
      scores: {
        coherence,
        coverage,
        conflict_count: conflictCount,
        composite: Math.round(composite * 1000) / 1000,
      },
      lineage: {
        source_query: query,
        composed_at: now,
        composed_by: 'orchestrator:assembly-composer',
        block_count: selectedBlocks.length,
      },
      status: 'draft',
      created_at: now,
      updated_at: now,
    }

    await storeAssembly(assembly)
    assemblies.push(assembly)

    // Step 4: Persist to Neo4j — Assembly node linked to Block nodes
    try {
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `MERGE (a:Assembly {id: $id})
SET a.name = $name, a.description = $description,
    a.coherence = $coherence, a.coverage = $coverage,
    a.conflict_count = $conflictCount, a.composite = $composite,
    a.block_count = $blockCount, a.status = 'draft',
    a.created_at = datetime(), a.source_query = $query
WITH a
UNWIND $blockIds AS bid
MATCH (b) WHERE b.id = bid AND (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
MERGE (a)-[:COMPOSED_OF]->(b)`,
          params: {
            id: assemblyId,
            name: assembly.name,
            description: assembly.description,
            coherence,
            coverage,
            conflictCount,
            composite: assembly.scores.composite,
            blockCount: selectedBlocks.length,
            query: query.slice(0, 500),
            blockIds: selectedBlocks.map(b => b.block_id),
          },
        },
        callId: uuid(),
        timeoutMs: 10000,
      })
    } catch (err) {
      logger.warn({ err: String(err), assembly_id: assemblyId }, 'Failed to write assembly to Neo4j')
    }
  }

  // Sort by composite score descending
  assemblies.sort((a, b) => b.scores.composite - a.scores.composite)

  logger.info({
    count: assemblies.length,
    block_count: blocks.length,
    top_score: assemblies[0]?.scores.composite,
  }, 'Assembly composition complete')

  res.json({
    success: true,
    data: {
      assemblies,
      input_blocks: blocks.length,
      candidates_generated: assemblies.length,
    },
  })
})

/* ─── GET / — List assemblies ────────────────────────────────────────────── */

assemblyRouter.get('/', async (req: Request, res: Response) => {
  const statusFilter = req.query.status as string | undefined
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50')), 1), 200)
  const offset = Math.max(parseInt(String(req.query.offset ?? '0')), 0)

  const allIds = await listAllIds()
  const redis = getRedis()

  if (!redis || allIds.length === 0) {
    res.json({ assemblies: [], total: 0, limit, offset })
    return
  }

  const assemblies: AssemblyCandidate[] = []
  try {
    const pipeline = redis.pipeline()
    for (const id of allIds) {
      pipeline.get(`${REDIS_PREFIX}${id}`)
    }
    const results = await pipeline.exec()
    if (results) {
      for (const [err, raw] of results) {
        if (!err && typeof raw === 'string') {
          try { assemblies.push(JSON.parse(raw)) } catch { /* skip */ }
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis pipeline failed for assembly list')
  }

  let filtered = assemblies
  if (statusFilter) {
    filtered = filtered.filter(a => a.status === statusFilter)
  }

  // Sort by composite score descending
  filtered.sort((a, b) => b.scores.composite - a.scores.composite)

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)

  res.json({ assemblies: page, total, limit, offset })
})

/* ─── GET /:id — Single assembly ─────────────────────────────────────────── */

assemblyRouter.get('/:id', async (req: Request, res: Response) => {
  const assembly = await loadAssembly(req.params.id)
  if (!assembly) {
    res.status(404).json({ success: false, error: 'Assembly not found' })
    return
  }
  res.json({ success: true, data: assembly })
})

/* ─── PUT /:id — Update assembly status ──────────────────────────────────── */

assemblyRouter.put('/:id', async (req: Request, res: Response) => {
  const assembly = await loadAssembly(req.params.id)
  if (!assembly) {
    res.status(404).json({ success: false, error: 'Assembly not found' })
    return
  }

  const body = req.body as Partial<AssemblyCandidate>
  if (body.status && ['draft', 'accepted', 'rejected'].includes(body.status)) {
    assembly.status = body.status
  }
  if (body.name) assembly.name = body.name
  if (body.description) assembly.description = body.description
  assembly.updated_at = new Date().toISOString()

  await storeAssembly(assembly)

  // Update status in Neo4j
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: 'MATCH (a:Assembly {id: $id}) SET a.status = $status, a.updated_at = datetime()',
        params: { id: assembly.$id, status: assembly.status },
      },
      callId: uuid(),
      timeoutMs: 5000,
    })
  } catch { /* non-critical */ }

  res.json({ success: true, data: assembly })
})
