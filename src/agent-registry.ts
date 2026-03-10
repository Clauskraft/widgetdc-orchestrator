/**
 * agent-registry.ts — Agent registry with optional Redis persistence.
 *
 * In-memory Map is the primary store (fast reads).
 * If REDIS_URL is set, registrations are persisted to Redis so they
 * survive restarts. On boot, the registry is hydrated from Redis.
 */
import { logger } from './logger.js'
import { getRedis } from './redis.js'
import type { AgentHandshake } from '@widgetdc/contracts/orchestrator'

/** Re-export contracts type under legacy name for compatibility */
export type AgentHandshakeData = AgentHandshake

interface RegistryEntry {
  handshake: AgentHandshakeData
  registeredAt: Date
  lastSeenAt: Date
  activeCalls: number
}

const REDIS_KEY = 'orchestrator:agents'
const registry = new Map<string, RegistryEntry>()

/** Persist a single agent entry to Redis (fire-and-forget) */
function persistToRedis(agentId: string, entry: RegistryEntry): void {
  const redis = getRedis()
  if (!redis) return
  const serialised = JSON.stringify({
    handshake: entry.handshake,
    registeredAt: entry.registeredAt.toISOString(),
    lastSeenAt: entry.lastSeenAt.toISOString(),
  })
  redis.hset(REDIS_KEY, agentId, serialised).catch(err => {
    logger.warn({ err: String(err), agent_id: agentId }, 'Redis persist failed')
  })
}

/** Remove an agent from Redis (fire-and-forget) */
function removeFromRedis(agentId: string): void {
  const redis = getRedis()
  if (!redis) return
  redis.hdel(REDIS_KEY, agentId).catch(() => {})
}

export const AgentRegistry = {
  /** Hydrate registry from Redis on startup */
  async hydrate(): Promise<void> {
    const redis = getRedis()
    if (!redis) return

    try {
      const all = await redis.hgetall(REDIS_KEY)
      let count = 0
      for (const [agentId, json] of Object.entries(all)) {
        try {
          const data = JSON.parse(json)
          registry.set(agentId, {
            handshake: data.handshake,
            registeredAt: new Date(data.registeredAt),
            lastSeenAt: new Date(data.lastSeenAt),
            activeCalls: 0, // reset on restart
          })
          count++
        } catch {
          logger.warn({ agent_id: agentId }, 'Skipped corrupt Redis entry')
        }
      }
      if (count > 0) {
        logger.info({ count }, 'Hydrated agent registry from Redis')
      }
    } catch (err) {
      logger.warn({ err: String(err) }, 'Redis hydration failed — starting with empty registry')
    }
  },

  register(handshake: AgentHandshakeData): void {
    const existing = registry.get(handshake.agent_id)
    const entry: RegistryEntry = {
      handshake,
      registeredAt: existing?.registeredAt ?? new Date(),
      lastSeenAt: new Date(),
      activeCalls: existing?.activeCalls ?? 0,
    }
    registry.set(handshake.agent_id, entry)
    persistToRedis(handshake.agent_id, entry)
    logger.info({ agent_id: handshake.agent_id, status: handshake.status }, 'Agent registered')
  },

  heartbeat(agentId: string): void {
    const entry = registry.get(agentId)
    if (entry) {
      entry.lastSeenAt = new Date()
      persistToRedis(agentId, entry)
    }
  },

  get(agentId: string): RegistryEntry | undefined {
    return registry.get(agentId)
  },

  all(): RegistryEntry[] {
    return Array.from(registry.values())
  },

  canCallTool(agentId: string, toolName: string): { allowed: boolean; reason?: string } {
    let entry = registry.get(agentId)

    // AUTO-DISCOVERY: If agent is unknown, auto-register it with full access
    // This enables any agent to call tools without manual registration
    if (!entry) {
      const autoHandshake: AgentHandshakeData = {
        agent_id: agentId,
        display_name: agentId,
        source: 'auto-discovered',
        status: 'online',
        capabilities: ['mcp_tools'],
        allowed_tool_namespaces: ['*'],
        registered_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      }
      const autoEntry: RegistryEntry = {
        handshake: autoHandshake,
        registeredAt: new Date(),
        lastSeenAt: new Date(),
        activeCalls: 0,
      }
      registry.set(agentId, autoEntry)
      persistToRedis(agentId, autoEntry)
      logger.info({ agent_id: agentId }, 'Auto-discovered and registered new agent')
      entry = autoEntry
    }
    if (entry.handshake.status === 'offline') return { allowed: false, reason: `Agent '${agentId}' is offline.` }

    const namespaces = entry.handshake.allowed_tool_namespaces
    if (namespaces.includes('*')) return { allowed: true }

    const namespace = toolName.split('.')[0]
    if (!namespace) return { allowed: false, reason: `Invalid tool name '${toolName}'. Expected 'namespace.method'.` }
    if (namespaces.includes(namespace)) return { allowed: true }

    return { allowed: false, reason: `Agent '${agentId}' not authorized for '${namespace}'. Allowed: [${namespaces.join(', ')}]` }
  },

  remove(agentId: string): boolean {
    const existed = registry.delete(agentId)
    if (existed) removeFromRedis(agentId)
    return existed
  },

  update(agentId: string, fields: Partial<AgentHandshakeData>): boolean {
    const entry = registry.get(agentId)
    if (!entry) return false
    Object.assign(entry.handshake, fields)
    entry.lastSeenAt = new Date()
    persistToRedis(agentId, entry)
    return true
  },

  /** Remove all agents from registry and Redis */
  async purgeAll(): Promise<number> {
    const count = registry.size
    registry.clear()
    const redis = getRedis()
    if (redis) await redis.del(REDIS_KEY).catch(() => {})
    return count
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
