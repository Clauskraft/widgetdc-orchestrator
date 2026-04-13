/**
 * fleet-pheromone-bridge.ts — D1: Fleet-Pheromone Bridge
 *
 * Automatically converts fleet evaluation results into pheromone deposits.
 * High scores deposit ATTRACTION, low scores deposit ALERT, improvements deposit TRAIL.
 *
 * Hook: After peer_eval_evaluate → automatically deposits pheromone
 * Impact: Existing 2,705 evals immediately create pheromone signals
 */
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FleetEvalResult {
  taskType: string
  agentId: string
  score: number           // 0-1
  latency_ms: number
  cost: number
  success: boolean
  timestamp: string
  /** Sample size for trust weighting (Uber principle: 50 evals at 0.85 > 1 eval at 0.85) */
  evalCount?: number
}

export interface PheromoneDeposit {
  type: 'ATTRACTION' | 'ALERT' | 'TRAIL' | 'EXTERNAL'
  domain: string
  intensity: number       // 0-1
  agentId: string
  metadata: Record<string, unknown>
}

// ─── Thresholds ──────────────────────────────────────────────────────────────

const ATTRACTION_THRESHOLD = 0.75    // Score >= this → deposit ATTRACTION
const ALERT_THRESHOLD = 0.4          // Score < this → deposit ALERT
const IMPROVEMENT_DELTA = 0.1        // Score improvement >= this → deposit TRAIL

// ─── Domain Mapping ──────────────────────────────────────────────────────────

/** Map task type to pheromone domain */
function taskTypeToDomain(taskType: string): string {
  const domainMap: Record<string, string> = {
    'graph.stats': 'graph-ops',
    'graph.health': 'graph-ops',
    'graph.read_cypher': 'graph-ops',
    'graph.write_cypher': 'graph-ops',
    'srag.query': 'knowledge-retrieval',
    'kg_rag.query': 'knowledge-retrieval',
    'search_knowledge': 'knowledge-retrieval',
    'reason_deeply': 'reasoning',
    'analyze': 'reasoning',
    'plan': 'reasoning',
    'context_fold': 'context-management',
    'memory_store': 'memory-ops',
    'memory_retrieve': 'memory-ops',
    'memory_search': 'memory-ops',
    'memory_consolidate': 'memory-ops',
    'inventor_run': 'evolution',
    'inventor_status': 'evolution',
    'benchmark_run': 'evaluation',
    'peer_eval_evaluate': 'fleet-learning',
    'peer_eval_fleet': 'fleet-learning',
    'capability_match': 'capability-matching',
    'compliance_gap_audit': 'compliance',
    'due_diligence': 'osint',
    'deliverable_draft': 'document-generation',
    'rag_route': 'retrieval-routing',
    'prompt_ab_test': 'prompt-optimization',
    'fact_assert': 'fact-storage',
    'fact_query': 'fact-storage',
    'agent_drift_report': 'monitoring',
    'tool_metrics': 'monitoring',
    'runtime_summary': 'monitoring',
    'pr_review_parallel': 'code-review',
    'chat_send': 'a2a-communication',
    'chat_read': 'a2a-communication',
    'pheromone_deposit': 'pheromone-ops',
    'pheromone_sense': 'pheromone-ops',
    'flywheel_consolidation': 'continuous-improvement',
    'anomaly_scan': 'anomaly-detection',
    'hyperagent_auto_run': 'autonomous-execution',
  }

  // Check exact match first
  if (domainMap[taskType]) return domainMap[taskType]

  // Check prefix match
  for (const [prefix, domain] of Object.entries(domainMap)) {
    if (taskType.startsWith(prefix)) return domain
  }

  // Fallback: use task type as domain
  return taskType
}

// ─── Cache for tracking improvements ─────────────────────────────────────────

/** Track recent scores per task type for improvement detection */
const recentScores = new Map<string, number>()
const MAX_CACHE_SIZE = 200

function getPreviousScore(taskType: string): number | null {
  return recentScores.get(taskType) ?? null
}

function updateRecentScore(taskType: string, score: number): void {
  recentScores.set(taskType, score)
  if (recentScores.size > MAX_CACHE_SIZE) {
    // Remove oldest entries (first inserted)
    const firstKey = recentScores.keys().next().value
    if (firstKey) recentScores.delete(firstKey)
  }
}

// ─── Core Bridge Logic ───────────────────────────────────────────────────────

/**
 * Convert a fleet evaluation result into pheromone deposits.
 * 
 * Rules:
 * - score >= 0.75 → ATTRACTION pheromone (intensity = score)
 * - score < 0.4   → ALERT pheromone (intensity = 1 - score)
 * - score improved by >= 0.1 → TRAIL pheromone (intensity = improvement)
 * 
 * Returns the list of deposits made.
 */
export async function processFleetEvalForPheromones(
  evalResult: FleetEvalResult,
): Promise<PheromoneDeposit[]> {
  const deposits: PheromoneDeposit[] = []
  const domain = taskTypeToDomain(evalResult.taskType)
  const previousScore = getPreviousScore(evalResult.taskType)
  
  // Update recent score cache
  updateRecentScore(evalResult.taskType, evalResult.score)

  // Rule 1: High score → ATTRACTION
  if (evalResult.score >= ATTRACTION_THRESHOLD) {
    const deposit: PheromoneDeposit = {
      type: 'ATTRACTION',
      domain,
      intensity: evalResult.score,
      agentId: evalResult.agentId,
      metadata: {
        taskType: evalResult.taskType,
        score: evalResult.score,
        latency_ms: evalResult.latency_ms,
        cost: evalResult.cost,
        source: 'fleet-pheromone-bridge',
        timestamp: evalResult.timestamp,
      },
    }
    deposits.push(deposit)
  }

  // Rule 2: Low score → ALERT
  if (evalResult.score < ALERT_THRESHOLD) {
    const deposit: PheromoneDeposit = {
      type: 'ALERT',
      domain,
      intensity: 1 - evalResult.score,
      agentId: evalResult.agentId,
      metadata: {
        taskType: evalResult.taskType,
        score: evalResult.score,
        latency_ms: evalResult.latency_ms,
        source: 'fleet-pheromone-bridge',
        timestamp: evalResult.timestamp,
        recommendation: `Avoid ${domain} domain until score improves`,
      },
    }
    deposits.push(deposit)
  }

  // Rule 3: Improvement → TRAIL
  if (previousScore !== null) {
    const improvement = evalResult.score - previousScore
    if (improvement >= IMPROVEMENT_DELTA) {
      const deposit: PheromoneDeposit = {
        type: 'TRAIL',
        domain,
        intensity: improvement,
        agentId: evalResult.agentId,
        metadata: {
          taskType: evalResult.taskType,
          previousScore,
          currentScore: evalResult.score,
          improvement,
          source: 'fleet-pheromone-bridge',
          timestamp: evalResult.timestamp,
          message: `Performance improved by ${(improvement * 100).toFixed(0)}%`,
        },
      }
      deposits.push(deposit)
    }
  }

  // Deposit pheromones via MCP
  // Contract per src/tools/tool-registry.ts: type ∈ attraction|repellent|trail|external (lowercase),
  // strength (not intensity), source (not agent_id), metadata is Record<string, number>.
  // Bridge's internal 'ALERT' type maps to 'repellent' on the wire.
  for (const deposit of deposits) {
    const wireType =
      deposit.type === 'ALERT' ? 'repellent' :
      deposit.type === 'ATTRACTION' ? 'attraction' :
      deposit.type === 'TRAIL' ? 'trail' : 'external'
    try {
      await callMcpTool({
        toolName: 'pheromone_deposit',
        args: {
          type: wireType,
          domain: deposit.domain,
          strength: deposit.intensity,
          source: deposit.agentId,
          metadata: {
            score: evalResult.score,
            latency_ms: evalResult.latency_ms,
            cost_usd: evalResult.cost,
            eval_count: evalResult.evalCount ?? 1,  // Uber trust weight
          },
          tags: ['fleet-pheromone-bridge', evalResult.taskType, deposit.type.toLowerCase(), `agent:${evalResult.agentId}`],
        },
        callId: `fleet-pheromone-${evalResult.taskType}-${Date.now()}`,
      })
      logger.info(
        { type: deposit.type, domain: deposit.domain, intensity: deposit.intensity.toFixed(2), taskType: evalResult.taskType },
        'Fleet pheromone deposited'
      )
    } catch (err) {
      logger.warn(
        { err: String(err), taskType: evalResult.taskType, type: deposit.type },
        'Failed to deposit fleet pheromone (non-critical)'
      )
    }
  }

  return deposits
}

/**
 * Process a batch of fleet evaluation results into pheromone deposits.
 * Used for backfilling historical data.
 */
export async function processFleetBatchForPheromones(
  evals: FleetEvalResult[],
): Promise<{ total: number; deposited: number; errors: number }> {
  let deposited = 0
  let errors = 0

  for (const eval_ of evals) {
    try {
      const deposits = await processFleetEvalForPheromones(eval_)
      deposited += deposits.length
    } catch {
      errors++
    }
  }

  logger.info({ total: evals.length, deposited, errors }, 'Fleet pheromone batch processing complete')
  return { total: evals.length, deposited, errors }
}

/**
 * Hook: Call this after peer_eval_evaluate to automatically deposit pheromones.
 * Designed to be non-blocking (fire-and-forget).
 */
export function fleetPheromoneHook(
  taskType: string,
  agentId: string,
  score: number,
  latency_ms: number = 0,
  cost: number = 0,
): void {
  // Fire-and-forget — don't block the evaluation
  processFleetEvalForPheromones({
    taskType,
    agentId,
    score,
    latency_ms,
    cost,
    success: score >= 0.5,
    timestamp: new Date().toISOString(),
  }).catch(err => {
    logger.warn({ err: String(err), taskType }, 'Fleet pheromone hook failed (non-critical)')
  })
}
