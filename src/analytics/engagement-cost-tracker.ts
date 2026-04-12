/**
 * engagement-cost-tracker.ts — Per-engagement cost attribution.
 *
 * V3: "Hvilket engagement brugte hvilken agent — hvor meget kostede det?"
 *
 * Rolls up agent_metrics by engagement_id to produce DKK cost reports.
 * Uses existing Redis metrics + Neo4j :CostReport nodes.
 *
 * Constraints:
 * - MERGE idempotency on :CostReport nodes (Gate 2)
 * - AgentResponse wire format
 */
import { getRedis, isRedisEnabled } from '../redis.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import type { AgentRequest, AgentResponse } from '@widgetdc/contracts/agent'
import { agentSuccess, agentFailure } from '../agent/agent-interface.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EngagementCostEntry {
  agent_id: string
  requests: number
  tokens_input: number
  tokens_output: number
  cost_dkk: number
  avg_latency_ms: number
  success_rate: number
  first_seen: string
  last_seen: string
}

export interface EngagementCostReport {
  report_id: string
  engagement_id: string
  generated_at: string
  total_cost_dkk: number
  total_tokens: number
  total_requests: number
  avg_success_rate: number
  by_agent: EngagementCostEntry[]
  by_tool: Record<string, { calls: number; cost_dkk: number; avg_ms: number }>
  cost_breakdown: {
    compute_dkk: number
    storage_dkk: number
    overhead_dkk: number
  }
}

// ─── Redis keys ──────────────────────────────────────────────────────────────

const REDIS_ENGAGEMENT_PREFIX = 'engagement:'
const REDIS_ENGAGEMENT_INDEX = 'engagements:index'
const REDIS_TTL = 365 * 24 * 3600 // 1 year

// ─── MCP helper ──────────────────────────────────────────────────────────────

async function mcpCall(tool: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
    },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(15000),
  })
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return data?.result ?? data
}

// ─── Cost Tracking ───────────────────────────────────────────────────────────

/**
 * Record a cost entry for an engagement.
 * Call this after each agent request to accumulate costs.
 */
export async function recordEngagementCost(
  engagementId: string,
  agentId: string,
  costDkk: number,
  tokensInput: number,
  tokensOutput: number,
  latencyMs: number,
  success: boolean,
  toolName?: string,
): Promise<void> {
  if (!isRedisEnabled()) return

  const redis = getRedis()
  if (!redis) return

  try {
    const engKey = `${REDIS_ENGAGEMENT_PREFIX}${engagementId}`
    const agentKey = `${engKey}:agent:${agentId}`
    const now = new Date().toISOString()
    const costMilli = Math.round(costDkk * 1000)

    // Increment engagement totals
    await redis.hincrby(engKey, 'total_cost_milli', costMilli)
    await redis.hincrby(engKey, 'total_tokens_input', tokensInput)
    await redis.hincrby(engKey, 'total_tokens_output', tokensOutput)
    await redis.hincrby(engKey, 'total_requests', 1)
    await redis.hincrby(engKey, 'latency_sum_ms', latencyMs)
    if (success) await redis.hincrby(engKey, 'success_count', 1)
    await redis.hset(engKey, 'last_seen', now)
    await redis.hsetnx(engKey, 'first_seen', now)
    await redis.expire(engKey, REDIS_TTL)

    // Track engagement in index
    await redis.sadd(REDIS_ENGAGEMENT_INDEX, engagementId)

    // Per-agent tracking
    await redis.hincrby(agentKey, 'requests', 1)
    await redis.hincrby(agentKey, 'cost_milli', costMilli)
    await redis.hincrby(agentKey, 'tokens_input', tokensInput)
    await redis.hincrby(agentKey, 'tokens_output', tokensOutput)
    await redis.hincrby(agentKey, 'latency_sum_ms', latencyMs)
    if (success) await redis.hincrby(agentKey, 'success_count', 1)
    await redis.hset(agentKey, 'last_seen', now)
    await redis.hsetnx(agentKey, 'first_seen', now)
    await redis.expire(agentKey, REDIS_TTL)

    // Per-tool tracking (optional)
    if (toolName) {
      const toolKey = `${engKey}:tool:${toolName}`
      await redis.hincrby(toolKey, 'calls', 1)
      await redis.hincrby(toolKey, 'cost_milli', costMilli)
      await redis.hincrby(toolKey, 'latency_sum_ms', latencyMs)
      await redis.expire(toolKey, REDIS_TTL)
    }
  } catch (err) {
    logger.warn({ err: String(err), engagement_id: engagementId }, 'Failed to record engagement cost')
  }
}

/**
 * Generate a cost report for a specific engagement.
 */
export async function getEngagementCostReport(engagementId: string): Promise<EngagementCostReport | null> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return null

  try {
    const engKey = `${REDIS_ENGAGEMENT_PREFIX}${engagementId}`
    const data = await redis.hgetall(engKey)
    if (!data || Object.keys(data).length === 0) return null

    const totalCostMilli = parseInt(data.total_cost_milli || '0')
    const totalTokensInput = parseInt(data.total_tokens_input || '0')
    const totalTokensOutput = parseInt(data.total_tokens_output || '0')
    const totalRequests = parseInt(data.total_requests || '0')
    const successCount = parseInt(data.success_count || '0')
    const latencySum = parseInt(data.latency_sum_ms || '0')

    // Get per-agent breakdown
    const agentKeys = await redis.keys(`${engKey}:agent:*`)
    const byAgent: EngagementCostEntry[] = []

    for (const aKey of agentKeys) {
      const agentId = aKey.replace(`${engKey}:agent:`, '')
      const aData = await redis.hgetall(aKey)
      const aRequests = parseInt(aData.requests || '0')
      const aSuccess = parseInt(aData.success_count || '0')
      const aLatencySum = parseInt(aData.latency_sum_ms || '0')
      const aCostMilli = parseInt(aData.cost_milli || '0')

      byAgent.push({
        agent_id: agentId,
        requests: aRequests,
        tokens_input: parseInt(aData.tokens_input || '0'),
        tokens_output: parseInt(aData.tokens_output || '0'),
        cost_dkk: aCostMilli / 1000,
        avg_latency_ms: aRequests > 0 ? Math.round(aLatencySum / aRequests) : 0,
        success_rate: aRequests > 0 ? Math.round((aSuccess / aRequests) * 10000) / 100 : 0,
        first_seen: aData.first_seen ?? '',
        last_seen: aData.last_seen ?? '',
      })
    }

    // Get per-tool breakdown
    const toolKeys = await redis.keys(`${engKey}:tool:*`)
    const byTool: Record<string, { calls: number; cost_dkk: number; avg_ms: number }> = {}

    for (const tKey of toolKeys) {
      const toolName = tKey.replace(`${engKey}:tool:`, '')
      const tData = await redis.hgetall(tKey)
      const tCalls = parseInt(tData.calls || '0')
      const tCostMilli = parseInt(tData.cost_milli || '0')
      const tLatencySum = parseInt(tData.latency_sum_ms || '0')

      byTool[toolName] = {
        calls: tCalls,
        cost_dkk: tCostMilli / 1000,
        avg_ms: tCalls > 0 ? Math.round(tLatencySum / tCalls) : 0,
      }
    }

    // Sort agents by cost descending
    byAgent.sort((a, b) => b.cost_dkk - a.cost_dkk)

    const totalCost = totalCostMilli / 1000
    // Simple breakdown: 80% compute, 15% storage, 5% overhead
    const computeCost = totalCost * 0.80
    const storageCost = totalCost * 0.15
    const overheadCost = totalCost * 0.05

    return {
      report_id: `cost-${engagementId}-${Date.now().toString(36)}`,
      engagement_id: engagementId,
      generated_at: new Date().toISOString(),
      total_cost_dkk: Math.round(totalCost * 100) / 100,
      total_tokens: totalTokensInput + totalTokensOutput,
      total_requests: totalRequests,
      avg_success_rate: totalRequests > 0 ? Math.round((successCount / totalRequests) * 10000) / 100 : 0,
      by_agent: byAgent,
      by_tool: byTool,
      cost_breakdown: {
        compute_dkk: Math.round(computeCost * 100) / 100,
        storage_dkk: Math.round(storageCost * 100) / 100,
        overhead_dkk: Math.round(overheadCost * 100) / 100,
      },
    }
  } catch (err) {
    logger.warn({ err: String(err), engagement_id: engagementId }, 'Failed to generate engagement cost report')
    return null
  }
}

/**
 * List all tracked engagements.
 */
export async function listEngagements(): Promise<Array<{ engagement_id: string; total_cost_dkk: number; total_requests: number }>> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return []

  try {
    const ids = await redis.smembers(REDIS_ENGAGEMENT_INDEX)
    const engagements: Array<{ engagement_id: string; total_cost_dkk: number; total_requests: number }> = []

    for (const id of ids.slice(0, 100)) {
      const data = await redis.hgetall(`${REDIS_ENGAGEMENT_PREFIX}${id}`)
      if (data && Object.keys(data).length > 0) {
        engagements.push({
          engagement_id: id,
          total_cost_dkk: Math.round((parseInt(data.total_cost_milli || '0') / 1000) * 100) / 100,
          total_requests: parseInt(data.total_requests || '0'),
        })
      }
    }

    return engagements.sort((a, b) => b.total_cost_dkk - a.total_cost_dkk)
  } catch {
    return []
  }
}

/**
 * Persist cost report to Neo4j as :CostReport node (MERGE idempotent).
 */
export async function persistCostReport(report: EngagementCostReport): Promise<void> {
  try {
    await mcpCall('graph.write_cypher', {
      query: `MERGE (c:CostReport {report_id: $report_id})
              SET c.engagement_id = $engagement_id, c.total_cost_dkk = $total_cost_dkk,
                  c.total_tokens = $total_tokens, c.total_requests = $total_requests,
                  c.avg_success_rate = $avg_success_rate,
                  c.generated_at = datetime(), c.createdAt = COALESCE(c.createdAt, datetime())`,
      params: {
        report_id: report.report_id,
        engagement_id: report.engagement_id,
        total_cost_dkk: report.total_cost_dkk,
        total_tokens: report.total_tokens,
        total_requests: report.total_requests,
        avg_success_rate: report.avg_success_rate,
      },
    })
  } catch (err) {
    logger.warn({ err: String(err), report_id: report.report_id }, 'Failed to persist cost report to Neo4j (non-fatal)')
  }
}

// ─── MCP Tool Handler ────────────────────────────────────────────────────────

/**
 * Process an AgentRequest to generate an engagement cost report.
 * Input: engagement_id in request.context.engagement_id
 * Output: AgentResponse with cost report
 */
export async function handleEngagementCostReport(request: AgentRequest): Promise<AgentResponse> {
  try {
    const engagementId = typeof request.context?.engagement_id === 'string'
      ? request.context.engagement_id
      : null

    if (!engagementId) {
      return agentFailure(request, 'No engagement_id provided. Include engagement_id in context.engagement_id')
    }

    const report = await getEngagementCostReport(engagementId)

    if (!report) {
      return agentSuccess(request,
        `# Engagement Cost Report: ${engagementId}\n\nNo cost data found for this engagement yet. ` +
        `Costs accumulate as agents process requests. Use recordEngagementCost() after each request.`,
        { input: 0, output: 50 }
      )
    }

    // Persist to Neo4j
    await persistCostReport(report)

    // Build human-readable output
    const lines = [
      `# Engagement Cost Report`,
      ``,
      `**Engagement ID:** ${report.engagement_id}`,
      `**Report ID:** ${report.report_id}`,
      `**Generated:** ${report.generated_at}`,
      ``,
      `## Summary`,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total Cost | ${report.total_cost_dkk.toFixed(4)} DKK |`,
      `| Total Requests | ${report.total_requests} |`,
      `| Total Tokens | ${report.total_tokens.toLocaleString()} |`,
      `| Success Rate | ${report.avg_success_rate.toFixed(1)}% |`,
      ``,
      `## Cost Breakdown`,
      `| Category | DKK |`,
      `|----------|-----|`,
      `| Compute | ${report.cost_breakdown.compute_dkk.toFixed(4)} |`,
      `| Storage | ${report.cost_breakdown.storage_dkk.toFixed(4)} |`,
      `| Overhead | ${report.cost_breakdown.overhead_dkk.toFixed(4)} |`,
    ]

    if (report.by_agent.length > 0) {
      lines.push(``)
      lines.push(`## By Agent`)
      lines.push(`| Agent | Requests | Cost (DKK) | Success Rate |`)
      lines.push(`|-------|----------|------------|--------------|`)
      for (const agent of report.by_agent) {
        lines.push(`| ${agent.agent_id} | ${agent.requests} | ${agent.cost_dkk.toFixed(4)} | ${agent.success_rate.toFixed(1)}% |`)
      }
    }

    if (Object.keys(report.by_tool).length > 0) {
      lines.push(``)
      lines.push(`## By Tool`)
      lines.push(`| Tool | Calls | Cost (DKK) | Avg Latency |`)
      lines.push(`|------|-------|------------|-------------|`)
      for (const [tool, metrics] of Object.entries(report.by_tool)) {
        lines.push(`| ${tool} | ${metrics.calls} | ${metrics.cost_dkk.toFixed(4)} | ${metrics.avg_ms}ms |`)
      }
    }

    return agentSuccess(request, lines.join('\n'), { input: 0, output: lines.length * 10 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}
