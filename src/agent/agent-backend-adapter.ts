/**
 * agent-backend-adapter.ts — IAgent adapter stub for the backend repo.
 *
 * This file defines the adapter that should be copied to the backend repo
 * (apps/backend/src/agent/agent-backend-adapter.ts). It shows how the backend's
 * native MCP tool execution maps to the canonical AgentRequest/AgentResponse contract.
 *
 * The backend has direct access to:
 *   - Neo4j (graph.read_cypher, graph.write_cypher)
 *   - SRAG (srag.query)
 *   - All MCP tools via mcpRegistry
 *
 * This adapter wraps those into the canonical contract.
 */
import type { AgentRequest, AgentResponse } from '@widgetdc/contracts/agent'
import { IAgent, AgentHealth, AgentStatus, agentFailure, agentSuccess } from './agent-interface.js'

/**
 * BackendAgentAdapter — maps backend MCP tool execution to canonical contract.
 *
 * COPY THIS FILE to: apps/backend/src/agent/agent-backend-adapter.ts
 * And update imports to point to the backend's native mcpRegistry.
 */
export class BackendAgentAdapter implements IAgent {
  readonly agentId: string
  readonly displayName: string
  readonly capabilities: string[]

  constructor(agentId: string, displayName: string, capabilities: string[]) {
    this.agentId = agentId
    this.displayName = displayName
    this.capabilities = capabilities
  }

  async process(request: AgentRequest): Promise<AgentResponse> {
    // Backend-native implementation:
    // 1. Parse request.task to determine which MCP tool(s) to call
    // 2. Call mcpRegistry.route() or specific tool
    // 3. Wrap result in AgentResponse
    //
    // Example:
    //   const tool = await mcpRegistry.route(request.task)
    //   const result = await tool.execute(request.context)
    //   return agentSuccess(request, result.output, result.tokens, result.cost)

    return agentFailure(
      request,
      'Backend adapter not yet implemented in backend repo — copy agent-backend-adapter.ts stub and implement process()',
      { input: 0, output: 0 },
    )
  }

  async health(): Promise<AgentHealth> {
    return {
      agent_id: this.agentId,
      status: 'online',
      uptime_seconds: 0, // Backend should read from process.uptime()
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
 * Factory: create a backend agent from its boot configuration.
 */
export function createBackendAgent(config: {
  agentId: string
  displayName: string
  capabilities: string[]
}): BackendAgentAdapter {
  return new BackendAgentAdapter(config.agentId, config.displayName, config.capabilities)
}
