export declare function isSlackEnabled(): boolean;
export declare function notifyAgentRegistered(agentId: string, displayName: string, namespaces: string[]): void;
export declare function notifyToolCall(agentId: string, toolName: string, status: string, durationMs: number, errorMessage?: string | null): void;
export declare function notifyChatMessage(from: string, to: string, message: string): void;
//# sourceMappingURL=slack.d.ts.map