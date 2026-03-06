/**
 * config.ts — Centralised configuration from environment variables.
 * All secrets live here. Never imported by contracts or domain code.
 */
import 'dotenv/config';
export declare const config: {
    readonly port: number;
    readonly nodeEnv: string;
    readonly backendUrl: string;
    readonly backendApiKey: string;
    readonly geminiApiKey: string;
    readonly anthropicApiKey: string;
    readonly notionToken: string;
    readonly notionChatDbId: string;
    readonly orchestratorId: string;
    readonly wsHeartbeatMs: number;
    readonly mcpTimeoutMs: number;
    readonly maxConcurrentPerAgent: number;
};
//# sourceMappingURL=config.d.ts.map