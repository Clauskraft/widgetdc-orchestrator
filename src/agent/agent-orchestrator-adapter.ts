/**
 * agent-orchestrator-adapter.ts — IAgent adapter for the orchestrator.
 *
 * Translates canonical AgentRequest/AgentResponse to/from the orchestrator's
 * native tool execution + chat dispatch model.
 *
 * The orchestrator doesn't "process" tasks itself — it dispatches to other agents
 * or executes tools. This adapter wraps the dispatch pipeline.
 */
import type { AgentRequest, AgentResponse } from '@widgetdc/contracts/agent'
import { IAgent, AgentHealth, AgentStatus, agentFailure, agentSuccess } from './agent-interface.js'
import { executeToolUnified } from '../tools/tool-executor.js'
import { broadcastMessage } from '../chat-broadcaster.js'
import { msgId } from '../chat-store.js'
import { logger } from '../logger.js'

export class OrchestratorAgentAdapter implements IAgent {
  readonly agentId = 'orchestrator'
  readonly displayName = 'Master Orchestrator'
  readonly capabilities = ['dispatch', 'routing', 'tool_execution', 'coordination', 'memory', 'conversion']

  async process(request: AgentRequest): Promise<AgentResponse> {
    const t0 = Date.now()
    const task = request.task
    const context = request.context

    try {
      // Orchestrator processes the task via tool execution or dispatch
      let output: string

      if (context.tool_name && typeof context.tool_name === 'string') {
        // Execute a specific tool
        const toolArgs = (context.tool_args as Record<string, unknown>) ?? {}
        const result = await executeToolUnified(
          context.tool_name,
          toolArgs,
          { call_id: request.request_id, fold: false },
        )
        output = result.error ? `Tool error: ${result.error}` : String(result.result ?? '')
      } else if (context.dispatch_to && typeof context.dispatch_to === 'string') {
        // Dispatch to another agent via A2A
        const targetAgent = String(context.dispatch_to)
        broadcastMessage({
          from: this.agentId,
          to: targetAgent,
          source: 'agent',
          type: 'Message',
          message: `Dispatch from orchestrator: ${task}`,
          timestamp: new Date().toISOString(),
          thread_id: request.request_id,
        })
        output = `Dispatched to ${targetAgent}: ${task}`
      } else {
        // General task — acknowledge and log
        output = `Orchestrator received task: ${task}. Capabilities: ${this.capabilities.join(', ')}. Use context.tool_name to execute specific tools.`
      }

      const durationMs = Date.now() - t0
      return agentSuccess(request, output, { input: 0, output: output.length / 4 }, 0)
    } catch (err) {
      return agentFailure(
        request,
        err instanceof Error ? err.message : String(err),
        { input: 0, output: 0 },
      )
    }
  }

  async health(): Promise<AgentHealth> {
    return {
      agent_id: this.agentId,
      status: 'online',
      uptime_seconds: process.uptime(),
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
