/**
 * cognitive-proxy.ts — Proxy cognitive requests to RLM Engine.
 *
 * The Orchestrator forwards deep reasoning tasks to the RLM Engine
 * (Python/FastAPI) which runs LangGraph, PDR, swarms, and context folding.
 *
 * If RLM_URL is not set, cognitive endpoints return a clear error.
 */
import { config } from './config.js'
import { logger } from './logger.js'

interface CognitiveRequest {
  prompt: string
  context?: Record<string, unknown>
  agent_id?: string
  depth?: number
  mode?: string
}

interface CognitiveResponse {
  result?: unknown
  answer?: string
  reasoning?: string
  plan?: unknown
  error?: string
}

const COGNITIVE_ROUTES: Record<string, string> = {
  reason: '/reason',
  analyze: '/cognitive/analyze',
  plan: '/cognitive/plan',
  learn: '/cognitive/learn',
  fold: '/cognitive/fold',
  enrich: '/cognitive/enrich',
}

export function isRlmAvailable(): boolean {
  return config.rlmUrl.length > 0
}

export async function callCognitive(
  action: string,
  params: CognitiveRequest,
  timeoutMs?: number,
): Promise<unknown> {
  if (!config.rlmUrl) {
    throw new Error('RLM Engine not configured (set RLM_URL)')
  }

  const path = COGNITIVE_ROUTES[action]
  if (!path) {
    throw new Error(`Unknown cognitive action: ${action}. Valid: ${Object.keys(COGNITIVE_ROUTES).join(', ')}`)
  }

  const url = `${config.rlmUrl}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 60000)

  try {
    logger.debug({ action, url, agent: params.agent_id }, 'Cognitive proxy call')

    // Build action-specific body (RLM endpoints have different schemas)
    const p = params as any
    let body: Record<string, unknown>

    if (action === 'analyze') {
      body = {
        task: p.task || params.prompt,
        context: p.context || params.prompt,
        analysis_dimensions: p.analysis_dimensions || ['general'],
        agent_id: params.agent_id,
      }
    } else if (action === 'reason') {
      body = {
        task: p.task || params.prompt,
        context: p.context || params.prompt,
        agent_id: params.agent_id,
        depth: params.depth ?? 0,
      }
    } else if (action === 'plan') {
      body = {
        task: p.task || params.prompt,
        context: p.context || params.prompt,
        constraints: p.constraints || [],
        agent_id: params.agent_id,
      }
    } else if (action === 'fold') {
      body = {
        task: p.task || params.prompt,
        context: p.context || params.prompt,
        agent_id: params.agent_id,
      }
    } else {
      // learn, enrich — try both formats
      body = {
        prompt: params.prompt,
        task: p.task || params.prompt,
        context: p.context || params.prompt,
        agent_id: params.agent_id,
        depth: params.depth ?? 0,
        mode: params.mode ?? 'standard',
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(`RLM ${action} failed: ${errText}`)
    }

    const data: CognitiveResponse = await res.json()
    return data.result ?? data.answer ?? data.reasoning ?? data.plan ?? data
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`RLM ${action} timed out after ${timeoutMs ?? 60000}ms`)
    }
    throw err
  }
}

/**
 * Get RLM Engine health status.
 */
export async function getRlmHealth(): Promise<Record<string, unknown> | null> {
  if (!config.rlmUrl) return null

  try {
    const res = await fetch(`${config.rlmUrl}/health`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { status: 'unhealthy', http_status: res.status }
    return await res.json()
  } catch {
    return { status: 'unreachable' }
  }
}
