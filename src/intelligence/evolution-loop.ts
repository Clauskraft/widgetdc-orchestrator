/**
 * evolution-loop.ts — Autonomous Evolution Loop (OODA: Observe → Orient → Act → Learn)
 *
 * LIN-342: Wires the RLM → LegoFactory → Execution → Feedback loop end-to-end.
 *
 * 4 stages:
 *   1. OBSERVE  — RLM analyze to assess current platform state
 *   2. ORIENT   — Query graph for blocks needing evolution + RLM plan
 *   3. ACT      — Execute improvement chain via chain-engine (adaptive mode)
 *   4. LEARN    — Write EvolutionEvent to Neo4j + lessons to agent memory
 *
 * Rate-limited: max 1 concurrent loop. Timeout: 5 min/stage, 20 min total.
 */
import { v4 as uuid } from 'uuid'
import { callCognitive, isRlmAvailable } from '../cognitive-proxy.js'
import { callMcpTool } from '../mcp-caller.js'
import { executeChain } from '../chain-engine.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'
import { broadcastMessage } from '../chat-broadcaster.js'
import { broadcastSSE } from '../sse.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export type EvolutionStage = 'observe' | 'orient' | 'act' | 'learn'

interface ObserveResult {
  observations: string[]
  priority_areas: string[]
  confidence: number
}

interface OrientResult {
  blocks_to_evolve: Array<{ id: string; label: string; name: string; reason: string }>
  plan: string
  estimated_impact: number
}

interface ActResult {
  executed: number
  passed: number
  failed: number
  artifacts: string[]
}

interface LearnResult {
  events_created: number
  lessons_written: number
}

export interface EvolutionCycleResult {
  cycle_id: string
  status: 'completed' | 'failed' | 'partial' | 'dry_run'
  summary: string
  started_at: string
  completed_at: string
  duration_ms: number
  focus_area?: string
  dry_run: boolean
  stages: {
    observe?: { status: 'success' | 'error' | 'skipped'; result?: ObserveResult; error?: string; duration_ms: number }
    orient?: { status: 'success' | 'error' | 'skipped'; result?: OrientResult; error?: string; duration_ms: number }
    act?: { status: 'success' | 'error' | 'skipped'; result?: ActResult; error?: string; duration_ms: number }
    learn?: { status: 'success' | 'error' | 'skipped'; result?: LearnResult; error?: string; duration_ms: number }
  }
}

export interface EvolutionStatus {
  is_running: boolean
  current_stage?: EvolutionStage
  last_cycle?: EvolutionCycleResult
  total_cycles: number
}

// ─── State ──────────────────────────────────────────────────────────────────

let isRunning = false
let currentStage: EvolutionStage | undefined
let lastCycle: EvolutionCycleResult | undefined
let totalCycles = 0

const STAGE_TIMEOUT_MS = 5 * 60 * 1000   // 5 minutes per stage
const TOTAL_TIMEOUT_MS = 20 * 60 * 1000  // 20 minutes total
const REDIS_PREFIX = 'orchestrator:evolution:'
const REDIS_HISTORY_KEY = 'orchestrator:evolution:history'
const REDIS_TTL = 7 * 86400 // 7 days

// ─── Helpers ────────────────────────────────────────────────────────────────

async function persistCycle(cycle: EvolutionCycleResult): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(`${REDIS_PREFIX}${cycle.cycle_id}`, JSON.stringify(cycle), 'EX', REDIS_TTL)
    await redis.lpush(REDIS_HISTORY_KEY, JSON.stringify(cycle))
    await redis.ltrim(REDIS_HISTORY_KEY, 0, 19) // Keep last 20
    await redis.expire(REDIS_HISTORY_KEY, REDIS_TTL)
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to persist evolution cycle to Redis')
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

function safeParseJson(text: unknown): Record<string, unknown> {
  if (typeof text !== 'string') {
    if (typeof text === 'object' && text !== null) return text as Record<string, unknown>
    return {}
  }
  try {
    const match = text.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : {}
  } catch {
    return {}
  }
}

// ─── Stage 1: OBSERVE ───────────────────────────────────────────────────────

async function stageObserve(focusArea?: string): Promise<ObserveResult> {
  currentStage = 'observe'
  logger.info({ focus_area: focusArea }, 'Evolution OBSERVE stage starting')

  // Gather platform state
  const [healthResult, failuresResult, lessonsResult] = await Promise.allSettled([
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: 'MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC LIMIT 15',
      },
      callId: uuid(),
      timeoutMs: 10000,
    }),
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: "MATCH (f:FailureMemory) WHERE f.last_seen > datetime() - duration('P7D') RETURN f.category AS category, f.pattern AS pattern, f.hit_count AS hits ORDER BY f.hit_count DESC LIMIT 10",
      },
      callId: uuid(),
      timeoutMs: 10000,
    }),
    callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: "MATCH (l:Lesson) WHERE l.created_at > datetime() - duration('P7D') RETURN l.agent_id AS agent, l.lesson AS lesson, l.context AS context ORDER BY l.created_at DESC LIMIT 10",
      },
      callId: uuid(),
      timeoutMs: 10000,
    }),
  ])

  const healthData = healthResult.status === 'fulfilled' ? healthResult.value.result : 'unavailable'
  const failureData = failuresResult.status === 'fulfilled' ? failuresResult.value.result : 'unavailable'
  const lessonData = lessonsResult.status === 'fulfilled' ? lessonsResult.value.result : 'unavailable'

  const contextPrompt = `Analyze the current WidgeTDC platform state for autonomous evolution opportunities.
${focusArea ? `Focus area: ${focusArea}` : 'General platform assessment.'}

Graph health (node distribution): ${JSON.stringify(healthData)}
Recent failures (7d): ${JSON.stringify(failureData)}
Recent lessons (7d): ${JSON.stringify(lessonData)}

Return JSON: {"observations": ["..."], "priority_areas": ["..."], "confidence": 0.0-1.0}`

  // If RLM is available, use it for analysis
  if (isRlmAvailable()) {
    try {
      const raw = await withTimeout(
        callCognitive('analyze', {
          prompt: contextPrompt,
          context: { source: 'evolution-loop', stage: 'observe' },
          agent_id: 'evolution-loop',
        }, STAGE_TIMEOUT_MS),
        STAGE_TIMEOUT_MS,
        'OBSERVE cognitive',
      )
      const parsed = safeParseJson(raw)
      return {
        observations: Array.isArray(parsed.observations) ? parsed.observations as string[] : ['Platform state assessed via RLM'],
        priority_areas: Array.isArray(parsed.priority_areas) ? parsed.priority_areas as string[] : ['general-health'],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence as number : 0.5,
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'RLM analyze failed in OBSERVE, falling back to heuristic')
    }
  }

  // Fallback: heuristic observation
  const observations: string[] = ['Platform state collected via graph queries (RLM unavailable)']
  const priority_areas: string[] = []

  if (failureData !== 'unavailable' && Array.isArray(failureData)) {
    observations.push(`${(failureData as any[]).length} failure patterns detected in last 7 days`)
    priority_areas.push('failure-remediation')
  }
  if (focusArea) priority_areas.push(focusArea)
  if (priority_areas.length === 0) priority_areas.push('general-health')

  return { observations, priority_areas, confidence: 0.3 }
}

// ─── Stage 2: ORIENT ────────────────────────────────────────────────────────

async function stageOrient(observeResult: ObserveResult, focusArea?: string): Promise<OrientResult> {
  currentStage = 'orient'
  logger.info({ priority_areas: observeResult.priority_areas }, 'Evolution ORIENT stage starting')

  // Query Neo4j for blocks/components needing evolution
  const blocksResult = await callMcpTool({
    toolName: 'graph.read_cypher',
    args: {
      query: `MATCH (b) WHERE b:Block OR b:Assembly OR b:Pattern
        RETURN labels(b)[0] AS label, coalesce(b.name, b.title, b.id) AS name, b.status AS status, b.quality_score AS quality
        ORDER BY coalesce(b.quality_score, 0) ASC LIMIT 10`,
    },
    callId: uuid(),
    timeoutMs: 10000,
  })

  const blocks = blocksResult.status === 'success'
    ? (Array.isArray(blocksResult.result) ? blocksResult.result : (blocksResult.result as any)?.results ?? [])
    : []

  // Use RLM to create improvement plan
  if (isRlmAvailable()) {
    try {
      const planPrompt = `Create an improvement plan for WidgeTDC platform evolution.
${focusArea ? `Focus: ${focusArea}` : ''}

Observations: ${JSON.stringify(observeResult.observations)}
Priority areas: ${JSON.stringify(observeResult.priority_areas)}
Blocks needing attention: ${JSON.stringify(blocks)}

Return JSON: {"blocks_to_evolve": [{"id": "...", "label": "...", "name": "...", "reason": "..."}], "plan": "...", "estimated_impact": 0.0-1.0}`

      const raw = await withTimeout(
        callCognitive('plan', {
          prompt: planPrompt,
          context: { source: 'evolution-loop', stage: 'orient', observations: observeResult },
          agent_id: 'evolution-loop',
        }, STAGE_TIMEOUT_MS),
        STAGE_TIMEOUT_MS,
        'ORIENT cognitive',
      )

      const parsed = safeParseJson(raw)
      return {
        blocks_to_evolve: Array.isArray(parsed.blocks_to_evolve)
          ? (parsed.blocks_to_evolve as OrientResult['blocks_to_evolve'])
          : [],
        plan: typeof parsed.plan === 'string' ? parsed.plan : 'Improvement plan generated via RLM',
        estimated_impact: typeof parsed.estimated_impact === 'number' ? parsed.estimated_impact as number : 0.5,
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'RLM plan failed in ORIENT, falling back to heuristic')
    }
  }

  // Fallback: use blocks directly
  return {
    blocks_to_evolve: (blocks as any[]).slice(0, 5).map((b: any) => ({
      id: b.name ?? 'unknown',
      label: b.label ?? 'Block',
      name: b.name ?? 'unknown',
      reason: `Low quality score: ${b.quality ?? 'unscored'}`,
    })),
    plan: 'Heuristic plan: address lowest-quality blocks first',
    estimated_impact: 0.3,
  }
}

// ─── Stage 3: ACT ───────────────────────────────────────────────────────────

async function stageAct(orientResult: OrientResult, dryRun: boolean): Promise<ActResult> {
  currentStage = 'act'
  logger.info({ blocks: orientResult.blocks_to_evolve.length, dry_run: dryRun }, 'Evolution ACT stage starting')

  if (dryRun) {
    return {
      executed: 0,
      passed: 0,
      failed: 0,
      artifacts: [`DRY RUN: Would evolve ${orientResult.blocks_to_evolve.length} blocks. Plan: ${orientResult.plan}`],
    }
  }

  if (orientResult.blocks_to_evolve.length === 0) {
    return { executed: 0, passed: 0, failed: 0, artifacts: ['No blocks identified for evolution'] }
  }

  // Execute improvement chain — use adaptive mode to let the engine pick topology
  const steps = orientResult.blocks_to_evolve.slice(0, 3).map((block, i) => ({
    id: `evolve-${i}`,
    agent_id: 'orchestrator',
    cognitive_action: 'analyze' as const,
    prompt: `Analyze and suggest improvements for "${block.name}" (${block.label}). Reason: ${block.reason}. Plan: ${orientResult.plan}`,
    timeout_ms: 60000,
  }))

  try {
    const execution = await withTimeout(
      executeChain({
        name: 'Evolution Improvement Cycle',
        mode: 'sequential',
        steps,
      }),
      STAGE_TIMEOUT_MS,
      'ACT chain',
    )

    const passed = execution.results.filter(r => r.status === 'success').length
    const failed = execution.results.filter(r => r.status === 'error').length

    return {
      executed: execution.results.length,
      passed,
      failed,
      artifacts: execution.results
        .filter(r => r.status === 'success')
        .map(r => typeof r.output === 'string' ? r.output.slice(0, 200) : JSON.stringify(r.output).slice(0, 200)),
    }
  } catch (err) {
    logger.error({ err: String(err) }, 'Evolution ACT chain failed')
    return { executed: 0, passed: 0, failed: 1, artifacts: [`Chain failed: ${err}`] }
  }
}

// ─── Stage 4: LEARN ─────────────────────────────────────────────────────────

async function stageLearn(
  cycleId: string,
  observeResult: ObserveResult,
  orientResult: OrientResult,
  actResult: ActResult,
): Promise<LearnResult> {
  currentStage = 'learn'
  logger.info({ cycle_id: cycleId }, 'Evolution LEARN stage starting')

  let eventsCreated = 0
  let lessonsWritten = 0

  // Write EvolutionEvent to Neo4j (MERGE, parameterized)
  try {
    const writeResult = await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (e:EvolutionEvent {cycle_id: $cycle_id})
          SET e.timestamp = datetime(),
              e.observations = $observations,
              e.priority_areas = $priority_areas,
              e.blocks_evolved = $blocks_evolved,
              e.plan = $plan,
              e.executed = $executed,
              e.passed = $passed,
              e.failed = $failed,
              e.pass_rate = CASE WHEN $executed > 0 THEN toFloat($passed) / $executed ELSE 0.0 END,
              e.confidence = $confidence,
              e.estimated_impact = $estimated_impact`,
        params: {
          cycle_id: cycleId,
          observations: observeResult.observations.join(' | '),
          priority_areas: observeResult.priority_areas.join(', '),
          blocks_evolved: orientResult.blocks_to_evolve.map(b => b.name).join(', '),
          plan: orientResult.plan.slice(0, 500),
          executed: actResult.executed,
          passed: actResult.passed,
          failed: actResult.failed,
          confidence: observeResult.confidence,
          estimated_impact: orientResult.estimated_impact,
        },
      },
      callId: uuid(),
      timeoutMs: 15000,
    })

    if (writeResult.status === 'success') {
      eventsCreated = 1
    } else {
      logger.warn({ err: writeResult.error_message }, 'Failed to write EvolutionEvent to Neo4j')
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'EvolutionEvent write failed')
  }

  // Write lessons learned
  if (actResult.passed > 0 || actResult.failed > 0) {
    try {
      const lessonText = actResult.failed > 0
        ? `Evolution cycle ${cycleId}: ${actResult.passed}/${actResult.executed} improvements passed. Failures need attention in: ${orientResult.blocks_to_evolve.map(b => b.name).join(', ')}`
        : `Evolution cycle ${cycleId}: all ${actResult.passed} improvements passed. Areas improved: ${orientResult.blocks_to_evolve.map(b => b.name).join(', ')}`

      const lessonResult = await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `MERGE (l:Lesson {source_id: $source_id})
            SET l.agent_id = 'evolution-loop',
                l.lesson = $lesson,
                l.context = $context,
                l.created_at = datetime(),
                l.cycle_id = $cycle_id`,
          params: {
            source_id: `evolution-${cycleId}`,
            lesson: lessonText,
            context: `OODA cycle: ${observeResult.priority_areas.join(', ')}`,
            cycle_id: cycleId,
          },
        },
        callId: uuid(),
        timeoutMs: 10000,
      })

      if (lessonResult.status === 'success') {
        lessonsWritten = 1
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Lesson write failed')
    }
  }

  return { events_created: eventsCreated, lessons_written: lessonsWritten }
}

// ─── Main Entry Points ──────────────────────────────────────────────────────

export async function runEvolutionLoop(opts?: {
  focus_area?: string
  dry_run?: boolean
}): Promise<EvolutionCycleResult> {
  // Rate limiting: max 1 concurrent
  if (isRunning) {
    throw new Error('Evolution loop already running. Only 1 concurrent cycle allowed.')
  }

  isRunning = true
  const cycleId = uuid()
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const focusArea = opts?.focus_area?.slice(0, 200)
  const dryRun = opts?.dry_run ?? false

  logger.info({ cycle_id: cycleId, focus_area: focusArea, dry_run: dryRun }, 'Evolution loop starting')

  broadcastMessage({
    from: 'Orchestrator',
    to: 'All',
    source: 'orchestrator',
    type: 'Message',
    message: `Evolution loop started (cycle: ${cycleId}${focusArea ? `, focus: ${focusArea}` : ''}${dryRun ? ', DRY RUN' : ''})`,
    timestamp: new Date().toISOString(),
  })

  const cycle: EvolutionCycleResult = {
    cycle_id: cycleId,
    status: 'failed',
    summary: '',
    started_at: startedAt,
    completed_at: '',
    duration_ms: 0,
    focus_area: focusArea,
    dry_run: dryRun,
    stages: {},
  }

  // Total timeout guard — uses AbortController to cancel in-flight stages
  const abortController = new AbortController()
  const totalTimer = setTimeout(() => {
    if (isRunning) {
      logger.error({ cycle_id: cycleId }, 'Evolution loop hit total timeout (20min)')
      abortController.abort()
    }
  }, TOTAL_TIMEOUT_MS)

  try {
    const checkAbort = () => {
      if (abortController.signal.aborted) throw new Error('Evolution loop aborted: total timeout exceeded')
    }

    // Stage 1: OBSERVE
    let observeResult: ObserveResult
    const obs_t0 = Date.now()
    try {
      observeResult = await stageObserve(focusArea)
      cycle.stages.observe = { status: 'success', result: observeResult, duration_ms: Date.now() - obs_t0 }
    } catch (err) {
      cycle.stages.observe = { status: 'error', error: String(err), duration_ms: Date.now() - obs_t0 }
      throw new Error(`OBSERVE failed: ${err}`)
    }
    checkAbort()

    // Stage 2: ORIENT
    let orientResult: OrientResult
    const ori_t0 = Date.now()
    try {
      orientResult = await stageOrient(observeResult, focusArea)
      cycle.stages.orient = { status: 'success', result: orientResult, duration_ms: Date.now() - ori_t0 }
    } catch (err) {
      cycle.stages.orient = { status: 'error', error: String(err), duration_ms: Date.now() - ori_t0 }
      throw new Error(`ORIENT failed: ${err}`)
    }
    checkAbort()

    // Stage 3: ACT
    let actResult: ActResult
    const act_t0 = Date.now()
    try {
      actResult = await stageAct(orientResult, dryRun)
      cycle.stages.act = { status: 'success', result: actResult, duration_ms: Date.now() - act_t0 }
    } catch (err) {
      cycle.stages.act = { status: 'error', error: String(err), duration_ms: Date.now() - act_t0 }
      throw new Error(`ACT failed: ${err}`)
    }
    checkAbort()

    // Stage 4: LEARN (skip for dry runs)
    let learnResult: LearnResult
    const lrn_t0 = Date.now()
    if (dryRun) {
      learnResult = { events_created: 0, lessons_written: 0 }
      cycle.stages.learn = { status: 'skipped', result: learnResult, duration_ms: 0 }
    } else {
      try {
        learnResult = await stageLearn(cycleId, observeResult, orientResult, actResult)
        cycle.stages.learn = { status: 'success', result: learnResult, duration_ms: Date.now() - lrn_t0 }
      } catch (err) {
        learnResult = { events_created: 0, lessons_written: 0 }
        cycle.stages.learn = { status: 'error', error: String(err), duration_ms: Date.now() - lrn_t0 }
        // Don't throw — LEARN failure shouldn't fail the whole cycle
        logger.warn({ err: String(err) }, 'LEARN stage failed (non-fatal)')
      }
    }

    // Determine final status
    const failedStages = Object.values(cycle.stages).filter(s => s?.status === 'error').length
    cycle.status = dryRun ? 'dry_run' : failedStages === 0 ? 'completed' : 'partial'
    cycle.summary = dryRun
      ? `Dry run: ${observeResult.observations.length} observations, ${orientResult.blocks_to_evolve.length} blocks identified, plan: ${orientResult.plan.slice(0, 100)}`
      : `${actResult.passed}/${actResult.executed} improvements passed, ${learnResult.events_created} events written, ${learnResult.lessons_written} lessons captured`

  } catch (err) {
    cycle.status = 'failed'
    cycle.summary = `Evolution cycle failed: ${err instanceof Error ? err.message : String(err)}`
    logger.error({ cycle_id: cycleId, err: String(err) }, 'Evolution loop failed')
  } finally {
    clearTimeout(totalTimer)
    cycle.completed_at = new Date().toISOString()
    cycle.duration_ms = Date.now() - t0
    isRunning = false
    currentStage = undefined
    lastCycle = cycle
    totalCycles++

    await persistCycle(cycle)

    broadcastMessage({
      from: 'Orchestrator',
      to: 'All',
      source: 'orchestrator',
      type: 'Message',
      message: `Evolution loop ${cycle.status} (${cycle.duration_ms}ms): ${cycle.summary}`,
      timestamp: new Date().toISOString(),
    })

    broadcastSSE('evolution-cycle', cycle)

    logger.info({
      cycle_id: cycleId,
      status: cycle.status,
      duration_ms: cycle.duration_ms,
    }, 'Evolution loop completed')
  }

  return cycle
}

export function getEvolutionStatus(): EvolutionStatus {
  return {
    is_running: isRunning,
    current_stage: currentStage,
    last_cycle: lastCycle,
    total_cycles: totalCycles,
  }
}

export async function getEvolutionHistory(limit = 10): Promise<EvolutionCycleResult[]> {
  const redis = getRedis()
  if (!redis) return lastCycle ? [lastCycle] : []

  try {
    const raw = await redis.lrange(REDIS_HISTORY_KEY, 0, limit - 1)
    return raw.map(r => JSON.parse(r))
  } catch {
    return lastCycle ? [lastCycle] : []
  }
}
