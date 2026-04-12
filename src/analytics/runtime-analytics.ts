/**
 * runtime-analytics.ts — Cost/token tracking + usage metrics per agent.
 *
 * Uses existing AgentResponse contract from @widgetdc/contracts/agent (Track A).
 * Tracks: cost_dkk, tokens_used, status, tool_execution, latency.
 * Data stored in Redis for fast retrieval + Neo4j for long-term trend analysis.
 *
 * Phase 4: Runtime Analytics — uses canonical AgentResponse contract.
 */
import { getRedis, isRedisEnabled } from '../redis.js'
import { logger } from '../logger.js'
import type { AgentResponse } from '@widgetdc/contracts/agent'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentMetrics {
  agent_id: string
  total_requests: number
  total_success: number
  total_failed: number
  total_partial: number
  total_tokens_input: number
  total_tokens_output: number
  total_cost_dkk: number
  avg_latency_ms: number
  last_request_at: string
  first_request_at: string
}

export interface ToolMetrics {
  tool_name: string
  call_count: number
  error_count: number
  avg_duration_ms: number
  total_duration_ms: number
  last_called_at: string
}

export interface TimeWindowMetrics {
  window_start: string
  window_end: string
  total_requests: number
  total_cost_dkk: number
  total_tokens: number
  success_rate: number
  by_agent: Record<string, AgentMetrics>
  by_tool: Record<string, ToolMetrics>
}

// ─── Redis keys ──────────────────────────────────────────────────────────────

const REDIS_METRICS_PREFIX = 'metrics:agent:'
const REDIS_TOOL_PREFIX = 'metrics:tool:'
const REDIS_AGENT_LIST = 'metrics:agents'
const REDIS_TTL = 30 * 24 * 3600 // 30 days

// ─── Agent metrics ───────────────────────────────────────────────────────────

/**
 * Record an AgentResponse into metrics tracking.
 * Extracts cost, tokens, status, and timing from the canonical response.
 */
export async function recordAgentResponse(
  response: AgentResponse,
  latencyMs: number = 0,
): Promise<void> {
  if (!isRedisEnabled()) return

  const redis = getRedis()
  if (!redis) return

  try {
    const agentKey = `${REDIS_METRICS_PREFIX}${response.agent_id}`
    const now = new Date().toISOString()

    // Atomic increment via hash
    await redis.hincrby(agentKey, 'total_requests', 1)
    if (response.status === 'success') await redis.hincrby(agentKey, 'total_success', 1)
    else if (response.status === 'failed') await redis.hincrby(agentKey, 'total_failed', 1)
    else if (response.status === 'partial') await redis.hincrby(agentKey, 'total_partial', 1)

    await redis.hincrby(agentKey, 'total_tokens_input', response.tokens_used?.input ?? 0)
    await redis.hincrby(agentKey, 'total_tokens_output', response.tokens_used?.output ?? 0)

    // Cost as integer millikroner to avoid float issues (cost_dkk * 1000)
    const costMilli = Math.round((response.cost_dkk ?? 0) * 1000)
    await redis.hincrby(agentKey, 'total_cost_milli', costMilli)

    // Latency tracking (running sum + count for avg)
    await redis.hincrby(agentKey, 'latency_sum_ms', latencyMs)
    await redis.hincrby(agentKey, 'latency_count', 1)

    // Timestamps
    await redis.hset(agentKey, 'last_request_at', now)
    await redis.hsetnx(agentKey, 'first_request_at', now) // Only set if not exists

    // Set TTL on the key
    await redis.expire(agentKey, REDIS_TTL)

    // Track this agent in the set
    await redis.sadd(REDIS_AGENT_LIST, response.agent_id)

    // Note: tool-level metrics are recorded separately via recordToolMetrics()
    // from the call site (e.g. orchestrator-adapter), keeping AgentResponse
    // contract-clean — tool_name is NOT part of @widgetdc/contracts/agent.
  } catch (err) {
    logger.warn({ err: String(err), agent_id: response.agent_id }, 'Failed to record agent response metrics')
  }
}

// ─── Tool metrics ────────────────────────────────────────────────────────────

export async function recordToolMetrics(
  toolName: string,
  durationMs: number,
  isError: boolean = false,
): Promise<void> {
  if (!isRedisEnabled()) return

  const redis = getRedis()
  if (!redis) return

  try {
    const toolKey = `${REDIS_TOOL_PREFIX}${toolName}`
    const now = new Date().toISOString()

    await redis.hincrby(toolKey, 'call_count', 1)
    if (isError) await redis.hincrby(toolKey, 'error_count', 1)
    await redis.hincrby(toolKey, 'total_duration_ms', durationMs)
    await redis.hset(toolKey, 'last_called_at', now)
    await redis.expire(toolKey, REDIS_TTL)
  } catch (err) {
    logger.warn({ err: String(err), tool: toolName }, 'Failed to record tool metrics')
  }
}

// ─── Query metrics ───────────────────────────────────────────────────────────

export async function getAgentMetrics(agentId: string): Promise<AgentMetrics | null> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return null

  try {
    const agentKey = `${REDIS_METRICS_PREFIX}${agentId}`
    const data = await redis.hgetall(agentKey)
    if (!data || Object.keys(data).length === 0) return null

    const totalRequests = parseInt(data.total_requests || '0')
    const latencySum = parseInt(data.latency_sum_ms || '0')
    const latencyCount = parseInt(data.latency_count || '0')
    const costMilli = parseInt(data.total_cost_milli || '0')

    return {
      agent_id: agentId,
      total_requests: totalRequests,
      total_success: parseInt(data.total_success || '0'),
      total_failed: parseInt(data.total_failed || '0'),
      total_partial: parseInt(data.total_partial || '0'),
      total_tokens_input: parseInt(data.total_tokens_input || '0'),
      total_tokens_output: parseInt(data.total_tokens_output || '0'),
      total_cost_dkk: costMilli / 1000,
      avg_latency_ms: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
      last_request_at: data.last_request_at ?? '',
      first_request_at: data.first_request_at ?? '',
    }
  } catch (err) {
    logger.warn({ err: String(err), agent_id: agentId }, 'Failed to get agent metrics')
    return null
  }
}

export async function getAllAgentMetrics(): Promise<AgentMetrics[]> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return []

  try {
    const agentIds = await redis.smembers(REDIS_AGENT_LIST)
    const metrics: AgentMetrics[] = []

    for (const agentId of agentIds) {
      const m = await getAgentMetrics(agentId)
      if (m) metrics.push(m)
    }

    return metrics.sort((a, b) => b.total_cost_dkk - a.total_cost_dkk)
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to get all agent metrics')
    return []
  }
}

export async function getToolMetrics(toolName: string): Promise<ToolMetrics | null> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return null

  try {
    const toolKey = `${REDIS_TOOL_PREFIX}${toolName}`
    const data = await redis.hgetall(toolKey)
    if (!data || Object.keys(data).length === 0) return null

    const callCount = parseInt(data.call_count || '0')
    const totalDuration = parseInt(data.total_duration_ms || '0')

    return {
      tool_name: toolName,
      call_count: callCount,
      error_count: parseInt(data.error_count || '0'),
      avg_duration_ms: callCount > 0 ? Math.round(totalDuration / callCount) : 0,
      total_duration_ms: totalDuration,
      last_called_at: data.last_called_at ?? '',
    }
  } catch (err) {
    logger.warn({ err: String(err), tool: toolName }, 'Failed to get tool metrics')
    return null
  }
}

export async function getTopTools(limit: number = 10): Promise<ToolMetrics[]> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return []

  try {
    // Get all tool keys
    const toolKeys = await redis.keys(`${REDIS_TOOL_PREFIX}*`)
    const tools: ToolMetrics[] = []

    for (const key of toolKeys.slice(0, 50)) { // Limit scan to avoid blocking
      const toolName = key.replace(REDIS_TOOL_PREFIX, '')
      const m = await getToolMetrics(toolName)
      if (m) tools.push(m)
    }

    return tools.sort((a, b) => b.call_count - a.call_count).slice(0, limit)
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to get top tools')
    return []
  }
}

// ─── Summary / Dashboard data ────────────────────────────────────────────────

export interface RuntimeSummary {
  total_agents: number
  total_requests: number
  total_cost_dkk: number
  total_tokens: number
  avg_success_rate: number
  top_agents: AgentMetrics[]
  top_tools: ToolMetrics[]
  generated_at: string
}

export async function getRuntimeSummary(): Promise<RuntimeSummary> {
  const agents = await getAllAgentMetrics()
  const tools = await getTopTools(10)

  const totalRequests = agents.reduce((s, a) => s + a.total_requests, 0)
  const totalCost = agents.reduce((s, a) => s + a.total_cost_dkk, 0)
  const totalTokens = agents.reduce((s, a) => s + a.total_tokens_input + a.total_tokens_output, 0)
  const totalSuccess = agents.reduce((s, a) => s + a.total_success, 0)

  return {
    total_agents: agents.length,
    total_requests: totalRequests,
    total_cost_dkk: Math.round(totalCost * 100) / 100,
    total_tokens: totalTokens,
    avg_success_rate: totalRequests > 0 ? Math.round((totalSuccess / totalRequests) * 10000) / 100 : 0,
    top_agents: agents.slice(0, 10),
    top_tools: tools,
    generated_at: new Date().toISOString(),
  }
}
