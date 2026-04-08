/**
 * inventor-loop.ts — Orchestrator_Inventor Core Evolution Loop
 *
 * ASI-Evolve-inspired closed-loop evolution engine that runs alongside
 * the existing Orchestrator. Each step follows:
 *   1. LEARN   — Retrieve cognition (RAG) + sample parent nodes
 *   2. DESIGN  — Researcher generates new artifact variant via RLM
 *   3. EXPERIMENT — Engineer executes & evaluates the artifact
 *   4. ANALYZE — Analyzer distills insights, stores to cognition
 *
 * Uses existing platform infrastructure:
 *   - RLM Engine for Researcher (reason) and Analyzer (analyze)
 *   - Chain Engine for Engineer execution
 *   - Dual-channel RAG for cognition retrieval
 *   - Redis for state persistence (inventor:* keyspace)
 *   - SSE for live streaming to Command Center
 */
import { v4 as uuid } from 'uuid'
import { callCognitiveRaw, isRlmAvailable } from './cognitive-proxy.js'
import { dualChannelRAG } from './dual-rag.js'
import { callMcpTool } from './mcp-caller.js'
import { getRedis } from './redis.js'
import { broadcastSSE } from './sse.js'
import { broadcastMessage } from './chat-broadcaster.js'
import { logger } from './logger.js'
import { createSampler, type Sampler } from './inventor-sampler.js'
import type {
  InventorNode, InventorConfig, InventorStatus,
  InventorStepResult, TrialResult, CognitionItem,
} from './inventor-types.js'
import { onInventorTrial } from './pheromone-layer.js'
import { hookIntoExecution } from './peer-eval.js'

// ─── State ───────────────────────────────────────────────────────────────────

let isRunning = false
let currentConfig: InventorConfig | null = null
let currentStep = 0
let bestScore = -Infinity
let bestNodeId: string | null = null
let startedAt: string | null = null
let lastStepAt: string | null = null
let lastError: string | null = null
let sampler: Sampler | null = null
let abortRequested = false

/** In-memory node store (persisted to Redis after each step) */
const nodes: Map<string, InventorNode> = new Map()

// ─── Redis Keys ──────────────────────────────────────────────────────────────

const REDIS_PREFIX = 'inventor:'
const nodeKey = (expName: string) => `${REDIS_PREFIX}${expName}:nodes`
const stateKey = (expName: string) => `${REDIS_PREFIX}${expName}:state`
const samplerKey = (expName: string) => `${REDIS_PREFIX}${expName}:sampler`
const historyKey = () => `${REDIS_PREFIX}history`

// ─── SSE Streaming ───────────────────────────────────────────────────────────

function stream(event: string, data: Record<string, unknown>): void {
  broadcastSSE('inventor', { event, ...data, timestamp: new Date().toISOString() })
}

// ─── RLM-First Tool Priority ────────────────────────────────────────────────
// The Inventor ALWAYS prioritizes RLM Engine tools (reason, analyze, plan, fold),
// Dual-channel RAG (graphrag + srag + cypher), and memory layers (memory_store,
// memory_retrieve, adaptive_rag_reward/retrain) for close cognitive collaboration.

const RLM_TOOLS = ['reason', 'analyze', 'plan', 'fold'] as const
const MEMORY_TOOLS = ['memory_store', 'memory_retrieve', 'adaptive_rag_reward', 'adaptive_rag_retrain'] as const

// ─── Cognition Retrieval (LEARN phase) ───────────────────────────────────────
// Two-channel retrieval: (1) Dual RAG (graphrag + srag) + (2) Memory layer

async function retrieveCognition(
  query: string,
  topK: number,
): Promise<CognitionItem[]> {
  const items: CognitionItem[] = []

  // Channel 1: Dual-channel RAG (graphrag + srag + cypher tri-channel)
  try {
    const ragResponse = await dualChannelRAG(query, {
      maxResults: topK,
      maxHops: 2,
      forceChannels: ['graphrag', 'srag'],
    })

    items.push(...ragResponse.results.map((r, i) => ({
      id: `rag-${i}`,
      title: r.content.slice(0, 80),
      content: r.content,
      domain: [] as string[],
      source: r.source,
      score: r.score,
    })))
  } catch (err) {
    logger.warn({ error: String(err) }, 'Inventor: RAG retrieval failed')
  }

  // Channel 2: Memory layer — retrieve prior inventor insights
  try {
    const memResult = await callMcpTool({
      toolName: 'memory_retrieve',
      args: {
        agent_id: 'inventor-analyzer',
        query,
        top_k: Math.min(topK, 5),
      },
      callId: `inventor-mem-retrieve-${Date.now()}`,
    }) as Record<string, unknown>

    const memories = Array.isArray(memResult.memories) ? memResult.memories : []
    items.push(...(memories as Array<Record<string, unknown>>).map((m, i) => ({
      id: `mem-${i}`,
      title: String(m.key || '').slice(0, 80),
      content: String(m.value || ''),
      domain: [] as string[],
      source: 'memory' as const,
      score: Number(m.score ?? 0.5),
    })))
  } catch (err) {
    logger.warn({ error: String(err) }, 'Inventor: memory retrieval failed (non-blocking)')
  }

  // Sort by score, return top-K
  return items.sort((a, b) => b.score - a.score).slice(0, topK)
}

// ─── Context Folding (RLM) ──────────────────────────────────────────────────
// Uses RLM fold endpoint to compress parent context before feeding to Researcher

async function foldParentContext(
  parentNodes: InventorNode[],
  task: string,
): Promise<string> {
  if (parentNodes.length === 0) return ''

  const rawContext = parentNodes.map(n =>
    `[Node ${n.id}] score=${n.score.toFixed(3)}\nanalysis: ${n.analysis}\nmotivation: ${n.motivation}\nartifact: ${n.artifact.slice(0, 500)}`
  ).join('\n---\n')

  // If context is small enough, skip folding
  if (rawContext.length < 2000) return rawContext

  try {
    const foldResult = await callCognitiveRaw('fold', {
      prompt: `Compress the following parent solutions into a dense summary preserving: key scores, best approaches, identified weaknesses, and actionable patterns. Task: ${task}`,
      context: { raw_context: rawContext, node_count: parentNodes.length },
      agent_id: 'inventor-folder',
    }, 15000)

    const fr = foldResult as Record<string, unknown> | null
    const folded = String(fr?.answer ?? fr?.result ?? fr?.reasoning ?? rawContext)
    logger.info({ original: rawContext.length, folded: folded.length, ratio: (folded.length / rawContext.length).toFixed(2) },
      'Inventor: context folded via RLM')
    return folded
  } catch (err) {
    logger.warn({ error: String(err) }, 'Inventor: context fold failed, using raw')
    return rawContext
  }
}

// ─── Researcher Agent (DESIGN phase) ─────────────────────────────────────────
// Uses RLM deep reasoning to generate a new artifact variant

async function runResearcher(
  task: string,
  parentNodes: InventorNode[],
  cognitionItems: CognitionItem[],
  config: InventorConfig,
): Promise<{ artifact: string; motivation: string }> {
  // RLM-first: fold parent context via RLM Engine before synthesis
  const parentContext = await foldParentContext(parentNodes, task)

  const cognitionContext = cognitionItems.map(c =>
    `[${c.source}] ${c.title}\n  ${c.content.slice(0, 200)}`
  ).join('\n\n')

  const prompt = `You are the Researcher agent in an evolutionary AI system.

TASK: ${task}

PARENT SOLUTIONS (sampled via ${config.sampling.algorithm}):
${parentContext || '(no parents yet — generate an initial solution)'}

RELEVANT KNOWLEDGE (from RAG):
${cognitionContext || '(no prior knowledge available)'}

Generate a NEW solution that improves on the best parent.
- If parents exist, create a variation that addresses their weaknesses
- If no parents, generate an initial high-quality solution
- Max artifact length: ${config.pipeline.maxArtifactLength} characters

Respond in JSON format:
{
  "motivation": "Why this variation should improve on parents...",
  "artifact": "The complete solution code/config..."
}`

  try {
    // Retry up to 3 attempts with backoff to handle cold-start transient failures
    let result = null
    let lastRlmErr: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const delayMs = 3000 * attempt
        logger.warn({ attempt, delayMs }, 'Inventor: researcher retrying after RLM null response')
        await new Promise(r => setTimeout(r, delayMs))
      }
      result = await callCognitiveRaw('reason', {
        prompt,
        agent_id: 'inventor-researcher',
        depth: 2,
        context: {
          parentCount: parentNodes.length,
          bestParentScore: parentNodes.length > 0 ? Math.max(...parentNodes.map(n => n.score)) : 0,
          cognitionCount: cognitionItems.length,
        },
      }, config.pipeline.engineerTimeoutMs)
      if (result) break
      lastRlmErr = new Error('RLM returned null (non-OK response)')
    }

    if (!result) throw lastRlmErr ?? new Error('RLM returned null after 3 attempts')

    // Defensive extraction — RLM response structure varies by version
    const r = result as Record<string, unknown>
    const text = String(
      r.answer ?? r.result ?? r.reasoning ?? r.plan ??
      (r.analysis && typeof r.analysis === 'object' ? JSON.stringify(r.analysis) : '') ??
      (r.content ?? '')
    )

    if (!text) {
      logger.warn({ resultKeys: Object.keys(r) }, 'Inventor: researcher got empty text from RLM')
      throw new Error(`RLM returned no usable text (keys: ${Object.keys(r).join(', ')})`)
    }

    // Try to parse JSON response
    try {
      const jsonMatch = text.match(/\{[\s\S]*"artifact"[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          artifact: String(parsed.artifact || '').slice(0, config.pipeline.maxArtifactLength),
          motivation: String(parsed.motivation || 'No motivation provided'),
        }
      }
    } catch { /* fall through to raw text */ }

    return {
      artifact: text.slice(0, config.pipeline.maxArtifactLength),
      motivation: 'Generated via RLM reasoning (raw output)',
    }
  } catch (err) {
    throw new Error(`Researcher failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ─── Engineer Agent (EXPERIMENT phase) ────────────────────────────────────────
// Executes the artifact and collects metrics

async function runEngineer(
  node: InventorNode,
  config: InventorConfig,
): Promise<TrialResult> {
  const t0 = Date.now()

  try {
    // Use critique_refine to evaluate the artifact quality
    const result = await callMcpTool({
      toolName: 'critique_refine',
      args: {
        content: node.artifact,
        criteria: `Evaluate this solution for: ${config.taskDescription}. Score 0-100 on: correctness, efficiency, elegance, completeness.`,
        mode: 'evaluate',
      },
      callId: `inventor-eng-${node.id}`,
    })

    const resultObj = (typeof result === 'object' && result !== null) ? result as Record<string, unknown> : {}
    const score = Number(resultObj.score ?? resultObj.overall_score ?? 50) / 100
    const metrics: Record<string, number> = {
      correctness: Number(resultObj.correctness ?? 0.5),
      efficiency: Number(resultObj.efficiency ?? 0.5),
      elegance: Number(resultObj.elegance ?? 0.5),
      completeness: Number(resultObj.completeness ?? 0.5),
    }

    return {
      nodeId: node.id,
      success: score > 0.3,
      score,
      metrics,
      output: JSON.stringify(resultObj).slice(0, 2000),
      durationMs: Date.now() - t0,
      tokensUsed: 0,
    }
  } catch (err) {
    return {
      nodeId: node.id,
      success: false,
      score: 0,
      metrics: {},
      output: '',
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
      tokensUsed: 0,
    }
  }
}

// ─── Analyzer Agent (ANALYZE phase) ──────────────────────────────────────────
// Distills insights from trial results

async function runAnalyzer(
  node: InventorNode,
  result: TrialResult,
  parentNode: InventorNode | null,
  config: InventorConfig,
): Promise<string> {
  try {
    const analyzeResult = await callCognitiveRaw('analyze', {
      prompt: `Analyze this evolutionary trial result.

TASK: ${config.taskDescription}
TRIAL NODE: ${node.id} (score: ${result.score.toFixed(3)})
PARENT: ${parentNode ? `${parentNode.id} (score: ${parentNode.score.toFixed(3)})` : 'none (seed)'}
MOTIVATION: ${node.motivation}
SUCCESS: ${result.success}
METRICS: ${JSON.stringify(result.metrics)}

Provide:
1. Why this solution scored as it did
2. What the key improvement/regression was vs parent
3. One actionable insight for the next iteration`,
      agent_id: 'inventor-analyzer',
    }, 15000)

    const ar = analyzeResult as Record<string, unknown> | null
    return String(ar?.answer ?? ar?.result ?? ar?.reasoning ?? 'Analysis unavailable')
  } catch {
    return `Score: ${result.score.toFixed(3)}. ${result.success ? 'Passed' : 'Failed'}. ${result.error || ''}`
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function persistNodes(experimentName: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  const data = JSON.stringify([...nodes.values()])
  await redis.set(nodeKey(experimentName), data).catch(() => {})
}

async function persistState(experimentName: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  const state = {
    currentStep,
    bestScore,
    bestNodeId,
    startedAt,
    lastStepAt,
    lastError,
  }
  await redis.set(stateKey(experimentName), JSON.stringify(state)).catch(() => {})

  if (sampler) {
    await redis.set(samplerKey(experimentName), JSON.stringify(sampler.getState())).catch(() => {})
  }
}

async function loadState(experimentName: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false

  try {
    const nodesRaw = await redis.get(nodeKey(experimentName))
    if (nodesRaw) {
      const parsed = JSON.parse(nodesRaw) as InventorNode[]
      nodes.clear()
      for (const n of parsed) nodes.set(n.id, n)
    }

    const stateRaw = await redis.get(stateKey(experimentName))
    if (stateRaw) {
      const state = JSON.parse(stateRaw)
      currentStep = state.currentStep || 0
      bestScore = state.bestScore ?? -Infinity
      bestNodeId = state.bestNodeId || null
      startedAt = state.startedAt || null
      lastStepAt = state.lastStepAt || null
      lastError = state.lastError || null
    }

    if (sampler) {
      const samplerRaw = await redis.get(samplerKey(experimentName))
      if (samplerRaw) sampler.loadState(JSON.parse(samplerRaw))
    }

    return nodes.size > 0
  } catch {
    return false
  }
}

// ─── Single Evolution Step ───────────────────────────────────────────────────

async function runStep(config: InventorConfig): Promise<InventorStepResult> {
  currentStep++
  const stepId = `step-${currentStep}`
  const t0 = Date.now()

  stream('step_start', { step: currentStep, maxSteps: config.pipeline.maxSteps })

  // ── 1. LEARN: Sample parents + retrieve cognition ──
  const allNodes = [...nodes.values()].filter(n => n.status === 'completed')
  const parentNodes = sampler?.sample(allNodes, config.sampling.sampleN) ?? []

  const cognitionQuery = parentNodes.length > 0
    ? `${config.taskDescription}. Best approach: ${parentNodes[0].analysis.slice(0, 200)}`
    : config.taskDescription

  const cognitionItems = await retrieveCognition(cognitionQuery, config.cognition.topK)

  stream('learn', {
    step: currentStep,
    parentCount: parentNodes.length,
    cognitionCount: cognitionItems.length,
    bestParentScore: parentNodes.length > 0 ? Math.max(...parentNodes.map(n => n.score)) : null,
  })

  // ── 2. DESIGN: Researcher generates new artifact ──
  stream('design', { step: currentStep })
  const { artifact, motivation } = await runResearcher(
    config.taskDescription, parentNodes, cognitionItems, config,
  )

  // Create node
  const nodeId = `inv-${uuid().slice(0, 8)}`
  const parentId = parentNodes.length > 0 ? parentNodes[0].id : null
  const node: InventorNode = {
    id: nodeId,
    parentId,
    artifact,
    taskDescription: config.taskDescription,
    score: 0,
    metrics: {},
    analysis: '',
    motivation,
    island: parentNodes.length > 0 ? parentNodes[0].island : 0,
    visitCount: 0,
    chainMode: config.chainMode || 'sequential',
    createdAt: new Date().toISOString(),
    status: 'running',
  }

  nodes.set(nodeId, node)

  // ── 3. EXPERIMENT: Engineer executes ──
  stream('experiment', { step: currentStep, nodeId })
  const result = await runEngineer(node, config)

  node.score = result.score
  node.metrics = result.metrics
  node.status = result.success ? 'completed' : 'failed'

  // ── 4. ANALYZE: Analyzer distills insights ──
  stream('analyze', { step: currentStep, nodeId, score: result.score })
  const parentNode = parentId ? nodes.get(parentId) ?? null : null
  node.analysis = await runAnalyzer(node, result, parentNode, config)

  // Register with sampler
  if (sampler) sampler.onNodeAdded(node)

  // ── Pheromone + PeerEval: deposit trail + evaluate trial ──
  onInventorTrial(nodeId, result.score, config.experimentName, node.island).catch(() => {})
  hookIntoExecution('inventor', nodeId, {
    taskType: `inventor-trial:${config.experimentName}`,
    chainId: config.experimentName,
    success: result.success,
    metrics: {
      latency_ms: Date.now() - t0,
      quality_score: result.score,
    },
    insights: node.analysis ? [node.analysis.slice(0, 200)] : [],
  }).catch(() => {})

  // Update best
  if (result.score > bestScore) {
    bestScore = result.score
    bestNodeId = nodeId
    stream('new_best', { step: currentStep, nodeId, score: result.score })
  }

  lastStepAt = new Date().toISOString()

  // Persist
  await persistNodes(config.experimentName)
  await persistState(config.experimentName)

  // ── RLM Memory Layer: always store insights (not just success) ──
  if (node.analysis.length > 20) {
    try {
      await callMcpTool({
        toolName: 'memory_store',
        args: {
          agent_id: 'inventor-analyzer',
          key: `insight:${nodeId}`,
          value: `[${result.success ? 'SUCCESS' : 'FAIL'}:${result.score.toFixed(3)}] ${node.analysis}`,
          metadata: {
            score: result.score,
            success: result.success,
            step: currentStep,
            experiment: config.experimentName,
            parentId: parentId || 'seed',
            island: node.island,
          },
        },
        callId: `inventor-mem-${nodeId}`,
      })
    } catch { /* non-blocking */ }
  }

  // ── RAG Feedback Loop: reward adaptive RAG with trial outcome ──
  try {
    await callMcpTool({
      toolName: 'adaptive_rag_reward',
      args: {
        query: config.taskDescription,
        reward: result.score,
        metadata: {
          source: 'inventor',
          nodeId,
          step: currentStep,
          experiment: config.experimentName,
        },
      },
      callId: `inventor-rag-reward-${nodeId}`,
    })
  } catch { /* non-blocking */ }

  const stepResult: InventorStepResult = {
    stepNumber: currentStep,
    nodeId,
    parentId,
    score: result.score,
    bestScore,
    analysis: node.analysis.slice(0, 300),
    durationMs: Date.now() - t0,
  }

  stream('step_complete', { ...stepResult })
  return stepResult
}

// ─── Main Run ────────────────────────────────────────────────────────────────

export async function runInventor(
  config: InventorConfig,
  resume = false,
): Promise<{ steps: InventorStepResult[]; bestScore: number; bestNodeId: string | null }> {
  if (isRunning) throw new Error('Inventor already running')

  isRunning = true
  currentConfig = config
  startedAt = new Date().toISOString()
  lastError = null
  const results: InventorStepResult[] = []

  // Initialize sampler
  sampler = createSampler({
    algorithm: config.sampling.algorithm,
    ucb1C: config.sampling.ucb1C,
    islands: config.sampling.islands,
  })

  // Resume or fresh start
  if (resume) {
    const loaded = await loadState(config.experimentName)
    if (loaded) {
      logger.info({ experiment: config.experimentName, nodes: nodes.size, step: currentStep },
        'Inventor: resumed from Redis')
    }
  } else {
    nodes.clear()
    currentStep = 0
    bestScore = -Infinity
    bestNodeId = null
  }

  stream('run_start', {
    experiment: config.experimentName,
    maxSteps: config.pipeline.maxSteps,
    sampling: config.sampling.algorithm,
    resumed: resume && nodes.size > 0,
  })

  // Seed with initial artifact if provided and not resuming
  if (config.initialArtifact && nodes.size === 0) {
    const seedNode: InventorNode = {
      id: `inv-seed-${uuid().slice(0, 8)}`,
      parentId: null,
      artifact: config.initialArtifact,
      taskDescription: config.taskDescription,
      score: 0,
      metrics: {},
      analysis: 'Initial seed artifact',
      motivation: 'Seed solution provided by user',
      island: 0,
      visitCount: 0,
      chainMode: config.chainMode || 'sequential',
      createdAt: new Date().toISOString(),
      status: 'completed',
    }

    // Evaluate seed
    const seedResult = await runEngineer(seedNode, config)
    seedNode.score = seedResult.score
    seedNode.metrics = seedResult.metrics
    seedNode.status = seedResult.success ? 'completed' : 'failed'
    nodes.set(seedNode.id, seedNode)
    if (sampler) sampler.onNodeAdded(seedNode)

    if (seedResult.score > bestScore) {
      bestScore = seedResult.score
      bestNodeId = seedNode.id
    }

    stream('seed', { nodeId: seedNode.id, score: seedResult.score })
  }

  try {
    // Run evolution steps
    const RAG_RETRAIN_INTERVAL = 5 // Retrain adaptive RAG every 5 steps
    for (let step = currentStep; step < config.pipeline.maxSteps; step++) {
      // Check abort flag
      if (abortRequested) {
        logger.info({ step: currentStep }, 'Inventor: abort requested — stopping gracefully')
        stream('abort', { step: currentStep, reason: 'User requested stop' })
        break
      }

      try {
        const result = await runStep(config)
        results.push(result)

        // Periodic RAG retrain: keep adaptive RAG weights learning from inventor trials
        if (currentStep % RAG_RETRAIN_INTERVAL === 0) {
          try {
            await callMcpTool({
              toolName: 'adaptive_rag_retrain',
              args: { source: 'inventor', reason: `Inventor step ${currentStep} periodic retrain` },
              callId: `inventor-rag-retrain-${currentStep}`,
            })
            stream('rag_retrain', { step: currentStep })
            logger.info({ step: currentStep }, 'Inventor: adaptive RAG retrained')
          } catch { /* non-blocking */ }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        stream('step_error', { step: currentStep, error: lastError })
        logger.error({ step: currentStep, error: lastError }, 'Inventor: step failed')
        // Continue to next step (don't abort the whole run)
      }
    }
  } finally {
    // Persist to experiment history
    try {
      const redis = getRedis()
      if (redis) {
        const historyEntry = JSON.stringify({
          experimentName: currentConfig?.experimentName ?? 'unnamed',
          taskDescription: currentConfig?.taskDescription ?? '',
          status: abortRequested ? 'aborted' : 'completed',
          steps: results.length,
          maxSteps: currentConfig?.pipeline.maxSteps ?? 0,
          nodesCreated: nodes.size,
          bestScore: bestScore === -Infinity ? 0 : bestScore,
          bestNodeId,
          samplingAlgorithm: currentConfig?.sampling.algorithm ?? 'ucb1',
          chainMode: currentConfig?.chainMode ?? 'sequential',
          startedAt,
          completedAt: new Date().toISOString(),
          aborted: abortRequested,
        })
        await redis.lpush(historyKey(), historyEntry)
        await redis.ltrim(historyKey(), 0, 49) // Keep last 50 experiments
      }
    } catch (histErr) {
      logger.error({ error: histErr }, 'Inventor: failed to persist history')
    }

    isRunning = false
    currentConfig = null
    abortRequested = false

    stream('run_complete', {
      totalSteps: results.length,
      bestScore,
      bestNodeId,
      nodesCreated: nodes.size,
    })

    // Broadcast completion
    broadcastMessage({
      from: 'Inventor',
      to: 'All',
      source: 'orchestrator',
      type: 'Message',
      message: `Evolution complete: ${results.length} steps, best score ${bestScore.toFixed(3)} (node ${bestNodeId})`,
    } as Record<string, unknown>)
  }

  return { steps: results, bestScore, bestNodeId }
}

// ─── Status ──────────────────────────────────────────────────────────────────

export function getInventorStatus(): InventorStatus {
  return {
    isRunning,
    experimentName: currentConfig?.experimentName ?? '',
    currentStep,
    totalSteps: currentConfig?.pipeline.maxSteps ?? 0,
    nodesCreated: nodes.size,
    bestScore: bestScore === -Infinity ? 0 : bestScore,
    bestNodeId,
    samplingAlgorithm: currentConfig?.sampling.algorithm ?? 'ucb1',
    startedAt,
    lastStepAt,
    lastError,
  }
}

// ─── Getters ─────────────────────────────────────────────────────────────────

export function getInventorNodes(): InventorNode[] {
  return [...nodes.values()]
}

export function getInventorNode(id: string): InventorNode | undefined {
  return nodes.get(id)
}

export function getBestNode(): InventorNode | undefined {
  return bestNodeId ? nodes.get(bestNodeId) : undefined
}

export function stopInventor(): { success: boolean; message: string } {
  if (!isRunning) return { success: false, message: 'No experiment is currently running' }
  abortRequested = true
  logger.info('Inventor: stop requested — will halt after current step completes')
  return { success: true, message: `Stopping experiment "${currentConfig?.experimentName ?? ''}" after step ${currentStep}` }
}

export async function getExperimentHistory(limit = 20): Promise<Array<Record<string, unknown>>> {
  const redis = getRedis()
  if (!redis) return []
  try {
    const entries = await redis.lrange(historyKey(), 0, limit - 1)
    return entries.map(e => JSON.parse(e))
  } catch {
    return []
  }
}
