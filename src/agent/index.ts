/**
 * agent/index.ts — Canonical IAgent interface + adapters (Phantom Week 3).
 *
 * Exports:
 *   - IAgent interface — all agents implement this
 *   - agentSuccess, agentFailure, agentPartial — response helpers
 *   - OrchestratorAgentAdapter — live orchestrator adapter
 *   - BackendAgentAdapter — stub to copy to backend repo
 *   - RlmEngineAgentAdapter — stub to copy to rlm-engine repo
 */
export type { IAgent, AgentHealth, AgentStatus } from './agent-interface.js'
export {
  agentSuccess,
  agentFailure,
  agentPartial,
} from './agent-interface.js'
export { OrchestratorAgentAdapter } from './agent-orchestrator-adapter.js'
export { BackendAgentAdapter, createBackendAgent } from './agent-backend-adapter.js'
export { RlmEngineAgentAdapter, createRlmAgent } from './agent-rlm-adapter.js'
