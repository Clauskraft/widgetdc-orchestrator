import type { Server } from 'http';
import type { AgentMessage } from '@widgetdc/contracts/orchestrator';
export declare function initWebSocket(server: Server): void;
export declare function broadcastMessage(msg: AgentMessage): void;
export declare function broadcastToolResult(callId: string, result: unknown, agentId: string): void;
export declare function getConnectionStats(): {
    total: number;
    agents: {
        agent_id: string;
        connected_at: string;
        last_ping: string;
        state: string;
    }[];
};
//# sourceMappingURL=chat-broadcaster.d.ts.map