/**
 * failure-harvester.ts — Red Queen MVP (LIN-567)
 *
 * Scans Redis for failed chain executions, categorizes failures,
 * persists to Neo4j as FailureEvent nodes, and exposes summary data.
 *
 * Categories: timeout | 502 | auth | validation | mcp_error | unknown
 */
import { v4 as uuid } from 'uuid'
import { getRedis } from '../redis.js'
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'
import { broadcastSSE } from '../sse.js'

// ─── Sanitization (strip sensitive data from error messages before persistence)
function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[REDACTED]')
    .replace(/password[=:]\s*\S+/gi, 'password=[REDACTED]')
    .replace(/token[=:]\s*\S+/gi, 'token=[REDACTED]')
    .replace(/https?:\/\/[^\s"']+[?&][^\s"']*/g, (url) => {
      try { const u = new URL(url); u.search = '[REDACTED]'; return u.toString() } catch { return url }
    })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type FailureCategory = 'timeout' | '502' | 'auth' | 'validation' | 'mcp_error' | 'unknown'

export interface FailureEvent {
  $id: string
  execution_id: string
  chain_name: string
  category: FailureCategory
  error_message: string
  affected_tool: string | null
  affected_agent: string | null
  timestamp: string
  remediation_hint: string
}

export interface FailureSummary {
  $id: string
  total_failures: number
  by_category: Record<FailureCategory, number>
  top_tools: Array<{ tool: string; count: number }>
  top_agents: Array<{ agent: string; count: number }>
  recent: FailureEvent[]
  harvested_at: string
  window_hours: number
}

// ─── Categorizer ────────────────────────────────────────────────────────────

function categorizeFailure(error: string): FailureCategory {
  const lower = error.toLowerCase()
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) return 'timeout'
  if (lower.includes('502') || lower.includes('bad gateway') || lower.includes('econnrefused')) return '502'
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) return 'auth'
  if (lower.includes('validation') || lower.includes('invalid') || lower.includes('required')) return 'validation'
  if (lower.includes('mcp') || lower.includes('tool_not_found') || lower.includes('tool call')) return 'mcp_error'
  return 'unknown'
}

// ─── Remediation hints ───────────────────────────────────────────────────────

// LIN-856 P1b: resolve backend-key hint from env (not hardcoded). One-time warn
// if BACKEND_API_KEY is unset so ops can't miss misconfig during triage.
let warnedMissingBackendKey = false
function backendKeyHint(): string {
  const key = process.env.BACKEND_API_KEY ?? ''
  if (!key) {
    if (!warnedMissingBackendKey) {
      logger.warn('BACKEND_API_KEY env var not set — auth remediation hints will omit expected key')
      warnedMissingBackendKey = true
    }
    return '(BACKEND_API_KEY unset — configure in Railway orchestrator service)'
  }
  // Redact middle of key in user-facing hint: show first 2 / last 2 chars only.
  if (key.length <= 6) return '[set]'
  return `${key.slice(0, 2)}…${key.slice(-2)}`
}

function remediationSuggestion(category: FailureCategory, toolName: string, _errorMessage: string): string {
  switch (category) {
    case 'timeout':
      return `Increase timeout_ms for '${toolName}' (currently may be hitting the 10s default). Check backend health at /health or Railway logs for slow queries.`
    case '502':
      return `Backend gateway unreachable. Check Railway service health for backend-production-d3da and verify Redis connection string in orchestrator env vars.`
    case 'auth':
      return `Authentication failed on '${toolName}'. Verify BACKEND_API_KEY env var in Railway orchestrator service matches the backend's expected key (fingerprint: '${backendKeyHint()}').`
    case 'validation':
      return `Validation error on '${toolName}'. Log the exact args shape sent and compare against the tool registry schema in src/tools/tool-registry.ts.`
    case 'mcp_error':
      return `MCP routing error on '${toolName}'. Ensure payload format is {tool, payload} not {tool, args} — check src/mcp-caller.ts and tool registry backendTool mapping.`
    case 'unknown':
    default:
      return `Unknown failure on '${toolName}'. Check Railway logs for full stack trace and confirm the service is healthy at ${process.env.BACKEND_URL ?? 'backend-production-d3da'}/health.`
  }
}

// ─── Harvester ──────────────────────────────────────────────────────────────

/**
 * Scan Redis for failed chain executions and harvest failure events.
 * Returns harvested events for persistence.
 */
export async function harvestFailures(windowHours = 24): Promise<FailureEvent[]> {
  const redis = getRedis()
  if (!redis) {
    logger.warn('Failure harvester: Redis not available')
    return []
  }

  const events: FailureEvent[] = []
  const cutoff = new Date(Date.now() - windowHours * 3600000).toISOString()

  try {
    // Scan chain executions using HSCAN (P1 fix: avoid hgetall OOM on large hashes)
    let cursor = '0'
    do {
      const [nextCursor, fields] = await redis.hscan('orchestrator:chains', cursor, 'COUNT', 200)
      cursor = nextCursor

      // HSCAN returns [field, value, field, value, ...]
      for (let i = 0; i < fields.length; i += 2) {
        const execId = fields[i]
        const json = fields[i + 1]
        try {
          const exec = JSON.parse(json) as {
            execution_id: string
            name: string
            status: string
            started_at: string
            error?: string
            results?: Array<{
              step_id: string
              agent_id: string
              action: string
              status: string
              output: unknown
            }>
          }

          if (exec.status !== 'failed') continue
          if (exec.started_at < cutoff) continue

          // Extract failure details from step results
          const failedSteps = exec.results?.filter(r => r.status === 'error') ?? []
          const errorMsg = exec.error ?? failedSteps.map(s => String(s.output)).join('; ') ?? 'unknown'

          const category = categorizeFailure(errorMsg)
          const affectedTool = failedSteps[0]?.action ?? null
          events.push({
            $id: `failure-event:${uuid()}`,
            execution_id: execId,
            chain_name: exec.name,
            category,
            error_message: sanitizeErrorMessage(errorMsg).slice(0, 500),
            affected_tool: affectedTool,
            affected_agent: failedSteps[0]?.agent_id ?? null,
            timestamp: exec.started_at,
            remediation_hint: remediationSuggestion(category, affectedTool ?? 'unknown', errorMsg),
          })
        } catch {
          // Skip malformed entries
        }
      }
    } while (cursor !== '0')

    logger.info({ harvested: events.length, window_hours: windowHours }, 'Failure harvester scan complete')
  } catch (err) {
    logger.error({ err: String(err) }, 'Failure harvester scan failed')
  }

  return events
}

// ─── Neo4j Persistence ──────────────────────────────────────────────────────

/**
 * Persist failure events to Neo4j as FailureEvent nodes.
 */
async function persistToGraph(events: FailureEvent[]): Promise<number> {
  let persisted = 0

  for (const evt of events) {
    try {
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `
            MERGE (f:FailureEvent {execution_id: $execution_id})
            SET f.chain_name = $chain_name,
                f.category = $category,
                f.error_message = $error_message,
                f.affected_tool = $affected_tool,
                f.affected_agent = $affected_agent,
                f.timestamp = datetime($timestamp),
                f.harvested_at = datetime()
          `,
          params: {
            execution_id: evt.execution_id,
            chain_name: evt.chain_name,
            category: evt.category,
            error_message: evt.error_message,
            affected_tool: evt.affected_tool ?? '',
            affected_agent: evt.affected_agent ?? '',
            timestamp: evt.timestamp,
          },
        },
        callId: uuid(),
        timeoutMs: 10000,
      })
      persisted++
    } catch (err) {
      logger.warn({ err: String(err), execution_id: evt.execution_id }, 'Failed to persist failure event')
    }
  }

  // Create relationships to Tool and Agent nodes if they exist
  if (persisted > 0) {
    try {
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `
            MATCH (f:FailureEvent) WHERE f.affected_tool <> ''
            MATCH (t:Tool {name: f.affected_tool})
            MERGE (f)-[:AFFECTED_TOOL]->(t)
          `,
          params: {},
        },
        callId: uuid(),
        timeoutMs: 10000,
      })
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `
            MATCH (f:FailureEvent) WHERE f.affected_agent <> ''
            MATCH (a:Agent {id: f.affected_agent})
            MERGE (f)-[:AFFECTED_AGENT]->(a)
          `,
          params: {},
        },
        callId: uuid(),
        timeoutMs: 10000,
      })
    } catch {
      // Relationships are optional — Tool/Agent nodes may not exist
    }
  }

  return persisted
}

// ─── Summary Builder ────────────────────────────────────────────────────────

/**
 * Build a summary from harvested failure events.
 */
export function buildFailureSummary(events: FailureEvent[], windowHours = 24): FailureSummary {
  const byCategory: Record<FailureCategory, number> = {
    timeout: 0, '502': 0, auth: 0, validation: 0, mcp_error: 0, unknown: 0,
  }

  const toolCounts = new Map<string, number>()
  const agentCounts = new Map<string, number>()

  for (const evt of events) {
    byCategory[evt.category]++
    if (evt.affected_tool) toolCounts.set(evt.affected_tool, (toolCounts.get(evt.affected_tool) ?? 0) + 1)
    if (evt.affected_agent) agentCounts.set(evt.affected_agent, (agentCounts.get(evt.affected_agent) ?? 0) + 1)
  }

  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }))

  const topAgents = [...agentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([agent, count]) => ({ agent, count }))

  return {
    $id: `failure-summary:${new Date().toISOString().slice(0, 10)}`,
    total_failures: events.length,
    by_category: byCategory,
    top_tools: topTools,
    top_agents: topAgents,
    recent: events.slice(-20),
    harvested_at: new Date().toISOString(),
    window_hours: windowHours,
  }
}

// ─── Main Runner ────────────────────────────────────────────────────────────

/**
 * Full harvest cycle: scan → categorize → persist → summarize → broadcast.
 */
export async function runFailureHarvest(windowHours = 24): Promise<FailureSummary> {
  const events = await harvestFailures(windowHours)
  const persisted = await persistToGraph(events)
  const summary = buildFailureSummary(events, windowHours)

  // Cache summary in Redis
  const redis = getRedis()
  if (redis) {
    await redis.set('orchestrator:failure-summary', JSON.stringify(summary), 'EX', 3600).catch(() => {})
  }

  // Broadcast via SSE
  broadcastSSE('failure-harvest', summary)

  logger.info({
    total: events.length,
    persisted,
    categories: summary.by_category,
  }, 'Failure harvest cycle complete')

  return summary
}
