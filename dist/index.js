import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// src/index.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";

// src/config.ts
import "dotenv/config";
function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}
function optional(key, fallback) {
  return process.env[key] ?? fallback;
}
var config = {
  port: parseInt(optional("PORT", "4000"), 10),
  nodeEnv: optional("NODE_ENV", "production"),
  // WidgeTDC Backend (Railway monolith)
  backendUrl: optional("BACKEND_URL", "https://backend-production-d3da.up.railway.app"),
  backendApiKey: required("BACKEND_API_KEY"),
  // AI providers (optional — only used for health checks)
  geminiApiKey: optional("GEMINI_API_KEY", ""),
  anthropicApiKey: optional("ANTHROPIC_API_KEY", ""),
  // Notion (optional — for Global Chat persistence)
  notionToken: optional("NOTION_TOKEN", ""),
  notionChatDbId: optional("NOTION_CHAT_DB_ID", ""),
  // Orchestrator identity
  orchestratorId: optional("ORCHESTRATOR_ID", "widgetdc-orchestrator-v1"),
  // WebSocket heartbeat interval (ms)
  wsHeartbeatMs: parseInt(optional("WS_HEARTBEAT_MS", "30000"), 10),
  // MCP tool call timeout (ms)
  mcpTimeoutMs: parseInt(optional("MCP_TIMEOUT_MS", "60000"), 10),
  // Rate limiting: max concurrent tool calls per agent
  maxConcurrentPerAgent: parseInt(optional("MAX_CONCURRENT_PER_AGENT", "5"), 10)
};

// src/logger.ts
import pino from "pino";
var logger = pino({
  level: config.nodeEnv === "production" ? "info" : "debug",
  ...config.nodeEnv !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" }
    }
  },
  base: { service: "orchestrator", version: "1.0.0" }
});
function childLogger(correlationId) {
  return logger.child({ correlation_id: correlationId });
}

// src/chat-broadcaster.ts
import { WebSocketServer, WebSocket } from "ws";
var connections = /* @__PURE__ */ new Map();
var wss = null;
function initWebSocket(server2) {
  wss = new WebSocketServer({ server: server2, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const agentId = new URL(req.url ?? "/", `http://localhost`).searchParams.get("agent_id") ?? "unknown";
    const conn = { ws, agentId, connectedAt: /* @__PURE__ */ new Date(), lastPingAt: /* @__PURE__ */ new Date() };
    connections.set(agentId, conn);
    logger.info({ agent_id: agentId, total_connections: connections.size }, "WebSocket connected");
    broadcastMessage({
      from: "System",
      to: "All",
      source: "system",
      type: "Message",
      message: `\u{1F7E2} ${agentId} connected to Orchestrator`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleIncomingMessage(agentId, msg);
      } catch (err) {
        logger.warn({ agent_id: agentId, err: String(err) }, "Invalid WS message");
      }
    });
    ws.on("close", () => {
      connections.delete(agentId);
      logger.info({ agent_id: agentId, total_connections: connections.size }, "WebSocket disconnected");
      broadcastMessage({
        from: "System",
        to: "All",
        source: "system",
        type: "Message",
        message: `\u{1F534} ${agentId} disconnected from Orchestrator`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    ws.on("error", (err) => {
      logger.error({ agent_id: agentId, err: err.message }, "WebSocket error");
    });
  });
  setInterval(() => {
    const now = Date.now();
    for (const [agentId, conn] of connections.entries()) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.ping();
        conn.lastPingAt = /* @__PURE__ */ new Date();
      } else if (now - conn.lastPingAt.getTime() > config.wsHeartbeatMs * 3) {
        logger.warn({ agent_id: agentId }, "Stale WS connection removed");
        connections.delete(agentId);
      }
    }
  }, config.wsHeartbeatMs);
  logger.info({ path: "/ws" }, "WebSocket server ready");
}
function handleIncomingMessage(fromAgentId, msg) {
  logger.debug({ from: msg.from, to: msg.to, type: msg.type }, "WS message received");
  if (msg.to === "All") {
    broadcastMessage(msg);
  } else {
    const target = connections.get(msg.to);
    if (target?.ws.readyState === WebSocket.OPEN) {
      target.ws.send(JSON.stringify(msg));
    } else {
      broadcastMessage(msg);
    }
  }
}
function broadcastMessage(msg) {
  const payload = JSON.stringify({ type: "message", data: msg });
  let sent = 0;
  for (const [, conn] of connections.entries()) {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(payload);
      sent++;
    }
  }
  logger.debug({ to: msg.to, type: msg.type, recipients: sent }, "Message broadcast");
}
function broadcastToolResult(callId, result, agentId) {
  broadcastMessage({
    from: "Orchestrator",
    to: agentId,
    source: "orchestrator",
    type: "ToolResult",
    message: `Tool call ${callId} completed`,
    call_id: callId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function getConnectionStats() {
  return {
    total: connections.size,
    agents: Array.from(connections.entries()).map(([id, c]) => ({
      agent_id: id,
      connected_at: c.connectedAt.toISOString(),
      last_ping: c.lastPingAt.toISOString(),
      state: c.ws.readyState === WebSocket.OPEN ? "open" : "closing"
    }))
  };
}

// src/routes/agents.ts
import { Router } from "express";

// src/agent-registry.ts
var registry = /* @__PURE__ */ new Map();
var AgentRegistry = {
  register(handshake) {
    const existing = registry.get(handshake.agent_id);
    registry.set(handshake.agent_id, {
      handshake,
      registeredAt: existing?.registeredAt ?? /* @__PURE__ */ new Date(),
      lastSeenAt: /* @__PURE__ */ new Date(),
      activeCalls: existing?.activeCalls ?? 0
    });
    logger.info({ agent_id: handshake.agent_id, status: handshake.status }, "Agent registered");
  },
  heartbeat(agentId) {
    const entry = registry.get(agentId);
    if (entry) entry.lastSeenAt = /* @__PURE__ */ new Date();
  },
  get(agentId) {
    return registry.get(agentId);
  },
  all() {
    return Array.from(registry.values());
  },
  canCallTool(agentId, toolName) {
    const entry = registry.get(agentId);
    if (!entry) return { allowed: false, reason: `Agent '${agentId}' not registered. POST /agents/register first.` };
    if (entry.handshake.status === "offline") return { allowed: false, reason: `Agent '${agentId}' is offline.` };
    const namespaces = entry.handshake.allowed_tool_namespaces;
    if (namespaces.includes("*")) return { allowed: true };
    const namespace = toolName.split(".")[0];
    if (!namespace) return { allowed: false, reason: `Invalid tool name '${toolName}'. Expected 'namespace.method'.` };
    if (namespaces.includes(namespace)) return { allowed: true };
    return { allowed: false, reason: `Agent '${agentId}' not authorized for '${namespace}'. Allowed: [${namespaces.join(", ")}]` };
  },
  incrementActive(agentId) {
    const e = registry.get(agentId);
    if (e) e.activeCalls++;
  },
  decrementActive(agentId) {
    const e = registry.get(agentId);
    if (e) e.activeCalls = Math.max(0, e.activeCalls - 1);
  },
  getActiveCalls(agentId) {
    return registry.get(agentId)?.activeCalls ?? 0;
  }
};

// src/routes/agents.ts
var agentsRouter = Router();
agentsRouter.post("/register", (req, res) => {
  const body = req.body;
  if (!body.agent_id || !body.display_name || !body.source || !body.status || !Array.isArray(body.capabilities) || !Array.isArray(body.allowed_tool_namespaces)) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Missing required fields: agent_id, display_name, source, status, capabilities[], allowed_tool_namespaces[]", status_code: 400 }
    });
    return;
  }
  AgentRegistry.register(body);
  res.json({
    success: true,
    data: { agent_id: body.agent_id, registered_at: (/* @__PURE__ */ new Date()).toISOString() }
  });
});
agentsRouter.get("/", (_req, res) => {
  const agents = AgentRegistry.all().map((e) => ({
    agent_id: e.handshake.agent_id,
    display_name: e.handshake.display_name,
    status: e.handshake.status,
    capabilities: e.handshake.capabilities,
    allowed_tool_namespaces: e.handshake.allowed_tool_namespaces,
    active_calls: e.activeCalls,
    registered_at: e.registeredAt.toISOString(),
    last_seen_at: e.lastSeenAt.toISOString()
  }));
  res.json({ success: true, data: { agents, total: agents.length } });
});
agentsRouter.post("/:id/heartbeat", (req, res) => {
  const { id } = req.params;
  const entry = AgentRegistry.get(id);
  if (!entry) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Agent '${id}' not registered`, status_code: 404 } });
    return;
  }
  AgentRegistry.heartbeat(id);
  res.json({ success: true, data: { agent_id: id, last_seen_at: (/* @__PURE__ */ new Date()).toISOString() } });
});

// src/routes/tools.ts
import { Router as Router2 } from "express";

// src/mcp-caller.ts
async function callMcpTool(opts) {
  const log = childLogger(opts.traceId ?? opts.callId);
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? config.mcpTimeoutMs;
  const url = `${config.backendUrl}/mcp/route`;
  const body = JSON.stringify({ tool: opts.toolName, payload: opts.args });
  log.debug({ tool: opts.toolName, url }, "MCP call start");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.backendApiKey}`,
        "X-Trace-Id": opts.traceId ?? opts.callId,
        "X-Call-Id": opts.callId
      },
      body,
      signal: controller.signal
    });
    clearTimeout(timer);
    const duration_ms = Date.now() - t0;
    if (!res.ok) {
      const errorText = await res.text().catch(() => `HTTP ${res.status}`);
      log.warn({ status: res.status, tool: opts.toolName, duration_ms }, "MCP call HTTP error");
      const errorCode = res.status === 401 || res.status === 403 ? "UNAUTHORIZED" : res.status === 404 ? "TOOL_NOT_FOUND" : res.status === 429 ? "RATE_LIMITED" : "BACKEND_ERROR";
      return {
        call_id: opts.callId,
        status: errorCode === "UNAUTHORIZED" ? "unauthorized" : errorCode === "RATE_LIMITED" ? "rate_limited" : "error",
        result: null,
        error_message: errorText,
        error_code: errorCode,
        duration_ms,
        trace_id: opts.traceId ?? null,
        completed_at: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      const result = await aggregateSseStream(res, opts.callId, log);
      const final_duration = Date.now() - t0;
      log.info({ tool: opts.toolName, duration_ms: final_duration }, "MCP SSE call complete");
      return {
        call_id: opts.callId,
        status: "success",
        result,
        error_message: null,
        error_code: null,
        duration_ms: final_duration,
        trace_id: opts.traceId ?? null,
        completed_at: (/* @__PURE__ */ new Date()).toISOString()
      };
    } else {
      const raw = await res.text();
      let result;
      try {
        const parsed = JSON.parse(raw);
        result = parsed?.result ?? parsed?.data ?? parsed;
      } catch {
        result = raw;
      }
      log.info({ tool: opts.toolName, duration_ms }, "MCP JSON call complete");
      return {
        call_id: opts.callId,
        status: "success",
        result,
        error_message: null,
        error_code: null,
        duration_ms,
        trace_id: opts.traceId ?? null,
        completed_at: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
  } catch (err) {
    clearTimeout(timer);
    const duration_ms = Date.now() - t0;
    if (err instanceof Error && err.name === "AbortError") {
      log.warn({ tool: opts.toolName, timeout_ms: timeoutMs }, "MCP call timed out");
      return {
        call_id: opts.callId,
        status: "timeout",
        result: null,
        error_message: `Call timed out after ${timeoutMs}ms`,
        error_code: "TIMEOUT",
        duration_ms,
        trace_id: opts.traceId ?? null,
        completed_at: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error({ tool: opts.toolName, err: message }, "MCP call failed");
    return {
      call_id: opts.callId,
      status: "error",
      result: null,
      error_message: message,
      error_code: "BACKEND_ERROR",
      duration_ms,
      trace_id: opts.traceId ?? null,
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
}
async function aggregateSseStream(res, callId, log) {
  const events = [];
  let lastResult = null;
  try {
    if (!res.body) {
      throw new Error("SSE response has no body");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed.startsWith("data:")) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]" || dataStr === "done") continue;
          try {
            const parsed = JSON.parse(dataStr);
            events.push(parsed);
            if (parsed?.result !== void 0) lastResult = parsed.result;
            else if (parsed?.content !== void 0) lastResult = parsed.content;
            else if (parsed?.type !== "ping" && parsed?.type !== "heartbeat") lastResult = parsed;
          } catch {
            if (dataStr.length > 0) lastResult = dataStr;
          }
        }
      }
    }
    log.debug({ event_count: events.length, call_id: callId }, "SSE stream aggregated");
    if (lastResult !== null && lastResult !== void 0) return lastResult;
    if (events.length === 1) return events[0];
    if (events.length > 1) return events;
    return null;
  } catch (err) {
    log.warn({ err: String(err), call_id: callId }, "SSE stream parse error");
    throw Object.assign(new Error(`SSE_PARSE_ERROR: ${err}`), { code: "SSE_PARSE_ERROR" });
  }
}

// src/routes/tools.ts
var toolsRouter = Router2();
toolsRouter.post("/call", async (req, res) => {
  const body = req.body;
  if (!body.call_id || !body.agent_id || !body.tool_name || typeof body.arguments !== "object") {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Required: call_id, agent_id, tool_name, arguments (object)", status_code: 400 }
    });
    return;
  }
  const call = body;
  const log = childLogger(call.trace_id ?? call.call_id);
  const acl = AgentRegistry.canCallTool(call.agent_id, call.tool_name);
  if (!acl.allowed) {
    log.warn({ agent_id: call.agent_id, tool: call.tool_name }, `ACL denied: ${acl.reason}`);
    res.status(403).json({
      call_id: call.call_id,
      status: "unauthorized",
      result: null,
      error_message: acl.reason,
      error_code: "UNAUTHORIZED",
      duration_ms: 0,
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  const active = AgentRegistry.getActiveCalls(call.agent_id);
  if (active >= config.maxConcurrentPerAgent) {
    res.status(429).json({
      call_id: call.call_id,
      status: "rate_limited",
      result: null,
      error_message: `Max ${config.maxConcurrentPerAgent} concurrent calls`,
      error_code: "RATE_LIMITED",
      duration_ms: 0,
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  AgentRegistry.incrementActive(call.agent_id);
  log.info({ agent_id: call.agent_id, tool: call.tool_name }, "Tool call start");
  try {
    const result = await callMcpTool({
      toolName: call.tool_name,
      args: call.arguments,
      callId: call.call_id,
      traceId: call.trace_id,
      timeoutMs: call.timeout_ms
    });
    res.json(result);
    if (result.status === "success") {
      broadcastToolResult(call.call_id, result.result, call.agent_id);
    }
    log.info({ tool: call.tool_name, status: result.status, ms: result.duration_ms }, "Tool call done");
  } finally {
    AgentRegistry.decrementActive(call.agent_id);
  }
});
toolsRouter.get("/namespaces", async (_req, res) => {
  try {
    const r = await fetch(`${config.backendUrl}/mcp/tools`, {
      headers: { Authorization: `Bearer ${config.backendApiKey}` }
    });
    if (!r.ok) {
      res.status(502).json({ success: false, error: { message: `Backend ${r.status}` } });
      return;
    }
    const tools = await r.json();
    res.json({ success: true, data: tools });
  } catch (err) {
    res.status(502).json({ success: false, error: { message: String(err) } });
  }
});

// src/routes/chat.ts
import { Router as Router3 } from "express";
var chatRouter = Router3();
chatRouter.post("/message", (req, res) => {
  const body = req.body;
  if (!body.from || !body.to || !body.source || !body.type || !body.message) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Required: from, to, source, type, message", status_code: 400 }
    });
    return;
  }
  const msg = { ...body, timestamp: (/* @__PURE__ */ new Date()).toISOString() };
  broadcastMessage(msg);
  logger.info({ from: msg.from, to: msg.to, type: msg.type }, "Chat message broadcast");
  res.json({ success: true, data: { timestamp: msg.timestamp } });
});
chatRouter.get("/ws-stats", (_req, res) => {
  res.json({ success: true, data: getConnectionStats() });
});

// src/index.ts
var app = express();
var server = createServer(app);
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, "Request");
  next();
});
app.use("/agents", agentsRouter);
app.use("/tools", toolsRouter);
app.use("/chat", chatRouter);
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "widgetdc-orchestrator",
    version: "1.0.0",
    uptime_seconds: Math.floor(process.uptime()),
    agents_registered: AgentRegistry.all().length,
    ws_connections: getConnectionStats().total,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/", (_req, res) => {
  const agents = AgentRegistry.all();
  const ws = getConnectionStats();
  const agentRows = agents.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:#888">No agents registered yet</td></tr>' : agents.map((a) => `
      <tr>
        <td><strong>${a.handshake.agent_id}</strong></td>
        <td>${a.handshake.display_name}</td>
        <td><span class="badge badge-${a.handshake.status}">${a.handshake.status}</span></td>
        <td>${a.handshake.allowed_tool_namespaces.join(", ")}</td>
        <td>${a.activeCalls}</td>
      </tr>`).join("");
  const wsRows = ws.agents.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:#888">No WebSocket connections</td></tr>' : ws.agents.map((c) => `
      <tr>
        <td>${c.agent_id}</td>
        <td><span class="badge badge-online">${c.state}</span></td>
        <td>${c.connected_at}</td>
      </tr>`).join("");
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="10">
  <title>WidgeTDC Orchestrator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
    .header { background: linear-gradient(135deg, #1a1f2e 0%, #0d1321 100%); border-bottom: 1px solid #2d3748; padding: 24px 32px; }
    .header h1 { font-size: 1.75rem; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
    .header h1 span { color: #6366f1; }
    .header p { color: #718096; margin-top: 4px; font-size: 0.875rem; }
    .container { max-width: 1200px; margin: 0 auto; padding: 32px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 12px; padding: 20px; }
    .card-value { font-size: 2rem; font-weight: 700; color: #6366f1; }
    .card-label { color: #718096; font-size: 0.8rem; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .section { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .section h2 { font-size: 1rem; font-weight: 600; color: #a0aec0; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; color: #718096; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #2d3748; }
    td { padding: 12px; border-bottom: 1px solid #1e2433; font-size: 0.875rem; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .badge { padding: 2px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; }
    .badge-online, .badge-open { background: #14532d; color: #4ade80; }
    .badge-standby { background: #713f12; color: #fbbf24; }
    .badge-offline { background: #2d1b1b; color: #f87171; }
    .badge-degraded { background: #2d1b1b; color: #f87171; }
    .endpoint { background: #0f1117; border: 1px solid #2d3748; border-radius: 8px; padding: 16px; margin-bottom: 8px; }
    .endpoint code { font-family: 'Fira Code', monospace; font-size: 0.875rem; }
    .method { padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; margin-right: 8px; }
    .method-post { background: #1a2e3b; color: #38bdf8; }
    .method-get { background: #14532d; color: #4ade80; }
    .method-ws { background: #3b1f5e; color: #c084fc; }
    .desc { color: #718096; font-size: 0.8rem; margin-top: 6px; }
    .url-badge { background: #2d3748; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 0.8rem; color: #a0aec0; display: inline-block; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>WidgeTDC <span>Orchestrator</span></h1>
    <p>Multi-agent coordination layer \xB7 Railway deployment \xB7 Auto-refresh every 10s</p>
  </div>
  <div class="container">
    <div class="grid">
      <div class="card">
        <div class="card-value">${agents.length}</div>
        <div class="card-label">Agents Registered</div>
      </div>
      <div class="card">
        <div class="card-value">${ws.total}</div>
        <div class="card-label">WS Connections</div>
      </div>
      <div class="card">
        <div class="card-value">${Math.floor(process.uptime())}s</div>
        <div class="card-label">Uptime</div>
      </div>
      <div class="card">
        <div class="card-value" style="color:#4ade80">\u25CF</div>
        <div class="card-label">Status: Healthy</div>
      </div>
    </div>

    <div class="section">
      <h2>Registered Agents</h2>
      <table>
        <thead><tr><th>Agent ID</th><th>Display Name</th><th>Status</th><th>Tool Namespaces</th><th>Active Calls</th></tr></thead>
        <tbody>${agentRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>WebSocket Connections</h2>
      <table>
        <thead><tr><th>Agent ID</th><th>State</th><th>Connected At</th></tr></thead>
        <tbody>${wsRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>API Endpoints</h2>
      <div class="endpoint">
        <div><span class="method method-post">POST</span><code>/tools/call</code></div>
        <div class="desc">Submit an OrchestratorToolCall \u2192 returns OrchestratorToolResult. Requires registered agent_id.</div>
      </div>
      <div class="endpoint">
        <div><span class="method method-get">GET</span><code>/tools/namespaces</code></div>
        <div class="desc">Discover available MCP tool namespaces from Railway backend.</div>
      </div>
      <div class="endpoint">
        <div><span class="method method-post">POST</span><code>/agents/register</code></div>
        <div class="desc">Register an agent with capabilities and tool ACL.</div>
      </div>
      <div class="endpoint">
        <div><span class="method method-get">GET</span><code>/agents</code></div>
        <div class="desc">List all registered agents.</div>
      </div>
      <div class="endpoint">
        <div><span class="method method-post">POST</span><code>/chat/message</code></div>
        <div class="desc">Send an AgentMessage \u2014 broadcasts to all WebSocket connections.</div>
      </div>
      <div class="endpoint">
        <div><span class="method method-ws">WS</span><code>/ws?agent_id=CAPTAIN_CLAUDE</code></div>
        <div class="desc">Real-time bidirectional AgentMessage channel.</div>
      </div>
      <div class="endpoint">
        <div><span class="method method-get">GET</span><code>/health</code></div>
        <div class="desc">Health check endpoint for Railway uptime monitoring.</div>
      </div>
    </div>

    <div class="section">
      <h2>Backend Configuration</h2>
      <div class="url-badge">Backend URL: ${config.backendUrl}</div><br>
      <div class="url-badge">Orchestrator ID: ${config.orchestratorId}</div><br>
      <div class="url-badge">Node ENV: ${config.nodeEnv}</div>
    </div>
  </div>
</body>
</html>`);
});
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found`, status_code: 404 }
  });
});
app.use((err, _req, res, _next) => {
  logger.error({ err: err.message, stack: err.stack }, "Unhandled error");
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Internal server error", status_code: 500 }
  });
});
initWebSocket(server);
server.listen(config.port, () => {
  logger.info(
    { port: config.port, backend: config.backendUrl, env: config.nodeEnv },
    "\u{1F680} WidgeTDC Orchestrator ready"
  );
});
process.on("SIGTERM", () => {
  logger.info("SIGTERM received \u2014 shutting down gracefully");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
