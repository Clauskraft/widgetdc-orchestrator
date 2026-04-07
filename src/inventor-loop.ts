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

/** In-memory node store (persisted to Redis after each step) */
const nodes: Map<string, InventorNode> = new Map()

// ─── Redis Keys ──────────────────────────────────────────────────────────────

const REDIS_PREFIX = 'inventor:'
const nodeKey = (expName: string) => `${REDIS_PREFIX}${expName}:nodes`
const stateKey = (expName: string) => `${REDIS_PREFIX}${expName}:state`
const samplerKey = (expName: string) => `${REDIS_PREFIX}${expName}:sampler`

// ─── SSE Streaming ───────────────────────────────────────────────────────────

function stream(event: string, data: Record<string, unknown>): void {
  broadcastSSE('inventor', { event, ...data, timestamp: new Date().toISOString() })
}

// ─── Cognition Retrieval (LEARN phase) ───────────────────────────────────────

async function retrieveCognition(
  query: string,
  topK: number,
): Promise<CognitionItem[]> {
  try {
    const ragResponse = await dualChannelRAG(query, {
      maxResults: topK,
      maxHops: 2,
      forceChannels: ['graphrag', 'srag'],
    })

    return ragResponse.results.map((r, i) => ({
      id: `cog-${i}`,
      title: r.content.slice(0, 80),
      content: r.content,
      domain: [],
      source: r.source,
      score: r.score,
    }))
  } catch (err) {
    logger.warn({ error: String(err) }, 'Inventor: cognition retrieval failed')
    return []
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
  const parentContext = parentNodes.map(n =>
    `[Node ${n.id}] score=${n.score.toFixed(3)}\n  analysis: ${n.analysis.slice(0, 200)}\n  artifact preview: ${n.artifact.slice(0, 300)}`
  ).join('\n\n')

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
    const result = await callCognitiveRaw('reason', {
      prompt,
      agent_id: 'inventor-researcher',
      depth: 2,
      context: {
        parentCount: parentNodes.length,
        bestParentScore: parentNodes.length > 0 ? Math.max(...parentNodes.map(n => n.score)) : 0,
        cognitionCount: cognitionItems.length,
      },
    }, config.pipeline.engineerTimeoutMs)

    const text = String(result.answer || result.result || '')

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

    return String(analyzeResult.answer || analyzeResult.result || 'Analysis unavailable')
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

  // Store insight to cognition (via memory_store)
  if (result.success && node.analysis.length > 20) {
    try {
      await callMcpTool({
        toolName: 'memory_store',
        args: {
          agent_id: 'inventor-analyzer',
          key: `insight:${nodeId}`,
          value: node.analysis,
          metadata: { score: result.score, step: currentStep, experiment: config.experimentName },
        },
        callId: `inventor-mem-${nodeId}`,
      })
    } catch { /* non-blocking */ }
  }

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
    for (let step = currentStep; step < config.pipeline.maxSteps; step++) {
      try {
        const result = await runStep(config)
        results.push(result)
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        stream('step_error', { step: currentStep, error: lastError })
        logger.error({ step: currentStep, error: lastError }, 'Inventor: step failed')
        // Continue to next step (don't abort the whole run)
      }
    }
  } finally {
    isRunning = false
    currentConfig = null

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
