import type { AgentPriority, AgentRequest, AgentResponse, AgentConflict, TokenUsage } from '@widgetdc/contracts/agent'
import type { OrchestratorToolCall, OrchestratorToolResult } from '@widgetdc/contracts/orchestrator'
import { apiPost } from '@/lib/api-client'
import { useTelemetryStore } from '@/stores/telemetry'
import { useSessionStore } from '@/stores/session'

interface DispatchContext {
  tool_name?: string
  tool_args?: Record<string, unknown>
  [key: string]: unknown
}

export interface DispatchOptions {
  agent_id: string
  task: string
  capabilities?: string[]
  context?: DispatchContext
  priority?: AgentPriority
}

export type ParsedAgentResponse<T> = AgentResponse & { parsed?: T }

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function parseOutput<T>(output: string): T | undefined {
  try {
    return JSON.parse(output) as T
  } catch {
    return undefined
  }
}

function readTokenUsage(result: unknown): TokenUsage {
  const record = typeof result === 'object' && result !== null ? result as Record<string, unknown> : {}
  const usage = record.tokens_used
  if (usage && typeof usage === 'object') {
    const tokenUsage = usage as Record<string, unknown>
    return {
      input: Number(tokenUsage.input ?? 0) || 0,
      output: Number(tokenUsage.output ?? 0) || 0,
    }
  }

  return { input: 0, output: 0 }
}

function readCostDkk(result: unknown): number {
  const record = typeof result === 'object' && result !== null ? result as Record<string, unknown> : {}
  const cost = record.cost_dkk
  return typeof cost === 'number' ? cost : 0
}

function readConflicts(result: unknown): AgentConflict[] {
  const record = typeof result === 'object' && result !== null ? result as Record<string, unknown> : {}
  return Array.isArray(record.conflicts) ? record.conflicts as AgentConflict[] : []
}

function toolStatusToAgentStatus(status: OrchestratorToolResult['status']): AgentResponse['status'] {
  if (status === 'success') return 'success'
  return 'failed'
}

function buildRequest(opts: DispatchOptions): AgentRequest {
  const session = useSessionStore.getState()
  return {
    request_id: makeId('req'),
    agent_id: opts.agent_id,
    task: opts.task,
    capabilities: opts.capabilities ?? [],
    context: {
      ...opts.context,
      engagement_id: session.engagementId,
      active_client: session.activeClient,
      locale: session.locale,
    },
    priority: opts.priority ?? 'normal',
  }
}

function buildToolCall(request: AgentRequest): OrchestratorToolCall {
  const context = request.context as DispatchContext
  const toolName = context.tool_name
  if (!toolName) {
    throw new Error('dispatch() requires context.tool_name')
  }

  return {
    call_id: makeId('tool'),
    agent_id: request.agent_id,
    tool_name: toolName,
    arguments: context.tool_args ?? {},
    priority: request.priority,
    emitted_at: new Date().toISOString(),
  }
}

function toAgentResponse<T>(request: AgentRequest, toolResult: OrchestratorToolResult): ParsedAgentResponse<T> {
  const output = toolResult.status === 'success'
    ? safeStringify(toolResult.result)
    : toolResult.error_message ?? 'Tool call failed'

  const tokens_used = readTokenUsage(toolResult.result)
  const cost_dkk = readCostDkk(toolResult.result)

  return {
    request_id: request.request_id,
    agent_id: request.agent_id,
    status: toolStatusToAgentStatus(toolResult.status),
    output,
    tokens_used,
    cost_dkk,
    conflicts: readConflicts(toolResult.result),
    parsed: parseOutput<T>(output),
  }
}

export async function dispatch<T = unknown>(opts: DispatchOptions): Promise<ParsedAgentResponse<T>> {
  const request = buildRequest(opts)
  const call = buildToolCall(request)
  const toolResult = await apiPost<OrchestratorToolResult>('/api/tools/call', call)
  const response = toAgentResponse<T>(request, toolResult)
  useTelemetryStore.getState().updateFromResponse(response.tokens_used, response.cost_dkk)
  return response
}

export async function syncRuntimeTelemetry(agentId = 'cc-v4'): Promise<void> {
  const response = await dispatch({
    agent_id: agentId,
    task: 'Fetch runtime summary for client telemetry',
    capabilities: ['monitoring'],
    context: {
      tool_name: 'runtime_summary',
      tool_args: {},
    },
    priority: 'low',
  })

  if (response.status === 'success' && response.parsed) {
    useTelemetryStore.getState().hydrateRuntimeSummary(response.parsed)
  }
}
