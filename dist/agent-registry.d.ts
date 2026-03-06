export interface AgentHandshakeData {
    agent_id: string;
    display_name: string;
    source: string;
    version?: string;
    status: 'online' | 'standby' | 'offline' | 'degraded';
    capabilities: string[];
    allowed_tool_namespaces: string[];
    max_concurrent_calls?: number;
    default_thread?: string;
    registered_at?: string;
    last_seen_at?: string;
}
interface RegistryEntry {
    handshake: AgentHandshakeData;
    registeredAt: Date;
    lastSeenAt: Date;
    activeCalls: number;
}
export declare const AgentRegistry: {
    register(handshake: AgentHandshakeData): void;
    heartbeat(agentId: string): void;
    get(agentId: string): RegistryEntry | undefined;
    all(): RegistryEntry[];
    canCallTool(agentId: string, toolName: string): {
        allowed: boolean;
        reason?: string;
    };
    incrementActive(agentId: string): void;
    decrementActive(agentId: string): void;
    getActiveCalls(agentId: string): number;
};
export {};
//# sourceMappingURL=agent-registry.d.ts.map