/**
 * agent-drift-monitor.ts — Weekly regression detection per agent.
 *
 * V5: "Weekly regression flag per agent → auto Linear issue"
 *
 * Compares current week's agent metrics against previous week.
 * Flags agents with >15% success-rate regression (configurable).
 * Creates Linear issues for flagged agents.
 *
 * Constraints:
 * - Drift threshold via config (default: 15% success-rate regression)
 * - Uses existing runtime-analytics module for base metrics
 * - AgentResponse wire format
 */
import { getRedis, isRedisEnabled } from '../redis.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import type { AgentRequest, AgentResponse } from '@widgetdc/contracts/agent'
import { agentSuccess, agentFailure } from '../agent/agent-interface.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentBaseline {
  agent_id: string
  success_rate: number
  avg_latency_ms: number
  total_requests: number
  avg_cost_per_request: number
  measured_at: string
}

export interface DriftItem {
  agent_id: string
  metric: string
  baseline_value: number
  current_value: number
  change_pct: number
  severity: 'critical' | 'high' | 'medium' | 'low'
  is_regression: boolean
}

export interface DriftReport {
  report_id: string
  generated_at: string
  agents_checked: number
  agents_with_drift: number
  total_drifts: number
  critical_drifts: number
  drifts: DriftItem[]
  linear_issues_created: string[]
}

export interface DriftConfig {
  success_rate_threshold: number   // Default: 15% regression
  latency_threshold: number        // Default: 25% increase
  cost_threshold: number           // Default: 20% increase
  min_requests: number             // Minimum requests to consider (default: 10)
}

const DEFAULT_CONFIG: DriftConfig = {
  success_rate_threshold: 15,
  latency_threshold: 25,
  cost_threshold: 20,
  min_requests: 10,
}

// ─── Redis keys ──────────────────────────────────────────────────────────────

const REDIS_BASELINE_PREFIX = 'drift:baseline:'
const REDIS_BASELINE_INDEX = 'drift:baselines:index'
const REDIS_TTL = 90 * 24 * 3600 // 90 days

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

// ─── Baseline Management ─────────────────────────────────────────────────────

/**
 * Snapshot current agent metrics as baseline for next week's comparison.
 * Called after drift check passes (no regression).
 */
export async function snapshotBaseline(agentId: string, successRate: number, avgLatencyMs: number, totalRequests: number, avgCostPerRequest: number): Promise<void> {
  if (!isRedisEnabled()) return

  const redis = getRedis()
  if (!redis) return

  try {
    const baseline: AgentBaseline = {
      agent_id: agentId,
      success_rate: successRate,
      avg_latency_ms: avgLatencyMs,
      total_requests: totalRequests,
      avg_cost_per_request: avgCostPerRequest,
      measured_at: new Date().toISOString(),
    }

    await redis.set(`${REDIS_BASELINE_PREFIX}${agentId}`, JSON.stringify(baseline), 'EX', REDIS_TTL)
    await redis.sadd(REDIS_BASELINE_INDEX, agentId)
  } catch (err) {
    logger.warn({ err: String(err), agent_id: agentId }, 'Failed to snapshot agent baseline')
  }
}

/**
 * Get stored baseline for an agent.
 */
export async function getBaseline(agentId: string): Promise<AgentBaseline | null> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return null

  try {
    const raw = await redis.get(`${REDIS_BASELINE_PREFIX}${agentId}`)
    return raw ? JSON.parse(raw) as AgentBaseline : null
  } catch {
    return null
  }
}

// ─── Drift Detection ─────────────────────────────────────────────────────────

/**
 * Check all registered agents for regression drift.
 * Returns drift report with any flagged agents.
 */
export async function checkAgentDrift(cfg: DriftConfig = DEFAULT_CONFIG): Promise<DriftReport> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) {
    return {
      report_id: `drift-${Date.now().toString(36)}`,
      generated_at: new Date().toISOString(),
      agents_checked: 0,
      agents_with_drift: 0,
      total_drifts: 0,
      critical_drifts: 0,
      drifts: [],
      linear_issues_created: [],
    }
  }

  try {
    const agentIds = await redis.smembers(REDIS_BASELINE_INDEX)
    const allDrifts: DriftItem[] = []
    const linearIssues: string[] = []

    for (const agentId of agentIds) {
      const baseline = await getBaseline(agentId)
      if (!baseline) continue

      // Get current metrics from runtime-analytics
      const { getAgentMetrics } = await import('./runtime-analytics.js')
      const current = await getAgentMetrics(agentId)
      if (!current || current.total_requests < cfg.min_requests) continue

      const baselineSuccessRate = baseline.success_rate
      const currentSuccessRate = current.total_requests > 0
        ? (current.total_success / current.total_requests) * 100
        : 0

      const successRateChange = currentSuccessRate - baselineSuccessRate
      if (successRateChange < -cfg.success_rate_threshold) {
        const severity = successRateChange < -cfg.success_rate_threshold * 2 ? 'critical' : 'high'
        allDrifts.push({
          agent_id: agentId,
          metric: 'success_rate',
          baseline_value: Math.round(baselineSuccessRate * 100) / 100,
          current_value: Math.round(currentSuccessRate * 100) / 100,
          change_pct: Math.round(successRateChange * 100) / 100,
          severity,
          is_regression: true,
        })
      }

      // Latency drift
      if (baseline.avg_latency_ms > 0) {
        const latencyChangePct = ((current.avg_latency_ms - baseline.avg_latency_ms) / baseline.avg_latency_ms) * 100
        if (latencyChangePct > cfg.latency_threshold) {
          allDrifts.push({
            agent_id: agentId,
            metric: 'avg_latency_ms',
            baseline_value: baseline.avg_latency_ms,
            current_value: current.avg_latency_ms,
            change_pct: Math.round(latencyChangePct * 100) / 100,
            severity: latencyChangePct > cfg.latency_threshold * 2 ? 'high' : 'medium',
            is_regression: true,
          })
        }
      }

      // Cost drift
      if (baseline.avg_cost_per_request > 0 && current.total_requests > 0) {
        const currentAvgCost = current.total_cost_dkk / current.total_requests
        const costChangePct = ((currentAvgCost - baseline.avg_cost_per_request) / baseline.avg_cost_per_request) * 100
        if (costChangePct > cfg.cost_threshold) {
          allDrifts.push({
            agent_id: agentId,
            metric: 'avg_cost_per_request',
            baseline_value: Math.round(baseline.avg_cost_per_request * 10000) / 10000,
            current_value: Math.round(currentAvgCost * 10000) / 10000,
            change_pct: Math.round(costChangePct * 100) / 100,
            severity: costChangePct > cfg.cost_threshold * 2 ? 'high' : 'medium',
            is_regression: true,
          })
        }
      }
    }

    // Create Linear issues for critical drifts
    const criticalDrifts = allDrifts.filter(d => d.severity === 'critical')
    for (const drift of criticalDrifts) {
      try {
        const title = `🚨 Agent Drift: ${drift.agent_id} — ${drift.metric} regression ${drift.change_pct.toFixed(1)}%`
        const description = [
          `## Agent Drift Detected`,
          ``,
          `**Agent:** ${drift.agent_id}`,
          `**Metric:** ${drift.metric}`,
          `**Baseline:** ${drift.baseline_value}`,
          `**Current:** ${drift.current_value}`,
          `**Change:** ${drift.change_pct.toFixed(1)}%`,
          `**Severity:** ${drift.severity}`,
          ``,
          `### Action Required`,
          `Investigate agent performance regression. Check:`,
          `- Recent model changes or provider switches`,
          `- Input data distribution shift`,
          `- Infrastructure changes (network, compute)`,
          `- Configuration drift`,
        ].join('\n')

        // Create Linear issue via MCP
        const result = await mcpCall('linear.save_issue', {
          title,
          description,
          team: 'Linear-clauskraft',
          priority: drift.severity === 'critical' ? 1 : 2,
          labels: ['agent-drift', 'monitoring'],
        })

        if (result) {
          linearIssues.push(title)
          logger.info({ agent_id: drift.agent_id, title }, 'Linear drift issue created')
        }
      } catch (err) {
        logger.warn({ err: String(err), agent_id: drift.agent_id }, 'Failed to create Linear drift issue')
      }
    }

    // Update baselines for agents without drift (they're the new baseline)
    for (const agentId of agentIds) {
      const hasDrift = allDrifts.some(d => d.agent_id === agentId)
      if (!hasDrift) {
        const { getAgentMetrics } = await import('./runtime-analytics.js')
        const current = await getAgentMetrics(agentId)
        if (current && current.total_requests >= cfg.min_requests) {
          const successRate = current.total_requests > 0 ? (current.total_success / current.total_requests) * 100 : 0
          const avgCost = current.total_requests > 0 ? current.total_cost_dkk / current.total_requests : 0
          await snapshotBaseline(agentId, successRate, current.avg_latency_ms, current.total_requests, avgCost)
        }
      }
    }

    const agentsWithDrift = new Set(allDrifts.map(d => d.agent_id)).size

    return {
      report_id: `drift-${Date.now().toString(36)}`,
      generated_at: new Date().toISOString(),
      agents_checked: agentIds.length,
      agents_with_drift: agentsWithDrift,
      total_drifts: allDrifts.length,
      critical_drifts: criticalDrifts.length,
      drifts: allDrifts,
      linear_issues_created: linearIssues,
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Agent drift check failed')
    return {
      report_id: `drift-${Date.now().toString(36)}`,
      generated_at: new Date().toISOString(),
      agents_checked: 0,
      agents_with_drift: 0,
      total_drifts: 0,
      critical_drifts: 0,
      drifts: [],
      linear_issues_created: [],
    }
  }
}

// ─── MCP Tool Handler ────────────────────────────────────────────────────────

export async function handleDriftReport(request: AgentRequest): Promise<AgentResponse> {
  try {
    const threshold = typeof request.context?.threshold === 'number' ? request.context.threshold : undefined
    const config: DriftConfig = threshold
      ? { ...DEFAULT_CONFIG, success_rate_threshold: threshold }
      : DEFAULT_CONFIG

    const report = await checkAgentDrift(config)

    const lines = [
      `# Agent Drift Report`,
      ``,
      `**Report ID:** ${report.report_id}`,
      `**Generated:** ${report.generated_at}`,
      `**Agents Checked:** ${report.agents_checked}`,
      `**Agents with Drift:** ${report.agents_with_drift}`,
      `**Total Drifts:** ${report.total_drifts}`,
      `**Critical Drifts:** ${report.critical_drifts}`,
      `**Linear Issues Created:** ${report.linear_issues_created.length}`,
      ``,
    ]

    if (report.drifts.length > 0) {
      lines.push(`## Detected Drifts`)
      lines.push(``)
      lines.push(`| Agent | Metric | Baseline | Current | Change | Severity |`)
      lines.push(`|-------|--------|----------|---------|--------|----------|`)
      for (const d of report.drifts) {
        lines.push(`| ${d.agent_id} | ${d.metric} | ${d.baseline_value} | ${d.current_value} | ${d.change_pct.toFixed(1)}% | ${d.severity} |`)
      }
    } else {
      lines.push(`✅ **No drift detected.** All agents within acceptable thresholds.`)
    }

    if (report.linear_issues_created.length > 0) {
      lines.push(``)
      lines.push(`## Linear Issues Created`)
      for (const title of report.linear_issues_created) {
        lines.push(`- ${title}`)
      }
    }

    return agentSuccess(request, lines.join('\n'), { input: 0, output: lines.length * 10 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}
