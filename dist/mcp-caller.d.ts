/**
 * mcp-caller.ts — Calls the WidgeTDC Railway MCP backend.
 *
 * The backend exposes MCP tools via:
 *   POST /mcp/route  { tool: string, payload: object }
 *   Authorization: Bearer <BACKEND_API_KEY>
 *
 * It returns either:
 *   { result: any }          — immediate response
 *   SSE stream               — streaming response (aggregated here)
 *
 * This module handles both cases and always returns a plain object.
 */
import type { OrchestratorToolResult } from '@widgetdc/contracts/orchestrator';
interface McpCallOptions {
    toolName: string;
    args: Record<string, unknown>;
    callId: string;
    traceId?: string;
    timeoutMs?: number;
}
export declare function callMcpTool(opts: McpCallOptions): Promise<OrchestratorToolResult>;
export {};
//# sourceMappingURL=mcp-caller.d.ts.map