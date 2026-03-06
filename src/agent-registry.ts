/**
 * agent-registry.ts — In-memory agent registry.
 */
import { logger } from './logger.js'

export interface AgentHandshakeData {
  agent_id: string
  display_name: string
  source: string
  version?: string
  status: 'online' | 'standby' | 'offline' | 'degraded'
  capabilities: string[]
  allowed_tool_namespaces: string[]
  max_concurrent_calls?: number
  default_thread?: string
  registered_at?: string
  last_seen_at?: string
}

interface RegistryEntry {
  handshake: AgentHandshakeData
  registeredAt: Date
  lastSeenAt: Date
  activeCalls: number
}

const registry = new Map<string, RegistryEntry>()

export const AgentRegistry = {
  register(handshake: AgentHandshakeData): void {
    const existing = registry.get(handshake.agent_id)
    registry.set(handshake.agent_id, {
      handshake,
      registeredAt: existing?.registeredAt ?? new Date(),
      lastSeenAt: new Date(),
      activeCalls: existing?.activeCalls ?? 0,
    })
    logger.info({ agent_id: handshake.agent_id, status: handshake.status }, 'Agent registered')
  },

  heartbeat(agentId: string): void {
    const entry = registry.get(agentId)
    if (entry) entry.lastSeenAt = new Date()
  },

  get(agentId: string): RegistryEntry | undefined {
    return registry.get(agentId)
  },

  all(): RegistryEntry[] {
    return Array.from(registry.values())
  },

  canCallTool(agentId: string, toolName: string): { allowed: boolean; reason?: string } {
    const entry = registry.get(agentId)
    if (!entry) return { allowed: false, reason: `Agent '${agentId}' not registered. POST /agents/register first.` }
    if (entry.handshake.status === 'offline') return { allowed: false, reason: `Agent '${agentId}' is offline.` }

    const namespaces = entry.handshake.allowed_tool_namespaces
    if (namespaces.includes('*')) return { allowed: true }

    const namespace = toolName.split('.')[0]
    if (!namespace) return { allowed: false, reason: `Invalid tool name '${toolName}'. Expected 'namespace.method'.` }
    if (namespaces.includes(namespace)) return { allowed: true }

    return { allowed: false, reason: `Agent '${agentId}' not authorized for '${namespace}'. Allowed: [${namespaces.join(', ')}]` }
  },

  incrementActive(agentId: string): void {
    const e = registry.get(agentId)
    if (e) e.activeCalls++
  },

  decrementActive(agentId: string): void {
    const e = registry.get(agentId)
    if (e) e.activeCalls = Math.max(0, e.activeCalls - 1)
  },

  getActiveCalls(agentId: string): number {
    return registry.get(agentId)?.activeCalls ?? 0
  },
}
