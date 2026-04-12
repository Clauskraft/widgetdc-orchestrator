/**
 * agent-rlm-adapter.ts — IAgent adapter stub for the RLM Engine repo.
 *
 * This file defines the adapter that should be copied to the RLM Engine repo
 * (src/agent/agent-rlm-adapter.ts). It shows how the RLM Engine's native
 * reasoning/pipeline execution maps to the canonical AgentRequest/AgentResponse contract.
 *
 * The RLM Engine has direct access to:
 *   - Deep reasoning pipelines (/reason, /analyze, /plan)
 *   - Context folding (/fold)
 *   - RLM decision tracking
 *
 * This adapter wraps those into the canonical contract.
 */
import type { AgentRequest, AgentResponse } from '@widgetdc/contracts/agent'
import { IAgent, AgentHealth, AgentStatus, agentFailure, agentSuccess } from './agent-interface.js'

/**
 * RlmEngineAgentAdapter — maps RLM Engine reasoning to canonical contract.
 *
 * COPY THIS FILE to: widgetdc-rlm-engine/src/agent/agent-rlm-adapter.ts
 * And update imports to point to the RLM Engine's native reasoning client.
 */
export class RlmEngineAgentAdapter implements IAgent {
  readonly agentId: string
  readonly displayName: string
  readonly capabilities: string[]

  constructor(agentId: string, displayName: string, capabilities: string[]) {
    this.agentId = agentId
    this.displayName = displayName
    this.capabilities = capabilities
  }

  async process(request: AgentRequest): Promise<AgentResponse> {
    // RLM Engine-native implementation:
    // 1. Parse request.task to determine reasoning mode (reason/analyze/plan)
    // 2. Call RLM Engine's reasoning pipeline
    // 3. Wrap result in AgentResponse with token/cost tracking
    //
    // Example:
    //   const mode = request.context.reasoning_mode ?? 'reason'
    //   const result = await rlmClient.reason({
    //     query: request.task,
    //     mode,
    //     context: request.context,
    //   })
    //   return agentSuccess(request, result.output, result.tokens, result.cost)

    return agentFailure(
      request,
      'RLM adapter not yet implemented in rlm-engine repo — copy agent-rlm-adapter.ts stub and implement process()',
      { input: 0, output: 0 },
    )
  }

  async health(): Promise<AgentHealth> {
    return {
      agent_id: this.agentId,
      status: 'online',
      uptime_seconds: 0, // RLM Engine should read from process.uptime()
      last_seen: new Date().toISOString(),
    }
  }

  async status(): Promise<AgentStatus> {
    return {
      agent_id: this.agentId,
      active_tasks: 0,
      queued_tasks: 0,
      total_processed: 0,
      total_failed: 0,
      current_load_pct: 0,
    }
  }
}

/**
 * Factory: create an RLM agent from its boot configuration.
 */
export function createRlmAgent(config: {
  agentId: string
  displayName: string
  capabilities: string[]
}): RlmEngineAgentAdapter {
  return new RlmEngineAgentAdapter(config.agentId, config.displayName, config.capabilities)
}
