/**
 * agent-interface.ts — Canonical IAgent interface for Phantom Week 3.
 *
 * All agents across backend, orchestrator, and rlm-engine must implement
 * this interface. It wraps the canonical AgentRequest/AgentResponse contract
 * from @widgetdc/contracts/agent (Track A, merged PR #19).
 *
 * This ensures uniform dispatch, response shape, and error handling across
 * all three repos. Each adapter translates its native format to/from the contract.
 */
import type { AgentRequest, AgentResponse, AgentResponseStatus } from '@widgetdc/contracts/agent'

/**
 * IAgent — canonical interface all agents must implement.
 *
 * Implementations:
 *   - BackendAgentAdapter (backend repo)
 *   - OrchestratorAgentAdapter (orchestrator repo)
 *   - RlmEngineAgentAdapter (rlm-engine repo)
 */
export interface IAgent {
  /** Unique agent identifier */
  readonly agentId: string

  /** Human-readable display name */
  readonly displayName: string

  /** Capabilities this agent provides — matches AgentRequest.capabilities */
  readonly capabilities: string[]

  /**
   * Process a canonical AgentRequest and return an AgentResponse.
   * MUST emit the exact AgentResponse shape from @widgetdc/contracts/agent.
   */
  process(request: AgentRequest): Promise<AgentResponse>

  /** Health check — returns current agent status */
  health(): Promise<AgentHealth>

  /** Get current workload / active tasks */
  status(): Promise<AgentStatus>
}

export interface AgentHealth {
  agent_id: string
  status: 'online' | 'degraded' | 'offline'
  uptime_seconds: number
  last_seen: string
}

export interface AgentStatus {
  agent_id: string
  active_tasks: number
  queued_tasks: number
  total_processed: number
  total_failed: number
  current_load_pct: number
}

/**
 * Helper: create a success AgentResponse.
 */
export function agentSuccess(
  request: AgentRequest,
  output: string,
  tokensUsed: { input: number; output: number } = { input: 0, output: 0 },
  costDkk: number = 0,
): AgentResponse {
  return {
    request_id: request.request_id,
    agent_id: request.agent_id,
    status: 'success',
    output,
    tokens_used: tokensUsed,
    cost_dkk: costDkk,
    conflicts: [],
  }
}

/**
 * Helper: create a failed AgentResponse.
 */
export function agentFailure(
  request: AgentRequest,
  error: string,
  tokensUsed: { input: number; output: number } = { input: 0, output: 0 },
): AgentResponse {
  return {
    request_id: request.request_id,
    agent_id: request.agent_id,
    status: 'failed',
    output: `Error: ${error}`,
    tokens_used: tokensUsed,
    cost_dkk: 0,
    conflicts: [],
  }
}

/**
 * Helper: create a partial AgentResponse (completed with caveats).
 */
export function agentPartial(
  request: AgentRequest,
  output: string,
  tokensUsed: { input: number; output: number } = { input: 0, output: 0 },
  costDkk: number = 0,
): AgentResponse {
  return {
    request_id: request.request_id,
    agent_id: request.agent_id,
    status: 'partial',
    output,
    tokens_used: tokensUsed,
    cost_dkk: costDkk,
    conflicts: [],
  }
}
