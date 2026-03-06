/**
 * routes/tools.ts — MCP tool call endpoint.
 */
import { Router } from 'express';
import { AgentRegistry } from '../agent-registry.js';
import { callMcpTool } from '../mcp-caller.js';
import { broadcastToolResult } from '../chat-broadcaster.js';
import { config } from '../config.js';
import { childLogger } from '../logger.js';
export const toolsRouter = Router();
toolsRouter.post('/call', async (req, res) => {
    const body = req.body;
    // Basic validation
    if (!body.call_id || !body.agent_id || !body.tool_name || typeof body.arguments !== 'object') {
        res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Required: call_id, agent_id, tool_name, arguments (object)', status_code: 400 },
        });
        return;
    }
    const call = body;
    const log = childLogger(call.trace_id ?? call.call_id);
    // ACL check
    const acl = AgentRegistry.canCallTool(call.agent_id, call.tool_name);
    if (!acl.allowed) {
        log.warn({ agent_id: call.agent_id, tool: call.tool_name }, `ACL denied: ${acl.reason}`);
        res.status(403).json({
            call_id: call.call_id, status: 'unauthorized', result: null,
            error_message: acl.reason, error_code: 'UNAUTHORIZED',
            duration_ms: 0, completed_at: new Date().toISOString(),
        });
        return;
    }
    // Concurrency limit
    const active = AgentRegistry.getActiveCalls(call.agent_id);
    if (active >= config.maxConcurrentPerAgent) {
        res.status(429).json({
            call_id: call.call_id, status: 'rate_limited', result: null,
            error_message: `Max ${config.maxConcurrentPerAgent} concurrent calls`,
            error_code: 'RATE_LIMITED', duration_ms: 0, completed_at: new Date().toISOString(),
        });
        return;
    }
    AgentRegistry.incrementActive(call.agent_id);
    log.info({ agent_id: call.agent_id, tool: call.tool_name }, 'Tool call start');
    try {
        const result = await callMcpTool({
            toolName: call.tool_name,
            args: call.arguments,
            callId: call.call_id,
            traceId: call.trace_id,
            timeoutMs: call.timeout_ms,
        });
        res.json(result);
        if (result.status === 'success') {
            broadcastToolResult(call.call_id, result.result, call.agent_id);
        }
        log.info({ tool: call.tool_name, status: result.status, ms: result.duration_ms }, 'Tool call done');
    }
    finally {
        AgentRegistry.decrementActive(call.agent_id);
    }
});
toolsRouter.get('/namespaces', async (_req, res) => {
    try {
        const r = await fetch(`${config.backendUrl}/mcp/tools`, {
            headers: { Authorization: `Bearer ${config.backendApiKey}` },
        });
        if (!r.ok) {
            res.status(502).json({ success: false, error: { message: `Backend ${r.status}` } });
            return;
        }
        const tools = await r.json();
        res.json({ success: true, data: tools });
    }
    catch (err) {
        res.status(502).json({ success: false, error: { message: String(err) } });
    }
});
//# sourceMappingURL=tools.js.map