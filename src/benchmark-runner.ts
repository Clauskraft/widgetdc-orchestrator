/**
 * benchmark-runner.ts — Unified evaluation harness for Inventor vs. research baselines.
 *
 * Implements standardized benchmark tasks for validating our ASI-Evolve-inspired
 * Inventor against published research results (arXiv:2603.29640).
 *
 * Benchmark tasks:
 *   1. circle-packing   — ASI-Evolve canonical demo (sum of 26 radii, target SOTA ≈ 2.635)
 *   2. scheduler-opt    — WidgeTDC-native: minimize chain latency under cost budget
 *   3. prompt-compress  — Maximize quality-per-token ratio for folded contexts
 *   4. mmlu-lite        — Knowledge-intensive QA accuracy (100 questions)
 *
 * Ablation framework:
 *   - Runs same task with N sampling strategies (ucb1/greedy/random/island)
 *   - Fixed compute budget (rounds) for fair comparison
 *   - Outputs: best score, convergence curve, solution diversity
 *   - Statistical test: pairwise rank ordering across strategies
 */

import { getRedis } from './redis.js'
import { logger } from './logger.js'
import type { SamplingAlgorithm } from './inventor-types.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkTask {
  id: string
  name: string
  description: string
  /** ASI-Evolve paper SOTA score for comparison */
  paperBaseline?: number
  paperRounds?: number
  paperSource?: string
  /** Seed artifact / initial solution */
  initialArtifact: string
  /** Evaluator prompt that receives {artifact} and scores it 0-1 */
  evaluatorPrompt: string
  /** Task description passed to the Inventor Researcher agent */
  researcherPrompt: string
  /** Expected range [min, max] for normalisation */
  scoreRange: [number, number]
  /** Maximum rounds per run */
  defaultMaxRounds: number
  /** Tags for filtering */
  tags: string[]
}

export interface BenchmarkRun {
  runId: string
  taskId: string
  strategy: SamplingAlgorithm
  maxRounds: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: string
  completedAt?: string
  bestScore: number
  bestRound: number
  scoreHistory: number[]         // best score per round
  solutionDiversity: number      // avg pairwise embedding distance (0-1)
  totalRounds: number
  inventorExperimentName: string
  paperBaseline?: number
  gainVsBaseline?: number        // bestScore - paperBaseline
  error?: string
}

export interface AblationReport {
  taskId: string
  generatedAt: string
  strategies: Array<{
    strategy: SamplingAlgorithm
    run: BenchmarkRun
    rank: number
    convergenceRound: number     // first round reaching 90% of best score
    efficiencyScore: number      // bestScore / rounds * 100
  }>
  winner: SamplingAlgorithm
  recommendation: string
  paperBaseline?: number
  bestAchieved: number
  gapToPaper: number
}

// ─── Built-in Task Definitions ───────────────────────────────────────────────

export const BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    id: 'circle-packing',
    name: 'Circle Packing (ASI-Evolve Canonical)',
    description: 'Pack 26 non-overlapping circles of varying radii inside a unit square to maximise sum of radii. ASI-Evolve achieves SOTA ≈ 2.635 in 17 rounds.',
    paperBaseline: 2.635,
    paperRounds: 17,
    paperSource: 'arXiv:2603.29640 §4.1',
    initialArtifact: `# Circle Packing Seed — 26 circles in unit square
# Format: list of (x, y, r) — centre and radius
# Initial naive solution: uniform small circles

circles = [
  (0.1 + (i % 5) * 0.18, 0.1 + (i // 5) * 0.18, 0.07)
  for i in range(26)
]
# Sum of radii: 26 * 0.07 = 1.82 (well below SOTA 2.635)
`,
    evaluatorPrompt: `You are a precise circle-packing evaluator. Given a Python-style list of circles as (x, y, r) tuples:

1. Verify ALL constraints are satisfied:
   - All circles are within the unit square: x-r >= 0, x+r <= 1, y-r >= 0, y+r <= 1
   - No two circles overlap: for all i≠j, dist(ci, cj) >= ri + rj
   - All radii r > 0

2. If any constraint is violated, score = 0.

3. Otherwise, score = (sum of all radii) / 4.0  [normalised: SOTA 2.635 → score 0.659]

Return ONLY a JSON object: {"score": <float 0-1>, "sum_radii": <float>, "violations": <int>, "constraint_check": "<pass|fail>"}`,
    researcherPrompt: `Optimise the placement and sizing of 26 non-overlapping circles in a unit square [0,1]×[0,1] to MAXIMISE the sum of radii. Each circle: (x, y, r) with x-r≥0, x+r≤1, y-r≥0, y+r≤1 and no pairwise overlap.

Current SOTA sum_radii ≈ 2.635. Think about: hexagonal close-packing, gradient descent on positions, adaptive radii via binary search, corner and edge circles with larger radii.

Your output must be a Python code snippet that defines a variable 'circles' as a list of (x, y, r) tuples.`,
    scoreRange: [0, 1],
    defaultMaxRounds: 25,
    tags: ['canonical', 'mathematical', 'asi-evolve'],
  },
  {
    id: 'scheduler-opt',
    name: 'Chain Scheduler Optimisation (WidgeTDC-native)',
    description: 'Optimise agent chain scheduling to minimise p99 latency while staying within token budget. Ground truth from production trace data.',
    paperBaseline: undefined,
    initialArtifact: `# Chain Scheduling Strategy — initial: simple FIFO
# Parameters: queue_depth, timeout_ms, retry_policy, parallelism
strategy = {
  "queue_discipline": "fifo",
  "max_parallel": 2,
  "timeout_ms": 30000,
  "retry_on_timeout": True,
  "priority_boost": {},   # agent_id → priority multiplier
  "circuit_breaker_threshold": 5
}
# Baseline p99 latency: ~8500ms`,
    evaluatorPrompt: `You are evaluating a chain scheduling strategy for the WidgeTDC orchestrator. Given a Python dict 'strategy' defining scheduling parameters:

Score the strategy on these weighted dimensions (0-1 each):
- Latency reduction vs baseline (8500ms): score = min(1, (8500 - estimated_p99) / 4500)  [0 = worse, 1 = 4000ms or better]
- Throughput: score = min(1, max_parallel / 8)
- Fault tolerance: retry_on_timeout + circuit_breaker gives up to 0.2 each
- Resource efficiency: timeout < 25000ms gives 0.1 bonus

Return ONLY: {"score": <float 0-1>, "estimated_p99_ms": <int>, "throughput_factor": <float>, "fault_tolerance": <float>}`,
    researcherPrompt: `Optimise the WidgeTDC chain scheduling strategy to minimise p99 latency (target: < 4000ms, baseline: 8500ms) while maximising throughput and fault tolerance.

Consider: priority-based scheduling, adaptive timeouts based on task type, aggressive parallelism for independent steps, circuit breaker tuning, backpressure handling. Output a Python dict 'strategy' with scheduling parameters.`,
    scoreRange: [0, 1],
    defaultMaxRounds: 20,
    tags: ['widgetdc', 'latency', 'scheduling'],
  },
  {
    id: 'prompt-compress',
    name: 'Context Compression Quality',
    description: 'Maximise quality-retention ratio when compressing a 4K-token context to 1K tokens. Evaluated by semantic similarity + key-fact retention.',
    paperBaseline: undefined,
    initialArtifact: `# Context Compression Strategy — initial: truncation
strategy = {
  "method": "truncation",
  "target_length": 1000,
  "preserve": "end",   # keep the most recent content
  "summary_sentences": 0,
  "key_entity_extraction": False,
  "hierarchy_levels": 1
}`,
    evaluatorPrompt: `Evaluate a context compression strategy. Score on three dimensions (weighted):
- Semantic preservation (0.5 weight): does the compressed context retain main topics?
- Key-fact retention (0.3 weight): are dates, numbers, named entities preserved?
- Conciseness (0.2 weight): does it respect the token budget?

Score based on strategy sophistication:
- Pure truncation: 0.25
- Extractive summary: 0.45
- Hierarchical + entity extraction: 0.65
- Semantic clustering + distillation: 0.85

Return ONLY: {"score": <float 0-1>, "method_quality": <string>, "estimated_retention": <float>}`,
    researcherPrompt: `Design an optimal context compression strategy that maximises semantic content retention when reducing a 4000-token context to 1000 tokens.

Consider: hierarchical summarisation, key entity extraction, semantic clustering, relevance scoring, chain-of-thought distillation. Output a Python dict 'strategy' describing the compression approach.`,
    scoreRange: [0, 1],
    defaultMaxRounds: 20,
    tags: ['widgetdc', 'compression', 'rag'],
  },
]

// ─── In-memory state ─────────────────────────────────────────────────────────

const runs = new Map<string, BenchmarkRun>()
const REDIS_KEY = 'orchestrator:benchmarks'

// ─── Persistence ─────────────────────────────────────────────────────────────

async function persist(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const data = Array.from(runs.values())
  await redis.set(REDIS_KEY, JSON.stringify(data), 'EX', 86400 * 30).catch(() => {})
}

export async function loadBenchmarkRuns(): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    const raw = await redis.get(REDIS_KEY)
    if (!raw) return
    const saved: BenchmarkRun[] = JSON.parse(raw)
    for (const run of saved) runs.set(run.runId, run)
    logger.info({ count: saved.length }, '[Benchmark] Hydrated runs from Redis')
  } catch { /* non-critical */ }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function listBenchmarkTasks(): BenchmarkTask[] {
  return BENCHMARK_TASKS
}

export function getBenchmarkTask(id: string): BenchmarkTask | undefined {
  return BENCHMARK_TASKS.find(t => t.id === id)
}

export function listBenchmarkRuns(taskId?: string): BenchmarkRun[] {
  const all = Array.from(runs.values())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  return taskId ? all.filter(r => r.taskId === taskId) : all
}

export function getBenchmarkRun(runId: string): BenchmarkRun | undefined {
  return runs.get(runId)
}

/**
 * Register a benchmark run. Called by the Inventor loop hook at each step.
 */
export function upsertBenchmarkRun(run: BenchmarkRun): void {
  runs.set(run.runId, run)
  persist().catch(() => {})
}

/**
 * Start a benchmark run. Configures and launches the Inventor via REST.
 * Returns immediately — caller polls /api/benchmark/runs/:runId for progress.
 */
export async function startBenchmarkRun(
  taskId: string,
  strategy: SamplingAlgorithm,
  maxRounds?: number,
  baseUrl?: string,
  apiKey?: string,
): Promise<BenchmarkRun> {
  const task = getBenchmarkTask(taskId)
  if (!task) throw new Error(`Unknown benchmark task: ${taskId}`)

  const runId = `bench-${taskId}-${strategy}-${Date.now()}`
  const experimentName = runId

  const run: BenchmarkRun = {
    runId,
    taskId,
    strategy,
    maxRounds: maxRounds ?? task.defaultMaxRounds,
    status: 'pending',
    startedAt: new Date().toISOString(),
    bestScore: 0,
    bestRound: 0,
    scoreHistory: [],
    solutionDiversity: 0,
    totalRounds: 0,
    inventorExperimentName: experimentName,
    paperBaseline: task.paperBaseline,
  }

  runs.set(runId, run)
  await persist()

  // Launch Inventor via the REST API (fire-and-forget style — status tracked via polling)
  const url = baseUrl ?? process.env.ORCH_URL ?? 'http://localhost:3000'
  const token = apiKey ?? process.env.ORCH_API_KEY ?? 'WidgeTDC_Orch_2026'

  // Inventor is exposed via the tool gateway at /api/tools/inventor_run
  // Map InventorConfig fields → inventor_run tool parameters
  const samplingConfig = buildSamplingConfig(strategy)
  const toolPayload = {
    experiment_name: experimentName,
    task_description: `${task.researcherPrompt}\n\nBENCHMARK: ${task.id} | STRATEGY: ${strategy} | RUN: ${runId}`,
    initial_artifact: task.initialArtifact,
    sampling_algorithm: samplingConfig.algorithm,
    sample_n: samplingConfig.sampleN,
    max_steps: run.maxRounds,
  }

  fetch(`${url}/api/tools/inventor_run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(toolPayload),
    signal: AbortSignal.timeout(15_000),
  }).then(async res => {
    const body = await res.json().catch(() => null) as Record<string, unknown> | null
    if (res.ok && body?.success !== false) {
      run.status = 'running'
    } else {
      run.status = 'failed'
      const errMsg = (body?.error as Record<string, unknown> | null)?.message ?? body?.error ?? `HTTP ${res.status}`
      run.error = String(errMsg)
    }
    upsertBenchmarkRun(run)
  }).catch(err => {
    run.status = 'failed'
    run.error = String(err)
    upsertBenchmarkRun(run)
    logger.warn({ runId, err: String(err) }, '[Benchmark] Failed to launch Inventor')
  })

  return run
}

/**
 * Run ablation study: same task, all 4 sampling strategies, fixed budget.
 * Strategies are run sequentially (Inventor is single-instance).
 */
export async function startAblationStudy(
  taskId: string,
  maxRoundsPerStrategy: number = 20,
  baseUrl?: string,
  apiKey?: string,
): Promise<{ ablationId: string; runs: BenchmarkRun[] }> {
  const task = getBenchmarkTask(taskId)
  if (!task) throw new Error(`Unknown benchmark task: ${taskId}`)

  const strategies: SamplingAlgorithm[] = ['ucb1', 'greedy', 'random', 'island']
  const ablationId = `ablation-${taskId}-${Date.now()}`
  const runList: BenchmarkRun[] = []

  // Queue all runs (they will start sequentially — each waits for Inventor to be free)
  for (const strategy of strategies) {
    const run = await startBenchmarkRun(taskId, strategy, maxRoundsPerStrategy, baseUrl, apiKey)
    runList.push(run)
    // Brief pause between submissions to avoid race conditions
    await new Promise(r => setTimeout(r, 500))
  }

  // Store ablation manifest
  const redis = getRedis()
  if (redis) {
    await redis.set(`orchestrator:ablation:${ablationId}`, JSON.stringify({
      ablationId,
      taskId,
      runIds: runList.map(r => r.runId),
      maxRoundsPerStrategy,
      startedAt: new Date().toISOString(),
    }), 'EX', 86400 * 14).catch(() => {})
  }

  logger.info({ ablationId, taskId, strategies }, '[Benchmark] Ablation study launched')
  return { ablationId, runs: runList }
}

/**
 * Compute ablation report from completed runs.
 */
export function computeAblationReport(taskId: string): AblationReport | null {
  const taskRuns = listBenchmarkRuns(taskId).filter(r => r.status === 'completed')
  if (taskRuns.length < 2) return null

  const task = getBenchmarkTask(taskId)
  const strategyResults = taskRuns.map(run => {
    const convergenceRound = findConvergenceRound(run.scoreHistory, 0.9)
    const efficiencyScore = run.totalRounds > 0
      ? (run.bestScore / run.totalRounds) * 100
      : 0
    return {
      strategy: run.strategy,
      run,
      rank: 0,
      convergenceRound,
      efficiencyScore,
    }
  })

  // Rank by best score (desc)
  strategyResults.sort((a, b) => b.run.bestScore - a.run.bestScore)
  strategyResults.forEach((s, i) => { s.rank = i + 1 })

  const winner = strategyResults[0].strategy
  const bestAchieved = strategyResults[0].run.bestScore
  const paperBaseline = task?.paperBaseline
  const gapToPaper = paperBaseline != null
    ? paperBaseline - bestAchieved * (task!.scoreRange[1] - task!.scoreRange[0]) - task!.scoreRange[0]
    : 0

  const recommendation = buildRecommendation(strategyResults, taskId)

  return {
    taskId,
    generatedAt: new Date().toISOString(),
    strategies: strategyResults,
    winner,
    recommendation,
    paperBaseline,
    bestAchieved,
    gapToPaper,
  }
}

/**
 * Sync a benchmark run with the latest Inventor status.
 * Call periodically (e.g., from a cron or SSE push).
 */
export function syncRunWithInventorStatus(
  runId: string,
  inventorNodes: Array<{ score: number; createdAt: string; id: string }>,
  isRunning: boolean,
): void {
  const run = runs.get(runId)
  if (!run || run.status === 'failed') return

  const sortedByTime = [...inventorNodes].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  run.totalRounds = sortedByTime.length
  run.scoreHistory = computeScoreHistory(sortedByTime)
  run.bestScore = Math.max(...sortedByTime.map(n => n.score), 0)
  run.bestRound = findBestRound(sortedByTime)
  run.status = isRunning ? 'running' : 'completed'
  if (!isRunning && run.status === 'running') {
    run.completedAt = new Date().toISOString()
    if (run.paperBaseline != null) {
      // Denormalise score for comparison: paper uses raw sum_radii
      run.gainVsBaseline = run.bestScore - (run.paperBaseline / 4.0) // circle-packing normalised by /4
    }
  }

  upsertBenchmarkRun(run)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSamplingConfig(strategy: SamplingAlgorithm) {
  switch (strategy) {
    case 'ucb1':
      return { algorithm: 'ucb1' as const, sampleN: 3, ucb1C: 1.414 }
    case 'greedy':
      return { algorithm: 'greedy' as const, sampleN: 1, ucb1C: 0 }
    case 'random':
      return { algorithm: 'random' as const, sampleN: 3, ucb1C: 0 }
    case 'island':
      return {
        algorithm: 'island' as const,
        sampleN: 3,
        ucb1C: 1.0,
        islands: { count: 5, migrationInterval: 5, migrationRate: 0.2 },
      }
  }
}

function computeScoreHistory(
  nodes: Array<{ score: number }>,
): number[] {
  let best = 0
  return nodes.map(n => {
    if (n.score > best) best = n.score
    return best
  })
}

function findBestRound(nodes: Array<{ score: number }>): number {
  let best = 0, bestIdx = 0
  nodes.forEach((n, i) => { if (n.score > best) { best = n.score; bestIdx = i } })
  return bestIdx + 1
}

function findConvergenceRound(history: number[], threshold: number): number {
  if (history.length === 0) return 0
  const target = (history[history.length - 1] ?? 0) * threshold
  const idx = history.findIndex(s => s >= target)
  return idx >= 0 ? idx + 1 : history.length
}

function buildRecommendation(
  results: AblationReport['strategies'],
  taskId: string,
): string {
  if (results.length === 0) return 'Insufficient data.'
  const winner = results[0]
  const fastest = [...results].sort((a, b) => a.convergenceRound - b.convergenceRound)[0]
  const parts = [`${winner.strategy.toUpperCase()} achieves highest score (${(winner.run.bestScore * 100).toFixed(0)}%).`]
  if (fastest.strategy !== winner.strategy) {
    parts.push(`${fastest.strategy.toUpperCase()} converges fastest (round ${fastest.convergenceRound}).`)
    parts.push(`Use ${winner.strategy} for quality-first runs, ${fastest.strategy} for rapid exploration.`)
  } else {
    parts.push(`Use ${winner.strategy} for ${taskId} tasks.`)
  }
  return parts.join(' ')
}
