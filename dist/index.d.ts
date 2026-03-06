/**
 * index.ts — WidgeTDC Orchestrator Entry Point
 *
 * Exposes:
 *   POST /tools/call          — Agent → Orchestrator → Railway MCP backend
 *   GET  /tools/namespaces    — Discover available MCP tools
 *   POST /agents/register     — Register agent + declare capabilities
 *   GET  /agents              — List all registered agents
 *   POST /agents/:id/heartbeat
 *   POST /chat/message        — Send AgentMessage over REST (broadcast to WS)
 *   GET  /chat/ws-stats       — WebSocket connection stats
 *   WS   /ws?agent_id=X       — Real-time AgentMessage channel
 *   GET  /health              — Health check (Railway)
 *   GET  /                    — Status dashboard (HTML)
 */
import 'dotenv/config';
//# sourceMappingURL=index.d.ts.map