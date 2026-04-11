/**
 * hyperagent-autonomous.ts — Autonomous Execution Engine
 *
 * Drives the 72-target registry through graduated autonomy phases,
 * using RLM reasoning, RAG, folding, and swarm coordination.
 *
 * Architecture:
 *   1. PRIORITIZE — Fitness function ranks targets by edge gap × impact
 *   2. SELECT     — Pick top-N targets, select chain mode per category
 *   3. PLAN       — RLM decomposes target into executable steps
 *   4. EXECUTE    — Chain engine runs plan (mode per category matrix)
 *   5. EVALUATE   — Score outcome, update edge scores, emit rewards
 *   6. DISCOVER   — Scan for new issues found during execution
 *   7. EVOLVE     — Retrain RAG weights, adjust fitness weights, log lessons
 *   8. STREAM     — Broadcast all state changes via SSE for live user view
 *
 * Runs as a cron job (configurable interval) or on-demand via API.
 * Self-improving: every cycle feeds back into priority weights.
 */
import { v4 as uuid } from 'uuid'
import { createPlan, executePlan, evaluatePlan, approvePlan, type HyperPlan } from './hyperagent.js'
import { callCognitive, callCognitiveRaw, isRlmAvailable } from '../cognitive-proxy.js'
import { callMcpTool } from '../mcp-caller.js'
import { dualChannelRAG } from '../memory/dual-rag.js'
import { getRedis } from '../redis.js'
import { broadcastSSE } from '../sse.js'
import { broadcastMessage } from '../chat-broadcaster.js'
import { logger } from '../logger.js'
import type { AgentMessage } from '@widgetdc/contracts/orchestrator'

// ─── Types ──────────────────────────────────────────────────────────────────

export type AutonomousPhase = 'phase_0' | 'phase_1' | 'phase_2' | 'phase_3'

interface EdgeScore {
  name: string
  score: number
  target: number
  gap: number
}

interface TargetDef {
  id: string
  category: string       // A-G
  edge: string           // Husker, Laerer, Heler, Forklarer, Vokser, Integrerer
  metric: string
  current: string
  goal: string
  targetGapNorm: number  // 0-1
  deps: number
  effortNorm: number     // 0-1
  status: 'open' | 'in_progress' | 'closed' | 'blocked'
}

interface CycleResult {
  cycleId: string
  phase: AutonomousPhase
  startedAt: string
  completedAt: string
  durationMs: number
  targetsAttempted: number
  targetsCompleted: number
  targetsFailed: number
  newIssuesDiscovered: string[]
  edgeScoresBefore: EdgeScore[]
  edgeScoresAfter: EdgeScore[]
  fitnessScoreDelta: number
  lessonsLearned: string[]
}

export interface AutonomousStatus {
  isRunning: boolean
  currentPhase: AutonomousPhase
  currentTarget: string | null
  currentStep: string
  totalCycles: number
  lastCycle: CycleResult | null
  edgeScores: EdgeScore[]
  fitnessScore: number
  targetsRemaining: number
  targetsCompleted: number
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Chain mode selection matrix (RLM-validated, see Blueprint §2) */
const CHAIN_MODE_MATRIX: Record<string, string> = {
  A: 'sequential',   // Bug fixes: deterministic
  B: 'parallel',     // Graph health: independent checks
  C: 'loop',         // Adoption: repeated audit cycles
  D: 'parallel',     // OSINT: embarrassingly parallel
  E: 'debate',       // Product features: multi-perspective
  F: 'adaptive',     // Score optimization: Q-learning selects
  G: 'parallel',     // Data/cost: batch operations
}

/** Priority formula weights (RLM-derived, see Blueprint §3) */
const W_EDGE_GAP = 0.40
const W_TARGET_GAP = 0.30
const W_DEPENDENCY = 0.15
const W_EFFORT = 0.15

/** Fitness function adaptive weights — start equal, evolve per cycle */
const LEARNING_RATE = 0.01
const TARGET_EDGE_SCORE = 9.5

/** Phase gate thresholds — minEdge = lowest edge score required to advance */
const PHASE_GATES: Record<AutonomousPhase, { minEdge: number; minCycles: number; maxConcurrent: number }> = {
  phase_0: { minEdge: 0, minCycles: 0, maxConcurrent: 1 },
  phase_1: { minEdge: 7.0, minCycles: 3, maxConcurrent: 3 },
  phase_2: { minEdge: 8.5, minCycles: 10, maxConcurrent: 5 },
  phase_3: { minEdge: 9.0, minCycles: 25, maxConcurrent: 8 },
}

/** Policy profile per phase — graduated autonomy
 * Phase 0: read_only — observe, analyze, discover issues only
 * Phase 1: staged_write — can execute fixes but with approval gate + dry-run
 * Phase 2: production_write — can execute writes directly, approval for destructive ops
 * Phase 3: full_auto — unrestricted execution, self-healing
 */
const PHASE_POLICY: Record<AutonomousPhase, string> = {
  phase_0: 'read_only',
  phase_1: 'staged_write',
  phase_2: 'production_write',
  phase_3: 'production_write',
}

/** Max targets per cycle per phase */
const CYCLE_BATCH_SIZE: Record<AutonomousPhase, number> = {
  phase_0: 3,
  phase_1: 5,
  phase_2: 8,
  phase_3: 12,
}

// ─── State ──────────────────────────────────────────────────────────────────

let isRunning = false
let currentPhase: AutonomousPhase = 'phase_0'
let currentTarget: string | null = null
let currentStep = 'idle'
let totalCycles = 0
let lastCycle: CycleResult | null = null

/** Adaptive edge weights — start equal, evolve */
const edgeWeights: Record<string, number> = {
  Husker: 1 / 6, Laerer: 1 / 6, Heler: 1 / 6,
  Forklarer: 1 / 6, Vokser: 1 / 6, Integrerer: 1 / 6,
}

/** Known discovered issues (accumulated across cycles, capped at 500) */
const discoveredIssues: string[] = []
const MAX_DISCOVERED_ISSUES = 500

// ─── SSE Streaming ──────────────────────────────────────────────────────────

function stream(event: string, data: Record<string, unknown>): void {
  const payload = {
    ...data,
    timestamp: new Date().toISOString(),
    phase: currentPhase,
    cycleCount: totalCycles,
  }
  broadcastSSE(`hyperagent:${event}`, payload)
  logger.info({ event, ...payload }, `HyperAgent-Auto: ${event}`)
}

// ─── Priority Scoring ───────────────────────────────────────────────────────

function computePriority(target: TargetDef, edgeScores: EdgeScore[]): number {
  const edge = edgeScores.find(e => e.name === target.edge)
  if (!edge) return 0

  const maxGap = Math.max(...edgeScores.map(e => e.gap), 0.1)
  const edgeGapNorm = edge.gap / maxGap

  return (
    W_EDGE_GAP * edgeGapNorm +
    W_TARGET_GAP * target.targetGapNorm +
    W_DEPENDENCY * (1 / (1 + target.deps)) -
    W_EFFORT * target.effortNorm
  )
}

function rankTargets(targets: TargetDef[], edgeScores: EdgeScore[]): TargetDef[] {
  return targets
    .filter(t => t.status === 'open')
    .map(t => ({ target: t, priority: computePriority(t, edgeScores) }))
    .sort((a, b) => b.priority - a.priority)
    .map(x => x.target)
}

// ─── Edge Score Observation ─────────────────────────────────────────────────

/** Default edge scores — used to seed Redis on first run */
const DEFAULT_EDGE_SCORES: EdgeScore[] = [
  { name: 'Husker', score: 9.0, target: 9.5, gap: 0.5 },
  { name: 'Laerer', score: 8.3, target: 9.5, gap: 1.2 },
  { name: 'Heler', score: 8.0, target: 9.5, gap: 1.5 },
  { name: 'Forklarer', score: 9.0, target: 9.5, gap: 0.5 },
  { name: 'Vokser', score: 8.5, target: 9.5, gap: 1.0 },
  { name: 'Integrerer', score: 8.5, target: 9.5, gap: 1.0 },
]

const EDGE_SCORES_REDIS_KEY = 'hyperagent:edge-scores:v1'

/** Score increment per closed target (tunable; ~0.02 per target → 72 targets × 0.02 ≈ 1.44 max lift) */
const SCORE_PER_TARGET = 0.02

async function observeEdgeScores(): Promise<EdgeScore[]> {
  // Priority 1: Redis persisted scores (survive redeploys)
  const redis = getRedis()
  if (redis) {
    try {
      const raw = await redis.get(EDGE_SCORES_REDIS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as EdgeScore[]
        if (Array.isArray(parsed) && parsed.length >= 6) {
          return parsed.map(e => ({
            ...e,
            target: TARGET_EDGE_SCORE,
            gap: TARGET_EDGE_SCORE - e.score,
          }))
        }
      }
    } catch {
      logger.debug('HyperAgent-Auto: Redis edge score read failed, trying graph')
    }
  }

  // Priority 2: Graph nodes
  try {
    const result = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `MATCH (e:EdgeScore) RETURN e.name AS name, e.score AS score ORDER BY e.name`,
        params: {},
      },
      callId: `hyp-auto-edges-${Date.now()}`,
    })

    const rows = Array.isArray(result) ? result : []
    if (rows.length >= 6) {
      const scores = rows.map((r: Record<string, unknown>) => ({
        name: String(r.name),
        score: Number(r.score),
        target: TARGET_EDGE_SCORE,
        gap: TARGET_EDGE_SCORE - Number(r.score),
      }))
      // Persist to Redis for next read
      if (redis) await redis.set(EDGE_SCORES_REDIS_KEY, JSON.stringify(scores)).catch(() => {})
      return scores
    }
  } catch {
    logger.debug('HyperAgent-Auto: EdgeScore graph nodes not found, using defaults')
  }

  // Priority 3: Seed defaults into Redis and return
  const defaults = DEFAULT_EDGE_SCORES.map(e => ({ ...e }))
  if (redis) await redis.set(EDGE_SCORES_REDIS_KEY, JSON.stringify(defaults)).catch(() => {})
  return defaults
}

/**
 * Update edge scores in Redis after targets complete.
 * Each closed target nudges its edge score up by SCORE_PER_TARGET, capped at TARGET_EDGE_SCORE.
 */
async function updateEdgeScores(
  currentScores: EdgeScore[],
  closedTargets: TargetDef[],
): Promise<EdgeScore[]> {
  if (closedTargets.length === 0) return currentScores

  // Count closed targets per edge
  const deltaPerEdge: Record<string, number> = {}
  for (const t of closedTargets) {
    deltaPerEdge[t.edge] = (deltaPerEdge[t.edge] || 0) + SCORE_PER_TARGET
  }

  const updated = currentScores.map(e => {
    const delta = deltaPerEdge[e.name] || 0
    const newScore = Math.min(e.score + delta, TARGET_EDGE_SCORE)
    return {
      name: e.name,
      score: Number(newScore.toFixed(3)),
      target: TARGET_EDGE_SCORE,
      gap: Number((TARGET_EDGE_SCORE - newScore).toFixed(3)),
    }
  })

  // Persist to Redis
  const redis = getRedis()
  if (redis) {
    await redis.set(EDGE_SCORES_REDIS_KEY, JSON.stringify(updated)).catch(() => {})
    logger.info({ deltas: deltaPerEdge }, 'HyperAgent-Auto: edge scores updated in Redis')
  }

  return updated
}

// ─── Target Registry Loader ─────────────────────────────────────────────────

async function loadTargetRegistry(): Promise<TargetDef[]> {
  const redis = getRedis()
  if (!redis) {
    logger.warn('HyperAgent-Auto: no Redis connection for target registry')
    return []
  }

  try {
    // Try multiple key patterns (working-memory prefix, hyperagent prefix, cross-repo memory)
    const keyPatterns = [
      'wm:HYPERAGENT:target-registry-v2.2',          // working-memory format (uppercase)
      'wm:hyperagent-auto:target-registry-v2.2',     // working-memory format (lowercase auto agent)
      'wm:hyperagent-auto:targets:full-registry-v2.2', // cross-repo memory nested domain
      'hyperagent:HYPERAGENT:target-registry-v2.2',   // legacy format
      'hyperagent:memory:targets:full-registry-v2.2', // cross-repo memory format
      'wm:HYPERAGENT:target-registry-v2.1',           // older version
    ]

    const diagnostics: Record<string, string> = {}

    for (const key of keyPatterns) {
      const raw = await redis.get(key)
      if (!raw) {
        diagnostics[key] = 'NOT_FOUND'
        continue
      }
      diagnostics[key] = `raw_len=${raw.length}`
      try {
        const parsed = JSON.parse(raw)
        const topKeys = Object.keys(parsed).join(',')
        diagnostics[key] += ` top_keys=[${topKeys}]`

        // Unwrap envelope: working-memory has {key,value,agent_id,...}, cross-repo has {domain,key,value,...}
        let data: Record<string, unknown>
        if (parsed.value !== undefined) {
          if (typeof parsed.value === 'string') {
            data = JSON.parse(parsed.value)
            diagnostics[key] += ' unwrap=string_parse'
          } else {
            data = parsed.value as Record<string, unknown>
            diagnostics[key] += ' unwrap=direct_object'
          }
        } else {
          data = parsed
          diagnostics[key] += ' unwrap=none'
        }

        const dataKeys = Object.keys(data).join(',')
        diagnostics[key] += ` data_keys=[${dataKeys}]`
        const targets = parseRegistryToTargets(data)
        diagnostics[key] += ` targets=${targets.length}`

        if (targets.length > 0) {
          logger.info({ key, targetCount: targets.length, diagnostics }, 'HyperAgent-Auto: loaded target registry')
          return targets
        }
      } catch (err) {
        diagnostics[key] += ` ERROR=${err instanceof Error ? err.message : String(err)}`
      }
    }

    logger.warn({ diagnostics }, 'HyperAgent-Auto: no target registry found in any key pattern')
    return []
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'HyperAgent-Auto: failed to load target registry from Redis')
    return []
  }
}

function parseRegistryToTargets(registry: Record<string, unknown>): TargetDef[] {
  const targets: TargetDef[] = []
  const categories = registry.categories as Record<string, unknown> | undefined
  if (!categories) return targets

  // Parse category structure into flat target list
  for (const [catKey, catVal] of Object.entries(categories)) {
    const category = catKey.charAt(0).toUpperCase() // A, B, C, etc.
    if (typeof catVal === 'object' && catVal !== null) {
      const cat = catVal as Record<string, unknown>
      const ids = cat.ids as string[] | undefined
      if (Array.isArray(ids)) {
        for (const id of ids) {
          // Parse ID format: "A-01:LIN-632:adaptive_rag_retrain"
          const parts = id.split(':')
          const targetId = parts[0] || id
          targets.push({
            id: targetId,
            category,
            edge: inferEdge(targetId, category),
            metric: parts.slice(1).join(':') || targetId,
            current: 'unknown',
            goal: 'target',
            targetGapNorm: 0.8, // default high gap
            deps: 0,
            effortNorm: 0.3, // default medium effort
            status: 'open',
          })
        }
      }
    }
  }
  return targets
}

function inferEdge(targetId: string, category: string): string {
  // Edge inference from target ID patterns and category
  const edgeMap: Record<string, string> = {
    A: 'Heler', B: 'Husker', C: 'Integrerer',
    D: 'Vokser', E: 'Laerer', F: 'Laerer', G: 'Husker',
  }
  return edgeMap[category] || 'Heler'
}

// ─── Issue Discovery ────────────────────────────────────────────────────────

async function discoverNewIssues(executionContext: string): Promise<string[]> {
  const newIssues: string[] = []

  try {
    // Use RLM to analyze execution context for undiscovered issues
    if (await isRlmAvailable()) {
      const analysis = await callCognitive('analyze', {
        prompt: `Analyze this execution context for any NEW issues, failures, or anomalies not yet tracked. Context: ${executionContext.slice(0, 2000)}`,
        agent_id: 'hyperagent-discovery',
      })

      const result = analysis as Record<string, unknown>
      if (result?.issues && Array.isArray(result.issues)) {
        for (const issue of result.issues) {
          const desc = typeof issue === 'string' ? issue : JSON.stringify(issue)
          if (!discoveredIssues.includes(desc)) {
            discoveredIssues.push(desc)
            if (discoveredIssues.length > MAX_DISCOVERED_ISSUES) discoveredIssues.splice(0, discoveredIssues.length - MAX_DISCOVERED_ISSUES)
            newIssues.push(desc)
            stream('issue_discovered', { issue: desc })
          }
        }
      }
    }
  } catch (err) {
    logger.debug({ err }, 'HyperAgent-Auto: issue discovery scan failed (non-blocking)')
  }

  return newIssues
}

// ─── Fitness Function ───────────────────────────────────────────────────────

function computeFitness(edgeScores: EdgeScore[]): number {
  let fitness = 0
  for (const edge of edgeScores) {
    const w = edgeWeights[edge.name] ?? (1 / 6)
    fitness += w * edge.score
  }
  return fitness
}

function adaptWeights(edgesBefore: EdgeScore[], edgesAfter: EdgeScore[]): void {
  for (const after of edgesAfter) {
    const before = edgesBefore.find(e => e.name === after.name)
    if (!before) continue

    const delta = after.score - before.score
    const gapFromTarget = TARGET_EDGE_SCORE - after.score

    // Edges further from target AND improving get more weight
    edgeWeights[after.name] = Math.max(0.05, Math.min(0.40,
      (edgeWeights[after.name] ?? (1 / 6)) + LEARNING_RATE * gapFromTarget * delta,
    ))
  }

  // Renormalize weights to sum to 1
  const sum = Object.values(edgeWeights).reduce((a, b) => a + b, 0)
  for (const k of Object.keys(edgeWeights)) {
    edgeWeights[k] /= sum
  }
}

// ─── RLM-Enhanced Target Execution Pipeline ────────────────────────────────

/**
 * Step A: Enrich target with RAG context — retrieves relevant knowledge
 * from dual-channel RAG (GraphRAG + SRAG + Cypher) and folds it into
 * a compact context string suitable for the RLM planner.
 *
 * Returns folded RAG context + channel metadata for reward routing.
 */
async function enrichTargetWithRAG(target: TargetDef, edgeGap: number): Promise<{
  ragContext: string
  channelsUsed: string[]
  ragResultCount: number
}> {
  try {
    const ragQuery = `Platform target ${target.id}: ${target.metric}. ` +
      `Edge: ${target.edge} (gap: ${edgeGap.toFixed(1)}). ` +
      `Category: ${target.category}. ` +
      `Find relevant knowledge, prior fixes, lessons, and related issues.`

    const ragResponse = await dualChannelRAG(ragQuery, {
      maxResults: 8,
      maxHops: target.category === 'E' || target.category === 'F' ? 3 : 2,
      forceChannels: edgeGap > 1.0
        ? ['graphrag', 'srag', 'cypher']  // High-gap: use all channels
        : ['graphrag', 'srag'],            // Low-gap: skip cypher overhead
    })

    // Fold the merged RAG context to fit in planner's context window
    const folded = await foldContext(
      `[RAG context for ${target.id}]\n${ragResponse.merged_context}`,
      1500,
    )

    logger.info({
      targetId: target.id,
      channels: ragResponse.channels_used,
      resultCount: ragResponse.results.length,
      durationMs: ragResponse.duration_ms,
      pollution: ragResponse.pollution_filtered,
    }, 'HyperAgent-Auto: RAG enrichment complete')

    return {
      ragContext: folded,
      channelsUsed: ragResponse.channels_used,
      ragResultCount: ragResponse.results.length,
    }
  } catch (err) {
    logger.warn({ targetId: target.id, err: String(err) }, 'HyperAgent-Auto: RAG enrichment failed (continuing without)')
    return { ragContext: '', channelsUsed: [], ragResultCount: 0 }
  }
}

/**
 * Step B: Deep RLM reasoning about target approach — uses /reason endpoint
 * for multi-step cognitive analysis before plan decomposition.
 * Returns a structured reasoning trace with recommended approach.
 */
async function reasonAboutTarget(
  target: TargetDef,
  ragContext: string,
  edgesBefore: EdgeScore[],
  phase: AutonomousPhase,
): Promise<{ approach: string; confidence: number; chainModeOverride?: string }> {
  if (!isRlmAvailable()) {
    return { approach: '', confidence: 0 }
  }

  try {
    const edge = edgesBefore.find(e => e.name === target.edge)
    const reasonResult = await callCognitiveRaw('reason', {
      prompt: `Deep analysis for autonomous target execution.

TARGET: ${target.id} — ${target.metric}
EDGE: ${target.edge} (score: ${edge?.score.toFixed(1) ?? '?'}, gap: ${edge?.gap.toFixed(1) ?? '?'})
CATEGORY: ${target.category} (chain hint: ${CHAIN_MODE_MATRIX[target.category] || 'sequential'})
PHASE: ${phase} (policy: ${PHASE_POLICY[phase]})

PRIOR KNOWLEDGE FROM RAG:
${ragContext || '(no RAG context available)'}

Determine:
1. The optimal execution approach for this target
2. Whether the chain mode should differ from the category default
3. Confidence level (0-1) that this target can be closed in current phase
4. Any prerequisite actions needed before execution`,
      agent_id: 'hyperagent-auto',
      depth: target.category === 'E' || target.category === 'A' ? 2 : 1,
      context: {
        edgeScores: edgesBefore.reduce((acc, e) => ({ ...acc, [e.name]: e.score }), {}),
        phase,
      },
    }, 30000)

    if (!reasonResult) return { approach: '', confidence: 0 }

    // Extract structured fields from RLM response
    const approach = reasonResult.answer || reasonResult.reasoning || ''
    const confidence = reasonResult.confidence ?? 0.5
    const routing = reasonResult.routing

    // Determine if chain mode should be overridden based on reasoning
    let chainModeOverride: string | undefined
    const approachLower = (typeof approach === 'string' ? approach : '').toLowerCase()
    if (approachLower.includes('debate') || approachLower.includes('multi-perspective')) {
      chainModeOverride = 'debate'
    } else if (approachLower.includes('parallel') || approachLower.includes('independent')) {
      chainModeOverride = 'parallel'
    } else if (approachLower.includes('adaptive') || approachLower.includes('q-learning')) {
      chainModeOverride = 'adaptive'
    }

    logger.info({
      targetId: target.id,
      confidence,
      chainModeOverride,
      provider: routing?.provider,
      costDkk: routing?.cost,
    }, 'HyperAgent-Auto: RLM reasoning complete')

    return { approach: typeof approach === 'string' ? approach : JSON.stringify(approach), confidence, chainModeOverride }
  } catch (err) {
    logger.warn({ targetId: target.id, err: String(err) }, 'HyperAgent-Auto: RLM reasoning failed (using defaults)')
    return { approach: '', confidence: 0 }
  }
}

/**
 * Step C: Emit per-channel RAG reward — feeds success/failure signal
 * back to the adaptive RAG Q-learning system so retrieval improves.
 */
async function emitPerChannelReward(
  targetId: string,
  success: boolean,
  edgeDelta: number,
  channelsUsed: string[],
): Promise<void> {
  const reward = success ? 1.0 + Math.max(0, edgeDelta * 5) : -0.5
  for (const channel of channelsUsed) {
    try {
      await callMcpTool({
        toolName: 'adaptive_rag_reward',
        args: {
          query: `channel:${channel}:target:${targetId}`,
          reward,
          metadata: { targetId, channel, success, edgeDelta, phase: currentPhase },
        },
        callId: `hyp-rag-reward-${targetId}-${channel}`,
      })
    } catch {
      // Non-blocking — reward is best-effort
    }
  }
}

// ─── RAG Reward Signal ──────────────────────────────────────────────────────

async function emitReward(targetId: string, success: boolean, edgeDelta: number): Promise<void> {
  try {
    await callMcpTool({
      toolName: 'adaptive_rag_reward',
      args: {
        query: `target:${targetId}`,
        reward: success ? 1.0 + edgeDelta : -0.5,
        metadata: { targetId, success, edgeDelta, phase: currentPhase },
      },
      callId: `hyp-reward-${targetId}-${Date.now()}`,
    })
  } catch {
    // Non-blocking: RAG reward is best-effort
  }
}

// ─── Context Folding ────────────────────────────────────────────────────────

async function foldContext(text: string, budget: number = 2000): Promise<string> {
  try {
    const result = await callMcpTool({
      toolName: 'context_fold',
      args: { text, budget, domain: 'platform-operations', query: 'autonomous execution status' },
      callId: `hyp-fold-${Date.now()}`,
    })
    return typeof result === 'string' ? result : JSON.stringify(result)
  } catch {
    // Fallback: truncate
    return text.slice(0, budget * 4)
  }
}

// ─── Core Autonomous Cycle ──────────────────────────────────────────────────

export async function runAutonomousCycle(
  phase?: AutonomousPhase,
  maxTargets?: number,
): Promise<CycleResult> {
  if (isRunning) {
    throw new Error('Autonomous cycle already running')
  }

  isRunning = true

  // Restore totalCycles from Redis on first cycle (survives redeploys)
  if (totalCycles === 0) {
    const redisRestore = getRedis()
    if (redisRestore) {
      try {
        const stored = await redisRestore.get('hyperagent:totalCycles')
        if (stored) {
          totalCycles = parseInt(stored, 10) || 0
          logger.info({ totalCycles }, 'HyperAgent-Auto: restored totalCycles from Redis')
        }
      } catch { /* non-blocking */ }
    }
  }

  const cycleId = `auto-${uuid().slice(0, 8)}`
  const effectivePhase = phase ?? currentPhase
  const batchSize = maxTargets ?? CYCLE_BATCH_SIZE[effectivePhase]
  const profileId = PHASE_POLICY[effectivePhase]
  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  stream('cycle_start', { cycleId, phase: effectivePhase, batchSize })

  let targetsAttempted = 0
  let targetsCompleted = 0
  let targetsFailed = 0
  const closedTargets: TargetDef[] = []
  const newIssues: string[] = []
  const lessons: string[] = []

  try {
    // ── Step 1: OBSERVE — Read current edge scores
    currentStep = 'observe'
    stream('step', { step: 'observe', detail: 'Reading edge scores and target registry' })
    const edgesBefore = await observeEdgeScores()

    // ── Step 2: LOAD & PRIORITIZE — Rank targets by fitness function
    currentStep = 'prioritize'
    const allTargets = await loadTargetRegistry()
    const ranked = rankTargets(allTargets, edgesBefore)
    const batch = ranked.slice(0, batchSize)

    stream('step', {
      step: 'prioritize',
      detail: `${allTargets.length} targets loaded, ${ranked.length} open, top ${batch.length} selected`,
      topTargets: batch.map(t => t.id),
    })

    // ── Step 3: EXECUTE — RLM-enhanced pipeline per target
    //    A) RAG enrichment → B) RLM deep reasoning → C) Plan → D) Execute → E) Reward
    currentStep = 'execute'
    for (const target of batch) {
      currentTarget = target.id
      targetsAttempted++

      const edgeGap = edgesBefore.find(e => e.name === target.edge)?.gap ?? 1.0

      stream('target_start', { targetId: target.id, edge: target.edge, category: target.category, edgeGap })

      try {
        // ── A) RAG ENRICHMENT — Retrieve prior knowledge from dual-channel RAG
        stream('target_step', { targetId: target.id, step: 'rag_enrich' })
        const { ragContext, channelsUsed, ragResultCount } = await enrichTargetWithRAG(target, edgeGap)

        // ── B) RLM DEEP REASONING — Analyze target before planning
        stream('target_step', { targetId: target.id, step: 'rlm_reason' })
        const { approach, confidence, chainModeOverride } = await reasonAboutTarget(
          target, ragContext, edgesBefore, effectivePhase,
        )

        // Resolve chain mode: RLM override > category default
        const categoryMode = CHAIN_MODE_MATRIX[target.category] || 'sequential'
        const chainMode = chainModeOverride || categoryMode

        // ── C) PLAN — Build enriched goal with RAG context + RLM reasoning
        stream('target_step', { targetId: target.id, step: 'plan', chainMode, confidence })
        const enrichedGoal = `[AUTO-${effectivePhase}] Close target ${target.id}: ${target.metric}. ` +
          `Edge: ${target.edge} (gap: ${edgeGap.toFixed(1)}). ` +
          `Chain mode: ${chainMode}. Policy: ${profileId}. ` +
          `Confidence: ${confidence.toFixed(2)}. ` +
          (ragContext ? `\n\n[RAG Context]\n${ragContext.slice(0, 800)}\n` : '') +
          (approach ? `\n[RLM Approach]\n${approach.slice(0, 500)}\n` : '')

        const plan = await createPlan(enrichedGoal, `auto-${cycleId}`, profileId)

        // ── D) EXECUTE — Run via chain engine (mode resolved above)
        //   Auto-approve for Phase 1+: the autonomous executor self-approves staged plans.
        //   Approval audit trail is preserved (approvedBy: 'hyperagent-auto').
        if (plan.status === 'approved' || effectivePhase === 'phase_0') {
          stream('target_step', { targetId: target.id, step: 'execute' })
          const EXEC_TIMEOUT_MS = 120_000
          const execution = await Promise.race([
            executePlan(plan.planId),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`executePlan timeout after ${EXEC_TIMEOUT_MS}ms`)), EXEC_TIMEOUT_MS)),
          ])

          if (execution.status === 'completed') {
            targetsCompleted++
            target.status = 'closed'
            closedTargets.push(target)
            stream('target_complete', {
              targetId: target.id, status: 'completed',
              ragChannels: channelsUsed, ragResults: ragResultCount,
              confidence, chainMode,
            })

            // ── E) REWARD — Emit rewards to both adaptive RAG and general system
            const edgeDelta = 0.1 // estimated; real delta computed after full cycle
            await emitReward(target.id, true, edgeDelta)
            await emitPerChannelReward(target.id, true, edgeDelta, channelsUsed)

            // Evaluate and persist KPI
            await evaluatePlan(execution.execution_id, plan.planId, 80, 'hyperagent-auto')

            lessons.push(`Target ${target.id} closed via ${chainMode} (conf=${confidence.toFixed(2)}, rag=${ragResultCount})`)
          } else {
            targetsFailed++
            stream('target_failed', { targetId: target.id, status: execution.status, chainMode })
            await emitReward(target.id, false, 0)
            await emitPerChannelReward(target.id, false, 0, channelsUsed)
            lessons.push(`Target ${target.id} failed (${execution.status}) via ${chainMode}`)
          }

          // Discover issues from execution context (enriched with RAG + reasoning trace)
          const discoveryContext = JSON.stringify({
            target: target.id,
            steps: execution.steps_completed,
            status: execution.status,
            ragChannels: channelsUsed,
            ragResultCount,
            approach: approach.slice(0, 300),
          })
          const found = await discoverNewIssues(discoveryContext)
          newIssues.push(...found)
        } else {
          stream('approval_needed', { planId: plan.planId, targetId: target.id, profile: profileId })
          lessons.push(`Target ${target.id} needs approval (${profileId})`)
        }
      } catch (err) {
        targetsFailed++
        const errMsg = err instanceof Error ? err.message : String(err)
        stream('target_error', { targetId: target.id, error: errMsg })
        lessons.push(`Target ${target.id} failed: ${errMsg}`)
        await emitReward(target.id, false, -0.1)
      }
    }

    // ── Step 4: EVALUATE — Update edge scores from closed targets, compute delta
    currentStep = 'evaluate'
    const updatedEdges = await updateEdgeScores(edgesBefore, closedTargets)
    const edgesAfter = updatedEdges
    const fitnessBefore = computeFitness(edgesBefore)
    const fitnessAfter = computeFitness(edgesAfter)
    const fitnessDelta = fitnessAfter - fitnessBefore

    stream('step', {
      step: 'evaluate',
      fitnessBefore: fitnessBefore.toFixed(3),
      fitnessAfter: fitnessAfter.toFixed(3),
      fitnessDelta: fitnessDelta.toFixed(4),
    })

    // ── Step 5: EVOLVE — Adapt weights, retrain RAG, emit lessons
    currentStep = 'evolve'
    adaptWeights(edgesBefore, edgesAfter)

    // Retrain adaptive RAG weights based on cycle success rate
    try {
      if (targetsAttempted > 0) {
        await callMcpTool({
          toolName: 'adaptive_rag_retrain',
          args: {
            trigger: 'autonomous_cycle',
            metadata: {
              cycleId,
              phase: effectivePhase,
              successRate: targetsCompleted / targetsAttempted,
              fitnessDelta,
            },
          },
          callId: `hyp-retrain-${cycleId}`,
        })
        logger.info({ cycleId, successRate: targetsCompleted / targetsAttempted }, 'HyperAgent-Auto: RAG retrain triggered')
      }
    } catch {
      logger.debug('HyperAgent-Auto: RAG retrain failed (non-blocking)')
    }

    // Fold cycle summary for lesson persistence
    const cycleSummary = `Cycle ${cycleId}: ${targetsCompleted}/${targetsAttempted} completed, ` +
      `fitness delta ${fitnessDelta.toFixed(4)}, ` +
      `${newIssues.length} new issues discovered. ` +
      `Lessons: ${lessons.join('; ')}`

    const foldedSummary = await foldContext(cycleSummary, 1000)

    // Persist lesson to Neo4j
    try {
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `CREATE (l:Lesson {
            id: $lessonId, type: 'autonomous_cycle', agentId: 'hyperagent-auto',
            phase: $phase, summary: $summary, targetsCompleted: $completed,
            targetsFailed: $failed, fitnessDelta: $fitnessDelta,
            discoveredIssues: $discoveredIssues, timestamp: datetime()
          })`,
          params: {
            lessonId: `lesson-${cycleId}`,
            phase: effectivePhase,
            summary: foldedSummary,
            completed: targetsCompleted,
            failed: targetsFailed,
            fitnessDelta: fitnessDelta,
            discoveredIssues: newIssues.length,
          },
        },
        callId: `hyp-lesson-${cycleId}`,
      })
    } catch {
      logger.debug('HyperAgent-Auto: lesson persistence failed (non-blocking)')
    }

    // ── Step 6: STREAM final results
    const result: CycleResult = {
      cycleId,
      phase: effectivePhase,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      targetsAttempted,
      targetsCompleted,
      targetsFailed,
      newIssuesDiscovered: newIssues,
      edgeScoresBefore: edgesBefore,
      edgeScoresAfter: edgesAfter,
      fitnessScoreDelta: fitnessDelta,
      lessonsLearned: lessons,
    }

    lastCycle = result
    totalCycles++
    currentStep = 'idle'
    currentTarget = null

    // Persist totalCycles to Redis (survives redeploys)
    const redisPersist = getRedis()
    if (redisPersist) {
      await redisPersist.set('hyperagent:totalCycles', String(totalCycles)).catch(() => {})
    }

    stream('cycle_complete', {
      cycleId,
      completed: targetsCompleted,
      failed: targetsFailed,
      discovered: newIssues.length,
      fitnessDelta: fitnessDelta.toFixed(4),
      durationMs: result.durationMs,
    })

    // Persist cycle result to Redis
    const redis = getRedis()
    if (redis) {
      await redis.lpush('hyperagent:autonomous-cycles', JSON.stringify(result))
      await redis.ltrim('hyperagent:autonomous-cycles', 0, 99) // keep last 100
      await redis.set('hyperagent:autonomous-status', JSON.stringify(getAutonomousStatus()))
      await redis.expire('hyperagent:autonomous-status', 86400)
    }

    // Persist cross-repo memory: edges, fitness, weights, last cycle summary
    await persistCrossRepoMemory('edges', 'latest', edgesAfter, 'orchestrator')
    await persistCrossRepoMemory('fitness', 'weights', edgeWeights, 'orchestrator')
    await persistCrossRepoMemory('fitness', 'score', { score: fitnessAfter, delta: fitnessDelta, cycle: cycleId }, 'orchestrator')
    await persistCrossRepoMemory('cycles', `last:${cycleId}`, {
      cycleId, phase: effectivePhase,
      completed: targetsCompleted, failed: targetsFailed,
      discovered: newIssues.length, fitnessDelta,
    }, 'orchestrator')
    if (newIssues.length > 0) {
      await persistCrossRepoMemory('discoveries', cycleId, newIssues, 'orchestrator')
    }

    return result
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    stream('cycle_error', { cycleId, error: errMsg })
    throw err
  } finally {
    isRunning = false
    currentStep = 'idle'
    currentTarget = null
  }
}

// ─── Status ─────────────────────────────────────────────────────────────────

export function getAutonomousStatus(): AutonomousStatus {
  const edges = lastCycle?.edgeScoresAfter ?? [
    { name: 'Husker', score: 9.0, target: 9.5, gap: 0.5 },
    { name: 'Laerer', score: 8.3, target: 9.5, gap: 1.2 },
    { name: 'Heler', score: 8.0, target: 9.5, gap: 1.5 },
    { name: 'Forklarer', score: 9.0, target: 9.5, gap: 0.5 },
    { name: 'Vokser', score: 8.5, target: 9.5, gap: 1.0 },
    { name: 'Integrerer', score: 8.5, target: 9.5, gap: 1.0 },
  ]

  return {
    isRunning,
    currentPhase,
    currentTarget,
    currentStep,
    totalCycles,
    lastCycle,
    edgeScores: edges,
    fitnessScore: computeFitness(edges),
    targetsRemaining: 72 - (lastCycle?.targetsCompleted ?? 0),
    targetsCompleted: lastCycle?.targetsCompleted ?? 0,
  }
}

/** Phase transition check — call after each cycle */
export function checkPhaseGate(): { shouldAdvance: boolean; nextPhase: AutonomousPhase; reason: string; details: Record<string, unknown> } {
  const edges = lastCycle?.edgeScoresAfter ?? []
  const minEdge = edges.length > 0 ? Math.min(...edges.map(e => e.score)) : 0

  const phases: AutonomousPhase[] = ['phase_0', 'phase_1', 'phase_2', 'phase_3']
  const currentIdx = phases.indexOf(currentPhase)
  if (currentIdx >= phases.length - 1) {
    return { shouldAdvance: false, nextPhase: currentPhase, reason: 'Already at max phase', details: { phase: currentPhase } }
  }

  const nextPhase = phases[currentIdx + 1]
  const gate = PHASE_GATES[nextPhase]

  const details = {
    currentPhase,
    nextPhase,
    minEdge,
    requiredMinEdge: gate.minEdge,
    totalCycles,
    requiredMinCycles: gate.minCycles,
    policy: PHASE_POLICY[nextPhase],
  }

  if (minEdge < gate.minEdge) {
    return { shouldAdvance: false, nextPhase, reason: `Min edge ${minEdge.toFixed(1)} < gate ${gate.minEdge}`, details }
  }

  if (totalCycles < gate.minCycles) {
    return { shouldAdvance: false, nextPhase, reason: `Cycles ${totalCycles} < required ${gate.minCycles}`, details }
  }

  return {
    shouldAdvance: true,
    nextPhase,
    reason: `Min edge ${minEdge.toFixed(1)} >= ${gate.minEdge}, cycles ${totalCycles} >= ${gate.minCycles}. Ready to advance to ${nextPhase} (policy: ${PHASE_POLICY[nextPhase]})`,
    details,
  }
}

/** Advance to next phase (manual or auto-triggered) */
export function advancePhase(): AutonomousPhase {
  const { shouldAdvance, nextPhase, reason } = checkPhaseGate()
  if (shouldAdvance) {
    const prev = currentPhase
    currentPhase = nextPhase
    stream('phase_advance', { from: prev, to: nextPhase, reason })
    logger.info({ from: prev, to: nextPhase }, 'HyperAgent-Auto: phase advanced')
  }
  return currentPhase
}

/** Set phase explicitly (admin override) */
export function setPhase(phase: AutonomousPhase): void {
  const prev = currentPhase
  currentPhase = phase
  stream('phase_set', { from: prev, to: phase, reason: 'admin override' })
}

// ─── Persistent Cross-Repo Memory ──────────────────────────────────────────
// Keys: hyperagent:memory:{domain}:{key}
// Also persisted to Neo4j as :HyperAgentMemory nodes for graph queries.
// Designed for cross-repo access: any repo can read/write via MCP tool.

const MEMORY_PREFIX = 'hyperagent:memory'
const MEMORY_TTL = 86400 * 30 // 30 days

/**
 * Persist a cross-repo memory entry to Redis + Neo4j.
 * Called by MCP tool executor when any repo writes memory.
 */
export async function persistCrossRepoMemory(
  domain: string,
  key: string,
  value: unknown,
  callerRepo?: string,
): Promise<void> {
  const redis = getRedis()
  const entry = {
    domain,
    key,
    value,
    caller_repo: callerRepo ?? 'orchestrator',
    stored_at: new Date().toISOString(),
    agent_id: 'hyperagent-auto',
  }

  // Redis persistence (primary — fast reads)
  if (redis) {
    await redis.set(
      `${MEMORY_PREFIX}:${domain}:${key}`,
      JSON.stringify(entry),
      'EX',
      MEMORY_TTL,
    )
    // Index for domain listing
    await redis.sadd(`${MEMORY_PREFIX}:domains`, domain)
    await redis.sadd(`${MEMORY_PREFIX}:${domain}:keys`, key)
  }

  // Neo4j persistence (secondary — graph queries, survives Redis eviction)
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (m:HyperAgentMemory {domain: $domain, key: $key})
                SET m.value = $value, m.caller_repo = $callerRepo,
                    m.agent_id = 'hyperagent-auto', m.updated_at = datetime()
                WITH m
                MERGE (a:Agent {id: 'hyperagent-auto'})
                MERGE (a)-[:HAS_MEMORY]->(m)`,
        params: {
          domain,
          key,
          value: typeof value === 'string' ? value : JSON.stringify(value),
          callerRepo: callerRepo ?? 'orchestrator',
        },
      },
      callId: `hyp-mem-write-${Date.now()}`,
    })
  } catch {
    logger.debug('HyperAgent-Auto: Neo4j memory persistence failed (Redis is primary)')
  }
}

/**
 * Read cross-repo memory. Falls back from Redis → Neo4j.
 */
export async function readCrossRepoMemory(
  domain: string,
  key?: string,
): Promise<unknown> {
  const redis = getRedis()

  // Single key read
  if (key) {
    if (redis) {
      const raw = await redis.get(`${MEMORY_PREFIX}:${domain}:${key}`)
      if (raw) return JSON.parse(raw)
    }

    // Fallback to Neo4j
    try {
      const result = await callMcpTool({
        toolName: 'graph.read_cypher',
        args: {
          query: `MATCH (m:HyperAgentMemory {domain: $domain, key: $key})
                  RETURN m.value AS value, m.caller_repo AS caller_repo, m.updated_at AS updated_at`,
          params: { domain, key },
        },
        callId: `hyp-mem-read-${Date.now()}`,
      })
      return result
    } catch {
      return null
    }
  }

  // All keys in domain
  if (redis) {
    const keys = await redis.smembers(`${MEMORY_PREFIX}:${domain}:keys`)
    const entries: unknown[] = []
    for (const k of keys) {
      const raw = await redis.get(`${MEMORY_PREFIX}:${domain}:${k}`)
      if (raw) entries.push(JSON.parse(raw))
    }
    return entries
  }

  return []
}

/**
 * List all memory domains.
 */
export async function listCrossRepoMemory(): Promise<string[]> {
  const redis = getRedis()
  if (!redis) return []
  return redis.smembers(`${MEMORY_PREFIX}:domains`)
}
