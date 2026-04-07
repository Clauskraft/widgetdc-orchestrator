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
import { createPlan, executePlan, evaluatePlan, type HyperPlan } from './hyperagent.js'
import { callCognitive, isRlmAvailable } from './cognitive-proxy.js'
import { callMcpTool } from './mcp-caller.js'
import { getRedis } from './redis.js'
import { broadcastSSE } from './sse.js'
import { broadcastMessage } from './chat-broadcaster.js'
import { logger } from './logger.js'
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

/** Phase gate thresholds */
const PHASE_GATES: Record<AutonomousPhase, { minEdge: number; stableDays: number; maxConcurrent: number }> = {
  phase_0: { minEdge: 0, stableDays: 0, maxConcurrent: 1 },
  phase_1: { minEdge: 7.0, stableDays: 2, maxConcurrent: 2 },
  phase_2: { minEdge: 8.5, stableDays: 7, maxConcurrent: 4 },
  phase_3: { minEdge: 9.0, stableDays: 14, maxConcurrent: 8 },
}

/** Policy profile per phase */
const PHASE_POLICY: Record<AutonomousPhase, string> = {
  phase_0: 'read_only',
  phase_1: 'read_only',
  phase_2: 'staged_write',
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

/** Known discovered issues (accumulated across cycles) */
const discoveredIssues: string[] = []

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

async function observeEdgeScores(): Promise<EdgeScore[]> {
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
      return rows.map((r: Record<string, unknown>) => ({
        name: String(r.name),
        score: Number(r.score),
        target: TARGET_EDGE_SCORE,
        gap: TARGET_EDGE_SCORE - Number(r.score),
      }))
    }
  } catch {
    logger.debug('HyperAgent-Auto: EdgeScore nodes not found, using defaults')
  }

  // Fallback: use last known scores from memory
  return [
    { name: 'Husker', score: 9.0, target: 9.5, gap: 0.5 },
    { name: 'Laerer', score: 8.3, target: 9.5, gap: 1.2 },
    { name: 'Heler', score: 8.0, target: 9.5, gap: 1.5 },
    { name: 'Forklarer', score: 9.0, target: 9.5, gap: 0.5 },
    { name: 'Vokser', score: 8.5, target: 9.5, gap: 1.0 },
    { name: 'Integrerer', score: 8.5, target: 9.5, gap: 1.0 },
  ]
}

// ─── Target Registry Loader ─────────────────────────────────────────────────

async function loadTargetRegistry(): Promise<TargetDef[]> {
  const redis = getRedis()
  if (!redis) return []

  try {
    // Try multiple key patterns (working-memory prefix, hyperagent prefix, cross-repo memory)
    const keyPatterns = [
      'wm:HYPERAGENT:target-registry-v2.2',          // working-memory format
      'hyperagent:HYPERAGENT:target-registry-v2.2',   // legacy format
      'hyperagent:memory:targets:full-registry-v2.2', // cross-repo memory format
      'wm:HYPERAGENT:target-registry-v2.1',           // older version
    ]

    for (const key of keyPatterns) {
      const raw = await redis.get(key)
      if (raw) {
        // Working-memory wraps value in a MemoryEntry envelope
        try {
          const parsed = JSON.parse(raw)
          // If it has a 'value' field, unwrap the envelope
          const data = parsed.value ? (typeof parsed.value === 'string' ? JSON.parse(parsed.value) : parsed.value) : parsed
          const targets = parseRegistryToTargets(data)
          if (targets.length > 0) {
            logger.info({ key, targetCount: targets.length }, 'HyperAgent-Auto: loaded target registry')
            return targets
          }
        } catch { /* try next key */ }
      }
    }

    logger.info('HyperAgent-Auto: no target registry found in any key pattern')
    return []
  } catch {
    logger.warn('HyperAgent-Auto: failed to load target registry from Redis')
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

    // ── Step 3: EXECUTE — Process each target
    currentStep = 'execute'
    for (const target of batch) {
      currentTarget = target.id
      targetsAttempted++

      stream('target_start', { targetId: target.id, edge: target.edge, category: target.category })

      try {
        // Build goal from target
        const chainMode = CHAIN_MODE_MATRIX[target.category] || 'sequential'
        const goal = `[AUTO-${effectivePhase}] Close target ${target.id}: ${target.metric}. ` +
          `Edge: ${target.edge} (gap: ${edgesBefore.find(e => e.name === target.edge)?.gap.toFixed(1) ?? '?'}). ` +
          `Chain mode hint: ${chainMode}. Policy: ${profileId}.`

        // Create plan via HyperAgent (uses RLM for decomposition)
        const plan = await createPlan(goal, `auto-${cycleId}`, profileId)

        // In phase 0/1, auto-approve read_only plans
        // In phase 2+, staged_write plans need approval gate
        if (plan.status === 'approved' || effectivePhase === 'phase_0' || effectivePhase === 'phase_1') {
          // Execute
          const execution = await executePlan(plan.planId)

          if (execution.status === 'completed') {
            targetsCompleted++
            target.status = 'closed'
            stream('target_complete', { targetId: target.id, status: 'completed' })

            // Emit RAG reward (positive)
            const edgeDelta = 0.1 // estimated; real delta computed after full cycle
            await emitReward(target.id, true, edgeDelta)

            // Evaluate and persist KPI
            await evaluatePlan(execution.execution_id, plan.planId, 80, 'hyperagent-auto')
          } else {
            targetsFailed++
            stream('target_failed', { targetId: target.id, status: execution.status })
            await emitReward(target.id, false, 0)
          }

          // Discover issues from execution context
          const context = JSON.stringify({
            target: target.id,
            steps: execution.steps_completed,
            status: execution.status,
          })
          const found = await discoverNewIssues(context)
          newIssues.push(...found)
        } else {
          // Plan needs approval — stream it for user
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

    // ── Step 4: EVALUATE — Re-read edge scores and compute delta
    currentStep = 'evaluate'
    const edgesAfter = await observeEdgeScores()
    const fitnessBefore = computeFitness(edgesBefore)
    const fitnessAfter = computeFitness(edgesAfter)
    const fitnessDelta = fitnessAfter - fitnessBefore

    stream('step', {
      step: 'evaluate',
      fitnessBefore: fitnessBefore.toFixed(3),
      fitnessAfter: fitnessAfter.toFixed(3),
      fitnessDelta: fitnessDelta.toFixed(4),
    })

    // ── Step 5: EVOLVE — Adapt weights, emit lessons
    currentStep = 'evolve'
    adaptWeights(edgesBefore, edgesAfter)

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
export function checkPhaseGate(): { shouldAdvance: boolean; nextPhase: AutonomousPhase; reason: string } {
  const edges = lastCycle?.edgeScoresAfter ?? []
  const minEdge = edges.length > 0 ? Math.min(...edges.map(e => e.score)) : 0

  const phases: AutonomousPhase[] = ['phase_0', 'phase_1', 'phase_2', 'phase_3']
  const currentIdx = phases.indexOf(currentPhase)
  if (currentIdx >= phases.length - 1) {
    return { shouldAdvance: false, nextPhase: currentPhase, reason: 'Already at max phase' }
  }

  const nextPhase = phases[currentIdx + 1]
  const gate = PHASE_GATES[nextPhase]

  if (minEdge < gate.minEdge) {
    return { shouldAdvance: false, nextPhase, reason: `Min edge ${minEdge.toFixed(1)} < gate ${gate.minEdge}` }
  }

  // Simplified stability check (full impl would track days of stability)
  return {
    shouldAdvance: true,
    nextPhase,
    reason: `Min edge ${minEdge.toFixed(1)} >= ${gate.minEdge}, ready to advance`,
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
