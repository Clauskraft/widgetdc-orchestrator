/**
 * quality-scorer.ts — Adaptive tool output quality scoring for the adoption flywheel.
 *
 * Replaces the hardcoded quality_score: 0.75 in chain-engine.ts with a
 * lightweight, synchronous heuristic scorer. No extra LLM calls.
 *
 * Feeds: cost-optimizer quality profiles, pheromone deposit strength,
 *        peer-eval metrics, and KnowledgeBus PRISM score estimation.
 *
 * Artifact: Inventor adoption-flywheel-v1 (score 0.80, node inv-f5202199)
 */

// ─── Tool category classification ────────────────────────────────────────────

type ToolCategory = 'graph' | 'rag' | 'linear' | 'cognitive' | 'knowledge' | 'agent' | 'generic'

function categorize(toolName: string): ToolCategory {
  if (toolName.startsWith('graph.') || toolName.startsWith('data_graph')) return 'graph'
  if (toolName.startsWith('kg_rag') || toolName.startsWith('srag') || toolName.startsWith('rag_') || toolName.startsWith('adaptive_rag') || toolName.startsWith('knowledge_')) return 'rag'
  if (toolName.startsWith('linear.') || toolName.startsWith('linear_')) return 'linear'
  if (toolName.startsWith('rlm.') || toolName.startsWith('cognitive') || toolName.startsWith('reason') || toolName.startsWith('llm_')) return 'cognitive'
  if (toolName.startsWith('knowledge') || toolName.startsWith('memory_') || toolName.startsWith('fact_')) return 'knowledge'
  if (toolName.startsWith('agent_') || toolName.startsWith('hyperagent')) return 'agent'
  return 'generic'
}

// ─── Per-category expected durations (ms) ────────────────────────────────────

const EXPECTED_DURATION: Record<ToolCategory, number> = {
  graph:     3000,
  rag:       4000,
  linear:    2000,
  cognitive: 8000,
  knowledge: 3000,
  agent:     5000,
  generic:   2000,
}

// ─── Category scorers ─────────────────────────────────────────────────────────

function scoreGraph(output: unknown): number {
  if (Array.isArray(output)) {
    if (output.length === 0) return 0.2
    // Check for rich edge/relationship data
    const hasEdges = output.some(r => typeof r === 'object' && r !== null && ('relationship' in r || 'rel' in r || 'type' in r))
    const sizeScore = Math.min(1.0, 0.3 + 0.7 * (output.length / 20))
    return hasEdges ? Math.min(1.0, sizeScore + 0.2) : sizeScore
  }
  const r = output as Record<string, unknown>
  if (Array.isArray(r?.records)) {
    const recs = r.records as unknown[]
    if (recs.length === 0) return 0.25
    return Math.min(1.0, 0.4 + 0.6 * (recs.length / 20))
  }
  if (typeof r?.nodes_created === 'number' && r.nodes_created > 0) return 0.85
  if (typeof r?.relationships_created === 'number' && r.relationships_created > 0) return 0.80
  if (r?.success === true) return 0.75
  return 0.5
}

function scoreRag(output: unknown): number {
  if (typeof output === 'string') {
    if (output.length < 50) return 0.2
    const citationCount = (output.match(/\[|\bsource\b|\bref\b/gi) ?? []).length
    const citationBonus = Math.min(0.3, citationCount * 0.05)
    return Math.min(1.0, 0.3 + 0.7 * Math.min(1, output.length / 1000) + citationBonus)
  }
  const r = output as Record<string, unknown>
  const results = Array.isArray(r?.results) ? r.results as unknown[] :
                  Array.isArray(r?.cards)   ? r.cards as unknown[]   :
                  Array.isArray(r?.entries) ? r.entries as unknown[]  : null
  if (results !== null) {
    if (results.length === 0) return 0.15
    // Check average score field
    const avgScore = results.reduce((sum, item) => {
      const s = (item as Record<string, unknown>)?.score
      return sum + (typeof s === 'number' ? s : 0.5)
    }, 0) / results.length
    return Math.min(1.0, 0.3 + 0.4 * (results.length / 10) + 0.3 * avgScore)
  }
  return 0.5
}

function scoreLinear(output: unknown): number {
  if (output === null || output === undefined) return 0.1
  const r = output as Record<string, unknown>
  // Created issue: has id/identifier
  if (r?.identifier || r?.id) return 0.9
  // List of issues
  if (Array.isArray(r?.issues)) {
    const issues = r.issues as unknown[]
    return issues.length > 0 ? Math.min(1.0, 0.5 + 0.5 * (issues.length / 10)) : 0.3
  }
  if (r?.success === true) return 0.8
  if (typeof r?.status === 'string' && r.status === 'updated') return 0.85
  return 0.5
}

function scoreCognitive(output: unknown): number {
  if (typeof output === 'string') {
    const len = output.length
    if (len < 100) return 0.3
    // Reward reasoning markers
    const depthMarkers = (output.match(/\b(because|therefore|however|furthermore|analysis|conclusion|reasoning)\b/gi) ?? []).length
    const depthBonus = Math.min(0.25, depthMarkers * 0.03)
    return Math.min(1.0, 0.4 + 0.35 * Math.min(1, len / 800) + depthBonus)
  }
  const r = output as Record<string, unknown>
  if (typeof r?.confidence === 'number') {
    return Math.min(1.0, 0.4 + 0.6 * r.confidence)
  }
  if (r?.reasoning || r?.analysis || r?.plan) return 0.75
  return 0.55
}

function scoreKnowledge(output: unknown): number {
  const r = output as Record<string, unknown>
  if (r?.tier === 'L4') return 0.95
  if (r?.tier === 'L3') return 0.80
  if (r?.tier === 'L2') return 0.60
  if (Array.isArray(r?.results) && (r.results as unknown[]).length > 0) return 0.75
  if (r?.success === true || r?.stored === true) return 0.70
  return 0.5
}

function scoreAgent(output: unknown): number {
  const r = output as Record<string, unknown>
  if (typeof r?.fitness_score === 'number') return Math.min(1.0, r.fitness_score)
  if (typeof r?.targets_completed === 'number' && r.targets_completed > 0) return 0.80
  if (r?.status === 'completed') return 0.75
  if (r?.status === 'running') return 0.60
  return 0.50
}

function scoreGeneric(output: unknown): number {
  if (output === null || output === undefined) return 0.0
  if (typeof output === 'boolean') return output ? 0.7 : 0.2
  if (typeof output === 'number') return Math.min(1.0, 0.5 + Math.abs(output) * 0.05)
  if (typeof output === 'string') {
    if (output.length === 0) return 0.1
    return Math.min(1.0, 0.4 + 0.6 * Math.min(1, output.length / 200))
  }
  if (Array.isArray(output)) {
    if (output.length === 0) return 0.2
    return Math.min(1.0, 0.4 + 0.6 * Math.min(1, output.length / 10))
  }
  const r = output as Record<string, unknown>
  if (r?.success === true || r?.ok === true) return 0.75
  if (r?.error || r?.err) return 0.15
  return 0.55
}

// ─── Main scorer ─────────────────────────────────────────────────────────────

/**
 * Score a tool call output synchronously. Returns 0.0–1.0.
 *
 * @param output    The raw output from the tool (MCP result, string, array, etc.)
 * @param toolName  The tool name (used for category lookup)
 * @param durationMs  How long the tool call took
 */
export function scoreToolOutput(output: unknown, toolName: string, durationMs: number): number {
  // Universal guards
  if (output === null || output === undefined) return 0.0
  const r = output as Record<string, unknown>
  if (typeof r === 'object' && r !== null) {
    if (r.error && r.error !== null) return 0.1
    if (typeof r.status === 'number' && r.status >= 400) return 0.2
  }

  const category = categorize(toolName)

  let base: number
  switch (category) {
    case 'graph':     base = scoreGraph(output);     break
    case 'rag':       base = scoreRag(output);       break
    case 'linear':    base = scoreLinear(output);    break
    case 'cognitive': base = scoreCognitive(output); break
    case 'knowledge': base = scoreKnowledge(output); break
    case 'agent':     base = scoreAgent(output);     break
    default:          base = scoreGeneric(output);   break
  }

  // Efficiency bonus: reward fast responses relative to category baseline
  const expected = EXPECTED_DURATION[category]
  const efficiencyRatio = Math.min(2.0, expected / Math.max(durationMs, 1))
  const efficiencyBonus = (category === 'cognitive' || category === 'rag')
    ? 0.20 * Math.min(1.0, efficiencyRatio)
    : 0.10 * Math.min(1.0, efficiencyRatio)

  // Duration penalty for very slow responses
  const durationPenalty = durationMs > 30000 ? -0.20 : durationMs > 10000 ? -0.10 : 0.0

  return Math.round(Math.max(0.0, Math.min(1.0, base + efficiencyBonus + durationPenalty)) * 1000) / 1000
}
