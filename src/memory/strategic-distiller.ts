import { v4 as uuid } from 'uuid'
import { callCognitive } from '../cognitive-proxy.js'
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'

export type DistillationStrategy = 'semantic' | 'extractive' | 'hybrid'

export interface StrategicDistillInput {
  text: string
  budget: number
  strategy: DistillationStrategy
  query?: string
}

export interface StrategicDistillResult {
  folded_text: string
  memory_summary: string
  bom_components: string[]
  source_count: number
  compression_mode: 'graph_semantic' | 'graph_extractive' | 'fallback_truncate'
  graph_weight_profile: {
    pheromone_weighted: true
    top_pressure: number
    avg_pressure: number
  }
}

interface WeightedMemoryNode {
  id: string
  label: string
  summary: string
  pheromonePressure: number
  recencyScore: number
  score: number
}

interface FoldInvoke {
  prompt: string
  context: Record<string, unknown>
}

interface StrategicDistillerDeps {
  callGraph?: (cypher: string, params: Record<string, unknown>) => Promise<unknown>
  callFold?: (invoke: FoldInvoke) => Promise<string>
  isRlmReady?: () => boolean
}

const GRAPH_MEMORY_CYPHER = `
MATCH (n)
WHERE (
  n:Pheromone OR n:Pattern OR n:KnowledgePack OR exists(n.pheromone_pressure)
)
AND (
  size($tokens) = 0 OR any(token IN $tokens WHERE toLower(
    coalesce(n.title, '') + ' ' +
    coalesce(n.name, '') + ' ' +
    coalesce(n.label, '') + ' ' +
    coalesce(n.summary, '') + ' ' +
    coalesce(n.description, '') + ' ' +
    coalesce(n.rationale, '')
  ) CONTAINS token)
)
RETURN
  coalesce(n.id, toString(id(n))) AS id,
  coalesce(n.title, n.name, n.label, 'unknown') AS label,
  coalesce(n.summary, n.description, n.rationale, n.text, '') AS summary,
  coalesce(n.pheromone_pressure, 0.5) AS pheromone_pressure,
  coalesce(n.updated_at, n.updatedAt, n.last_seen_at, n.created_at, n.createdAt) AS ts
LIMIT $limit
`

const STOPWORDS = new Set([
  'the', 'and', 'that', 'with', 'from', 'this', 'have', 'will', 'would',
  'about', 'into', 'while', 'there', 'their', 'them', 'then', 'than',
  'what', 'when', 'where', 'which', 'your', 'you', 'for', 'are', 'was',
  'not', 'but', 'our', 'can', 'has', 'had', 'all', 'use', 'using',
])

function normalizePressure(input: unknown): number {
  const parsed = typeof input === 'number' ? input : parseFloat(String(input ?? '0.5'))
  if (!Number.isFinite(parsed)) return 0.5
  return Math.max(0, Math.min(1, parsed))
}

function estimateRecency(ts: unknown): number {
  if (typeof ts !== 'string' || ts.length < 8) return 0.45
  const parsed = Date.parse(ts)
  if (!Number.isFinite(parsed)) return 0.45
  const ageHours = Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60))
  if (ageHours <= 2) return 1
  if (ageHours >= 24 * 14) return 0.2
  return Math.max(0.2, 1 - (ageHours / (24 * 14)) * 0.8)
}

function extractTokens(input: StrategicDistillInput): string[] {
  const source = (input.query?.trim() || input.text.slice(0, 700)).toLowerCase()
  const tokens = source
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  return [...new Set(tokens)].slice(0, 10)
}

function parseRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { results?: unknown }).results)) {
        return (parsed as { results: Array<Record<string, unknown>> }).results
      }
      return []
    } catch {
      return []
    }
  }
  if (result && typeof result === 'object') {
    const obj = result as { results?: unknown; rows?: unknown }
    if (Array.isArray(obj.results)) return obj.results as Array<Record<string, unknown>>
    if (Array.isArray(obj.rows)) return obj.rows as Array<Record<string, unknown>>
  }
  return []
}

function buildWeightedNodes(rows: Array<Record<string, unknown>>): WeightedMemoryNode[] {
  return rows
    .map((row) => {
      const pressure = normalizePressure(row.pheromone_pressure ?? row.pressure)
      const recency = estimateRecency(row.ts ?? row.timestamp ?? row.updatedAt)
      const summary = String(row.summary ?? row.description ?? row.rationale ?? '').trim()
      return {
        id: String(row.id ?? ''),
        label: String(row.label ?? row.name ?? row.title ?? 'unknown'),
        summary,
        pheromonePressure: pressure,
        recencyScore: recency,
        score: pressure * 0.8 + recency * 0.2,
      }
    })
    .filter((node) => node.id.length > 0)
    .sort((a, b) => b.score - a.score)
}

function buildMemorySummary(nodes: WeightedMemoryNode[], maxChars: number): string {
  if (nodes.length === 0) return 'No weighted graph memory available for this context.'

  const lines: string[] = []
  for (const node of nodes.slice(0, 10)) {
    const summary = node.summary.length > 160 ? `${node.summary.slice(0, 157)}...` : node.summary
    lines.push(`- [pressure=${node.pheromonePressure.toFixed(2)} score=${node.score.toFixed(2)}] ${node.label}: ${summary || 'No summary'}`)
  }

  const joined = lines.join('\n')
  return joined.length <= maxChars ? joined : joined.slice(0, maxChars)
}

function fallbackTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * 0.58)
  const tail = Math.floor(maxChars * 0.30)
  return `${text.slice(0, head)}\n\n[...strategic-distilled...]\n\n${text.slice(-tail)}`
}

export class StrategicDistiller {
  private readonly deps: Required<StrategicDistillerDeps>

  constructor(deps?: StrategicDistillerDeps) {
    this.deps = {
      callGraph: deps?.callGraph ?? (async (cypher, params) => {
        const result = await callMcpTool({
          toolName: 'query_graph',
          args: { cypher, params },
          callId: `strategic-distiller-${uuid()}`,
          timeoutMs: 12000,
        })
        if (result.status !== 'success') {
          throw new Error(result.error_message ?? 'query_graph failed')
        }
        return result.result
      }),
      callFold: deps?.callFold ?? (async ({ prompt, context }) => {
        const result = await callCognitive('fold', { prompt, context }, 30000)
        return typeof result === 'string' ? result : JSON.stringify(result)
      }),
      isRlmReady: deps?.isRlmReady ?? (() => true),
    }
  }

  async distill(input: StrategicDistillInput): Promise<StrategicDistillResult> {
    const maxChars = Math.max(400, Math.min(input.text.length, input.budget * 4))
    const tokens = extractTokens(input)

    let weightedNodes: WeightedMemoryNode[] = []
    try {
      const raw = await this.deps.callGraph(GRAPH_MEMORY_CYPHER, { tokens, limit: 24 })
      weightedNodes = buildWeightedNodes(parseRows(raw))
    } catch (err) {
      logger.warn({ err: String(err) }, 'StrategicDistiller graph-memory lookup failed; continuing with fallback')
    }

    const memorySummary = buildMemorySummary(weightedNodes, 1800)
    const bomComponents = weightedNodes.slice(0, 8).map((node) => node.id)
    const avgPressure = weightedNodes.length > 0
      ? weightedNodes.reduce((sum, node) => sum + node.pheromonePressure, 0) / weightedNodes.length
      : 0
    const topPressure = weightedNodes[0]?.pheromonePressure ?? 0

    if (!this.deps.isRlmReady()) {
      return {
        folded_text: fallbackTruncate(input.text, maxChars),
        memory_summary: memorySummary,
        bom_components: bomComponents,
        source_count: weightedNodes.length,
        compression_mode: 'fallback_truncate',
        graph_weight_profile: {
          pheromone_weighted: true,
          top_pressure: +topPressure.toFixed(3),
          avg_pressure: +avgPressure.toFixed(3),
        },
      }
    }

    const prompt = input.query?.trim() || 'Distill this context with high semantic fidelity.'
    const folded = await this.deps.callFold({
      prompt: `${prompt}\n\nUse the weighted memory summary and keep only information necessary to reconstruct decisions and actions.`,
      context: {
        text: input.text.slice(0, 120000),
        memory_summary: memorySummary,
        bom_components: bomComponents,
        strategy: input.strategy,
        budget: input.budget,
        weighting: 'pheromone_pressure',
      },
    })

    const foldedText = (folded || '').trim()
    const compressionMode = input.strategy === 'extractive' ? 'graph_extractive' : 'graph_semantic'

    return {
      folded_text: foldedText.length > 0 ? foldedText.slice(0, maxChars) : fallbackTruncate(input.text, maxChars),
      memory_summary: memorySummary,
      bom_components: bomComponents,
      source_count: weightedNodes.length,
      compression_mode: foldedText.length > 0 ? compressionMode : 'fallback_truncate',
      graph_weight_profile: {
        pheromone_weighted: true,
        top_pressure: +topPressure.toFixed(3),
        avg_pressure: +avgPressure.toFixed(3),
      },
    }
  }
}

