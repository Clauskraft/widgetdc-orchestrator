/**
 * agent-registry.ts — In-memory agent registry.
 */
import { logger } from './logger.js';
const registry = new Map();
export const AgentRegistry = {
    register(handshake) {
        const existing = registry.get(handshake.agent_id);
        registry.set(handshake.agent_id, {
            handshake,
            registeredAt: existing?.registeredAt ?? new Date(),
            lastSeenAt: new Date(),
            activeCalls: existing?.activeCalls ?? 0,
        });
        logger.info({ agent_id: handshake.agent_id, status: handshake.status }, 'Agent registered');
    },
    heartbeat(agentId) {
        const entry = registry.get(agentId);
        if (entry)
            entry.lastSeenAt = new Date();
    },
    get(agentId) {
        return registry.get(agentId);
    },
    all() {
        return Array.from(registry.values());
    },
    canCallTool(agentId, toolName) {
        const entry = registry.get(agentId);
        if (!entry)
            return { allowed: false, reason: `Agent '${agentId}' not registered. POST /agents/register first.` };
        if (entry.handshake.status === 'offline')
            return { allowed: false, reason: `Agent '${agentId}' is offline.` };
        const namespaces = entry.handshake.allowed_tool_namespaces;
        if (namespaces.includes('*'))
            return { allowed: true };
        const namespace = toolName.split('.')[0];
        if (!namespace)
            return { allowed: false, reason: `Invalid tool name '${toolName}'. Expected 'namespace.method'.` };
        if (namespaces.includes(namespace))
            return { allowed: true };
        return { allowed: false, reason: `Agent '${agentId}' not authorized for '${namespace}'. Allowed: [${namespaces.join(', ')}]` };
    },
    incrementActive(agentId) {
        const e = registry.get(agentId);
        if (e)
            e.activeCalls++;
    },
    decrementActive(agentId) {
        const e = registry.get(agentId);
        if (e)
            e.activeCalls = Math.max(0, e.activeCalls - 1);
    },
    getActiveCalls(agentId) {
        return registry.get(agentId)?.activeCalls ?? 0;
    },
};
//# sourceMappingURL=agent-registry.js.map