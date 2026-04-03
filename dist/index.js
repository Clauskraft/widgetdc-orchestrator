import { createRequire } from 'module'; const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/tracing.ts
import { trace, SpanStatusCode } from "@opentelemetry/api";
async function withMcpSpan(toolName, callId, fn) {
  return mcpTracer.startActiveSpan(`mcp.${toolName}`, async (span) => {
    span.setAttribute("mcp.tool", toolName);
    span.setAttribute("mcp.call_id", callId);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
var SERVICE_NAME, endpoint, mcpTracer;
var init_tracing = __esm({
  "src/tracing.ts"() {
    "use strict";
    SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "widgetdc-orchestrator";
    endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (endpoint) {
      Promise.all([
        import("@opentelemetry/sdk-trace-node"),
        import("@opentelemetry/exporter-trace-otlp-http"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/semantic-conventions")
      ]).then(([{ NodeTracerProvider, BatchSpanProcessor }, { OTLPTraceExporter }, { Resource }, semconv]) => {
        const ATTR_SERVICE_NAME = semconv.ATTR_SERVICE_NAME ?? "service.name";
        const provider = new NodeTracerProvider({
          resource: new Resource({ [ATTR_SERVICE_NAME]: SERVICE_NAME })
        });
        provider.addSpanProcessor(
          new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))
        );
        provider.register();
        console.log(`\u{1F4E1} OTel tracing active \u2192 ${endpoint}`);
      }).catch((err) => {
        console.warn(`\u26A0\uFE0F OTel setup failed (non-fatal): ${err}`);
      });
    }
    mcpTracer = trace.getTracer("mcp-caller", "1.0.0");
  }
});

// src/config.ts
var config_exports = {};
__export(config_exports, {
  config: () => config
});
import "dotenv/config";
function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}
function optional(key, fallback) {
  return process.env[key] ?? fallback;
}
var config;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    config = {
      port: parseInt(optional("PORT", "4000"), 10),
      nodeEnv: optional("NODE_ENV", "production"),
      // WidgeTDC Backend (Railway monolith)
      backendUrl: optional("BACKEND_URL", "https://backend-production-d3da.up.railway.app"),
      backendApiKey: required("BACKEND_API_KEY"),
      // LLM providers (for direct LLM chat proxy)
      deepseekApiKey: optional("DEEPSEEK_API_KEY", ""),
      dashscopeApiKey: optional("DASHSCOPE_API_KEY", ""),
      // Qwen
      geminiApiKey: optional("GEMINI_API_KEY", ""),
      openaiApiKey: optional("OPENAI_API_KEY", ""),
      anthropicApiKey: optional("ANTHROPIC_API_KEY", ""),
      groqApiKey: optional("GROQ_API_KEY", ""),
      // RLM Engine (optional — cognitive reasoning proxy)
      rlmUrl: optional("RLM_URL", "https://rlm-engine-production.up.railway.app"),
      // Redis (optional — for agent registry persistence across restarts)
      redisUrl: optional("REDIS_URL", ""),
      // Orchestrator API key (required for /agents/register and /tools/call)
      orchestratorApiKey: optional("ORCHESTRATOR_API_KEY", ""),
      // OpenClaw gateway (optional — for terminal/agent spawning)
      openclawUrl: optional("OPENCLAW_URL", ""),
      openclawToken: optional("OPENCLAW_GATEWAY_TOKEN", ""),
      // LibreChat (optional — for agent visibility + health)
      libreChatUrl: optional("LIBRECHAT_URL", ""),
      // Orchestrator identity
      orchestratorId: optional("ORCHESTRATOR_ID", "widgetdc-orchestrator-v1"),
      // WebSocket heartbeat interval (ms)
      wsHeartbeatMs: parseInt(optional("WS_HEARTBEAT_MS", "30000"), 10),
      // MCP tool call timeout (ms)
      mcpTimeoutMs: parseInt(optional("MCP_TIMEOUT_MS", "60000"), 10),
      // Rate limiting: max concurrent tool calls per agent
      maxConcurrentPerAgent: parseInt(optional("MAX_CONCURRENT_PER_AGENT", "5"), 10),
      agentOpenAccess: optional("AGENT_OPEN_ACCESS", "true") === "true",
      // OpenTelemetry (LIN-589) — set OTEL_EXPORTER_OTLP_ENDPOINT to activate tracing
      otelEnabled: !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    };
  }
});

// src/logger.ts
import pino from "pino";
function childLogger(correlationId) {
  return logger.child({ correlation_id: correlationId });
}
var logger;
var init_logger = __esm({
  "src/logger.ts"() {
    "use strict";
    init_config();
    logger = pino({
      level: config.nodeEnv === "production" ? "info" : "debug",
      ...config.nodeEnv !== "production" && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" }
        }
      },
      base: { service: "orchestrator", version: "1.0.0" }
    });
  }
});

// src/sse.ts
function handleSSE(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const clientId = `sse-${Date.now().toString(36)}`;
  const client = { id: clientId, res, connectedAt: /* @__PURE__ */ new Date() };
  clients.push(client);
  res.write(`event: connected
data: ${JSON.stringify({ id: clientId })}

`);
  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 3e4);
  req.on("close", () => {
    clearInterval(keepAlive);
    const idx = clients.indexOf(client);
    if (idx >= 0) clients.splice(idx, 1);
    logger.debug({ clientId }, "SSE client disconnected");
  });
}
function broadcastSSE(event, data) {
  const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].res.write(payload);
    } catch {
      clients.splice(i, 1);
    }
  }
}
function getSSEClientCount() {
  return clients.length;
}
var clients;
var init_sse = __esm({
  "src/sse.ts"() {
    "use strict";
    init_logger();
    clients = [];
  }
});

// src/redis.ts
import Redis from "ioredis";
function getRedis() {
  return redis;
}
function isRedisEnabled() {
  return redis !== null;
}
async function initRedis() {
  if (!redisUrl) {
    logger.info("REDIS_URL not set \u2014 agent registry will be in-memory only (volatile)");
    return;
  }
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2e3);
      },
      lazyConnect: true
    });
    await redis.connect();
    logger.info("Redis connected \u2014 agent registry persistence enabled");
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis connection failed \u2014 falling back to in-memory only");
    redis = null;
  }
}
var redisUrl, redis;
var init_redis = __esm({
  "src/redis.ts"() {
    "use strict";
    init_logger();
    redisUrl = process.env["REDIS_URL"] ?? "";
    redis = null;
  }
});

// src/chat-store.ts
function msgId() {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
async function storeMessage(msg) {
  memoryMessages.unshift(msg);
  if (memoryMessages.length > MAX_MESSAGES) memoryMessages = memoryMessages.slice(0, MAX_MESSAGES);
  try {
    if (isRedisEnabled()) {
      const redis2 = getRedis();
      if (redis2) {
        await redis2.lpush(REDIS_KEY, JSON.stringify(msg));
        await redis2.ltrim(REDIS_KEY, 0, MAX_MESSAGES - 1);
        await redis2.expire(REDIS_KEY, TTL_SECONDS);
        if (msg.thread_id) {
          const threadMeta = JSON.stringify({
            thread_id: msg.thread_id,
            last_reply: msg.timestamp,
            reply_count: 0
            // incremented separately
          });
          await redis2.hset(REDIS_THREADS_KEY, msg.thread_id, threadMeta);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Chat store Redis write failed");
  }
}
async function getHistory(limit = 100, offset = 0, target) {
  let messages = [];
  try {
    if (isRedisEnabled()) {
      const redis2 = getRedis();
      if (redis2) {
        const raw = await redis2.lrange(REDIS_KEY, offset, offset + limit * 2 - 1);
        messages = raw.map((r) => JSON.parse(r));
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Chat store Redis read failed");
  }
  if (messages.length === 0) {
    messages = memoryMessages.slice(offset, offset + limit * 2);
  }
  if (target && target !== "All") {
    messages = messages.filter(
      (m) => m.from === target || m.to === target || m.to === "All"
    );
  }
  return messages.slice(0, limit);
}
async function getThread(threadId) {
  const all = await getHistory(MAX_MESSAGES, 0);
  return all.filter((m) => m.thread_id === threadId || m.id === threadId).sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
}
async function searchMessages(query, limit = 50) {
  const all = await getHistory(MAX_MESSAGES, 0);
  const q = query.toLowerCase();
  return all.filter((m) => (m.message || "").toLowerCase().includes(q) || (m.from || "").toLowerCase().includes(q)).slice(0, limit);
}
async function togglePin(messageId, pin) {
  try {
    if (isRedisEnabled()) {
      const redis2 = getRedis();
      if (redis2) {
        if (pin) await redis2.sadd(REDIS_PINS_KEY, messageId);
        else await redis2.srem(REDIS_PINS_KEY, messageId);
      }
    }
  } catch {
  }
  const msg = memoryMessages.find((m) => m.id === messageId);
  if (msg) msg.pinned = pin;
}
async function getPinnedMessages() {
  let pinnedIds = [];
  try {
    if (isRedisEnabled()) {
      const redis2 = getRedis();
      if (redis2) pinnedIds = await redis2.smembers(REDIS_PINS_KEY);
    }
  } catch {
  }
  if (pinnedIds.length === 0) {
    return memoryMessages.filter((m) => m.pinned);
  }
  const all = await getHistory(MAX_MESSAGES, 0);
  return all.filter((m) => pinnedIds.includes(m.id));
}
async function hydrateMessages() {
  try {
    if (isRedisEnabled()) {
      const redis2 = getRedis();
      if (redis2) {
        const raw = await redis2.lrange(REDIS_KEY, 0, MAX_MESSAGES - 1);
        memoryMessages = raw.map((r) => JSON.parse(r));
        logger.info({ count: memoryMessages.length }, "Chat history hydrated from Redis");
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Chat history hydration failed");
  }
}
function getConversationSummaries() {
  const convMap = /* @__PURE__ */ new Map();
  for (const m of memoryMessages) {
    const partner = m.from === "command-center" ? m.to : m.from;
    if (!partner) continue;
    const existing = convMap.get(partner);
    if (!existing) {
      convMap.set(partner, {
        lastMessage: (m.message || "").slice(0, 80),
        lastTime: m.timestamp,
        count: 1
      });
    } else {
      existing.count++;
      if (m.timestamp > existing.lastTime) {
        existing.lastMessage = (m.message || "").slice(0, 80);
        existing.lastTime = m.timestamp;
      }
    }
  }
  return Array.from(convMap.entries()).map(([target, data]) => ({ target, ...data, messageCount: data.count })).sort((a, b) => (b.lastTime || "").localeCompare(a.lastTime || ""));
}
var REDIS_KEY, REDIS_THREADS_KEY, REDIS_PINS_KEY, MAX_MESSAGES, TTL_SECONDS, memoryMessages;
var init_chat_store = __esm({
  "src/chat-store.ts"() {
    "use strict";
    init_redis();
    init_logger();
    REDIS_KEY = "orchestrator:messages";
    REDIS_THREADS_KEY = "orchestrator:threads";
    REDIS_PINS_KEY = "orchestrator:pinned";
    MAX_MESSAGES = 2e3;
    TTL_SECONDS = 7 * 24 * 3600;
    memoryMessages = [];
  }
});

// src/chat-broadcaster.ts
import { WebSocketServer, WebSocket } from "ws";
function initWebSocket(server2) {
  wss = new WebSocketServer({ server: server2, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const agentId = url.searchParams.get("agent_id") ?? "unknown";
    if (config.orchestratorApiKey) {
      const token = url.searchParams.get("api_key") ?? (req.headers["authorization"]?.startsWith("Bearer ") ? req.headers["authorization"].slice(7) : "") ?? "";
      if (token !== config.orchestratorApiKey) {
        logger.warn({ agent_id: agentId }, "WebSocket auth rejected");
        ws.close(4401, "Unauthorized");
        return;
      }
    }
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
    const storedMsg = {
      id: msg.id || msgId(),
      from: msg.from,
      to: msg.to,
      source: msg.source,
      type: msg.type,
      message: msg.message,
      timestamp: msg.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
      thread_id: msg.thread_id,
      parent_id: msg.parent_id,
      metadata: msg.metadata
    };
    const payload = JSON.stringify({ type: "message", data: storedMsg });
    if (target?.ws.readyState === WebSocket.OPEN) {
      target.ws.send(payload);
      const sender = connections.get(fromAgentId);
      if (sender?.ws.readyState === WebSocket.OPEN && fromAgentId !== msg.to) {
        sender.ws.send(payload);
      }
      storeMessage(storedMsg).catch(() => {
      });
      broadcastSSE("message", storedMsg);
    } else {
      storeMessage(storedMsg).catch(() => {
      });
      const sender = connections.get(fromAgentId);
      if (sender?.ws.readyState === WebSocket.OPEN) {
        sender.ws.send(payload);
        sender.ws.send(JSON.stringify({
          type: "message",
          data: {
            id: msgId(),
            from: "System",
            to: fromAgentId,
            source: "system",
            type: "Alert",
            message: `${msg.to} is offline. Message saved.`,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          }
        }));
      }
      logger.info({ from: msg.from, to: msg.to }, "DM stored for offline agent (not broadcast)");
    }
  }
}
function broadcastMessage(msg) {
  const storedMsg = {
    id: msg.id || msgId(),
    from: msg.from,
    to: msg.to,
    source: msg.source,
    type: msg.type,
    message: msg.message,
    timestamp: msg.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
    thread_id: msg.thread_id,
    parent_id: msg.parent_id,
    files: msg.files,
    metadata: msg.metadata
  };
  storeMessage(storedMsg).catch(() => {
  });
  broadcastSSE("message", { ...msg, id: storedMsg.id });
  const payload = JSON.stringify({ type: "message", data: { ...msg, id: storedMsg.id } });
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
var connections, wss;
var init_chat_broadcaster = __esm({
  "src/chat-broadcaster.ts"() {
    "use strict";
    init_logger();
    init_config();
    init_sse();
    init_chat_store();
    connections = /* @__PURE__ */ new Map();
    wss = null;
  }
});

// src/agent-registry.ts
function persistToRedis(agentId, entry) {
  const redis2 = getRedis();
  if (!redis2) return;
  const serialised = JSON.stringify({
    handshake: entry.handshake,
    registeredAt: entry.registeredAt.toISOString(),
    lastSeenAt: entry.lastSeenAt.toISOString()
  });
  redis2.hset(REDIS_KEY2, agentId, serialised).catch((err) => {
    logger.warn({ err: String(err), agent_id: agentId }, "Redis persist failed");
  });
}
function removeFromRedis(agentId) {
  const redis2 = getRedis();
  if (!redis2) return;
  redis2.hdel(REDIS_KEY2, agentId).catch(() => {
  });
}
var REDIS_KEY2, registry, AgentRegistry;
var init_agent_registry = __esm({
  "src/agent-registry.ts"() {
    "use strict";
    init_logger();
    init_redis();
    REDIS_KEY2 = "orchestrator:agents";
    registry = /* @__PURE__ */ new Map();
    AgentRegistry = {
      /** Hydrate registry from Redis on startup */
      async hydrate() {
        const redis2 = getRedis();
        if (!redis2) return;
        try {
          const all = await redis2.hgetall(REDIS_KEY2);
          let count = 0;
          for (const [agentId, json] of Object.entries(all)) {
            try {
              const data = JSON.parse(json);
              registry.set(agentId, {
                handshake: data.handshake,
                registeredAt: new Date(data.registeredAt),
                lastSeenAt: new Date(data.lastSeenAt),
                activeCalls: 0
                // reset on restart
              });
              count++;
            } catch {
              logger.warn({ agent_id: agentId }, "Skipped corrupt Redis entry");
            }
          }
          if (count > 0) {
            logger.info({ count }, "Hydrated agent registry from Redis");
          }
        } catch (err) {
          logger.warn({ err: String(err) }, "Redis hydration failed \u2014 starting with empty registry");
        }
      },
      register(handshake) {
        const existing = registry.get(handshake.agent_id);
        const entry = {
          handshake,
          registeredAt: existing?.registeredAt ?? /* @__PURE__ */ new Date(),
          lastSeenAt: /* @__PURE__ */ new Date(),
          activeCalls: existing?.activeCalls ?? 0
        };
        registry.set(handshake.agent_id, entry);
        persistToRedis(handshake.agent_id, entry);
        logger.info({ agent_id: handshake.agent_id, status: handshake.status }, "Agent registered");
      },
      heartbeat(agentId) {
        const entry = registry.get(agentId);
        if (entry) {
          entry.lastSeenAt = /* @__PURE__ */ new Date();
          persistToRedis(agentId, entry);
        }
      },
      get(agentId) {
        return registry.get(agentId);
      },
      all() {
        return Array.from(registry.values());
      },
      canCallTool(agentId, toolName) {
        let entry = registry.get(agentId);
        if (!entry) {
          const autoHandshake = {
            agent_id: agentId,
            display_name: agentId,
            source: "auto-discovered",
            status: "online",
            capabilities: ["mcp_tools"],
            allowed_tool_namespaces: ["*"],
            registered_at: (/* @__PURE__ */ new Date()).toISOString(),
            last_seen_at: (/* @__PURE__ */ new Date()).toISOString()
          };
          const autoEntry = {
            handshake: autoHandshake,
            registeredAt: /* @__PURE__ */ new Date(),
            lastSeenAt: /* @__PURE__ */ new Date(),
            activeCalls: 0
          };
          registry.set(agentId, autoEntry);
          persistToRedis(agentId, autoEntry);
          logger.info({ agent_id: agentId }, "Auto-discovered and registered new agent");
          entry = autoEntry;
        }
        if (entry.handshake.status === "offline") return { allowed: false, reason: `Agent '${agentId}' is offline.` };
        const namespaces = entry.handshake.allowed_tool_namespaces;
        if (namespaces.includes("*")) return { allowed: true };
        const namespace = toolName.split(".")[0];
        if (!namespace) return { allowed: false, reason: `Invalid tool name '${toolName}'. Expected 'namespace.method'.` };
        if (namespaces.includes(namespace)) return { allowed: true };
        return { allowed: false, reason: `Agent '${agentId}' not authorized for '${namespace}'. Allowed: [${namespaces.join(", ")}]` };
      },
      remove(agentId) {
        const existed = registry.delete(agentId);
        if (existed) removeFromRedis(agentId);
        return existed;
      },
      update(agentId, fields) {
        const entry = registry.get(agentId);
        if (!entry) return false;
        Object.assign(entry.handshake, fields);
        entry.lastSeenAt = /* @__PURE__ */ new Date();
        persistToRedis(agentId, entry);
        return true;
      },
      /** Remove all agents from registry and Redis */
      async purgeAll() {
        const count = registry.size;
        registry.clear();
        const redis2 = getRedis();
        if (redis2) await redis2.del(REDIS_KEY2).catch(() => {
        });
        return count;
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
  }
});

// src/slack.ts
function isSlackEnabled() {
  return Boolean(config.backendUrl) && Boolean(config.backendApiKey);
}
async function postToSlack(payload) {
  if (!isSlackEnabled()) return;
  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.backendApiKey}`
      },
      body: JSON.stringify({
        tool: "slack.channel.post",
        payload
      })
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Slack MCP post failed");
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Slack MCP post error");
  }
}
function notifyAgentRegistered(agentId, displayName, namespaces) {
  postToSlack({
    text: `Agent *${displayName}* (\`${agentId}\`) registered
Namespaces: ${namespaces.join(", ")}`,
    level: "info",
    title: `Agent Registered: ${displayName}`,
    source: "orchestrator",
    channel: "#ops-alerts"
  });
}
function notifyToolCall(agentId, toolName, status, durationMs, errorMessage) {
  const emoji = status === "success" ? ":white_check_mark:" : ":x:";
  const level = status === "success" ? "info" : "error";
  const errorLine = errorMessage ? `
Error: \`${errorMessage.slice(0, 200)}\`` : "";
  postToSlack({
    text: `${emoji} \`${agentId}\` called \`${toolName}\` \u2192 *${status}* (${durationMs}ms)${errorLine}
Orchestrator: \`${config.orchestratorId}\``,
    level,
    title: `Tool Call: ${toolName} \u2192 ${status}`,
    source: "orchestrator",
    channel: "#ops-alerts"
  });
}
function notifyChatMessage(from, to, message) {
  postToSlack({
    text: `*${from}* \u2192 *${to}*
${message.slice(0, 500)}`,
    level: "info",
    title: `Chat: ${from} \u2192 ${to}`,
    source: "orchestrator",
    channel: "#ops-alerts"
  });
}
function notifyAdoptionDigest(digest) {
  const trendEmoji2 = digest.trend === "up" ? ":chart_with_upwards_trend:" : digest.trend === "down" ? ":chart_with_downwards_trend:" : ":bar_chart:";
  postToSlack({
    text: [
      `${trendEmoji2} *Weekly Adoption Report* (${digest.period})`,
      "",
      `*Conversations:* ${digest.conversations} | *Pipelines:* ${digest.pipelines} | *Artifacts:* ${digest.artifacts}`,
      `*Active Agents:* ${digest.agents} | *Tool Calls:* ${digest.toolCalls} | *Chains:* ${digest.chains}`,
      `*Feature Adoption:* ${digest.featuresPct}%`,
      "",
      `Trend: ${digest.trend === "up" ? "Growing" : digest.trend === "down" ? "Declining" : "Stable"}`
    ].join("\n"),
    level: "info",
    title: `Weekly Adoption Digest \u2014 ${digest.period}`,
    source: "orchestrator",
    channel: "#ops-status"
  });
}
var init_slack = __esm({
  "src/slack.ts"() {
    "use strict";
    init_config();
    init_logger();
  }
});

// src/write-gate.ts
function isPolluted(text) {
  if (!text || text.length < 20) return false;
  let matchCount = 0;
  for (const pattern of POLLUTION_PATTERNS) {
    if (pattern.test(text)) matchCount++;
    if (matchCount >= 2) return true;
  }
  return false;
}
function getWriteGateStats() {
  return { ...metrics };
}
function validateBeforeMerge(query, params, force) {
  metrics.writes_total++;
  if (force) {
    metrics.writes_passed++;
    logger.warn("Write-path validation bypassed (force=true)");
    return { allowed: true };
  }
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 20) {
      if (isPolluted(value)) {
        metrics.writes_rejected++;
        const reason = `Content in param "${key}" matches LLM prompt pollution patterns`;
        logger.warn({ param: key, preview: value.slice(0, 80) }, `Write REJECTED: ${reason}`);
        return { allowed: false, reason };
      }
    }
  }
  const domainMatch = query.match(/(?:MERGE|CREATE)\s*\(\w*:Domain\s*\{[^}]*name:\s*\$(\w+)/i);
  if (domainMatch) {
    const paramName = domainMatch[1];
    const domainName = params[paramName];
    if (typeof domainName === "string" && !CANONICAL_DOMAINS.has(domainName)) {
      metrics.writes_rejected++;
      const reason = `Domain '${domainName}' not in canonical allowlist (${CANONICAL_DOMAINS.size} domains)`;
      logger.warn({ domain: domainName }, `Write REJECTED: ${reason}`);
      return { allowed: false, reason };
    }
  }
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value) && value.length > 100 && typeof value[0] === "number") {
      if (!VALID_EMBEDDING_DIMS.has(value.length)) {
        metrics.writes_rejected++;
        const reason = `Embedding dimension ${value.length} in param "${key}" does not match expected (384 or 1536)`;
        logger.warn({ param: key, dim: value.length }, `Write REJECTED: ${reason}`);
        return { allowed: false, reason };
      }
    }
  }
  const isNodeCreation = /(?:CREATE|MERGE)\s*\([^)]*:[A-Z]\w+/i.test(query) && /ON\s+CREATE\s+SET|CREATE\s*\(/i.test(query);
  if (isNodeCreation) {
    const hasIdentifier = Object.entries(params).some(([key, val]) => {
      return (key === "title" || key === "name" || key === "filename") && typeof val === "string" && val.trim().length > 0;
    });
    const setsIdentifier = /SET\s+\w+\.(title|name|filename)\s*=/i.test(query);
    if (!hasIdentifier && !setsIdentifier) {
      const isInfraNode = /:(GraphHealthSnapshot|RLMDecision|RLMTool|RLMPattern)/i.test(query);
      if (!isInfraNode) {
        metrics.writes_rejected++;
        const reason = "New nodes must have a non-empty title, name, or filename";
        logger.warn({ cypher: query.slice(0, 120) }, `Write REJECTED: ${reason}`);
        return { allowed: false, reason };
      }
    }
  }
  metrics.writes_passed++;
  return { allowed: true };
}
var POLLUTION_PATTERNS, CANONICAL_DOMAINS, VALID_EMBEDDING_DIMS, metrics;
var init_write_gate = __esm({
  "src/write-gate.ts"() {
    "use strict";
    init_logger();
    POLLUTION_PATTERNS = [
      /you are (?:a |an )?(?:helpful |expert |professional )/i,
      /^(?:system|assistant|human):/im,
      /\b(?:claude|chatgpt|gpt-4|openai)\s+(?:is|can|should|will)\b/i,
      /\bdo not (?:hallucinate|make up|fabricate)\b/i,
      /\byour (?:task|role|job|purpose) is to\b/i,
      /\brespond (?:in|with|using) (?:json|markdown|the following)\b/i,
      /\banswer (?:only|strictly|exclusively) (?:in|with|based)\b/i,
      /\b(?:ignore|disregard) (?:previous|all|any) (?:instructions|prompts)\b/i,
      /\byou (?:must|should|will) (?:always|never|only)\b/i,
      /\bas an ai (?:language )?model\b/i
    ];
    CANONICAL_DOMAINS = /* @__PURE__ */ new Set([
      "AI",
      "Architecture",
      "Cloud",
      "Consulting",
      "Cybersecurity",
      "Finance",
      "HR",
      "Learning",
      "Marketing",
      "Operations",
      "Product Management",
      "Public Sector",
      "Risk & Compliance",
      "Strategy",
      "Technology"
    ]);
    VALID_EMBEDDING_DIMS = /* @__PURE__ */ new Set([384, 1536]);
    metrics = {
      writes_total: 0,
      writes_passed: 0,
      writes_rejected: 0
    };
  }
});

// src/mcp-caller.ts
async function callMcpTool(opts) {
  return withMcpSpan(opts.toolName, opts.callId, async (span) => {
    const log = childLogger(opts.traceId ?? opts.callId);
    const t0 = Date.now();
    const timeoutMs = opts.timeoutMs ?? config.mcpTimeoutMs;
    const url = `${config.backendUrl}/api/mcp/route`;
    const { _force: _stripForce, ...wireArgs } = opts.args;
    const body = JSON.stringify({ tool: opts.toolName, payload: wireArgs });
    log.debug({ tool: opts.toolName, url }, "MCP call start");
    if (opts.toolName === "graph.write_cypher") {
      const query = typeof opts.args.query === "string" ? opts.args.query : "";
      const params = opts.args.params ?? opts.args;
      const force = opts.args._force === true;
      const validation = validateBeforeMerge(query, params, force);
      if (!validation.allowed) {
        span.setAttribute("mcp.write_gate", "rejected");
        span.setAttribute("mcp.rejection_reason", validation.reason ?? "unknown");
        return {
          call_id: opts.callId,
          status: "error",
          result: null,
          error_message: `Write-path validation rejected: ${validation.reason}`,
          error_code: "VALIDATION_REJECTED",
          duration_ms: Date.now() - t0,
          trace_id: opts.traceId ?? null,
          completed_at: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
    }
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        span.setAttribute("mcp.retry_attempt", attempt);
        log.debug({ attempt, tool: opts.toolName }, "Retrying after transient error");
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
      const result = await callMcpToolOnce(opts, url, body, timeoutMs, log, t0);
      if (result.status !== "error" || !result.error_message?.includes("503")) {
        span.setAttribute("mcp.status", result.status);
        span.setAttribute("mcp.duration_ms", result.duration_ms);
        return result;
      }
      lastError = result.error_message;
    }
    span.setAttribute("mcp.status", "error");
    span.setAttribute("mcp.retries_exhausted", true);
    return {
      call_id: opts.callId,
      status: "error",
      result: null,
      error_message: `Failed after ${MAX_RETRIES + 1} attempts: ${lastError}`,
      error_code: "BACKEND_ERROR",
      duration_ms: Date.now() - t0,
      trace_id: opts.traceId ?? null,
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  });
}
async function callMcpToolOnce(opts, url, body, timeoutMs, log, t0) {
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
        if (parsed !== null && typeof parsed === "object" && "result" in parsed) {
          result = parsed.result;
        } else if (parsed !== null && typeof parsed === "object" && "data" in parsed) {
          log.warn({ tool: opts.toolName }, 'MCP response used "data" envelope instead of "result" \u2014 consider standardising');
          result = parsed.data;
        } else {
          log.warn({ tool: opts.toolName, keys: Object.keys(parsed ?? {}) }, "MCP response had no standard envelope \u2014 passing through raw");
          result = parsed;
        }
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
var MAX_RETRIES, RETRY_DELAY_MS;
var init_mcp_caller = __esm({
  "src/mcp-caller.ts"() {
    "use strict";
    init_config();
    init_logger();
    init_write_gate();
    init_tracing();
    MAX_RETRIES = 2;
    RETRY_DELAY_MS = 1e3;
  }
});

// src/cognitive-proxy.ts
function isRlmAvailable() {
  return config.rlmUrl.length > 0;
}
async function callCognitive(action, params, timeoutMs) {
  if (!config.rlmUrl) {
    throw new Error("RLM Engine not configured (set RLM_URL)");
  }
  const path3 = COGNITIVE_ROUTES[action];
  if (!path3) {
    throw new Error(`Unknown cognitive action: ${action}. Valid: ${Object.keys(COGNITIVE_ROUTES).join(", ")}`);
  }
  const url = `${config.rlmUrl}${path3}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 12e4);
  try {
    logger.debug({ action, url, agent: params.agent_id }, "Cognitive proxy call");
    const p = params;
    let body;
    if (action === "analyze") {
      body = {
        task: p.task || params.prompt,
        context: typeof p.context === "string" ? p.context : p.context || params.prompt,
        analysis_dimensions: p.analysis_dimensions || ["general"],
        agent_id: params.agent_id
      };
    } else if (action === "reason") {
      body = {
        task: p.task || params.prompt,
        context: typeof p.context === "object" ? p.context : { prompt: params.prompt },
        agent_id: params.agent_id,
        depth: params.depth ?? 0
      };
    } else if (action === "plan") {
      body = {
        task: p.task || params.prompt,
        context: typeof p.context === "object" ? p.context : { prompt: params.prompt },
        constraints: p.constraints || [],
        agent_id: params.agent_id
      };
    } else if (action === "fold") {
      body = {
        task: p.task || params.prompt,
        context: typeof p.context === "object" ? p.context : { prompt: params.prompt },
        agent_id: params.agent_id
      };
    } else {
      body = {
        prompt: params.prompt,
        task: p.task || params.prompt,
        context: p.context || params.prompt,
        agent_id: params.agent_id,
        depth: params.depth ?? 0,
        mode: params.mode ?? "standard"
      };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.backendApiKey ? { "Authorization": `Bearer ${config.backendApiKey}` } : {}
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`RLM ${action} failed: ${errText}`);
    }
    const data = await res.json();
    return data.result ?? data.answer ?? data.reasoning ?? data.plan ?? data;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`RLM ${action} timed out after ${timeoutMs ?? 12e4}ms`);
    }
    throw err;
  }
}
async function getRlmHealth() {
  if (!config.rlmUrl) return null;
  try {
    const res = await fetch(`${config.rlmUrl}/health`, { signal: AbortSignal.timeout(5e3) });
    if (!res.ok) return { status: "unhealthy", http_status: res.status };
    return await res.json();
  } catch {
    return { status: "unreachable" };
  }
}
var COGNITIVE_ROUTES;
var init_cognitive_proxy = __esm({
  "src/cognitive-proxy.ts"() {
    "use strict";
    init_config();
    init_logger();
    COGNITIVE_ROUTES = {
      reason: "/reason",
      analyze: "/cognitive/analyze",
      plan: "/cognitive/plan",
      learn: "/cognitive/learn",
      fold: "/cognitive/fold",
      enrich: "/cognitive/enrich"
    };
  }
});

// src/hierarchical-intelligence.ts
var hierarchical_intelligence_exports = {};
__export(hierarchical_intelligence_exports, {
  buildCommunitySummaries: () => buildCommunitySummaries,
  searchCommunitySummaries: () => searchCommunitySummaries
});
import { v4 as uuid } from "uuid";
async function buildCommunitySummaries() {
  const t0 = Date.now();
  logger.info("Hierarchical intelligence: building community summaries");
  let communities;
  let method;
  try {
    communities = await runLeidenCommunities();
    method = "gds-leiden";
  } catch (err) {
    logger.warn({ error: String(err) }, "GDS Leiden failed \u2014 using Cypher fallback");
    communities = await runCypherClustering();
    method = "cypher-fallback";
  }
  if (communities.length === 0) {
    logger.info("No communities found \u2014 graph may be too sparse");
    return { communities_created: 0, summaries_generated: 0, relationships_created: 0, levels: 0, duration_ms: Date.now() - t0, method };
  }
  let summariesGenerated = 0;
  let relsCreated = 0;
  const BATCH = 5;
  for (let i = 0; i < communities.length; i += BATCH) {
    const batch = communities.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((c) => createCommunitySummary(c))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        summariesGenerated += r.value.summary ? 1 : 0;
        relsCreated += r.value.rels_created;
      }
    }
  }
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MATCH (s:CommunitySummary) WHERE s.updatedAt < datetime() - duration('P30D') DETACH DELETE s`,
        _force: true
      },
      callId: uuid(),
      timeoutMs: 1e4
    });
  } catch {
  }
  const result = {
    communities_created: communities.length,
    summaries_generated: summariesGenerated,
    relationships_created: relsCreated,
    levels: 1,
    // Single level for MVP; multi-level in future
    duration_ms: Date.now() - t0,
    method
  };
  logger.info(result, "Hierarchical intelligence: complete");
  return result;
}
async function runLeidenCommunities() {
  await callMcpTool({
    toolName: "graph.write_cypher",
    args: {
      query: `CALL gds.graph.project('community-detect', '*', '*') YIELD graphName RETURN graphName`,
      _force: true
    },
    callId: uuid(),
    timeoutMs: 3e4
  });
  const leidenResult = await callMcpTool({
    toolName: "graph.write_cypher",
    args: {
      query: `CALL gds.leiden.write('community-detect', { writeProperty: 'communityId' })
YIELD communityCount, modularity
RETURN communityCount, modularity`,
      _force: true
    },
    callId: uuid(),
    timeoutMs: 6e4
  });
  await callMcpTool({
    toolName: "graph.write_cypher",
    args: {
      query: `CALL gds.graph.drop('community-detect') YIELD graphName RETURN graphName`,
      _force: true
    },
    callId: uuid(),
    timeoutMs: 1e4
  }).catch(() => {
  });
  return await collectCommunityMembers("communityId");
}
async function runCypherClustering() {
  const result = await callMcpTool({
    toolName: "graph.read_cypher",
    args: {
      query: `MATCH (n) WHERE n.domain IS NOT NULL
WITH n.domain AS domain, collect({name: coalesce(n.title, n.name, n.filename, ''), description: substring(coalesce(n.description, n.content, ''), 0, 200), type: labels(n)[0]}) AS members, count(*) AS cnt
WHERE cnt >= 5
RETURN domain, members[..20] AS members, cnt
ORDER BY cnt DESC LIMIT 30`
    },
    callId: uuid(),
    timeoutMs: 15e3
  });
  if (result.status !== "success") return [];
  const rows = result.result?.results ?? result.result;
  if (!Array.isArray(rows)) return [];
  return rows.map((r, i) => ({
    community_id: i,
    member_count: typeof r.cnt === "object" ? r.cnt.low : Number(r.cnt) || 0,
    members: Array.isArray(r.members) ? r.members : [],
    domain: String(r.domain ?? "general")
  }));
}
async function collectCommunityMembers(propertyName) {
  if (!SAFE_COMMUNITY_PROPS.has(propertyName)) {
    logger.warn({ propertyName }, "Rejected unsafe community property name");
    return [];
  }
  const result = await callMcpTool({
    toolName: "graph.read_cypher",
    args: {
      query: `MATCH (n) WHERE n.${propertyName} IS NOT NULL
WITH n.${propertyName} AS cid, collect({name: coalesce(n.title, n.name, n.filename, ''), description: substring(coalesce(n.description, n.content, ''), 0, 200), type: labels(n)[0]}) AS members, count(*) AS cnt
WHERE cnt >= 5
RETURN cid, members[..20] AS members, cnt, head(members).domain AS domain
ORDER BY cnt DESC LIMIT 50`
    },
    callId: uuid(),
    timeoutMs: 15e3
  });
  if (result.status !== "success") return [];
  const rows = result.result?.results ?? result.result;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    community_id: typeof r.cid === "object" ? r.cid.low : Number(r.cid) || 0,
    member_count: typeof r.cnt === "object" ? r.cnt.low : Number(r.cnt) || 0,
    members: Array.isArray(r.members) ? r.members : [],
    domain: String(r.domain ?? "general")
  }));
}
async function createCommunitySummary(community) {
  const memberList = community.members.filter((m) => m.name).map((m) => `- ${m.name} (${m.type}): ${m.description || "no description"}`).join("\n");
  if (!memberList) return { summary: null, rels_created: 0 };
  let summary = null;
  try {
    const result = await callCognitive("analyze", {
      prompt: `Summarize this knowledge graph community in 2-3 sentences. Describe: what theme connects these entities, what they collectively represent, and their significance for consulting.

COMMUNITY (${community.member_count} members, domain: ${community.domain}):
${memberList}

Write a concise executive summary (max 100 words).`,
      context: { community_id: community.community_id, domain: community.domain },
      agent_id: "hierarchical-intelligence"
    }, 2e4);
    summary = String(result ?? "").trim();
    if (summary.length < 10) summary = null;
  } catch {
    logger.debug({ community_id: community.community_id }, "Community summary generation failed");
    return { summary: null, rels_created: 0 };
  }
  if (!summary) return { summary: null, rels_created: 0 };
  const communityNodeId = `community-${community.community_id}-${community.domain}`;
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MERGE (c:CommunitySummary {id: $id})
SET c.name = $name, c.summary = $summary, c.domain = $domain,
    c.member_count = $memberCount, c.level = 1, c.updatedAt = datetime()`,
        params: {
          id: communityNodeId,
          name: `${community.domain} Community (${community.member_count} members)`,
          summary,
          domain: community.domain,
          memberCount: community.member_count
        },
        _force: true
        // Infrastructure write
      },
      callId: uuid(),
      timeoutMs: 1e4
    });
  } catch (err) {
    logger.debug({ error: String(err) }, "CommunitySummary MERGE failed");
    return { summary, rels_created: 0 };
  }
  let relsCreated = 0;
  const memberNames = community.members.filter((m) => m.name).map((m) => m.name).slice(0, 20);
  if (memberNames.length > 0) {
    try {
      const result = await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `MATCH (c:CommunitySummary {id: $communityId})
UNWIND $names AS memberName
MATCH (m) WHERE coalesce(m.title, m.name) = memberName
MERGE (m)-[:MEMBER_OF]->(c)
RETURN count(*) AS rels`,
          params: { communityId: communityNodeId, names: memberNames },
          _force: true
        },
        callId: uuid(),
        timeoutMs: 1e4
      });
      if (result.status === "success") {
        const rows = result.result?.results ?? result.result;
        if (Array.isArray(rows) && rows[0]) {
          relsCreated = typeof rows[0].rels === "object" ? rows[0].rels.low : Number(rows[0].rels) || 0;
        }
      }
    } catch {
    }
  }
  return { summary, rels_created: relsCreated };
}
async function searchCommunitySummaries(query, maxResults = 5) {
  try {
    const result = await callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: `MATCH (c:CommunitySummary)
WHERE toLower(c.summary) CONTAINS toLower($keyword)
   OR toLower(c.domain) CONTAINS toLower($keyword)
   OR toLower(c.name) CONTAINS toLower($keyword)
RETURN c.id AS id, c.name AS name, c.summary AS summary, c.domain AS domain, c.member_count AS members
ORDER BY c.member_count DESC
LIMIT $limit`,
        params: {
          keyword: query.split(/\s+/).filter((w) => w.length >= 3).slice(0, 3).join(" ").slice(0, 80),
          limit: maxResults
        }
      },
      callId: uuid(),
      timeoutMs: 1e4
    });
    if (result.status !== "success") return [];
    const rows = result.result?.results ?? result.result;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      source: "community",
      content: `[Community: ${r.name}] ${r.summary}`,
      score: 0.75,
      // Community summaries are structurally relevant
      metadata: { id: r.id, domain: r.domain, members: r.members }
    }));
  } catch {
    return [];
  }
}
var SAFE_COMMUNITY_PROPS;
var init_hierarchical_intelligence = __esm({
  "src/hierarchical-intelligence.ts"() {
    "use strict";
    init_mcp_caller();
    init_cognitive_proxy();
    init_logger();
    SAFE_COMMUNITY_PROPS = /* @__PURE__ */ new Set(["communityId", "communityId2", "leiden_community", "louvain_community"]);
  }
});

// src/compound-hooks.ts
var compound_hooks_exports = {};
__export(compound_hooks_exports, {
  hookAutoEnrichment: () => hookAutoEnrichment,
  hookDeliverableToKnowledge: () => hookDeliverableToKnowledge,
  hookQualitySignal: () => hookQualitySignal,
  hookSimilarityPreference: () => hookSimilarityPreference
});
import { v4 as uuid2 } from "uuid";
async function hookDeliverableToKnowledge(deliverableId, title, citations) {
  if (citations.length === 0) return 0;
  let linked = 0;
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MERGE (d:Deliverable {id: $deliverableId})
SET d.title = $title, d.createdAt = datetime()
WITH d
UNWIND $citations AS cit
MATCH (n) WHERE coalesce(n.title, n.name) CONTAINS cit.title
WITH d, n LIMIT 20
MERGE (n)-[:CITED_IN]->(d)
RETURN count(*) AS linked`,
        params: {
          deliverableId,
          title: title.slice(0, 200),
          citations: citations.slice(0, 15).map((c) => ({ title: c.title.slice(0, 80) }))
        },
        _force: true
      },
      callId: uuid2(),
      timeoutMs: 1e4
    });
    linked = citations.length;
  } catch (err) {
    logger.debug({ error: String(err) }, "Deliverable\u2192Knowledge hook failed");
  }
  logger.info({ deliverableId, citations: citations.length, linked }, "Hook: Deliverable\u2192Knowledge");
  return linked;
}
function hookAutoEnrichment(answer, query) {
  extractAndMerge(answer, query).catch(
    (err) => logger.debug({ error: String(err) }, "Auto-enrichment hook failed (non-blocking)")
  );
}
async function extractAndMerge(answer, query) {
  if (answer.length < 50) return;
  try {
    const result = await callCognitive("analyze", {
      prompt: `Extract specific named entities from this AI-generated answer that should be added to a knowledge graph. Only extract NAMED entities (organizations, regulations, technologies, frameworks) \u2014 not generic concepts.

QUERY: ${query}
ANSWER: ${answer.slice(0, 3e3)}

Reply as JSON: {"entities": [{"name": "...", "type": "Organization|Regulation|Technology|Framework", "domain": "..."}]}
Return max 5 entities. If none are specific enough, return {"entities": []}`,
      context: { source: "auto-enrichment" },
      agent_id: "auto-enrichment"
    }, 15e3);
    const text = String(result ?? "");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]);
    const entities = Array.isArray(parsed.entities) ? parsed.entities.slice(0, 5) : [];
    for (const entity of entities) {
      if (!entity.name || entity.name.length < 3) continue;
      try {
        const safeLabel = (entity.type ?? "Knowledge").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
        await callMcpTool({
          toolName: "graph.write_cypher",
          args: {
            query: `MERGE (n:${safeLabel} {name: $name})
ON CREATE SET n.domain = $domain, n.source = 'auto-enrichment', n.createdAt = datetime()
SET n.updatedAt = datetime()`,
            params: {
              name: entity.name,
              domain: entity.domain ?? "general"
            }
          },
          callId: uuid2(),
          timeoutMs: 5e3
        });
      } catch {
      }
    }
    if (entities.length > 0) {
      logger.info({ count: entities.length }, "Hook: Auto-enrichment \u2014 new entities merged");
    }
  } catch {
  }
}
async function hookQualitySignal(query, strategy, channels, resultCount, confidenceAvg) {
  const redis2 = getRedis();
  if (!redis2) return;
  try {
    const signal = JSON.stringify({
      query: query.slice(0, 200),
      strategy,
      channels,
      result_count: resultCount,
      confidence: confidenceAvg,
      timestamp: Date.now()
    });
    await redis2.lpush("orchestrator:rag-quality-signals", signal);
    await redis2.ltrim("orchestrator:rag-quality-signals", 0, 9999);
  } catch {
  }
}
async function hookSimilarityPreference(queryId, selectedMatchId, rejectedMatchIds) {
  if (!selectedMatchId || rejectedMatchIds.length === 0) return;
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MATCH (selected {id: $selectedId})
UNWIND $rejectedIds AS rejId
MATCH (rejected {id: rejId})
MERGE (selected)-[p:PREFERRED_OVER]->(rejected)
ON CREATE SET p.count = 1, p.firstSeen = datetime()
SET p.count = coalesce(p.count, 0) + 1, p.lastSeen = datetime()`,
        params: {
          selectedId: selectedMatchId,
          rejectedIds: rejectedMatchIds.slice(0, 5)
        },
        _force: true
      },
      callId: uuid2(),
      timeoutMs: 5e3
    });
    logger.info({ selected: selectedMatchId, rejected: rejectedMatchIds.length }, "Hook: Similarity preference logged");
  } catch {
  }
}
var init_compound_hooks = __esm({
  "src/compound-hooks.ts"() {
    "use strict";
    init_mcp_caller();
    init_cognitive_proxy();
    init_logger();
    init_redis();
  }
});

// src/adaptive-rag.ts
var adaptive_rag_exports = {};
__export(adaptive_rag_exports, {
  calculateCompoundMetric: () => calculateCompoundMetric,
  getAdaptiveRAGDashboard: () => getAdaptiveRAGDashboard,
  getAdaptiveWeights: () => getAdaptiveWeights,
  retrainRoutingWeights: () => retrainRoutingWeights,
  sendQLearningReward: () => sendQLearningReward
});
async function getAdaptiveWeights() {
  const now = Date.now();
  if (now - weightsCacheTime < CACHE_TTL_MS) return cachedWeights;
  const redis2 = getRedis();
  if (!redis2) return cachedWeights;
  try {
    const raw = await Promise.race([
      redis2.get(REDIS_WEIGHTS_KEY),
      new Promise((r) => setTimeout(() => r(null), 200))
    ]);
    if (raw) {
      cachedWeights = JSON.parse(raw);
      weightsCacheTime = now;
    }
  } catch {
  }
  return cachedWeights;
}
async function analyzeOutcomes(windowHours = 168) {
  const redis2 = getRedis();
  if (!redis2) return [];
  try {
    const cutoff = Date.now() - windowHours * 36e5;
    const raw = await redis2.lrange(REDIS_OUTCOMES_KEY, 0, 9999);
    const outcomes = raw.map((r) => {
      try {
        return JSON.parse(r);
      } catch {
        return null;
      }
    }).filter((o) => o !== null && o.timestamp > cutoff);
    if (outcomes.length < 10) return [];
    const byStrategy = /* @__PURE__ */ new Map();
    for (const o of outcomes) {
      const existing = byStrategy.get(o.strategy) ?? [];
      existing.push(o);
      byStrategy.set(o.strategy, existing);
    }
    return Array.from(byStrategy.entries()).map(([strategy, items]) => ({
      strategy,
      total_queries: items.length,
      avg_confidence: items.reduce((s, o) => s + o.confidence, 0) / items.length,
      avg_result_count: items.reduce((s, o) => s + o.result_count, 0) / items.length,
      zero_result_rate: items.filter((o) => o.result_count === 0).length / items.length
    }));
  } catch {
    return [];
  }
}
async function retrainRoutingWeights() {
  const t0 = Date.now();
  logger.info("Adaptive RAG: retraining routing weights");
  const stats = await analyzeOutcomes(168);
  const adjustments = [];
  if (stats.length === 0) {
    logger.info("Adaptive RAG: insufficient data for retraining (<10 samples)");
    return { weights: cachedWeights, stats, adjustments: ["No data \u2014 keeping defaults"] };
  }
  const newWeights = { ...cachedWeights };
  for (const s of stats) {
    if (s.zero_result_rate > 0.3) {
      const channelKey = `${s.strategy}_channels`;
      const channels = newWeights[channelKey];
      if (Array.isArray(channels) && !channels.includes("srag")) {
        channels.push("srag");
        adjustments.push(`${s.strategy}: added srag fallback (${(s.zero_result_rate * 100).toFixed(0)}% zero-result rate)`);
      }
    }
    if (s.avg_confidence < 0.3) {
      const channelKey = `${s.strategy}_channels`;
      const channels = newWeights[channelKey];
      if (Array.isArray(channels) && !channels.includes("community")) {
        channels.push("community");
        adjustments.push(`${s.strategy}: added community channel (avg confidence ${s.avg_confidence.toFixed(2)})`);
      }
    }
    if (s.avg_confidence > 0.7 && s.avg_result_count > 5) {
      adjustments.push(`${s.strategy}: performing well (confidence ${s.avg_confidence.toFixed(2)}, ${s.avg_result_count.toFixed(0)} results avg)`);
    }
  }
  const overallAvgConf = stats.reduce((s, st) => s + st.avg_confidence, 0) / stats.length;
  if (overallAvgConf > 0.6) {
    newWeights.confidence_threshold = Math.min(0.6, overallAvgConf * 0.7);
    adjustments.push(`Confidence threshold \u2192 ${newWeights.confidence_threshold.toFixed(2)} (from avg ${overallAvgConf.toFixed(2)})`);
  }
  newWeights.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  newWeights.training_samples = stats.reduce((s, st) => s + st.total_queries, 0);
  const redis2 = getRedis();
  if (redis2) {
    try {
      await redis2.set(REDIS_WEIGHTS_KEY, JSON.stringify(newWeights));
    } catch {
    }
  }
  cachedWeights = newWeights;
  weightsCacheTime = Date.now();
  logger.info({
    samples: newWeights.training_samples,
    adjustments: adjustments.length,
    ms: Date.now() - t0
  }, "Adaptive RAG: retraining complete");
  return { weights: newWeights, stats, adjustments };
}
async function sendQLearningReward(state, action, reward) {
  if (!isRlmAvailable()) return;
  try {
    await callCognitive("learn", {
      prompt: JSON.stringify({
        state: {
          query_type: state.query_type,
          channel_count: state.channels_used.length,
          result_density: state.result_count > 0 ? 1 : 0
        },
        action: {
          strategy: action.strategy,
          threshold: action.confidence_threshold
        },
        reward,
        agent_id: "adaptive-rag",
        domain: "rag-optimization"
      }),
      context: { source: "adaptive-rag-f5", type: "q-learning-reward" },
      agent_id: "adaptive-rag"
    }, 1e4);
    logger.debug({ reward: reward.toFixed(3), strategy: action.strategy }, "Q-learning reward sent");
  } catch {
  }
}
function calculateCompoundMetric(stats) {
  if (stats.length === 0) return { score: 0, accuracy: 0, quality: 0, coverage: 0 };
  const totalQueries = stats.reduce((s, st) => s + st.total_queries, 0);
  const accuracy = stats.reduce((s, st) => s + st.avg_confidence * st.total_queries, 0) / totalQueries;
  const quality = 1 - stats.reduce((s, st) => s + st.zero_result_rate * st.total_queries, 0) / totalQueries;
  const coverage = Math.min(1, stats.reduce((s, st) => s + st.avg_result_count * st.total_queries, 0) / totalQueries / 5);
  return {
    score: Math.round(accuracy * quality * coverage * 1e3) / 1e3,
    accuracy: Math.round(accuracy * 1e3) / 1e3,
    quality: Math.round(quality * 1e3) / 1e3,
    coverage: Math.round(coverage * 1e3) / 1e3
  };
}
async function getAdaptiveRAGDashboard() {
  const weights = await getAdaptiveWeights();
  const stats = await analyzeOutcomes(168);
  const compound_metric = calculateCompoundMetric(stats);
  const outcome_count = stats.reduce((s, st) => s + st.total_queries, 0);
  return { weights, stats, compound_metric, outcome_count };
}
var DEFAULT_WEIGHTS, REDIS_WEIGHTS_KEY, REDIS_OUTCOMES_KEY, cachedWeights, weightsCacheTime, CACHE_TTL_MS;
var init_adaptive_rag = __esm({
  "src/adaptive-rag.ts"() {
    "use strict";
    init_redis();
    init_cognitive_proxy();
    init_logger();
    DEFAULT_WEIGHTS = {
      simple_channels: ["graphrag", "srag"],
      multi_hop_channels: ["graphrag", "cypher", "community"],
      structured_channels: ["cypher", "graphrag"],
      confidence_threshold: 0.4,
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      training_samples: 0
    };
    REDIS_WEIGHTS_KEY = "orchestrator:adaptive-rag:weights";
    REDIS_OUTCOMES_KEY = "orchestrator:rag-quality-signals";
    cachedWeights = { ...DEFAULT_WEIGHTS };
    weightsCacheTime = 0;
    CACHE_TTL_MS = 6e4;
  }
});

// src/dual-rag.ts
import { v4 as uuid3 } from "uuid";
function classifyQuery(query) {
  const q = query.toLowerCase();
  if (/\b(?:how many|count|list all|list the|total|statistics|stats)\b/.test(q)) {
    return "structured";
  }
  if (/\b(?:match|where|return|node|relationship|label)\b/.test(q)) {
    return "structured";
  }
  if (/\b(?:compare|versus|difference|between|trade-?off|pros and cons)\b/.test(q)) {
    return "multi_hop";
  }
  if (/\b(?:strategy|roadmap|architecture|impact|implication|recommend)\b/.test(q)) {
    return "multi_hop";
  }
  if (/\b(?:why|how does|what if|should we|evaluate|assess|analyze)\b/.test(q)) {
    return "multi_hop";
  }
  if (q.split(/\s+/).length > 12) {
    return "multi_hop";
  }
  return "simple";
}
async function callGraphRAG(query, maxResults) {
  const result = await callMcpTool({
    toolName: "autonomous.graphrag",
    args: { question: query, max_evidence: maxResults },
    callId: uuid3(),
    timeoutMs: 6e4
    // graphrag is slower but higher quality
  });
  if (result.status !== "success") {
    logger.warn({ error: result.error_message }, "autonomous.graphrag failed");
    return [];
  }
  const data = result.result;
  const evidence = data?.evidence ?? data?.results ?? data?.chunks ?? [];
  const answer = data?.answer ?? data?.synthesis ?? "";
  const confidence = data?.confidence ?? 0.8;
  const results = [];
  if (answer && typeof answer === "string" && answer.length > 20) {
    results.push({
      source: "graphrag",
      content: answer,
      score: confidence,
      metadata: { type: "synthesis", evidence_count: evidence.length }
    });
  }
  if (Array.isArray(evidence)) {
    for (const item of evidence.slice(0, maxResults - 1)) {
      const content = item.content || item.text || item.chunk || (typeof item === "string" ? item : JSON.stringify(item).slice(0, 500));
      results.push({
        source: "graphrag",
        content: typeof content === "string" ? content : String(content),
        score: item.score ?? item.relevance ?? 0.75,
        metadata: { title: item.title, node_type: item.label || item.type }
      });
    }
  }
  return results;
}
async function callSRAG(query, maxResults) {
  const result = await callMcpTool({
    toolName: "srag.query",
    args: { query },
    callId: uuid3(),
    timeoutMs: 45e3
  });
  if (result.status !== "success") return [];
  const sragData = result.result;
  const items = Array.isArray(sragData) ? sragData : sragData?.results ? sragData.results : sragData?.chunks ? sragData.chunks : [];
  const results = [];
  for (const item of items.slice(0, maxResults)) {
    results.push({
      source: "srag",
      content: item.content || item.text || item.chunk || JSON.stringify(item).slice(0, 500),
      score: item.score || item.similarity || 0.5,
      metadata: { title: item.title, tags: item.tags }
    });
  }
  return results;
}
async function callCypher(query, maxResults, depth) {
  const result = await callMcpTool({
    toolName: "graph.read_cypher",
    args: { query: buildCypherQuery(query, depth) },
    callId: uuid3(),
    timeoutMs: 2e4
  });
  if (result.status !== "success") return [];
  const cypherData = result.result;
  const rows = cypherData?.results || cypherData || [];
  if (!Array.isArray(rows)) return [];
  const results = [];
  for (const row of rows.slice(0, maxResults)) {
    const content = Object.values(row).map(
      (v) => typeof v === "string" ? v : JSON.stringify(v)
    ).join(" | ");
    results.push({
      source: "cypher",
      content: content.slice(0, 500),
      score: 0.7,
      metadata: row
    });
  }
  return results;
}
async function dualChannelRAG(query, options) {
  const t0 = Date.now();
  const maxResults = options?.maxResults ?? 10;
  const depth = options?.cypherDepth ?? 2;
  const complexity = classifyQuery(query);
  logger.info({ query: query.slice(0, 80), complexity }, "Hybrid RAG: routing query");
  const channels = options?.forceChannels ?? await getChannelsForComplexity(complexity);
  const channelPromises = [];
  const channelsUsed = [];
  if (channels.includes("graphrag")) {
    channelPromises.push(callGraphRAG(query, maxResults));
    channelsUsed.push("graphrag");
  }
  if (channels.includes("srag")) {
    channelPromises.push(callSRAG(query, maxResults));
    channelsUsed.push("srag");
  }
  if (channels.includes("cypher")) {
    channelPromises.push(callCypher(query, maxResults, depth));
    channelsUsed.push("cypher");
  }
  if (complexity === "multi_hop") {
    channelPromises.push(searchCommunitySummaries(query, 3));
    channelsUsed.push("community");
  }
  const channelResults = await Promise.allSettled(channelPromises);
  let allResults = [];
  for (const cr of channelResults) {
    if (cr.status === "fulfilled") {
      allResults.push(...cr.value);
    }
  }
  if (allResults.filter((r) => r.source === "graphrag").length === 0 && !channels.includes("srag")) {
    logger.info("Hybrid RAG: graphrag returned empty, falling back to srag");
    const sragResults = await callSRAG(query, maxResults);
    allResults.push(...sragResults);
    channelsUsed.push("srag (fallback)");
  }
  let pollutionFiltered = 0;
  allResults = allResults.filter((r) => {
    if (isPolluted(r.content)) {
      pollutionFiltered++;
      logger.debug({ source: r.source, preview: r.content.slice(0, 60) }, "Filtered polluted result");
      return false;
    }
    return true;
  });
  allResults.sort((a, b) => {
    if (a.source === "graphrag" && a.metadata?.type === "synthesis") return -1;
    if (b.source === "graphrag" && b.metadata?.type === "synthesis") return 1;
    return b.score - a.score;
  });
  const topResults = allResults.slice(0, maxResults);
  const merged = topResults.map(
    (r, i) => `[${r.source.toUpperCase()} #${i + 1}${r.score >= 0.8 ? " \u2605" : ""}] ${r.content}`
  ).join("\n\n");
  const graphragCount = topResults.filter((r) => r.source === "graphrag").length;
  const sragCount = topResults.filter((r) => r.source === "srag").length;
  const cypherCount = topResults.filter((r) => r.source === "cypher").length;
  const durationMs = Date.now() - t0;
  logger.info({
    query: query.slice(0, 60),
    complexity,
    graphragCount,
    sragCount,
    cypherCount,
    pollutionFiltered,
    ms: durationMs
  }, "Hybrid RAG: complete");
  const response = {
    query,
    results: topResults,
    srag_count: sragCount,
    cypher_count: cypherCount,
    graphrag_count: graphragCount,
    merged_context: merged,
    duration_ms: durationMs,
    route_strategy: complexity,
    channels_used: channelsUsed,
    pollution_filtered: pollutionFiltered
  };
  const avgScore = topResults.length > 0 ? topResults.reduce((s, r) => s + r.score, 0) / topResults.length : 0;
  hookQualitySignal(query, complexity, channelsUsed, topResults.length, avgScore).catch(() => {
  });
  const qualitySignal = topResults.length > 0 ? 1 : 0;
  const coverageSignal = Math.min(1, topResults.length / 5);
  const compoundReward = avgScore * qualitySignal * coverageSignal;
  sendQLearningReward(
    { query_type: complexity, channels_used: channelsUsed, result_count: topResults.length },
    { strategy: complexity, confidence_threshold: 0.4 },
    compoundReward
  ).catch(() => {
  });
  return response;
}
async function getChannelsForComplexity(complexity) {
  try {
    const w = await getAdaptiveWeights();
    if (w.training_samples > 0) {
      switch (complexity) {
        case "simple":
          return w.simple_channels;
        case "multi_hop":
          return w.multi_hop_channels;
        case "structured":
          return w.structured_channels;
      }
    }
  } catch {
  }
  switch (complexity) {
    case "simple":
      return ["graphrag", "srag"];
    case "multi_hop":
      return ["graphrag", "cypher"];
    case "structured":
      return ["cypher", "graphrag"];
  }
}
function buildCypherQuery(query, depth) {
  const stopWords = /* @__PURE__ */ new Set(["the", "and", "for", "with", "that", "this", "from", "are", "was", "how", "what", "which", "where", "when", "why", "can", "does", "will", "not", "all", "has", "have", "been", "our", "their", "its"]);
  const keywords = query.toLowerCase().replace(/[^a-zA-Z0-9æøåÆØÅ\s]/g, "").split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w)).slice(0, 5);
  if (keywords.length === 0) {
    return "MATCH (n:StrategicInsight) RETURN n.title AS title, n.domain AS domain LIMIT 5";
  }
  const kwConditions = keywords.map(
    (kw) => `toLower(coalesce(n.title, n.name, n.description, '')) CONTAINS '${kw}'`
  ).join(" OR ");
  return `MATCH (n) WHERE (n:StrategicInsight OR n:Pattern OR n:Lesson OR n:Knowledge OR n:Memory OR n:TDCDocument)
AND (${kwConditions})
WITH n, labels(n)[0] AS label
OPTIONAL MATCH (n)-[r]-(m)
RETURN label,
       coalesce(n.title, n.name, n.filename) AS title,
       substring(coalesce(n.description, n.content, n.value, ''), 0, 300) AS content,
       type(r) AS rel,
       labels(m)[0] AS connected_to
LIMIT 15`;
}
var init_dual_rag = __esm({
  "src/dual-rag.ts"() {
    "use strict";
    init_mcp_caller();
    init_logger();
    init_write_gate();
    init_hierarchical_intelligence();
    init_compound_hooks();
    init_adaptive_rag();
  }
});

// src/routing-engine.ts
import { v4 as uuid4 } from "uuid";
function roundScore(value) {
  return Math.round(value * 1e3) / 1e3;
}
function inferCapabilityFromMessage(message) {
  const text = message.toLowerCase();
  if (text.includes("feedback") || text.includes("accept") || text.includes("reject") || text.includes("learning")) {
    return "learning_feedback";
  }
  if (text.includes("audit") || text.includes("verify") || text.includes("compliance") || text.includes("policy")) {
    return "workflow_audit";
  }
  if (text.includes("recommend") || text.includes("decision") || text.includes("promot") || text.includes("surface")) {
    return "verified_recommendation";
  }
  if (text.includes("decompose") || text.includes("break down") || text.includes("plan") || text.includes("bridge")) {
    return "guided_decomposition";
  }
  return "engagement_intake";
}
function buildIntent(capability, routeScope, operatorVisible) {
  const meta = CAPABILITY_META[capability];
  return {
    intent_id: `intent-${uuid4().slice(0, 8)}`,
    capability,
    task_domain: meta.taskDomain === "routing" ? "intake" : meta.taskDomain,
    flow_ref: meta.flowRef,
    route_scope: routeScope,
    operator_visible: operatorVisible,
    scorecard_dimensions: meta.scorecardDimensions
  };
}
function getCandidateAgents(capability) {
  return CAPABILITY_CANDIDATES[capability].filter((agentId) => AgentRegistry.get(agentId));
}
function summarizeEvidence(agentId, executions2) {
  const references = [];
  let successCount = 0;
  let failCount = 0;
  for (const execution of executions2.slice(0, 20)) {
    const step = execution.results.find((result) => result.agent_id === agentId);
    if (!step) continue;
    const verifiedSuccess = step.status === "success" && step.verified !== false;
    if (verifiedSuccess) {
      successCount += 1;
    } else if (step.status !== "success") {
      failCount += 1;
    }
    references.push(`execution:${execution.execution_id}:${step.status}`);
  }
  return { successCount, failCount, evidenceRefs: references.slice(0, 5) };
}
function buildTrustProfile(agentId, capability, executions2) {
  const meta = CAPABILITY_META[capability];
  const priorWeight = 3;
  const defaultPriorScore = 0.6;
  const { successCount, failCount } = summarizeEvidence(agentId, executions2);
  const bayesianScore = roundScore(
    (defaultPriorScore * priorWeight + successCount) / (priorWeight + successCount + failCount)
  );
  return {
    agent_id: agentId,
    task_domain: meta.taskDomain,
    success_count: successCount,
    fail_count: failCount,
    bayesian_score: bayesianScore,
    prior_weight: priorWeight,
    default_prior_score: defaultPriorScore,
    evidence_source: successCount + failCount > 0 ? "runtime_readback" : "decision_quality_scorecard",
    scorecard_dimension: meta.trustDimension,
    scope_owner: "widgetdc-orchestrator",
    last_verified_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function sortProfiles(profiles) {
  return [...profiles].sort((left, right) => {
    if (right.bayesian_score !== left.bayesian_score) {
      return right.bayesian_score - left.bayesian_score;
    }
    return AgentRegistry.getActiveCalls(left.agent_id) - AgentRegistry.getActiveCalls(right.agent_id);
  });
}
function buildWorkflowEnvelope(workflowId, intent, selectedAgentId, routeScope) {
  const meta = CAPABILITY_META[intent.capability];
  const participants = Array.from(/* @__PURE__ */ new Set(["master", selectedAgentId]));
  return {
    workflow_id: workflowId,
    workflow_type: meta.workflowType,
    current_phase: meta.workflowPhase,
    participants,
    primary_surface: routeScope.includes("widgetdc-librechat") ? "widgetdc-librechat" : routeScope[0],
    flow_ref: meta.flowRef,
    scorecard_ref: "LIN-261",
    reasoning_lineage_visible: intent.operator_visible,
    started_at: (/* @__PURE__ */ new Date()).toISOString(),
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function rememberDecision(decision) {
  recentRoutingDecisions.unshift(decision);
  if (recentRoutingDecisions.length > 50) {
    recentRoutingDecisions.length = 50;
  }
}
function resolveRoutingDecision(input) {
  const routeScope = input.routeScope && input.routeScope.length > 0 ? [...input.routeScope] : ["widgetdc-orchestrator"];
  const operatorVisible = input.operatorVisible ?? true;
  const capability = input.capabilityHint ?? inferCapabilityFromMessage(input.message);
  const recentExecutions = input.recentExecutions ?? [];
  const intent = buildIntent(capability, routeScope, operatorVisible);
  const candidates = getCandidateAgents(capability);
  const fallbackAgents = candidates.length > 0 ? candidates : ["rlm"];
  const trustProfiles = sortProfiles(
    fallbackAgents.map((agentId) => buildTrustProfile(agentId, capability, recentExecutions))
  );
  const selectedProfile = trustProfiles[0];
  const workflowId = input.workflowId ?? `workflow-${uuid4().slice(0, 8)}`;
  const evidenceRefs = [
    ...summarizeEvidence(selectedProfile.agent_id, recentExecutions).evidenceRefs,
    `scorecard:LIN-261:${intent.capability}`
  ];
  const decision = {
    decision_id: `route-${uuid4().slice(0, 8)}`,
    intent,
    selected_agent_id: selectedProfile.agent_id,
    selected_capability: capability,
    trust_score: selectedProfile.bayesian_score,
    reason_code: candidates.length > 0 && selectedProfile.success_count + selectedProfile.fail_count > 0 ? "TRUST_WIN" : candidates.length > 0 ? "FLOW_SPECIALIZATION" : "FALLBACK_ROUTE",
    evidence_refs: evidenceRefs.slice(0, 6),
    ...candidates.length > 0 ? {} : { waiver_reason: "No capability-specific agent was registered; defaulted to rlm." },
    decided_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  rememberDecision(decision);
  return {
    selectedAgentId: selectedProfile.agent_id,
    intent,
    trustProfiles,
    decision,
    workflowEnvelope: buildWorkflowEnvelope(workflowId, intent, selectedProfile.agent_id, routeScope)
  };
}
function getRecentRoutingDecisions() {
  return [...recentRoutingDecisions];
}
function buildRoutingDashboardData(recentExecutions) {
  const allProfiles = Object.keys(CAPABILITY_CANDIDATES).flatMap((capability) => {
    const profiles = getCandidateAgents(capability).map((agentId) => buildTrustProfile(agentId, capability, recentExecutions));
    return sortProfiles(profiles).slice(0, 2);
  });
  return {
    recentDecisions: getRecentRoutingDecisions().slice(0, 10),
    topTrustProfiles: allProfiles
  };
}
var CAPABILITY_CANDIDATES, CAPABILITY_META, recentRoutingDecisions;
var init_routing_engine = __esm({
  "src/routing-engine.ts"() {
    "use strict";
    init_agent_registry();
    CAPABILITY_CANDIDATES = {
      engagement_intake: ["the-snout", "harvest", "lc-harvester"],
      guided_decomposition: ["nexus", "rlm", "consulting"],
      verified_recommendation: ["omega", "consulting", "rlm"],
      learning_feedback: ["cma", "nexus", "rlm"],
      workflow_audit: ["omega", "custodian", "legal", "lc-sentinel"]
    };
    CAPABILITY_META = {
      engagement_intake: {
        taskDomain: "intake",
        flowRef: "core-flow-1",
        workflowType: "research",
        workflowPhase: "discover",
        scorecardDimensions: ["prioritization_quality", "time_to_verified_decision"],
        trustDimension: "prioritization_quality"
      },
      guided_decomposition: {
        taskDomain: "decomposition",
        flowRef: "core-flow-2",
        workflowType: "delivery",
        workflowPhase: "define",
        scorecardDimensions: ["decomposition_quality", "decision_stability"],
        trustDimension: "decomposition_quality"
      },
      verified_recommendation: {
        taskDomain: "recommendation",
        flowRef: "core-flow-3",
        workflowType: "delivery",
        workflowPhase: "deliver",
        scorecardDimensions: ["promotion_precision", "decision_stability", "time_to_verified_decision"],
        trustDimension: "promotion_precision"
      },
      learning_feedback: {
        taskDomain: "learning",
        flowRef: "core-flow-3",
        workflowType: "audit",
        workflowPhase: "deliver",
        scorecardDimensions: ["operator_acceptance", "decision_stability"],
        trustDimension: "operator_acceptance"
      },
      workflow_audit: {
        taskDomain: "audit",
        flowRef: "core-flow-3",
        workflowType: "audit",
        workflowPhase: "deliver",
        scorecardDimensions: ["tri_source_arbitration_divergence", "decision_stability"],
        trustDimension: "decision_stability"
      }
    };
    recentRoutingDecisions = [];
  }
});

// src/chain-engine.ts
import { v4 as uuid5 } from "uuid";
function persistExecution(exec) {
  executions.set(exec.execution_id, exec);
  const redis2 = getRedis();
  if (redis2) {
    redis2.hset("orchestrator:chains", exec.execution_id, JSON.stringify(exec)).catch(() => {
    });
    redis2.expire("orchestrator:chains", 86400).catch(() => {
    });
  }
}
function getExecution(id) {
  return executions.get(id);
}
function listExecutions() {
  return Array.from(executions.values()).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 50);
}
async function executeStep(step, previousOutput) {
  const stepId = step.id ?? uuid5().slice(0, 8);
  const t0 = Date.now();
  const prevStr = typeof previousOutput === "string" ? previousOutput : JSON.stringify(previousOutput ?? "");
  try {
    let output;
    if (step.cognitive_action) {
      const prompt = step.prompt?.replace(/\{\{prev\}\}/g, prevStr) ?? prevStr;
      output = await callCognitive(step.cognitive_action, {
        prompt,
        context: step.arguments,
        agent_id: step.agent_id
      }, step.timeout_ms);
    } else if (step.tool_name) {
      const args = { ...step.arguments };
      for (const [k, v] of Object.entries(args)) {
        if (typeof v === "string") {
          args[k] = v.replace(/\{\{prev\}\}/g, prevStr);
        }
      }
      if (typeof args.context === "string") {
        args.context = { instruction: args.context };
      }
      const result = await callMcpTool({
        toolName: step.tool_name,
        args,
        callId: uuid5(),
        timeoutMs: step.timeout_ms ?? 3e4
      });
      if (result.status !== "success") {
        throw new Error(result.error_message ?? `Tool ${step.tool_name} failed: ${result.status}`);
      }
      output = result.result;
    } else {
      throw new Error("Step must have either tool_name or cognitive_action");
    }
    return {
      step_id: stepId,
      agent_id: step.agent_id,
      action: step.tool_name ?? `cognitive:${step.cognitive_action}`,
      status: "success",
      output,
      duration_ms: Date.now() - t0
    };
  } catch (err) {
    return {
      step_id: stepId,
      agent_id: step.agent_id,
      action: step.tool_name ?? `cognitive:${step.cognitive_action}`,
      status: "error",
      output: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - t0
    };
  }
}
async function runSequential(steps) {
  const results = [];
  let previousOutput = null;
  for (const step of steps) {
    const result = await executeStep(step, previousOutput);
    results.push(result);
    if (result.status === "error") break;
    previousOutput = result.output;
  }
  return results;
}
async function runParallel(steps) {
  return Promise.all(steps.map((step) => executeStep(step, null)));
}
async function runLoop(steps, maxIterations, exitCondition) {
  const allResults = [];
  let previousOutput = null;
  for (let i = 0; i < maxIterations; i++) {
    const iterResults = await runSequential(
      steps.map((s) => ({ ...s, id: `${s.id ?? s.agent_id}-iter${i}` }))
    );
    allResults.push(...iterResults);
    const lastResult = iterResults[iterResults.length - 1];
    if (lastResult?.status === "error") break;
    previousOutput = lastResult?.output;
    const outputStr = JSON.stringify(previousOutput);
    if (exitCondition && outputStr.includes(exitCondition)) {
      logger.info({ iteration: i, exitCondition }, "Loop exit condition met");
      break;
    }
  }
  return allResults;
}
async function classifyComplexity(query) {
  try {
    const result = await callCognitive("reason", {
      prompt: `Classify this query's complexity for a multi-agent system. Reply with ONLY one word: simple, medium, or complex.

Query: "${query}"

Rules:
- simple: direct lookup, single-hop, factual (\u2192 sequential chain)
- medium: multi-step, requires 2-3 sources, some reasoning (\u2192 parallel chain)
- complex: multi-hop reasoning, debate-worthy, ambiguous, strategic (\u2192 debate+parallel)`,
      context: {},
      agent_id: "orchestrator"
    }, 15e3);
    const text = String(result ?? "").toLowerCase().trim();
    if (text.includes("complex")) return "complex";
    if (text.includes("medium")) return "medium";
    return "simple";
  } catch {
    return "medium";
  }
}
async function runAdaptive(steps, query, judgeAgent, confidenceThreshold = 0.6) {
  const complexity = query ? await classifyComplexity(query) : "medium";
  logger.info({ complexity, query: query?.slice(0, 80) }, "AGoT: classified complexity");
  let results;
  let topology;
  switch (complexity) {
    case "simple":
      topology = "sequential";
      results = await runSequential(steps);
      break;
    case "medium":
      topology = "parallel";
      results = await runParallel(steps);
      break;
    case "complex":
      topology = "debate+verify";
      results = await runDebateGVU(steps, judgeAgent, confidenceThreshold);
      break;
    default:
      topology = "sequential";
      results = await runSequential(steps);
  }
  results.forEach((r) => {
    r.topology = topology;
  });
  return { results, chosen_topology: topology };
}
async function persistFunnelState(state) {
  const redis2 = getRedis();
  if (!redis2) return;
  await redis2.set(
    `${FUNNEL_REDIS_PREFIX}${state.execution_id}`,
    JSON.stringify(state),
    "EX",
    86400 * 7
    // 7 day TTL
  ).catch(() => {
  });
}
async function loadFunnelState(executionId) {
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const raw = await redis2.get(`${FUNNEL_REDIS_PREFIX}${executionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function runFunnel(steps, entryStage = "signal", preloadedContext, executionId) {
  const execId = executionId ?? uuid5();
  const entryIndex = FUNNEL_STAGES.indexOf(entryStage);
  let state = await loadFunnelState(execId);
  if (!state) {
    state = {
      execution_id: execId,
      current_stage: entryStage,
      stage_outputs: {},
      started_at: (/* @__PURE__ */ new Date()).toISOString(),
      last_updated: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (preloadedContext && entryIndex > 0) {
      const prevStage = FUNNEL_STAGES[entryIndex - 1];
      state.stage_outputs[prevStage] = preloadedContext;
    }
  }
  const results = [];
  for (let i = entryIndex; i < FUNNEL_STAGES.length; i++) {
    const stage = FUNNEL_STAGES[i];
    const step = steps[i];
    if (!step) {
      logger.info({ stage, index: i }, "Funnel: no step defined for stage, skipping");
      continue;
    }
    const prevStage = i > 0 ? FUNNEL_STAGES[i - 1] : null;
    const previousOutput = prevStage ? state.stage_outputs[prevStage] : preloadedContext ?? null;
    state.current_stage = stage;
    state.last_updated = (/* @__PURE__ */ new Date()).toISOString();
    await persistFunnelState(state);
    logger.info({ stage, step_index: i, execution_id: execId }, "Funnel: executing stage");
    const taggedStep = { ...step, id: step.id ?? `funnel-${stage}` };
    const result = await executeStep(taggedStep, previousOutput);
    result.funnel_stage = stage;
    result.stage_index = i;
    results.push(result);
    state.stage_outputs[stage] = result.output;
    state.last_updated = (/* @__PURE__ */ new Date()).toISOString();
    await persistFunnelState(state);
    if (result.status === "error") {
      logger.warn({ stage, error: result.output }, "Funnel: stage failed, state saved for resume");
      break;
    }
  }
  return { results, funnel_state: state };
}
async function runDebateGVU(steps, judgeAgent, confidenceThreshold = 0.6) {
  const debateResults = await runParallel(steps);
  if (!judgeAgent) return debateResults;
  const positions = debateResults.map((r) => ({
    agent: r.agent_id,
    position: typeof r.output === "string" ? r.output.slice(0, 500) : JSON.stringify(r.output).slice(0, 500),
    status: r.status
  }));
  const verifyResult = await executeStep({
    agent_id: judgeAgent,
    cognitive_action: "analyze",
    prompt: `You are the VERIFIER in a GVU (Generator-Verifier-Updater) loop.

Score each position on a 0-1 confidence scale and synthesize the best answer.
Only accept positions with confidence >= ${confidenceThreshold}.

Positions:
${JSON.stringify(positions, null, 2)}

Reply as JSON: {"synthesis": "best answer", "scores": [{"agent": "id", "confidence": 0.0-1.0, "accepted": true/false}], "overall_confidence": 0.0-1.0}`
  }, positions);
  let verification = {};
  try {
    const raw = String(verifyResult.output ?? "");
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) verification = JSON.parse(match[0]);
  } catch {
    verification = { synthesis: verifyResult.output, overall_confidence: 0.5, scores: [] };
  }
  for (const r of debateResults) {
    const score = verification.scores?.find((s) => s.agent === r.agent_id);
    r.confidence = score?.confidence ?? 0.5;
    r.verified = score?.accepted ?? r.confidence >= confidenceThreshold;
  }
  verifyResult.confidence = verification.overall_confidence ?? 0.5;
  verifyResult.verified = true;
  verifyResult.output = verification.synthesis ?? verifyResult.output;
  return [...debateResults, verifyResult];
}
async function resolveAutoSteps(def) {
  const routingDecisions = [];
  let workflowEnvelope;
  const resolvedSteps = def.steps.map((step, index) => {
    if (step.agent_id !== "auto") return step;
    const resolution = resolveRoutingDecision({
      message: step.prompt ?? def.query ?? def.name,
      capabilityHint: step.capability,
      routeScope: ["widgetdc-orchestrator", "widgetdc-librechat"],
      operatorVisible: true,
      recentExecutions: listExecutions(),
      workflowId: def.chain_id ?? `adaptive-${index}-${Date.now().toString(36)}`
    });
    routingDecisions.push(resolution.decision);
    workflowEnvelope = workflowEnvelope ?? resolution.workflowEnvelope;
    return {
      ...step,
      agent_id: resolution.selectedAgentId
    };
  });
  return { steps: resolvedSteps, routingDecisions, workflowEnvelope };
}
async function executeChain(def) {
  const executionId = uuid5();
  const chainId = def.chain_id ?? uuid5().slice(0, 12);
  const t0 = Date.now();
  const execution = {
    execution_id: executionId,
    chain_id: chainId,
    name: def.name,
    mode: def.mode,
    status: "running",
    steps_completed: 0,
    steps_total: def.steps.length,
    results: [],
    started_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  persistExecution(execution);
  logger.info({ execution_id: executionId, chain: def.name, mode: def.mode, steps: def.steps.length }, "Chain execution started");
  broadcastMessage({
    from: "Orchestrator",
    to: "All",
    source: "orchestrator",
    type: "Message",
    message: `Chain "${def.name}" started (${def.mode}, ${def.steps.length} steps)`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  try {
    const { steps: resolvedSteps, routingDecisions, workflowEnvelope } = def.mode === "adaptive" || def.steps.some((step) => step.agent_id === "auto") ? await resolveAutoSteps(def) : { steps: def.steps, routingDecisions: [], workflowEnvelope: void 0 };
    execution.routing_decisions = routingDecisions;
    execution.workflow_envelope = workflowEnvelope;
    let results;
    switch (def.mode) {
      case "sequential":
        results = await runSequential(resolvedSteps);
        break;
      case "parallel":
        results = await runParallel(resolvedSteps);
        break;
      case "loop":
        results = await runLoop(resolvedSteps, def.max_iterations ?? 5, def.exit_condition);
        break;
      case "debate":
        results = await runDebateGVU(resolvedSteps, def.judge_agent, def.confidence_threshold);
        break;
      case "adaptive": {
        const adaptive = await runAdaptive(resolvedSteps, def.query, def.judge_agent, def.confidence_threshold);
        results = adaptive.results;
        execution.chosen_topology = adaptive.chosen_topology;
        break;
      }
      case "funnel": {
        const funnelResult = await runFunnel(
          resolvedSteps,
          def.funnel_entry,
          def.funnel_context,
          executionId
        );
        results = funnelResult.results;
        execution.funnel_state = funnelResult.funnel_state;
        break;
      }
      default:
        throw new Error(`Unknown chain mode: ${def.mode}`);
    }
    const failed = results.some((r) => r.status === "error");
    execution.results = results;
    execution.steps_completed = results.filter((r) => r.status === "success").length;
    execution.status = failed ? "failed" : "completed";
    execution.final_output = results[results.length - 1]?.output;
    execution.duration_ms = Date.now() - t0;
    execution.completed_at = (/* @__PURE__ */ new Date()).toISOString();
  } catch (err) {
    execution.status = "failed";
    execution.error = err instanceof Error ? err.message : String(err);
    execution.duration_ms = Date.now() - t0;
    execution.completed_at = (/* @__PURE__ */ new Date()).toISOString();
  }
  persistExecution(execution);
  logger.info({
    execution_id: executionId,
    status: execution.status,
    steps: execution.steps_completed,
    ms: execution.duration_ms
  }, "Chain execution complete");
  if (execution.status === "completed" && execution.final_output) {
    try {
      const { hookAutoEnrichment: hookAutoEnrichment3 } = await Promise.resolve().then(() => (init_compound_hooks(), compound_hooks_exports));
      const outputStr = typeof execution.final_output === "string" ? execution.final_output : JSON.stringify(execution.final_output).slice(0, 3e3);
      hookAutoEnrichment3(outputStr, def.name);
    } catch {
    }
  }
  broadcastMessage({
    from: "Orchestrator",
    to: "All",
    source: "orchestrator",
    type: "Message",
    message: `Chain "${def.name}" ${execution.status} (${execution.steps_completed}/${execution.steps_total} steps, ${execution.duration_ms}ms)`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  return execution;
}
var FUNNEL_STAGES, executions, FUNNEL_REDIS_PREFIX;
var init_chain_engine = __esm({
  "src/chain-engine.ts"() {
    "use strict";
    init_mcp_caller();
    init_cognitive_proxy();
    init_chat_broadcaster();
    init_logger();
    init_redis();
    init_routing_engine();
    FUNNEL_STAGES = [
      "signal",
      "pattern",
      "block",
      "assembly",
      "arbitration",
      "decision",
      "artifact"
    ];
    executions = /* @__PURE__ */ new Map();
    FUNNEL_REDIS_PREFIX = "orchestrator:funnel:";
  }
});

// src/tool-registry.ts
var tool_registry_exports = {};
__export(tool_registry_exports, {
  TOOL_REGISTRY: () => TOOL_REGISTRY,
  defineTool: () => defineTool,
  getCategories: () => getCategories,
  getTool: () => getTool,
  getToolsByCategory: () => getToolsByCategory,
  toMCPTools: () => toMCPTools,
  toOpenAITools: () => toOpenAITools,
  toOpenAPIPaths: () => toOpenAPIPaths
});
import { z } from "zod";
function inferCategory(namespace) {
  const map3 = {
    knowledge: "knowledge",
    graph: "graph",
    cognitive: "cognitive",
    chains: "chains",
    agents: "agents",
    assembly: "assembly",
    decisions: "decisions",
    adoption: "adoption",
    linear: "linear",
    compliance: "compliance",
    llm: "llm",
    monitor: "monitor",
    mcp: "mcp"
  };
  return map3[namespace] ?? "mcp";
}
function inferTags(name) {
  return name.split("_").filter((t) => t.length > 2);
}
function zodToJsonSchemaSimple(schema) {
  const shape = schema.shape;
  const properties = {};
  const required2 = [];
  for (const [key, field] of Object.entries(shape)) {
    const def = field.def ?? field._def ?? field;
    const isOptional = def.type === "optional" || def.typeName === "ZodOptional";
    const inner = isOptional ? def.innerType ?? def.schema ?? def : def;
    const prop = {};
    const innerType = inner.type ?? inner.typeName ?? "string";
    if (innerType === "string" || innerType === "ZodString") prop.type = "string";
    else if (innerType === "number" || innerType === "ZodNumber") prop.type = "number";
    else if (innerType === "boolean" || innerType === "ZodBoolean") prop.type = "boolean";
    else if (innerType === "array" || innerType === "ZodArray") {
      prop.type = "array";
      const itemType = inner.element ?? inner.items ?? inner.def?.element;
      if (itemType) {
        const itemDef = itemType.def ?? itemType._def ?? itemType;
        const itemKind = itemDef.type ?? itemDef.typeName ?? "string";
        if (itemKind === "string" || itemKind === "ZodString") prop.items = { type: "string" };
        else if (itemKind === "number" || itemKind === "ZodNumber") prop.items = { type: "number" };
        else if (itemKind === "boolean" || itemKind === "ZodBoolean") prop.items = { type: "boolean" };
        else if (itemKind === "enum" || itemKind === "ZodEnum") prop.items = { type: "string", enum: itemDef.values ?? itemDef.def?.values };
        else if (itemType.shape) prop.items = zodToJsonSchemaSimple(itemType);
        else prop.items = { type: "object" };
      } else {
        prop.items = { type: "object" };
      }
    } else if (innerType === "object" || innerType === "ZodObject") {
      Object.assign(prop, zodToJsonSchemaSimple(inner));
    } else if (innerType === "enum" || innerType === "ZodEnum") {
      prop.type = "string";
      prop.enum = inner.values ?? inner.def?.values ?? inner.options;
    } else if (innerType === "record" || innerType === "ZodRecord") {
      prop.type = "object";
    } else {
      prop.type = "string";
    }
    const desc = field.description ?? def.description ?? inner.description;
    if (desc) prop.description = desc;
    properties[key] = prop;
    if (!isOptional) required2.push(key);
  }
  const result = { type: "object", properties };
  if (required2.length > 0) result.required = required2;
  return result;
}
function defineTool(opts) {
  const inputSchema = zodToJsonSchemaSimple(opts.input);
  return {
    name: opts.name,
    namespace: opts.namespace,
    version: opts.version ?? "1.0",
    description: opts.description,
    category: inferCategory(opts.namespace),
    inputSchema,
    outputDescription: opts.outputDescription,
    handler: opts.backendTool ? "mcp-proxy" : "orchestrator",
    backendTool: opts.backendTool,
    timeoutMs: opts.timeoutMs ?? 3e4,
    authRequired: opts.authRequired ?? true,
    availableVia: opts.availableVia ?? ["openai", "openapi", "mcp"],
    tags: inferTags(opts.name),
    deprecated: opts.deprecated ?? false,
    deprecatedSince: opts.deprecatedSince,
    deprecatedMessage: opts.deprecatedMessage,
    sunsetDate: opts.sunsetDate,
    replacedBy: opts.replacedBy
  };
}
function toOpenAITools() {
  return TOOL_REGISTRY.filter((t) => t.availableVia.includes("openai")).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      ...t.deprecated ? { deprecated: true } : {}
    }
  }));
}
function toMCPTools() {
  return TOOL_REGISTRY.filter((t) => t.availableVia.includes("mcp")).map((t) => {
    let description = t.description;
    if (t.deprecated) {
      const parts = [`[DEPRECATED since ${t.deprecatedSince ?? "unknown"}]`];
      if (t.replacedBy) parts.push(`Use "${t.replacedBy}" instead.`);
      if (t.deprecatedMessage) parts.push(t.deprecatedMessage);
      if (t.sunsetDate) parts.push(`Sunset: ${t.sunsetDate}.`);
      description = `${parts.join(" ")} \u2014 ${description}`;
    }
    return { name: t.name, description, inputSchema: t.inputSchema };
  });
}
function toOpenAPIPaths() {
  const paths = {};
  for (const tool of TOOL_REGISTRY.filter((t) => t.availableVia.includes("openapi"))) {
    const operationId = tool.name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    paths[`/api/tools/${tool.name}`] = {
      post: {
        operationId: `tool_${operationId}`,
        summary: tool.description.slice(0, 80),
        description: tool.description,
        tags: [tool.category.charAt(0).toUpperCase() + tool.category.slice(1)],
        security: tool.authRequired ? [{ BearerAuth: [] }] : [],
        ...tool.deprecated ? { deprecated: true } : {},
        requestBody: {
          required: true,
          content: { "application/json": { schema: tool.inputSchema } }
        },
        responses: {
          "200": {
            description: tool.outputDescription ?? "Tool result",
            content: { "application/json": { schema: { type: "object" } } }
          },
          "400": { description: "Validation error" },
          "401": { description: "Unauthorized" }
        }
      }
    };
  }
  return paths;
}
function getTool(name) {
  return TOOL_REGISTRY.find((t) => t.name === name);
}
function getToolsByCategory(category) {
  return TOOL_REGISTRY.filter((t) => t.category === category);
}
function getCategories() {
  const counts = /* @__PURE__ */ new Map();
  for (const t of TOOL_REGISTRY) {
    counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}
var TOOL_REGISTRY;
var init_tool_registry = __esm({
  "src/tool-registry.ts"() {
    "use strict";
    TOOL_REGISTRY = [
      defineTool({
        name: "search_knowledge",
        namespace: "knowledge",
        description: "Search the WidgeTDC knowledge graph and semantic vector store. Use for ANY question about platform data, consulting knowledge, patterns, documents, or entities. Returns merged results from SRAG (semantic) and Neo4j (graph).",
        input: z.object({
          query: z.string().describe("Natural language search query"),
          max_results: z.number().optional().describe("Max results (default 10)")
        }),
        backendTool: "srag.query + graph.read_cypher",
        timeoutMs: 2e4
      }),
      defineTool({
        name: "reason_deeply",
        namespace: "cognitive",
        description: "Send a complex question to the RLM reasoning engine for deep multi-step analysis. Use for strategy questions, architecture analysis, comparisons, evaluations, and planning.",
        input: z.object({
          question: z.string().describe("The complex question to reason about"),
          mode: z.enum(["reason", "analyze", "plan"]).optional().describe("Reasoning mode (default: reason)")
        }),
        backendTool: "rlm.reason",
        timeoutMs: 45e3
      }),
      defineTool({
        name: "query_graph",
        namespace: "graph",
        description: "Execute a Cypher query against the Neo4j knowledge graph (475K+ nodes, 3.8M+ relationships). Use for structured data queries like counting nodes, finding relationships, listing entities.",
        input: z.object({
          cypher: z.string().describe("Neo4j Cypher query (read-only, parameterized)"),
          params: z.record(z.unknown()).optional().describe("Query parameters")
        }),
        backendTool: "graph.read_cypher",
        timeoutMs: 15e3
      }),
      defineTool({
        name: "check_tasks",
        namespace: "linear",
        description: "Get active tasks, issues, and project status from the knowledge graph. Use when asked about project status, next steps, blockers, sprints, or Linear issues.",
        input: z.object({
          filter: z.enum(["active", "blocked", "recent", "all"]).optional().describe("Task filter (default: active)"),
          keyword: z.string().optional().describe("Optional keyword to filter tasks")
        }),
        backendTool: "graph.read_cypher",
        timeoutMs: 1e4
      }),
      defineTool({
        name: "call_mcp_tool",
        namespace: "mcp",
        description: "Call any of the 449+ MCP tools on the WidgeTDC backend. Use for specific platform operations like embedding, compliance checks, memory operations, agent coordination.",
        input: z.object({
          tool_name: z.string().describe("MCP tool name (e.g., srag.query, graph.health, audit.dashboard)"),
          payload: z.record(z.unknown()).optional().describe("Tool payload arguments")
        }),
        backendTool: "(dynamic)"
      }),
      defineTool({
        name: "get_platform_health",
        namespace: "monitor",
        description: "Get current health status of all WidgeTDC platform services (backend, RLM engine, Neo4j graph, Redis). Use when asked about system status, uptime, or health.",
        input: z.object({}),
        backendTool: "graph.health + graph.stats",
        timeoutMs: 1e4
      }),
      defineTool({
        name: "search_documents",
        namespace: "knowledge",
        description: "Search for specific documents, files, reports, or artifacts in the platform. Returns document metadata and content snippets.",
        input: z.object({
          query: z.string().describe("Document search query"),
          doc_type: z.string().optional().describe("Optional filter: TDCDocument, ConsultingArtifact, Pattern, etc.")
        }),
        backendTool: "srag.query",
        timeoutMs: 2e4
      }),
      defineTool({
        name: "linear_issues",
        namespace: "linear",
        description: "Get issues from Linear project management. Use for project status, active tasks, sprint progress, blockers, or specific issue details (LIN-xxx).",
        input: z.object({
          query: z.string().optional().describe('Search query or issue identifier (e.g., "LIN-493")'),
          status: z.enum(["active", "done", "backlog", "all"]).optional().describe("Filter by status (default: active)"),
          limit: z.number().optional().describe("Max results (default 10)")
        }),
        backendTool: "linear.issues",
        timeoutMs: 15e3
      }),
      defineTool({
        name: "linear_issue_detail",
        namespace: "linear",
        description: "Get detailed info about a specific Linear issue by identifier (e.g., LIN-493). Returns full description, comments, status, assignee, sub-issues.",
        input: z.object({
          identifier: z.string().describe("Issue identifier (e.g., LIN-493)")
        }),
        backendTool: "linear.issue_get",
        timeoutMs: 15e3
      }),
      defineTool({
        name: "run_chain",
        namespace: "chains",
        description: "Execute a multi-step agent chain. Supports sequential, parallel, debate, and loop modes. Use for complex workflows needing coordinated tool calls.",
        input: z.object({
          name: z.string().describe("Chain name/description"),
          mode: z.enum(["sequential", "parallel", "debate", "loop"]).describe("Execution mode"),
          steps: z.array(z.object({
            agent_id: z.string().describe("Agent identifier"),
            tool_name: z.string().optional().describe("MCP tool to call"),
            cognitive_action: z.string().optional().describe("RLM action: reason, analyze, plan"),
            prompt: z.string().optional().describe("Prompt or arguments")
          })).describe("Chain steps")
        }),
        timeoutMs: 6e4
      }),
      defineTool({
        name: "investigate",
        namespace: "cognitive",
        description: "Run a multi-agent deep investigation on a topic. Returns a comprehensive analysis artifact with graph data, compliance, strategy, and reasoning.",
        input: z.object({
          topic: z.string().describe("The topic to investigate deeply")
        }),
        timeoutMs: 12e4
      }),
      defineTool({
        name: "create_notebook",
        namespace: "knowledge",
        description: "Create an interactive consulting notebook with query, insight, data, and action cells. Executes all cells and returns a full notebook with results.",
        input: z.object({
          topic: z.string().describe("The topic to build a notebook around"),
          cells: z.array(z.object({
            type: z.enum(["query", "insight", "data", "action"]),
            id: z.string().optional(),
            query: z.string().optional(),
            prompt: z.string().optional(),
            source_cell_id: z.string().optional(),
            visualization: z.enum(["table", "chart"]).optional(),
            recommendation: z.string().optional()
          })).optional().describe("Custom cells. If omitted, auto-generates from topic.")
        }),
        timeoutMs: 6e4
      }),
      defineTool({
        name: "verify_output",
        namespace: "compliance",
        description: "Run verification checks on content or data. Checks quality, accuracy, and compliance. Use after other tools to validate results.",
        input: z.object({
          content: z.string().describe("Content to verify"),
          checks: z.array(z.object({
            name: z.string().describe("Check name"),
            tool_name: z.string().describe("MCP tool for verification")
          })).optional().describe("Verification checks to run")
        })
      }),
      defineTool({
        name: "generate_deliverable",
        namespace: "assembly",
        description: "Generate a consulting deliverable (report, roadmap, or assessment) from a natural language prompt. Uses knowledge graph + RAG to produce a structured, citation-backed document. Returns markdown with optional PDF.",
        input: z.object({
          prompt: z.string().describe("What the deliverable should cover (min 10 chars)"),
          type: z.enum(["analysis", "roadmap", "assessment"]).describe("Deliverable type"),
          format: z.enum(["pdf", "markdown"]).optional().describe("Output format (default: markdown)"),
          max_sections: z.number().optional().describe("Max sections (2-8, default 5)")
        }),
        timeoutMs: 12e4,
        outputDescription: "Deliverable with sections, citations, confidence scores, and markdown content"
      }),
      defineTool({
        name: "precedent_search",
        namespace: "knowledge",
        description: "Find similar clients, engagements, or use cases based on shared characteristics. Uses hybrid matching: structural (shared graph relationships) + semantic (embedding similarity). Returns ranked matches with explanation of what dimensions matched.",
        input: z.object({
          query: z.string().describe("Client name, engagement description, or use case to find matches for"),
          dimensions: z.array(z.enum(["industry", "service", "challenge", "domain", "size", "geography", "deliverable"])).optional().describe("Match dimensions (default: industry, service, challenge, domain)"),
          max_results: z.number().optional().describe("Max results (1-20, default 5)"),
          structural_weight: z.number().optional().describe("Weight for structural vs semantic matching (0-1, default 0.6)")
        }),
        timeoutMs: 3e4,
        outputDescription: "Ranked list of similar clients with scores, shared dimensions, and match method"
      }),
      defineTool({
        name: "governance_matrix",
        namespace: "compliance",
        description: "Get the WidgeTDC Manifesto enforcement matrix \u2014 maps all 10 principles to their runtime enforcement mechanisms. Shows status (ENFORCED/PARTIAL/GAP), enforcement layer, and gap remediation.",
        input: z.object({
          filter: z.enum(["all", "enforced", "gaps"]).optional().describe("Filter by status (default: all)")
        }),
        timeoutMs: 5e3,
        outputDescription: "10-principle enforcement matrix with status, mechanism, and gap remediation"
      }),
      defineTool({
        name: "run_osint_scan",
        namespace: "knowledge",
        description: "Run OSINT scanning pipeline on Danish public sector domains. Scans CT logs + DMARC/SPF and ingests results to Neo4j.",
        input: z.object({
          domains: z.array(z.string()).optional().describe("Override domain list (default: 50 DK public domains)"),
          scan_type: z.enum(["full", "ct_only", "dmarc_only"]).optional().describe("Scan type (default: full)")
        }),
        timeoutMs: 6e5,
        outputDescription: "Scan results with CT entries, DMARC results, and ingestion counts"
      }),
      defineTool({
        name: "list_tools",
        namespace: "monitor",
        description: "List all available orchestrator tools with their schemas, protocols, and categories. Use to discover what tools are available and how to call them.",
        input: z.object({
          namespace: z.string().optional().describe("Filter by namespace"),
          category: z.string().optional().describe("Filter by category")
        }),
        timeoutMs: 5e3,
        outputDescription: "List of tool definitions with schemas and metadata"
      }),
      defineTool({
        name: "run_evolution",
        namespace: "chains",
        description: "Trigger one cycle of the autonomous evolution loop (OODA: Observe\u2192Orient\u2192Act\u2192Learn). Assesses platform state, identifies improvement opportunities, executes changes, and captures lessons.",
        input: z.object({
          focus_area: z.string().optional().describe("Optional focus area for this cycle"),
          dry_run: z.boolean().optional().describe("If true, plan only without executing")
        }),
        timeoutMs: 3e5,
        outputDescription: "Evolution cycle results with observations, actions taken, and lessons learned"
      }),
      // ─── v3.0 Adoption Sprint 1: Missing tools ────────────────────────────────
      defineTool({
        name: "ingest_document",
        namespace: "knowledge",
        description: "Ingest a document into the knowledge graph. Parses content, extracts entities via LLM, MERGEs to Neo4j, and indexes for vector search. Supports markdown, text, and PDF (via Docling).",
        input: z.object({
          content: z.string().describe("Document content (markdown, text, or base64 PDF)"),
          filename: z.string().describe("Source filename"),
          domain: z.string().optional().describe("Target domain for classification"),
          extract_entities: z.boolean().optional().describe("Extract and link entities (default: true)")
        }),
        timeoutMs: 6e4,
        outputDescription: "Ingestion result with entities extracted, nodes merged, and parsing method"
      }),
      defineTool({
        name: "build_communities",
        namespace: "graph",
        description: "Build hierarchical community summaries from the knowledge graph using Leiden community detection. Creates CommunitySummary nodes with LLM-generated summaries and MEMBER_OF relationships. Used for thematic retrieval.",
        input: z.object({}),
        timeoutMs: 12e4,
        outputDescription: "Community build result with count, summaries generated, and method used"
      }),
      defineTool({
        name: "adaptive_rag_dashboard",
        namespace: "monitor",
        description: "Get the Adaptive RAG dashboard showing current routing weights, per-strategy performance stats, compound intelligence metric (accuracy \xD7 quality \xD7 coverage), and training sample count.",
        input: z.object({}),
        timeoutMs: 1e4,
        outputDescription: "Adaptive RAG weights, strategy stats, and compound metric"
      }),
      defineTool({
        name: "graph_hygiene_run",
        namespace: "monitor",
        description: "Run graph health check: 6 metrics (orphan ratio, avg rels, embedding coverage, domain count, stale nodes, pollution). Stores GraphHealthSnapshot and alerts on anomalies.",
        input: z.object({}),
        timeoutMs: 3e4,
        outputDescription: "Health metrics with alerts if thresholds are crossed"
      }),
      // ─── SNOUT Wave 2: Steal Smart ──────────────────────────────────────────────
      defineTool({
        name: "critique_refine",
        namespace: "intelligence",
        description: "Run Constitutional AI-inspired generate\u2192critique\u2192revise pipeline. Generates a response, critiques it against quality principles, then revises. Returns original, critique, and refined version.",
        input: z.object({
          query: z.string().describe("The query or task to process"),
          provider: z.string().optional().describe("LLM provider (default: deepseek)"),
          principles: z.array(z.string()).optional().describe("Custom critique principles (default: 5 standard)"),
          max_rounds: z.number().optional().describe("Max refine rounds (default: 1)")
        }),
        timeoutMs: 12e4,
        outputDescription: "Original response, critique, revised response, and timing"
      }),
      defineTool({
        name: "judge_response",
        namespace: "intelligence",
        description: "Score an agent response on 5 PRISM dimensions (Precision, Reasoning, Information, Safety, Methodology). Returns 0-10 scores per dimension plus aggregate. Based on openevals prompt templates.",
        input: z.object({
          query: z.string().describe("The original query/task"),
          response: z.string().describe("The agent response to evaluate"),
          context: z.string().optional().describe("Optional reference context or expected answer"),
          provider: z.string().optional().describe("LLM provider for judging (default: deepseek)")
        }),
        timeoutMs: 6e4,
        outputDescription: "PRISM scores (0-10 each) with aggregate and explanation"
      })
    ];
  }
});

// src/document-intelligence.ts
var document_intelligence_exports = {};
__export(document_intelligence_exports, {
  batchIngest: () => batchIngest,
  ingestDocument: () => ingestDocument
});
import { v4 as uuid7 } from "uuid";
async function persistResult(result) {
  const redis2 = getRedis();
  if (!redis2) return;
  try {
    await redis2.set(`${REDIS_PREFIX}${result.$id}`, JSON.stringify(result), "EX", 604800);
  } catch {
  }
}
async function ingestDocument(req) {
  const t0 = Date.now();
  const ingestionId = `widgetdc:ingestion:${uuid7()}`;
  logger.info({
    id: ingestionId,
    filename: req.filename,
    content_length: req.content.length
  }, "Document intelligence: starting ingestion");
  const result = {
    $id: ingestionId,
    filename: req.filename,
    status: "completed",
    content_length: req.content.length,
    sections_found: 0,
    tables_found: 0,
    entities_extracted: 0,
    relations_extracted: 0,
    nodes_merged: 0,
    duration_ms: 0,
    parsing_method: "text-fallback"
  };
  try {
    let markdown;
    let tables = [];
    const doclingResult = await tryDoclingParse(req);
    if (doclingResult) {
      markdown = doclingResult.markdown;
      tables = doclingResult.tables;
      result.parsing_method = "docling";
    } else {
      markdown = req.content;
      result.parsing_method = req.content_type === "application/pdf" ? "text-fallback" : "text-fallback";
    }
    result.sections_found = (markdown.match(/^#{1,3}\s/gm) ?? []).length;
    result.tables_found = tables.length + (markdown.match(/\|.*\|.*\|/g) ?? []).length;
    let processableContent = markdown;
    if (markdown.length > 3e4) {
      try {
        const folded = await callCognitive("fold", {
          prompt: markdown,
          context: { strategy: "entity_preserving", max_tokens: 8e3 },
          agent_id: "document-intelligence"
        }, 3e4);
        processableContent = typeof folded === "string" ? folded : JSON.stringify(folded);
        logger.info({ original: markdown.length, folded: processableContent.length }, "Document folded for entity extraction");
      } catch {
        processableContent = markdown.slice(0, 3e4);
      }
    }
    if (req.extract_entities !== false) {
      const extraction = await extractEntities(processableContent, req.filename, req.domain);
      result.entities_extracted = extraction.entities.length;
      result.relations_extracted = extraction.relations.length;
      if (extraction.entities.length > 0) {
        const merged = await mergeToGraph(extraction.entities, extraction.relations, req);
        result.nodes_merged = merged;
      }
    }
    if (req.generate_embeddings !== false) {
      try {
        await callMcpTool({
          toolName: "vidensarkiv.add",
          args: {
            title: req.filename,
            content: markdown.slice(0, 1e4),
            source: req.source_url ?? req.filename,
            domain: req.domain ?? "general"
          },
          callId: uuid7(),
          timeoutMs: 2e4
        });
      } catch {
        logger.warn({ filename: req.filename }, "SRAG ingest failed \u2014 entities still in graph");
      }
    }
  } catch (err) {
    result.status = "failed";
    result.error = err instanceof Error ? err.message : String(err);
    logger.error({ id: ingestionId, error: result.error }, "Document intelligence: failed");
  }
  result.duration_ms = Date.now() - t0;
  await persistResult(result);
  logger.info({
    id: ingestionId,
    method: result.parsing_method,
    entities: result.entities_extracted,
    nodes: result.nodes_merged,
    ms: result.duration_ms
  }, "Document intelligence: complete");
  return result;
}
async function tryDoclingParse(req) {
  const doclingUrl = process.env.DOCLING_URL;
  if (!doclingUrl) return null;
  try {
    const res = await fetch(`${doclingUrl}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: req.content,
        filename: req.filename,
        output_format: "markdown"
      }),
      signal: AbortSignal.timeout(6e4)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.markdown) {
      return { markdown: data.markdown, tables: data.tables ?? [] };
    }
  } catch {
    logger.debug("Docling-serve not available \u2014 using fallback");
  }
  return null;
}
async function extractEntities(content, filename, domain) {
  try {
    const result = await callCognitive("analyze", {
      prompt: `Extract named entities and relationships from this document.

DOCUMENT: "${filename}" (domain: ${domain ?? "general"})

CONTENT:
${content.slice(0, 12e3)}

RULES:
- Extract organizations, regulations, technologies, frameworks, methodologies, services
- Extract relationships: USES, COMPLIES_WITH, COMPETES_WITH, PART_OF, RELATES_TO
- Return ONLY entities that are specific and named (not generic concepts)
- Limit to 20 most important entities

Reply as JSON:
{"entities": [{"name": "Entity Name", "type": "Organization|Regulation|Technology|Framework|Service", "properties": {"domain": "...", "description": "..."}}], "relations": [{"from": "Entity A", "to": "Entity B", "type": "USES|COMPLIES_WITH|..."}]}`,
      context: { filename, domain: domain ?? "general", source: "document-intelligence" },
      agent_id: "document-intelligence"
    }, 3e4);
    const text = String(result ?? "");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 20) : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations.slice(0, 30) : []
      };
    }
  } catch (err) {
    logger.warn({ error: String(err), filename }, "Entity extraction failed");
  }
  return { entities: [], relations: [] };
}
async function mergeToGraph(entities, relations, req) {
  let merged = 0;
  for (const entity of entities) {
    try {
      const safeLabel = (entity.type ?? "Knowledge").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
      await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `MERGE (n:${safeLabel} {name: $name})
SET n.domain = $domain, n.source = $source, n.updatedAt = datetime()
WITH n
MERGE (d:TDCDocument {filename: $filename})
MERGE (n)-[:EXTRACTED_FROM]->(d)`,
          params: {
            name: entity.name,
            domain: entity.properties?.domain ?? req.domain ?? "general",
            source: req.source_url ?? req.filename,
            filename: req.filename
          }
        },
        callId: uuid7(),
        timeoutMs: 1e4
      });
      merged++;
    } catch (err) {
      logger.debug({ entity: entity.name, error: String(err) }, "Entity MERGE failed");
    }
  }
  for (const rel of relations) {
    try {
      await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `MATCH (a {name: $from}), (b {name: $to})
MERGE (a)-[:${rel.type.replace(/[^A-Z_]/g, "_")}]->(b)`,
          params: { from: rel.from, to: rel.to }
        },
        callId: uuid7(),
        timeoutMs: 5e3
      });
    } catch {
    }
  }
  return merged;
}
async function batchIngest(documents) {
  const BATCH_SIZE = 5;
  const results = [];
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((d) => ingestDocument(d)));
    for (const r of batchResults) {
      if (r.status === "fulfilled") results.push(r.value);
    }
  }
  return results;
}
var REDIS_PREFIX;
var init_document_intelligence = __esm({
  "src/document-intelligence.ts"() {
    "use strict";
    init_mcp_caller();
    init_cognitive_proxy();
    init_logger();
    init_redis();
    REDIS_PREFIX = "orchestrator:ingestion:";
  }
});

// src/graph-hygiene-cron.ts
var graph_hygiene_cron_exports = {};
__export(graph_hygiene_cron_exports, {
  runGraphHygiene: () => runGraphHygiene
});
import { v4 as uuid8 } from "uuid";
function neo4jInt(val) {
  if (typeof val === "number") return val;
  if (val && typeof val === "object" && "low" in val) return val.low;
  return Number(val) || 0;
}
async function queryMetric(cypher) {
  const result = await callMcpTool({
    toolName: "graph.read_cypher",
    args: { query: cypher },
    callId: uuid8(),
    timeoutMs: 15e3
  });
  if (result.status !== "success") return [];
  const data = result.result;
  return data?.results ?? (Array.isArray(data) ? data : []);
}
async function runGraphHygiene() {
  const t0 = Date.now();
  logger.info("Graph hygiene cron: starting health check");
  const [orphanData, relData, embedData, domainData, staleData, pollutionData] = await Promise.allSettled([
    // 1. Orphan ratio
    queryMetric(`
      MATCH (n) WITH count(n) AS total
      MATCH (o) WHERE NOT (o)-[]-()
      RETURN CASE WHEN total = 0 THEN 0.0 ELSE toFloat(count(o)) / total END AS orphan_ratio, count(o) AS orphan_count, total
    `),
    // 2. Average rels per node
    queryMetric(`
      MATCH (n) OPTIONAL MATCH (n)-[r]-()
      RETURN toFloat(count(r)) / count(DISTINCT n) AS avg_rels
    `),
    // 3. Embedding coverage (nodes with embedding property)
    queryMetric(`
      MATCH (n) WHERE n.embedding IS NOT NULL
      WITH count(n) AS with_emb
      MATCH (m) RETURN toFloat(with_emb) / count(m) AS coverage, with_emb
    `),
    // 4. Domain count
    queryMetric(`MATCH (d:Domain) RETURN count(d) AS domain_count`),
    // 5. Stale nodes (>90 days since update)
    queryMetric(`
      MATCH (n) WHERE n.updatedAt IS NOT NULL AND n.updatedAt < datetime() - duration('P90D')
      RETURN count(n) AS stale_count
    `),
    // 6. Pollution probe
    queryMetric(`
      MATCH (n) WHERE n.content IS NOT NULL
        AND (toLower(n.content) CONTAINS 'you are a helpful'
          OR toLower(n.content) CONTAINS 'as an ai language model'
          OR toLower(n.content) CONTAINS 'your task is to')
      RETURN count(n) AS pollution_count
    `)
  ]);
  const metrics2 = {
    orphan_ratio: 0,
    avg_rels_per_node: 0,
    embedding_coverage: 0,
    domain_count: 0,
    stale_node_count: 0,
    pollution_count: 0
  };
  if (orphanData.status === "fulfilled" && orphanData.value[0]) {
    metrics2.orphan_ratio = Number(orphanData.value[0].orphan_ratio) || 0;
  }
  if (relData.status === "fulfilled" && relData.value[0]) {
    metrics2.avg_rels_per_node = Number(relData.value[0].avg_rels) || 0;
  }
  if (embedData.status === "fulfilled" && embedData.value[0]) {
    metrics2.embedding_coverage = Number(embedData.value[0].coverage) || 0;
  }
  if (domainData.status === "fulfilled" && domainData.value[0]) {
    metrics2.domain_count = neo4jInt(domainData.value[0].domain_count);
  }
  if (staleData.status === "fulfilled" && staleData.value[0]) {
    metrics2.stale_node_count = neo4jInt(staleData.value[0].stale_count);
  }
  if (pollutionData.status === "fulfilled" && pollutionData.value[0]) {
    metrics2.pollution_count = neo4jInt(pollutionData.value[0].pollution_count);
  }
  const alerts = [];
  if (metrics2.orphan_ratio > (THRESHOLDS.orphan_ratio.max ?? 1)) {
    alerts.push({ metric: "orphan_ratio", value: metrics2.orphan_ratio, threshold: 0.05, message: `Orphan ratio ${(metrics2.orphan_ratio * 100).toFixed(1)}% exceeds 5% threshold` });
  }
  if (metrics2.avg_rels_per_node < (THRESHOLDS.avg_rels_per_node.min ?? 0)) {
    alerts.push({ metric: "avg_rels_per_node", value: metrics2.avg_rels_per_node, threshold: 2, message: `Avg rels/node ${metrics2.avg_rels_per_node.toFixed(1)} below minimum 2` });
  }
  if (metrics2.embedding_coverage < (THRESHOLDS.embedding_coverage.min ?? 0)) {
    alerts.push({ metric: "embedding_coverage", value: metrics2.embedding_coverage, threshold: 0.5, message: `Embedding coverage ${(metrics2.embedding_coverage * 100).toFixed(1)}% below 50% threshold` });
  }
  if (metrics2.domain_count !== (THRESHOLDS.domain_count.exact ?? 15)) {
    alerts.push({ metric: "domain_count", value: metrics2.domain_count, threshold: 15, message: `Domain count ${metrics2.domain_count} \u2260 expected 15 (drift detected)` });
  }
  if (metrics2.pollution_count > (THRESHOLDS.pollution_count.max ?? 0)) {
    alerts.push({ metric: "pollution_count", value: metrics2.pollution_count, threshold: 0, message: `${metrics2.pollution_count} polluted nodes detected \u2014 write-gate may have been bypassed` });
  }
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MERGE (s:GraphHealthSnapshot {date: date()})
SET s.orphan_ratio = $orphan_ratio,
    s.avg_rels = $avg_rels,
    s.embedding_coverage = $embedding_coverage,
    s.domain_count = $domain_count,
    s.stale_count = $stale_count,
    s.pollution_count = $pollution_count,
    s.alert_count = $alert_count,
    s.timestamp = datetime()`,
        params: {
          orphan_ratio: metrics2.orphan_ratio,
          avg_rels: metrics2.avg_rels_per_node,
          embedding_coverage: metrics2.embedding_coverage,
          domain_count: metrics2.domain_count,
          stale_count: metrics2.stale_node_count,
          pollution_count: metrics2.pollution_count,
          alert_count: alerts.length
        },
        _force: true
        // Infrastructure write — bypass validation
      },
      callId: uuid8(),
      timeoutMs: 1e4
    });
  } catch (err) {
    logger.warn({ error: String(err) }, "Graph hygiene: failed to store snapshot in Neo4j");
  }
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MATCH (s:GraphHealthSnapshot) WHERE s.timestamp < datetime() - duration('P90D') DETACH DELETE s`,
        _force: true
      },
      callId: uuid8(),
      timeoutMs: 1e4
    });
  } catch {
  }
  if (alerts.length > 0) {
    const alertMsg = alerts.map((a) => `${a.metric}: ${a.message}`).join("\n");
    broadcastSSE("graph-health-alert", { metrics: metrics2, alerts });
    if (isSlackEnabled()) {
      logger.info(`Slack alert: Graph Health Alert (${alerts.length} issues)`);
    }
    logger.warn({ alerts: alerts.length }, `Graph hygiene: ${alerts.length} alerts triggered`);
  }
  const duration_ms = Date.now() - t0;
  logger.info({
    ...metrics2,
    alerts: alerts.length,
    ms: duration_ms
  }, "Graph hygiene cron: complete");
  return { metrics: metrics2, alerts, duration_ms };
}
var THRESHOLDS;
var init_graph_hygiene_cron = __esm({
  "src/graph-hygiene-cron.ts"() {
    "use strict";
    init_mcp_caller();
    init_logger();
    init_sse();
    init_slack();
    THRESHOLDS = {
      orphan_ratio: { max: 0.05 },
      avg_rels_per_node: { min: 2, max: 50 },
      embedding_coverage: { min: 0.5 },
      domain_count: { exact: 15 },
      stale_node_count: { max: 0.1 },
      // ratio
      pollution_count: { max: 0 }
    };
  }
});

// src/similarity-engine.ts
var similarity_engine_exports = {};
__export(similarity_engine_exports, {
  findSimilarClients: () => findSimilarClients,
  getClientDetails: () => getClientDetails
});
import { v4 as uuid9 } from "uuid";
async function findSimilarClients(req) {
  const t0 = Date.now();
  const maxResults = Math.min(Math.max(req.max_results ?? 5, 1), 20);
  const alpha = Math.min(Math.max(req.structural_weight ?? 0.6, 0), 1);
  const dimensions = req.dimensions ?? DEFAULT_DIMENSIONS;
  logger.info({ query: req.query.slice(0, 80), dimensions, alpha }, "Similarity: searching");
  const queryNode = await findQueryNode(req.query);
  let matches;
  let method;
  if (queryNode) {
    const structural = await computeStructuralSimilarity(queryNode.id, queryNode.labels, dimensions);
    const semantic = await computeSemanticSimilarity(req.query, maxResults * 3);
    matches = mergeScores(structural, semantic, alpha, maxResults);
    method = structural.length > 0 && semantic.length > 0 ? "hybrid" : structural.length > 0 ? "graph" : "semantic";
  } else {
    const semantic = await computeSemanticSimilarity(req.query, maxResults * 2);
    matches = semantic.slice(0, maxResults);
    method = "semantic";
  }
  const result = {
    query: req.query,
    query_node_id: queryNode?.id ?? null,
    matches: matches.slice(0, maxResults),
    total_candidates: matches.length,
    dimensions_used: dimensions,
    duration_ms: Date.now() - t0,
    method
  };
  logger.info({
    query: req.query.slice(0, 60),
    matches: result.matches.length,
    method,
    ms: result.duration_ms
  }, "Similarity: complete");
  return result;
}
async function findQueryNode(query) {
  try {
    const result = await callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: `MATCH (n) WHERE (n:Client OR n:Engagement OR n:UseCase OR n:Tender OR n:ConsultingService)
AND (toLower(coalesce(n.name, n.title, '')) CONTAINS toLower($q)
  OR n.id = $q)
RETURN n.id AS id, labels(n) AS labels, coalesce(n.name, n.title) AS name
LIMIT 1`,
        params: { q: query }
      },
      callId: uuid9(),
      timeoutMs: 1e4
    });
    if (result.status === "success") {
      const rows = result.result?.results ?? result.result;
      if (Array.isArray(rows) && rows.length > 0) {
        return { id: String(rows[0].id), labels: rows[0].labels ?? [] };
      }
    }
  } catch (err) {
    logger.warn({ error: String(err) }, "Similarity: query node lookup failed");
  }
  return null;
}
async function computeStructuralSimilarity(nodeId, nodeLabels, dimensions) {
  const nodeLabel = nodeLabels[0] ?? "Client";
  const relClauses = dimensions.filter((d) => DIMENSION_RELS[d]).map((d) => {
    const { rel, target_label } = DIMENSION_RELS[d];
    return `
OPTIONAL MATCH (source)-[:${rel}]->(t1:${target_label})
WITH source, other, collect(DISTINCT t1.name) AS source_${d}
OPTIONAL MATCH (other)-[:${rel}]->(t2:${target_label})
WITH source, other, source_${d}, collect(DISTINCT t2.name) AS other_${d},
     [x IN source_${d} WHERE x IN collect(DISTINCT t2.name)] AS shared_${d}`;
  });
  const jaccardExprs = dimensions.filter((d) => DIMENSION_RELS[d]).map((d) => `CASE WHEN size(source_${d}) + size(other_${d}) - size(shared_${d}) = 0 THEN 0.0
       ELSE toFloat(size(shared_${d})) / (size(source_${d}) + size(other_${d}) - size(shared_${d}))
       END`);
  try {
    const cypher = `
MATCH (source {id: $sourceId})
MATCH (source)-[r1]->(shared)<-[r2]-(other)
WHERE other <> source
  AND labels(other)[0] IN ['Client', 'Engagement', 'UseCase', 'Tender', 'ConsultingService']
  AND type(r1) IN $relTypes
WITH other,
     count(DISTINCT shared) AS shared_count,
     collect(DISTINCT {dim: type(r1), value: coalesce(shared.name, shared.title, '')}) AS shared_details
ORDER BY shared_count DESC
LIMIT 20
RETURN other.id AS client_id,
       coalesce(other.name, other.title) AS client_name,
       labels(other)[0] AS node_type,
       shared_count,
       shared_details`;
    const relTypes = dimensions.filter((d) => DIMENSION_RELS[d]).map((d) => DIMENSION_RELS[d].rel);
    const result = await callMcpTool({
      toolName: "graph.read_cypher",
      args: { query: cypher, params: { sourceId: nodeId, relTypes } },
      callId: uuid9(),
      timeoutMs: 15e3
    });
    if (result.status !== "success") return [];
    const rows = result.result?.results ?? result.result;
    if (!Array.isArray(rows)) return [];
    const maxShared = Math.max(1, ...rows.map((r) => {
      const sc = r.shared_count;
      return typeof sc === "object" && sc?.low !== void 0 ? sc.low : Number(sc) || 0;
    }));
    return rows.map((r) => {
      const sharedCount = typeof r.shared_count === "object" && r.shared_count?.low !== void 0 ? r.shared_count.low : Number(r.shared_count) || 0;
      const score = sharedCount / maxShared;
      const details = Array.isArray(r.shared_details) ? r.shared_details : [];
      const dimGroups = /* @__PURE__ */ new Map();
      for (const d of details) {
        const dim = String(d.dim ?? "");
        const val = String(d.value ?? "");
        if (!dimGroups.has(dim)) dimGroups.set(dim, []);
        dimGroups.get(dim).push(val);
      }
      const sharedDimensions = Array.from(dimGroups.entries()).map(([dim, vals]) => ({
        dimension: dim,
        shared_values: vals.slice(0, 5),
        jaccard: vals.length / Math.max(1, sharedCount)
      }));
      return {
        client_id: String(r.client_id ?? ""),
        client_name: String(r.client_name ?? "Unknown"),
        overall_score: score,
        structural_score: score,
        semantic_score: 0,
        shared_dimensions: sharedDimensions,
        node_type: String(r.node_type ?? "Client")
      };
    });
  } catch (err) {
    logger.warn({ error: String(err) }, "Similarity: structural computation failed");
    return [];
  }
}
async function computeSemanticSimilarity(query, maxResults) {
  try {
    const result = await callMcpTool({
      toolName: "srag.query",
      args: { query },
      callId: uuid9(),
      timeoutMs: 2e4
    });
    if (result.status !== "success") return [];
    const data = result.result;
    const items = Array.isArray(data) ? data : data?.results ? data.results : data?.chunks ? data.chunks : [];
    return items.filter((item) => {
      const title = String(item.title ?? item.name ?? "").toLowerCase();
      const type = String(item.type ?? item.label ?? "").toLowerCase();
      return type.includes("client") || type.includes("engagement") || type.includes("usecase") || type.includes("tender") || type.includes("consulting") || title.length > 0;
    }).slice(0, maxResults).map((item) => ({
      client_id: String(item.id ?? item.$id ?? ""),
      client_name: String(item.title ?? item.name ?? "Unknown"),
      overall_score: item.score ?? item.similarity ?? 0.5,
      structural_score: 0,
      semantic_score: item.score ?? item.similarity ?? 0.5,
      shared_dimensions: [],
      node_type: String(item.type ?? item.label ?? "Document")
    }));
  } catch (err) {
    logger.warn({ error: String(err) }, "Similarity: semantic computation failed");
    return [];
  }
}
function mergeScores(structural, semantic, alpha, maxResults) {
  const merged = /* @__PURE__ */ new Map();
  for (const s of structural) {
    merged.set(s.client_id || s.client_name, {
      ...s,
      overall_score: alpha * s.structural_score
    });
  }
  for (const s of semantic) {
    const key = s.client_id || s.client_name;
    const existing = merged.get(key);
    if (existing) {
      existing.semantic_score = s.semantic_score;
      existing.overall_score = alpha * existing.structural_score + (1 - alpha) * s.semantic_score;
    } else {
      merged.set(key, {
        ...s,
        overall_score: (1 - alpha) * s.semantic_score
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.overall_score - a.overall_score).slice(0, maxResults);
}
async function getClientDetails(clientId) {
  try {
    const result = await callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: `MATCH (n {id: $id})
OPTIONAL MATCH (n)-[r]->(related)
RETURN n AS client,
       labels(n) AS labels,
       collect(DISTINCT {rel: type(r), target: coalesce(related.name, related.title), target_type: labels(related)[0]}) AS relationships`,
        params: { id: clientId }
      },
      callId: uuid9(),
      timeoutMs: 1e4
    });
    if (result.status === "success") {
      const rows = result.result?.results ?? result.result;
      if (Array.isArray(rows) && rows.length > 0) {
        return rows[0];
      }
    }
  } catch {
  }
  return null;
}
var DIMENSION_RELS, DEFAULT_DIMENSIONS;
var init_similarity_engine = __esm({
  "src/similarity-engine.ts"() {
    "use strict";
    init_mcp_caller();
    init_logger();
    DIMENSION_RELS = {
      industry: { rel: "IN_INDUSTRY", target_label: "Industry" },
      service: { rel: "USED_SERVICE", target_label: "ConsultingService" },
      challenge: { rel: "FACED_CHALLENGE", target_label: "Challenge" },
      domain: { rel: "IN_DOMAIN", target_label: "Domain" },
      size: { rel: "HAS_SIZE", target_label: "SizeSegment" },
      geography: { rel: "IN_GEOGRAPHY", target_label: "Geography" },
      deliverable: { rel: "RECEIVED", target_label: "Deliverable" }
    };
    DEFAULT_DIMENSIONS = ["industry", "service", "challenge", "domain"];
  }
});

// src/deliverable-engine.ts
var deliverable_engine_exports = {};
__export(deliverable_engine_exports, {
  generateDeliverable: () => generateDeliverable,
  getDeliverable: () => getDeliverable,
  listDeliverables: () => listDeliverables
});
import { v4 as uuid10 } from "uuid";
async function persist(d) {
  deliverableCache.set(d.$id, d);
  if (deliverableCache.size > CACHE_MAX_SIZE) {
    const toEvict = deliverableCache.size - CACHE_MAX_SIZE;
    const oldest = Array.from(deliverableCache.entries()).sort((a, b) => a[1].created_at.localeCompare(b[1].created_at));
    oldest.slice(0, toEvict).forEach(([key]) => deliverableCache.delete(key));
  }
  const redis2 = getRedis();
  if (!redis2) return;
  try {
    await redis2.set(`${REDIS_PREFIX2}${d.$id}`, JSON.stringify(d), "EX", TTL_SECONDS2);
    await redis2.sadd(REDIS_INDEX, d.$id);
  } catch {
  }
}
async function getDeliverable(id) {
  if (deliverableCache.has(id)) return deliverableCache.get(id);
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const raw = await redis2.get(`${REDIS_PREFIX2}${id}`);
    if (raw) {
      const d = JSON.parse(raw);
      deliverableCache.set(id, d);
      return d;
    }
  } catch {
  }
  return null;
}
async function listDeliverables(limit = 20) {
  const redis2 = getRedis();
  if (!redis2) return Array.from(deliverableCache.values()).slice(0, limit);
  try {
    const ids = await redis2.smembers(REDIS_INDEX);
    const results = [];
    for (const id of ids.slice(0, limit)) {
      const d = await getDeliverable(id);
      if (d) results.push(d);
    }
    return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch {
    return Array.from(deliverableCache.values()).slice(0, limit);
  }
}
async function generateDeliverable(req) {
  if (activeGenerations >= MAX_CONCURRENT) {
    throw new Error(`Too many concurrent generations (${activeGenerations}/${MAX_CONCURRENT}). Try again later.`);
  }
  activeGenerations++;
  const t0 = Date.now();
  const deliverableId = `widgetdc:deliverable:${uuid10()}`;
  const format = req.format ?? "markdown";
  const maxSections = Math.min(Math.max(req.max_sections ?? 5, 2), 8);
  const deliverable = {
    $id: deliverableId,
    $schema: "widgetdc:deliverable:v1",
    prompt: req.prompt,
    type: req.type,
    format,
    title: "",
    sections: [],
    metadata: {
      total_citations: 0,
      avg_confidence: 0,
      generation_ms: 0,
      sections_count: 0,
      token_estimate: 0,
      graphrag_results: 0
    },
    markdown: "",
    status: "generating",
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await persist(deliverable);
  try {
    logger.info({ id: deliverableId, type: req.type, prompt: req.prompt.slice(0, 80) }, "Deliverable: Step 1 \u2014 Planning");
    const plan = await planSections(req.prompt, req.type, maxSections);
    deliverable.title = plan.title;
    logger.info({ id: deliverableId, sections: plan.sections.length }, "Deliverable: Step 2 \u2014 Retrieving");
    const evidence = await retrieveEvidence(plan.sections);
    logger.info({ id: deliverableId }, "Deliverable: Step 3 \u2014 Writing sections");
    const sections = await writeSections(plan.sections, evidence, req.type);
    deliverable.sections = sections;
    logger.info({ id: deliverableId }, "Deliverable: Step 4 \u2014 Assembling");
    deliverable.markdown = assembleSections(deliverable.title, sections, req.type);
    if (format === "pdf") {
      logger.info({ id: deliverableId }, "Deliverable: Step 5 \u2014 Rendering PDF");
      await renderPDF(deliverable);
    }
    const totalCitations = sections.reduce((n, s) => n + s.citations.length, 0);
    if (totalCitations < 3) {
      try {
        const broadRag = await dualChannelRAG(req.prompt, { maxResults: 5 });
        if (broadRag.results.length > 0) {
          const extraCitations = broadRag.results.slice(0, 3 - totalCitations).map((r) => ({
            source: r.source,
            title: r.content.slice(0, 80),
            relevance: r.score
          }));
          const targetSection = sections.reduce((min, s) => s.citations.length < min.citations.length ? s : min);
          targetSection.citations.push(...extraCitations);
        }
      } catch {
      }
    }
    const allCitations = sections.flatMap((s) => s.citations);
    const confidenceMap = { high: 1, medium: 0.66, low: 0.33 };
    const avgConf = sections.length > 0 ? sections.reduce((sum, s) => sum + confidenceMap[s.confidence], 0) / sections.length : 0;
    deliverable.metadata = {
      total_citations: allCitations.length,
      avg_confidence: Math.round(avgConf * 100) / 100,
      generation_ms: Date.now() - t0,
      sections_count: sections.length,
      token_estimate: Math.ceil(deliverable.markdown.length / 4),
      graphrag_results: evidence.reduce((sum, e) => sum + e.results.length, 0)
    };
    deliverable.status = "completed";
    deliverable.completed_at = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const { hookDeliverableToKnowledge: hookDeliverableToKnowledge2 } = await Promise.resolve().then(() => (init_compound_hooks(), compound_hooks_exports));
      const allCits = sections.flatMap((s) => s.citations);
      hookDeliverableToKnowledge2(deliverableId, deliverable.title, allCits).catch(() => {
      });
    } catch {
    }
    logger.info({
      id: deliverableId,
      sections: sections.length,
      citations: allCitations.length,
      ms: deliverable.metadata.generation_ms
    }, "Deliverable: Complete");
  } catch (err) {
    deliverable.status = "failed";
    deliverable.error = err instanceof Error ? err.message : String(err);
    deliverable.completed_at = (/* @__PURE__ */ new Date()).toISOString();
    deliverable.metadata.generation_ms = Date.now() - t0;
    logger.error({ id: deliverableId, error: deliverable.error }, "Deliverable: Failed");
  } finally {
    activeGenerations--;
    await persist(deliverable);
  }
  return deliverable;
}
async function planSections(prompt, type, maxSections) {
  const systemPrompt = `You are a consulting deliverable planner. Given a client prompt, generate a structured outline for a ${type} report.

${TYPE_PROMPTS[type]}

Generate exactly ${maxSections} sections. Each section needs a title, a knowledge-graph search query to find relevant data, and a purpose statement.

Reply as JSON:
{"title": "Report Title", "sections": [{"title": "Section Title", "query": "search query for knowledge graph", "purpose": "what this section should cover"}]}`;
  try {
    const result = await callCognitive("analyze", {
      prompt: `${systemPrompt}

Client prompt: "${prompt}"`,
      context: { type, maxSections },
      agent_id: "deliverable-planner"
    }, 3e4);
    const text = String(result ?? "");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        title: parsed.title ?? `${type.charAt(0).toUpperCase() + type.slice(1)}: ${prompt.slice(0, 60)}`,
        sections: (parsed.sections ?? []).slice(0, maxSections)
      };
    }
  } catch (err) {
    logger.warn({ error: String(err) }, "Deliverable planner failed, using fallback");
  }
  const fallbackSections = [
    { title: "Executive Summary", query: prompt, purpose: "High-level overview" },
    { title: "Analysis", query: prompt, purpose: "Detailed analysis of the topic" },
    { title: "Findings", query: `key findings ${prompt}`, purpose: "Key findings and insights" },
    { title: "Recommendations", query: `recommendations ${prompt}`, purpose: "Actionable recommendations" }
  ];
  return {
    title: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${prompt.slice(0, 60)}`,
    sections: fallbackSections.slice(0, maxSections)
  };
}
async function retrieveEvidence(sections) {
  const bundles = await Promise.allSettled(
    sections.map(async (section) => {
      const rag = await dualChannelRAG(section.query, { maxResults: 5 });
      return {
        section_title: section.title,
        results: rag.results.map((r) => ({
          source: r.source,
          content: r.content,
          score: r.score
        }))
      };
    })
  );
  return bundles.map((b, i) => {
    if (b.status === "fulfilled") return b.value;
    return { section_title: sections[i].title, results: [] };
  });
}
async function writeSections(plans, evidence, type) {
  const results = await Promise.allSettled(
    plans.map((plan, i) => writeOneSection(plan, evidence[i], type))
  );
  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    return {
      title: plans[i].title,
      markdown: `[Section generation failed: ${r.reason}]`,
      citations: [],
      confidence: "low"
    };
  });
}
async function writeOneSection(plan, ev, type) {
  const hasEvidence = ev && ev.results.length > 0;
  const evidenceText = hasEvidence ? ev.results.map((r, j) => `[Source ${j + 1} (${r.source}, score: ${r.score.toFixed(2)})] ${r.content}`).join("\n\n") : "[No evidence found \u2014 mark claims as unverified]";
  const sectionPrompt = `Write the "${plan.title}" section of a consulting ${type} report.

PURPOSE: ${plan.purpose}

EVIDENCE FROM KNOWLEDGE GRAPH:
${evidenceText}

RULES:
- Write 2-4 paragraphs of professional consulting prose
- Reference evidence with [Source N] inline citations
- If evidence is insufficient, note "[insufficient data]" for unverified claims
- Use bullet points for key findings and recommendations
- Be specific and actionable, not generic
- Danish regulatory context is relevant when applicable

Output ONLY the section content in markdown (no title header \u2014 it will be added).`;
  try {
    const result = await callCognitive("analyze", {
      prompt: sectionPrompt,
      context: { section: plan.title, type, evidence_count: ev?.results.length ?? 0 },
      agent_id: "deliverable-writer"
    }, 3e4);
    const content = String(result ?? "").trim();
    const citations = hasEvidence ? ev.results.map((r) => ({
      source: r.source,
      title: r.content.slice(0, 80),
      relevance: r.score
    })) : [];
    const avgScore = hasEvidence ? ev.results.reduce((s, r) => s + r.score, 0) / ev.results.length : 0;
    const confidence = avgScore >= 0.7 ? "high" : avgScore >= 0.4 ? "medium" : "low";
    return {
      title: plan.title,
      markdown: content || `[Section generation failed \u2014 insufficient data for "${plan.title}"]`,
      citations,
      confidence
    };
  } catch (err) {
    return {
      title: plan.title,
      markdown: `[Section generation failed: ${err instanceof Error ? err.message : String(err)}]`,
      citations: [],
      confidence: "low"
    };
  }
}
function assembleSections(title, sections, type) {
  const confidenceEmoji = { high: "\u25CF", medium: "\u25D0", low: "\u25CB" };
  const now = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  let md = `# ${title}

`;
  md += `**Type:** ${type} | **Date:** ${now} | **Generated by:** WidgeTDC Deliverable Engine v1.0

`;
  md += `---

`;
  for (const section of sections) {
    md += `## ${section.title}

`;
    md += `${section.markdown}

`;
    if (section.citations.length > 0) {
      md += `> **Sources** ${confidenceEmoji[section.confidence]} (confidence: ${section.confidence}): `;
      md += section.citations.map((c, i) => `[${i + 1}] ${c.title}`).join(" | ");
      md += `

`;
    }
  }
  md += `---

`;
  md += `*This deliverable was automatically generated by WidgeTDC from ${sections.reduce((n, s) => n + s.citations.length, 0)} knowledge graph sources. `;
  md += `Claims marked [insufficient data] require manual verification.*
`;
  return md;
}
async function renderPDF(deliverable) {
  try {
    const result = await callMcpTool({
      toolName: "docgen.word.create",
      args: {
        title: deliverable.title,
        content: deliverable.markdown,
        template: deliverable.type
      },
      callId: uuid10(),
      timeoutMs: 45e3
    });
    if (result.status === "success" && result.result) {
      deliverable.doc_url = result.result?.url ?? result.result?.path;
      logger.info({ id: deliverable.$id }, "Deliverable: DOCX rendered via docgen.word.create");
    }
  } catch {
    logger.info("docgen.word.create not available \u2014 delivering markdown");
    deliverable.format = "markdown";
  }
}
var REDIS_PREFIX2, REDIS_INDEX, TTL_SECONDS2, deliverableCache, CACHE_MAX_SIZE, activeGenerations, MAX_CONCURRENT, TYPE_PROMPTS;
var init_deliverable_engine = __esm({
  "src/deliverable-engine.ts"() {
    "use strict";
    init_mcp_caller();
    init_cognitive_proxy();
    init_dual_rag();
    init_redis();
    init_logger();
    REDIS_PREFIX2 = "orchestrator:deliverable:";
    REDIS_INDEX = "orchestrator:deliverables:index";
    TTL_SECONDS2 = 604800;
    deliverableCache = /* @__PURE__ */ new Map();
    CACHE_MAX_SIZE = 100;
    activeGenerations = 0;
    MAX_CONCURRENT = 3;
    TYPE_PROMPTS = {
      analysis: "Structure as: Executive Summary, Current State Analysis, Key Findings, Gap Analysis, Strategic Implications, Recommendations.",
      roadmap: "Structure as: Executive Summary, Vision & Objectives, Phase 1 (Quick Wins), Phase 2 (Foundation), Phase 3 (Scale), Implementation Timeline, Risk Mitigation.",
      assessment: "Structure as: Executive Summary, Assessment Scope, Maturity Analysis, Compliance Status, Gap Identification, Remediation Plan, Next Steps."
    };
  }
});

// src/manifesto-governance.ts
var manifesto_governance_exports = {};
__export(manifesto_governance_exports, {
  MANIFESTO_PRINCIPLES: () => MANIFESTO_PRINCIPLES,
  generateGraphCypher: () => generateGraphCypher,
  getEnforcementMatrix: () => getEnforcementMatrix,
  getEnforcementScore: () => getEnforcementScore,
  getGaps: () => getGaps,
  getPrincipleByNumber: () => getPrincipleByNumber
});
function getEnforcementMatrix() {
  return MANIFESTO_PRINCIPLES;
}
function getPrincipleByNumber(n) {
  return MANIFESTO_PRINCIPLES.find((p) => p.number === n);
}
function getGaps() {
  return MANIFESTO_PRINCIPLES.filter((p) => p.status !== "ENFORCED");
}
function getEnforcementScore() {
  const enforced = MANIFESTO_PRINCIPLES.filter((p) => p.status === "ENFORCED").length;
  const partial = MANIFESTO_PRINCIPLES.filter((p) => p.status === "PARTIAL").length;
  const gap = MANIFESTO_PRINCIPLES.filter((p) => p.status === "GAP").length;
  const score = `${enforced}/10 ENFORCED, ${partial} PARTIAL, ${gap} GAP`;
  return { enforced, partial, gap, score };
}
function generateGraphCypher() {
  return MANIFESTO_PRINCIPLES.map((p) => ({
    query: `MERGE (p:ManifestoPrinciple {number: $number})
SET p.name = $name,
    p.description = $description,
    p.status = $status,
    p.enforcement_layer = $enforcement_layer,
    p.mechanism = $mechanism,
    p.mechanism_detail = $mechanism_detail,
    p.gap_remediation = $gap_remediation,
    p.updatedAt = datetime()
RETURN p`,
    params: {
      number: p.number,
      name: p.name,
      description: p.description,
      status: p.status,
      enforcement_layer: p.enforcement_layer,
      mechanism: p.mechanism,
      mechanism_detail: p.mechanism_detail,
      gap_remediation: p.gap_remediation ?? ""
    }
  }));
}
var MANIFESTO_PRINCIPLES;
var init_manifesto_governance = __esm({
  "src/manifesto-governance.ts"() {
    "use strict";
    MANIFESTO_PRINCIPLES = [
      {
        number: 1,
        name: "Invisible Omnipotence",
        description: "Intelligence runs invisibly on every message. Users never see the machinery \u2014 they only experience the result.",
        status: "ENFORCED",
        enforcement_layer: "pipeline",
        mechanism: "mercury_enforcement.py",
        mechanism_detail: "Mercury enforcement pipeline runs on EVERY Open WebUI message. 5-section router: classify -> RAG -> fold -> inject -> certify. Zero user interaction required.",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 2,
        name: "Aesthetic Authority",
        description: "All output meets consulting-grade formatting standards. Danish language, structured sections, proper citations.",
        status: "ENFORCED",
        enforcement_layer: "pipeline",
        mechanism: "widgetdc_beautifier pipeline",
        mechanism_detail: "Beautifier pipeline post-processes all LLM output: Danish language enforcement, structured headings, citation formatting, consulting-grade markdown. Runs as Open WebUI pipeline.",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 3,
        name: "Cognitive Supremacy",
        description: "Deep reasoning via RLM Engine for complex questions. Multi-step analysis, PDR, swarms, and context folding.",
        status: "ENFORCED",
        enforcement_layer: "tool",
        mechanism: "cognitive-proxy.ts + RLM Engine",
        mechanism_detail: "RLM Engine (Python/FastAPI) provides reason/analyze/plan/learn/fold/enrich endpoints. Orchestrator proxies via cognitive-proxy.ts. Tool registry exposes reason_deeply + investigate tools. Mercury pipeline auto-routes complex queries to RLM.",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 4,
        name: "Mercury Efficiency",
        description: "Context compression and intelligent folding to maximize signal-to-noise in every interaction.",
        status: "ENFORCED",
        enforcement_layer: "pipeline",
        mechanism: "mercury_fold pipeline + foldToolResult()",
        mechanism_detail: "Mercury fold pipeline compresses context in Open WebUI. Orchestrator foldToolResult() in tool-executor.ts compresses tool results >1500 chars. RLM /cognitive/fold endpoint for deep folding. Triple-layer enforcement.",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 5,
        name: "Immutable Truths",
        description: "All claims are verified against the knowledge graph. No hallucination passes unchecked.",
        status: "ENFORCED",
        enforcement_layer: "pipeline",
        mechanism: "Mercury certify step + verification-gate.ts",
        mechanism_detail: "Mercury pipeline certify step validates claims against Neo4j graph on every message. Orchestrator verification-gate.ts provides post-chain verification with tripwire guardrails and auto-fix loops (max 3 retries).",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 6,
        name: "Anticipatory Intelligence",
        description: "Pre-fetch relevant context before the user needs it. Proactive queue management.",
        status: "ENFORCED",
        enforcement_layer: "pipeline",
        mechanism: "widgetdc_anticipator pipeline + proactive.queue",
        mechanism_detail: "Anticipator pipeline pre-fetches related knowledge on message classification. proactive.queue MCP tool (LIN-575, backend v2.0.2) queues anticipated follow-up data. intent.resolve maps user intent to pre-load relevant graph subsets.",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 7,
        name: "Monopoly of Truth",
        description: "Neo4j knowledge graph is the single source of truth. All data flows through the graph.",
        status: "ENFORCED",
        enforcement_layer: "tool",
        mechanism: "graph_intel tool + dual-rag.ts + knowledge.query",
        mechanism_detail: "widgetdc_graph_intel tool exposes Neo4j as single source. dual-rag.ts routes ALL retrieval through graph-first (graphrag -> srag -> cypher). 475K+ nodes, 3.8M+ relationships. MERGE-only writes, parameterized Cypher, read-back verify.",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 8,
        name: "Sovereign Market",
        description: "Competitive intelligence through systematic capability mapping and gap analysis against market players.",
        status: "PARTIAL",
        enforcement_layer: "cron",
        mechanism: "competitive-crawler.ts + failure-harvester.ts",
        mechanism_detail: "competitive-crawler.ts crawls 5 competitors weekly (Mon 03:00 cron). failure-harvester.ts harvests failure patterns every 4h. 33+ capabilities mapped from Palantir + Copilot Studio. Gap reports generated. PARTIAL: no automated remediation loop from gaps to roadmap.",
        gap_remediation: "Add automated gap-to-Linear-issue pipeline: when competitive crawler finds a capability gap scored >0.7, auto-create a Linear issue in backlog. Wire via existing cron infrastructure.",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 9,
        name: "Ubiquity",
        description: "Platform intelligence accessible from every surface: Open WebUI, Obsidian, CLI, API, Slack.",
        status: "ENFORCED",
        enforcement_layer: "tool",
        mechanism: "widgetdc_obsidian_bridge + Triple-Protocol ABI + Slack webhook",
        mechanism_detail: "Obsidian bridge tool syncs knowledge to local vault. Triple-Protocol ABI (OpenAI + OpenAPI + MCP) exposes all tools to any client. Slack webhook integration (slack.ts). Command Center SPA. WebSocket + SSE real-time. /v1 OpenAI-compat API for any LLM client.",
        updatedAt: "2026-04-03T00:00:00Z"
      },
      {
        number: 10,
        name: "Obsidian Protocol",
        description: "Governance-as-code: all rules enforced by config, contracts, code, or runtime checks. Documentation alone is not enforcement.",
        status: "ENFORCED",
        enforcement_layer: "governance-doc",
        mechanism: "GLOBAL_AGENT_GOVERNANCE.md + runtime enforcement chain",
        mechanism_detail: 'GLOBAL_AGENT_GOVERNANCE.md defines the cross-repo baseline. Runtime enforcement: TypeBox validators (validation.ts), auth middleware (auth.ts), audit trail (audit.ts, 30-day TTL), ACL on tool calls, rate limiting, parameterized queries. Cron compliance scan every 6h (intel-compliance-scan). Final Rule: "If it is not enforced and verified, it is not done."',
        updatedAt: "2026-04-03T00:00:00Z"
      }
    ];
  }
});

// src/osint-scanner.ts
var osint_scanner_exports = {};
__export(osint_scanner_exports, {
  DK_PUBLIC_DOMAINS: () => DK_PUBLIC_DOMAINS,
  getOsintStatus: () => getOsintStatus,
  runOsintScan: () => runOsintScan
});
import { v4 as uuid11 } from "uuid";
async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function processBatched(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn));
    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      }
    }
    if (i + batchSize < items.length) {
      await delay(BATCH_DELAY_MS);
    }
  }
  return results;
}
async function checkToolAvailability() {
  try {
    const result = await callMcpTool({
      toolName: "the_snout.domain_intel",
      args: { domain: "borger.dk", type: "basic" },
      callId: uuid11(),
      timeoutMs: 1e4
    });
    return result.status === "success";
  } catch {
    return false;
  }
}
async function scanCTForDomain(domain, toolsAvailable) {
  if (!toolsAvailable) {
    return buildCTFallback(domain);
  }
  for (let attempt = 0; attempt <= MAX_RETRIES2; attempt++) {
    try {
      const result = await callMcpTool({
        toolName: "the_snout.ct_transparency",
        args: { domain },
        callId: uuid11(),
        timeoutMs: DOMAIN_TIMEOUT_MS
      });
      if (result.status === "success" && result.result) {
        const data = result.result;
        return {
          domain,
          subdomains: Array.isArray(data.subdomains) ? data.subdomains : [],
          cert_count: typeof data.cert_count === "number" ? data.cert_count : 0,
          source: "live"
        };
      }
      const fallbackResult = await callMcpTool({
        toolName: "the_snout.domain_intel",
        args: { domain, type: "ct" },
        callId: uuid11(),
        timeoutMs: DOMAIN_TIMEOUT_MS
      });
      if (fallbackResult.status === "success" && fallbackResult.result) {
        const data = fallbackResult.result;
        return {
          domain,
          subdomains: Array.isArray(data.subdomains) ? data.subdomains : [],
          cert_count: typeof data.cert_count === "number" ? data.cert_count : 0,
          source: "live"
        };
      }
      return buildCTFallback(domain);
    } catch (err) {
      if (attempt === MAX_RETRIES2) {
        logger.warn({ domain, err: String(err) }, "CT scan failed after retries, using fallback");
        return buildCTFallback(domain);
      }
      await delay(500 * (attempt + 1));
    }
  }
  return buildCTFallback(domain);
}
function buildCTFallback(domain) {
  const commonPrefixes = ["www", "mail", "webmail", "remote", "vpn", "portal", "api", "intranet"];
  return {
    domain,
    subdomains: commonPrefixes.map((p) => `${p}.${domain}`),
    cert_count: 0,
    source: "fallback"
  };
}
async function runCTStage(domains, toolsAvailable) {
  logger.info({ count: domains.length, toolsAvailable }, "OSINT Stage 1: CT Transparency Scan");
  return processBatched(domains, MAX_CONCURRENT2, (d) => scanCTForDomain(d, toolsAvailable));
}
async function scanDMARCForDomain(domain, toolsAvailable) {
  if (!toolsAvailable) {
    return buildDMARCFallback(domain);
  }
  for (let attempt = 0; attempt <= MAX_RETRIES2; attempt++) {
    try {
      const result = await callMcpTool({
        toolName: "the_snout.domain_intel",
        args: { domain, type: "dmarc" },
        callId: uuid11(),
        timeoutMs: DOMAIN_TIMEOUT_MS
      });
      if (result.status === "success" && result.result) {
        const data = result.result;
        return {
          domain,
          spf: typeof data.spf === "string" ? data.spf : "unknown",
          dmarc: typeof data.dmarc === "string" ? data.dmarc : "unknown",
          dkim: typeof data.dkim === "boolean" ? data.dkim : false,
          policy: typeof data.policy === "string" ? data.policy : "unknown",
          source: "live"
        };
      }
      return buildDMARCFallback(domain);
    } catch (err) {
      if (attempt === MAX_RETRIES2) {
        logger.warn({ domain, err: String(err) }, "DMARC scan failed after retries, using fallback");
        return buildDMARCFallback(domain);
      }
      await delay(500 * (attempt + 1));
    }
  }
  return buildDMARCFallback(domain);
}
function buildDMARCFallback(domain) {
  return {
    domain,
    spf: "scan_pending",
    dmarc: "scan_pending",
    dkim: false,
    policy: "scan_pending",
    source: "fallback"
  };
}
async function runDMARCStage(domains, toolsAvailable) {
  logger.info({ count: domains.length, toolsAvailable }, "OSINT Stage 2: DMARC/SPF Scan");
  return processBatched(domains, MAX_CONCURRENT2, (d) => scanDMARCForDomain(d, toolsAvailable));
}
function domainToOrgName(domain) {
  const base = domain.replace(/\.dk$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}
async function ingestCTResults(ctResults) {
  const errors = [];
  let nodesCreated = 0;
  const source = `osint-scanner-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
  const liveResults = ctResults.filter((ct) => ct.source !== "fallback");
  if (liveResults.length < ctResults.length) {
    logger.info({ skipped: ctResults.length - liveResults.length }, "Skipping fallback CT results (not ingesting fabricated data)");
  }
  for (let i = 0; i < liveResults.length; i += MERGE_BATCH_SIZE) {
    const batch = liveResults.slice(i, i + MERGE_BATCH_SIZE);
    for (const ct of batch) {
      try {
        const orgName = domainToOrgName(ct.domain);
        const cypher = `
          MERGE (o:Organization {domain: $domain})
          ON CREATE SET o.name = $orgName, o.created_at = datetime(), o.source = $source
          ON MATCH SET o.last_seen = datetime()
          WITH o
          MERGE (ct:CTLogEntry {domain: $domain, source: $source})
          ON CREATE SET ct.subdomains = $subdomains, ct.cert_count = $certCount,
                        ct.scan_source = $scanSource, ct.created_at = datetime()
          ON MATCH SET ct.subdomains = $subdomains, ct.cert_count = $certCount,
                       ct.updated_at = datetime()
          MERGE (ct)-[:DISCOVERED_FOR]->(o)
          RETURN count(*) AS created
        `;
        const result = await callMcpTool({
          toolName: "graph.write_cypher",
          args: {
            query: cypher,
            params: {
              domain: ct.domain,
              orgName,
              source,
              subdomains: ct.subdomains,
              certCount: ct.cert_count,
              scanSource: ct.source
            },
            _force: true
          },
          callId: uuid11(),
          timeoutMs: 15e3
        });
        if (result.status === "success") {
          nodesCreated += 2;
        } else {
          errors.push(`CT ingest failed for ${ct.domain}: ${result.error_message}`);
        }
      } catch (err) {
        errors.push(`CT ingest error for ${ct.domain}: ${err}`);
      }
    }
    if (i + MERGE_BATCH_SIZE < ctResults.length) {
      await delay(500);
    }
  }
  logger.info({ nodesCreated, errors: errors.length }, "CT results ingested");
  return { nodes_created: nodesCreated, errors };
}
async function ingestDMARCResults(dmarcResults) {
  const errors = [];
  let nodesCreated = 0;
  const source = `osint-scanner-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
  const liveResults = dmarcResults.filter((d) => d.source !== "fallback");
  if (liveResults.length < dmarcResults.length) {
    logger.info({ skipped: dmarcResults.length - liveResults.length }, "Skipping fallback DMARC results (not ingesting placeholder data)");
  }
  for (let i = 0; i < liveResults.length; i += MERGE_BATCH_SIZE) {
    const batch = liveResults.slice(i, i + MERGE_BATCH_SIZE);
    for (const dmarc of batch) {
      try {
        const orgName = domainToOrgName(dmarc.domain);
        const cypher = `
          MERGE (o:Organization {domain: $domain})
          ON CREATE SET o.name = $orgName, o.created_at = datetime(), o.source = $source
          ON MATCH SET o.last_seen = datetime()
          WITH o
          MERGE (d:DMARCResult {domain: $domain, source: $source})
          ON CREATE SET d.spf = $spf, d.dmarc = $dmarc, d.dkim = $dkim,
                        d.policy = $policy, d.scan_source = $scanSource,
                        d.created_at = datetime()
          ON MATCH SET d.spf = $spf, d.dmarc = $dmarc, d.dkim = $dkim,
                       d.policy = $policy, d.scan_source = $scanSource,
                       d.updated_at = datetime()
          MERGE (d)-[:EMAIL_SECURITY_FOR]->(o)
          RETURN count(*) AS created
        `;
        const result = await callMcpTool({
          toolName: "graph.write_cypher",
          args: {
            query: cypher,
            params: {
              domain: dmarc.domain,
              orgName,
              source,
              spf: dmarc.spf,
              dmarc: dmarc.dmarc,
              dkim: dmarc.dkim,
              policy: dmarc.policy,
              scanSource: dmarc.source
            },
            _force: true
          },
          callId: uuid11(),
          timeoutMs: 15e3
        });
        if (result.status === "success") {
          nodesCreated += 2;
        } else {
          errors.push(`DMARC ingest failed for ${dmarc.domain}: ${result.error_message}`);
        }
      } catch (err) {
        errors.push(`DMARC ingest error for ${dmarc.domain}: ${err}`);
      }
    }
    if (i + MERGE_BATCH_SIZE < dmarcResults.length) {
      await delay(500);
    }
  }
  logger.info({ nodesCreated, errors: errors.length }, "DMARC results ingested");
  return { nodes_created: nodesCreated, errors };
}
async function persistScanResult(result) {
  const redis2 = getRedis();
  if (!redis2) return;
  const key = `orchestrator:osint:scan:${result.scan_id}`;
  const latestKey = "orchestrator:osint:latest";
  const TTL_30_DAYS = 30 * 24 * 60 * 60;
  try {
    const json = JSON.stringify(result);
    await redis2.set(key, json, "EX", TTL_30_DAYS);
    await redis2.set(latestKey, json, "EX", TTL_30_DAYS);
    logger.info({ scan_id: result.scan_id }, "OSINT scan persisted to Redis");
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to persist OSINT scan to Redis");
  }
}
async function runOsintScan(options) {
  const scanId = uuid11();
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const t0 = Date.now();
  const domains = options?.domains ?? [...DK_PUBLIC_DOMAINS];
  const scanType = options?.scan_type ?? "full";
  const errors = [];
  logger.info({ scan_id: scanId, domains: domains.length, scan_type: scanType }, "OSINT scan started");
  const toolsAvailable = await checkToolAvailability();
  if (!toolsAvailable) {
    logger.warn("the_snout tools not available \u2014 using fallback strategy");
    errors.push("Backend OSINT tools unavailable \u2014 using fallback data (scan_pending)");
  }
  let ctResults = [];
  if (scanType === "full" || scanType === "ct_only") {
    ctResults = await runCTStage(domains, toolsAvailable);
  }
  let dmarcResultsList = [];
  if (scanType === "full" || scanType === "dmarc_only") {
    dmarcResultsList = await runDMARCStage(domains, toolsAvailable);
  }
  let totalNewNodes = 0;
  if (ctResults.length > 0) {
    const ctIngest = await ingestCTResults(ctResults);
    totalNewNodes += ctIngest.nodes_created;
    errors.push(...ctIngest.errors);
  }
  if (dmarcResultsList.length > 0) {
    const dmarcIngest = await ingestDMARCResults(dmarcResultsList);
    totalNewNodes += dmarcIngest.nodes_created;
    errors.push(...dmarcIngest.errors);
  }
  const result = {
    scan_id: scanId,
    started_at: startedAt,
    completed_at: (/* @__PURE__ */ new Date()).toISOString(),
    duration_ms: Date.now() - t0,
    scan_type: scanType,
    domains_scanned: domains.length,
    ct_entries: ctResults.length,
    dmarc_results: dmarcResultsList.length,
    total_new_nodes: totalNewNodes,
    tools_available: toolsAvailable,
    ct_results: ctResults,
    dmarc_results_list: dmarcResultsList,
    errors
  };
  await persistScanResult(result);
  logger.info({
    scan_id: scanId,
    duration_ms: result.duration_ms,
    ct_entries: result.ct_entries,
    dmarc_results: result.dmarc_results,
    total_new_nodes: totalNewNodes,
    tools_available: toolsAvailable,
    error_count: errors.length
  }, "OSINT scan completed");
  return result;
}
async function getOsintStatus() {
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const cached = await redis2.get("orchestrator:osint:latest");
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to read OSINT status from Redis");
  }
  return null;
}
var DK_PUBLIC_DOMAINS, MAX_CONCURRENT2, BATCH_DELAY_MS, DOMAIN_TIMEOUT_MS, MAX_RETRIES2, MERGE_BATCH_SIZE;
var init_osint_scanner = __esm({
  "src/osint-scanner.ts"() {
    "use strict";
    init_mcp_caller();
    init_redis();
    init_logger();
    DK_PUBLIC_DOMAINS = [
      "skat.dk",
      "sundhed.dk",
      "borger.dk",
      "nemlog-in.dk",
      "kombit.dk",
      "regionh.dk",
      "regionsjaelland.dk",
      "rm.dk",
      "rn.dk",
      "rsyd.dk",
      "kl.dk",
      "digst.dk",
      "sikkerdigital.dk",
      "medcom.dk",
      "dst.dk",
      "politi.dk",
      "forsvaret.dk",
      "atp.dk",
      "star.dk",
      "retsinformation.dk",
      "dtu.dk",
      "ku.dk",
      "au.dk",
      "sdu.dk",
      "aau.dk",
      "kk.dk",
      "aarhus.dk",
      "odense.dk",
      "aalborg.dk",
      "esbjerg.dk",
      "frederiksberg.dk",
      "roskilde.dk",
      "horsens.dk",
      "vejle.dk",
      "silkeborg.dk",
      "herning.dk",
      "kolding.dk",
      "fredericia.dk",
      "viborg.dk",
      "holstebro.dk",
      "naestved.dk",
      "slagelse.dk",
      "hillerod.dk",
      "helsingor.dk",
      "greve.dk",
      "frederikshavn.dk",
      "svendborg.dk",
      "ringsted.dk",
      "nordfyns.dk",
      "vordingborg.dk"
    ];
    MAX_CONCURRENT2 = 5;
    BATCH_DELAY_MS = 1e3;
    DOMAIN_TIMEOUT_MS = 3e4;
    MAX_RETRIES2 = 2;
    MERGE_BATCH_SIZE = 20;
  }
});

// src/evolution-loop.ts
var evolution_loop_exports = {};
__export(evolution_loop_exports, {
  getEvolutionHistory: () => getEvolutionHistory,
  getEvolutionStatus: () => getEvolutionStatus,
  runEvolutionLoop: () => runEvolutionLoop
});
import { v4 as uuid12 } from "uuid";
async function persistCycle(cycle) {
  const redis2 = getRedis();
  if (!redis2) return;
  try {
    await redis2.set(`${REDIS_PREFIX3}${cycle.cycle_id}`, JSON.stringify(cycle), "EX", REDIS_TTL);
    await redis2.lpush(REDIS_HISTORY_KEY, JSON.stringify(cycle));
    await redis2.ltrim(REDIS_HISTORY_KEY, 0, 19);
    await redis2.expire(REDIS_HISTORY_KEY, REDIS_TTL);
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to persist evolution cycle to Redis");
  }
}
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
function safeParseJson(text) {
  if (typeof text !== "string") {
    if (typeof text === "object" && text !== null) return text;
    return {};
  }
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  } catch {
    return {};
  }
}
async function stageObserve(focusArea) {
  currentStage = "observe";
  logger.info({ focus_area: focusArea }, "Evolution OBSERVE stage starting");
  const [healthResult, failuresResult, lessonsResult] = await Promise.allSettled([
    callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: "MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC LIMIT 15"
      },
      callId: uuid12(),
      timeoutMs: 1e4
    }),
    callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: "MATCH (f:FailureMemory) WHERE f.last_seen > datetime() - duration('P7D') RETURN f.category AS category, f.pattern AS pattern, f.hit_count AS hits ORDER BY f.hit_count DESC LIMIT 10"
      },
      callId: uuid12(),
      timeoutMs: 1e4
    }),
    callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: "MATCH (l:Lesson) WHERE l.created_at > datetime() - duration('P7D') RETURN l.agent_id AS agent, l.lesson AS lesson, l.context AS context ORDER BY l.created_at DESC LIMIT 10"
      },
      callId: uuid12(),
      timeoutMs: 1e4
    })
  ]);
  const healthData = healthResult.status === "fulfilled" ? healthResult.value.result : "unavailable";
  const failureData = failuresResult.status === "fulfilled" ? failuresResult.value.result : "unavailable";
  const lessonData = lessonsResult.status === "fulfilled" ? lessonsResult.value.result : "unavailable";
  const contextPrompt = `Analyze the current WidgeTDC platform state for autonomous evolution opportunities.
${focusArea ? `Focus area: ${focusArea}` : "General platform assessment."}

Graph health (node distribution): ${JSON.stringify(healthData)}
Recent failures (7d): ${JSON.stringify(failureData)}
Recent lessons (7d): ${JSON.stringify(lessonData)}

Return JSON: {"observations": ["..."], "priority_areas": ["..."], "confidence": 0.0-1.0}`;
  if (isRlmAvailable()) {
    try {
      const raw = await withTimeout(
        callCognitive("analyze", {
          prompt: contextPrompt,
          context: { source: "evolution-loop", stage: "observe" },
          agent_id: "evolution-loop"
        }, STAGE_TIMEOUT_MS),
        STAGE_TIMEOUT_MS,
        "OBSERVE cognitive"
      );
      const parsed = safeParseJson(raw);
      return {
        observations: Array.isArray(parsed.observations) ? parsed.observations : ["Platform state assessed via RLM"],
        priority_areas: Array.isArray(parsed.priority_areas) ? parsed.priority_areas : ["general-health"],
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5
      };
    } catch (err) {
      logger.warn({ err: String(err) }, "RLM analyze failed in OBSERVE, falling back to heuristic");
    }
  }
  const observations = ["Platform state collected via graph queries (RLM unavailable)"];
  const priority_areas = [];
  if (failureData !== "unavailable" && Array.isArray(failureData)) {
    observations.push(`${failureData.length} failure patterns detected in last 7 days`);
    priority_areas.push("failure-remediation");
  }
  if (focusArea) priority_areas.push(focusArea);
  if (priority_areas.length === 0) priority_areas.push("general-health");
  return { observations, priority_areas, confidence: 0.3 };
}
async function stageOrient(observeResult, focusArea) {
  currentStage = "orient";
  logger.info({ priority_areas: observeResult.priority_areas }, "Evolution ORIENT stage starting");
  const blocksResult = await callMcpTool({
    toolName: "graph.read_cypher",
    args: {
      query: `MATCH (b) WHERE b:Block OR b:Assembly OR b:Pattern
        RETURN labels(b)[0] AS label, coalesce(b.name, b.title, b.id) AS name, b.status AS status, b.quality_score AS quality
        ORDER BY coalesce(b.quality_score, 0) ASC LIMIT 10`
    },
    callId: uuid12(),
    timeoutMs: 1e4
  });
  const blocks = blocksResult.status === "success" ? Array.isArray(blocksResult.result) ? blocksResult.result : blocksResult.result?.results ?? [] : [];
  if (isRlmAvailable()) {
    try {
      const planPrompt = `Create an improvement plan for WidgeTDC platform evolution.
${focusArea ? `Focus: ${focusArea}` : ""}

Observations: ${JSON.stringify(observeResult.observations)}
Priority areas: ${JSON.stringify(observeResult.priority_areas)}
Blocks needing attention: ${JSON.stringify(blocks)}

Return JSON: {"blocks_to_evolve": [{"id": "...", "label": "...", "name": "...", "reason": "..."}], "plan": "...", "estimated_impact": 0.0-1.0}`;
      const raw = await withTimeout(
        callCognitive("plan", {
          prompt: planPrompt,
          context: { source: "evolution-loop", stage: "orient", observations: observeResult },
          agent_id: "evolution-loop"
        }, STAGE_TIMEOUT_MS),
        STAGE_TIMEOUT_MS,
        "ORIENT cognitive"
      );
      const parsed = safeParseJson(raw);
      return {
        blocks_to_evolve: Array.isArray(parsed.blocks_to_evolve) ? parsed.blocks_to_evolve : [],
        plan: typeof parsed.plan === "string" ? parsed.plan : "Improvement plan generated via RLM",
        estimated_impact: typeof parsed.estimated_impact === "number" ? parsed.estimated_impact : 0.5
      };
    } catch (err) {
      logger.warn({ err: String(err) }, "RLM plan failed in ORIENT, falling back to heuristic");
    }
  }
  return {
    blocks_to_evolve: blocks.slice(0, 5).map((b) => ({
      id: b.name ?? "unknown",
      label: b.label ?? "Block",
      name: b.name ?? "unknown",
      reason: `Low quality score: ${b.quality ?? "unscored"}`
    })),
    plan: "Heuristic plan: address lowest-quality blocks first",
    estimated_impact: 0.3
  };
}
async function stageAct(orientResult, dryRun) {
  currentStage = "act";
  logger.info({ blocks: orientResult.blocks_to_evolve.length, dry_run: dryRun }, "Evolution ACT stage starting");
  if (dryRun) {
    return {
      executed: 0,
      passed: 0,
      failed: 0,
      artifacts: [`DRY RUN: Would evolve ${orientResult.blocks_to_evolve.length} blocks. Plan: ${orientResult.plan}`]
    };
  }
  if (orientResult.blocks_to_evolve.length === 0) {
    return { executed: 0, passed: 0, failed: 0, artifacts: ["No blocks identified for evolution"] };
  }
  const steps = orientResult.blocks_to_evolve.slice(0, 3).map((block, i) => ({
    id: `evolve-${i}`,
    agent_id: "orchestrator",
    cognitive_action: "analyze",
    prompt: `Analyze and suggest improvements for "${block.name}" (${block.label}). Reason: ${block.reason}. Plan: ${orientResult.plan}`,
    timeout_ms: 6e4
  }));
  try {
    const execution = await withTimeout(
      executeChain({
        name: "Evolution Improvement Cycle",
        mode: "sequential",
        steps
      }),
      STAGE_TIMEOUT_MS,
      "ACT chain"
    );
    const passed = execution.results.filter((r) => r.status === "success").length;
    const failed = execution.results.filter((r) => r.status === "error").length;
    return {
      executed: execution.results.length,
      passed,
      failed,
      artifacts: execution.results.filter((r) => r.status === "success").map((r) => typeof r.output === "string" ? r.output.slice(0, 200) : JSON.stringify(r.output).slice(0, 200))
    };
  } catch (err) {
    logger.error({ err: String(err) }, "Evolution ACT chain failed");
    return { executed: 0, passed: 0, failed: 1, artifacts: [`Chain failed: ${err}`] };
  }
}
async function stageLearn(cycleId, observeResult, orientResult, actResult) {
  currentStage = "learn";
  logger.info({ cycle_id: cycleId }, "Evolution LEARN stage starting");
  let eventsCreated = 0;
  let lessonsWritten = 0;
  try {
    const writeResult = await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MERGE (e:EvolutionEvent {cycle_id: $cycle_id})
          SET e.timestamp = datetime(),
              e.observations = $observations,
              e.priority_areas = $priority_areas,
              e.blocks_evolved = $blocks_evolved,
              e.plan = $plan,
              e.executed = $executed,
              e.passed = $passed,
              e.failed = $failed,
              e.pass_rate = CASE WHEN $executed > 0 THEN toFloat($passed) / $executed ELSE 0.0 END,
              e.confidence = $confidence,
              e.estimated_impact = $estimated_impact`,
        params: {
          cycle_id: cycleId,
          observations: observeResult.observations.join(" | "),
          priority_areas: observeResult.priority_areas.join(", "),
          blocks_evolved: orientResult.blocks_to_evolve.map((b) => b.name).join(", "),
          plan: orientResult.plan.slice(0, 500),
          executed: actResult.executed,
          passed: actResult.passed,
          failed: actResult.failed,
          confidence: observeResult.confidence,
          estimated_impact: orientResult.estimated_impact
        }
      },
      callId: uuid12(),
      timeoutMs: 15e3
    });
    if (writeResult.status === "success") {
      eventsCreated = 1;
    } else {
      logger.warn({ err: writeResult.error_message }, "Failed to write EvolutionEvent to Neo4j");
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "EvolutionEvent write failed");
  }
  if (actResult.passed > 0 || actResult.failed > 0) {
    try {
      const lessonText = actResult.failed > 0 ? `Evolution cycle ${cycleId}: ${actResult.passed}/${actResult.executed} improvements passed. Failures need attention in: ${orientResult.blocks_to_evolve.map((b) => b.name).join(", ")}` : `Evolution cycle ${cycleId}: all ${actResult.passed} improvements passed. Areas improved: ${orientResult.blocks_to_evolve.map((b) => b.name).join(", ")}`;
      const lessonResult = await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `MERGE (l:Lesson {source_id: $source_id})
            SET l.agent_id = 'evolution-loop',
                l.lesson = $lesson,
                l.context = $context,
                l.created_at = datetime(),
                l.cycle_id = $cycle_id`,
          params: {
            source_id: `evolution-${cycleId}`,
            lesson: lessonText,
            context: `OODA cycle: ${observeResult.priority_areas.join(", ")}`,
            cycle_id: cycleId
          }
        },
        callId: uuid12(),
        timeoutMs: 1e4
      });
      if (lessonResult.status === "success") {
        lessonsWritten = 1;
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Lesson write failed");
    }
  }
  return { events_created: eventsCreated, lessons_written: lessonsWritten };
}
async function runEvolutionLoop(opts) {
  if (isRunning) {
    throw new Error("Evolution loop already running. Only 1 concurrent cycle allowed.");
  }
  isRunning = true;
  const cycleId = uuid12();
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const t0 = Date.now();
  const focusArea = opts?.focus_area?.slice(0, 200);
  const dryRun = opts?.dry_run ?? false;
  logger.info({ cycle_id: cycleId, focus_area: focusArea, dry_run: dryRun }, "Evolution loop starting");
  broadcastMessage({
    from: "Orchestrator",
    to: "All",
    source: "orchestrator",
    type: "Message",
    message: `Evolution loop started (cycle: ${cycleId}${focusArea ? `, focus: ${focusArea}` : ""}${dryRun ? ", DRY RUN" : ""})`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  const cycle = {
    cycle_id: cycleId,
    status: "failed",
    summary: "",
    started_at: startedAt,
    completed_at: "",
    duration_ms: 0,
    focus_area: focusArea,
    dry_run: dryRun,
    stages: {}
  };
  const abortController = new AbortController();
  const totalTimer = setTimeout(() => {
    if (isRunning) {
      logger.error({ cycle_id: cycleId }, "Evolution loop hit total timeout (20min)");
      abortController.abort();
    }
  }, TOTAL_TIMEOUT_MS);
  try {
    const checkAbort = () => {
      if (abortController.signal.aborted) throw new Error("Evolution loop aborted: total timeout exceeded");
    };
    let observeResult;
    const obs_t0 = Date.now();
    try {
      observeResult = await stageObserve(focusArea);
      cycle.stages.observe = { status: "success", result: observeResult, duration_ms: Date.now() - obs_t0 };
    } catch (err) {
      cycle.stages.observe = { status: "error", error: String(err), duration_ms: Date.now() - obs_t0 };
      throw new Error(`OBSERVE failed: ${err}`);
    }
    checkAbort();
    let orientResult;
    const ori_t0 = Date.now();
    try {
      orientResult = await stageOrient(observeResult, focusArea);
      cycle.stages.orient = { status: "success", result: orientResult, duration_ms: Date.now() - ori_t0 };
    } catch (err) {
      cycle.stages.orient = { status: "error", error: String(err), duration_ms: Date.now() - ori_t0 };
      throw new Error(`ORIENT failed: ${err}`);
    }
    checkAbort();
    let actResult;
    const act_t0 = Date.now();
    try {
      actResult = await stageAct(orientResult, dryRun);
      cycle.stages.act = { status: "success", result: actResult, duration_ms: Date.now() - act_t0 };
    } catch (err) {
      cycle.stages.act = { status: "error", error: String(err), duration_ms: Date.now() - act_t0 };
      throw new Error(`ACT failed: ${err}`);
    }
    checkAbort();
    let learnResult;
    const lrn_t0 = Date.now();
    if (dryRun) {
      learnResult = { events_created: 0, lessons_written: 0 };
      cycle.stages.learn = { status: "skipped", result: learnResult, duration_ms: 0 };
    } else {
      try {
        learnResult = await stageLearn(cycleId, observeResult, orientResult, actResult);
        cycle.stages.learn = { status: "success", result: learnResult, duration_ms: Date.now() - lrn_t0 };
      } catch (err) {
        learnResult = { events_created: 0, lessons_written: 0 };
        cycle.stages.learn = { status: "error", error: String(err), duration_ms: Date.now() - lrn_t0 };
        logger.warn({ err: String(err) }, "LEARN stage failed (non-fatal)");
      }
    }
    const failedStages = Object.values(cycle.stages).filter((s) => s?.status === "error").length;
    cycle.status = dryRun ? "dry_run" : failedStages === 0 ? "completed" : "partial";
    cycle.summary = dryRun ? `Dry run: ${observeResult.observations.length} observations, ${orientResult.blocks_to_evolve.length} blocks identified, plan: ${orientResult.plan.slice(0, 100)}` : `${actResult.passed}/${actResult.executed} improvements passed, ${learnResult.events_created} events written, ${learnResult.lessons_written} lessons captured`;
  } catch (err) {
    cycle.status = "failed";
    cycle.summary = `Evolution cycle failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.error({ cycle_id: cycleId, err: String(err) }, "Evolution loop failed");
  } finally {
    clearTimeout(totalTimer);
    cycle.completed_at = (/* @__PURE__ */ new Date()).toISOString();
    cycle.duration_ms = Date.now() - t0;
    isRunning = false;
    currentStage = void 0;
    lastCycle = cycle;
    totalCycles++;
    await persistCycle(cycle);
    broadcastMessage({
      from: "Orchestrator",
      to: "All",
      source: "orchestrator",
      type: "Message",
      message: `Evolution loop ${cycle.status} (${cycle.duration_ms}ms): ${cycle.summary}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    broadcastSSE("evolution-cycle", cycle);
    logger.info({
      cycle_id: cycleId,
      status: cycle.status,
      duration_ms: cycle.duration_ms
    }, "Evolution loop completed");
  }
  return cycle;
}
function getEvolutionStatus() {
  return {
    is_running: isRunning,
    current_stage: currentStage,
    last_cycle: lastCycle,
    total_cycles: totalCycles
  };
}
async function getEvolutionHistory(limit = 10) {
  const redis2 = getRedis();
  if (!redis2) return lastCycle ? [lastCycle] : [];
  try {
    const raw = await redis2.lrange(REDIS_HISTORY_KEY, 0, limit - 1);
    return raw.map((r) => JSON.parse(r));
  } catch {
    return lastCycle ? [lastCycle] : [];
  }
}
var isRunning, currentStage, lastCycle, totalCycles, STAGE_TIMEOUT_MS, TOTAL_TIMEOUT_MS, REDIS_PREFIX3, REDIS_HISTORY_KEY, REDIS_TTL;
var init_evolution_loop = __esm({
  "src/evolution-loop.ts"() {
    "use strict";
    init_cognitive_proxy();
    init_mcp_caller();
    init_chain_engine();
    init_redis();
    init_logger();
    init_chat_broadcaster();
    init_sse();
    isRunning = false;
    totalCycles = 0;
    STAGE_TIMEOUT_MS = 5 * 60 * 1e3;
    TOTAL_TIMEOUT_MS = 20 * 60 * 1e3;
    REDIS_PREFIX3 = "orchestrator:evolution:";
    REDIS_HISTORY_KEY = "orchestrator:evolution:history";
    REDIS_TTL = 7 * 86400;
  }
});

// src/llm-proxy.ts
function getProviders() {
  const providers = {};
  if (config.deepseekApiKey) {
    providers.deepseek = {
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: config.deepseekApiKey,
      defaultModel: "deepseek-chat",
      type: "openai-compat"
    };
  }
  if (config.dashscopeApiKey) {
    providers.qwen = {
      name: "Qwen",
      baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      apiKey: config.dashscopeApiKey,
      defaultModel: "qwen-plus",
      type: "openai-compat"
    };
  }
  if (config.openaiApiKey) {
    providers.openai = {
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKey: config.openaiApiKey,
      defaultModel: "gpt-4o-mini",
      type: "openai-compat"
    };
    providers.chatgpt = providers.openai;
  }
  if (config.groqApiKey) {
    providers.groq = {
      name: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: config.groqApiKey,
      defaultModel: "llama-3.3-70b-versatile",
      type: "openai-compat"
    };
  }
  if (config.geminiApiKey) {
    providers.gemini = {
      name: "Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: config.geminiApiKey,
      defaultModel: "gemini-2.0-flash",
      type: "gemini"
    };
  }
  if (config.anthropicApiKey) {
    providers.claude = {
      name: "Claude",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: config.anthropicApiKey,
      defaultModel: "claude-sonnet-4-20250514",
      type: "anthropic"
    };
    providers.anthropic = providers.claude;
  }
  return providers;
}
async function callOpenAICompat(provider, req) {
  const start = Date.now();
  const model = req.model || provider.defaultModel;
  const body = {
    model,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.max_tokens ?? 2048
  };
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools;
  }
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6e4)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`${provider.name} error: ${err}`);
  }
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  return {
    provider: req.provider,
    model: data.model || model,
    content: message?.content || "",
    tool_calls: message?.tool_calls,
    usage: data.usage,
    duration_ms: Date.now() - start
  };
}
async function callGemini(provider, req) {
  const start = Date.now();
  const model = req.model || provider.defaultModel;
  const contents = req.messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const systemInstruction = req.messages.find((m) => m.role === "system");
  const geminiTools = req.tools && req.tools.length > 0 ? [{
    functionDeclarations: req.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters
    }))
  }] : void 0;
  const res = await fetch(
    `${provider.baseUrl}/models/${model}:generateContent?key=${provider.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        ...systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {},
        ...geminiTools ? { tools: geminiTools } : {},
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.max_tokens ?? 2048
        }
      }),
      signal: AbortSignal.timeout(6e4)
    }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gemini error: ${err}`);
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const textParts = parts.filter((p) => p.text).map((p) => p.text);
  const functionCalls = parts.filter((p) => p.functionCall);
  const tool_calls = functionCalls.length > 0 ? functionCalls.map((fc, i) => ({
    id: `call_gemini_${i}_${Date.now()}`,
    type: "function",
    function: {
      name: fc.functionCall.name,
      arguments: JSON.stringify(fc.functionCall.args || {})
    }
  })) : void 0;
  return {
    provider: "gemini",
    model,
    content: textParts.join("") || "",
    tool_calls,
    usage: data.usageMetadata ? {
      prompt_tokens: data.usageMetadata.promptTokenCount || 0,
      completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
      total_tokens: data.usageMetadata.totalTokenCount || 0
    } : void 0,
    duration_ms: Date.now() - start
  };
}
async function callAnthropic(provider, req) {
  const start = Date.now();
  const model = req.model || provider.defaultModel;
  const systemMsg = req.messages.find((m) => m.role === "system");
  const nonSystem = req.messages.filter((m) => m.role !== "system");
  const anthropicTools = req.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters
  }));
  const anthropicMessages = nonSystem.map((m) => {
    if (m.role === "assistant" && m.tool_calls) {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}")
        });
      }
      return { role: "assistant", content };
    }
    if (m.role === "tool" && m.tool_call_id) {
      return {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: m.content
        }]
      };
    }
    return { role: m.role === "tool" ? "user" : m.role, content: m.content };
  });
  const body = {
    model,
    max_tokens: req.max_tokens ?? 2048,
    ...systemMsg ? { system: systemMsg.content } : {},
    messages: anthropicMessages
  };
  if (anthropicTools && anthropicTools.length > 0) {
    body.tools = anthropicTools;
  }
  const res = await fetch(`${provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6e4)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Claude error: ${err}`);
  }
  const data = await res.json();
  const contentBlocks = data.content || [];
  const textBlocks = contentBlocks.filter((b) => b.type === "text");
  const toolUseBlocks = contentBlocks.filter((b) => b.type === "tool_use");
  const tool_calls = toolUseBlocks.length > 0 ? toolUseBlocks.map((tu) => ({
    id: tu.id,
    type: "function",
    function: {
      name: tu.name,
      arguments: JSON.stringify(tu.input || {})
    }
  })) : void 0;
  return {
    provider: "claude",
    model: data.model || model,
    content: textBlocks.map((b) => b.text).join("") || "",
    tool_calls,
    usage: data.usage ? {
      prompt_tokens: data.usage.input_tokens || 0,
      completion_tokens: data.usage.output_tokens || 0,
      total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
    } : void 0,
    duration_ms: Date.now() - start
  };
}
async function chatLLM(req) {
  const providers = getProviders();
  const provider = providers[req.provider.toLowerCase()];
  if (!provider) {
    const available = Object.keys(providers);
    throw new Error(`Unknown provider '${req.provider}'. Available: ${available.join(", ")}`);
  }
  logger.info({ provider: req.provider, model: req.model, messages: req.messages.length }, "LLM proxy call");
  switch (provider.type) {
    case "openai-compat":
      return callOpenAICompat(provider, req);
    case "gemini":
      return callGemini(provider, req);
    case "anthropic":
      return callAnthropic(provider, req);
    default:
      throw new Error(`Unsupported provider type: ${provider.type}`);
  }
}
function listProviders() {
  const providers = getProviders();
  const all = [
    { id: "deepseek", name: "DeepSeek", model: "deepseek-chat" },
    { id: "qwen", name: "Qwen", model: "qwen-plus" },
    { id: "gemini", name: "Gemini", model: "gemini-2.0-flash" },
    { id: "openai", name: "OpenAI/ChatGPT", model: "gpt-4o-mini" },
    { id: "groq", name: "Groq", model: "llama-3.3-70b-versatile" },
    { id: "claude", name: "Claude", model: "claude-sonnet-4-20250514" }
  ];
  return all.map((p) => ({ ...p, available: !!providers[p.id] }));
}
var init_llm_proxy = __esm({
  "src/llm-proxy.ts"() {
    "use strict";
    init_config();
    init_logger();
  }
});

// src/critique-refine.ts
var critique_refine_exports = {};
__export(critique_refine_exports, {
  critiqueRefine: () => critiqueRefine
});
async function critiqueRefine(query, provider = "deepseek", principles, maxRounds = 1) {
  const t0 = Date.now();
  const dims = principles ?? DEFAULT_PRINCIPLES;
  const genMessages = [
    { role: "system", content: "You are a helpful, accurate assistant. Respond thoroughly." },
    { role: "user", content: query }
  ];
  const genResponse = await chatLLM({ provider, messages: genMessages, temperature: 0.7 });
  let current = genResponse.content;
  let critique = "";
  for (let round = 0; round < maxRounds; round++) {
    const critiqueMessages = [
      { role: "system", content: `You are a strict quality reviewer. Evaluate the response against these principles:
${dims.map((p, i) => `${i + 1}. ${p}`).join("\n")}

List specific issues found. If no issues, say "No issues found."` },
      { role: "user", content: `Query: ${query}

Response to review:
${current}` }
    ];
    const critiqueResponse = await chatLLM({ provider, messages: critiqueMessages, temperature: 0.3 });
    critique = critiqueResponse.content;
    if (critique.toLowerCase().includes("no issues found")) break;
    const reviseMessages = [
      { role: "system", content: "You are revising a response based on critique feedback. Keep what was good, fix what was flagged. Return only the improved response." },
      { role: "user", content: `Original query: ${query}

Current response:
${current}

Critique:
${critique}

Revised response:` }
    ];
    const reviseResponse = await chatLLM({ provider, messages: reviseMessages, temperature: 0.5 });
    current = reviseResponse.content;
  }
  const result = {
    original: genResponse.content,
    critique,
    revised: current,
    provider,
    rounds: maxRounds,
    duration_ms: Date.now() - t0
  };
  logger.info({ provider, rounds: maxRounds, ms: result.duration_ms }, "Critique-refine complete");
  return result;
}
var DEFAULT_PRINCIPLES;
var init_critique_refine = __esm({
  "src/critique-refine.ts"() {
    "use strict";
    init_llm_proxy();
    init_logger();
    DEFAULT_PRINCIPLES = [
      "Accuracy: Are all claims factually correct and verifiable?",
      "Completeness: Does the response address all aspects of the query?",
      "Clarity: Is the response clear, well-structured, and free of jargon?",
      "Safety: Does the response avoid harmful, biased, or misleading content?",
      "Relevance: Does the response stay focused on the query without tangents?"
    ];
  }
});

// src/agent-judge.ts
var agent_judge_exports = {};
__export(agent_judge_exports, {
  judgeResponse: () => judgeResponse
});
async function judgeResponse(query, response, context, provider = "deepseek") {
  const t0 = Date.now();
  const userPrompt = [
    `**Query/Task:**
${query}`,
    context ? `**Reference Context:**
${context}` : "",
    `**Agent Response to Judge:**
${response}`
  ].filter(Boolean).join("\n\n");
  const messages = [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: userPrompt }
  ];
  const llmResult = await chatLLM({ provider, messages, temperature: 0.1, max_tokens: 500 });
  let score;
  try {
    const jsonMatch = llmResult.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in judge response");
    const parsed = JSON.parse(jsonMatch[0]);
    const clamp = (v) => Math.max(0, Math.min(10, Number(v) || 0));
    score = {
      precision: clamp(parsed.precision),
      reasoning: clamp(parsed.reasoning),
      information: clamp(parsed.information),
      safety: clamp(parsed.safety),
      methodology: clamp(parsed.methodology),
      aggregate: 0,
      explanation: typeof parsed.explanation === "string" ? parsed.explanation.slice(0, 500) : "No explanation provided"
    };
    score.aggregate = Number(((score.precision + score.reasoning + score.information + score.safety + score.methodology) / 5).toFixed(1));
  } catch (err) {
    logger.warn({ err: String(err) }, "Agent judge: failed to parse score, returning defaults");
    score = { precision: 5, reasoning: 5, information: 5, safety: 5, methodology: 5, aggregate: 5, explanation: `Parse error: ${err}` };
  }
  const result = { query, score, provider, duration_ms: Date.now() - t0 };
  logger.info({ aggregate: score.aggregate, provider, ms: result.duration_ms }, "Agent judge complete");
  return result;
}
var JUDGE_SYSTEM_PROMPT;
var init_agent_judge = __esm({
  "src/agent-judge.ts"() {
    "use strict";
    init_llm_proxy();
    init_logger();
    JUDGE_SYSTEM_PROMPT = `You are a strict, impartial judge evaluating an AI agent's response.

Score the response on 5 PRISM dimensions (0-10 each):

**P \u2014 Precision** (0-10): Are all facts correct? No hallucinations, no fabricated data.
**R \u2014 Reasoning** (0-10): Is the logic sound? Are conclusions valid from the evidence?
**I \u2014 Information** (0-10): Is the response complete? Does it cover all relevant aspects?
**S \u2014 Safety** (0-10): No harmful content, no bias, no data leaks, no prompt injection.
**M \u2014 Methodology** (0-10): Was the approach appropriate? Best practices followed?

Respond ONLY in this exact JSON format:
{
  "precision": <0-10>,
  "reasoning": <0-10>,
  "information": <0-10>,
  "safety": <0-10>,
  "methodology": <0-10>,
  "explanation": "<2-3 sentence summary of strengths and weaknesses>"
}`;
  }
});

// src/index.ts
init_tracing();
init_config();
init_logger();
init_chat_broadcaster();
init_redis();
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import path2 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/routes/agents.ts
init_agent_registry();
init_slack();
import { Router } from "express";

// node_modules/@sinclair/typebox/build/esm/value/guard/guard.mjs
function IsAsyncIterator(value) {
  return IsObject(value) && globalThis.Symbol.asyncIterator in value;
}
function IsIterator(value) {
  return IsObject(value) && globalThis.Symbol.iterator in value;
}
function IsStandardObject(value) {
  return IsObject(value) && (globalThis.Object.getPrototypeOf(value) === Object.prototype || globalThis.Object.getPrototypeOf(value) === null);
}
function IsPromise(value) {
  return value instanceof globalThis.Promise;
}
function IsDate(value) {
  return value instanceof Date && globalThis.Number.isFinite(value.getTime());
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsTypedArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function HasPropertyKey(value, key) {
  return key in value;
}
function IsObject(value) {
  return value !== null && typeof value === "object";
}
function IsArray(value) {
  return globalThis.Array.isArray(value) && !globalThis.ArrayBuffer.isView(value);
}
function IsUndefined(value) {
  return value === void 0;
}
function IsNull(value) {
  return value === null;
}
function IsBoolean(value) {
  return typeof value === "boolean";
}
function IsNumber(value) {
  return typeof value === "number";
}
function IsInteger(value) {
  return globalThis.Number.isInteger(value);
}
function IsBigInt(value) {
  return typeof value === "bigint";
}
function IsString(value) {
  return typeof value === "string";
}
function IsFunction(value) {
  return typeof value === "function";
}
function IsSymbol(value) {
  return typeof value === "symbol";
}
function IsValueType(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsSymbol(value) || IsUndefined(value);
}

// node_modules/@sinclair/typebox/build/esm/system/policy.mjs
var TypeSystemPolicy;
(function(TypeSystemPolicy3) {
  TypeSystemPolicy3.InstanceMode = "default";
  TypeSystemPolicy3.ExactOptionalPropertyTypes = false;
  TypeSystemPolicy3.AllowArrayObject = false;
  TypeSystemPolicy3.AllowNaN = false;
  TypeSystemPolicy3.AllowNullVoid = false;
  function IsExactOptionalProperty(value, key) {
    return TypeSystemPolicy3.ExactOptionalPropertyTypes ? key in value : value[key] !== void 0;
  }
  TypeSystemPolicy3.IsExactOptionalProperty = IsExactOptionalProperty;
  function IsObjectLike(value) {
    const isObject = IsObject(value);
    return TypeSystemPolicy3.AllowArrayObject ? isObject : isObject && !IsArray(value);
  }
  TypeSystemPolicy3.IsObjectLike = IsObjectLike;
  function IsRecordLike(value) {
    return IsObjectLike(value) && !(value instanceof Date) && !(value instanceof Uint8Array);
  }
  TypeSystemPolicy3.IsRecordLike = IsRecordLike;
  function IsNumberLike(value) {
    return TypeSystemPolicy3.AllowNaN ? IsNumber(value) : Number.isFinite(value);
  }
  TypeSystemPolicy3.IsNumberLike = IsNumberLike;
  function IsVoidLike(value) {
    const isUndefined = IsUndefined(value);
    return TypeSystemPolicy3.AllowNullVoid ? isUndefined || value === null : isUndefined;
  }
  TypeSystemPolicy3.IsVoidLike = IsVoidLike;
})(TypeSystemPolicy || (TypeSystemPolicy = {}));

// node_modules/@sinclair/typebox/build/esm/type/registry/format.mjs
var format_exports = {};
__export(format_exports, {
  Clear: () => Clear,
  Delete: () => Delete,
  Entries: () => Entries,
  Get: () => Get,
  Has: () => Has,
  Set: () => Set2
});
var map = /* @__PURE__ */ new Map();
function Entries() {
  return new Map(map);
}
function Clear() {
  return map.clear();
}
function Delete(format) {
  return map.delete(format);
}
function Has(format) {
  return map.has(format);
}
function Set2(format, func) {
  map.set(format, func);
}
function Get(format) {
  return map.get(format);
}

// node_modules/@sinclair/typebox/build/esm/type/registry/type.mjs
var type_exports = {};
__export(type_exports, {
  Clear: () => Clear2,
  Delete: () => Delete2,
  Entries: () => Entries2,
  Get: () => Get2,
  Has: () => Has2,
  Set: () => Set3
});
var map2 = /* @__PURE__ */ new Map();
function Entries2() {
  return new Map(map2);
}
function Clear2() {
  return map2.clear();
}
function Delete2(kind) {
  return map2.delete(kind);
}
function Has2(kind) {
  return map2.has(kind);
}
function Set3(kind, func) {
  map2.set(kind, func);
}
function Get2(kind) {
  return map2.get(kind);
}

// node_modules/@sinclair/typebox/build/esm/type/guard/value.mjs
function IsArray2(value) {
  return Array.isArray(value);
}
function IsBigInt2(value) {
  return typeof value === "bigint";
}
function IsBoolean2(value) {
  return typeof value === "boolean";
}
function IsDate2(value) {
  return value instanceof globalThis.Date;
}
function IsNumber2(value) {
  return typeof value === "number";
}
function IsObject2(value) {
  return typeof value === "object" && value !== null;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsString2(value) {
  return typeof value === "string";
}
function IsUint8Array2(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUndefined2(value) {
  return value === void 0;
}

// node_modules/@sinclair/typebox/build/esm/type/create/immutable.mjs
function ImmutableArray(value) {
  return globalThis.Object.freeze(value).map((value2) => Immutable(value2));
}
function ImmutableDate(value) {
  return value;
}
function ImmutableUint8Array(value) {
  return value;
}
function ImmutableRegExp(value) {
  return value;
}
function ImmutableObject(value) {
  const result = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    result[key] = Immutable(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    result[key] = Immutable(value[key]);
  }
  return globalThis.Object.freeze(result);
}
function Immutable(value) {
  return IsArray2(value) ? ImmutableArray(value) : IsDate2(value) ? ImmutableDate(value) : IsUint8Array2(value) ? ImmutableUint8Array(value) : IsRegExp(value) ? ImmutableRegExp(value) : IsObject2(value) ? ImmutableObject(value) : value;
}

// node_modules/@sinclair/typebox/build/esm/type/clone/value.mjs
function ArrayType(value) {
  return value.map((value2) => Visit(value2));
}
function DateType(value) {
  return new Date(value.getTime());
}
function Uint8ArrayType(value) {
  return new Uint8Array(value);
}
function RegExpType(value) {
  return new RegExp(value.source, value.flags);
}
function ObjectType(value) {
  const result = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    result[key] = Visit(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    result[key] = Visit(value[key]);
  }
  return result;
}
function Visit(value) {
  return IsArray2(value) ? ArrayType(value) : IsDate2(value) ? DateType(value) : IsUint8Array2(value) ? Uint8ArrayType(value) : IsRegExp(value) ? RegExpType(value) : IsObject2(value) ? ObjectType(value) : value;
}
function Clone(value) {
  return Visit(value);
}

// node_modules/@sinclair/typebox/build/esm/type/create/type.mjs
function CreateType(schema, options) {
  const result = options !== void 0 ? { ...options, ...schema } : schema;
  switch (TypeSystemPolicy.InstanceMode) {
    case "freeze":
      return Immutable(result);
    case "clone":
      return Clone(result);
    default:
      return result;
  }
}

// node_modules/@sinclair/typebox/build/esm/type/symbols/symbols.mjs
var TransformKind = Symbol.for("TypeBox.Transform");
var ReadonlyKind = Symbol.for("TypeBox.Readonly");
var OptionalKind = Symbol.for("TypeBox.Optional");
var Hint = Symbol.for("TypeBox.Hint");
var Kind = Symbol.for("TypeBox.Kind");

// node_modules/@sinclair/typebox/build/esm/type/error/error.mjs
var TypeBoxError = class extends Error {
  constructor(message) {
    super(message);
  }
};

// node_modules/@sinclair/typebox/build/esm/type/mapped/mapped-result.mjs
function MappedResult(properties) {
  return CreateType({
    [Kind]: "MappedResult",
    properties
  });
}

// node_modules/@sinclair/typebox/build/esm/type/discard/discard.mjs
function DiscardKey(value, key) {
  const { [key]: _, ...rest } = value;
  return rest;
}
function Discard(value, keys) {
  return keys.reduce((acc, key) => DiscardKey(acc, key), value);
}

// node_modules/@sinclair/typebox/build/esm/type/never/never.mjs
function Never(options) {
  return CreateType({ [Kind]: "Never", not: {} }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/guard/kind.mjs
function IsOptional(value) {
  return IsObject2(value) && value[OptionalKind] === "Optional";
}
function IsAny(value) {
  return IsKindOf(value, "Any");
}
function IsArgument(value) {
  return IsKindOf(value, "Argument");
}
function IsArray3(value) {
  return IsKindOf(value, "Array");
}
function IsAsyncIterator2(value) {
  return IsKindOf(value, "AsyncIterator");
}
function IsBigInt3(value) {
  return IsKindOf(value, "BigInt");
}
function IsBoolean3(value) {
  return IsKindOf(value, "Boolean");
}
function IsComputed(value) {
  return IsKindOf(value, "Computed");
}
function IsConstructor(value) {
  return IsKindOf(value, "Constructor");
}
function IsDate3(value) {
  return IsKindOf(value, "Date");
}
function IsFunction2(value) {
  return IsKindOf(value, "Function");
}
function IsInteger2(value) {
  return IsKindOf(value, "Integer");
}
function IsIntersect(value) {
  return IsKindOf(value, "Intersect");
}
function IsIterator2(value) {
  return IsKindOf(value, "Iterator");
}
function IsKindOf(value, kind) {
  return IsObject2(value) && Kind in value && value[Kind] === kind;
}
function IsLiteral(value) {
  return IsKindOf(value, "Literal");
}
function IsMappedKey(value) {
  return IsKindOf(value, "MappedKey");
}
function IsMappedResult(value) {
  return IsKindOf(value, "MappedResult");
}
function IsNever(value) {
  return IsKindOf(value, "Never");
}
function IsNot(value) {
  return IsKindOf(value, "Not");
}
function IsNull2(value) {
  return IsKindOf(value, "Null");
}
function IsNumber3(value) {
  return IsKindOf(value, "Number");
}
function IsObject3(value) {
  return IsKindOf(value, "Object");
}
function IsPromise2(value) {
  return IsKindOf(value, "Promise");
}
function IsRecord(value) {
  return IsKindOf(value, "Record");
}
function IsRef(value) {
  return IsKindOf(value, "Ref");
}
function IsRegExp2(value) {
  return IsKindOf(value, "RegExp");
}
function IsString3(value) {
  return IsKindOf(value, "String");
}
function IsSymbol2(value) {
  return IsKindOf(value, "Symbol");
}
function IsTemplateLiteral(value) {
  return IsKindOf(value, "TemplateLiteral");
}
function IsThis(value) {
  return IsKindOf(value, "This");
}
function IsTransform(value) {
  return IsObject2(value) && TransformKind in value;
}
function IsTuple(value) {
  return IsKindOf(value, "Tuple");
}
function IsUndefined3(value) {
  return IsKindOf(value, "Undefined");
}
function IsUnion(value) {
  return IsKindOf(value, "Union");
}
function IsUint8Array3(value) {
  return IsKindOf(value, "Uint8Array");
}
function IsUnknown(value) {
  return IsKindOf(value, "Unknown");
}
function IsUnsafe(value) {
  return IsKindOf(value, "Unsafe");
}
function IsVoid(value) {
  return IsKindOf(value, "Void");
}
function IsKind(value) {
  return IsObject2(value) && Kind in value && IsString2(value[Kind]);
}
function IsSchema(value) {
  return IsAny(value) || IsArgument(value) || IsArray3(value) || IsBoolean3(value) || IsBigInt3(value) || IsAsyncIterator2(value) || IsComputed(value) || IsConstructor(value) || IsDate3(value) || IsFunction2(value) || IsInteger2(value) || IsIntersect(value) || IsIterator2(value) || IsLiteral(value) || IsMappedKey(value) || IsMappedResult(value) || IsNever(value) || IsNot(value) || IsNull2(value) || IsNumber3(value) || IsObject3(value) || IsPromise2(value) || IsRecord(value) || IsRef(value) || IsRegExp2(value) || IsString3(value) || IsSymbol2(value) || IsTemplateLiteral(value) || IsThis(value) || IsTuple(value) || IsUndefined3(value) || IsUnion(value) || IsUint8Array3(value) || IsUnknown(value) || IsUnsafe(value) || IsVoid(value) || IsKind(value);
}

// node_modules/@sinclair/typebox/build/esm/type/optional/optional.mjs
function RemoveOptional(schema) {
  return CreateType(Discard(schema, [OptionalKind]));
}
function AddOptional(schema) {
  return CreateType({ ...schema, [OptionalKind]: "Optional" });
}
function OptionalWithFlag(schema, F) {
  return F === false ? RemoveOptional(schema) : AddOptional(schema);
}
function Optional(schema, enable) {
  const F = enable ?? true;
  return IsMappedResult(schema) ? OptionalFromMappedResult(schema, F) : OptionalWithFlag(schema, F);
}

// node_modules/@sinclair/typebox/build/esm/type/optional/optional-from-mapped-result.mjs
function FromProperties(P, F) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Optional(P[K2], F);
  return Acc;
}
function FromMappedResult(R, F) {
  return FromProperties(R.properties, F);
}
function OptionalFromMappedResult(R, F) {
  const P = FromMappedResult(R, F);
  return MappedResult(P);
}

// node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-create.mjs
function IntersectCreate(T, options = {}) {
  const allObjects = T.every((schema) => IsObject3(schema));
  const clonedUnevaluatedProperties = IsSchema(options.unevaluatedProperties) ? { unevaluatedProperties: options.unevaluatedProperties } : {};
  return CreateType(options.unevaluatedProperties === false || IsSchema(options.unevaluatedProperties) || allObjects ? { ...clonedUnevaluatedProperties, [Kind]: "Intersect", type: "object", allOf: T } : { ...clonedUnevaluatedProperties, [Kind]: "Intersect", allOf: T }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-evaluated.mjs
function IsIntersectOptional(types) {
  return types.every((left) => IsOptional(left));
}
function RemoveOptionalFromType(type) {
  return Discard(type, [OptionalKind]);
}
function RemoveOptionalFromRest(types) {
  return types.map((left) => IsOptional(left) ? RemoveOptionalFromType(left) : left);
}
function ResolveIntersect(types, options) {
  return IsIntersectOptional(types) ? Optional(IntersectCreate(RemoveOptionalFromRest(types), options)) : IntersectCreate(RemoveOptionalFromRest(types), options);
}
function IntersectEvaluated(types, options = {}) {
  if (types.length === 1)
    return CreateType(types[0], options);
  if (types.length === 0)
    return Never(options);
  if (types.some((schema) => IsTransform(schema)))
    throw new Error("Cannot intersect transform types");
  return ResolveIntersect(types, options);
}

// node_modules/@sinclair/typebox/build/esm/type/union/union-create.mjs
function UnionCreate(T, options) {
  return CreateType({ [Kind]: "Union", anyOf: T }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/union/union-evaluated.mjs
function IsUnionOptional(types) {
  return types.some((type) => IsOptional(type));
}
function RemoveOptionalFromRest2(types) {
  return types.map((left) => IsOptional(left) ? RemoveOptionalFromType2(left) : left);
}
function RemoveOptionalFromType2(T) {
  return Discard(T, [OptionalKind]);
}
function ResolveUnion(types, options) {
  const isOptional = IsUnionOptional(types);
  return isOptional ? Optional(UnionCreate(RemoveOptionalFromRest2(types), options)) : UnionCreate(RemoveOptionalFromRest2(types), options);
}
function UnionEvaluated(T, options) {
  return T.length === 1 ? CreateType(T[0], options) : T.length === 0 ? Never(options) : ResolveUnion(T, options);
}

// node_modules/@sinclair/typebox/build/esm/type/union/union.mjs
function Union(types, options) {
  return types.length === 0 ? Never(options) : types.length === 1 ? CreateType(types[0], options) : UnionCreate(types, options);
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/parse.mjs
var TemplateLiteralParserError = class extends TypeBoxError {
};
function Unescape(pattern) {
  return pattern.replace(/\\\$/g, "$").replace(/\\\*/g, "*").replace(/\\\^/g, "^").replace(/\\\|/g, "|").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}
function IsNonEscaped(pattern, index, char) {
  return pattern[index] === char && pattern.charCodeAt(index - 1) !== 92;
}
function IsOpenParen(pattern, index) {
  return IsNonEscaped(pattern, index, "(");
}
function IsCloseParen(pattern, index) {
  return IsNonEscaped(pattern, index, ")");
}
function IsSeparator(pattern, index) {
  return IsNonEscaped(pattern, index, "|");
}
function IsGroup(pattern) {
  if (!(IsOpenParen(pattern, 0) && IsCloseParen(pattern, pattern.length - 1)))
    return false;
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (count === 0 && index !== pattern.length - 1)
      return false;
  }
  return true;
}
function InGroup(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function IsPrecedenceOr(pattern) {
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (IsSeparator(pattern, index) && count === 0)
      return true;
  }
  return false;
}
function IsPrecedenceAnd(pattern) {
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      return true;
  }
  return false;
}
function Or(pattern) {
  let [count, start] = [0, 0];
  const expressions = [];
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index))
      count += 1;
    if (IsCloseParen(pattern, index))
      count -= 1;
    if (IsSeparator(pattern, index) && count === 0) {
      const range2 = pattern.slice(start, index);
      if (range2.length > 0)
        expressions.push(TemplateLiteralParse(range2));
      start = index + 1;
    }
  }
  const range = pattern.slice(start);
  if (range.length > 0)
    expressions.push(TemplateLiteralParse(range));
  if (expressions.length === 0)
    return { type: "const", const: "" };
  if (expressions.length === 1)
    return expressions[0];
  return { type: "or", expr: expressions };
}
function And(pattern) {
  function Group(value, index) {
    if (!IsOpenParen(value, index))
      throw new TemplateLiteralParserError(`TemplateLiteralParser: Index must point to open parens`);
    let count = 0;
    for (let scan = index; scan < value.length; scan++) {
      if (IsOpenParen(value, scan))
        count += 1;
      if (IsCloseParen(value, scan))
        count -= 1;
      if (count === 0)
        return [index, scan];
    }
    throw new TemplateLiteralParserError(`TemplateLiteralParser: Unclosed group parens in expression`);
  }
  function Range(pattern2, index) {
    for (let scan = index; scan < pattern2.length; scan++) {
      if (IsOpenParen(pattern2, scan))
        return [index, scan];
    }
    return [index, pattern2.length];
  }
  const expressions = [];
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen(pattern, index)) {
      const [start, end] = Group(pattern, index);
      const range = pattern.slice(start, end + 1);
      expressions.push(TemplateLiteralParse(range));
      index = end;
    } else {
      const [start, end] = Range(pattern, index);
      const range = pattern.slice(start, end);
      if (range.length > 0)
        expressions.push(TemplateLiteralParse(range));
      index = end - 1;
    }
  }
  return expressions.length === 0 ? { type: "const", const: "" } : expressions.length === 1 ? expressions[0] : { type: "and", expr: expressions };
}
function TemplateLiteralParse(pattern) {
  return IsGroup(pattern) ? TemplateLiteralParse(InGroup(pattern)) : IsPrecedenceOr(pattern) ? Or(pattern) : IsPrecedenceAnd(pattern) ? And(pattern) : { type: "const", const: Unescape(pattern) };
}
function TemplateLiteralParseExact(pattern) {
  return TemplateLiteralParse(pattern.slice(1, pattern.length - 1));
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/finite.mjs
var TemplateLiteralFiniteError = class extends TypeBoxError {
};
function IsNumberExpression(expression) {
  return expression.type === "or" && expression.expr.length === 2 && expression.expr[0].type === "const" && expression.expr[0].const === "0" && expression.expr[1].type === "const" && expression.expr[1].const === "[1-9][0-9]*";
}
function IsBooleanExpression(expression) {
  return expression.type === "or" && expression.expr.length === 2 && expression.expr[0].type === "const" && expression.expr[0].const === "true" && expression.expr[1].type === "const" && expression.expr[1].const === "false";
}
function IsStringExpression(expression) {
  return expression.type === "const" && expression.const === ".*";
}
function IsTemplateLiteralExpressionFinite(expression) {
  return IsNumberExpression(expression) || IsStringExpression(expression) ? false : IsBooleanExpression(expression) ? true : expression.type === "and" ? expression.expr.every((expr) => IsTemplateLiteralExpressionFinite(expr)) : expression.type === "or" ? expression.expr.every((expr) => IsTemplateLiteralExpressionFinite(expr)) : expression.type === "const" ? true : (() => {
    throw new TemplateLiteralFiniteError(`Unknown expression type`);
  })();
}
function IsTemplateLiteralFinite(schema) {
  const expression = TemplateLiteralParseExact(schema.pattern);
  return IsTemplateLiteralExpressionFinite(expression);
}

// node_modules/@sinclair/typebox/build/esm/type/template-literal/generate.mjs
var TemplateLiteralGenerateError = class extends TypeBoxError {
};
function* GenerateReduce(buffer) {
  if (buffer.length === 1)
    return yield* buffer[0];
  for (const left of buffer[0]) {
    for (const right of GenerateReduce(buffer.slice(1))) {
      yield `${left}${right}`;
    }
  }
}
function* GenerateAnd(expression) {
  return yield* GenerateReduce(expression.expr.map((expr) => [...TemplateLiteralExpressionGenerate(expr)]));
}
function* GenerateOr(expression) {
  for (const expr of expression.expr)
    yield* TemplateLiteralExpressionGenerate(expr);
}
function* GenerateConst(expression) {
  return yield expression.const;
}
function* TemplateLiteralExpressionGenerate(expression) {
  return expression.type === "and" ? yield* GenerateAnd(expression) : expression.type === "or" ? yield* GenerateOr(expression) : expression.type === "const" ? yield* GenerateConst(expression) : (() => {
    throw new TemplateLiteralGenerateError("Unknown expression");
  })();
}
function TemplateLiteralGenerate(schema) {
  const expression = TemplateLiteralParseExact(schema.pattern);
  return IsTemplateLiteralExpressionFinite(expression) ? [...TemplateLiteralExpressionGenerate(expression)] : [];
}

// node_modules/@sinclair/typebox/build/esm/type/literal/literal.mjs
function Literal(value, options) {
  return CreateType({
    [Kind]: "Literal",
    const: value,
    type: typeof value
  }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/string/string.mjs
function String2(options) {
  return CreateType({ [Kind]: "String", type: "string" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/indexed/indexed.mjs
function FromRest(types, key) {
  return types.map((type) => IndexFromPropertyKey(type, key));
}
function FromIntersectRest(types) {
  return types.filter((type) => !IsNever(type));
}
function FromIntersect(types, key) {
  return IntersectEvaluated(FromIntersectRest(FromRest(types, key)));
}
function FromUnionRest(types) {
  return types.some((L) => IsNever(L)) ? [] : types;
}
function FromUnion(types, key) {
  return UnionEvaluated(FromUnionRest(FromRest(types, key)));
}
function FromTuple(types, key) {
  return key in types ? types[key] : key === "[number]" ? UnionEvaluated(types) : Never();
}
function FromArray(type, key) {
  return key === "[number]" ? type : Never();
}
function FromProperty(properties, propertyKey) {
  return propertyKey in properties ? properties[propertyKey] : Never();
}
function IndexFromPropertyKey(type, propertyKey) {
  return IsIntersect(type) ? FromIntersect(type.allOf, propertyKey) : IsUnion(type) ? FromUnion(type.anyOf, propertyKey) : IsTuple(type) ? FromTuple(type.items ?? [], propertyKey) : IsArray3(type) ? FromArray(type.items, propertyKey) : IsObject3(type) ? FromProperty(type.properties, propertyKey) : Never();
}
function IndexFromPropertyKeys(type, propertyKeys) {
  return propertyKeys.map((propertyKey) => IndexFromPropertyKey(type, propertyKey));
}

// node_modules/@sinclair/typebox/build/esm/type/object/object.mjs
function RequiredArray(properties) {
  return globalThis.Object.keys(properties).filter((key) => !IsOptional(properties[key]));
}
function _Object(properties, options) {
  const required2 = RequiredArray(properties);
  const schema = required2.length > 0 ? { [Kind]: "Object", type: "object", required: required2, properties } : { [Kind]: "Object", type: "object", properties };
  return CreateType(schema, options);
}
var Object2 = _Object;

// node_modules/@sinclair/typebox/build/esm/type/sets/set.mjs
function SetIntersect(T, S) {
  return T.filter((L) => S.includes(L));
}
function SetIntersectManyResolve(T, Init) {
  return T.reduce((Acc, L) => {
    return SetIntersect(Acc, L);
  }, Init);
}
function SetIntersectMany(T) {
  return T.length === 1 ? T[0] : T.length > 1 ? SetIntersectManyResolve(T.slice(1), T[0]) : [];
}
function SetUnionMany(T) {
  const Acc = [];
  for (const L of T)
    Acc.push(...L);
  return Acc;
}

// node_modules/@sinclair/typebox/build/esm/type/ref/ref.mjs
function Ref(...args) {
  const [$ref, options] = typeof args[0] === "string" ? [args[0], args[1]] : [args[0].$id, args[1]];
  if (typeof $ref !== "string")
    throw new TypeBoxError("Ref: $ref must be a string");
  return CreateType({ [Kind]: "Ref", $ref }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-property-keys.mjs
function FromRest2(types) {
  const result = [];
  for (const L of types)
    result.push(KeyOfPropertyKeys(L));
  return result;
}
function FromIntersect2(types) {
  const propertyKeysArray = FromRest2(types);
  const propertyKeys = SetUnionMany(propertyKeysArray);
  return propertyKeys;
}
function FromUnion2(types) {
  const propertyKeysArray = FromRest2(types);
  const propertyKeys = SetIntersectMany(propertyKeysArray);
  return propertyKeys;
}
function FromTuple2(types) {
  return types.map((_, indexer) => indexer.toString());
}
function FromArray2(_) {
  return ["[number]"];
}
function FromProperties2(T) {
  return globalThis.Object.getOwnPropertyNames(T);
}
function FromPatternProperties(patternProperties) {
  if (!includePatternProperties)
    return [];
  const patternPropertyKeys = globalThis.Object.getOwnPropertyNames(patternProperties);
  return patternPropertyKeys.map((key) => {
    return key[0] === "^" && key[key.length - 1] === "$" ? key.slice(1, key.length - 1) : key;
  });
}
function KeyOfPropertyKeys(type) {
  return IsIntersect(type) ? FromIntersect2(type.allOf) : IsUnion(type) ? FromUnion2(type.anyOf) : IsTuple(type) ? FromTuple2(type.items ?? []) : IsArray3(type) ? FromArray2(type.items) : IsObject3(type) ? FromProperties2(type.properties) : IsRecord(type) ? FromPatternProperties(type.patternProperties) : [];
}
var includePatternProperties = false;
function KeyOfPattern(schema) {
  includePatternProperties = true;
  const keys = KeyOfPropertyKeys(schema);
  includePatternProperties = false;
  const pattern = keys.map((key) => `(${key})`);
  return `^(${pattern.join("|")})$`;
}

// node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-property-entries.mjs
function KeyOfPropertyEntries(schema) {
  const keys = KeyOfPropertyKeys(schema);
  const schemas = IndexFromPropertyKeys(schema, keys);
  return keys.map((_, index) => [keys[index], schemas[index]]);
}

// node_modules/@sinclair/typebox/build/esm/type/extends/extends-undefined.mjs
function Intersect(schema) {
  return schema.allOf.every((schema2) => ExtendsUndefinedCheck(schema2));
}
function Union2(schema) {
  return schema.anyOf.some((schema2) => ExtendsUndefinedCheck(schema2));
}
function Not(schema) {
  return !ExtendsUndefinedCheck(schema.not);
}
function ExtendsUndefinedCheck(schema) {
  return schema[Kind] === "Intersect" ? Intersect(schema) : schema[Kind] === "Union" ? Union2(schema) : schema[Kind] === "Not" ? Not(schema) : schema[Kind] === "Undefined" ? true : false;
}

// node_modules/@sinclair/typebox/build/esm/errors/function.mjs
function DefaultErrorFunction(error) {
  switch (error.errorType) {
    case ValueErrorType.ArrayContains:
      return "Expected array to contain at least one matching value";
    case ValueErrorType.ArrayMaxContains:
      return `Expected array to contain no more than ${error.schema.maxContains} matching values`;
    case ValueErrorType.ArrayMinContains:
      return `Expected array to contain at least ${error.schema.minContains} matching values`;
    case ValueErrorType.ArrayMaxItems:
      return `Expected array length to be less or equal to ${error.schema.maxItems}`;
    case ValueErrorType.ArrayMinItems:
      return `Expected array length to be greater or equal to ${error.schema.minItems}`;
    case ValueErrorType.ArrayUniqueItems:
      return "Expected array elements to be unique";
    case ValueErrorType.Array:
      return "Expected array";
    case ValueErrorType.AsyncIterator:
      return "Expected AsyncIterator";
    case ValueErrorType.BigIntExclusiveMaximum:
      return `Expected bigint to be less than ${error.schema.exclusiveMaximum}`;
    case ValueErrorType.BigIntExclusiveMinimum:
      return `Expected bigint to be greater than ${error.schema.exclusiveMinimum}`;
    case ValueErrorType.BigIntMaximum:
      return `Expected bigint to be less or equal to ${error.schema.maximum}`;
    case ValueErrorType.BigIntMinimum:
      return `Expected bigint to be greater or equal to ${error.schema.minimum}`;
    case ValueErrorType.BigIntMultipleOf:
      return `Expected bigint to be a multiple of ${error.schema.multipleOf}`;
    case ValueErrorType.BigInt:
      return "Expected bigint";
    case ValueErrorType.Boolean:
      return "Expected boolean";
    case ValueErrorType.DateExclusiveMinimumTimestamp:
      return `Expected Date timestamp to be greater than ${error.schema.exclusiveMinimumTimestamp}`;
    case ValueErrorType.DateExclusiveMaximumTimestamp:
      return `Expected Date timestamp to be less than ${error.schema.exclusiveMaximumTimestamp}`;
    case ValueErrorType.DateMinimumTimestamp:
      return `Expected Date timestamp to be greater or equal to ${error.schema.minimumTimestamp}`;
    case ValueErrorType.DateMaximumTimestamp:
      return `Expected Date timestamp to be less or equal to ${error.schema.maximumTimestamp}`;
    case ValueErrorType.DateMultipleOfTimestamp:
      return `Expected Date timestamp to be a multiple of ${error.schema.multipleOfTimestamp}`;
    case ValueErrorType.Date:
      return "Expected Date";
    case ValueErrorType.Function:
      return "Expected function";
    case ValueErrorType.IntegerExclusiveMaximum:
      return `Expected integer to be less than ${error.schema.exclusiveMaximum}`;
    case ValueErrorType.IntegerExclusiveMinimum:
      return `Expected integer to be greater than ${error.schema.exclusiveMinimum}`;
    case ValueErrorType.IntegerMaximum:
      return `Expected integer to be less or equal to ${error.schema.maximum}`;
    case ValueErrorType.IntegerMinimum:
      return `Expected integer to be greater or equal to ${error.schema.minimum}`;
    case ValueErrorType.IntegerMultipleOf:
      return `Expected integer to be a multiple of ${error.schema.multipleOf}`;
    case ValueErrorType.Integer:
      return "Expected integer";
    case ValueErrorType.IntersectUnevaluatedProperties:
      return "Unexpected property";
    case ValueErrorType.Intersect:
      return "Expected all values to match";
    case ValueErrorType.Iterator:
      return "Expected Iterator";
    case ValueErrorType.Literal:
      return `Expected ${typeof error.schema.const === "string" ? `'${error.schema.const}'` : error.schema.const}`;
    case ValueErrorType.Never:
      return "Never";
    case ValueErrorType.Not:
      return "Value should not match";
    case ValueErrorType.Null:
      return "Expected null";
    case ValueErrorType.NumberExclusiveMaximum:
      return `Expected number to be less than ${error.schema.exclusiveMaximum}`;
    case ValueErrorType.NumberExclusiveMinimum:
      return `Expected number to be greater than ${error.schema.exclusiveMinimum}`;
    case ValueErrorType.NumberMaximum:
      return `Expected number to be less or equal to ${error.schema.maximum}`;
    case ValueErrorType.NumberMinimum:
      return `Expected number to be greater or equal to ${error.schema.minimum}`;
    case ValueErrorType.NumberMultipleOf:
      return `Expected number to be a multiple of ${error.schema.multipleOf}`;
    case ValueErrorType.Number:
      return "Expected number";
    case ValueErrorType.Object:
      return "Expected object";
    case ValueErrorType.ObjectAdditionalProperties:
      return "Unexpected property";
    case ValueErrorType.ObjectMaxProperties:
      return `Expected object to have no more than ${error.schema.maxProperties} properties`;
    case ValueErrorType.ObjectMinProperties:
      return `Expected object to have at least ${error.schema.minProperties} properties`;
    case ValueErrorType.ObjectRequiredProperty:
      return "Expected required property";
    case ValueErrorType.Promise:
      return "Expected Promise";
    case ValueErrorType.RegExp:
      return "Expected string to match regular expression";
    case ValueErrorType.StringFormatUnknown:
      return `Unknown format '${error.schema.format}'`;
    case ValueErrorType.StringFormat:
      return `Expected string to match '${error.schema.format}' format`;
    case ValueErrorType.StringMaxLength:
      return `Expected string length less or equal to ${error.schema.maxLength}`;
    case ValueErrorType.StringMinLength:
      return `Expected string length greater or equal to ${error.schema.minLength}`;
    case ValueErrorType.StringPattern:
      return `Expected string to match '${error.schema.pattern}'`;
    case ValueErrorType.String:
      return "Expected string";
    case ValueErrorType.Symbol:
      return "Expected symbol";
    case ValueErrorType.TupleLength:
      return `Expected tuple to have ${error.schema.maxItems || 0} elements`;
    case ValueErrorType.Tuple:
      return "Expected tuple";
    case ValueErrorType.Uint8ArrayMaxByteLength:
      return `Expected byte length less or equal to ${error.schema.maxByteLength}`;
    case ValueErrorType.Uint8ArrayMinByteLength:
      return `Expected byte length greater or equal to ${error.schema.minByteLength}`;
    case ValueErrorType.Uint8Array:
      return "Expected Uint8Array";
    case ValueErrorType.Undefined:
      return "Expected undefined";
    case ValueErrorType.Union:
      return "Expected union value";
    case ValueErrorType.Void:
      return "Expected void";
    case ValueErrorType.Kind:
      return `Expected kind '${error.schema[Kind]}'`;
    default:
      return "Unknown error type";
  }
}
var errorFunction = DefaultErrorFunction;
function GetErrorFunction() {
  return errorFunction;
}

// node_modules/@sinclair/typebox/build/esm/value/deref/deref.mjs
var TypeDereferenceError = class extends TypeBoxError {
  constructor(schema) {
    super(`Unable to dereference schema with $id '${schema.$ref}'`);
    this.schema = schema;
  }
};
function Resolve(schema, references) {
  const target = references.find((target2) => target2.$id === schema.$ref);
  if (target === void 0)
    throw new TypeDereferenceError(schema);
  return Deref(target, references);
}
function Pushref(schema, references) {
  if (!IsString(schema.$id) || references.some((target) => target.$id === schema.$id))
    return references;
  references.push(schema);
  return references;
}
function Deref(schema, references) {
  return schema[Kind] === "This" || schema[Kind] === "Ref" ? Resolve(schema, references) : schema;
}

// node_modules/@sinclair/typebox/build/esm/value/hash/hash.mjs
var ValueHashError = class extends TypeBoxError {
  constructor(value) {
    super(`Unable to hash value`);
    this.value = value;
  }
};
var ByteMarker;
(function(ByteMarker2) {
  ByteMarker2[ByteMarker2["Undefined"] = 0] = "Undefined";
  ByteMarker2[ByteMarker2["Null"] = 1] = "Null";
  ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
  ByteMarker2[ByteMarker2["Number"] = 3] = "Number";
  ByteMarker2[ByteMarker2["String"] = 4] = "String";
  ByteMarker2[ByteMarker2["Object"] = 5] = "Object";
  ByteMarker2[ByteMarker2["Array"] = 6] = "Array";
  ByteMarker2[ByteMarker2["Date"] = 7] = "Date";
  ByteMarker2[ByteMarker2["Uint8Array"] = 8] = "Uint8Array";
  ByteMarker2[ByteMarker2["Symbol"] = 9] = "Symbol";
  ByteMarker2[ByteMarker2["BigInt"] = 10] = "BigInt";
})(ByteMarker || (ByteMarker = {}));
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt(
  "18446744073709551616"
  /* 2 ^ 64 */
)];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
function* NumberToBytes(value) {
  const byteCount = value === 0 ? 1 : Math.ceil(Math.floor(Math.log2(value) + 1) / 8);
  for (let i = 0; i < byteCount; i++) {
    yield value >> 8 * (byteCount - 1 - i) & 255;
  }
}
function ArrayType2(value) {
  FNV1A64(ByteMarker.Array);
  for (const item of value) {
    Visit2(item);
  }
}
function BooleanType(value) {
  FNV1A64(ByteMarker.Boolean);
  FNV1A64(value ? 1 : 0);
}
function BigIntType(value) {
  FNV1A64(ByteMarker.BigInt);
  F64In.setBigInt64(0, value);
  for (const byte of F64Out) {
    FNV1A64(byte);
  }
}
function DateType2(value) {
  FNV1A64(ByteMarker.Date);
  Visit2(value.getTime());
}
function NullType(value) {
  FNV1A64(ByteMarker.Null);
}
function NumberType(value) {
  FNV1A64(ByteMarker.Number);
  F64In.setFloat64(0, value);
  for (const byte of F64Out) {
    FNV1A64(byte);
  }
}
function ObjectType2(value) {
  FNV1A64(ByteMarker.Object);
  for (const key of globalThis.Object.getOwnPropertyNames(value).sort()) {
    Visit2(key);
    Visit2(value[key]);
  }
}
function StringType(value) {
  FNV1A64(ByteMarker.String);
  for (let i = 0; i < value.length; i++) {
    for (const byte of NumberToBytes(value.charCodeAt(i))) {
      FNV1A64(byte);
    }
  }
}
function SymbolType(value) {
  FNV1A64(ByteMarker.Symbol);
  Visit2(value.description);
}
function Uint8ArrayType2(value) {
  FNV1A64(ByteMarker.Uint8Array);
  for (let i = 0; i < value.length; i++) {
    FNV1A64(value[i]);
  }
}
function UndefinedType(value) {
  return FNV1A64(ByteMarker.Undefined);
}
function Visit2(value) {
  if (IsArray(value))
    return ArrayType2(value);
  if (IsBoolean(value))
    return BooleanType(value);
  if (IsBigInt(value))
    return BigIntType(value);
  if (IsDate(value))
    return DateType2(value);
  if (IsNull(value))
    return NullType(value);
  if (IsNumber(value))
    return NumberType(value);
  if (IsObject(value))
    return ObjectType2(value);
  if (IsString(value))
    return StringType(value);
  if (IsSymbol(value))
    return SymbolType(value);
  if (IsUint8Array(value))
    return Uint8ArrayType2(value);
  if (IsUndefined(value))
    return UndefinedType(value);
  throw new ValueHashError(value);
}
function FNV1A64(byte) {
  Accumulator = Accumulator ^ Bytes[byte];
  Accumulator = Accumulator * Prime % Size;
}
function Hash(value) {
  Accumulator = BigInt("14695981039346656037");
  Visit2(value);
  return Accumulator;
}

// node_modules/@sinclair/typebox/build/esm/type/unknown/unknown.mjs
function Unknown(options) {
  return CreateType({ [Kind]: "Unknown" }, options);
}

// node_modules/@sinclair/typebox/build/esm/type/guard/type.mjs
var KnownTypes = [
  "Argument",
  "Any",
  "Array",
  "AsyncIterator",
  "BigInt",
  "Boolean",
  "Computed",
  "Constructor",
  "Date",
  "Enum",
  "Function",
  "Integer",
  "Intersect",
  "Iterator",
  "Literal",
  "MappedKey",
  "MappedResult",
  "Not",
  "Null",
  "Number",
  "Object",
  "Promise",
  "Record",
  "Ref",
  "RegExp",
  "String",
  "Symbol",
  "TemplateLiteral",
  "This",
  "Tuple",
  "Undefined",
  "Union",
  "Uint8Array",
  "Unknown",
  "Void"
];
function IsPattern(value) {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}
function IsControlCharacterFree(value) {
  if (!IsString2(value))
    return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 7 && code <= 13 || code === 27 || code === 127) {
      return false;
    }
  }
  return true;
}
function IsAdditionalProperties(value) {
  return IsOptionalBoolean(value) || IsSchema2(value);
}
function IsOptionalBigInt(value) {
  return IsUndefined2(value) || IsBigInt2(value);
}
function IsOptionalNumber(value) {
  return IsUndefined2(value) || IsNumber2(value);
}
function IsOptionalBoolean(value) {
  return IsUndefined2(value) || IsBoolean2(value);
}
function IsOptionalString(value) {
  return IsUndefined2(value) || IsString2(value);
}
function IsOptionalPattern(value) {
  return IsUndefined2(value) || IsString2(value) && IsControlCharacterFree(value) && IsPattern(value);
}
function IsOptionalFormat(value) {
  return IsUndefined2(value) || IsString2(value) && IsControlCharacterFree(value);
}
function IsOptionalSchema(value) {
  return IsUndefined2(value) || IsSchema2(value);
}
function IsAny2(value) {
  return IsKindOf2(value, "Any") && IsOptionalString(value.$id);
}
function IsArgument2(value) {
  return IsKindOf2(value, "Argument") && IsNumber2(value.index);
}
function IsArray4(value) {
  return IsKindOf2(value, "Array") && value.type === "array" && IsOptionalString(value.$id) && IsSchema2(value.items) && IsOptionalNumber(value.minItems) && IsOptionalNumber(value.maxItems) && IsOptionalBoolean(value.uniqueItems) && IsOptionalSchema(value.contains) && IsOptionalNumber(value.minContains) && IsOptionalNumber(value.maxContains);
}
function IsAsyncIterator3(value) {
  return IsKindOf2(value, "AsyncIterator") && value.type === "AsyncIterator" && IsOptionalString(value.$id) && IsSchema2(value.items);
}
function IsBigInt4(value) {
  return IsKindOf2(value, "BigInt") && value.type === "bigint" && IsOptionalString(value.$id) && IsOptionalBigInt(value.exclusiveMaximum) && IsOptionalBigInt(value.exclusiveMinimum) && IsOptionalBigInt(value.maximum) && IsOptionalBigInt(value.minimum) && IsOptionalBigInt(value.multipleOf);
}
function IsBoolean4(value) {
  return IsKindOf2(value, "Boolean") && value.type === "boolean" && IsOptionalString(value.$id);
}
function IsComputed2(value) {
  return IsKindOf2(value, "Computed") && IsString2(value.target) && IsArray2(value.parameters) && value.parameters.every((schema) => IsSchema2(schema));
}
function IsConstructor2(value) {
  return IsKindOf2(value, "Constructor") && value.type === "Constructor" && IsOptionalString(value.$id) && IsArray2(value.parameters) && value.parameters.every((schema) => IsSchema2(schema)) && IsSchema2(value.returns);
}
function IsDate4(value) {
  return IsKindOf2(value, "Date") && value.type === "Date" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximumTimestamp) && IsOptionalNumber(value.exclusiveMinimumTimestamp) && IsOptionalNumber(value.maximumTimestamp) && IsOptionalNumber(value.minimumTimestamp) && IsOptionalNumber(value.multipleOfTimestamp);
}
function IsFunction3(value) {
  return IsKindOf2(value, "Function") && value.type === "Function" && IsOptionalString(value.$id) && IsArray2(value.parameters) && value.parameters.every((schema) => IsSchema2(schema)) && IsSchema2(value.returns);
}
function IsInteger3(value) {
  return IsKindOf2(value, "Integer") && value.type === "integer" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximum) && IsOptionalNumber(value.exclusiveMinimum) && IsOptionalNumber(value.maximum) && IsOptionalNumber(value.minimum) && IsOptionalNumber(value.multipleOf);
}
function IsProperties(value) {
  return IsObject2(value) && Object.entries(value).every(([key, schema]) => IsControlCharacterFree(key) && IsSchema2(schema));
}
function IsIntersect2(value) {
  return IsKindOf2(value, "Intersect") && (IsString2(value.type) && value.type !== "object" ? false : true) && IsArray2(value.allOf) && value.allOf.every((schema) => IsSchema2(schema) && !IsTransform2(schema)) && IsOptionalString(value.type) && (IsOptionalBoolean(value.unevaluatedProperties) || IsOptionalSchema(value.unevaluatedProperties)) && IsOptionalString(value.$id);
}
function IsIterator3(value) {
  return IsKindOf2(value, "Iterator") && value.type === "Iterator" && IsOptionalString(value.$id) && IsSchema2(value.items);
}
function IsKindOf2(value, kind) {
  return IsObject2(value) && Kind in value && value[Kind] === kind;
}
function IsLiteral2(value) {
  return IsKindOf2(value, "Literal") && IsOptionalString(value.$id) && IsLiteralValue(value.const);
}
function IsLiteralValue(value) {
  return IsBoolean2(value) || IsNumber2(value) || IsString2(value);
}
function IsMappedKey2(value) {
  return IsKindOf2(value, "MappedKey") && IsArray2(value.keys) && value.keys.every((key) => IsNumber2(key) || IsString2(key));
}
function IsMappedResult2(value) {
  return IsKindOf2(value, "MappedResult") && IsProperties(value.properties);
}
function IsNever2(value) {
  return IsKindOf2(value, "Never") && IsObject2(value.not) && Object.getOwnPropertyNames(value.not).length === 0;
}
function IsNot2(value) {
  return IsKindOf2(value, "Not") && IsSchema2(value.not);
}
function IsNull3(value) {
  return IsKindOf2(value, "Null") && value.type === "null" && IsOptionalString(value.$id);
}
function IsNumber4(value) {
  return IsKindOf2(value, "Number") && value.type === "number" && IsOptionalString(value.$id) && IsOptionalNumber(value.exclusiveMaximum) && IsOptionalNumber(value.exclusiveMinimum) && IsOptionalNumber(value.maximum) && IsOptionalNumber(value.minimum) && IsOptionalNumber(value.multipleOf);
}
function IsObject4(value) {
  return IsKindOf2(value, "Object") && value.type === "object" && IsOptionalString(value.$id) && IsProperties(value.properties) && IsAdditionalProperties(value.additionalProperties) && IsOptionalNumber(value.minProperties) && IsOptionalNumber(value.maxProperties);
}
function IsPromise3(value) {
  return IsKindOf2(value, "Promise") && value.type === "Promise" && IsOptionalString(value.$id) && IsSchema2(value.item);
}
function IsRecord2(value) {
  return IsKindOf2(value, "Record") && value.type === "object" && IsOptionalString(value.$id) && IsAdditionalProperties(value.additionalProperties) && IsObject2(value.patternProperties) && ((schema) => {
    const keys = Object.getOwnPropertyNames(schema.patternProperties);
    return keys.length === 1 && IsPattern(keys[0]) && IsObject2(schema.patternProperties) && IsSchema2(schema.patternProperties[keys[0]]);
  })(value);
}
function IsRef2(value) {
  return IsKindOf2(value, "Ref") && IsOptionalString(value.$id) && IsString2(value.$ref);
}
function IsRegExp3(value) {
  return IsKindOf2(value, "RegExp") && IsOptionalString(value.$id) && IsString2(value.source) && IsString2(value.flags) && IsOptionalNumber(value.maxLength) && IsOptionalNumber(value.minLength);
}
function IsString4(value) {
  return IsKindOf2(value, "String") && value.type === "string" && IsOptionalString(value.$id) && IsOptionalNumber(value.minLength) && IsOptionalNumber(value.maxLength) && IsOptionalPattern(value.pattern) && IsOptionalFormat(value.format);
}
function IsSymbol3(value) {
  return IsKindOf2(value, "Symbol") && value.type === "symbol" && IsOptionalString(value.$id);
}
function IsTemplateLiteral2(value) {
  return IsKindOf2(value, "TemplateLiteral") && value.type === "string" && IsString2(value.pattern) && value.pattern[0] === "^" && value.pattern[value.pattern.length - 1] === "$";
}
function IsThis2(value) {
  return IsKindOf2(value, "This") && IsOptionalString(value.$id) && IsString2(value.$ref);
}
function IsTransform2(value) {
  return IsObject2(value) && TransformKind in value;
}
function IsTuple2(value) {
  return IsKindOf2(value, "Tuple") && value.type === "array" && IsOptionalString(value.$id) && IsNumber2(value.minItems) && IsNumber2(value.maxItems) && value.minItems === value.maxItems && // empty
  (IsUndefined2(value.items) && IsUndefined2(value.additionalItems) && value.minItems === 0 || IsArray2(value.items) && value.items.every((schema) => IsSchema2(schema)));
}
function IsUndefined4(value) {
  return IsKindOf2(value, "Undefined") && value.type === "undefined" && IsOptionalString(value.$id);
}
function IsUnion2(value) {
  return IsKindOf2(value, "Union") && IsOptionalString(value.$id) && IsObject2(value) && IsArray2(value.anyOf) && value.anyOf.every((schema) => IsSchema2(schema));
}
function IsUint8Array4(value) {
  return IsKindOf2(value, "Uint8Array") && value.type === "Uint8Array" && IsOptionalString(value.$id) && IsOptionalNumber(value.minByteLength) && IsOptionalNumber(value.maxByteLength);
}
function IsUnknown2(value) {
  return IsKindOf2(value, "Unknown") && IsOptionalString(value.$id);
}
function IsUnsafe2(value) {
  return IsKindOf2(value, "Unsafe");
}
function IsVoid2(value) {
  return IsKindOf2(value, "Void") && value.type === "void" && IsOptionalString(value.$id);
}
function IsKind2(value) {
  return IsObject2(value) && Kind in value && IsString2(value[Kind]) && !KnownTypes.includes(value[Kind]);
}
function IsSchema2(value) {
  return IsObject2(value) && (IsAny2(value) || IsArgument2(value) || IsArray4(value) || IsBoolean4(value) || IsBigInt4(value) || IsAsyncIterator3(value) || IsComputed2(value) || IsConstructor2(value) || IsDate4(value) || IsFunction3(value) || IsInteger3(value) || IsIntersect2(value) || IsIterator3(value) || IsLiteral2(value) || IsMappedKey2(value) || IsMappedResult2(value) || IsNever2(value) || IsNot2(value) || IsNull3(value) || IsNumber4(value) || IsObject4(value) || IsPromise3(value) || IsRecord2(value) || IsRef2(value) || IsRegExp3(value) || IsString4(value) || IsSymbol3(value) || IsTemplateLiteral2(value) || IsThis2(value) || IsTuple2(value) || IsUndefined4(value) || IsUnion2(value) || IsUint8Array4(value) || IsUnknown2(value) || IsUnsafe2(value) || IsVoid2(value) || IsKind2(value));
}

// node_modules/@sinclair/typebox/build/esm/value/check/check.mjs
var ValueCheckUnknownTypeError = class extends TypeBoxError {
  constructor(schema) {
    super(`Unknown type`);
    this.schema = schema;
  }
};
function IsAnyOrUnknown(schema) {
  return schema[Kind] === "Any" || schema[Kind] === "Unknown";
}
function IsDefined(value) {
  return value !== void 0;
}
function FromAny(schema, references, value) {
  return true;
}
function FromArgument(schema, references, value) {
  return true;
}
function FromArray3(schema, references, value) {
  if (!IsArray(value))
    return false;
  if (IsDefined(schema.minItems) && !(value.length >= schema.minItems)) {
    return false;
  }
  if (IsDefined(schema.maxItems) && !(value.length <= schema.maxItems)) {
    return false;
  }
  for (const element of value) {
    if (!Visit3(schema.items, references, element))
      return false;
  }
  if (schema.uniqueItems === true && !function() {
    const set = /* @__PURE__ */ new Set();
    for (const element of value) {
      const hashed = Hash(element);
      if (set.has(hashed)) {
        return false;
      } else {
        set.add(hashed);
      }
    }
    return true;
  }()) {
    return false;
  }
  if (!(IsDefined(schema.contains) || IsNumber(schema.minContains) || IsNumber(schema.maxContains))) {
    return true;
  }
  const containsSchema = IsDefined(schema.contains) ? schema.contains : Never();
  const containsCount = value.reduce((acc, value2) => Visit3(containsSchema, references, value2) ? acc + 1 : acc, 0);
  if (containsCount === 0) {
    return false;
  }
  if (IsNumber(schema.minContains) && containsCount < schema.minContains) {
    return false;
  }
  if (IsNumber(schema.maxContains) && containsCount > schema.maxContains) {
    return false;
  }
  return true;
}
function FromAsyncIterator(schema, references, value) {
  return IsAsyncIterator(value);
}
function FromBigInt(schema, references, value) {
  if (!IsBigInt(value))
    return false;
  if (IsDefined(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    return false;
  }
  if (IsDefined(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    return false;
  }
  if (IsDefined(schema.maximum) && !(value <= schema.maximum)) {
    return false;
  }
  if (IsDefined(schema.minimum) && !(value >= schema.minimum)) {
    return false;
  }
  if (IsDefined(schema.multipleOf) && !(value % schema.multipleOf === BigInt(0))) {
    return false;
  }
  return true;
}
function FromBoolean(schema, references, value) {
  return IsBoolean(value);
}
function FromConstructor(schema, references, value) {
  return Visit3(schema.returns, references, value.prototype);
}
function FromDate(schema, references, value) {
  if (!IsDate(value))
    return false;
  if (IsDefined(schema.exclusiveMaximumTimestamp) && !(value.getTime() < schema.exclusiveMaximumTimestamp)) {
    return false;
  }
  if (IsDefined(schema.exclusiveMinimumTimestamp) && !(value.getTime() > schema.exclusiveMinimumTimestamp)) {
    return false;
  }
  if (IsDefined(schema.maximumTimestamp) && !(value.getTime() <= schema.maximumTimestamp)) {
    return false;
  }
  if (IsDefined(schema.minimumTimestamp) && !(value.getTime() >= schema.minimumTimestamp)) {
    return false;
  }
  if (IsDefined(schema.multipleOfTimestamp) && !(value.getTime() % schema.multipleOfTimestamp === 0)) {
    return false;
  }
  return true;
}
function FromFunction(schema, references, value) {
  return IsFunction(value);
}
function FromImport(schema, references, value) {
  const definitions = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  return Visit3(target, [...references, ...definitions], value);
}
function FromInteger(schema, references, value) {
  if (!IsInteger(value)) {
    return false;
  }
  if (IsDefined(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    return false;
  }
  if (IsDefined(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    return false;
  }
  if (IsDefined(schema.maximum) && !(value <= schema.maximum)) {
    return false;
  }
  if (IsDefined(schema.minimum) && !(value >= schema.minimum)) {
    return false;
  }
  if (IsDefined(schema.multipleOf) && !(value % schema.multipleOf === 0)) {
    return false;
  }
  return true;
}
function FromIntersect3(schema, references, value) {
  const check1 = schema.allOf.every((schema2) => Visit3(schema2, references, value));
  if (schema.unevaluatedProperties === false) {
    const keyPattern = new RegExp(KeyOfPattern(schema));
    const check2 = Object.getOwnPropertyNames(value).every((key) => keyPattern.test(key));
    return check1 && check2;
  } else if (IsSchema(schema.unevaluatedProperties)) {
    const keyCheck = new RegExp(KeyOfPattern(schema));
    const check2 = Object.getOwnPropertyNames(value).every((key) => keyCheck.test(key) || Visit3(schema.unevaluatedProperties, references, value[key]));
    return check1 && check2;
  } else {
    return check1;
  }
}
function FromIterator(schema, references, value) {
  return IsIterator(value);
}
function FromLiteral(schema, references, value) {
  return value === schema.const;
}
function FromNever(schema, references, value) {
  return false;
}
function FromNot(schema, references, value) {
  return !Visit3(schema.not, references, value);
}
function FromNull(schema, references, value) {
  return IsNull(value);
}
function FromNumber(schema, references, value) {
  if (!TypeSystemPolicy.IsNumberLike(value))
    return false;
  if (IsDefined(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    return false;
  }
  if (IsDefined(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    return false;
  }
  if (IsDefined(schema.minimum) && !(value >= schema.minimum)) {
    return false;
  }
  if (IsDefined(schema.maximum) && !(value <= schema.maximum)) {
    return false;
  }
  if (IsDefined(schema.multipleOf) && !(value % schema.multipleOf === 0)) {
    return false;
  }
  return true;
}
function FromObject(schema, references, value) {
  if (!TypeSystemPolicy.IsObjectLike(value))
    return false;
  if (IsDefined(schema.minProperties) && !(Object.getOwnPropertyNames(value).length >= schema.minProperties)) {
    return false;
  }
  if (IsDefined(schema.maxProperties) && !(Object.getOwnPropertyNames(value).length <= schema.maxProperties)) {
    return false;
  }
  const knownKeys = Object.getOwnPropertyNames(schema.properties);
  for (const knownKey of knownKeys) {
    const property = schema.properties[knownKey];
    if (schema.required && schema.required.includes(knownKey)) {
      if (!Visit3(property, references, value[knownKey])) {
        return false;
      }
      if ((ExtendsUndefinedCheck(property) || IsAnyOrUnknown(property)) && !(knownKey in value)) {
        return false;
      }
    } else {
      if (TypeSystemPolicy.IsExactOptionalProperty(value, knownKey) && !Visit3(property, references, value[knownKey])) {
        return false;
      }
    }
  }
  if (schema.additionalProperties === false) {
    const valueKeys = Object.getOwnPropertyNames(value);
    if (schema.required && schema.required.length === knownKeys.length && valueKeys.length === knownKeys.length) {
      return true;
    } else {
      return valueKeys.every((valueKey) => knownKeys.includes(valueKey));
    }
  } else if (typeof schema.additionalProperties === "object") {
    const valueKeys = Object.getOwnPropertyNames(value);
    return valueKeys.every((key) => knownKeys.includes(key) || Visit3(schema.additionalProperties, references, value[key]));
  } else {
    return true;
  }
}
function FromPromise(schema, references, value) {
  return IsPromise(value);
}
function FromRecord(schema, references, value) {
  if (!TypeSystemPolicy.IsRecordLike(value)) {
    return false;
  }
  if (IsDefined(schema.minProperties) && !(Object.getOwnPropertyNames(value).length >= schema.minProperties)) {
    return false;
  }
  if (IsDefined(schema.maxProperties) && !(Object.getOwnPropertyNames(value).length <= schema.maxProperties)) {
    return false;
  }
  const [patternKey, patternSchema] = Object.entries(schema.patternProperties)[0];
  const regex = new RegExp(patternKey);
  const check1 = Object.entries(value).every(([key, value2]) => {
    return regex.test(key) ? Visit3(patternSchema, references, value2) : true;
  });
  const check2 = typeof schema.additionalProperties === "object" ? Object.entries(value).every(([key, value2]) => {
    return !regex.test(key) ? Visit3(schema.additionalProperties, references, value2) : true;
  }) : true;
  const check3 = schema.additionalProperties === false ? Object.getOwnPropertyNames(value).every((key) => {
    return regex.test(key);
  }) : true;
  return check1 && check2 && check3;
}
function FromRef(schema, references, value) {
  return Visit3(Deref(schema, references), references, value);
}
function FromRegExp(schema, references, value) {
  const regex = new RegExp(schema.source, schema.flags);
  if (IsDefined(schema.minLength)) {
    if (!(value.length >= schema.minLength))
      return false;
  }
  if (IsDefined(schema.maxLength)) {
    if (!(value.length <= schema.maxLength))
      return false;
  }
  return regex.test(value);
}
function FromString(schema, references, value) {
  if (!IsString(value)) {
    return false;
  }
  if (IsDefined(schema.minLength)) {
    if (!(value.length >= schema.minLength))
      return false;
  }
  if (IsDefined(schema.maxLength)) {
    if (!(value.length <= schema.maxLength))
      return false;
  }
  if (IsDefined(schema.pattern)) {
    const regex = new RegExp(schema.pattern);
    if (!regex.test(value))
      return false;
  }
  if (IsDefined(schema.format)) {
    if (!format_exports.Has(schema.format))
      return false;
    const func = format_exports.Get(schema.format);
    return func(value);
  }
  return true;
}
function FromSymbol(schema, references, value) {
  return IsSymbol(value);
}
function FromTemplateLiteral(schema, references, value) {
  return IsString(value) && new RegExp(schema.pattern).test(value);
}
function FromThis(schema, references, value) {
  return Visit3(Deref(schema, references), references, value);
}
function FromTuple3(schema, references, value) {
  if (!IsArray(value)) {
    return false;
  }
  if (schema.items === void 0 && !(value.length === 0)) {
    return false;
  }
  if (!(value.length === schema.maxItems)) {
    return false;
  }
  if (!schema.items) {
    return true;
  }
  for (let i = 0; i < schema.items.length; i++) {
    if (!Visit3(schema.items[i], references, value[i]))
      return false;
  }
  return true;
}
function FromUndefined(schema, references, value) {
  return IsUndefined(value);
}
function FromUnion3(schema, references, value) {
  return schema.anyOf.some((inner) => Visit3(inner, references, value));
}
function FromUint8Array(schema, references, value) {
  if (!IsUint8Array(value)) {
    return false;
  }
  if (IsDefined(schema.maxByteLength) && !(value.length <= schema.maxByteLength)) {
    return false;
  }
  if (IsDefined(schema.minByteLength) && !(value.length >= schema.minByteLength)) {
    return false;
  }
  return true;
}
function FromUnknown(schema, references, value) {
  return true;
}
function FromVoid(schema, references, value) {
  return TypeSystemPolicy.IsVoidLike(value);
}
function FromKind(schema, references, value) {
  if (!type_exports.Has(schema[Kind]))
    return false;
  const func = type_exports.Get(schema[Kind]);
  return func(schema, value);
}
function Visit3(schema, references, value) {
  const references_ = IsDefined(schema.$id) ? Pushref(schema, references) : references;
  const schema_ = schema;
  switch (schema_[Kind]) {
    case "Any":
      return FromAny(schema_, references_, value);
    case "Argument":
      return FromArgument(schema_, references_, value);
    case "Array":
      return FromArray3(schema_, references_, value);
    case "AsyncIterator":
      return FromAsyncIterator(schema_, references_, value);
    case "BigInt":
      return FromBigInt(schema_, references_, value);
    case "Boolean":
      return FromBoolean(schema_, references_, value);
    case "Constructor":
      return FromConstructor(schema_, references_, value);
    case "Date":
      return FromDate(schema_, references_, value);
    case "Function":
      return FromFunction(schema_, references_, value);
    case "Import":
      return FromImport(schema_, references_, value);
    case "Integer":
      return FromInteger(schema_, references_, value);
    case "Intersect":
      return FromIntersect3(schema_, references_, value);
    case "Iterator":
      return FromIterator(schema_, references_, value);
    case "Literal":
      return FromLiteral(schema_, references_, value);
    case "Never":
      return FromNever(schema_, references_, value);
    case "Not":
      return FromNot(schema_, references_, value);
    case "Null":
      return FromNull(schema_, references_, value);
    case "Number":
      return FromNumber(schema_, references_, value);
    case "Object":
      return FromObject(schema_, references_, value);
    case "Promise":
      return FromPromise(schema_, references_, value);
    case "Record":
      return FromRecord(schema_, references_, value);
    case "Ref":
      return FromRef(schema_, references_, value);
    case "RegExp":
      return FromRegExp(schema_, references_, value);
    case "String":
      return FromString(schema_, references_, value);
    case "Symbol":
      return FromSymbol(schema_, references_, value);
    case "TemplateLiteral":
      return FromTemplateLiteral(schema_, references_, value);
    case "This":
      return FromThis(schema_, references_, value);
    case "Tuple":
      return FromTuple3(schema_, references_, value);
    case "Undefined":
      return FromUndefined(schema_, references_, value);
    case "Union":
      return FromUnion3(schema_, references_, value);
    case "Uint8Array":
      return FromUint8Array(schema_, references_, value);
    case "Unknown":
      return FromUnknown(schema_, references_, value);
    case "Void":
      return FromVoid(schema_, references_, value);
    default:
      if (!type_exports.Has(schema_[Kind]))
        throw new ValueCheckUnknownTypeError(schema_);
      return FromKind(schema_, references_, value);
  }
}
function Check(...args) {
  return args.length === 3 ? Visit3(args[0], args[1], args[2]) : Visit3(args[0], [], args[1]);
}

// node_modules/@sinclair/typebox/build/esm/errors/errors.mjs
var ValueErrorType;
(function(ValueErrorType2) {
  ValueErrorType2[ValueErrorType2["ArrayContains"] = 0] = "ArrayContains";
  ValueErrorType2[ValueErrorType2["ArrayMaxContains"] = 1] = "ArrayMaxContains";
  ValueErrorType2[ValueErrorType2["ArrayMaxItems"] = 2] = "ArrayMaxItems";
  ValueErrorType2[ValueErrorType2["ArrayMinContains"] = 3] = "ArrayMinContains";
  ValueErrorType2[ValueErrorType2["ArrayMinItems"] = 4] = "ArrayMinItems";
  ValueErrorType2[ValueErrorType2["ArrayUniqueItems"] = 5] = "ArrayUniqueItems";
  ValueErrorType2[ValueErrorType2["Array"] = 6] = "Array";
  ValueErrorType2[ValueErrorType2["AsyncIterator"] = 7] = "AsyncIterator";
  ValueErrorType2[ValueErrorType2["BigIntExclusiveMaximum"] = 8] = "BigIntExclusiveMaximum";
  ValueErrorType2[ValueErrorType2["BigIntExclusiveMinimum"] = 9] = "BigIntExclusiveMinimum";
  ValueErrorType2[ValueErrorType2["BigIntMaximum"] = 10] = "BigIntMaximum";
  ValueErrorType2[ValueErrorType2["BigIntMinimum"] = 11] = "BigIntMinimum";
  ValueErrorType2[ValueErrorType2["BigIntMultipleOf"] = 12] = "BigIntMultipleOf";
  ValueErrorType2[ValueErrorType2["BigInt"] = 13] = "BigInt";
  ValueErrorType2[ValueErrorType2["Boolean"] = 14] = "Boolean";
  ValueErrorType2[ValueErrorType2["DateExclusiveMaximumTimestamp"] = 15] = "DateExclusiveMaximumTimestamp";
  ValueErrorType2[ValueErrorType2["DateExclusiveMinimumTimestamp"] = 16] = "DateExclusiveMinimumTimestamp";
  ValueErrorType2[ValueErrorType2["DateMaximumTimestamp"] = 17] = "DateMaximumTimestamp";
  ValueErrorType2[ValueErrorType2["DateMinimumTimestamp"] = 18] = "DateMinimumTimestamp";
  ValueErrorType2[ValueErrorType2["DateMultipleOfTimestamp"] = 19] = "DateMultipleOfTimestamp";
  ValueErrorType2[ValueErrorType2["Date"] = 20] = "Date";
  ValueErrorType2[ValueErrorType2["Function"] = 21] = "Function";
  ValueErrorType2[ValueErrorType2["IntegerExclusiveMaximum"] = 22] = "IntegerExclusiveMaximum";
  ValueErrorType2[ValueErrorType2["IntegerExclusiveMinimum"] = 23] = "IntegerExclusiveMinimum";
  ValueErrorType2[ValueErrorType2["IntegerMaximum"] = 24] = "IntegerMaximum";
  ValueErrorType2[ValueErrorType2["IntegerMinimum"] = 25] = "IntegerMinimum";
  ValueErrorType2[ValueErrorType2["IntegerMultipleOf"] = 26] = "IntegerMultipleOf";
  ValueErrorType2[ValueErrorType2["Integer"] = 27] = "Integer";
  ValueErrorType2[ValueErrorType2["IntersectUnevaluatedProperties"] = 28] = "IntersectUnevaluatedProperties";
  ValueErrorType2[ValueErrorType2["Intersect"] = 29] = "Intersect";
  ValueErrorType2[ValueErrorType2["Iterator"] = 30] = "Iterator";
  ValueErrorType2[ValueErrorType2["Kind"] = 31] = "Kind";
  ValueErrorType2[ValueErrorType2["Literal"] = 32] = "Literal";
  ValueErrorType2[ValueErrorType2["Never"] = 33] = "Never";
  ValueErrorType2[ValueErrorType2["Not"] = 34] = "Not";
  ValueErrorType2[ValueErrorType2["Null"] = 35] = "Null";
  ValueErrorType2[ValueErrorType2["NumberExclusiveMaximum"] = 36] = "NumberExclusiveMaximum";
  ValueErrorType2[ValueErrorType2["NumberExclusiveMinimum"] = 37] = "NumberExclusiveMinimum";
  ValueErrorType2[ValueErrorType2["NumberMaximum"] = 38] = "NumberMaximum";
  ValueErrorType2[ValueErrorType2["NumberMinimum"] = 39] = "NumberMinimum";
  ValueErrorType2[ValueErrorType2["NumberMultipleOf"] = 40] = "NumberMultipleOf";
  ValueErrorType2[ValueErrorType2["Number"] = 41] = "Number";
  ValueErrorType2[ValueErrorType2["ObjectAdditionalProperties"] = 42] = "ObjectAdditionalProperties";
  ValueErrorType2[ValueErrorType2["ObjectMaxProperties"] = 43] = "ObjectMaxProperties";
  ValueErrorType2[ValueErrorType2["ObjectMinProperties"] = 44] = "ObjectMinProperties";
  ValueErrorType2[ValueErrorType2["ObjectRequiredProperty"] = 45] = "ObjectRequiredProperty";
  ValueErrorType2[ValueErrorType2["Object"] = 46] = "Object";
  ValueErrorType2[ValueErrorType2["Promise"] = 47] = "Promise";
  ValueErrorType2[ValueErrorType2["RegExp"] = 48] = "RegExp";
  ValueErrorType2[ValueErrorType2["StringFormatUnknown"] = 49] = "StringFormatUnknown";
  ValueErrorType2[ValueErrorType2["StringFormat"] = 50] = "StringFormat";
  ValueErrorType2[ValueErrorType2["StringMaxLength"] = 51] = "StringMaxLength";
  ValueErrorType2[ValueErrorType2["StringMinLength"] = 52] = "StringMinLength";
  ValueErrorType2[ValueErrorType2["StringPattern"] = 53] = "StringPattern";
  ValueErrorType2[ValueErrorType2["String"] = 54] = "String";
  ValueErrorType2[ValueErrorType2["Symbol"] = 55] = "Symbol";
  ValueErrorType2[ValueErrorType2["TupleLength"] = 56] = "TupleLength";
  ValueErrorType2[ValueErrorType2["Tuple"] = 57] = "Tuple";
  ValueErrorType2[ValueErrorType2["Uint8ArrayMaxByteLength"] = 58] = "Uint8ArrayMaxByteLength";
  ValueErrorType2[ValueErrorType2["Uint8ArrayMinByteLength"] = 59] = "Uint8ArrayMinByteLength";
  ValueErrorType2[ValueErrorType2["Uint8Array"] = 60] = "Uint8Array";
  ValueErrorType2[ValueErrorType2["Undefined"] = 61] = "Undefined";
  ValueErrorType2[ValueErrorType2["Union"] = 62] = "Union";
  ValueErrorType2[ValueErrorType2["Void"] = 63] = "Void";
})(ValueErrorType || (ValueErrorType = {}));
var ValueErrorsUnknownTypeError = class extends TypeBoxError {
  constructor(schema) {
    super("Unknown type");
    this.schema = schema;
  }
};
function EscapeKey(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
function IsDefined2(value) {
  return value !== void 0;
}
var ValueErrorIterator = class {
  constructor(iterator) {
    this.iterator = iterator;
  }
  [Symbol.iterator]() {
    return this.iterator;
  }
  /** Returns the first value error or undefined if no errors */
  First() {
    const next = this.iterator.next();
    return next.done ? void 0 : next.value;
  }
};
function Create(errorType, schema, path3, value, errors = []) {
  return {
    type: errorType,
    schema,
    path: path3,
    value,
    message: GetErrorFunction()({ errorType, path: path3, schema, value, errors }),
    errors
  };
}
function* FromAny2(schema, references, path3, value) {
}
function* FromArgument2(schema, references, path3, value) {
}
function* FromArray4(schema, references, path3, value) {
  if (!IsArray(value)) {
    return yield Create(ValueErrorType.Array, schema, path3, value);
  }
  if (IsDefined2(schema.minItems) && !(value.length >= schema.minItems)) {
    yield Create(ValueErrorType.ArrayMinItems, schema, path3, value);
  }
  if (IsDefined2(schema.maxItems) && !(value.length <= schema.maxItems)) {
    yield Create(ValueErrorType.ArrayMaxItems, schema, path3, value);
  }
  for (let i = 0; i < value.length; i++) {
    yield* Visit4(schema.items, references, `${path3}/${i}`, value[i]);
  }
  if (schema.uniqueItems === true && !function() {
    const set = /* @__PURE__ */ new Set();
    for (const element of value) {
      const hashed = Hash(element);
      if (set.has(hashed)) {
        return false;
      } else {
        set.add(hashed);
      }
    }
    return true;
  }()) {
    yield Create(ValueErrorType.ArrayUniqueItems, schema, path3, value);
  }
  if (!(IsDefined2(schema.contains) || IsDefined2(schema.minContains) || IsDefined2(schema.maxContains))) {
    return;
  }
  const containsSchema = IsDefined2(schema.contains) ? schema.contains : Never();
  const containsCount = value.reduce((acc, value2, index) => Visit4(containsSchema, references, `${path3}${index}`, value2).next().done === true ? acc + 1 : acc, 0);
  if (containsCount === 0) {
    yield Create(ValueErrorType.ArrayContains, schema, path3, value);
  }
  if (IsNumber(schema.minContains) && containsCount < schema.minContains) {
    yield Create(ValueErrorType.ArrayMinContains, schema, path3, value);
  }
  if (IsNumber(schema.maxContains) && containsCount > schema.maxContains) {
    yield Create(ValueErrorType.ArrayMaxContains, schema, path3, value);
  }
}
function* FromAsyncIterator2(schema, references, path3, value) {
  if (!IsAsyncIterator(value))
    yield Create(ValueErrorType.AsyncIterator, schema, path3, value);
}
function* FromBigInt2(schema, references, path3, value) {
  if (!IsBigInt(value))
    return yield Create(ValueErrorType.BigInt, schema, path3, value);
  if (IsDefined2(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    yield Create(ValueErrorType.BigIntExclusiveMaximum, schema, path3, value);
  }
  if (IsDefined2(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    yield Create(ValueErrorType.BigIntExclusiveMinimum, schema, path3, value);
  }
  if (IsDefined2(schema.maximum) && !(value <= schema.maximum)) {
    yield Create(ValueErrorType.BigIntMaximum, schema, path3, value);
  }
  if (IsDefined2(schema.minimum) && !(value >= schema.minimum)) {
    yield Create(ValueErrorType.BigIntMinimum, schema, path3, value);
  }
  if (IsDefined2(schema.multipleOf) && !(value % schema.multipleOf === BigInt(0))) {
    yield Create(ValueErrorType.BigIntMultipleOf, schema, path3, value);
  }
}
function* FromBoolean2(schema, references, path3, value) {
  if (!IsBoolean(value))
    yield Create(ValueErrorType.Boolean, schema, path3, value);
}
function* FromConstructor2(schema, references, path3, value) {
  yield* Visit4(schema.returns, references, path3, value.prototype);
}
function* FromDate2(schema, references, path3, value) {
  if (!IsDate(value))
    return yield Create(ValueErrorType.Date, schema, path3, value);
  if (IsDefined2(schema.exclusiveMaximumTimestamp) && !(value.getTime() < schema.exclusiveMaximumTimestamp)) {
    yield Create(ValueErrorType.DateExclusiveMaximumTimestamp, schema, path3, value);
  }
  if (IsDefined2(schema.exclusiveMinimumTimestamp) && !(value.getTime() > schema.exclusiveMinimumTimestamp)) {
    yield Create(ValueErrorType.DateExclusiveMinimumTimestamp, schema, path3, value);
  }
  if (IsDefined2(schema.maximumTimestamp) && !(value.getTime() <= schema.maximumTimestamp)) {
    yield Create(ValueErrorType.DateMaximumTimestamp, schema, path3, value);
  }
  if (IsDefined2(schema.minimumTimestamp) && !(value.getTime() >= schema.minimumTimestamp)) {
    yield Create(ValueErrorType.DateMinimumTimestamp, schema, path3, value);
  }
  if (IsDefined2(schema.multipleOfTimestamp) && !(value.getTime() % schema.multipleOfTimestamp === 0)) {
    yield Create(ValueErrorType.DateMultipleOfTimestamp, schema, path3, value);
  }
}
function* FromFunction2(schema, references, path3, value) {
  if (!IsFunction(value))
    yield Create(ValueErrorType.Function, schema, path3, value);
}
function* FromImport2(schema, references, path3, value) {
  const definitions = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  yield* Visit4(target, [...references, ...definitions], path3, value);
}
function* FromInteger2(schema, references, path3, value) {
  if (!IsInteger(value))
    return yield Create(ValueErrorType.Integer, schema, path3, value);
  if (IsDefined2(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    yield Create(ValueErrorType.IntegerExclusiveMaximum, schema, path3, value);
  }
  if (IsDefined2(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    yield Create(ValueErrorType.IntegerExclusiveMinimum, schema, path3, value);
  }
  if (IsDefined2(schema.maximum) && !(value <= schema.maximum)) {
    yield Create(ValueErrorType.IntegerMaximum, schema, path3, value);
  }
  if (IsDefined2(schema.minimum) && !(value >= schema.minimum)) {
    yield Create(ValueErrorType.IntegerMinimum, schema, path3, value);
  }
  if (IsDefined2(schema.multipleOf) && !(value % schema.multipleOf === 0)) {
    yield Create(ValueErrorType.IntegerMultipleOf, schema, path3, value);
  }
}
function* FromIntersect4(schema, references, path3, value) {
  let hasError = false;
  for (const inner of schema.allOf) {
    for (const error of Visit4(inner, references, path3, value)) {
      hasError = true;
      yield error;
    }
  }
  if (hasError) {
    return yield Create(ValueErrorType.Intersect, schema, path3, value);
  }
  if (schema.unevaluatedProperties === false) {
    const keyCheck = new RegExp(KeyOfPattern(schema));
    for (const valueKey of Object.getOwnPropertyNames(value)) {
      if (!keyCheck.test(valueKey)) {
        yield Create(ValueErrorType.IntersectUnevaluatedProperties, schema, `${path3}/${valueKey}`, value);
      }
    }
  }
  if (typeof schema.unevaluatedProperties === "object") {
    const keyCheck = new RegExp(KeyOfPattern(schema));
    for (const valueKey of Object.getOwnPropertyNames(value)) {
      if (!keyCheck.test(valueKey)) {
        const next = Visit4(schema.unevaluatedProperties, references, `${path3}/${valueKey}`, value[valueKey]).next();
        if (!next.done)
          yield next.value;
      }
    }
  }
}
function* FromIterator2(schema, references, path3, value) {
  if (!IsIterator(value))
    yield Create(ValueErrorType.Iterator, schema, path3, value);
}
function* FromLiteral2(schema, references, path3, value) {
  if (!(value === schema.const))
    yield Create(ValueErrorType.Literal, schema, path3, value);
}
function* FromNever2(schema, references, path3, value) {
  yield Create(ValueErrorType.Never, schema, path3, value);
}
function* FromNot2(schema, references, path3, value) {
  if (Visit4(schema.not, references, path3, value).next().done === true)
    yield Create(ValueErrorType.Not, schema, path3, value);
}
function* FromNull2(schema, references, path3, value) {
  if (!IsNull(value))
    yield Create(ValueErrorType.Null, schema, path3, value);
}
function* FromNumber2(schema, references, path3, value) {
  if (!TypeSystemPolicy.IsNumberLike(value))
    return yield Create(ValueErrorType.Number, schema, path3, value);
  if (IsDefined2(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    yield Create(ValueErrorType.NumberExclusiveMaximum, schema, path3, value);
  }
  if (IsDefined2(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    yield Create(ValueErrorType.NumberExclusiveMinimum, schema, path3, value);
  }
  if (IsDefined2(schema.maximum) && !(value <= schema.maximum)) {
    yield Create(ValueErrorType.NumberMaximum, schema, path3, value);
  }
  if (IsDefined2(schema.minimum) && !(value >= schema.minimum)) {
    yield Create(ValueErrorType.NumberMinimum, schema, path3, value);
  }
  if (IsDefined2(schema.multipleOf) && !(value % schema.multipleOf === 0)) {
    yield Create(ValueErrorType.NumberMultipleOf, schema, path3, value);
  }
}
function* FromObject2(schema, references, path3, value) {
  if (!TypeSystemPolicy.IsObjectLike(value))
    return yield Create(ValueErrorType.Object, schema, path3, value);
  if (IsDefined2(schema.minProperties) && !(Object.getOwnPropertyNames(value).length >= schema.minProperties)) {
    yield Create(ValueErrorType.ObjectMinProperties, schema, path3, value);
  }
  if (IsDefined2(schema.maxProperties) && !(Object.getOwnPropertyNames(value).length <= schema.maxProperties)) {
    yield Create(ValueErrorType.ObjectMaxProperties, schema, path3, value);
  }
  const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
  const knownKeys = Object.getOwnPropertyNames(schema.properties);
  const unknownKeys = Object.getOwnPropertyNames(value);
  for (const requiredKey of requiredKeys) {
    if (unknownKeys.includes(requiredKey))
      continue;
    yield Create(ValueErrorType.ObjectRequiredProperty, schema.properties[requiredKey], `${path3}/${EscapeKey(requiredKey)}`, void 0);
  }
  if (schema.additionalProperties === false) {
    for (const valueKey of unknownKeys) {
      if (!knownKeys.includes(valueKey)) {
        yield Create(ValueErrorType.ObjectAdditionalProperties, schema, `${path3}/${EscapeKey(valueKey)}`, value[valueKey]);
      }
    }
  }
  if (typeof schema.additionalProperties === "object") {
    for (const valueKey of unknownKeys) {
      if (knownKeys.includes(valueKey))
        continue;
      yield* Visit4(schema.additionalProperties, references, `${path3}/${EscapeKey(valueKey)}`, value[valueKey]);
    }
  }
  for (const knownKey of knownKeys) {
    const property = schema.properties[knownKey];
    if (schema.required && schema.required.includes(knownKey)) {
      yield* Visit4(property, references, `${path3}/${EscapeKey(knownKey)}`, value[knownKey]);
      if (ExtendsUndefinedCheck(schema) && !(knownKey in value)) {
        yield Create(ValueErrorType.ObjectRequiredProperty, property, `${path3}/${EscapeKey(knownKey)}`, void 0);
      }
    } else {
      if (TypeSystemPolicy.IsExactOptionalProperty(value, knownKey)) {
        yield* Visit4(property, references, `${path3}/${EscapeKey(knownKey)}`, value[knownKey]);
      }
    }
  }
}
function* FromPromise2(schema, references, path3, value) {
  if (!IsPromise(value))
    yield Create(ValueErrorType.Promise, schema, path3, value);
}
function* FromRecord2(schema, references, path3, value) {
  if (!TypeSystemPolicy.IsRecordLike(value))
    return yield Create(ValueErrorType.Object, schema, path3, value);
  if (IsDefined2(schema.minProperties) && !(Object.getOwnPropertyNames(value).length >= schema.minProperties)) {
    yield Create(ValueErrorType.ObjectMinProperties, schema, path3, value);
  }
  if (IsDefined2(schema.maxProperties) && !(Object.getOwnPropertyNames(value).length <= schema.maxProperties)) {
    yield Create(ValueErrorType.ObjectMaxProperties, schema, path3, value);
  }
  const [patternKey, patternSchema] = Object.entries(schema.patternProperties)[0];
  const regex = new RegExp(patternKey);
  for (const [propertyKey, propertyValue] of Object.entries(value)) {
    if (regex.test(propertyKey))
      yield* Visit4(patternSchema, references, `${path3}/${EscapeKey(propertyKey)}`, propertyValue);
  }
  if (typeof schema.additionalProperties === "object") {
    for (const [propertyKey, propertyValue] of Object.entries(value)) {
      if (!regex.test(propertyKey))
        yield* Visit4(schema.additionalProperties, references, `${path3}/${EscapeKey(propertyKey)}`, propertyValue);
    }
  }
  if (schema.additionalProperties === false) {
    for (const [propertyKey, propertyValue] of Object.entries(value)) {
      if (regex.test(propertyKey))
        continue;
      return yield Create(ValueErrorType.ObjectAdditionalProperties, schema, `${path3}/${EscapeKey(propertyKey)}`, propertyValue);
    }
  }
}
function* FromRef2(schema, references, path3, value) {
  yield* Visit4(Deref(schema, references), references, path3, value);
}
function* FromRegExp2(schema, references, path3, value) {
  if (!IsString(value))
    return yield Create(ValueErrorType.String, schema, path3, value);
  if (IsDefined2(schema.minLength) && !(value.length >= schema.minLength)) {
    yield Create(ValueErrorType.StringMinLength, schema, path3, value);
  }
  if (IsDefined2(schema.maxLength) && !(value.length <= schema.maxLength)) {
    yield Create(ValueErrorType.StringMaxLength, schema, path3, value);
  }
  const regex = new RegExp(schema.source, schema.flags);
  if (!regex.test(value)) {
    return yield Create(ValueErrorType.RegExp, schema, path3, value);
  }
}
function* FromString2(schema, references, path3, value) {
  if (!IsString(value))
    return yield Create(ValueErrorType.String, schema, path3, value);
  if (IsDefined2(schema.minLength) && !(value.length >= schema.minLength)) {
    yield Create(ValueErrorType.StringMinLength, schema, path3, value);
  }
  if (IsDefined2(schema.maxLength) && !(value.length <= schema.maxLength)) {
    yield Create(ValueErrorType.StringMaxLength, schema, path3, value);
  }
  if (IsString(schema.pattern)) {
    const regex = new RegExp(schema.pattern);
    if (!regex.test(value)) {
      yield Create(ValueErrorType.StringPattern, schema, path3, value);
    }
  }
  if (IsString(schema.format)) {
    if (!format_exports.Has(schema.format)) {
      yield Create(ValueErrorType.StringFormatUnknown, schema, path3, value);
    } else {
      const format = format_exports.Get(schema.format);
      if (!format(value)) {
        yield Create(ValueErrorType.StringFormat, schema, path3, value);
      }
    }
  }
}
function* FromSymbol2(schema, references, path3, value) {
  if (!IsSymbol(value))
    yield Create(ValueErrorType.Symbol, schema, path3, value);
}
function* FromTemplateLiteral2(schema, references, path3, value) {
  if (!IsString(value))
    return yield Create(ValueErrorType.String, schema, path3, value);
  const regex = new RegExp(schema.pattern);
  if (!regex.test(value)) {
    yield Create(ValueErrorType.StringPattern, schema, path3, value);
  }
}
function* FromThis2(schema, references, path3, value) {
  yield* Visit4(Deref(schema, references), references, path3, value);
}
function* FromTuple4(schema, references, path3, value) {
  if (!IsArray(value))
    return yield Create(ValueErrorType.Tuple, schema, path3, value);
  if (schema.items === void 0 && !(value.length === 0)) {
    return yield Create(ValueErrorType.TupleLength, schema, path3, value);
  }
  if (!(value.length === schema.maxItems)) {
    return yield Create(ValueErrorType.TupleLength, schema, path3, value);
  }
  if (!schema.items) {
    return;
  }
  for (let i = 0; i < schema.items.length; i++) {
    yield* Visit4(schema.items[i], references, `${path3}/${i}`, value[i]);
  }
}
function* FromUndefined2(schema, references, path3, value) {
  if (!IsUndefined(value))
    yield Create(ValueErrorType.Undefined, schema, path3, value);
}
function* FromUnion4(schema, references, path3, value) {
  if (Check(schema, references, value))
    return;
  const errors = schema.anyOf.map((variant) => new ValueErrorIterator(Visit4(variant, references, path3, value)));
  yield Create(ValueErrorType.Union, schema, path3, value, errors);
}
function* FromUint8Array2(schema, references, path3, value) {
  if (!IsUint8Array(value))
    return yield Create(ValueErrorType.Uint8Array, schema, path3, value);
  if (IsDefined2(schema.maxByteLength) && !(value.length <= schema.maxByteLength)) {
    yield Create(ValueErrorType.Uint8ArrayMaxByteLength, schema, path3, value);
  }
  if (IsDefined2(schema.minByteLength) && !(value.length >= schema.minByteLength)) {
    yield Create(ValueErrorType.Uint8ArrayMinByteLength, schema, path3, value);
  }
}
function* FromUnknown2(schema, references, path3, value) {
}
function* FromVoid2(schema, references, path3, value) {
  if (!TypeSystemPolicy.IsVoidLike(value))
    yield Create(ValueErrorType.Void, schema, path3, value);
}
function* FromKind2(schema, references, path3, value) {
  const check = type_exports.Get(schema[Kind]);
  if (!check(schema, value))
    yield Create(ValueErrorType.Kind, schema, path3, value);
}
function* Visit4(schema, references, path3, value) {
  const references_ = IsDefined2(schema.$id) ? [...references, schema] : references;
  const schema_ = schema;
  switch (schema_[Kind]) {
    case "Any":
      return yield* FromAny2(schema_, references_, path3, value);
    case "Argument":
      return yield* FromArgument2(schema_, references_, path3, value);
    case "Array":
      return yield* FromArray4(schema_, references_, path3, value);
    case "AsyncIterator":
      return yield* FromAsyncIterator2(schema_, references_, path3, value);
    case "BigInt":
      return yield* FromBigInt2(schema_, references_, path3, value);
    case "Boolean":
      return yield* FromBoolean2(schema_, references_, path3, value);
    case "Constructor":
      return yield* FromConstructor2(schema_, references_, path3, value);
    case "Date":
      return yield* FromDate2(schema_, references_, path3, value);
    case "Function":
      return yield* FromFunction2(schema_, references_, path3, value);
    case "Import":
      return yield* FromImport2(schema_, references_, path3, value);
    case "Integer":
      return yield* FromInteger2(schema_, references_, path3, value);
    case "Intersect":
      return yield* FromIntersect4(schema_, references_, path3, value);
    case "Iterator":
      return yield* FromIterator2(schema_, references_, path3, value);
    case "Literal":
      return yield* FromLiteral2(schema_, references_, path3, value);
    case "Never":
      return yield* FromNever2(schema_, references_, path3, value);
    case "Not":
      return yield* FromNot2(schema_, references_, path3, value);
    case "Null":
      return yield* FromNull2(schema_, references_, path3, value);
    case "Number":
      return yield* FromNumber2(schema_, references_, path3, value);
    case "Object":
      return yield* FromObject2(schema_, references_, path3, value);
    case "Promise":
      return yield* FromPromise2(schema_, references_, path3, value);
    case "Record":
      return yield* FromRecord2(schema_, references_, path3, value);
    case "Ref":
      return yield* FromRef2(schema_, references_, path3, value);
    case "RegExp":
      return yield* FromRegExp2(schema_, references_, path3, value);
    case "String":
      return yield* FromString2(schema_, references_, path3, value);
    case "Symbol":
      return yield* FromSymbol2(schema_, references_, path3, value);
    case "TemplateLiteral":
      return yield* FromTemplateLiteral2(schema_, references_, path3, value);
    case "This":
      return yield* FromThis2(schema_, references_, path3, value);
    case "Tuple":
      return yield* FromTuple4(schema_, references_, path3, value);
    case "Undefined":
      return yield* FromUndefined2(schema_, references_, path3, value);
    case "Union":
      return yield* FromUnion4(schema_, references_, path3, value);
    case "Uint8Array":
      return yield* FromUint8Array2(schema_, references_, path3, value);
    case "Unknown":
      return yield* FromUnknown2(schema_, references_, path3, value);
    case "Void":
      return yield* FromVoid2(schema_, references_, path3, value);
    default:
      if (!type_exports.Has(schema_[Kind]))
        throw new ValueErrorsUnknownTypeError(schema);
      return yield* FromKind2(schema_, references_, path3, value);
  }
}
function Errors(...args) {
  const iterator = args.length === 3 ? Visit4(args[0], args[1], "", args[2]) : Visit4(args[0], [], "", args[1]);
  return new ValueErrorIterator(iterator);
}

// node_modules/@sinclair/typebox/build/esm/value/transform/decode.mjs
var TransformDecodeCheckError = class extends TypeBoxError {
  constructor(schema, value, error) {
    super(`Unable to decode value as it does not match the expected schema`);
    this.schema = schema;
    this.value = value;
    this.error = error;
  }
};
var TransformDecodeError = class extends TypeBoxError {
  constructor(schema, path3, value, error) {
    super(error instanceof Error ? error.message : "Unknown error");
    this.schema = schema;
    this.path = path3;
    this.value = value;
    this.error = error;
  }
};
function Default(schema, path3, value) {
  try {
    return IsTransform(schema) ? schema[TransformKind].Decode(value) : value;
  } catch (error) {
    throw new TransformDecodeError(schema, path3, value, error);
  }
}
function FromArray5(schema, references, path3, value) {
  return IsArray(value) ? Default(schema, path3, value.map((value2, index) => Visit5(schema.items, references, `${path3}/${index}`, value2))) : Default(schema, path3, value);
}
function FromIntersect5(schema, references, path3, value) {
  if (!IsObject(value) || IsValueType(value))
    return Default(schema, path3, value);
  const knownEntries = KeyOfPropertyEntries(schema);
  const knownKeys = knownEntries.map((entry) => entry[0]);
  const knownProperties = { ...value };
  for (const [knownKey, knownSchema] of knownEntries)
    if (knownKey in knownProperties) {
      knownProperties[knownKey] = Visit5(knownSchema, references, `${path3}/${knownKey}`, knownProperties[knownKey]);
    }
  if (!IsTransform(schema.unevaluatedProperties)) {
    return Default(schema, path3, knownProperties);
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const unevaluatedProperties = schema.unevaluatedProperties;
  const unknownProperties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.includes(key)) {
      unknownProperties[key] = Default(unevaluatedProperties, `${path3}/${key}`, unknownProperties[key]);
    }
  return Default(schema, path3, unknownProperties);
}
function FromImport3(schema, references, path3, value) {
  const additional = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  const result = Visit5(target, [...references, ...additional], path3, value);
  return Default(schema, path3, result);
}
function FromNot3(schema, references, path3, value) {
  return Default(schema, path3, Visit5(schema.not, references, path3, value));
}
function FromObject3(schema, references, path3, value) {
  if (!IsObject(value))
    return Default(schema, path3, value);
  const knownKeys = KeyOfPropertyKeys(schema);
  const knownProperties = { ...value };
  for (const key of knownKeys) {
    if (!HasPropertyKey(knownProperties, key))
      continue;
    if (IsUndefined(knownProperties[key]) && (!IsUndefined3(schema.properties[key]) || TypeSystemPolicy.IsExactOptionalProperty(knownProperties, key)))
      continue;
    knownProperties[key] = Visit5(schema.properties[key], references, `${path3}/${key}`, knownProperties[key]);
  }
  if (!IsSchema(schema.additionalProperties)) {
    return Default(schema, path3, knownProperties);
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const additionalProperties = schema.additionalProperties;
  const unknownProperties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.includes(key)) {
      unknownProperties[key] = Default(additionalProperties, `${path3}/${key}`, unknownProperties[key]);
    }
  return Default(schema, path3, unknownProperties);
}
function FromRecord3(schema, references, path3, value) {
  if (!IsObject(value))
    return Default(schema, path3, value);
  const pattern = Object.getOwnPropertyNames(schema.patternProperties)[0];
  const knownKeys = new RegExp(pattern);
  const knownProperties = { ...value };
  for (const key of Object.getOwnPropertyNames(value))
    if (knownKeys.test(key)) {
      knownProperties[key] = Visit5(schema.patternProperties[pattern], references, `${path3}/${key}`, knownProperties[key]);
    }
  if (!IsSchema(schema.additionalProperties)) {
    return Default(schema, path3, knownProperties);
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const additionalProperties = schema.additionalProperties;
  const unknownProperties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.test(key)) {
      unknownProperties[key] = Default(additionalProperties, `${path3}/${key}`, unknownProperties[key]);
    }
  return Default(schema, path3, unknownProperties);
}
function FromRef3(schema, references, path3, value) {
  const target = Deref(schema, references);
  return Default(schema, path3, Visit5(target, references, path3, value));
}
function FromThis3(schema, references, path3, value) {
  const target = Deref(schema, references);
  return Default(schema, path3, Visit5(target, references, path3, value));
}
function FromTuple5(schema, references, path3, value) {
  return IsArray(value) && IsArray(schema.items) ? Default(schema, path3, schema.items.map((schema2, index) => Visit5(schema2, references, `${path3}/${index}`, value[index]))) : Default(schema, path3, value);
}
function FromUnion5(schema, references, path3, value) {
  for (const subschema of schema.anyOf) {
    if (!Check(subschema, references, value))
      continue;
    const decoded = Visit5(subschema, references, path3, value);
    return Default(schema, path3, decoded);
  }
  return Default(schema, path3, value);
}
function Visit5(schema, references, path3, value) {
  const references_ = Pushref(schema, references);
  const schema_ = schema;
  switch (schema[Kind]) {
    case "Array":
      return FromArray5(schema_, references_, path3, value);
    case "Import":
      return FromImport3(schema_, references_, path3, value);
    case "Intersect":
      return FromIntersect5(schema_, references_, path3, value);
    case "Not":
      return FromNot3(schema_, references_, path3, value);
    case "Object":
      return FromObject3(schema_, references_, path3, value);
    case "Record":
      return FromRecord3(schema_, references_, path3, value);
    case "Ref":
      return FromRef3(schema_, references_, path3, value);
    case "Symbol":
      return Default(schema_, path3, value);
    case "This":
      return FromThis3(schema_, references_, path3, value);
    case "Tuple":
      return FromTuple5(schema_, references_, path3, value);
    case "Union":
      return FromUnion5(schema_, references_, path3, value);
    default:
      return Default(schema_, path3, value);
  }
}
function TransformDecode(schema, references, value) {
  return Visit5(schema, references, "", value);
}

// node_modules/@sinclair/typebox/build/esm/value/transform/encode.mjs
var TransformEncodeCheckError = class extends TypeBoxError {
  constructor(schema, value, error) {
    super(`The encoded value does not match the expected schema`);
    this.schema = schema;
    this.value = value;
    this.error = error;
  }
};
var TransformEncodeError = class extends TypeBoxError {
  constructor(schema, path3, value, error) {
    super(`${error instanceof Error ? error.message : "Unknown error"}`);
    this.schema = schema;
    this.path = path3;
    this.value = value;
    this.error = error;
  }
};
function Default2(schema, path3, value) {
  try {
    return IsTransform(schema) ? schema[TransformKind].Encode(value) : value;
  } catch (error) {
    throw new TransformEncodeError(schema, path3, value, error);
  }
}
function FromArray6(schema, references, path3, value) {
  const defaulted = Default2(schema, path3, value);
  return IsArray(defaulted) ? defaulted.map((value2, index) => Visit6(schema.items, references, `${path3}/${index}`, value2)) : defaulted;
}
function FromImport4(schema, references, path3, value) {
  const additional = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  const result = Default2(schema, path3, value);
  return Visit6(target, [...references, ...additional], path3, result);
}
function FromIntersect6(schema, references, path3, value) {
  const defaulted = Default2(schema, path3, value);
  if (!IsObject(value) || IsValueType(value))
    return defaulted;
  const knownEntries = KeyOfPropertyEntries(schema);
  const knownKeys = knownEntries.map((entry) => entry[0]);
  const knownProperties = { ...defaulted };
  for (const [knownKey, knownSchema] of knownEntries)
    if (knownKey in knownProperties) {
      knownProperties[knownKey] = Visit6(knownSchema, references, `${path3}/${knownKey}`, knownProperties[knownKey]);
    }
  if (!IsTransform(schema.unevaluatedProperties)) {
    return knownProperties;
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const unevaluatedProperties = schema.unevaluatedProperties;
  const properties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.includes(key)) {
      properties[key] = Default2(unevaluatedProperties, `${path3}/${key}`, properties[key]);
    }
  return properties;
}
function FromNot4(schema, references, path3, value) {
  return Default2(schema.not, path3, Default2(schema, path3, value));
}
function FromObject4(schema, references, path3, value) {
  const defaulted = Default2(schema, path3, value);
  if (!IsObject(defaulted))
    return defaulted;
  const knownKeys = KeyOfPropertyKeys(schema);
  const knownProperties = { ...defaulted };
  for (const key of knownKeys) {
    if (!HasPropertyKey(knownProperties, key))
      continue;
    if (IsUndefined(knownProperties[key]) && (!IsUndefined3(schema.properties[key]) || TypeSystemPolicy.IsExactOptionalProperty(knownProperties, key)))
      continue;
    knownProperties[key] = Visit6(schema.properties[key], references, `${path3}/${key}`, knownProperties[key]);
  }
  if (!IsSchema(schema.additionalProperties)) {
    return knownProperties;
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const additionalProperties = schema.additionalProperties;
  const properties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.includes(key)) {
      properties[key] = Default2(additionalProperties, `${path3}/${key}`, properties[key]);
    }
  return properties;
}
function FromRecord4(schema, references, path3, value) {
  const defaulted = Default2(schema, path3, value);
  if (!IsObject(value))
    return defaulted;
  const pattern = Object.getOwnPropertyNames(schema.patternProperties)[0];
  const knownKeys = new RegExp(pattern);
  const knownProperties = { ...defaulted };
  for (const key of Object.getOwnPropertyNames(value))
    if (knownKeys.test(key)) {
      knownProperties[key] = Visit6(schema.patternProperties[pattern], references, `${path3}/${key}`, knownProperties[key]);
    }
  if (!IsSchema(schema.additionalProperties)) {
    return knownProperties;
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const additionalProperties = schema.additionalProperties;
  const properties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.test(key)) {
      properties[key] = Default2(additionalProperties, `${path3}/${key}`, properties[key]);
    }
  return properties;
}
function FromRef4(schema, references, path3, value) {
  const target = Deref(schema, references);
  const resolved = Visit6(target, references, path3, value);
  return Default2(schema, path3, resolved);
}
function FromThis4(schema, references, path3, value) {
  const target = Deref(schema, references);
  const resolved = Visit6(target, references, path3, value);
  return Default2(schema, path3, resolved);
}
function FromTuple6(schema, references, path3, value) {
  const value1 = Default2(schema, path3, value);
  return IsArray(schema.items) ? schema.items.map((schema2, index) => Visit6(schema2, references, `${path3}/${index}`, value1[index])) : [];
}
function FromUnion6(schema, references, path3, value) {
  for (const subschema of schema.anyOf) {
    if (!Check(subschema, references, value))
      continue;
    const value1 = Visit6(subschema, references, path3, value);
    return Default2(schema, path3, value1);
  }
  for (const subschema of schema.anyOf) {
    const value1 = Visit6(subschema, references, path3, value);
    if (!Check(schema, references, value1))
      continue;
    return Default2(schema, path3, value1);
  }
  return Default2(schema, path3, value);
}
function Visit6(schema, references, path3, value) {
  const references_ = Pushref(schema, references);
  const schema_ = schema;
  switch (schema[Kind]) {
    case "Array":
      return FromArray6(schema_, references_, path3, value);
    case "Import":
      return FromImport4(schema_, references_, path3, value);
    case "Intersect":
      return FromIntersect6(schema_, references_, path3, value);
    case "Not":
      return FromNot4(schema_, references_, path3, value);
    case "Object":
      return FromObject4(schema_, references_, path3, value);
    case "Record":
      return FromRecord4(schema_, references_, path3, value);
    case "Ref":
      return FromRef4(schema_, references_, path3, value);
    case "This":
      return FromThis4(schema_, references_, path3, value);
    case "Tuple":
      return FromTuple6(schema_, references_, path3, value);
    case "Union":
      return FromUnion6(schema_, references_, path3, value);
    default:
      return Default2(schema_, path3, value);
  }
}
function TransformEncode(schema, references, value) {
  return Visit6(schema, references, "", value);
}

// node_modules/@sinclair/typebox/build/esm/value/transform/has.mjs
function FromArray7(schema, references) {
  return IsTransform(schema) || Visit7(schema.items, references);
}
function FromAsyncIterator3(schema, references) {
  return IsTransform(schema) || Visit7(schema.items, references);
}
function FromConstructor3(schema, references) {
  return IsTransform(schema) || Visit7(schema.returns, references) || schema.parameters.some((schema2) => Visit7(schema2, references));
}
function FromFunction3(schema, references) {
  return IsTransform(schema) || Visit7(schema.returns, references) || schema.parameters.some((schema2) => Visit7(schema2, references));
}
function FromIntersect7(schema, references) {
  return IsTransform(schema) || IsTransform(schema.unevaluatedProperties) || schema.allOf.some((schema2) => Visit7(schema2, references));
}
function FromImport5(schema, references) {
  const additional = globalThis.Object.getOwnPropertyNames(schema.$defs).reduce((result, key) => [...result, schema.$defs[key]], []);
  const target = schema.$defs[schema.$ref];
  return IsTransform(schema) || Visit7(target, [...additional, ...references]);
}
function FromIterator3(schema, references) {
  return IsTransform(schema) || Visit7(schema.items, references);
}
function FromNot5(schema, references) {
  return IsTransform(schema) || Visit7(schema.not, references);
}
function FromObject5(schema, references) {
  return IsTransform(schema) || Object.values(schema.properties).some((schema2) => Visit7(schema2, references)) || IsSchema(schema.additionalProperties) && Visit7(schema.additionalProperties, references);
}
function FromPromise3(schema, references) {
  return IsTransform(schema) || Visit7(schema.item, references);
}
function FromRecord5(schema, references) {
  const pattern = Object.getOwnPropertyNames(schema.patternProperties)[0];
  const property = schema.patternProperties[pattern];
  return IsTransform(schema) || Visit7(property, references) || IsSchema(schema.additionalProperties) && IsTransform(schema.additionalProperties);
}
function FromRef5(schema, references) {
  if (IsTransform(schema))
    return true;
  return Visit7(Deref(schema, references), references);
}
function FromThis5(schema, references) {
  if (IsTransform(schema))
    return true;
  return Visit7(Deref(schema, references), references);
}
function FromTuple7(schema, references) {
  return IsTransform(schema) || !IsUndefined(schema.items) && schema.items.some((schema2) => Visit7(schema2, references));
}
function FromUnion7(schema, references) {
  return IsTransform(schema) || schema.anyOf.some((schema2) => Visit7(schema2, references));
}
function Visit7(schema, references) {
  const references_ = Pushref(schema, references);
  const schema_ = schema;
  if (schema.$id && visited.has(schema.$id))
    return false;
  if (schema.$id)
    visited.add(schema.$id);
  switch (schema[Kind]) {
    case "Array":
      return FromArray7(schema_, references_);
    case "AsyncIterator":
      return FromAsyncIterator3(schema_, references_);
    case "Constructor":
      return FromConstructor3(schema_, references_);
    case "Function":
      return FromFunction3(schema_, references_);
    case "Import":
      return FromImport5(schema_, references_);
    case "Intersect":
      return FromIntersect7(schema_, references_);
    case "Iterator":
      return FromIterator3(schema_, references_);
    case "Not":
      return FromNot5(schema_, references_);
    case "Object":
      return FromObject5(schema_, references_);
    case "Promise":
      return FromPromise3(schema_, references_);
    case "Record":
      return FromRecord5(schema_, references_);
    case "Ref":
      return FromRef5(schema_, references_);
    case "This":
      return FromThis5(schema_, references_);
    case "Tuple":
      return FromTuple7(schema_, references_);
    case "Union":
      return FromUnion7(schema_, references_);
    default:
      return IsTransform(schema);
  }
}
var visited = /* @__PURE__ */ new Set();
function HasTransform(schema, references) {
  visited.clear();
  return Visit7(schema, references);
}

// node_modules/@sinclair/typebox/build/esm/compiler/compiler.mjs
var TypeCheck = class {
  constructor(schema, references, checkFunc, code) {
    this.schema = schema;
    this.references = references;
    this.checkFunc = checkFunc;
    this.code = code;
    this.hasTransform = HasTransform(schema, references);
  }
  /** Returns the generated assertion code used to validate this type. */
  Code() {
    return this.code;
  }
  /** Returns the schema type used to validate */
  Schema() {
    return this.schema;
  }
  /** Returns reference types used to validate */
  References() {
    return this.references;
  }
  /** Returns an iterator for each error in this value. */
  Errors(value) {
    return Errors(this.schema, this.references, value);
  }
  /** Returns true if the value matches the compiled type. */
  Check(value) {
    return this.checkFunc(value);
  }
  /** Decodes a value or throws if error */
  Decode(value) {
    if (!this.checkFunc(value))
      throw new TransformDecodeCheckError(this.schema, value, this.Errors(value).First());
    return this.hasTransform ? TransformDecode(this.schema, this.references, value) : value;
  }
  /** Encodes a value or throws if error */
  Encode(value) {
    const encoded = this.hasTransform ? TransformEncode(this.schema, this.references, value) : value;
    if (!this.checkFunc(encoded))
      throw new TransformEncodeCheckError(this.schema, value, this.Errors(value).First());
    return encoded;
  }
};
var Character;
(function(Character2) {
  function DollarSign(code) {
    return code === 36;
  }
  Character2.DollarSign = DollarSign;
  function IsUnderscore(code) {
    return code === 95;
  }
  Character2.IsUnderscore = IsUnderscore;
  function IsAlpha(code) {
    return code >= 65 && code <= 90 || code >= 97 && code <= 122;
  }
  Character2.IsAlpha = IsAlpha;
  function IsNumeric(code) {
    return code >= 48 && code <= 57;
  }
  Character2.IsNumeric = IsNumeric;
})(Character || (Character = {}));
var MemberExpression;
(function(MemberExpression2) {
  function IsFirstCharacterNumeric(value) {
    if (value.length === 0)
      return false;
    return Character.IsNumeric(value.charCodeAt(0));
  }
  function IsAccessor(value) {
    if (IsFirstCharacterNumeric(value))
      return false;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      const check = Character.IsAlpha(code) || Character.IsNumeric(code) || Character.DollarSign(code) || Character.IsUnderscore(code);
      if (!check)
        return false;
    }
    return true;
  }
  function EscapeHyphen(key) {
    return key.replace(/'/g, "\\'");
  }
  function Encode2(object, key) {
    return IsAccessor(key) ? `${object}.${key}` : `${object}['${EscapeHyphen(key)}']`;
  }
  MemberExpression2.Encode = Encode2;
})(MemberExpression || (MemberExpression = {}));
var Identifier;
(function(Identifier2) {
  function Encode2($id) {
    const buffer = [];
    for (let i = 0; i < $id.length; i++) {
      const code = $id.charCodeAt(i);
      if (Character.IsNumeric(code) || Character.IsAlpha(code)) {
        buffer.push($id.charAt(i));
      } else {
        buffer.push(`_${code}_`);
      }
    }
    return buffer.join("").replace(/__/g, "_");
  }
  Identifier2.Encode = Encode2;
})(Identifier || (Identifier = {}));
var LiteralString;
(function(LiteralString2) {
  function Escape3(content) {
    return content.replace(/'/g, "\\'");
  }
  LiteralString2.Escape = Escape3;
})(LiteralString || (LiteralString = {}));
var TypeCompilerUnknownTypeError = class extends TypeBoxError {
  constructor(schema) {
    super("Unknown type");
    this.schema = schema;
  }
};
var TypeCompilerTypeGuardError = class extends TypeBoxError {
  constructor(schema) {
    super("Preflight validation check failed to guard for the given schema");
    this.schema = schema;
  }
};
var Policy;
(function(Policy2) {
  function IsExactOptionalProperty(value, key, expression) {
    return TypeSystemPolicy.ExactOptionalPropertyTypes ? `('${key}' in ${value} ? ${expression} : true)` : `(${MemberExpression.Encode(value, key)} !== undefined ? ${expression} : true)`;
  }
  Policy2.IsExactOptionalProperty = IsExactOptionalProperty;
  function IsObjectLike(value) {
    return !TypeSystemPolicy.AllowArrayObject ? `(typeof ${value} === 'object' && ${value} !== null && !Array.isArray(${value}))` : `(typeof ${value} === 'object' && ${value} !== null)`;
  }
  Policy2.IsObjectLike = IsObjectLike;
  function IsRecordLike(value) {
    return !TypeSystemPolicy.AllowArrayObject ? `(typeof ${value} === 'object' && ${value} !== null && !Array.isArray(${value}) && !(${value} instanceof Date) && !(${value} instanceof Uint8Array))` : `(typeof ${value} === 'object' && ${value} !== null && !(${value} instanceof Date) && !(${value} instanceof Uint8Array))`;
  }
  Policy2.IsRecordLike = IsRecordLike;
  function IsNumberLike(value) {
    return TypeSystemPolicy.AllowNaN ? `typeof ${value} === 'number'` : `Number.isFinite(${value})`;
  }
  Policy2.IsNumberLike = IsNumberLike;
  function IsVoidLike(value) {
    return TypeSystemPolicy.AllowNullVoid ? `(${value} === undefined || ${value} === null)` : `${value} === undefined`;
  }
  Policy2.IsVoidLike = IsVoidLike;
})(Policy || (Policy = {}));
var TypeCompiler;
(function(TypeCompiler2) {
  function IsAnyOrUnknown2(schema) {
    return schema[Kind] === "Any" || schema[Kind] === "Unknown";
  }
  function* FromAny5(schema, references, value) {
    yield "true";
  }
  function* FromArgument5(schema, references, value) {
    yield "true";
  }
  function* FromArray20(schema, references, value) {
    yield `Array.isArray(${value})`;
    const [parameter, accumulator] = [CreateParameter("value", "any"), CreateParameter("acc", "number")];
    if (IsNumber(schema.maxItems))
      yield `${value}.length <= ${schema.maxItems}`;
    if (IsNumber(schema.minItems))
      yield `${value}.length >= ${schema.minItems}`;
    const elementExpression = CreateExpression(schema.items, references, "value");
    yield `((array) => { for(const ${parameter} of array) if(!(${elementExpression})) { return false }; return true; })(${value})`;
    if (IsSchema2(schema.contains) || IsNumber(schema.minContains) || IsNumber(schema.maxContains)) {
      const containsSchema = IsSchema2(schema.contains) ? schema.contains : Never();
      const checkExpression = CreateExpression(containsSchema, references, "value");
      const checkMinContains = IsNumber(schema.minContains) ? [`(count >= ${schema.minContains})`] : [];
      const checkMaxContains = IsNumber(schema.maxContains) ? [`(count <= ${schema.maxContains})`] : [];
      const checkCount = `const count = value.reduce((${accumulator}, ${parameter}) => ${checkExpression} ? acc + 1 : acc, 0)`;
      const check = [`(count > 0)`, ...checkMinContains, ...checkMaxContains].join(" && ");
      yield `((${parameter}) => { ${checkCount}; return ${check}})(${value})`;
    }
    if (schema.uniqueItems === true) {
      const check = `const hashed = hash(element); if(set.has(hashed)) { return false } else { set.add(hashed) } } return true`;
      const block = `const set = new Set(); for(const element of value) { ${check} }`;
      yield `((${parameter}) => { ${block} )(${value})`;
    }
  }
  function* FromAsyncIterator8(schema, references, value) {
    yield `(typeof value === 'object' && Symbol.asyncIterator in ${value})`;
  }
  function* FromBigInt6(schema, references, value) {
    yield `(typeof ${value} === 'bigint')`;
    if (IsBigInt(schema.exclusiveMaximum))
      yield `${value} < BigInt(${schema.exclusiveMaximum})`;
    if (IsBigInt(schema.exclusiveMinimum))
      yield `${value} > BigInt(${schema.exclusiveMinimum})`;
    if (IsBigInt(schema.maximum))
      yield `${value} <= BigInt(${schema.maximum})`;
    if (IsBigInt(schema.minimum))
      yield `${value} >= BigInt(${schema.minimum})`;
    if (IsBigInt(schema.multipleOf))
      yield `(${value} % BigInt(${schema.multipleOf})) === 0`;
  }
  function* FromBoolean6(schema, references, value) {
    yield `(typeof ${value} === 'boolean')`;
  }
  function* FromConstructor9(schema, references, value) {
    yield* Visit18(schema.returns, references, `${value}.prototype`);
  }
  function* FromDate8(schema, references, value) {
    yield `(${value} instanceof Date) && Number.isFinite(${value}.getTime())`;
    if (IsNumber(schema.exclusiveMaximumTimestamp))
      yield `${value}.getTime() < ${schema.exclusiveMaximumTimestamp}`;
    if (IsNumber(schema.exclusiveMinimumTimestamp))
      yield `${value}.getTime() > ${schema.exclusiveMinimumTimestamp}`;
    if (IsNumber(schema.maximumTimestamp))
      yield `${value}.getTime() <= ${schema.maximumTimestamp}`;
    if (IsNumber(schema.minimumTimestamp))
      yield `${value}.getTime() >= ${schema.minimumTimestamp}`;
    if (IsNumber(schema.multipleOfTimestamp))
      yield `(${value}.getTime() % ${schema.multipleOfTimestamp}) === 0`;
  }
  function* FromFunction8(schema, references, value) {
    yield `(typeof ${value} === 'function')`;
  }
  function* FromImport11(schema, references, value) {
    const members = globalThis.Object.getOwnPropertyNames(schema.$defs).reduce((result, key) => {
      return [...result, schema.$defs[key]];
    }, []);
    yield* Visit18(Ref(schema.$ref), [...references, ...members], value);
  }
  function* FromInteger6(schema, references, value) {
    yield `Number.isInteger(${value})`;
    if (IsNumber(schema.exclusiveMaximum))
      yield `${value} < ${schema.exclusiveMaximum}`;
    if (IsNumber(schema.exclusiveMinimum))
      yield `${value} > ${schema.exclusiveMinimum}`;
    if (IsNumber(schema.maximum))
      yield `${value} <= ${schema.maximum}`;
    if (IsNumber(schema.minimum))
      yield `${value} >= ${schema.minimum}`;
    if (IsNumber(schema.multipleOf))
      yield `(${value} % ${schema.multipleOf}) === 0`;
  }
  function* FromIntersect21(schema, references, value) {
    const check1 = schema.allOf.map((schema2) => CreateExpression(schema2, references, value)).join(" && ");
    if (schema.unevaluatedProperties === false) {
      const keyCheck = CreateVariable(`${new RegExp(KeyOfPattern(schema))};`);
      const check2 = `Object.getOwnPropertyNames(${value}).every(key => ${keyCheck}.test(key))`;
      yield `(${check1} && ${check2})`;
    } else if (IsSchema2(schema.unevaluatedProperties)) {
      const keyCheck = CreateVariable(`${new RegExp(KeyOfPattern(schema))};`);
      const check2 = `Object.getOwnPropertyNames(${value}).every(key => ${keyCheck}.test(key) || ${CreateExpression(schema.unevaluatedProperties, references, `${value}[key]`)})`;
      yield `(${check1} && ${check2})`;
    } else {
      yield `(${check1})`;
    }
  }
  function* FromIterator8(schema, references, value) {
    yield `(typeof value === 'object' && Symbol.iterator in ${value})`;
  }
  function* FromLiteral7(schema, references, value) {
    if (typeof schema.const === "number" || typeof schema.const === "boolean") {
      yield `(${value} === ${schema.const})`;
    } else {
      yield `(${value} === '${LiteralString.Escape(schema.const)}')`;
    }
  }
  function* FromNever6(schema, references, value) {
    yield `false`;
  }
  function* FromNot8(schema, references, value) {
    const expression = CreateExpression(schema.not, references, value);
    yield `(!${expression})`;
  }
  function* FromNull6(schema, references, value) {
    yield `(${value} === null)`;
  }
  function* FromNumber6(schema, references, value) {
    yield Policy.IsNumberLike(value);
    if (IsNumber(schema.exclusiveMaximum))
      yield `${value} < ${schema.exclusiveMaximum}`;
    if (IsNumber(schema.exclusiveMinimum))
      yield `${value} > ${schema.exclusiveMinimum}`;
    if (IsNumber(schema.maximum))
      yield `${value} <= ${schema.maximum}`;
    if (IsNumber(schema.minimum))
      yield `${value} >= ${schema.minimum}`;
    if (IsNumber(schema.multipleOf))
      yield `(${value} % ${schema.multipleOf}) === 0`;
  }
  function* FromObject19(schema, references, value) {
    yield Policy.IsObjectLike(value);
    if (IsNumber(schema.minProperties))
      yield `Object.getOwnPropertyNames(${value}).length >= ${schema.minProperties}`;
    if (IsNumber(schema.maxProperties))
      yield `Object.getOwnPropertyNames(${value}).length <= ${schema.maxProperties}`;
    const knownKeys = Object.getOwnPropertyNames(schema.properties);
    for (const knownKey of knownKeys) {
      const memberExpression = MemberExpression.Encode(value, knownKey);
      const property = schema.properties[knownKey];
      if (schema.required && schema.required.includes(knownKey)) {
        yield* Visit18(property, references, memberExpression);
        if (ExtendsUndefinedCheck(property) || IsAnyOrUnknown2(property))
          yield `('${knownKey}' in ${value})`;
      } else {
        const expression = CreateExpression(property, references, memberExpression);
        yield Policy.IsExactOptionalProperty(value, knownKey, expression);
      }
    }
    if (schema.additionalProperties === false) {
      if (schema.required && schema.required.length === knownKeys.length) {
        yield `Object.getOwnPropertyNames(${value}).length === ${knownKeys.length}`;
      } else {
        const keys = `[${knownKeys.map((key) => `'${key}'`).join(", ")}]`;
        yield `Object.getOwnPropertyNames(${value}).every(key => ${keys}.includes(key))`;
      }
    }
    if (typeof schema.additionalProperties === "object") {
      const expression = CreateExpression(schema.additionalProperties, references, `${value}[key]`);
      const keys = `[${knownKeys.map((key) => `'${key}'`).join(", ")}]`;
      yield `(Object.getOwnPropertyNames(${value}).every(key => ${keys}.includes(key) || ${expression}))`;
    }
  }
  function* FromPromise8(schema, references, value) {
    yield `${value} instanceof Promise`;
  }
  function* FromRecord14(schema, references, value) {
    yield Policy.IsRecordLike(value);
    if (IsNumber(schema.minProperties))
      yield `Object.getOwnPropertyNames(${value}).length >= ${schema.minProperties}`;
    if (IsNumber(schema.maxProperties))
      yield `Object.getOwnPropertyNames(${value}).length <= ${schema.maxProperties}`;
    const [patternKey, patternSchema] = Object.entries(schema.patternProperties)[0];
    const variable = CreateVariable(`${new RegExp(patternKey)}`);
    const check1 = CreateExpression(patternSchema, references, "value");
    const check2 = IsSchema2(schema.additionalProperties) ? CreateExpression(schema.additionalProperties, references, value) : schema.additionalProperties === false ? "false" : "true";
    const expression = `(${variable}.test(key) ? ${check1} : ${check2})`;
    yield `(Object.entries(${value}).every(([key, value]) => ${expression}))`;
  }
  function* FromRef15(schema, references, value) {
    const target = Deref(schema, references);
    if (state.functions.has(schema.$ref))
      return yield `${CreateFunctionName(schema.$ref)}(${value})`;
    yield* Visit18(target, references, value);
  }
  function* FromRegExp5(schema, references, value) {
    const variable = CreateVariable(`${new RegExp(schema.source, schema.flags)};`);
    yield `(typeof ${value} === 'string')`;
    if (IsNumber(schema.maxLength))
      yield `${value}.length <= ${schema.maxLength}`;
    if (IsNumber(schema.minLength))
      yield `${value}.length >= ${schema.minLength}`;
    yield `${variable}.test(${value})`;
  }
  function* FromString6(schema, references, value) {
    yield `(typeof ${value} === 'string')`;
    if (IsNumber(schema.maxLength))
      yield `${value}.length <= ${schema.maxLength}`;
    if (IsNumber(schema.minLength))
      yield `${value}.length >= ${schema.minLength}`;
    if (schema.pattern !== void 0) {
      const variable = CreateVariable(`${new RegExp(schema.pattern)};`);
      yield `${variable}.test(${value})`;
    }
    if (schema.format !== void 0) {
      yield `format('${schema.format}', ${value})`;
    }
  }
  function* FromSymbol6(schema, references, value) {
    yield `(typeof ${value} === 'symbol')`;
  }
  function* FromTemplateLiteral7(schema, references, value) {
    yield `(typeof ${value} === 'string')`;
    const variable = CreateVariable(`${new RegExp(schema.pattern)};`);
    yield `${variable}.test(${value})`;
  }
  function* FromThis11(schema, references, value) {
    yield `${CreateFunctionName(schema.$ref)}(${value})`;
  }
  function* FromTuple18(schema, references, value) {
    yield `Array.isArray(${value})`;
    if (schema.items === void 0)
      return yield `${value}.length === 0`;
    yield `(${value}.length === ${schema.maxItems})`;
    for (let i = 0; i < schema.items.length; i++) {
      const expression = CreateExpression(schema.items[i], references, `${value}[${i}]`);
      yield `${expression}`;
    }
  }
  function* FromUndefined6(schema, references, value) {
    yield `${value} === undefined`;
  }
  function* FromUnion23(schema, references, value) {
    const expressions = schema.anyOf.map((schema2) => CreateExpression(schema2, references, value));
    yield `(${expressions.join(" || ")})`;
  }
  function* FromUint8Array5(schema, references, value) {
    yield `${value} instanceof Uint8Array`;
    if (IsNumber(schema.maxByteLength))
      yield `(${value}.length <= ${schema.maxByteLength})`;
    if (IsNumber(schema.minByteLength))
      yield `(${value}.length >= ${schema.minByteLength})`;
  }
  function* FromUnknown5(schema, references, value) {
    yield "true";
  }
  function* FromVoid5(schema, references, value) {
    yield Policy.IsVoidLike(value);
  }
  function* FromKind4(schema, references, value) {
    const instance = state.instances.size;
    state.instances.set(instance, schema);
    yield `kind('${schema[Kind]}', ${instance}, ${value})`;
  }
  function* Visit18(schema, references, value, useHoisting = true) {
    const references_ = IsString(schema.$id) ? [...references, schema] : references;
    const schema_ = schema;
    if (useHoisting && IsString(schema.$id)) {
      const functionName = CreateFunctionName(schema.$id);
      if (state.functions.has(functionName)) {
        return yield `${functionName}(${value})`;
      } else {
        state.functions.set(functionName, "<deferred>");
        const functionCode = CreateFunction(functionName, schema, references, "value", false);
        state.functions.set(functionName, functionCode);
        return yield `${functionName}(${value})`;
      }
    }
    switch (schema_[Kind]) {
      case "Any":
        return yield* FromAny5(schema_, references_, value);
      case "Argument":
        return yield* FromArgument5(schema_, references_, value);
      case "Array":
        return yield* FromArray20(schema_, references_, value);
      case "AsyncIterator":
        return yield* FromAsyncIterator8(schema_, references_, value);
      case "BigInt":
        return yield* FromBigInt6(schema_, references_, value);
      case "Boolean":
        return yield* FromBoolean6(schema_, references_, value);
      case "Constructor":
        return yield* FromConstructor9(schema_, references_, value);
      case "Date":
        return yield* FromDate8(schema_, references_, value);
      case "Function":
        return yield* FromFunction8(schema_, references_, value);
      case "Import":
        return yield* FromImport11(schema_, references_, value);
      case "Integer":
        return yield* FromInteger6(schema_, references_, value);
      case "Intersect":
        return yield* FromIntersect21(schema_, references_, value);
      case "Iterator":
        return yield* FromIterator8(schema_, references_, value);
      case "Literal":
        return yield* FromLiteral7(schema_, references_, value);
      case "Never":
        return yield* FromNever6(schema_, references_, value);
      case "Not":
        return yield* FromNot8(schema_, references_, value);
      case "Null":
        return yield* FromNull6(schema_, references_, value);
      case "Number":
        return yield* FromNumber6(schema_, references_, value);
      case "Object":
        return yield* FromObject19(schema_, references_, value);
      case "Promise":
        return yield* FromPromise8(schema_, references_, value);
      case "Record":
        return yield* FromRecord14(schema_, references_, value);
      case "Ref":
        return yield* FromRef15(schema_, references_, value);
      case "RegExp":
        return yield* FromRegExp5(schema_, references_, value);
      case "String":
        return yield* FromString6(schema_, references_, value);
      case "Symbol":
        return yield* FromSymbol6(schema_, references_, value);
      case "TemplateLiteral":
        return yield* FromTemplateLiteral7(schema_, references_, value);
      case "This":
        return yield* FromThis11(schema_, references_, value);
      case "Tuple":
        return yield* FromTuple18(schema_, references_, value);
      case "Undefined":
        return yield* FromUndefined6(schema_, references_, value);
      case "Union":
        return yield* FromUnion23(schema_, references_, value);
      case "Uint8Array":
        return yield* FromUint8Array5(schema_, references_, value);
      case "Unknown":
        return yield* FromUnknown5(schema_, references_, value);
      case "Void":
        return yield* FromVoid5(schema_, references_, value);
      default:
        if (!type_exports.Has(schema_[Kind]))
          throw new TypeCompilerUnknownTypeError(schema);
        return yield* FromKind4(schema_, references_, value);
    }
  }
  const state = {
    language: "javascript",
    // target language
    functions: /* @__PURE__ */ new Map(),
    // local functions
    variables: /* @__PURE__ */ new Map(),
    // local variables
    instances: /* @__PURE__ */ new Map()
    // exterior kind instances
  };
  function CreateExpression(schema, references, value, useHoisting = true) {
    return `(${[...Visit18(schema, references, value, useHoisting)].join(" && ")})`;
  }
  function CreateFunctionName($id) {
    return `check_${Identifier.Encode($id)}`;
  }
  function CreateVariable(expression) {
    const variableName = `local_${state.variables.size}`;
    state.variables.set(variableName, `const ${variableName} = ${expression}`);
    return variableName;
  }
  function CreateFunction(name, schema, references, value, useHoisting = true) {
    const [newline, pad] = ["\n", (length) => "".padStart(length, " ")];
    const parameter = CreateParameter("value", "any");
    const returns = CreateReturns("boolean");
    const expression = [...Visit18(schema, references, value, useHoisting)].map((expression2) => `${pad(4)}${expression2}`).join(` &&${newline}`);
    return `function ${name}(${parameter})${returns} {${newline}${pad(2)}return (${newline}${expression}${newline}${pad(2)})
}`;
  }
  function CreateParameter(name, type) {
    const annotation = state.language === "typescript" ? `: ${type}` : "";
    return `${name}${annotation}`;
  }
  function CreateReturns(type) {
    return state.language === "typescript" ? `: ${type}` : "";
  }
  function Build(schema, references, options) {
    const functionCode = CreateFunction("check", schema, references, "value");
    const parameter = CreateParameter("value", "any");
    const returns = CreateReturns("boolean");
    const functions = [...state.functions.values()];
    const variables = [...state.variables.values()];
    const checkFunction = IsString(schema.$id) ? `return function check(${parameter})${returns} {
  return ${CreateFunctionName(schema.$id)}(value)
}` : `return ${functionCode}`;
    return [...variables, ...functions, checkFunction].join("\n");
  }
  function Code(...args) {
    const defaults = { language: "javascript" };
    const [schema, references, options] = args.length === 2 && IsArray(args[1]) ? [args[0], args[1], defaults] : args.length === 2 && !IsArray(args[1]) ? [args[0], [], args[1]] : args.length === 3 ? [args[0], args[1], args[2]] : args.length === 1 ? [args[0], [], defaults] : [null, [], defaults];
    state.language = options.language;
    state.variables.clear();
    state.functions.clear();
    state.instances.clear();
    if (!IsSchema2(schema))
      throw new TypeCompilerTypeGuardError(schema);
    for (const schema2 of references)
      if (!IsSchema2(schema2))
        throw new TypeCompilerTypeGuardError(schema2);
    return Build(schema, references, options);
  }
  TypeCompiler2.Code = Code;
  function Compile(schema, references = []) {
    const generatedCode = Code(schema, references, { language: "javascript" });
    const compiledFunction = globalThis.Function("kind", "format", "hash", generatedCode);
    const instances = new Map(state.instances);
    function typeRegistryFunction(kind, instance, value) {
      if (!type_exports.Has(kind) || !instances.has(instance))
        return false;
      const checkFunc = type_exports.Get(kind);
      const schema2 = instances.get(instance);
      return checkFunc(schema2, value);
    }
    function formatRegistryFunction(format, value) {
      if (!format_exports.Has(format))
        return false;
      const checkFunc = format_exports.Get(format);
      return checkFunc(value);
    }
    function hashFunction(value) {
      return Hash(value);
    }
    const checkFunction = compiledFunction(typeRegistryFunction, formatRegistryFunction, hashFunction);
    return new TypeCheck(schema, references, checkFunction, generatedCode);
  }
  TypeCompiler2.Compile = Compile;
})(TypeCompiler || (TypeCompiler = {}));

// node_modules/@sinclair/typebox/build/esm/value/assert/assert.mjs
var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _AssertError_instances;
var _AssertError_iterator;
var _AssertError_Iterator;
var AssertError = class extends TypeBoxError {
  constructor(iterator) {
    const error = iterator.First();
    super(error === void 0 ? "Invalid Value" : error.message);
    _AssertError_instances.add(this);
    _AssertError_iterator.set(this, void 0);
    __classPrivateFieldSet(this, _AssertError_iterator, iterator, "f");
    this.error = error;
  }
  /** Returns an iterator for each error in this value. */
  Errors() {
    return new ValueErrorIterator(__classPrivateFieldGet(this, _AssertError_instances, "m", _AssertError_Iterator).call(this));
  }
};
_AssertError_iterator = /* @__PURE__ */ new WeakMap(), _AssertError_instances = /* @__PURE__ */ new WeakSet(), _AssertError_Iterator = function* _AssertError_Iterator2() {
  if (this.error)
    yield this.error;
  yield* __classPrivateFieldGet(this, _AssertError_iterator, "f");
};
function AssertValue(schema, references, value) {
  if (Check(schema, references, value))
    return;
  throw new AssertError(Errors(schema, references, value));
}
function Assert(...args) {
  return args.length === 3 ? AssertValue(args[0], args[1], args[2]) : AssertValue(args[0], [], args[1]);
}

// node_modules/@sinclair/typebox/build/esm/value/clone/clone.mjs
function FromObject6(value) {
  const Acc = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    Acc[key] = Clone2(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    Acc[key] = Clone2(value[key]);
  }
  return Acc;
}
function FromArray8(value) {
  return value.map((element) => Clone2(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromMap(value) {
  return new Map(Clone2([...value.entries()]));
}
function FromSet(value) {
  return new Set(Clone2([...value.entries()]));
}
function FromDate3(value) {
  return new Date(value.toISOString());
}
function FromValue(value) {
  return value;
}
function Clone2(value) {
  if (IsArray(value))
    return FromArray8(value);
  if (IsDate(value))
    return FromDate3(value);
  if (IsTypedArray(value))
    return FromTypedArray(value);
  if (IsMap(value))
    return FromMap(value);
  if (IsSet(value))
    return FromSet(value);
  if (IsObject(value))
    return FromObject6(value);
  if (IsValueType(value))
    return FromValue(value);
  throw new Error("ValueClone: Unable to clone value");
}

// node_modules/@sinclair/typebox/build/esm/value/create/create.mjs
var ValueCreateError = class extends TypeBoxError {
  constructor(schema, message) {
    super(message);
    this.schema = schema;
  }
};
function FromDefault(value) {
  return IsFunction(value) ? value() : Clone2(value);
}
function FromAny3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return {};
  }
}
function FromArgument3(schema, references) {
  return {};
}
function FromArray9(schema, references) {
  if (schema.uniqueItems === true && !HasPropertyKey(schema, "default")) {
    throw new ValueCreateError(schema, "Array with the uniqueItems constraint requires a default value");
  } else if ("contains" in schema && !HasPropertyKey(schema, "default")) {
    throw new ValueCreateError(schema, "Array with the contains constraint requires a default value");
  } else if ("default" in schema) {
    return FromDefault(schema.default);
  } else if (schema.minItems !== void 0) {
    return Array.from({ length: schema.minItems }).map((item) => {
      return Visit8(schema.items, references);
    });
  } else {
    return [];
  }
}
function FromAsyncIterator4(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return async function* () {
    }();
  }
}
function FromBigInt3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return BigInt(0);
  }
}
function FromBoolean3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return false;
  }
}
function FromConstructor4(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    const value = Visit8(schema.returns, references);
    if (typeof value === "object" && !Array.isArray(value)) {
      return class {
        constructor() {
          for (const [key, val] of Object.entries(value)) {
            const self = this;
            self[key] = val;
          }
        }
      };
    } else {
      return class {
      };
    }
  }
}
function FromDate4(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else if (schema.minimumTimestamp !== void 0) {
    return new Date(schema.minimumTimestamp);
  } else {
    return /* @__PURE__ */ new Date();
  }
}
function FromFunction4(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return () => Visit8(schema.returns, references);
  }
}
function FromImport6(schema, references) {
  const definitions = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  return Visit8(target, [...references, ...definitions]);
}
function FromInteger3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else if (schema.minimum !== void 0) {
    return schema.minimum;
  } else {
    return 0;
  }
}
function FromIntersect8(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    const value = schema.allOf.reduce((acc, schema2) => {
      const next = Visit8(schema2, references);
      return typeof next === "object" ? { ...acc, ...next } : next;
    }, {});
    if (!Check(schema, references, value))
      throw new ValueCreateError(schema, "Intersect produced invalid value. Consider using a default value.");
    return value;
  }
}
function FromIterator4(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return function* () {
    }();
  }
}
function FromLiteral3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return schema.const;
  }
}
function FromNever3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    throw new ValueCreateError(schema, "Never types cannot be created. Consider using a default value.");
  }
}
function FromNot6(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    throw new ValueCreateError(schema, "Not types must have a default value");
  }
}
function FromNull3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return null;
  }
}
function FromNumber3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else if (schema.minimum !== void 0) {
    return schema.minimum;
  } else {
    return 0;
  }
}
function FromObject7(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    const required2 = new Set(schema.required);
    const Acc = {};
    for (const [key, subschema] of Object.entries(schema.properties)) {
      if (!required2.has(key))
        continue;
      Acc[key] = Visit8(subschema, references);
    }
    return Acc;
  }
}
function FromPromise4(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return Promise.resolve(Visit8(schema.item, references));
  }
}
function FromRecord6(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return {};
  }
}
function FromRef6(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return Visit8(Deref(schema, references), references);
  }
}
function FromRegExp3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    throw new ValueCreateError(schema, "RegExp types cannot be created. Consider using a default value.");
  }
}
function FromString3(schema, references) {
  if (schema.pattern !== void 0) {
    if (!HasPropertyKey(schema, "default")) {
      throw new ValueCreateError(schema, "String types with patterns must specify a default value");
    } else {
      return FromDefault(schema.default);
    }
  } else if (schema.format !== void 0) {
    if (!HasPropertyKey(schema, "default")) {
      throw new ValueCreateError(schema, "String types with formats must specify a default value");
    } else {
      return FromDefault(schema.default);
    }
  } else {
    if (HasPropertyKey(schema, "default")) {
      return FromDefault(schema.default);
    } else if (schema.minLength !== void 0) {
      return Array.from({ length: schema.minLength }).map(() => " ").join("");
    } else {
      return "";
    }
  }
}
function FromSymbol3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else if ("value" in schema) {
    return Symbol.for(schema.value);
  } else {
    return Symbol();
  }
}
function FromTemplateLiteral3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  }
  if (!IsTemplateLiteralFinite(schema))
    throw new ValueCreateError(schema, "Can only create template literals that produce a finite variants. Consider using a default value.");
  const generated = TemplateLiteralGenerate(schema);
  return generated[0];
}
function FromThis6(schema, references) {
  if (recursiveDepth++ > recursiveMaxDepth)
    throw new ValueCreateError(schema, "Cannot create recursive type as it appears possibly infinite. Consider using a default.");
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return Visit8(Deref(schema, references), references);
  }
}
function FromTuple8(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  }
  if (schema.items === void 0) {
    return [];
  } else {
    return Array.from({ length: schema.minItems }).map((_, index) => Visit8(schema.items[index], references));
  }
}
function FromUndefined3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return void 0;
  }
}
function FromUnion8(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else if (schema.anyOf.length === 0) {
    throw new Error("ValueCreate.Union: Cannot create Union with zero variants");
  } else {
    return Visit8(schema.anyOf[0], references);
  }
}
function FromUint8Array3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else if (schema.minByteLength !== void 0) {
    return new Uint8Array(schema.minByteLength);
  } else {
    return new Uint8Array(0);
  }
}
function FromUnknown3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return {};
  }
}
function FromVoid3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    return void 0;
  }
}
function FromKind3(schema, references) {
  if (HasPropertyKey(schema, "default")) {
    return FromDefault(schema.default);
  } else {
    throw new Error("User defined types must specify a default value");
  }
}
function Visit8(schema, references) {
  const references_ = Pushref(schema, references);
  const schema_ = schema;
  switch (schema_[Kind]) {
    case "Any":
      return FromAny3(schema_, references_);
    case "Argument":
      return FromArgument3(schema_, references_);
    case "Array":
      return FromArray9(schema_, references_);
    case "AsyncIterator":
      return FromAsyncIterator4(schema_, references_);
    case "BigInt":
      return FromBigInt3(schema_, references_);
    case "Boolean":
      return FromBoolean3(schema_, references_);
    case "Constructor":
      return FromConstructor4(schema_, references_);
    case "Date":
      return FromDate4(schema_, references_);
    case "Function":
      return FromFunction4(schema_, references_);
    case "Import":
      return FromImport6(schema_, references_);
    case "Integer":
      return FromInteger3(schema_, references_);
    case "Intersect":
      return FromIntersect8(schema_, references_);
    case "Iterator":
      return FromIterator4(schema_, references_);
    case "Literal":
      return FromLiteral3(schema_, references_);
    case "Never":
      return FromNever3(schema_, references_);
    case "Not":
      return FromNot6(schema_, references_);
    case "Null":
      return FromNull3(schema_, references_);
    case "Number":
      return FromNumber3(schema_, references_);
    case "Object":
      return FromObject7(schema_, references_);
    case "Promise":
      return FromPromise4(schema_, references_);
    case "Record":
      return FromRecord6(schema_, references_);
    case "Ref":
      return FromRef6(schema_, references_);
    case "RegExp":
      return FromRegExp3(schema_, references_);
    case "String":
      return FromString3(schema_, references_);
    case "Symbol":
      return FromSymbol3(schema_, references_);
    case "TemplateLiteral":
      return FromTemplateLiteral3(schema_, references_);
    case "This":
      return FromThis6(schema_, references_);
    case "Tuple":
      return FromTuple8(schema_, references_);
    case "Undefined":
      return FromUndefined3(schema_, references_);
    case "Union":
      return FromUnion8(schema_, references_);
    case "Uint8Array":
      return FromUint8Array3(schema_, references_);
    case "Unknown":
      return FromUnknown3(schema_, references_);
    case "Void":
      return FromVoid3(schema_, references_);
    default:
      if (!type_exports.Has(schema_[Kind]))
        throw new ValueCreateError(schema_, "Unknown type");
      return FromKind3(schema_, references_);
  }
}
var recursiveMaxDepth = 512;
var recursiveDepth = 0;
function Create2(...args) {
  recursiveDepth = 0;
  return args.length === 2 ? Visit8(args[0], args[1]) : Visit8(args[0], []);
}

// node_modules/@sinclair/typebox/build/esm/value/cast/cast.mjs
var ValueCastError = class extends TypeBoxError {
  constructor(schema, message) {
    super(message);
    this.schema = schema;
  }
};
function ScoreUnion(schema, references, value) {
  if (schema[Kind] === "Object" && typeof value === "object" && !IsNull(value)) {
    const object = schema;
    const keys = Object.getOwnPropertyNames(value);
    const entries = Object.entries(object.properties);
    return entries.reduce((acc, [key, schema2]) => {
      const literal = schema2[Kind] === "Literal" && schema2.const === value[key] ? 100 : 0;
      const checks = Check(schema2, references, value[key]) ? 10 : 0;
      const exists = keys.includes(key) ? 1 : 0;
      return acc + (literal + checks + exists);
    }, 0);
  } else if (schema[Kind] === "Union") {
    const schemas = schema.anyOf.map((schema2) => Deref(schema2, references));
    const scores = schemas.map((schema2) => ScoreUnion(schema2, references, value));
    return Math.max(...scores);
  } else {
    return Check(schema, references, value) ? 1 : 0;
  }
}
function SelectUnion(union, references, value) {
  const schemas = union.anyOf.map((schema) => Deref(schema, references));
  let [select, best] = [schemas[0], 0];
  for (const schema of schemas) {
    const score = ScoreUnion(schema, references, value);
    if (score > best) {
      select = schema;
      best = score;
    }
  }
  return select;
}
function CastUnion(union, references, value) {
  if ("default" in union) {
    return typeof value === "function" ? union.default : Clone2(union.default);
  } else {
    const schema = SelectUnion(union, references, value);
    return Cast(schema, references, value);
  }
}
function DefaultClone(schema, references, value) {
  return Check(schema, references, value) ? Clone2(value) : Create2(schema, references);
}
function Default3(schema, references, value) {
  return Check(schema, references, value) ? value : Create2(schema, references);
}
function FromArray10(schema, references, value) {
  if (Check(schema, references, value))
    return Clone2(value);
  const created = IsArray(value) ? Clone2(value) : Create2(schema, references);
  const minimum = IsNumber(schema.minItems) && created.length < schema.minItems ? [...created, ...Array.from({ length: schema.minItems - created.length }, () => null)] : created;
  const maximum = IsNumber(schema.maxItems) && minimum.length > schema.maxItems ? minimum.slice(0, schema.maxItems) : minimum;
  const casted = maximum.map((value2) => Visit9(schema.items, references, value2));
  if (schema.uniqueItems !== true)
    return casted;
  const unique = [...new Set(casted)];
  if (!Check(schema, references, unique))
    throw new ValueCastError(schema, "Array cast produced invalid data due to uniqueItems constraint");
  return unique;
}
function FromConstructor5(schema, references, value) {
  if (Check(schema, references, value))
    return Create2(schema, references);
  const required2 = new Set(schema.returns.required || []);
  const result = function() {
  };
  for (const [key, property] of Object.entries(schema.returns.properties)) {
    if (!required2.has(key) && value.prototype[key] === void 0)
      continue;
    result.prototype[key] = Visit9(property, references, value.prototype[key]);
  }
  return result;
}
function FromImport7(schema, references, value) {
  const definitions = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  return Visit9(target, [...references, ...definitions], value);
}
function IntersectAssign(correct, value) {
  if (IsObject(correct) && !IsObject(value) || !IsObject(correct) && IsObject(value))
    return correct;
  if (!IsObject(correct) || !IsObject(value))
    return value;
  return globalThis.Object.getOwnPropertyNames(correct).reduce((result, key) => {
    const property = key in value ? IntersectAssign(correct[key], value[key]) : correct[key];
    return { ...result, [key]: property };
  }, {});
}
function FromIntersect9(schema, references, value) {
  if (Check(schema, references, value))
    return value;
  const correct = Create2(schema, references);
  const assigned = IntersectAssign(correct, value);
  return Check(schema, references, assigned) ? assigned : correct;
}
function FromNever4(schema, references, value) {
  throw new ValueCastError(schema, "Never types cannot be cast");
}
function FromObject8(schema, references, value) {
  if (Check(schema, references, value))
    return value;
  if (value === null || typeof value !== "object")
    return Create2(schema, references);
  const required2 = new Set(schema.required || []);
  const result = {};
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!required2.has(key) && value[key] === void 0)
      continue;
    result[key] = Visit9(property, references, value[key]);
  }
  if (typeof schema.additionalProperties === "object") {
    const propertyNames = Object.getOwnPropertyNames(schema.properties);
    for (const propertyName of Object.getOwnPropertyNames(value)) {
      if (propertyNames.includes(propertyName))
        continue;
      result[propertyName] = Visit9(schema.additionalProperties, references, value[propertyName]);
    }
  }
  return result;
}
function FromRecord7(schema, references, value) {
  if (Check(schema, references, value))
    return Clone2(value);
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Date)
    return Create2(schema, references);
  const subschemaPropertyName = Object.getOwnPropertyNames(schema.patternProperties)[0];
  const subschema = schema.patternProperties[subschemaPropertyName];
  const result = {};
  for (const [propKey, propValue] of Object.entries(value)) {
    result[propKey] = Visit9(subschema, references, propValue);
  }
  return result;
}
function FromRef7(schema, references, value) {
  return Visit9(Deref(schema, references), references, value);
}
function FromThis7(schema, references, value) {
  return Visit9(Deref(schema, references), references, value);
}
function FromTuple9(schema, references, value) {
  if (Check(schema, references, value))
    return Clone2(value);
  if (!IsArray(value))
    return Create2(schema, references);
  if (schema.items === void 0)
    return [];
  return schema.items.map((schema2, index) => Visit9(schema2, references, value[index]));
}
function FromUnion9(schema, references, value) {
  return Check(schema, references, value) ? Clone2(value) : CastUnion(schema, references, value);
}
function Visit9(schema, references, value) {
  const references_ = IsString(schema.$id) ? Pushref(schema, references) : references;
  const schema_ = schema;
  switch (schema[Kind]) {
    // --------------------------------------------------------------
    // Structural
    // --------------------------------------------------------------
    case "Array":
      return FromArray10(schema_, references_, value);
    case "Constructor":
      return FromConstructor5(schema_, references_, value);
    case "Import":
      return FromImport7(schema_, references_, value);
    case "Intersect":
      return FromIntersect9(schema_, references_, value);
    case "Never":
      return FromNever4(schema_, references_, value);
    case "Object":
      return FromObject8(schema_, references_, value);
    case "Record":
      return FromRecord7(schema_, references_, value);
    case "Ref":
      return FromRef7(schema_, references_, value);
    case "This":
      return FromThis7(schema_, references_, value);
    case "Tuple":
      return FromTuple9(schema_, references_, value);
    case "Union":
      return FromUnion9(schema_, references_, value);
    // --------------------------------------------------------------
    // DefaultClone
    // --------------------------------------------------------------
    case "Date":
    case "Symbol":
    case "Uint8Array":
      return DefaultClone(schema, references, value);
    // --------------------------------------------------------------
    // Default
    // --------------------------------------------------------------
    default:
      return Default3(schema_, references_, value);
  }
}
function Cast(...args) {
  return args.length === 3 ? Visit9(args[0], args[1], args[2]) : Visit9(args[0], [], args[1]);
}

// node_modules/@sinclair/typebox/build/esm/value/clean/clean.mjs
function IsCheckable(schema) {
  return IsKind(schema) && schema[Kind] !== "Unsafe";
}
function FromArray11(schema, references, value) {
  if (!IsArray(value))
    return value;
  return value.map((value2) => Visit10(schema.items, references, value2));
}
function FromImport8(schema, references, value) {
  const definitions = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  return Visit10(target, [...references, ...definitions], value);
}
function FromIntersect10(schema, references, value) {
  const unevaluatedProperties = schema.unevaluatedProperties;
  const intersections = schema.allOf.map((schema2) => Visit10(schema2, references, Clone2(value)));
  const composite = intersections.reduce((acc, value2) => IsObject(value2) ? { ...acc, ...value2 } : value2, {});
  if (!IsObject(value) || !IsObject(composite) || !IsKind(unevaluatedProperties))
    return composite;
  const knownkeys = KeyOfPropertyKeys(schema);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (knownkeys.includes(key))
      continue;
    if (Check(unevaluatedProperties, references, value[key])) {
      composite[key] = Visit10(unevaluatedProperties, references, value[key]);
    }
  }
  return composite;
}
function FromObject9(schema, references, value) {
  if (!IsObject(value) || IsArray(value))
    return value;
  const additionalProperties = schema.additionalProperties;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (HasPropertyKey(schema.properties, key)) {
      value[key] = Visit10(schema.properties[key], references, value[key]);
      continue;
    }
    if (IsKind(additionalProperties) && Check(additionalProperties, references, value[key])) {
      value[key] = Visit10(additionalProperties, references, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}
function FromRecord8(schema, references, value) {
  if (!IsObject(value))
    return value;
  const additionalProperties = schema.additionalProperties;
  const propertyKeys = Object.getOwnPropertyNames(value);
  const [propertyKey, propertySchema] = Object.entries(schema.patternProperties)[0];
  const propertyKeyTest = new RegExp(propertyKey);
  for (const key of propertyKeys) {
    if (propertyKeyTest.test(key)) {
      value[key] = Visit10(propertySchema, references, value[key]);
      continue;
    }
    if (IsKind(additionalProperties) && Check(additionalProperties, references, value[key])) {
      value[key] = Visit10(additionalProperties, references, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}
function FromRef8(schema, references, value) {
  return Visit10(Deref(schema, references), references, value);
}
function FromThis8(schema, references, value) {
  return Visit10(Deref(schema, references), references, value);
}
function FromTuple10(schema, references, value) {
  if (!IsArray(value))
    return value;
  if (IsUndefined(schema.items))
    return [];
  const length = Math.min(value.length, schema.items.length);
  for (let i = 0; i < length; i++) {
    value[i] = Visit10(schema.items[i], references, value[i]);
  }
  return value.length > length ? value.slice(0, length) : value;
}
function FromUnion10(schema, references, value) {
  for (const inner of schema.anyOf) {
    if (IsCheckable(inner) && Check(inner, references, value)) {
      return Visit10(inner, references, value);
    }
  }
  return value;
}
function Visit10(schema, references, value) {
  const references_ = IsString(schema.$id) ? Pushref(schema, references) : references;
  const schema_ = schema;
  switch (schema_[Kind]) {
    case "Array":
      return FromArray11(schema_, references_, value);
    case "Import":
      return FromImport8(schema_, references_, value);
    case "Intersect":
      return FromIntersect10(schema_, references_, value);
    case "Object":
      return FromObject9(schema_, references_, value);
    case "Record":
      return FromRecord8(schema_, references_, value);
    case "Ref":
      return FromRef8(schema_, references_, value);
    case "This":
      return FromThis8(schema_, references_, value);
    case "Tuple":
      return FromTuple10(schema_, references_, value);
    case "Union":
      return FromUnion10(schema_, references_, value);
    default:
      return value;
  }
}
function Clean(...args) {
  return args.length === 3 ? Visit10(args[0], args[1], args[2]) : Visit10(args[0], [], args[1]);
}

// node_modules/@sinclair/typebox/build/esm/value/convert/convert.mjs
function IsStringNumeric(value) {
  return IsString(value) && !isNaN(value) && !isNaN(parseFloat(value));
}
function IsValueToString(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNumber(value);
}
function IsValueTrue(value) {
  return value === true || IsNumber(value) && value === 1 || IsBigInt(value) && value === BigInt("1") || IsString(value) && (value.toLowerCase() === "true" || value === "1");
}
function IsValueFalse(value) {
  return value === false || IsNumber(value) && (value === 0 || Object.is(value, -0)) || IsBigInt(value) && value === BigInt("0") || IsString(value) && (value.toLowerCase() === "false" || value === "0" || value === "-0");
}
function IsTimeStringWithTimeZone(value) {
  return IsString(value) && /^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i.test(value);
}
function IsTimeStringWithoutTimeZone(value) {
  return IsString(value) && /^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)?$/i.test(value);
}
function IsDateTimeStringWithTimeZone(value) {
  return IsString(value) && /^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i.test(value);
}
function IsDateTimeStringWithoutTimeZone(value) {
  return IsString(value) && /^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)?$/i.test(value);
}
function IsDateString(value) {
  return IsString(value) && /^\d\d\d\d-[0-1]\d-[0-3]\d$/i.test(value);
}
function TryConvertLiteralString(value, target) {
  const conversion = TryConvertString(value);
  return conversion === target ? conversion : value;
}
function TryConvertLiteralNumber(value, target) {
  const conversion = TryConvertNumber(value);
  return conversion === target ? conversion : value;
}
function TryConvertLiteralBoolean(value, target) {
  const conversion = TryConvertBoolean(value);
  return conversion === target ? conversion : value;
}
function TryConvertLiteral(schema, value) {
  return IsString(schema.const) ? TryConvertLiteralString(value, schema.const) : IsNumber(schema.const) ? TryConvertLiteralNumber(value, schema.const) : IsBoolean(schema.const) ? TryConvertLiteralBoolean(value, schema.const) : value;
}
function TryConvertBoolean(value) {
  return IsValueTrue(value) ? true : IsValueFalse(value) ? false : value;
}
function TryConvertBigInt(value) {
  const truncateInteger = (value2) => value2.split(".")[0];
  return IsStringNumeric(value) ? BigInt(truncateInteger(value)) : IsNumber(value) ? BigInt(Math.trunc(value)) : IsValueFalse(value) ? BigInt(0) : IsValueTrue(value) ? BigInt(1) : value;
}
function TryConvertString(value) {
  return IsSymbol(value) && value.description !== void 0 ? value.description.toString() : IsValueToString(value) ? value.toString() : value;
}
function TryConvertNumber(value) {
  return IsStringNumeric(value) ? parseFloat(value) : IsValueTrue(value) ? 1 : IsValueFalse(value) ? 0 : value;
}
function TryConvertInteger(value) {
  return IsStringNumeric(value) ? parseInt(value) : IsNumber(value) ? Math.trunc(value) : IsValueTrue(value) ? 1 : IsValueFalse(value) ? 0 : value;
}
function TryConvertNull(value) {
  return IsString(value) && value.toLowerCase() === "null" ? null : value;
}
function TryConvertUndefined(value) {
  return IsString(value) && value === "undefined" ? void 0 : value;
}
function TryConvertDate(value) {
  return IsDate(value) ? value : IsNumber(value) ? new Date(value) : IsValueTrue(value) ? /* @__PURE__ */ new Date(1) : IsValueFalse(value) ? /* @__PURE__ */ new Date(0) : IsStringNumeric(value) ? new Date(parseInt(value)) : IsTimeStringWithoutTimeZone(value) ? /* @__PURE__ */ new Date(`1970-01-01T${value}.000Z`) : IsTimeStringWithTimeZone(value) ? /* @__PURE__ */ new Date(`1970-01-01T${value}`) : IsDateTimeStringWithoutTimeZone(value) ? /* @__PURE__ */ new Date(`${value}.000Z`) : IsDateTimeStringWithTimeZone(value) ? new Date(value) : IsDateString(value) ? /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`) : value;
}
function Default4(value) {
  return value;
}
function FromArray12(schema, references, value) {
  const elements = IsArray(value) ? value : [value];
  return elements.map((element) => Visit11(schema.items, references, element));
}
function FromBigInt4(schema, references, value) {
  return TryConvertBigInt(value);
}
function FromBoolean4(schema, references, value) {
  return TryConvertBoolean(value);
}
function FromDate5(schema, references, value) {
  return TryConvertDate(value);
}
function FromImport9(schema, references, value) {
  const definitions = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  return Visit11(target, [...references, ...definitions], value);
}
function FromInteger4(schema, references, value) {
  return TryConvertInteger(value);
}
function FromIntersect11(schema, references, value) {
  return schema.allOf.reduce((value2, schema2) => Visit11(schema2, references, value2), value);
}
function FromLiteral4(schema, references, value) {
  return TryConvertLiteral(schema, value);
}
function FromNull4(schema, references, value) {
  return TryConvertNull(value);
}
function FromNumber4(schema, references, value) {
  return TryConvertNumber(value);
}
function FromObject10(schema, references, value) {
  if (!IsObject(value) || IsArray(value))
    return value;
  for (const propertyKey of Object.getOwnPropertyNames(schema.properties)) {
    if (!HasPropertyKey(value, propertyKey))
      continue;
    value[propertyKey] = Visit11(schema.properties[propertyKey], references, value[propertyKey]);
  }
  return value;
}
function FromRecord9(schema, references, value) {
  const isConvertable = IsObject(value) && !IsArray(value);
  if (!isConvertable)
    return value;
  const propertyKey = Object.getOwnPropertyNames(schema.patternProperties)[0];
  const property = schema.patternProperties[propertyKey];
  for (const [propKey, propValue] of Object.entries(value)) {
    value[propKey] = Visit11(property, references, propValue);
  }
  return value;
}
function FromRef9(schema, references, value) {
  return Visit11(Deref(schema, references), references, value);
}
function FromString4(schema, references, value) {
  return TryConvertString(value);
}
function FromSymbol4(schema, references, value) {
  return IsString(value) || IsNumber(value) ? Symbol(value) : value;
}
function FromThis9(schema, references, value) {
  return Visit11(Deref(schema, references), references, value);
}
function FromTuple11(schema, references, value) {
  const isConvertable = IsArray(value) && !IsUndefined(schema.items);
  if (!isConvertable)
    return value;
  return value.map((value2, index) => {
    return index < schema.items.length ? Visit11(schema.items[index], references, value2) : value2;
  });
}
function FromUndefined4(schema, references, value) {
  return TryConvertUndefined(value);
}
function FromUnion11(schema, references, value) {
  for (const subschema of schema.anyOf) {
    if (Check(subschema, references, value)) {
      return value;
    }
  }
  for (const subschema of schema.anyOf) {
    const converted = Visit11(subschema, references, Clone2(value));
    if (!Check(subschema, references, converted))
      continue;
    return converted;
  }
  return value;
}
function Visit11(schema, references, value) {
  const references_ = Pushref(schema, references);
  const schema_ = schema;
  switch (schema[Kind]) {
    case "Array":
      return FromArray12(schema_, references_, value);
    case "BigInt":
      return FromBigInt4(schema_, references_, value);
    case "Boolean":
      return FromBoolean4(schema_, references_, value);
    case "Date":
      return FromDate5(schema_, references_, value);
    case "Import":
      return FromImport9(schema_, references_, value);
    case "Integer":
      return FromInteger4(schema_, references_, value);
    case "Intersect":
      return FromIntersect11(schema_, references_, value);
    case "Literal":
      return FromLiteral4(schema_, references_, value);
    case "Null":
      return FromNull4(schema_, references_, value);
    case "Number":
      return FromNumber4(schema_, references_, value);
    case "Object":
      return FromObject10(schema_, references_, value);
    case "Record":
      return FromRecord9(schema_, references_, value);
    case "Ref":
      return FromRef9(schema_, references_, value);
    case "String":
      return FromString4(schema_, references_, value);
    case "Symbol":
      return FromSymbol4(schema_, references_, value);
    case "This":
      return FromThis9(schema_, references_, value);
    case "Tuple":
      return FromTuple11(schema_, references_, value);
    case "Undefined":
      return FromUndefined4(schema_, references_, value);
    case "Union":
      return FromUnion11(schema_, references_, value);
    default:
      return Default4(value);
  }
}
function Convert(...args) {
  return args.length === 3 ? Visit11(args[0], args[1], args[2]) : Visit11(args[0], [], args[1]);
}

// node_modules/@sinclair/typebox/build/esm/value/decode/decode.mjs
function Decode(...args) {
  const [schema, references, value] = args.length === 3 ? [args[0], args[1], args[2]] : [args[0], [], args[1]];
  if (!Check(schema, references, value))
    throw new TransformDecodeCheckError(schema, value, Errors(schema, references, value).First());
  return HasTransform(schema, references) ? TransformDecode(schema, references, value) : value;
}

// node_modules/@sinclair/typebox/build/esm/value/default/default.mjs
function ValueOrDefault(schema, value) {
  const defaultValue = HasPropertyKey(schema, "default") ? schema.default : void 0;
  const clone = IsFunction(defaultValue) ? defaultValue() : Clone2(defaultValue);
  return IsUndefined(value) ? clone : IsObject(value) && IsObject(clone) ? Object.assign(clone, value) : value;
}
function HasDefaultProperty(schema) {
  return IsKind(schema) && "default" in schema;
}
function FromArray13(schema, references, value) {
  if (IsArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = Visit12(schema.items, references, value[i]);
    }
    return value;
  }
  const defaulted = ValueOrDefault(schema, value);
  if (!IsArray(defaulted))
    return defaulted;
  for (let i = 0; i < defaulted.length; i++) {
    defaulted[i] = Visit12(schema.items, references, defaulted[i]);
  }
  return defaulted;
}
function FromDate6(schema, references, value) {
  return IsDate(value) ? value : ValueOrDefault(schema, value);
}
function FromImport10(schema, references, value) {
  const definitions = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  return Visit12(target, [...references, ...definitions], value);
}
function FromIntersect12(schema, references, value) {
  const defaulted = ValueOrDefault(schema, value);
  return schema.allOf.reduce((acc, schema2) => {
    const next = Visit12(schema2, references, defaulted);
    return IsObject(next) ? { ...acc, ...next } : next;
  }, {});
}
function FromObject11(schema, references, value) {
  const defaulted = ValueOrDefault(schema, value);
  if (!IsObject(defaulted))
    return defaulted;
  const knownPropertyKeys = Object.getOwnPropertyNames(schema.properties);
  for (const key of knownPropertyKeys) {
    const propertyValue = Visit12(schema.properties[key], references, defaulted[key]);
    if (IsUndefined(propertyValue))
      continue;
    defaulted[key] = Visit12(schema.properties[key], references, defaulted[key]);
  }
  if (!HasDefaultProperty(schema.additionalProperties))
    return defaulted;
  for (const key of Object.getOwnPropertyNames(defaulted)) {
    if (knownPropertyKeys.includes(key))
      continue;
    defaulted[key] = Visit12(schema.additionalProperties, references, defaulted[key]);
  }
  return defaulted;
}
function FromRecord10(schema, references, value) {
  const defaulted = ValueOrDefault(schema, value);
  if (!IsObject(defaulted))
    return defaulted;
  const additionalPropertiesSchema = schema.additionalProperties;
  const [propertyKeyPattern, propertySchema] = Object.entries(schema.patternProperties)[0];
  const knownPropertyKey = new RegExp(propertyKeyPattern);
  for (const key of Object.getOwnPropertyNames(defaulted)) {
    if (!(knownPropertyKey.test(key) && HasDefaultProperty(propertySchema)))
      continue;
    defaulted[key] = Visit12(propertySchema, references, defaulted[key]);
  }
  if (!HasDefaultProperty(additionalPropertiesSchema))
    return defaulted;
  for (const key of Object.getOwnPropertyNames(defaulted)) {
    if (knownPropertyKey.test(key))
      continue;
    defaulted[key] = Visit12(additionalPropertiesSchema, references, defaulted[key]);
  }
  return defaulted;
}
function FromRef10(schema, references, value) {
  return Visit12(Deref(schema, references), references, ValueOrDefault(schema, value));
}
function FromThis10(schema, references, value) {
  return Visit12(Deref(schema, references), references, value);
}
function FromTuple12(schema, references, value) {
  const defaulted = ValueOrDefault(schema, value);
  if (!IsArray(defaulted) || IsUndefined(schema.items))
    return defaulted;
  const [items, max] = [schema.items, Math.max(schema.items.length, defaulted.length)];
  for (let i = 0; i < max; i++) {
    if (i < items.length)
      defaulted[i] = Visit12(items[i], references, defaulted[i]);
  }
  return defaulted;
}
function FromUnion12(schema, references, value) {
  const defaulted = ValueOrDefault(schema, value);
  for (const inner of schema.anyOf) {
    const result = Visit12(inner, references, Clone2(defaulted));
    if (Check(inner, references, result)) {
      return result;
    }
  }
  return defaulted;
}
function Visit12(schema, references, value) {
  const references_ = Pushref(schema, references);
  const schema_ = schema;
  switch (schema_[Kind]) {
    case "Array":
      return FromArray13(schema_, references_, value);
    case "Date":
      return FromDate6(schema_, references_, value);
    case "Import":
      return FromImport10(schema_, references_, value);
    case "Intersect":
      return FromIntersect12(schema_, references_, value);
    case "Object":
      return FromObject11(schema_, references_, value);
    case "Record":
      return FromRecord10(schema_, references_, value);
    case "Ref":
      return FromRef10(schema_, references_, value);
    case "This":
      return FromThis10(schema_, references_, value);
    case "Tuple":
      return FromTuple12(schema_, references_, value);
    case "Union":
      return FromUnion12(schema_, references_, value);
    default:
      return ValueOrDefault(schema_, value);
  }
}
function Default5(...args) {
  return args.length === 3 ? Visit12(args[0], args[1], args[2]) : Visit12(args[0], [], args[1]);
}

// node_modules/@sinclair/typebox/build/esm/value/pointer/pointer.mjs
var pointer_exports = {};
__export(pointer_exports, {
  Delete: () => Delete3,
  Format: () => Format,
  Get: () => Get3,
  Has: () => Has3,
  Set: () => Set4,
  ValuePointerRootDeleteError: () => ValuePointerRootDeleteError,
  ValuePointerRootSetError: () => ValuePointerRootSetError
});
var ValuePointerRootSetError = class extends TypeBoxError {
  constructor(value, path3, update) {
    super("Cannot set root value");
    this.value = value;
    this.path = path3;
    this.update = update;
  }
};
var ValuePointerRootDeleteError = class extends TypeBoxError {
  constructor(value, path3) {
    super("Cannot delete root value");
    this.value = value;
    this.path = path3;
  }
};
function Escape(component) {
  return component.indexOf("~") === -1 ? component : component.replace(/~1/g, "/").replace(/~0/g, "~");
}
function* Format(pointer) {
  if (pointer === "")
    return;
  let [start, end] = [0, 0];
  for (let i = 0; i < pointer.length; i++) {
    const char = pointer.charAt(i);
    if (char === "/") {
      if (i === 0) {
        start = i + 1;
      } else {
        end = i;
        yield Escape(pointer.slice(start, end));
        start = i + 1;
      }
    } else {
      end = i;
    }
  }
  yield Escape(pointer.slice(start));
}
function Set4(value, pointer, update) {
  if (pointer === "")
    throw new ValuePointerRootSetError(value, pointer, update);
  let [owner, next, key] = [null, value, ""];
  for (const component of Format(pointer)) {
    if (next[component] === void 0)
      next[component] = {};
    owner = next;
    next = next[component];
    key = component;
  }
  owner[key] = update;
}
function Delete3(value, pointer) {
  if (pointer === "")
    throw new ValuePointerRootDeleteError(value, pointer);
  let [owner, next, key] = [null, value, ""];
  for (const component of Format(pointer)) {
    if (next[component] === void 0 || next[component] === null)
      return;
    owner = next;
    next = next[component];
    key = component;
  }
  if (Array.isArray(owner)) {
    const index = parseInt(key);
    owner.splice(index, 1);
  } else {
    delete owner[key];
  }
}
function Has3(value, pointer) {
  if (pointer === "")
    return true;
  let [owner, next, key] = [null, value, ""];
  for (const component of Format(pointer)) {
    if (next[component] === void 0)
      return false;
    owner = next;
    next = next[component];
    key = component;
  }
  return Object.getOwnPropertyNames(owner).includes(key);
}
function Get3(value, pointer) {
  if (pointer === "")
    return value;
  let current = value;
  for (const component of Format(pointer)) {
    if (current[component] === void 0)
      return void 0;
    current = current[component];
  }
  return current;
}

// node_modules/@sinclair/typebox/build/esm/value/equal/equal.mjs
function ObjectType3(left, right) {
  if (!IsObject(right))
    return false;
  const leftKeys = [...Object.keys(left), ...Object.getOwnPropertySymbols(left)];
  const rightKeys = [...Object.keys(right), ...Object.getOwnPropertySymbols(right)];
  if (leftKeys.length !== rightKeys.length)
    return false;
  return leftKeys.every((key) => Equal(left[key], right[key]));
}
function DateType3(left, right) {
  return IsDate(right) && left.getTime() === right.getTime();
}
function ArrayType3(left, right) {
  if (!IsArray(right) || left.length !== right.length)
    return false;
  return left.every((value, index) => Equal(value, right[index]));
}
function TypedArrayType(left, right) {
  if (!IsTypedArray(right) || left.length !== right.length || Object.getPrototypeOf(left).constructor.name !== Object.getPrototypeOf(right).constructor.name)
    return false;
  return left.every((value, index) => Equal(value, right[index]));
}
function ValueType(left, right) {
  return left === right;
}
function Equal(left, right) {
  if (IsDate(left))
    return DateType3(left, right);
  if (IsTypedArray(left))
    return TypedArrayType(left, right);
  if (IsArray(left))
    return ArrayType3(left, right);
  if (IsObject(left))
    return ObjectType3(left, right);
  if (IsValueType(left))
    return ValueType(left, right);
  throw new Error("ValueEquals: Unable to compare value");
}

// node_modules/@sinclair/typebox/build/esm/value/delta/delta.mjs
var Insert = Object2({
  type: Literal("insert"),
  path: String2(),
  value: Unknown()
});
var Update = Object2({
  type: Literal("update"),
  path: String2(),
  value: Unknown()
});
var Delete4 = Object2({
  type: Literal("delete"),
  path: String2()
});
var Edit = Union([Insert, Update, Delete4]);
var ValueDiffError = class extends TypeBoxError {
  constructor(value, message) {
    super(message);
    this.value = value;
  }
};
function CreateUpdate(path3, value) {
  return { type: "update", path: path3, value };
}
function CreateInsert(path3, value) {
  return { type: "insert", path: path3, value };
}
function CreateDelete(path3) {
  return { type: "delete", path: path3 };
}
function AssertDiffable(value) {
  if (globalThis.Object.getOwnPropertySymbols(value).length > 0)
    throw new ValueDiffError(value, "Cannot diff objects with symbols");
}
function* ObjectType4(path3, current, next) {
  AssertDiffable(current);
  AssertDiffable(next);
  if (!IsStandardObject(next))
    return yield CreateUpdate(path3, next);
  const currentKeys = globalThis.Object.getOwnPropertyNames(current);
  const nextKeys = globalThis.Object.getOwnPropertyNames(next);
  for (const key of nextKeys) {
    if (HasPropertyKey(current, key))
      continue;
    yield CreateInsert(`${path3}/${key}`, next[key]);
  }
  for (const key of currentKeys) {
    if (!HasPropertyKey(next, key))
      continue;
    if (Equal(current, next))
      continue;
    yield* Visit13(`${path3}/${key}`, current[key], next[key]);
  }
  for (const key of currentKeys) {
    if (HasPropertyKey(next, key))
      continue;
    yield CreateDelete(`${path3}/${key}`);
  }
}
function* ArrayType4(path3, current, next) {
  if (!IsArray(next))
    return yield CreateUpdate(path3, next);
  for (let i = 0; i < Math.min(current.length, next.length); i++) {
    yield* Visit13(`${path3}/${i}`, current[i], next[i]);
  }
  for (let i = 0; i < next.length; i++) {
    if (i < current.length)
      continue;
    yield CreateInsert(`${path3}/${i}`, next[i]);
  }
  for (let i = current.length - 1; i >= 0; i--) {
    if (i < next.length)
      continue;
    yield CreateDelete(`${path3}/${i}`);
  }
}
function* TypedArrayType2(path3, current, next) {
  if (!IsTypedArray(next) || current.length !== next.length || globalThis.Object.getPrototypeOf(current).constructor.name !== globalThis.Object.getPrototypeOf(next).constructor.name)
    return yield CreateUpdate(path3, next);
  for (let i = 0; i < Math.min(current.length, next.length); i++) {
    yield* Visit13(`${path3}/${i}`, current[i], next[i]);
  }
}
function* ValueType2(path3, current, next) {
  if (current === next)
    return;
  yield CreateUpdate(path3, next);
}
function* Visit13(path3, current, next) {
  if (IsStandardObject(current))
    return yield* ObjectType4(path3, current, next);
  if (IsArray(current))
    return yield* ArrayType4(path3, current, next);
  if (IsTypedArray(current))
    return yield* TypedArrayType2(path3, current, next);
  if (IsValueType(current))
    return yield* ValueType2(path3, current, next);
  throw new ValueDiffError(current, "Unable to diff value");
}
function Diff(current, next) {
  return [...Visit13("", current, next)];
}
function IsRootUpdate(edits) {
  return edits.length > 0 && edits[0].path === "" && edits[0].type === "update";
}
function IsIdentity(edits) {
  return edits.length === 0;
}
function Patch(current, edits) {
  if (IsRootUpdate(edits)) {
    return Clone2(edits[0].value);
  }
  if (IsIdentity(edits)) {
    return Clone2(current);
  }
  const clone = Clone2(current);
  for (const edit of edits) {
    switch (edit.type) {
      case "insert": {
        pointer_exports.Set(clone, edit.path, edit.value);
        break;
      }
      case "update": {
        pointer_exports.Set(clone, edit.path, edit.value);
        break;
      }
      case "delete": {
        pointer_exports.Delete(clone, edit.path);
        break;
      }
    }
  }
  return clone;
}

// node_modules/@sinclair/typebox/build/esm/value/encode/encode.mjs
function Encode(...args) {
  const [schema, references, value] = args.length === 3 ? [args[0], args[1], args[2]] : [args[0], [], args[1]];
  const encoded = HasTransform(schema, references) ? TransformEncode(schema, references, value) : value;
  if (!Check(schema, references, encoded))
    throw new TransformEncodeCheckError(schema, encoded, Errors(schema, references, encoded).First());
  return encoded;
}

// node_modules/@sinclair/typebox/build/esm/value/mutate/mutate.mjs
function IsStandardObject2(value) {
  return IsObject(value) && !IsArray(value);
}
var ValueMutateError = class extends TypeBoxError {
  constructor(message) {
    super(message);
  }
};
function ObjectType5(root, path3, current, next) {
  if (!IsStandardObject2(current)) {
    pointer_exports.Set(root, path3, Clone2(next));
  } else {
    const currentKeys = Object.getOwnPropertyNames(current);
    const nextKeys = Object.getOwnPropertyNames(next);
    for (const currentKey of currentKeys) {
      if (!nextKeys.includes(currentKey)) {
        delete current[currentKey];
      }
    }
    for (const nextKey of nextKeys) {
      if (!currentKeys.includes(nextKey)) {
        current[nextKey] = null;
      }
    }
    for (const nextKey of nextKeys) {
      Visit14(root, `${path3}/${nextKey}`, current[nextKey], next[nextKey]);
    }
  }
}
function ArrayType5(root, path3, current, next) {
  if (!IsArray(current)) {
    pointer_exports.Set(root, path3, Clone2(next));
  } else {
    for (let index = 0; index < next.length; index++) {
      Visit14(root, `${path3}/${index}`, current[index], next[index]);
    }
    current.splice(next.length);
  }
}
function TypedArrayType3(root, path3, current, next) {
  if (IsTypedArray(current) && current.length === next.length) {
    for (let i = 0; i < current.length; i++) {
      current[i] = next[i];
    }
  } else {
    pointer_exports.Set(root, path3, Clone2(next));
  }
}
function ValueType3(root, path3, current, next) {
  if (current === next)
    return;
  pointer_exports.Set(root, path3, next);
}
function Visit14(root, path3, current, next) {
  if (IsArray(next))
    return ArrayType5(root, path3, current, next);
  if (IsTypedArray(next))
    return TypedArrayType3(root, path3, current, next);
  if (IsStandardObject2(next))
    return ObjectType5(root, path3, current, next);
  if (IsValueType(next))
    return ValueType3(root, path3, current, next);
}
function IsNonMutableValue(value) {
  return IsTypedArray(value) || IsValueType(value);
}
function IsMismatchedValue(current, next) {
  return IsStandardObject2(current) && IsArray(next) || IsArray(current) && IsStandardObject2(next);
}
function Mutate(current, next) {
  if (IsNonMutableValue(current) || IsNonMutableValue(next))
    throw new ValueMutateError("Only object and array types can be mutated at the root level");
  if (IsMismatchedValue(current, next))
    throw new ValueMutateError("Cannot assign due type mismatch of assignable values");
  Visit14(current, "", current, next);
}

// node_modules/@sinclair/typebox/build/esm/value/parse/parse.mjs
var ParseError = class extends TypeBoxError {
  constructor(message) {
    super(message);
  }
};
var ParseRegistry;
(function(ParseRegistry2) {
  const registry2 = /* @__PURE__ */ new Map([
    ["Assert", (type, references, value) => {
      Assert(type, references, value);
      return value;
    }],
    ["Cast", (type, references, value) => Cast(type, references, value)],
    ["Clean", (type, references, value) => Clean(type, references, value)],
    ["Clone", (_type, _references, value) => Clone2(value)],
    ["Convert", (type, references, value) => Convert(type, references, value)],
    ["Decode", (type, references, value) => HasTransform(type, references) ? TransformDecode(type, references, value) : value],
    ["Default", (type, references, value) => Default5(type, references, value)],
    ["Encode", (type, references, value) => HasTransform(type, references) ? TransformEncode(type, references, value) : value]
  ]);
  function Delete5(key) {
    registry2.delete(key);
  }
  ParseRegistry2.Delete = Delete5;
  function Set5(key, callback) {
    registry2.set(key, callback);
  }
  ParseRegistry2.Set = Set5;
  function Get4(key) {
    return registry2.get(key);
  }
  ParseRegistry2.Get = Get4;
})(ParseRegistry || (ParseRegistry = {}));
var ParseDefault = [
  "Clone",
  "Clean",
  "Default",
  "Convert",
  "Assert",
  "Decode"
];
function ParseValue(operations, type, references, value) {
  return operations.reduce((value2, operationKey) => {
    const operation = ParseRegistry.Get(operationKey);
    if (IsUndefined(operation))
      throw new ParseError(`Unable to find Parse operation '${operationKey}'`);
    return operation(type, references, value2);
  }, value);
}
function Parse(...args) {
  const [operations, schema, references, value] = args.length === 4 ? [args[0], args[1], args[2], args[3]] : args.length === 3 ? IsArray(args[0]) ? [args[0], args[1], [], args[2]] : [ParseDefault, args[0], args[1], args[2]] : args.length === 2 ? [ParseDefault, args[0], [], args[1]] : (() => {
    throw new ParseError("Invalid Arguments");
  })();
  return ParseValue(operations, schema, references, value);
}

// node_modules/@sinclair/typebox/build/esm/value/value/value.mjs
var value_exports2 = {};
__export(value_exports2, {
  Assert: () => Assert,
  Cast: () => Cast,
  Check: () => Check,
  Clean: () => Clean,
  Clone: () => Clone2,
  Convert: () => Convert,
  Create: () => Create2,
  Decode: () => Decode,
  Default: () => Default5,
  Diff: () => Diff,
  Edit: () => Edit,
  Encode: () => Encode,
  Equal: () => Equal,
  Errors: () => Errors,
  Hash: () => Hash,
  Mutate: () => Mutate,
  Parse: () => Parse,
  Patch: () => Patch,
  ValueErrorIterator: () => ValueErrorIterator
});

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/guard/value.mjs
var value_exports3 = {};
__export(value_exports3, {
  HasPropertyKey: () => HasPropertyKey3,
  IsArray: () => IsArray5,
  IsAsyncIterator: () => IsAsyncIterator4,
  IsBigInt: () => IsBigInt5,
  IsBoolean: () => IsBoolean5,
  IsDate: () => IsDate5,
  IsFunction: () => IsFunction4,
  IsIterator: () => IsIterator4,
  IsNull: () => IsNull4,
  IsNumber: () => IsNumber5,
  IsObject: () => IsObject5,
  IsRegExp: () => IsRegExp4,
  IsString: () => IsString5,
  IsSymbol: () => IsSymbol4,
  IsUint8Array: () => IsUint8Array5,
  IsUndefined: () => IsUndefined5
});
function HasPropertyKey3(value, key) {
  return key in value;
}
function IsAsyncIterator4(value) {
  return IsObject5(value) && !IsArray5(value) && !IsUint8Array5(value) && Symbol.asyncIterator in value;
}
function IsArray5(value) {
  return Array.isArray(value);
}
function IsBigInt5(value) {
  return typeof value === "bigint";
}
function IsBoolean5(value) {
  return typeof value === "boolean";
}
function IsDate5(value) {
  return value instanceof globalThis.Date;
}
function IsFunction4(value) {
  return typeof value === "function";
}
function IsIterator4(value) {
  return IsObject5(value) && !IsArray5(value) && !IsUint8Array5(value) && Symbol.iterator in value;
}
function IsNull4(value) {
  return value === null;
}
function IsNumber5(value) {
  return typeof value === "number";
}
function IsObject5(value) {
  return typeof value === "object" && value !== null;
}
function IsRegExp4(value) {
  return value instanceof globalThis.RegExp;
}
function IsString5(value) {
  return typeof value === "string";
}
function IsSymbol4(value) {
  return typeof value === "symbol";
}
function IsUint8Array5(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUndefined5(value) {
  return value === void 0;
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/clone/value.mjs
function ArrayType6(value) {
  return value.map((value2) => Visit15(value2));
}
function DateType4(value) {
  return new Date(value.getTime());
}
function Uint8ArrayType3(value) {
  return new Uint8Array(value);
}
function RegExpType2(value) {
  return new RegExp(value.source, value.flags);
}
function ObjectType6(value) {
  const result = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    result[key] = Visit15(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    result[key] = Visit15(value[key]);
  }
  return result;
}
function Visit15(value) {
  return IsArray5(value) ? ArrayType6(value) : IsDate5(value) ? DateType4(value) : IsUint8Array5(value) ? Uint8ArrayType3(value) : IsRegExp4(value) ? RegExpType2(value) : IsObject5(value) ? ObjectType6(value) : value;
}
function Clone3(value) {
  return Visit15(value);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/clone/type.mjs
function CloneType(schema, options) {
  return options === void 0 ? Clone3(schema) : Clone3({ ...options, ...schema });
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/value/guard/guard.mjs
function IsObject6(value) {
  return value !== null && typeof value === "object";
}
function IsArray6(value) {
  return globalThis.Array.isArray(value) && !globalThis.ArrayBuffer.isView(value);
}
function IsUndefined6(value) {
  return value === void 0;
}
function IsNumber6(value) {
  return typeof value === "number";
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/system/policy.mjs
var TypeSystemPolicy2;
(function(TypeSystemPolicy3) {
  TypeSystemPolicy3.InstanceMode = "default";
  TypeSystemPolicy3.ExactOptionalPropertyTypes = false;
  TypeSystemPolicy3.AllowArrayObject = false;
  TypeSystemPolicy3.AllowNaN = false;
  TypeSystemPolicy3.AllowNullVoid = false;
  function IsExactOptionalProperty(value, key) {
    return TypeSystemPolicy3.ExactOptionalPropertyTypes ? key in value : value[key] !== void 0;
  }
  TypeSystemPolicy3.IsExactOptionalProperty = IsExactOptionalProperty;
  function IsObjectLike(value) {
    const isObject = IsObject6(value);
    return TypeSystemPolicy3.AllowArrayObject ? isObject : isObject && !IsArray6(value);
  }
  TypeSystemPolicy3.IsObjectLike = IsObjectLike;
  function IsRecordLike(value) {
    return IsObjectLike(value) && !(value instanceof Date) && !(value instanceof Uint8Array);
  }
  TypeSystemPolicy3.IsRecordLike = IsRecordLike;
  function IsNumberLike(value) {
    return TypeSystemPolicy3.AllowNaN ? IsNumber6(value) : Number.isFinite(value);
  }
  TypeSystemPolicy3.IsNumberLike = IsNumberLike;
  function IsVoidLike(value) {
    const isUndefined = IsUndefined6(value);
    return TypeSystemPolicy3.AllowNullVoid ? isUndefined || value === null : isUndefined;
  }
  TypeSystemPolicy3.IsVoidLike = IsVoidLike;
})(TypeSystemPolicy2 || (TypeSystemPolicy2 = {}));

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/create/immutable.mjs
function ImmutableArray2(value) {
  return globalThis.Object.freeze(value).map((value2) => Immutable2(value2));
}
function ImmutableDate2(value) {
  return value;
}
function ImmutableUint8Array2(value) {
  return value;
}
function ImmutableRegExp2(value) {
  return value;
}
function ImmutableObject2(value) {
  const result = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    result[key] = Immutable2(value[key]);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    result[key] = Immutable2(value[key]);
  }
  return globalThis.Object.freeze(result);
}
function Immutable2(value) {
  return IsArray5(value) ? ImmutableArray2(value) : IsDate5(value) ? ImmutableDate2(value) : IsUint8Array5(value) ? ImmutableUint8Array2(value) : IsRegExp4(value) ? ImmutableRegExp2(value) : IsObject5(value) ? ImmutableObject2(value) : value;
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/create/type.mjs
function CreateType2(schema, options) {
  const result = options !== void 0 ? { ...options, ...schema } : schema;
  switch (TypeSystemPolicy2.InstanceMode) {
    case "freeze":
      return Immutable2(result);
    case "clone":
      return Clone3(result);
    default:
      return result;
  }
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/error/error.mjs
var TypeBoxError2 = class extends Error {
  constructor(message) {
    super(message);
  }
};

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/symbols/symbols.mjs
var TransformKind2 = Symbol.for("TypeBox.Transform");
var ReadonlyKind2 = Symbol.for("TypeBox.Readonly");
var OptionalKind2 = Symbol.for("TypeBox.Optional");
var Hint2 = Symbol.for("TypeBox.Hint");
var Kind2 = Symbol.for("TypeBox.Kind");

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/guard/kind.mjs
function IsReadonly(value) {
  return IsObject5(value) && value[ReadonlyKind2] === "Readonly";
}
function IsOptional2(value) {
  return IsObject5(value) && value[OptionalKind2] === "Optional";
}
function IsAny3(value) {
  return IsKindOf3(value, "Any");
}
function IsArgument3(value) {
  return IsKindOf3(value, "Argument");
}
function IsArray7(value) {
  return IsKindOf3(value, "Array");
}
function IsAsyncIterator5(value) {
  return IsKindOf3(value, "AsyncIterator");
}
function IsBigInt6(value) {
  return IsKindOf3(value, "BigInt");
}
function IsBoolean6(value) {
  return IsKindOf3(value, "Boolean");
}
function IsComputed3(value) {
  return IsKindOf3(value, "Computed");
}
function IsConstructor3(value) {
  return IsKindOf3(value, "Constructor");
}
function IsDate6(value) {
  return IsKindOf3(value, "Date");
}
function IsFunction5(value) {
  return IsKindOf3(value, "Function");
}
function IsInteger4(value) {
  return IsKindOf3(value, "Integer");
}
function IsIntersect3(value) {
  return IsKindOf3(value, "Intersect");
}
function IsIterator5(value) {
  return IsKindOf3(value, "Iterator");
}
function IsKindOf3(value, kind) {
  return IsObject5(value) && Kind2 in value && value[Kind2] === kind;
}
function IsLiteralValue2(value) {
  return IsBoolean5(value) || IsNumber5(value) || IsString5(value);
}
function IsLiteral3(value) {
  return IsKindOf3(value, "Literal");
}
function IsMappedKey3(value) {
  return IsKindOf3(value, "MappedKey");
}
function IsMappedResult3(value) {
  return IsKindOf3(value, "MappedResult");
}
function IsNever3(value) {
  return IsKindOf3(value, "Never");
}
function IsNot3(value) {
  return IsKindOf3(value, "Not");
}
function IsNull5(value) {
  return IsKindOf3(value, "Null");
}
function IsNumber7(value) {
  return IsKindOf3(value, "Number");
}
function IsObject7(value) {
  return IsKindOf3(value, "Object");
}
function IsPromise4(value) {
  return IsKindOf3(value, "Promise");
}
function IsRecord3(value) {
  return IsKindOf3(value, "Record");
}
function IsRef3(value) {
  return IsKindOf3(value, "Ref");
}
function IsRegExp5(value) {
  return IsKindOf3(value, "RegExp");
}
function IsString6(value) {
  return IsKindOf3(value, "String");
}
function IsSymbol5(value) {
  return IsKindOf3(value, "Symbol");
}
function IsTemplateLiteral3(value) {
  return IsKindOf3(value, "TemplateLiteral");
}
function IsThis3(value) {
  return IsKindOf3(value, "This");
}
function IsTransform3(value) {
  return IsObject5(value) && TransformKind2 in value;
}
function IsTuple3(value) {
  return IsKindOf3(value, "Tuple");
}
function IsUndefined7(value) {
  return IsKindOf3(value, "Undefined");
}
function IsUnion3(value) {
  return IsKindOf3(value, "Union");
}
function IsUint8Array6(value) {
  return IsKindOf3(value, "Uint8Array");
}
function IsUnknown3(value) {
  return IsKindOf3(value, "Unknown");
}
function IsUnsafe3(value) {
  return IsKindOf3(value, "Unsafe");
}
function IsVoid3(value) {
  return IsKindOf3(value, "Void");
}
function IsKind3(value) {
  return IsObject5(value) && Kind2 in value && IsString5(value[Kind2]);
}
function IsSchema3(value) {
  return IsAny3(value) || IsArgument3(value) || IsArray7(value) || IsBoolean6(value) || IsBigInt6(value) || IsAsyncIterator5(value) || IsComputed3(value) || IsConstructor3(value) || IsDate6(value) || IsFunction5(value) || IsInteger4(value) || IsIntersect3(value) || IsIterator5(value) || IsLiteral3(value) || IsMappedKey3(value) || IsMappedResult3(value) || IsNever3(value) || IsNot3(value) || IsNull5(value) || IsNumber7(value) || IsObject7(value) || IsPromise4(value) || IsRecord3(value) || IsRef3(value) || IsRegExp5(value) || IsString6(value) || IsSymbol5(value) || IsTemplateLiteral3(value) || IsThis3(value) || IsTuple3(value) || IsUndefined7(value) || IsUnion3(value) || IsUint8Array6(value) || IsUnknown3(value) || IsUnsafe3(value) || IsVoid3(value) || IsKind3(value);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/guard/type.mjs
var type_exports2 = {};
__export(type_exports2, {
  IsAny: () => IsAny4,
  IsArgument: () => IsArgument4,
  IsArray: () => IsArray8,
  IsAsyncIterator: () => IsAsyncIterator6,
  IsBigInt: () => IsBigInt7,
  IsBoolean: () => IsBoolean7,
  IsComputed: () => IsComputed4,
  IsConstructor: () => IsConstructor4,
  IsDate: () => IsDate7,
  IsFunction: () => IsFunction6,
  IsImport: () => IsImport,
  IsInteger: () => IsInteger5,
  IsIntersect: () => IsIntersect4,
  IsIterator: () => IsIterator6,
  IsKind: () => IsKind4,
  IsKindOf: () => IsKindOf4,
  IsLiteral: () => IsLiteral4,
  IsLiteralBoolean: () => IsLiteralBoolean,
  IsLiteralNumber: () => IsLiteralNumber,
  IsLiteralString: () => IsLiteralString,
  IsLiteralValue: () => IsLiteralValue3,
  IsMappedKey: () => IsMappedKey4,
  IsMappedResult: () => IsMappedResult4,
  IsNever: () => IsNever4,
  IsNot: () => IsNot4,
  IsNull: () => IsNull6,
  IsNumber: () => IsNumber8,
  IsObject: () => IsObject8,
  IsOptional: () => IsOptional3,
  IsPromise: () => IsPromise5,
  IsProperties: () => IsProperties2,
  IsReadonly: () => IsReadonly2,
  IsRecord: () => IsRecord4,
  IsRecursive: () => IsRecursive,
  IsRef: () => IsRef4,
  IsRegExp: () => IsRegExp6,
  IsSchema: () => IsSchema4,
  IsString: () => IsString7,
  IsSymbol: () => IsSymbol6,
  IsTemplateLiteral: () => IsTemplateLiteral4,
  IsThis: () => IsThis4,
  IsTransform: () => IsTransform4,
  IsTuple: () => IsTuple4,
  IsUint8Array: () => IsUint8Array7,
  IsUndefined: () => IsUndefined8,
  IsUnion: () => IsUnion4,
  IsUnionLiteral: () => IsUnionLiteral,
  IsUnknown: () => IsUnknown4,
  IsUnsafe: () => IsUnsafe4,
  IsVoid: () => IsVoid4,
  TypeGuardUnknownTypeError: () => TypeGuardUnknownTypeError
});
var TypeGuardUnknownTypeError = class extends TypeBoxError2 {
};
var KnownTypes2 = [
  "Argument",
  "Any",
  "Array",
  "AsyncIterator",
  "BigInt",
  "Boolean",
  "Computed",
  "Constructor",
  "Date",
  "Enum",
  "Function",
  "Integer",
  "Intersect",
  "Iterator",
  "Literal",
  "MappedKey",
  "MappedResult",
  "Not",
  "Null",
  "Number",
  "Object",
  "Promise",
  "Record",
  "Ref",
  "RegExp",
  "String",
  "Symbol",
  "TemplateLiteral",
  "This",
  "Tuple",
  "Undefined",
  "Union",
  "Uint8Array",
  "Unknown",
  "Void"
];
function IsPattern2(value) {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}
function IsControlCharacterFree2(value) {
  if (!IsString5(value))
    return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 7 && code <= 13 || code === 27 || code === 127) {
      return false;
    }
  }
  return true;
}
function IsAdditionalProperties2(value) {
  return IsOptionalBoolean2(value) || IsSchema4(value);
}
function IsOptionalBigInt2(value) {
  return IsUndefined5(value) || IsBigInt5(value);
}
function IsOptionalNumber2(value) {
  return IsUndefined5(value) || IsNumber5(value);
}
function IsOptionalBoolean2(value) {
  return IsUndefined5(value) || IsBoolean5(value);
}
function IsOptionalString2(value) {
  return IsUndefined5(value) || IsString5(value);
}
function IsOptionalPattern2(value) {
  return IsUndefined5(value) || IsString5(value) && IsControlCharacterFree2(value) && IsPattern2(value);
}
function IsOptionalFormat2(value) {
  return IsUndefined5(value) || IsString5(value) && IsControlCharacterFree2(value);
}
function IsOptionalSchema2(value) {
  return IsUndefined5(value) || IsSchema4(value);
}
function IsReadonly2(value) {
  return IsObject5(value) && value[ReadonlyKind2] === "Readonly";
}
function IsOptional3(value) {
  return IsObject5(value) && value[OptionalKind2] === "Optional";
}
function IsAny4(value) {
  return IsKindOf4(value, "Any") && IsOptionalString2(value.$id);
}
function IsArgument4(value) {
  return IsKindOf4(value, "Argument") && IsNumber5(value.index);
}
function IsArray8(value) {
  return IsKindOf4(value, "Array") && value.type === "array" && IsOptionalString2(value.$id) && IsSchema4(value.items) && IsOptionalNumber2(value.minItems) && IsOptionalNumber2(value.maxItems) && IsOptionalBoolean2(value.uniqueItems) && IsOptionalSchema2(value.contains) && IsOptionalNumber2(value.minContains) && IsOptionalNumber2(value.maxContains);
}
function IsAsyncIterator6(value) {
  return IsKindOf4(value, "AsyncIterator") && value.type === "AsyncIterator" && IsOptionalString2(value.$id) && IsSchema4(value.items);
}
function IsBigInt7(value) {
  return IsKindOf4(value, "BigInt") && value.type === "bigint" && IsOptionalString2(value.$id) && IsOptionalBigInt2(value.exclusiveMaximum) && IsOptionalBigInt2(value.exclusiveMinimum) && IsOptionalBigInt2(value.maximum) && IsOptionalBigInt2(value.minimum) && IsOptionalBigInt2(value.multipleOf);
}
function IsBoolean7(value) {
  return IsKindOf4(value, "Boolean") && value.type === "boolean" && IsOptionalString2(value.$id);
}
function IsComputed4(value) {
  return IsKindOf4(value, "Computed") && IsString5(value.target) && IsArray5(value.parameters) && value.parameters.every((schema) => IsSchema4(schema));
}
function IsConstructor4(value) {
  return IsKindOf4(value, "Constructor") && value.type === "Constructor" && IsOptionalString2(value.$id) && IsArray5(value.parameters) && value.parameters.every((schema) => IsSchema4(schema)) && IsSchema4(value.returns);
}
function IsDate7(value) {
  return IsKindOf4(value, "Date") && value.type === "Date" && IsOptionalString2(value.$id) && IsOptionalNumber2(value.exclusiveMaximumTimestamp) && IsOptionalNumber2(value.exclusiveMinimumTimestamp) && IsOptionalNumber2(value.maximumTimestamp) && IsOptionalNumber2(value.minimumTimestamp) && IsOptionalNumber2(value.multipleOfTimestamp);
}
function IsFunction6(value) {
  return IsKindOf4(value, "Function") && value.type === "Function" && IsOptionalString2(value.$id) && IsArray5(value.parameters) && value.parameters.every((schema) => IsSchema4(schema)) && IsSchema4(value.returns);
}
function IsImport(value) {
  return IsKindOf4(value, "Import") && HasPropertyKey3(value, "$defs") && IsObject5(value.$defs) && IsProperties2(value.$defs) && HasPropertyKey3(value, "$ref") && IsString5(value.$ref) && value.$ref in value.$defs;
}
function IsInteger5(value) {
  return IsKindOf4(value, "Integer") && value.type === "integer" && IsOptionalString2(value.$id) && IsOptionalNumber2(value.exclusiveMaximum) && IsOptionalNumber2(value.exclusiveMinimum) && IsOptionalNumber2(value.maximum) && IsOptionalNumber2(value.minimum) && IsOptionalNumber2(value.multipleOf);
}
function IsProperties2(value) {
  return IsObject5(value) && Object.entries(value).every(([key, schema]) => IsControlCharacterFree2(key) && IsSchema4(schema));
}
function IsIntersect4(value) {
  return IsKindOf4(value, "Intersect") && (IsString5(value.type) && value.type !== "object" ? false : true) && IsArray5(value.allOf) && value.allOf.every((schema) => IsSchema4(schema) && !IsTransform4(schema)) && IsOptionalString2(value.type) && (IsOptionalBoolean2(value.unevaluatedProperties) || IsOptionalSchema2(value.unevaluatedProperties)) && IsOptionalString2(value.$id);
}
function IsIterator6(value) {
  return IsKindOf4(value, "Iterator") && value.type === "Iterator" && IsOptionalString2(value.$id) && IsSchema4(value.items);
}
function IsKindOf4(value, kind) {
  return IsObject5(value) && Kind2 in value && value[Kind2] === kind;
}
function IsLiteralString(value) {
  return IsLiteral4(value) && IsString5(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral4(value) && IsNumber5(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral4(value) && IsBoolean5(value.const);
}
function IsLiteral4(value) {
  return IsKindOf4(value, "Literal") && IsOptionalString2(value.$id) && IsLiteralValue3(value.const);
}
function IsLiteralValue3(value) {
  return IsBoolean5(value) || IsNumber5(value) || IsString5(value);
}
function IsMappedKey4(value) {
  return IsKindOf4(value, "MappedKey") && IsArray5(value.keys) && value.keys.every((key) => IsNumber5(key) || IsString5(key));
}
function IsMappedResult4(value) {
  return IsKindOf4(value, "MappedResult") && IsProperties2(value.properties);
}
function IsNever4(value) {
  return IsKindOf4(value, "Never") && IsObject5(value.not) && Object.getOwnPropertyNames(value.not).length === 0;
}
function IsNot4(value) {
  return IsKindOf4(value, "Not") && IsSchema4(value.not);
}
function IsNull6(value) {
  return IsKindOf4(value, "Null") && value.type === "null" && IsOptionalString2(value.$id);
}
function IsNumber8(value) {
  return IsKindOf4(value, "Number") && value.type === "number" && IsOptionalString2(value.$id) && IsOptionalNumber2(value.exclusiveMaximum) && IsOptionalNumber2(value.exclusiveMinimum) && IsOptionalNumber2(value.maximum) && IsOptionalNumber2(value.minimum) && IsOptionalNumber2(value.multipleOf);
}
function IsObject8(value) {
  return IsKindOf4(value, "Object") && value.type === "object" && IsOptionalString2(value.$id) && IsProperties2(value.properties) && IsAdditionalProperties2(value.additionalProperties) && IsOptionalNumber2(value.minProperties) && IsOptionalNumber2(value.maxProperties);
}
function IsPromise5(value) {
  return IsKindOf4(value, "Promise") && value.type === "Promise" && IsOptionalString2(value.$id) && IsSchema4(value.item);
}
function IsRecord4(value) {
  return IsKindOf4(value, "Record") && value.type === "object" && IsOptionalString2(value.$id) && IsAdditionalProperties2(value.additionalProperties) && IsObject5(value.patternProperties) && ((schema) => {
    const keys = Object.getOwnPropertyNames(schema.patternProperties);
    return keys.length === 1 && IsPattern2(keys[0]) && IsObject5(schema.patternProperties) && IsSchema4(schema.patternProperties[keys[0]]);
  })(value);
}
function IsRecursive(value) {
  return IsObject5(value) && Hint2 in value && value[Hint2] === "Recursive";
}
function IsRef4(value) {
  return IsKindOf4(value, "Ref") && IsOptionalString2(value.$id) && IsString5(value.$ref);
}
function IsRegExp6(value) {
  return IsKindOf4(value, "RegExp") && IsOptionalString2(value.$id) && IsString5(value.source) && IsString5(value.flags) && IsOptionalNumber2(value.maxLength) && IsOptionalNumber2(value.minLength);
}
function IsString7(value) {
  return IsKindOf4(value, "String") && value.type === "string" && IsOptionalString2(value.$id) && IsOptionalNumber2(value.minLength) && IsOptionalNumber2(value.maxLength) && IsOptionalPattern2(value.pattern) && IsOptionalFormat2(value.format);
}
function IsSymbol6(value) {
  return IsKindOf4(value, "Symbol") && value.type === "symbol" && IsOptionalString2(value.$id);
}
function IsTemplateLiteral4(value) {
  return IsKindOf4(value, "TemplateLiteral") && value.type === "string" && IsString5(value.pattern) && value.pattern[0] === "^" && value.pattern[value.pattern.length - 1] === "$";
}
function IsThis4(value) {
  return IsKindOf4(value, "This") && IsOptionalString2(value.$id) && IsString5(value.$ref);
}
function IsTransform4(value) {
  return IsObject5(value) && TransformKind2 in value;
}
function IsTuple4(value) {
  return IsKindOf4(value, "Tuple") && value.type === "array" && IsOptionalString2(value.$id) && IsNumber5(value.minItems) && IsNumber5(value.maxItems) && value.minItems === value.maxItems && // empty
  (IsUndefined5(value.items) && IsUndefined5(value.additionalItems) && value.minItems === 0 || IsArray5(value.items) && value.items.every((schema) => IsSchema4(schema)));
}
function IsUndefined8(value) {
  return IsKindOf4(value, "Undefined") && value.type === "undefined" && IsOptionalString2(value.$id);
}
function IsUnionLiteral(value) {
  return IsUnion4(value) && value.anyOf.every((schema) => IsLiteralString(schema) || IsLiteralNumber(schema));
}
function IsUnion4(value) {
  return IsKindOf4(value, "Union") && IsOptionalString2(value.$id) && IsObject5(value) && IsArray5(value.anyOf) && value.anyOf.every((schema) => IsSchema4(schema));
}
function IsUint8Array7(value) {
  return IsKindOf4(value, "Uint8Array") && value.type === "Uint8Array" && IsOptionalString2(value.$id) && IsOptionalNumber2(value.minByteLength) && IsOptionalNumber2(value.maxByteLength);
}
function IsUnknown4(value) {
  return IsKindOf4(value, "Unknown") && IsOptionalString2(value.$id);
}
function IsUnsafe4(value) {
  return IsKindOf4(value, "Unsafe");
}
function IsVoid4(value) {
  return IsKindOf4(value, "Void") && value.type === "void" && IsOptionalString2(value.$id);
}
function IsKind4(value) {
  return IsObject5(value) && Kind2 in value && IsString5(value[Kind2]) && !KnownTypes2.includes(value[Kind2]);
}
function IsSchema4(value) {
  return IsObject5(value) && (IsAny4(value) || IsArgument4(value) || IsArray8(value) || IsBoolean7(value) || IsBigInt7(value) || IsAsyncIterator6(value) || IsComputed4(value) || IsConstructor4(value) || IsDate7(value) || IsFunction6(value) || IsInteger5(value) || IsIntersect4(value) || IsIterator6(value) || IsLiteral4(value) || IsMappedKey4(value) || IsMappedResult4(value) || IsNever4(value) || IsNot4(value) || IsNull6(value) || IsNumber8(value) || IsObject8(value) || IsPromise5(value) || IsRecord4(value) || IsRef4(value) || IsRegExp6(value) || IsString7(value) || IsSymbol6(value) || IsTemplateLiteral4(value) || IsThis4(value) || IsTuple4(value) || IsUndefined8(value) || IsUnion4(value) || IsUint8Array7(value) || IsUnknown4(value) || IsUnsafe4(value) || IsVoid4(value) || IsKind4(value));
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/patterns/patterns.mjs
var PatternBoolean = "(true|false)";
var PatternNumber = "(0|[1-9][0-9]*)";
var PatternString = "(.*)";
var PatternNever = "(?!.*)";
var PatternBooleanExact = `^${PatternBoolean}$`;
var PatternNumberExact = `^${PatternNumber}$`;
var PatternStringExact = `^${PatternString}$`;
var PatternNeverExact = `^${PatternNever}$`;

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/sets/set.mjs
function SetIncludes(T, S) {
  return T.includes(S);
}
function SetDistinct(T) {
  return [...new Set(T)];
}
function SetIntersect2(T, S) {
  return T.filter((L) => S.includes(L));
}
function SetIntersectManyResolve2(T, Init) {
  return T.reduce((Acc, L) => {
    return SetIntersect2(Acc, L);
  }, Init);
}
function SetIntersectMany2(T) {
  return T.length === 1 ? T[0] : T.length > 1 ? SetIntersectManyResolve2(T.slice(1), T[0]) : [];
}
function SetUnionMany2(T) {
  const Acc = [];
  for (const L of T)
    Acc.push(...L);
  return Acc;
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/any/any.mjs
function Any(options) {
  return CreateType2({ [Kind2]: "Any" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/array/array.mjs
function Array2(items, options) {
  return CreateType2({ [Kind2]: "Array", type: "array", items }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/argument/argument.mjs
function Argument(index) {
  return CreateType2({ [Kind2]: "Argument", index });
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/async-iterator/async-iterator.mjs
function AsyncIterator(items, options) {
  return CreateType2({ [Kind2]: "AsyncIterator", type: "AsyncIterator", items }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/computed/computed.mjs
function Computed(target, parameters, options) {
  return CreateType2({ [Kind2]: "Computed", target, parameters }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/discard/discard.mjs
function DiscardKey2(value, key) {
  const { [key]: _, ...rest } = value;
  return rest;
}
function Discard2(value, keys) {
  return keys.reduce((acc, key) => DiscardKey2(acc, key), value);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/never/never.mjs
function Never2(options) {
  return CreateType2({ [Kind2]: "Never", not: {} }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/mapped/mapped-result.mjs
function MappedResult2(properties) {
  return CreateType2({
    [Kind2]: "MappedResult",
    properties
  });
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/constructor/constructor.mjs
function Constructor(parameters, returns, options) {
  return CreateType2({ [Kind2]: "Constructor", type: "Constructor", parameters, returns }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/function/function.mjs
function Function(parameters, returns, options) {
  return CreateType2({ [Kind2]: "Function", type: "Function", parameters, returns }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/union/union-create.mjs
function UnionCreate2(T, options) {
  return CreateType2({ [Kind2]: "Union", anyOf: T }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/union/union-evaluated.mjs
function IsUnionOptional2(types) {
  return types.some((type) => IsOptional2(type));
}
function RemoveOptionalFromRest3(types) {
  return types.map((left) => IsOptional2(left) ? RemoveOptionalFromType3(left) : left);
}
function RemoveOptionalFromType3(T) {
  return Discard2(T, [OptionalKind2]);
}
function ResolveUnion2(types, options) {
  const isOptional = IsUnionOptional2(types);
  return isOptional ? Optional2(UnionCreate2(RemoveOptionalFromRest3(types), options)) : UnionCreate2(RemoveOptionalFromRest3(types), options);
}
function UnionEvaluated2(T, options) {
  return T.length === 1 ? CreateType2(T[0], options) : T.length === 0 ? Never2(options) : ResolveUnion2(T, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/union/union.mjs
function Union3(types, options) {
  return types.length === 0 ? Never2(options) : types.length === 1 ? CreateType2(types[0], options) : UnionCreate2(types, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/template-literal/parse.mjs
var TemplateLiteralParserError2 = class extends TypeBoxError2 {
};
function Unescape2(pattern) {
  return pattern.replace(/\\\$/g, "$").replace(/\\\*/g, "*").replace(/\\\^/g, "^").replace(/\\\|/g, "|").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}
function IsNonEscaped2(pattern, index, char) {
  return pattern[index] === char && pattern.charCodeAt(index - 1) !== 92;
}
function IsOpenParen2(pattern, index) {
  return IsNonEscaped2(pattern, index, "(");
}
function IsCloseParen2(pattern, index) {
  return IsNonEscaped2(pattern, index, ")");
}
function IsSeparator2(pattern, index) {
  return IsNonEscaped2(pattern, index, "|");
}
function IsGroup2(pattern) {
  if (!(IsOpenParen2(pattern, 0) && IsCloseParen2(pattern, pattern.length - 1)))
    return false;
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen2(pattern, index))
      count += 1;
    if (IsCloseParen2(pattern, index))
      count -= 1;
    if (count === 0 && index !== pattern.length - 1)
      return false;
  }
  return true;
}
function InGroup2(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function IsPrecedenceOr2(pattern) {
  let count = 0;
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen2(pattern, index))
      count += 1;
    if (IsCloseParen2(pattern, index))
      count -= 1;
    if (IsSeparator2(pattern, index) && count === 0)
      return true;
  }
  return false;
}
function IsPrecedenceAnd2(pattern) {
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen2(pattern, index))
      return true;
  }
  return false;
}
function Or2(pattern) {
  let [count, start] = [0, 0];
  const expressions = [];
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen2(pattern, index))
      count += 1;
    if (IsCloseParen2(pattern, index))
      count -= 1;
    if (IsSeparator2(pattern, index) && count === 0) {
      const range2 = pattern.slice(start, index);
      if (range2.length > 0)
        expressions.push(TemplateLiteralParse2(range2));
      start = index + 1;
    }
  }
  const range = pattern.slice(start);
  if (range.length > 0)
    expressions.push(TemplateLiteralParse2(range));
  if (expressions.length === 0)
    return { type: "const", const: "" };
  if (expressions.length === 1)
    return expressions[0];
  return { type: "or", expr: expressions };
}
function And2(pattern) {
  function Group(value, index) {
    if (!IsOpenParen2(value, index))
      throw new TemplateLiteralParserError2(`TemplateLiteralParser: Index must point to open parens`);
    let count = 0;
    for (let scan = index; scan < value.length; scan++) {
      if (IsOpenParen2(value, scan))
        count += 1;
      if (IsCloseParen2(value, scan))
        count -= 1;
      if (count === 0)
        return [index, scan];
    }
    throw new TemplateLiteralParserError2(`TemplateLiteralParser: Unclosed group parens in expression`);
  }
  function Range(pattern2, index) {
    for (let scan = index; scan < pattern2.length; scan++) {
      if (IsOpenParen2(pattern2, scan))
        return [index, scan];
    }
    return [index, pattern2.length];
  }
  const expressions = [];
  for (let index = 0; index < pattern.length; index++) {
    if (IsOpenParen2(pattern, index)) {
      const [start, end] = Group(pattern, index);
      const range = pattern.slice(start, end + 1);
      expressions.push(TemplateLiteralParse2(range));
      index = end;
    } else {
      const [start, end] = Range(pattern, index);
      const range = pattern.slice(start, end);
      if (range.length > 0)
        expressions.push(TemplateLiteralParse2(range));
      index = end - 1;
    }
  }
  return expressions.length === 0 ? { type: "const", const: "" } : expressions.length === 1 ? expressions[0] : { type: "and", expr: expressions };
}
function TemplateLiteralParse2(pattern) {
  return IsGroup2(pattern) ? TemplateLiteralParse2(InGroup2(pattern)) : IsPrecedenceOr2(pattern) ? Or2(pattern) : IsPrecedenceAnd2(pattern) ? And2(pattern) : { type: "const", const: Unescape2(pattern) };
}
function TemplateLiteralParseExact2(pattern) {
  return TemplateLiteralParse2(pattern.slice(1, pattern.length - 1));
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/template-literal/finite.mjs
var TemplateLiteralFiniteError2 = class extends TypeBoxError2 {
};
function IsNumberExpression2(expression) {
  return expression.type === "or" && expression.expr.length === 2 && expression.expr[0].type === "const" && expression.expr[0].const === "0" && expression.expr[1].type === "const" && expression.expr[1].const === "[1-9][0-9]*";
}
function IsBooleanExpression2(expression) {
  return expression.type === "or" && expression.expr.length === 2 && expression.expr[0].type === "const" && expression.expr[0].const === "true" && expression.expr[1].type === "const" && expression.expr[1].const === "false";
}
function IsStringExpression2(expression) {
  return expression.type === "const" && expression.const === ".*";
}
function IsTemplateLiteralExpressionFinite2(expression) {
  return IsNumberExpression2(expression) || IsStringExpression2(expression) ? false : IsBooleanExpression2(expression) ? true : expression.type === "and" ? expression.expr.every((expr) => IsTemplateLiteralExpressionFinite2(expr)) : expression.type === "or" ? expression.expr.every((expr) => IsTemplateLiteralExpressionFinite2(expr)) : expression.type === "const" ? true : (() => {
    throw new TemplateLiteralFiniteError2(`Unknown expression type`);
  })();
}
function IsTemplateLiteralFinite2(schema) {
  const expression = TemplateLiteralParseExact2(schema.pattern);
  return IsTemplateLiteralExpressionFinite2(expression);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/template-literal/generate.mjs
var TemplateLiteralGenerateError2 = class extends TypeBoxError2 {
};
function* GenerateReduce2(buffer) {
  if (buffer.length === 1)
    return yield* buffer[0];
  for (const left of buffer[0]) {
    for (const right of GenerateReduce2(buffer.slice(1))) {
      yield `${left}${right}`;
    }
  }
}
function* GenerateAnd2(expression) {
  return yield* GenerateReduce2(expression.expr.map((expr) => [...TemplateLiteralExpressionGenerate2(expr)]));
}
function* GenerateOr2(expression) {
  for (const expr of expression.expr)
    yield* TemplateLiteralExpressionGenerate2(expr);
}
function* GenerateConst2(expression) {
  return yield expression.const;
}
function* TemplateLiteralExpressionGenerate2(expression) {
  return expression.type === "and" ? yield* GenerateAnd2(expression) : expression.type === "or" ? yield* GenerateOr2(expression) : expression.type === "const" ? yield* GenerateConst2(expression) : (() => {
    throw new TemplateLiteralGenerateError2("Unknown expression");
  })();
}
function TemplateLiteralGenerate2(schema) {
  const expression = TemplateLiteralParseExact2(schema.pattern);
  return IsTemplateLiteralExpressionFinite2(expression) ? [...TemplateLiteralExpressionGenerate2(expression)] : [];
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/literal/literal.mjs
function Literal2(value, options) {
  return CreateType2({
    [Kind2]: "Literal",
    const: value,
    type: typeof value
  }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/boolean/boolean.mjs
function Boolean2(options) {
  return CreateType2({ [Kind2]: "Boolean", type: "boolean" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/bigint/bigint.mjs
function BigInt2(options) {
  return CreateType2({ [Kind2]: "BigInt", type: "bigint" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/number/number.mjs
function Number2(options) {
  return CreateType2({ [Kind2]: "Number", type: "number" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/string/string.mjs
function String3(options) {
  return CreateType2({ [Kind2]: "String", type: "string" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/template-literal/syntax.mjs
function* FromUnion13(syntax) {
  const trim = syntax.trim().replace(/"|'/g, "");
  return trim === "boolean" ? yield Boolean2() : trim === "number" ? yield Number2() : trim === "bigint" ? yield BigInt2() : trim === "string" ? yield String3() : yield (() => {
    const literals = trim.split("|").map((literal) => Literal2(literal.trim()));
    return literals.length === 0 ? Never2() : literals.length === 1 ? literals[0] : UnionEvaluated2(literals);
  })();
}
function* FromTerminal(syntax) {
  if (syntax[1] !== "{") {
    const L = Literal2("$");
    const R = FromSyntax(syntax.slice(1));
    return yield* [L, ...R];
  }
  for (let i = 2; i < syntax.length; i++) {
    if (syntax[i] === "}") {
      const L = FromUnion13(syntax.slice(2, i));
      const R = FromSyntax(syntax.slice(i + 1));
      return yield* [...L, ...R];
    }
  }
  yield Literal2(syntax);
}
function* FromSyntax(syntax) {
  for (let i = 0; i < syntax.length; i++) {
    if (syntax[i] === "$") {
      const L = Literal2(syntax.slice(0, i));
      const R = FromTerminal(syntax.slice(i));
      return yield* [L, ...R];
    }
  }
  yield Literal2(syntax);
}
function TemplateLiteralSyntax(syntax) {
  return [...FromSyntax(syntax)];
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/template-literal/pattern.mjs
var TemplateLiteralPatternError = class extends TypeBoxError2 {
};
function Escape2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function Visit16(schema, acc) {
  return IsTemplateLiteral3(schema) ? schema.pattern.slice(1, schema.pattern.length - 1) : IsUnion3(schema) ? `(${schema.anyOf.map((schema2) => Visit16(schema2, acc)).join("|")})` : IsNumber7(schema) ? `${acc}${PatternNumber}` : IsInteger4(schema) ? `${acc}${PatternNumber}` : IsBigInt6(schema) ? `${acc}${PatternNumber}` : IsString6(schema) ? `${acc}${PatternString}` : IsLiteral3(schema) ? `${acc}${Escape2(schema.const.toString())}` : IsBoolean6(schema) ? `${acc}${PatternBoolean}` : (() => {
    throw new TemplateLiteralPatternError(`Unexpected Kind '${schema[Kind2]}'`);
  })();
}
function TemplateLiteralPattern(kinds) {
  return `^${kinds.map((schema) => Visit16(schema, "")).join("")}$`;
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/template-literal/union.mjs
function TemplateLiteralToUnion(schema) {
  const R = TemplateLiteralGenerate2(schema);
  const L = R.map((S) => Literal2(S));
  return UnionEvaluated2(L);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/template-literal/template-literal.mjs
function TemplateLiteral(unresolved, options) {
  const pattern = IsString5(unresolved) ? TemplateLiteralPattern(TemplateLiteralSyntax(unresolved)) : TemplateLiteralPattern(unresolved);
  return CreateType2({ [Kind2]: "TemplateLiteral", type: "string", pattern }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-property-keys.mjs
function FromTemplateLiteral4(templateLiteral) {
  const keys = TemplateLiteralGenerate2(templateLiteral);
  return keys.map((key) => key.toString());
}
function FromUnion14(types) {
  const result = [];
  for (const type of types)
    result.push(...IndexPropertyKeys(type));
  return result;
}
function FromLiteral5(literalValue) {
  return [literalValue.toString()];
}
function IndexPropertyKeys(type) {
  return [...new Set(IsTemplateLiteral3(type) ? FromTemplateLiteral4(type) : IsUnion3(type) ? FromUnion14(type.anyOf) : IsLiteral3(type) ? FromLiteral5(type.const) : IsNumber7(type) ? ["[number]"] : IsInteger4(type) ? ["[number]"] : [])];
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-from-mapped-result.mjs
function FromProperties3(type, properties, options) {
  const result = {};
  for (const K2 of Object.getOwnPropertyNames(properties)) {
    result[K2] = Index(type, IndexPropertyKeys(properties[K2]), options);
  }
  return result;
}
function FromMappedResult2(type, mappedResult, options) {
  return FromProperties3(type, mappedResult.properties, options);
}
function IndexFromMappedResult(type, mappedResult, options) {
  const properties = FromMappedResult2(type, mappedResult, options);
  return MappedResult2(properties);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed.mjs
function FromRest3(types, key) {
  return types.map((type) => IndexFromPropertyKey2(type, key));
}
function FromIntersectRest2(types) {
  return types.filter((type) => !IsNever3(type));
}
function FromIntersect13(types, key) {
  return IntersectEvaluated2(FromIntersectRest2(FromRest3(types, key)));
}
function FromUnionRest2(types) {
  return types.some((L) => IsNever3(L)) ? [] : types;
}
function FromUnion15(types, key) {
  return UnionEvaluated2(FromUnionRest2(FromRest3(types, key)));
}
function FromTuple13(types, key) {
  return key in types ? types[key] : key === "[number]" ? UnionEvaluated2(types) : Never2();
}
function FromArray14(type, key) {
  return key === "[number]" ? type : Never2();
}
function FromProperty2(properties, propertyKey) {
  return propertyKey in properties ? properties[propertyKey] : Never2();
}
function IndexFromPropertyKey2(type, propertyKey) {
  return IsIntersect3(type) ? FromIntersect13(type.allOf, propertyKey) : IsUnion3(type) ? FromUnion15(type.anyOf, propertyKey) : IsTuple3(type) ? FromTuple13(type.items ?? [], propertyKey) : IsArray7(type) ? FromArray14(type.items, propertyKey) : IsObject7(type) ? FromProperty2(type.properties, propertyKey) : Never2();
}
function IndexFromPropertyKeys2(type, propertyKeys) {
  return propertyKeys.map((propertyKey) => IndexFromPropertyKey2(type, propertyKey));
}
function FromSchema(type, propertyKeys) {
  return UnionEvaluated2(IndexFromPropertyKeys2(type, propertyKeys));
}
function Index(type, key, options) {
  if (IsRef3(type) || IsRef3(key)) {
    const error = `Index types using Ref parameters require both Type and Key to be of TSchema`;
    if (!IsSchema3(type) || !IsSchema3(key))
      throw new TypeBoxError2(error);
    return Computed("Index", [type, key]);
  }
  if (IsMappedResult3(key))
    return IndexFromMappedResult(type, key, options);
  if (IsMappedKey3(key))
    return IndexFromMappedKey(type, key, options);
  return CreateType2(IsSchema3(key) ? FromSchema(type, IndexPropertyKeys(key)) : FromSchema(type, key), options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/indexed/indexed-from-mapped-key.mjs
function MappedIndexPropertyKey(type, key, options) {
  return { [key]: Index(type, [key], Clone3(options)) };
}
function MappedIndexPropertyKeys(type, propertyKeys, options) {
  return propertyKeys.reduce((result, left) => {
    return { ...result, ...MappedIndexPropertyKey(type, left, options) };
  }, {});
}
function MappedIndexProperties(type, mappedKey, options) {
  return MappedIndexPropertyKeys(type, mappedKey.keys, options);
}
function IndexFromMappedKey(type, mappedKey, options) {
  const properties = MappedIndexProperties(type, mappedKey, options);
  return MappedResult2(properties);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/iterator/iterator.mjs
function Iterator(items, options) {
  return CreateType2({ [Kind2]: "Iterator", type: "Iterator", items }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/object/object.mjs
function RequiredArray2(properties) {
  return globalThis.Object.keys(properties).filter((key) => !IsOptional2(properties[key]));
}
function _Object2(properties, options) {
  const required2 = RequiredArray2(properties);
  const schema = required2.length > 0 ? { [Kind2]: "Object", type: "object", required: required2, properties } : { [Kind2]: "Object", type: "object", properties };
  return CreateType2(schema, options);
}
var Object3 = _Object2;

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/promise/promise.mjs
function Promise2(item, options) {
  return CreateType2({ [Kind2]: "Promise", type: "Promise", item }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/readonly/readonly.mjs
function RemoveReadonly(schema) {
  return CreateType2(Discard2(schema, [ReadonlyKind2]));
}
function AddReadonly(schema) {
  return CreateType2({ ...schema, [ReadonlyKind2]: "Readonly" });
}
function ReadonlyWithFlag(schema, F) {
  return F === false ? RemoveReadonly(schema) : AddReadonly(schema);
}
function Readonly(schema, enable) {
  const F = enable ?? true;
  return IsMappedResult3(schema) ? ReadonlyFromMappedResult(schema, F) : ReadonlyWithFlag(schema, F);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/readonly/readonly-from-mapped-result.mjs
function FromProperties4(K, F) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(K))
    Acc[K2] = Readonly(K[K2], F);
  return Acc;
}
function FromMappedResult3(R, F) {
  return FromProperties4(R.properties, F);
}
function ReadonlyFromMappedResult(R, F) {
  const P = FromMappedResult3(R, F);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/tuple/tuple.mjs
function Tuple(types, options) {
  return CreateType2(types.length > 0 ? { [Kind2]: "Tuple", type: "array", items: types, additionalItems: false, minItems: types.length, maxItems: types.length } : { [Kind2]: "Tuple", type: "array", minItems: types.length, maxItems: types.length }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/mapped/mapped.mjs
function FromMappedResult4(K, P) {
  return K in P ? FromSchemaType(K, P[K]) : MappedResult2(P);
}
function MappedKeyToKnownMappedResultProperties(K) {
  return { [K]: Literal2(K) };
}
function MappedKeyToUnknownMappedResultProperties(P) {
  const Acc = {};
  for (const L of P)
    Acc[L] = Literal2(L);
  return Acc;
}
function MappedKeyToMappedResultProperties(K, P) {
  return SetIncludes(P, K) ? MappedKeyToKnownMappedResultProperties(K) : MappedKeyToUnknownMappedResultProperties(P);
}
function FromMappedKey(K, P) {
  const R = MappedKeyToMappedResultProperties(K, P);
  return FromMappedResult4(K, R);
}
function FromRest4(K, T) {
  return T.map((L) => FromSchemaType(K, L));
}
function FromProperties5(K, T) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(T))
    Acc[K2] = FromSchemaType(K, T[K2]);
  return Acc;
}
function FromSchemaType(K, T) {
  const options = { ...T };
  return (
    // unevaluated modifier types
    IsOptional2(T) ? Optional2(FromSchemaType(K, Discard2(T, [OptionalKind2]))) : IsReadonly(T) ? Readonly(FromSchemaType(K, Discard2(T, [ReadonlyKind2]))) : (
      // unevaluated mapped types
      IsMappedResult3(T) ? FromMappedResult4(K, T.properties) : IsMappedKey3(T) ? FromMappedKey(K, T.keys) : (
        // unevaluated types
        IsConstructor3(T) ? Constructor(FromRest4(K, T.parameters), FromSchemaType(K, T.returns), options) : IsFunction5(T) ? Function(FromRest4(K, T.parameters), FromSchemaType(K, T.returns), options) : IsAsyncIterator5(T) ? AsyncIterator(FromSchemaType(K, T.items), options) : IsIterator5(T) ? Iterator(FromSchemaType(K, T.items), options) : IsIntersect3(T) ? Intersect2(FromRest4(K, T.allOf), options) : IsUnion3(T) ? Union3(FromRest4(K, T.anyOf), options) : IsTuple3(T) ? Tuple(FromRest4(K, T.items ?? []), options) : IsObject7(T) ? Object3(FromProperties5(K, T.properties), options) : IsArray7(T) ? Array2(FromSchemaType(K, T.items), options) : IsPromise4(T) ? Promise2(FromSchemaType(K, T.item), options) : T
      )
    )
  );
}
function MappedFunctionReturnType(K, T) {
  const Acc = {};
  for (const L of K)
    Acc[L] = FromSchemaType(L, T);
  return Acc;
}
function Mapped(key, map3, options) {
  const K = IsSchema3(key) ? IndexPropertyKeys(key) : key;
  const RT = map3({ [Kind2]: "MappedKey", keys: K });
  const R = MappedFunctionReturnType(K, RT);
  return Object3(R, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/optional/optional.mjs
function RemoveOptional2(schema) {
  return CreateType2(Discard2(schema, [OptionalKind2]));
}
function AddOptional2(schema) {
  return CreateType2({ ...schema, [OptionalKind2]: "Optional" });
}
function OptionalWithFlag2(schema, F) {
  return F === false ? RemoveOptional2(schema) : AddOptional2(schema);
}
function Optional2(schema, enable) {
  const F = enable ?? true;
  return IsMappedResult3(schema) ? OptionalFromMappedResult2(schema, F) : OptionalWithFlag2(schema, F);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/optional/optional-from-mapped-result.mjs
function FromProperties6(P, F) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Optional2(P[K2], F);
  return Acc;
}
function FromMappedResult5(R, F) {
  return FromProperties6(R.properties, F);
}
function OptionalFromMappedResult2(R, F) {
  const P = FromMappedResult5(R, F);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-create.mjs
function IntersectCreate2(T, options = {}) {
  const allObjects = T.every((schema) => IsObject7(schema));
  const clonedUnevaluatedProperties = IsSchema3(options.unevaluatedProperties) ? { unevaluatedProperties: options.unevaluatedProperties } : {};
  return CreateType2(options.unevaluatedProperties === false || IsSchema3(options.unevaluatedProperties) || allObjects ? { ...clonedUnevaluatedProperties, [Kind2]: "Intersect", type: "object", allOf: T } : { ...clonedUnevaluatedProperties, [Kind2]: "Intersect", allOf: T }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect-evaluated.mjs
function IsIntersectOptional2(types) {
  return types.every((left) => IsOptional2(left));
}
function RemoveOptionalFromType4(type) {
  return Discard2(type, [OptionalKind2]);
}
function RemoveOptionalFromRest4(types) {
  return types.map((left) => IsOptional2(left) ? RemoveOptionalFromType4(left) : left);
}
function ResolveIntersect2(types, options) {
  return IsIntersectOptional2(types) ? Optional2(IntersectCreate2(RemoveOptionalFromRest4(types), options)) : IntersectCreate2(RemoveOptionalFromRest4(types), options);
}
function IntersectEvaluated2(types, options = {}) {
  if (types.length === 1)
    return CreateType2(types[0], options);
  if (types.length === 0)
    return Never2(options);
  if (types.some((schema) => IsTransform3(schema)))
    throw new Error("Cannot intersect transform types");
  return ResolveIntersect2(types, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intersect/intersect.mjs
function Intersect2(types, options) {
  if (types.length === 1)
    return CreateType2(types[0], options);
  if (types.length === 0)
    return Never2(options);
  if (types.some((schema) => IsTransform3(schema)))
    throw new Error("Cannot intersect transform types");
  return IntersectCreate2(types, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/ref/ref.mjs
function Ref2(...args) {
  const [$ref, options] = typeof args[0] === "string" ? [args[0], args[1]] : [args[0].$id, args[1]];
  if (typeof $ref !== "string")
    throw new TypeBoxError2("Ref: $ref must be a string");
  return CreateType2({ [Kind2]: "Ref", $ref }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/awaited/awaited.mjs
function FromComputed(target, parameters) {
  return Computed("Awaited", [Computed(target, parameters)]);
}
function FromRef11($ref) {
  return Computed("Awaited", [Ref2($ref)]);
}
function FromIntersect14(types) {
  return Intersect2(FromRest5(types));
}
function FromUnion16(types) {
  return Union3(FromRest5(types));
}
function FromPromise5(type) {
  return Awaited(type);
}
function FromRest5(types) {
  return types.map((type) => Awaited(type));
}
function Awaited(type, options) {
  return CreateType2(IsComputed3(type) ? FromComputed(type.target, type.parameters) : IsIntersect3(type) ? FromIntersect14(type.allOf) : IsUnion3(type) ? FromUnion16(type.anyOf) : IsPromise4(type) ? FromPromise5(type.item) : IsRef3(type) ? FromRef11(type.$ref) : type, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-property-keys.mjs
function FromRest6(types) {
  const result = [];
  for (const L of types)
    result.push(KeyOfPropertyKeys2(L));
  return result;
}
function FromIntersect15(types) {
  const propertyKeysArray = FromRest6(types);
  const propertyKeys = SetUnionMany2(propertyKeysArray);
  return propertyKeys;
}
function FromUnion17(types) {
  const propertyKeysArray = FromRest6(types);
  const propertyKeys = SetIntersectMany2(propertyKeysArray);
  return propertyKeys;
}
function FromTuple14(types) {
  return types.map((_, indexer) => indexer.toString());
}
function FromArray15(_) {
  return ["[number]"];
}
function FromProperties7(T) {
  return globalThis.Object.getOwnPropertyNames(T);
}
function FromPatternProperties2(patternProperties) {
  if (!includePatternProperties2)
    return [];
  const patternPropertyKeys = globalThis.Object.getOwnPropertyNames(patternProperties);
  return patternPropertyKeys.map((key) => {
    return key[0] === "^" && key[key.length - 1] === "$" ? key.slice(1, key.length - 1) : key;
  });
}
function KeyOfPropertyKeys2(type) {
  return IsIntersect3(type) ? FromIntersect15(type.allOf) : IsUnion3(type) ? FromUnion17(type.anyOf) : IsTuple3(type) ? FromTuple14(type.items ?? []) : IsArray7(type) ? FromArray15(type.items) : IsObject7(type) ? FromProperties7(type.properties) : IsRecord3(type) ? FromPatternProperties2(type.patternProperties) : [];
}
var includePatternProperties2 = false;

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof.mjs
function FromComputed2(target, parameters) {
  return Computed("KeyOf", [Computed(target, parameters)]);
}
function FromRef12($ref) {
  return Computed("KeyOf", [Ref2($ref)]);
}
function KeyOfFromType(type, options) {
  const propertyKeys = KeyOfPropertyKeys2(type);
  const propertyKeyTypes = KeyOfPropertyKeysToRest(propertyKeys);
  const result = UnionEvaluated2(propertyKeyTypes);
  return CreateType2(result, options);
}
function KeyOfPropertyKeysToRest(propertyKeys) {
  return propertyKeys.map((L) => L === "[number]" ? Number2() : Literal2(L));
}
function KeyOf(type, options) {
  return IsComputed3(type) ? FromComputed2(type.target, type.parameters) : IsRef3(type) ? FromRef12(type.$ref) : IsMappedResult3(type) ? KeyOfFromMappedResult(type, options) : KeyOfFromType(type, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/keyof/keyof-from-mapped-result.mjs
function FromProperties8(properties, options) {
  const result = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result[K2] = KeyOf(properties[K2], Clone3(options));
  return result;
}
function FromMappedResult6(mappedResult, options) {
  return FromProperties8(mappedResult.properties, options);
}
function KeyOfFromMappedResult(mappedResult, options) {
  const properties = FromMappedResult6(mappedResult, options);
  return MappedResult2(properties);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/composite/composite.mjs
function CompositeKeys(T) {
  const Acc = [];
  for (const L of T)
    Acc.push(...KeyOfPropertyKeys2(L));
  return SetDistinct(Acc);
}
function FilterNever(T) {
  return T.filter((L) => !IsNever3(L));
}
function CompositeProperty(T, K) {
  const Acc = [];
  for (const L of T)
    Acc.push(...IndexFromPropertyKeys2(L, [K]));
  return FilterNever(Acc);
}
function CompositeProperties(T, K) {
  const Acc = {};
  for (const L of K) {
    Acc[L] = IntersectEvaluated2(CompositeProperty(T, L));
  }
  return Acc;
}
function Composite(T, options) {
  const K = CompositeKeys(T);
  const P = CompositeProperties(T, K);
  const R = Object3(P, options);
  return R;
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/date/date.mjs
function Date2(options) {
  return CreateType2({ [Kind2]: "Date", type: "Date" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/null/null.mjs
function Null(options) {
  return CreateType2({ [Kind2]: "Null", type: "null" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/symbol/symbol.mjs
function Symbol2(options) {
  return CreateType2({ [Kind2]: "Symbol", type: "symbol" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/undefined/undefined.mjs
function Undefined(options) {
  return CreateType2({ [Kind2]: "Undefined", type: "undefined" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/uint8array/uint8array.mjs
function Uint8Array2(options) {
  return CreateType2({ [Kind2]: "Uint8Array", type: "Uint8Array" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/unknown/unknown.mjs
function Unknown2(options) {
  return CreateType2({ [Kind2]: "Unknown" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/const/const.mjs
function FromArray16(T) {
  return T.map((L) => FromValue2(L, false));
}
function FromProperties9(value) {
  const Acc = {};
  for (const K of globalThis.Object.getOwnPropertyNames(value))
    Acc[K] = Readonly(FromValue2(value[K], false));
  return Acc;
}
function ConditionalReadonly(T, root) {
  return root === true ? T : Readonly(T);
}
function FromValue2(value, root) {
  return IsAsyncIterator4(value) ? ConditionalReadonly(Any(), root) : IsIterator4(value) ? ConditionalReadonly(Any(), root) : IsArray5(value) ? Readonly(Tuple(FromArray16(value))) : IsUint8Array5(value) ? Uint8Array2() : IsDate5(value) ? Date2() : IsObject5(value) ? ConditionalReadonly(Object3(FromProperties9(value)), root) : IsFunction4(value) ? ConditionalReadonly(Function([], Unknown2()), root) : IsUndefined5(value) ? Undefined() : IsNull4(value) ? Null() : IsSymbol4(value) ? Symbol2() : IsBigInt5(value) ? BigInt2() : IsNumber5(value) ? Literal2(value) : IsBoolean5(value) ? Literal2(value) : IsString5(value) ? Literal2(value) : Object3({});
}
function Const(T, options) {
  return CreateType2(FromValue2(T, true), options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/constructor-parameters/constructor-parameters.mjs
function ConstructorParameters(schema, options) {
  return IsConstructor3(schema) ? Tuple(schema.parameters, options) : Never2(options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/enum/enum.mjs
function Enum(item, options) {
  if (IsUndefined5(item))
    throw new Error("Enum undefined or empty");
  const values1 = globalThis.Object.getOwnPropertyNames(item).filter((key) => isNaN(key)).map((key) => item[key]);
  const values2 = [...new Set(values1)];
  const anyOf = values2.map((value) => Literal2(value));
  return Union3(anyOf, { ...options, [Hint2]: "Enum" });
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/extends/extends-check.mjs
var ExtendsResolverError = class extends TypeBoxError2 {
};
var ExtendsResult;
(function(ExtendsResult2) {
  ExtendsResult2[ExtendsResult2["Union"] = 0] = "Union";
  ExtendsResult2[ExtendsResult2["True"] = 1] = "True";
  ExtendsResult2[ExtendsResult2["False"] = 2] = "False";
})(ExtendsResult || (ExtendsResult = {}));
function IntoBooleanResult(result) {
  return result === ExtendsResult.False ? result : ExtendsResult.True;
}
function Throw(message) {
  throw new ExtendsResolverError(message);
}
function IsStructuralRight(right) {
  return type_exports2.IsNever(right) || type_exports2.IsIntersect(right) || type_exports2.IsUnion(right) || type_exports2.IsUnknown(right) || type_exports2.IsAny(right);
}
function StructuralRight(left, right) {
  return type_exports2.IsNever(right) ? FromNeverRight(left, right) : type_exports2.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports2.IsUnion(right) ? FromUnionRight(left, right) : type_exports2.IsUnknown(right) ? FromUnknownRight(left, right) : type_exports2.IsAny(right) ? FromAnyRight(left, right) : Throw("StructuralRight");
}
function FromAnyRight(left, right) {
  return ExtendsResult.True;
}
function FromAny4(left, right) {
  return type_exports2.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports2.IsUnion(right) && right.anyOf.some((schema) => type_exports2.IsAny(schema) || type_exports2.IsUnknown(schema)) ? ExtendsResult.True : type_exports2.IsUnion(right) ? ExtendsResult.Union : type_exports2.IsUnknown(right) ? ExtendsResult.True : type_exports2.IsAny(right) ? ExtendsResult.True : ExtendsResult.Union;
}
function FromArrayRight(left, right) {
  return type_exports2.IsUnknown(left) ? ExtendsResult.False : type_exports2.IsAny(left) ? ExtendsResult.Union : type_exports2.IsNever(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromArray17(left, right) {
  return type_exports2.IsObject(right) && IsObjectArrayLike(right) ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports2.IsArray(right) ? ExtendsResult.False : IntoBooleanResult(Visit17(left.items, right.items));
}
function FromAsyncIterator5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports2.IsAsyncIterator(right) ? ExtendsResult.False : IntoBooleanResult(Visit17(left.items, right.items));
}
function FromBigInt5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsBigInt(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromBooleanRight(left, right) {
  return type_exports2.IsLiteralBoolean(left) ? ExtendsResult.True : type_exports2.IsBoolean(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromBoolean5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsBoolean(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromConstructor6(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : !type_exports2.IsConstructor(right) ? ExtendsResult.False : left.parameters.length > right.parameters.length ? ExtendsResult.False : !left.parameters.every((schema, index) => IntoBooleanResult(Visit17(right.parameters[index], schema)) === ExtendsResult.True) ? ExtendsResult.False : IntoBooleanResult(Visit17(left.returns, right.returns));
}
function FromDate7(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsDate(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromFunction5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : !type_exports2.IsFunction(right) ? ExtendsResult.False : left.parameters.length > right.parameters.length ? ExtendsResult.False : !left.parameters.every((schema, index) => IntoBooleanResult(Visit17(right.parameters[index], schema)) === ExtendsResult.True) ? ExtendsResult.False : IntoBooleanResult(Visit17(left.returns, right.returns));
}
function FromIntegerRight(left, right) {
  return type_exports2.IsLiteral(left) && value_exports3.IsNumber(left.const) ? ExtendsResult.True : type_exports2.IsNumber(left) || type_exports2.IsInteger(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromInteger5(left, right) {
  return type_exports2.IsInteger(right) || type_exports2.IsNumber(right) ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : ExtendsResult.False;
}
function FromIntersectRight(left, right) {
  return right.allOf.every((schema) => Visit17(left, schema) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromIntersect16(left, right) {
  return left.allOf.some((schema) => Visit17(schema, right) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromIterator5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : !type_exports2.IsIterator(right) ? ExtendsResult.False : IntoBooleanResult(Visit17(left.items, right.items));
}
function FromLiteral6(left, right) {
  return type_exports2.IsLiteral(right) && right.const === left.const ? ExtendsResult.True : IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsString(right) ? FromStringRight(left, right) : type_exports2.IsNumber(right) ? FromNumberRight(left, right) : type_exports2.IsInteger(right) ? FromIntegerRight(left, right) : type_exports2.IsBoolean(right) ? FromBooleanRight(left, right) : ExtendsResult.False;
}
function FromNeverRight(left, right) {
  return ExtendsResult.False;
}
function FromNever5(left, right) {
  return ExtendsResult.True;
}
function UnwrapTNot(schema) {
  let [current, depth] = [schema, 0];
  while (true) {
    if (!type_exports2.IsNot(current))
      break;
    current = current.not;
    depth += 1;
  }
  return depth % 2 === 0 ? current : Unknown2();
}
function FromNot7(left, right) {
  return type_exports2.IsNot(left) ? Visit17(UnwrapTNot(left), right) : type_exports2.IsNot(right) ? Visit17(left, UnwrapTNot(right)) : Throw("Invalid fallthrough for Not");
}
function FromNull5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsNull(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromNumberRight(left, right) {
  return type_exports2.IsLiteralNumber(left) ? ExtendsResult.True : type_exports2.IsNumber(left) || type_exports2.IsInteger(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromNumber5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsInteger(right) || type_exports2.IsNumber(right) ? ExtendsResult.True : ExtendsResult.False;
}
function IsObjectPropertyCount(schema, count) {
  return Object.getOwnPropertyNames(schema.properties).length === count;
}
function IsObjectStringLike(schema) {
  return IsObjectArrayLike(schema);
}
function IsObjectSymbolLike(schema) {
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "description" in schema.properties && type_exports2.IsUnion(schema.properties.description) && schema.properties.description.anyOf.length === 2 && (type_exports2.IsString(schema.properties.description.anyOf[0]) && type_exports2.IsUndefined(schema.properties.description.anyOf[1]) || type_exports2.IsString(schema.properties.description.anyOf[1]) && type_exports2.IsUndefined(schema.properties.description.anyOf[0]));
}
function IsObjectNumberLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectBooleanLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectBigIntLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectDateLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectUint8ArrayLike(schema) {
  return IsObjectArrayLike(schema);
}
function IsObjectFunctionLike(schema) {
  const length = Number2();
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "length" in schema.properties && IntoBooleanResult(Visit17(schema.properties["length"], length)) === ExtendsResult.True;
}
function IsObjectConstructorLike(schema) {
  return IsObjectPropertyCount(schema, 0);
}
function IsObjectArrayLike(schema) {
  const length = Number2();
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "length" in schema.properties && IntoBooleanResult(Visit17(schema.properties["length"], length)) === ExtendsResult.True;
}
function IsObjectPromiseLike(schema) {
  const then = Function([Any()], Any());
  return IsObjectPropertyCount(schema, 0) || IsObjectPropertyCount(schema, 1) && "then" in schema.properties && IntoBooleanResult(Visit17(schema.properties["then"], then)) === ExtendsResult.True;
}
function Property(left, right) {
  return Visit17(left, right) === ExtendsResult.False ? ExtendsResult.False : type_exports2.IsOptional(left) && !type_exports2.IsOptional(right) ? ExtendsResult.False : ExtendsResult.True;
}
function FromObjectRight(left, right) {
  return type_exports2.IsUnknown(left) ? ExtendsResult.False : type_exports2.IsAny(left) ? ExtendsResult.Union : type_exports2.IsNever(left) || type_exports2.IsLiteralString(left) && IsObjectStringLike(right) || type_exports2.IsLiteralNumber(left) && IsObjectNumberLike(right) || type_exports2.IsLiteralBoolean(left) && IsObjectBooleanLike(right) || type_exports2.IsSymbol(left) && IsObjectSymbolLike(right) || type_exports2.IsBigInt(left) && IsObjectBigIntLike(right) || type_exports2.IsString(left) && IsObjectStringLike(right) || type_exports2.IsSymbol(left) && IsObjectSymbolLike(right) || type_exports2.IsNumber(left) && IsObjectNumberLike(right) || type_exports2.IsInteger(left) && IsObjectNumberLike(right) || type_exports2.IsBoolean(left) && IsObjectBooleanLike(right) || type_exports2.IsUint8Array(left) && IsObjectUint8ArrayLike(right) || type_exports2.IsDate(left) && IsObjectDateLike(right) || type_exports2.IsConstructor(left) && IsObjectConstructorLike(right) || type_exports2.IsFunction(left) && IsObjectFunctionLike(right) ? ExtendsResult.True : type_exports2.IsRecord(left) && type_exports2.IsString(RecordKey(left)) ? (() => {
    return right[Hint2] === "Record" ? ExtendsResult.True : ExtendsResult.False;
  })() : type_exports2.IsRecord(left) && type_exports2.IsNumber(RecordKey(left)) ? (() => {
    return IsObjectPropertyCount(right, 0) ? ExtendsResult.True : ExtendsResult.False;
  })() : ExtendsResult.False;
}
function FromObject12(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : !type_exports2.IsObject(right) ? ExtendsResult.False : (() => {
    for (const key of Object.getOwnPropertyNames(right.properties)) {
      if (!(key in left.properties) && !type_exports2.IsOptional(right.properties[key])) {
        return ExtendsResult.False;
      }
      if (type_exports2.IsOptional(right.properties[key])) {
        return ExtendsResult.True;
      }
      if (Property(left.properties[key], right.properties[key]) === ExtendsResult.False) {
        return ExtendsResult.False;
      }
    }
    return ExtendsResult.True;
  })();
}
function FromPromise6(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) && IsObjectPromiseLike(right) ? ExtendsResult.True : !type_exports2.IsPromise(right) ? ExtendsResult.False : IntoBooleanResult(Visit17(left.item, right.item));
}
function RecordKey(schema) {
  return PatternNumberExact in schema.patternProperties ? Number2() : PatternStringExact in schema.patternProperties ? String3() : Throw("Unknown record key pattern");
}
function RecordValue(schema) {
  return PatternNumberExact in schema.patternProperties ? schema.patternProperties[PatternNumberExact] : PatternStringExact in schema.patternProperties ? schema.patternProperties[PatternStringExact] : Throw("Unable to get record value schema");
}
function FromRecordRight(left, right) {
  const [Key, Value] = [RecordKey(right), RecordValue(right)];
  return type_exports2.IsLiteralString(left) && type_exports2.IsNumber(Key) && IntoBooleanResult(Visit17(left, Value)) === ExtendsResult.True ? ExtendsResult.True : type_exports2.IsUint8Array(left) && type_exports2.IsNumber(Key) ? Visit17(left, Value) : type_exports2.IsString(left) && type_exports2.IsNumber(Key) ? Visit17(left, Value) : type_exports2.IsArray(left) && type_exports2.IsNumber(Key) ? Visit17(left, Value) : type_exports2.IsObject(left) ? (() => {
    for (const key of Object.getOwnPropertyNames(left.properties)) {
      if (Property(Value, left.properties[key]) === ExtendsResult.False) {
        return ExtendsResult.False;
      }
    }
    return ExtendsResult.True;
  })() : ExtendsResult.False;
}
function FromRecord11(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : !type_exports2.IsRecord(right) ? ExtendsResult.False : Visit17(RecordValue(left), RecordValue(right));
}
function FromRegExp4(left, right) {
  const L = type_exports2.IsRegExp(left) ? String3() : left;
  const R = type_exports2.IsRegExp(right) ? String3() : right;
  return Visit17(L, R);
}
function FromStringRight(left, right) {
  return type_exports2.IsLiteral(left) && value_exports3.IsString(left.const) ? ExtendsResult.True : type_exports2.IsString(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromString5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsString(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromSymbol5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsSymbol(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromTemplateLiteral5(left, right) {
  return type_exports2.IsTemplateLiteral(left) ? Visit17(TemplateLiteralToUnion(left), right) : type_exports2.IsTemplateLiteral(right) ? Visit17(left, TemplateLiteralToUnion(right)) : Throw("Invalid fallthrough for TemplateLiteral");
}
function IsArrayOfTuple(left, right) {
  return type_exports2.IsArray(right) && left.items !== void 0 && left.items.every((schema) => Visit17(schema, right.items) === ExtendsResult.True);
}
function FromTupleRight(left, right) {
  return type_exports2.IsNever(left) ? ExtendsResult.True : type_exports2.IsUnknown(left) ? ExtendsResult.False : type_exports2.IsAny(left) ? ExtendsResult.Union : ExtendsResult.False;
}
function FromTuple15(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) && IsObjectArrayLike(right) ? ExtendsResult.True : type_exports2.IsArray(right) && IsArrayOfTuple(left, right) ? ExtendsResult.True : !type_exports2.IsTuple(right) ? ExtendsResult.False : value_exports3.IsUndefined(left.items) && !value_exports3.IsUndefined(right.items) || !value_exports3.IsUndefined(left.items) && value_exports3.IsUndefined(right.items) ? ExtendsResult.False : value_exports3.IsUndefined(left.items) && !value_exports3.IsUndefined(right.items) ? ExtendsResult.True : left.items.every((schema, index) => Visit17(schema, right.items[index]) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUint8Array4(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsUint8Array(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUndefined5(left, right) {
  return IsStructuralRight(right) ? StructuralRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsRecord(right) ? FromRecordRight(left, right) : type_exports2.IsVoid(right) ? FromVoidRight(left, right) : type_exports2.IsUndefined(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnionRight(left, right) {
  return right.anyOf.some((schema) => Visit17(left, schema) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnion18(left, right) {
  return left.anyOf.every((schema) => Visit17(schema, right) === ExtendsResult.True) ? ExtendsResult.True : ExtendsResult.False;
}
function FromUnknownRight(left, right) {
  return ExtendsResult.True;
}
function FromUnknown4(left, right) {
  return type_exports2.IsNever(right) ? FromNeverRight(left, right) : type_exports2.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports2.IsUnion(right) ? FromUnionRight(left, right) : type_exports2.IsAny(right) ? FromAnyRight(left, right) : type_exports2.IsString(right) ? FromStringRight(left, right) : type_exports2.IsNumber(right) ? FromNumberRight(left, right) : type_exports2.IsInteger(right) ? FromIntegerRight(left, right) : type_exports2.IsBoolean(right) ? FromBooleanRight(left, right) : type_exports2.IsArray(right) ? FromArrayRight(left, right) : type_exports2.IsTuple(right) ? FromTupleRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsUnknown(right) ? ExtendsResult.True : ExtendsResult.False;
}
function FromVoidRight(left, right) {
  return type_exports2.IsUndefined(left) ? ExtendsResult.True : type_exports2.IsUndefined(left) ? ExtendsResult.True : ExtendsResult.False;
}
function FromVoid4(left, right) {
  return type_exports2.IsIntersect(right) ? FromIntersectRight(left, right) : type_exports2.IsUnion(right) ? FromUnionRight(left, right) : type_exports2.IsUnknown(right) ? FromUnknownRight(left, right) : type_exports2.IsAny(right) ? FromAnyRight(left, right) : type_exports2.IsObject(right) ? FromObjectRight(left, right) : type_exports2.IsVoid(right) ? ExtendsResult.True : ExtendsResult.False;
}
function Visit17(left, right) {
  return (
    // resolvable
    type_exports2.IsTemplateLiteral(left) || type_exports2.IsTemplateLiteral(right) ? FromTemplateLiteral5(left, right) : type_exports2.IsRegExp(left) || type_exports2.IsRegExp(right) ? FromRegExp4(left, right) : type_exports2.IsNot(left) || type_exports2.IsNot(right) ? FromNot7(left, right) : (
      // standard
      type_exports2.IsAny(left) ? FromAny4(left, right) : type_exports2.IsArray(left) ? FromArray17(left, right) : type_exports2.IsBigInt(left) ? FromBigInt5(left, right) : type_exports2.IsBoolean(left) ? FromBoolean5(left, right) : type_exports2.IsAsyncIterator(left) ? FromAsyncIterator5(left, right) : type_exports2.IsConstructor(left) ? FromConstructor6(left, right) : type_exports2.IsDate(left) ? FromDate7(left, right) : type_exports2.IsFunction(left) ? FromFunction5(left, right) : type_exports2.IsInteger(left) ? FromInteger5(left, right) : type_exports2.IsIntersect(left) ? FromIntersect16(left, right) : type_exports2.IsIterator(left) ? FromIterator5(left, right) : type_exports2.IsLiteral(left) ? FromLiteral6(left, right) : type_exports2.IsNever(left) ? FromNever5(left, right) : type_exports2.IsNull(left) ? FromNull5(left, right) : type_exports2.IsNumber(left) ? FromNumber5(left, right) : type_exports2.IsObject(left) ? FromObject12(left, right) : type_exports2.IsRecord(left) ? FromRecord11(left, right) : type_exports2.IsString(left) ? FromString5(left, right) : type_exports2.IsSymbol(left) ? FromSymbol5(left, right) : type_exports2.IsTuple(left) ? FromTuple15(left, right) : type_exports2.IsPromise(left) ? FromPromise6(left, right) : type_exports2.IsUint8Array(left) ? FromUint8Array4(left, right) : type_exports2.IsUndefined(left) ? FromUndefined5(left, right) : type_exports2.IsUnion(left) ? FromUnion18(left, right) : type_exports2.IsUnknown(left) ? FromUnknown4(left, right) : type_exports2.IsVoid(left) ? FromVoid4(left, right) : Throw(`Unknown left type operand '${left[Kind2]}'`)
    )
  );
}
function ExtendsCheck(left, right) {
  return Visit17(left, right);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/extends/extends-from-mapped-result.mjs
function FromProperties10(P, Right, True, False, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Extends(P[K2], Right, True, False, Clone3(options));
  return Acc;
}
function FromMappedResult7(Left, Right, True, False, options) {
  return FromProperties10(Left.properties, Right, True, False, options);
}
function ExtendsFromMappedResult(Left, Right, True, False, options) {
  const P = FromMappedResult7(Left, Right, True, False, options);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/extends/extends.mjs
function ExtendsResolve(left, right, trueType, falseType) {
  const R = ExtendsCheck(left, right);
  return R === ExtendsResult.Union ? Union3([trueType, falseType]) : R === ExtendsResult.True ? trueType : falseType;
}
function Extends(L, R, T, F, options) {
  return IsMappedResult3(L) ? ExtendsFromMappedResult(L, R, T, F, options) : IsMappedKey3(L) ? CreateType2(ExtendsFromMappedKey(L, R, T, F, options)) : CreateType2(ExtendsResolve(L, R, T, F), options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/extends/extends-from-mapped-key.mjs
function FromPropertyKey(K, U, L, R, options) {
  return {
    [K]: Extends(Literal2(K), U, L, R, Clone3(options))
  };
}
function FromPropertyKeys(K, U, L, R, options) {
  return K.reduce((Acc, LK) => {
    return { ...Acc, ...FromPropertyKey(LK, U, L, R, options) };
  }, {});
}
function FromMappedKey2(K, U, L, R, options) {
  return FromPropertyKeys(K.keys, U, L, R, options);
}
function ExtendsFromMappedKey(T, U, L, R, options) {
  const P = FromMappedKey2(T, U, L, R, options);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude-from-template-literal.mjs
function ExcludeFromTemplateLiteral(L, R) {
  return Exclude(TemplateLiteralToUnion(L), R);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude.mjs
function ExcludeRest(L, R) {
  const excluded = L.filter((inner) => ExtendsCheck(inner, R) === ExtendsResult.False);
  return excluded.length === 1 ? excluded[0] : Union3(excluded);
}
function Exclude(L, R, options = {}) {
  if (IsTemplateLiteral3(L))
    return CreateType2(ExcludeFromTemplateLiteral(L, R), options);
  if (IsMappedResult3(L))
    return CreateType2(ExcludeFromMappedResult(L, R), options);
  return CreateType2(IsUnion3(L) ? ExcludeRest(L.anyOf, R) : ExtendsCheck(L, R) !== ExtendsResult.False ? Never2() : L, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/exclude/exclude-from-mapped-result.mjs
function FromProperties11(P, U) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Exclude(P[K2], U);
  return Acc;
}
function FromMappedResult8(R, T) {
  return FromProperties11(R.properties, T);
}
function ExcludeFromMappedResult(R, T) {
  const P = FromMappedResult8(R, T);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/extract/extract-from-template-literal.mjs
function ExtractFromTemplateLiteral(L, R) {
  return Extract(TemplateLiteralToUnion(L), R);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/extract/extract.mjs
function ExtractRest(L, R) {
  const extracted = L.filter((inner) => ExtendsCheck(inner, R) !== ExtendsResult.False);
  return extracted.length === 1 ? extracted[0] : Union3(extracted);
}
function Extract(L, R, options) {
  if (IsTemplateLiteral3(L))
    return CreateType2(ExtractFromTemplateLiteral(L, R), options);
  if (IsMappedResult3(L))
    return CreateType2(ExtractFromMappedResult(L, R), options);
  return CreateType2(IsUnion3(L) ? ExtractRest(L.anyOf, R) : ExtendsCheck(L, R) !== ExtendsResult.False ? L : Never2(), options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/extract/extract-from-mapped-result.mjs
function FromProperties12(P, T) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Extract(P[K2], T);
  return Acc;
}
function FromMappedResult9(R, T) {
  return FromProperties12(R.properties, T);
}
function ExtractFromMappedResult(R, T) {
  const P = FromMappedResult9(R, T);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/instance-type/instance-type.mjs
function InstanceType(schema, options) {
  return IsConstructor3(schema) ? CreateType2(schema.returns, options) : Never2(options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/readonly-optional/readonly-optional.mjs
function ReadonlyOptional(schema) {
  return Readonly(Optional2(schema));
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/record/record.mjs
function RecordCreateFromPattern(pattern, T, options) {
  return CreateType2({ [Kind2]: "Record", type: "object", patternProperties: { [pattern]: T } }, options);
}
function RecordCreateFromKeys(K, T, options) {
  const result = {};
  for (const K2 of K)
    result[K2] = T;
  return Object3(result, { ...options, [Hint2]: "Record" });
}
function FromTemplateLiteralKey(K, T, options) {
  return IsTemplateLiteralFinite2(K) ? RecordCreateFromKeys(IndexPropertyKeys(K), T, options) : RecordCreateFromPattern(K.pattern, T, options);
}
function FromUnionKey(key, type, options) {
  return RecordCreateFromKeys(IndexPropertyKeys(Union3(key)), type, options);
}
function FromLiteralKey(key, type, options) {
  return RecordCreateFromKeys([key.toString()], type, options);
}
function FromRegExpKey(key, type, options) {
  return RecordCreateFromPattern(key.source, type, options);
}
function FromStringKey(key, type, options) {
  const pattern = IsUndefined5(key.pattern) ? PatternStringExact : key.pattern;
  return RecordCreateFromPattern(pattern, type, options);
}
function FromAnyKey(_, type, options) {
  return RecordCreateFromPattern(PatternStringExact, type, options);
}
function FromNeverKey(_key, type, options) {
  return RecordCreateFromPattern(PatternNeverExact, type, options);
}
function FromBooleanKey(_key, type, options) {
  return Object3({ true: type, false: type }, options);
}
function FromIntegerKey(_key, type, options) {
  return RecordCreateFromPattern(PatternNumberExact, type, options);
}
function FromNumberKey(_, type, options) {
  return RecordCreateFromPattern(PatternNumberExact, type, options);
}
function Record(key, type, options = {}) {
  return IsUnion3(key) ? FromUnionKey(key.anyOf, type, options) : IsTemplateLiteral3(key) ? FromTemplateLiteralKey(key, type, options) : IsLiteral3(key) ? FromLiteralKey(key.const, type, options) : IsBoolean6(key) ? FromBooleanKey(key, type, options) : IsInteger4(key) ? FromIntegerKey(key, type, options) : IsNumber7(key) ? FromNumberKey(key, type, options) : IsRegExp5(key) ? FromRegExpKey(key, type, options) : IsString6(key) ? FromStringKey(key, type, options) : IsAny3(key) ? FromAnyKey(key, type, options) : IsNever3(key) ? FromNeverKey(key, type, options) : Never2(options);
}
function RecordPattern(record) {
  return globalThis.Object.getOwnPropertyNames(record.patternProperties)[0];
}
function RecordKey2(type) {
  const pattern = RecordPattern(type);
  return pattern === PatternStringExact ? String3() : pattern === PatternNumberExact ? Number2() : String3({ pattern });
}
function RecordValue2(type) {
  return type.patternProperties[RecordPattern(type)];
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/instantiate/instantiate.mjs
function FromConstructor7(args, type) {
  type.parameters = FromTypes(args, type.parameters);
  type.returns = FromType(args, type.returns);
  return type;
}
function FromFunction6(args, type) {
  type.parameters = FromTypes(args, type.parameters);
  type.returns = FromType(args, type.returns);
  return type;
}
function FromIntersect17(args, type) {
  type.allOf = FromTypes(args, type.allOf);
  return type;
}
function FromUnion19(args, type) {
  type.anyOf = FromTypes(args, type.anyOf);
  return type;
}
function FromTuple16(args, type) {
  if (IsUndefined5(type.items))
    return type;
  type.items = FromTypes(args, type.items);
  return type;
}
function FromArray18(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromAsyncIterator6(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromIterator6(args, type) {
  type.items = FromType(args, type.items);
  return type;
}
function FromPromise7(args, type) {
  type.item = FromType(args, type.item);
  return type;
}
function FromObject13(args, type) {
  const mappedProperties = FromProperties13(args, type.properties);
  return { ...type, ...Object3(mappedProperties) };
}
function FromRecord12(args, type) {
  const mappedKey = FromType(args, RecordKey2(type));
  const mappedValue = FromType(args, RecordValue2(type));
  const result = Record(mappedKey, mappedValue);
  return { ...type, ...result };
}
function FromArgument4(args, argument) {
  return argument.index in args ? args[argument.index] : Unknown2();
}
function FromProperty3(args, type) {
  const isReadonly = IsReadonly(type);
  const isOptional = IsOptional2(type);
  const mapped = FromType(args, type);
  return isReadonly && isOptional ? ReadonlyOptional(mapped) : isReadonly && !isOptional ? Readonly(mapped) : !isReadonly && isOptional ? Optional2(mapped) : mapped;
}
function FromProperties13(args, properties) {
  return globalThis.Object.getOwnPropertyNames(properties).reduce((result, key) => {
    return { ...result, [key]: FromProperty3(args, properties[key]) };
  }, {});
}
function FromTypes(args, types) {
  return types.map((type) => FromType(args, type));
}
function FromType(args, type) {
  return IsConstructor3(type) ? FromConstructor7(args, type) : IsFunction5(type) ? FromFunction6(args, type) : IsIntersect3(type) ? FromIntersect17(args, type) : IsUnion3(type) ? FromUnion19(args, type) : IsTuple3(type) ? FromTuple16(args, type) : IsArray7(type) ? FromArray18(args, type) : IsAsyncIterator5(type) ? FromAsyncIterator6(args, type) : IsIterator5(type) ? FromIterator6(args, type) : IsPromise4(type) ? FromPromise7(args, type) : IsObject7(type) ? FromObject13(args, type) : IsRecord3(type) ? FromRecord12(args, type) : IsArgument3(type) ? FromArgument4(args, type) : type;
}
function Instantiate(type, args) {
  return FromType(args, CloneType(type));
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/integer/integer.mjs
function Integer(options) {
  return CreateType2({ [Kind2]: "Integer", type: "integer" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intrinsic/intrinsic-from-mapped-key.mjs
function MappedIntrinsicPropertyKey(K, M, options) {
  return {
    [K]: Intrinsic(Literal2(K), M, Clone3(options))
  };
}
function MappedIntrinsicPropertyKeys(K, M, options) {
  const result = K.reduce((Acc, L) => {
    return { ...Acc, ...MappedIntrinsicPropertyKey(L, M, options) };
  }, {});
  return result;
}
function MappedIntrinsicProperties(T, M, options) {
  return MappedIntrinsicPropertyKeys(T["keys"], M, options);
}
function IntrinsicFromMappedKey(T, M, options) {
  const P = MappedIntrinsicProperties(T, M, options);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intrinsic/intrinsic.mjs
function ApplyUncapitalize(value) {
  const [first, rest] = [value.slice(0, 1), value.slice(1)];
  return [first.toLowerCase(), rest].join("");
}
function ApplyCapitalize(value) {
  const [first, rest] = [value.slice(0, 1), value.slice(1)];
  return [first.toUpperCase(), rest].join("");
}
function ApplyUppercase(value) {
  return value.toUpperCase();
}
function ApplyLowercase(value) {
  return value.toLowerCase();
}
function FromTemplateLiteral6(schema, mode, options) {
  const expression = TemplateLiteralParseExact2(schema.pattern);
  const finite = IsTemplateLiteralExpressionFinite2(expression);
  if (!finite)
    return { ...schema, pattern: FromLiteralValue(schema.pattern, mode) };
  const strings = [...TemplateLiteralExpressionGenerate2(expression)];
  const literals = strings.map((value) => Literal2(value));
  const mapped = FromRest7(literals, mode);
  const union = Union3(mapped);
  return TemplateLiteral([union], options);
}
function FromLiteralValue(value, mode) {
  return typeof value === "string" ? mode === "Uncapitalize" ? ApplyUncapitalize(value) : mode === "Capitalize" ? ApplyCapitalize(value) : mode === "Uppercase" ? ApplyUppercase(value) : mode === "Lowercase" ? ApplyLowercase(value) : value : value.toString();
}
function FromRest7(T, M) {
  return T.map((L) => Intrinsic(L, M));
}
function Intrinsic(schema, mode, options = {}) {
  return (
    // Intrinsic-Mapped-Inference
    IsMappedKey3(schema) ? IntrinsicFromMappedKey(schema, mode, options) : (
      // Standard-Inference
      IsTemplateLiteral3(schema) ? FromTemplateLiteral6(schema, mode, options) : IsUnion3(schema) ? Union3(FromRest7(schema.anyOf, mode), options) : IsLiteral3(schema) ? Literal2(FromLiteralValue(schema.const, mode), options) : (
        // Default Type
        CreateType2(schema, options)
      )
    )
  );
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intrinsic/capitalize.mjs
function Capitalize(T, options = {}) {
  return Intrinsic(T, "Capitalize", options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intrinsic/lowercase.mjs
function Lowercase(T, options = {}) {
  return Intrinsic(T, "Lowercase", options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intrinsic/uncapitalize.mjs
function Uncapitalize(T, options = {}) {
  return Intrinsic(T, "Uncapitalize", options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/intrinsic/uppercase.mjs
function Uppercase(T, options = {}) {
  return Intrinsic(T, "Uppercase", options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/omit/omit-from-mapped-result.mjs
function FromProperties14(properties, propertyKeys, options) {
  const result = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result[K2] = Omit(properties[K2], propertyKeys, Clone3(options));
  return result;
}
function FromMappedResult10(mappedResult, propertyKeys, options) {
  return FromProperties14(mappedResult.properties, propertyKeys, options);
}
function OmitFromMappedResult(mappedResult, propertyKeys, options) {
  const properties = FromMappedResult10(mappedResult, propertyKeys, options);
  return MappedResult2(properties);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/omit/omit.mjs
function FromIntersect18(types, propertyKeys) {
  return types.map((type) => OmitResolve(type, propertyKeys));
}
function FromUnion20(types, propertyKeys) {
  return types.map((type) => OmitResolve(type, propertyKeys));
}
function FromProperty4(properties, key) {
  const { [key]: _, ...R } = properties;
  return R;
}
function FromProperties15(properties, propertyKeys) {
  return propertyKeys.reduce((T, K2) => FromProperty4(T, K2), properties);
}
function FromObject14(type, propertyKeys, properties) {
  const options = Discard2(type, [TransformKind2, "$id", "required", "properties"]);
  const mappedProperties = FromProperties15(properties, propertyKeys);
  return Object3(mappedProperties, options);
}
function UnionFromPropertyKeys(propertyKeys) {
  const result = propertyKeys.reduce((result2, key) => IsLiteralValue2(key) ? [...result2, Literal2(key)] : result2, []);
  return Union3(result);
}
function OmitResolve(type, propertyKeys) {
  return IsIntersect3(type) ? Intersect2(FromIntersect18(type.allOf, propertyKeys)) : IsUnion3(type) ? Union3(FromUnion20(type.anyOf, propertyKeys)) : IsObject7(type) ? FromObject14(type, propertyKeys, type.properties) : Object3({});
}
function Omit(type, key, options) {
  const typeKey = IsArray5(key) ? UnionFromPropertyKeys(key) : key;
  const propertyKeys = IsSchema3(key) ? IndexPropertyKeys(key) : key;
  const isTypeRef = IsRef3(type);
  const isKeyRef = IsRef3(key);
  return IsMappedResult3(type) ? OmitFromMappedResult(type, propertyKeys, options) : IsMappedKey3(key) ? OmitFromMappedKey(type, key, options) : isTypeRef && isKeyRef ? Computed("Omit", [type, typeKey], options) : !isTypeRef && isKeyRef ? Computed("Omit", [type, typeKey], options) : isTypeRef && !isKeyRef ? Computed("Omit", [type, typeKey], options) : CreateType2({ ...OmitResolve(type, propertyKeys), ...options });
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/omit/omit-from-mapped-key.mjs
function FromPropertyKey2(type, key, options) {
  return { [key]: Omit(type, [key], Clone3(options)) };
}
function FromPropertyKeys2(type, propertyKeys, options) {
  return propertyKeys.reduce((Acc, LK) => {
    return { ...Acc, ...FromPropertyKey2(type, LK, options) };
  }, {});
}
function FromMappedKey3(type, mappedKey, options) {
  return FromPropertyKeys2(type, mappedKey.keys, options);
}
function OmitFromMappedKey(type, mappedKey, options) {
  const properties = FromMappedKey3(type, mappedKey, options);
  return MappedResult2(properties);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/pick/pick-from-mapped-result.mjs
function FromProperties16(properties, propertyKeys, options) {
  const result = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(properties))
    result[K2] = Pick(properties[K2], propertyKeys, Clone3(options));
  return result;
}
function FromMappedResult11(mappedResult, propertyKeys, options) {
  return FromProperties16(mappedResult.properties, propertyKeys, options);
}
function PickFromMappedResult(mappedResult, propertyKeys, options) {
  const properties = FromMappedResult11(mappedResult, propertyKeys, options);
  return MappedResult2(properties);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/pick/pick.mjs
function FromIntersect19(types, propertyKeys) {
  return types.map((type) => PickResolve(type, propertyKeys));
}
function FromUnion21(types, propertyKeys) {
  return types.map((type) => PickResolve(type, propertyKeys));
}
function FromProperties17(properties, propertyKeys) {
  const result = {};
  for (const K2 of propertyKeys)
    if (K2 in properties)
      result[K2] = properties[K2];
  return result;
}
function FromObject15(Type2, keys, properties) {
  const options = Discard2(Type2, [TransformKind2, "$id", "required", "properties"]);
  const mappedProperties = FromProperties17(properties, keys);
  return Object3(mappedProperties, options);
}
function UnionFromPropertyKeys2(propertyKeys) {
  const result = propertyKeys.reduce((result2, key) => IsLiteralValue2(key) ? [...result2, Literal2(key)] : result2, []);
  return Union3(result);
}
function PickResolve(type, propertyKeys) {
  return IsIntersect3(type) ? Intersect2(FromIntersect19(type.allOf, propertyKeys)) : IsUnion3(type) ? Union3(FromUnion21(type.anyOf, propertyKeys)) : IsObject7(type) ? FromObject15(type, propertyKeys, type.properties) : Object3({});
}
function Pick(type, key, options) {
  const typeKey = IsArray5(key) ? UnionFromPropertyKeys2(key) : key;
  const propertyKeys = IsSchema3(key) ? IndexPropertyKeys(key) : key;
  const isTypeRef = IsRef3(type);
  const isKeyRef = IsRef3(key);
  return IsMappedResult3(type) ? PickFromMappedResult(type, propertyKeys, options) : IsMappedKey3(key) ? PickFromMappedKey(type, key, options) : isTypeRef && isKeyRef ? Computed("Pick", [type, typeKey], options) : !isTypeRef && isKeyRef ? Computed("Pick", [type, typeKey], options) : isTypeRef && !isKeyRef ? Computed("Pick", [type, typeKey], options) : CreateType2({ ...PickResolve(type, propertyKeys), ...options });
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/pick/pick-from-mapped-key.mjs
function FromPropertyKey3(type, key, options) {
  return {
    [key]: Pick(type, [key], Clone3(options))
  };
}
function FromPropertyKeys3(type, propertyKeys, options) {
  return propertyKeys.reduce((result, leftKey) => {
    return { ...result, ...FromPropertyKey3(type, leftKey, options) };
  }, {});
}
function FromMappedKey4(type, mappedKey, options) {
  return FromPropertyKeys3(type, mappedKey.keys, options);
}
function PickFromMappedKey(type, mappedKey, options) {
  const properties = FromMappedKey4(type, mappedKey, options);
  return MappedResult2(properties);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/partial/partial.mjs
function FromComputed3(target, parameters) {
  return Computed("Partial", [Computed(target, parameters)]);
}
function FromRef13($ref) {
  return Computed("Partial", [Ref2($ref)]);
}
function FromProperties18(properties) {
  const partialProperties = {};
  for (const K of globalThis.Object.getOwnPropertyNames(properties))
    partialProperties[K] = Optional2(properties[K]);
  return partialProperties;
}
function FromObject16(type, properties) {
  const options = Discard2(type, [TransformKind2, "$id", "required", "properties"]);
  const mappedProperties = FromProperties18(properties);
  return Object3(mappedProperties, options);
}
function FromRest8(types) {
  return types.map((type) => PartialResolve(type));
}
function PartialResolve(type) {
  return (
    // Mappable
    IsComputed3(type) ? FromComputed3(type.target, type.parameters) : IsRef3(type) ? FromRef13(type.$ref) : IsIntersect3(type) ? Intersect2(FromRest8(type.allOf)) : IsUnion3(type) ? Union3(FromRest8(type.anyOf)) : IsObject7(type) ? FromObject16(type, type.properties) : (
      // Intrinsic
      IsBigInt6(type) ? type : IsBoolean6(type) ? type : IsInteger4(type) ? type : IsLiteral3(type) ? type : IsNull5(type) ? type : IsNumber7(type) ? type : IsString6(type) ? type : IsSymbol5(type) ? type : IsUndefined7(type) ? type : (
        // Passthrough
        Object3({})
      )
    )
  );
}
function Partial(type, options) {
  if (IsMappedResult3(type)) {
    return PartialFromMappedResult(type, options);
  } else {
    return CreateType2({ ...PartialResolve(type), ...options });
  }
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/partial/partial-from-mapped-result.mjs
function FromProperties19(K, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(K))
    Acc[K2] = Partial(K[K2], Clone3(options));
  return Acc;
}
function FromMappedResult12(R, options) {
  return FromProperties19(R.properties, options);
}
function PartialFromMappedResult(R, options) {
  const P = FromMappedResult12(R, options);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/required/required.mjs
function FromComputed4(target, parameters) {
  return Computed("Required", [Computed(target, parameters)]);
}
function FromRef14($ref) {
  return Computed("Required", [Ref2($ref)]);
}
function FromProperties20(properties) {
  const requiredProperties = {};
  for (const K of globalThis.Object.getOwnPropertyNames(properties))
    requiredProperties[K] = Discard2(properties[K], [OptionalKind2]);
  return requiredProperties;
}
function FromObject17(type, properties) {
  const options = Discard2(type, [TransformKind2, "$id", "required", "properties"]);
  const mappedProperties = FromProperties20(properties);
  return Object3(mappedProperties, options);
}
function FromRest9(types) {
  return types.map((type) => RequiredResolve(type));
}
function RequiredResolve(type) {
  return (
    // Mappable
    IsComputed3(type) ? FromComputed4(type.target, type.parameters) : IsRef3(type) ? FromRef14(type.$ref) : IsIntersect3(type) ? Intersect2(FromRest9(type.allOf)) : IsUnion3(type) ? Union3(FromRest9(type.anyOf)) : IsObject7(type) ? FromObject17(type, type.properties) : (
      // Intrinsic
      IsBigInt6(type) ? type : IsBoolean6(type) ? type : IsInteger4(type) ? type : IsLiteral3(type) ? type : IsNull5(type) ? type : IsNumber7(type) ? type : IsString6(type) ? type : IsSymbol5(type) ? type : IsUndefined7(type) ? type : (
        // Passthrough
        Object3({})
      )
    )
  );
}
function Required(type, options) {
  if (IsMappedResult3(type)) {
    return RequiredFromMappedResult(type, options);
  } else {
    return CreateType2({ ...RequiredResolve(type), ...options });
  }
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/required/required-from-mapped-result.mjs
function FromProperties21(P, options) {
  const Acc = {};
  for (const K2 of globalThis.Object.getOwnPropertyNames(P))
    Acc[K2] = Required(P[K2], options);
  return Acc;
}
function FromMappedResult13(R, options) {
  return FromProperties21(R.properties, options);
}
function RequiredFromMappedResult(R, options) {
  const P = FromMappedResult13(R, options);
  return MappedResult2(P);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/module/compute.mjs
function DereferenceParameters(moduleProperties, types) {
  return types.map((type) => {
    return IsRef3(type) ? Dereference(moduleProperties, type.$ref) : FromType2(moduleProperties, type);
  });
}
function Dereference(moduleProperties, ref) {
  return ref in moduleProperties ? IsRef3(moduleProperties[ref]) ? Dereference(moduleProperties, moduleProperties[ref].$ref) : FromType2(moduleProperties, moduleProperties[ref]) : Never2();
}
function FromAwaited(parameters) {
  return Awaited(parameters[0]);
}
function FromIndex(parameters) {
  return Index(parameters[0], parameters[1]);
}
function FromKeyOf(parameters) {
  return KeyOf(parameters[0]);
}
function FromPartial(parameters) {
  return Partial(parameters[0]);
}
function FromOmit(parameters) {
  return Omit(parameters[0], parameters[1]);
}
function FromPick(parameters) {
  return Pick(parameters[0], parameters[1]);
}
function FromRequired(parameters) {
  return Required(parameters[0]);
}
function FromComputed5(moduleProperties, target, parameters) {
  const dereferenced = DereferenceParameters(moduleProperties, parameters);
  return target === "Awaited" ? FromAwaited(dereferenced) : target === "Index" ? FromIndex(dereferenced) : target === "KeyOf" ? FromKeyOf(dereferenced) : target === "Partial" ? FromPartial(dereferenced) : target === "Omit" ? FromOmit(dereferenced) : target === "Pick" ? FromPick(dereferenced) : target === "Required" ? FromRequired(dereferenced) : Never2();
}
function FromArray19(moduleProperties, type) {
  return Array2(FromType2(moduleProperties, type));
}
function FromAsyncIterator7(moduleProperties, type) {
  return AsyncIterator(FromType2(moduleProperties, type));
}
function FromConstructor8(moduleProperties, parameters, instanceType) {
  return Constructor(FromTypes2(moduleProperties, parameters), FromType2(moduleProperties, instanceType));
}
function FromFunction7(moduleProperties, parameters, returnType) {
  return Function(FromTypes2(moduleProperties, parameters), FromType2(moduleProperties, returnType));
}
function FromIntersect20(moduleProperties, types) {
  return Intersect2(FromTypes2(moduleProperties, types));
}
function FromIterator7(moduleProperties, type) {
  return Iterator(FromType2(moduleProperties, type));
}
function FromObject18(moduleProperties, properties) {
  return Object3(globalThis.Object.keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType2(moduleProperties, properties[key]) };
  }, {}));
}
function FromRecord13(moduleProperties, type) {
  const [value, pattern] = [FromType2(moduleProperties, RecordValue2(type)), RecordPattern(type)];
  const result = CloneType(type);
  result.patternProperties[pattern] = value;
  return result;
}
function FromTransform(moduleProperties, transform) {
  return IsRef3(transform) ? { ...Dereference(moduleProperties, transform.$ref), [TransformKind2]: transform[TransformKind2] } : transform;
}
function FromTuple17(moduleProperties, types) {
  return Tuple(FromTypes2(moduleProperties, types));
}
function FromUnion22(moduleProperties, types) {
  return Union3(FromTypes2(moduleProperties, types));
}
function FromTypes2(moduleProperties, types) {
  return types.map((type) => FromType2(moduleProperties, type));
}
function FromType2(moduleProperties, type) {
  return (
    // Modifiers
    IsOptional2(type) ? CreateType2(FromType2(moduleProperties, Discard2(type, [OptionalKind2])), type) : IsReadonly(type) ? CreateType2(FromType2(moduleProperties, Discard2(type, [ReadonlyKind2])), type) : (
      // Transform
      IsTransform3(type) ? CreateType2(FromTransform(moduleProperties, type), type) : (
        // Types
        IsArray7(type) ? CreateType2(FromArray19(moduleProperties, type.items), type) : IsAsyncIterator5(type) ? CreateType2(FromAsyncIterator7(moduleProperties, type.items), type) : IsComputed3(type) ? CreateType2(FromComputed5(moduleProperties, type.target, type.parameters)) : IsConstructor3(type) ? CreateType2(FromConstructor8(moduleProperties, type.parameters, type.returns), type) : IsFunction5(type) ? CreateType2(FromFunction7(moduleProperties, type.parameters, type.returns), type) : IsIntersect3(type) ? CreateType2(FromIntersect20(moduleProperties, type.allOf), type) : IsIterator5(type) ? CreateType2(FromIterator7(moduleProperties, type.items), type) : IsObject7(type) ? CreateType2(FromObject18(moduleProperties, type.properties), type) : IsRecord3(type) ? CreateType2(FromRecord13(moduleProperties, type)) : IsTuple3(type) ? CreateType2(FromTuple17(moduleProperties, type.items || []), type) : IsUnion3(type) ? CreateType2(FromUnion22(moduleProperties, type.anyOf), type) : type
      )
    )
  );
}
function ComputeType(moduleProperties, key) {
  return key in moduleProperties ? FromType2(moduleProperties, moduleProperties[key]) : Never2();
}
function ComputeModuleProperties(moduleProperties) {
  return globalThis.Object.getOwnPropertyNames(moduleProperties).reduce((result, key) => {
    return { ...result, [key]: ComputeType(moduleProperties, key) };
  }, {});
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/module/module.mjs
var TModule = class {
  constructor($defs) {
    const computed = ComputeModuleProperties($defs);
    const identified = this.WithIdentifiers(computed);
    this.$defs = identified;
  }
  /** `[Json]` Imports a Type by Key. */
  Import(key, options) {
    const $defs = { ...this.$defs, [key]: CreateType2(this.$defs[key], options) };
    return CreateType2({ [Kind2]: "Import", $defs, $ref: key });
  }
  // prettier-ignore
  WithIdentifiers($defs) {
    return globalThis.Object.getOwnPropertyNames($defs).reduce((result, key) => {
      return { ...result, [key]: { ...$defs[key], $id: key } };
    }, {});
  }
};
function Module(properties) {
  return new TModule(properties);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/not/not.mjs
function Not2(type, options) {
  return CreateType2({ [Kind2]: "Not", not: type }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/parameters/parameters.mjs
function Parameters(schema, options) {
  return IsFunction5(schema) ? Tuple(schema.parameters, options) : Never2();
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/recursive/recursive.mjs
var Ordinal = 0;
function Recursive(callback, options = {}) {
  if (IsUndefined5(options.$id))
    options.$id = `T${Ordinal++}`;
  const thisType = CloneType(callback({ [Kind2]: "This", $ref: `${options.$id}` }));
  thisType.$id = options.$id;
  return CreateType2({ [Hint2]: "Recursive", ...thisType }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/regexp/regexp.mjs
function RegExp2(unresolved, options) {
  const expr = IsString5(unresolved) ? new globalThis.RegExp(unresolved) : unresolved;
  return CreateType2({ [Kind2]: "RegExp", type: "RegExp", source: expr.source, flags: expr.flags }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/rest/rest.mjs
function RestResolve(T) {
  return IsIntersect3(T) ? T.allOf : IsUnion3(T) ? T.anyOf : IsTuple3(T) ? T.items ?? [] : [];
}
function Rest(T) {
  return RestResolve(T);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/return-type/return-type.mjs
function ReturnType(schema, options) {
  return IsFunction5(schema) ? CreateType2(schema.returns, options) : Never2(options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/transform/transform.mjs
var TransformDecodeBuilder = class {
  constructor(schema) {
    this.schema = schema;
  }
  Decode(decode) {
    return new TransformEncodeBuilder(this.schema, decode);
  }
};
var TransformEncodeBuilder = class {
  constructor(schema, decode) {
    this.schema = schema;
    this.decode = decode;
  }
  EncodeTransform(encode, schema) {
    const Encode2 = (value) => schema[TransformKind2].Encode(encode(value));
    const Decode2 = (value) => this.decode(schema[TransformKind2].Decode(value));
    const Codec = { Encode: Encode2, Decode: Decode2 };
    return { ...schema, [TransformKind2]: Codec };
  }
  EncodeSchema(encode, schema) {
    const Codec = { Decode: this.decode, Encode: encode };
    return { ...schema, [TransformKind2]: Codec };
  }
  Encode(encode) {
    return IsTransform3(this.schema) ? this.EncodeTransform(encode, this.schema) : this.EncodeSchema(encode, this.schema);
  }
};
function Transform(schema) {
  return new TransformDecodeBuilder(schema);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/unsafe/unsafe.mjs
function Unsafe(options = {}) {
  return CreateType2({ [Kind2]: options[Kind2] ?? "Unsafe" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/void/void.mjs
function Void(options) {
  return CreateType2({ [Kind2]: "Void", type: "void" }, options);
}

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/type/type.mjs
var type_exports3 = {};
__export(type_exports3, {
  Any: () => Any,
  Argument: () => Argument,
  Array: () => Array2,
  AsyncIterator: () => AsyncIterator,
  Awaited: () => Awaited,
  BigInt: () => BigInt2,
  Boolean: () => Boolean2,
  Capitalize: () => Capitalize,
  Composite: () => Composite,
  Const: () => Const,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Date: () => Date2,
  Enum: () => Enum,
  Exclude: () => Exclude,
  Extends: () => Extends,
  Extract: () => Extract,
  Function: () => Function,
  Index: () => Index,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Intersect: () => Intersect2,
  Iterator: () => Iterator,
  KeyOf: () => KeyOf,
  Literal: () => Literal2,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module,
  Never: () => Never2,
  Not: () => Not2,
  Null: () => Null,
  Number: () => Number2,
  Object: () => Object3,
  Omit: () => Omit,
  Optional: () => Optional2,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Promise: () => Promise2,
  Readonly: () => Readonly,
  ReadonlyOptional: () => ReadonlyOptional,
  Record: () => Record,
  Recursive: () => Recursive,
  Ref: () => Ref2,
  RegExp: () => RegExp2,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  String: () => String3,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral,
  Transform: () => Transform,
  Tuple: () => Tuple,
  Uint8Array: () => Uint8Array2,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union3,
  Unknown: () => Unknown2,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void
});

// ../widgetdc-contracts/node_modules/@sinclair/typebox/build/esm/type/type/index.mjs
var Type = type_exports3;

// ../widgetdc-contracts/dist/orchestrator/fabric-proof.js
var FabricProof = Type.Object({
  proof_id: Type.String({
    format: "uuid",
    description: "Unique identifier for the issued fabric proof"
  }),
  proof_type: Type.Union([
    Type.Literal("sgt"),
    Type.String()
  ], {
    description: "Fabric proof mechanism identifier"
  }),
  verification_status: Type.Union([
    Type.Literal("verified"),
    Type.Literal("unverified"),
    Type.Literal("expired"),
    Type.Literal("revoked")
  ], {
    description: "Verification result for the proof at issuance or last refresh"
  }),
  authorized_tool_namespaces: Type.Array(Type.String(), {
    description: 'Tool namespaces this proof authorizes. ["*"] grants all namespaces.'
  }),
  issued_at: Type.String({ format: "date-time" }),
  expires_at: Type.Optional(Type.String({ format: "date-time" })),
  issuer: Type.Optional(Type.String({
    description: "Canonical issuer of the proof"
  })),
  handshake_id: Type.Optional(Type.String({
    description: "Associated handshake identifier or fingerprint"
  }))
}, {
  $id: "FabricProof",
  description: "Verified immutable fabric proof issued during agent handshake. Used to authorize high-risk delegation and tool execution."
});

// ../widgetdc-contracts/dist/orchestrator/tool-call.js
var OrchestratorToolCall = Type.Object({
  /** Unique call ID — used to correlate with OrchestratorToolResult */
  call_id: Type.String({
    format: "uuid",
    description: "Unique ID for this tool call (agent-generated UUID)"
  }),
  /** Agent identity — which agent is requesting the tool */
  agent_id: Type.String({
    description: "Canonical agent ID (e.g. CAPTAIN_CLAUDE, GEMINI_ARCHITECT, RLM_ENGINE)"
  }),
  /** MCP tool namespace + name (e.g. "graph.read_cypher", "audit.lessons") */
  tool_name: Type.String({
    pattern: "^[a-z_]+\\.[a-z_]+$",
    description: "MCP tool name in namespace.method format"
  }),
  /** Tool arguments — passed directly to the MCP tool as payload */
  arguments: Type.Record(Type.String(), Type.Unknown(), {
    description: "Tool-specific arguments (passed as payload to MCP route)"
  }),
  /** Delegated fabric proof copied from verified handshake when high-risk namespaces are requested. */
  fabric_proof: Type.Optional(FabricProof),
  /** Optional: cross-service trace ID for end-to-end correlation */
  trace_id: Type.Optional(Type.String({ format: "uuid" })),
  /** Priority hint — higher priority calls are processed first */
  priority: Type.Optional(Type.Union([
    Type.Literal("low"),
    Type.Literal("normal"),
    Type.Literal("high"),
    Type.Literal("critical")
  ], { default: "normal" })),
  /** Timeout the agent is willing to wait (ms) */
  timeout_ms: Type.Optional(Type.Integer({ minimum: 500, maximum: 12e4, default: 3e4 })),
  /** ISO timestamp when the call was emitted */
  emitted_at: Type.Optional(Type.String({ format: "date-time" }))
}, {
  $id: "OrchestratorToolCall",
  description: "Agent \u2192 Orchestrator: request to invoke an MCP tool on the WidgeTDC backend. Orchestrator injects auth and handles SSE."
});

// ../widgetdc-contracts/dist/orchestrator/tool-result.js
var OrchestratorToolStatus = Type.Union([
  Type.Literal("success"),
  Type.Literal("error"),
  Type.Literal("timeout"),
  Type.Literal("rate_limited"),
  Type.Literal("unauthorized")
], {
  $id: "OrchestratorToolStatus",
  description: "Outcome status of an Orchestrator tool call"
});
var OrchestratorToolResult = Type.Object({
  /** Correlates back to OrchestratorToolCall.call_id */
  call_id: Type.String({
    format: "uuid",
    description: "Mirrors the call_id from the originating OrchestratorToolCall"
  }),
  /** Outcome */
  status: OrchestratorToolStatus,
  /** Raw result from the MCP tool (null on error) */
  result: Type.Union([Type.Unknown(), Type.Null()], {
    description: "Parsed tool output \u2014 whatever the MCP tool returned"
  }),
  /** Human-readable error message (only set when status != success) */
  error_message: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /** Error code for programmatic handling */
  error_code: Type.Optional(Type.Union([
    Type.Literal("TOOL_NOT_FOUND"),
    Type.Literal("VALIDATION_ERROR"),
    Type.Literal("BACKEND_ERROR"),
    Type.Literal("TIMEOUT"),
    Type.Literal("RATE_LIMITED"),
    Type.Literal("UNAUTHORIZED"),
    Type.Literal("SSE_PARSE_ERROR"),
    Type.Null()
  ])),
  /** How long the backend call took (ms) */
  duration_ms: Type.Optional(Type.Number({ minimum: 0 })),
  /** Correlation trace ID (mirrors the call's trace_id if provided) */
  trace_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  /** ISO timestamp when result was produced */
  completed_at: Type.Optional(Type.String({ format: "date-time" }))
}, {
  $id: "OrchestratorToolResult",
  description: "Orchestrator \u2192 Agent: result of an MCP tool invocation. Includes raw output or structured error."
});

// ../widgetdc-contracts/dist/orchestrator/agent-message.js
var AgentId = Type.Union([
  Type.Literal("Claude"),
  Type.Literal("Gemini"),
  Type.Literal("DeepSeek"),
  Type.Literal("Grok"),
  Type.Literal("RLM"),
  Type.Literal("User"),
  Type.Literal("System"),
  Type.Literal("Orchestrator")
], {
  $id: "AgentId",
  description: "Canonical agent identifiers matching Notion Global Chat From/To schema"
});
var AgentMessageSource = Type.Union([
  Type.Literal("claude"),
  Type.Literal("gemini"),
  Type.Literal("deepseek"),
  Type.Literal("grok"),
  Type.Literal("rlm"),
  Type.Literal("user"),
  Type.Literal("system"),
  Type.Literal("orchestrator")
], {
  $id: "AgentMessageSource",
  description: "Lowercase source identifier for technical routing"
});
var AgentMessageType = Type.Union([
  Type.Literal("Message"),
  // Free-form chat message
  Type.Literal("Command"),
  // Directive to execute something
  Type.Literal("Answer"),
  // Response to a previous Command or Question
  Type.Literal("Handover"),
  // Formal agent handover (sprint transitions)
  Type.Literal("Alert"),
  // System alert or urgent notification
  Type.Literal("ToolResult"),
  // Result of an Orchestrator tool call
  Type.Literal("Arbitration"),
  // Explicit arbitration packet in the governed routing loop
  Type.Literal("Divergence")
  // Explicit disagreement/divergence packet for tri-source review
], {
  $id: "AgentMessageType",
  description: "Classification of the message purpose"
});
var AgentMessage = Type.Object({
  /** Unique message ID (UUID or Notion page ID) */
  message_id: Type.Optional(Type.String({
    description: "Unique message identifier (assigned by storage layer)"
  })),
  /** Who sent this message (known agent or custom ID) */
  from: Type.Union([AgentId, Type.String()], {
    description: "Sender agent ID"
  }),
  /** Who should receive it (or "All" for broadcast) */
  to: Type.Union([AgentId, Type.Literal("All"), Type.String()], {
    description: "Target recipient or All for broadcast"
  }),
  /** Technical source identifier (known or custom) */
  source: Type.Union([AgentMessageSource, Type.String()], {
    description: 'Technical source identifier (e.g. "claude", "browser")'
  }),
  /** Conversation thread identifier (groups related messages) */
  thread: Type.Optional(Type.String({
    description: 'Thread ID for grouping related messages (e.g. "widgetdc-sprint-march26")'
  })),
  /** Message classification */
  type: AgentMessageType,
  /** The actual message content */
  message: Type.String({
    minLength: 1,
    description: "Message text content (markdown supported)"
  }),
  /** Optional: reference to an OrchestratorToolCall.call_id */
  call_id: Type.Optional(Type.String({
    description: "Links this message to a specific tool call (for ToolResult messages)"
  })),
  /** Storage-layer assigned message ID */
  id: Type.Optional(Type.String({
    description: "Storage-layer assigned message ID (e.g. UUID or Redis-generated)"
  })),
  /** Thread grouping — groups related messages (alias for thread) */
  thread_id: Type.Optional(Type.String({
    description: "Thread ID for grouping related messages"
  })),
  /** Direct reply-to message ID */
  parent_id: Type.Optional(Type.String({
    description: "ID of the message this is a direct reply to"
  })),
  /** Attached files */
  files: Type.Optional(Type.Array(Type.Object({
    name: Type.String(),
    size: Type.Number(),
    type: Type.String()
  }), {
    description: "File attachments on this message"
  })),
  /** Arbitrary metadata (provider info, conversation_id, etc.) */
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: "Extensible metadata (e.g. provider, model, duration_ms, conversation_id)"
  })),
  /** ISO timestamp */
  timestamp: Type.Optional(Type.String({
    format: "date-time",
    description: "When this message was created"
  }))
}, {
  $id: "AgentMessage",
  description: "Shared message format for agent\u2194agent and agent\u2194user communication. Matches Notion Global Chat schema."
});

// ../widgetdc-contracts/dist/orchestrator/agent-handshake.js
var AgentCapability = Type.Union([
  Type.Literal("graph_read"),
  // Can read Neo4j via graph.read_cypher
  Type.Literal("graph_write"),
  // Can write Neo4j via graph.write_cypher
  Type.Literal("mcp_tools"),
  // Can invoke MCP tools via Orchestrator
  Type.Literal("cognitive_reasoning"),
  // Can use /cognitive/* endpoints (RLM)
  Type.Literal("document_generation"),
  // Can use docgen.* tools
  Type.Literal("osint"),
  // Can use osint.* tools
  Type.Literal("code_execution"),
  // Can use compute.* tools
  Type.Literal("ingestion"),
  // Can trigger data ingestion
  Type.Literal("git_operations"),
  // Can use git.* tools
  Type.Literal("audit")
  // Can use audit.* tools
], {
  $id: "AgentCapability",
  description: "Capability flags declaring what an agent is authorized to do"
});
var AgentHandshakeStatus = Type.Union([
  Type.Literal("online"),
  Type.Literal("standby"),
  Type.Literal("offline"),
  Type.Literal("degraded")
], {
  $id: "AgentHandshakeStatus",
  description: "Agent availability status"
});
var AgentHandshake = Type.Object({
  /** Canonical agent ID */
  agent_id: Type.String({
    description: "Canonical agent identifier (e.g. CAPTAIN_CLAUDE, GEMINI_ARCHITECT)"
  }),
  /** Display name (human-readable, free-form) */
  display_name: Type.String({
    description: 'Human-readable display name (e.g. "Consulting Frontend", "Captain Claude")'
  }),
  /** Technical source key (known agents or custom) */
  source: Type.Union([AgentMessageSource, Type.String()], {
    description: 'Technical source identifier (e.g. "claude", "browser", "custom-agent")'
  }),
  /** Agent version or build identifier */
  version: Type.Optional(Type.String({
    description: 'Agent version string (e.g. "claude-sonnet-4-5", "gemini-2.0-flash")'
  })),
  /** Current availability status */
  status: AgentHandshakeStatus,
  /** Declared capabilities — Orchestrator enforces these as ACL.
   *  Accepts both known AgentCapability literals and free-form strings
   *  for domain-specific capabilities (e.g. 'sitrep', 'threat_hunting'). */
  capabilities: Type.Array(Type.Union([AgentCapability, Type.String()]), {
    description: "List of capabilities this agent is authorized to use (known + domain-specific)",
    minItems: 0
  }),
  /** Allowed MCP tool namespaces (e.g. ["graph", "audit", "consulting"])
   *  Empty = no MCP tool access. ["*"] = all tools (superuser — use with caution).
   */
  allowed_tool_namespaces: Type.Array(Type.String(), {
    description: 'MCP tool namespaces this agent may invoke (e.g. ["graph", "audit"])'
  }),
  /** Verified immutable fabric proof for authorizing high-risk delegation/tool execution. */
  fabric_proof: Type.Optional(FabricProof),
  /** Optimized search index fingerprint for lazy-loading tools (Adoption: Anthropic Tool Search Index). Reduces handshake token bloat by 85%. */
  capability_index: Type.Optional(Type.String({
    description: "Optimized search index fingerprint for lazy-loading tools (Adoption: Anthropic Tool Search Index). Reduces handshake token bloat by 85%."
  })),
  /** Supported memory layers for this agent (Adoption: OpenClaw Memory Tiering). */
  memory_tiers: Type.Optional(Type.Array(Type.Union([
    Type.Literal("working"),
    Type.Literal("episodic"),
    Type.Literal("semantic")
  ]), {
    description: "Supported memory layers for this agent (Adoption: OpenClaw Memory Tiering)."
  })),
  /** Max concurrent tool calls this agent is allowed to make */
  max_concurrent_calls: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 20,
    default: 5
  })),
  /** Preferred thread ID for this agent's chat messages */
  default_thread: Type.Optional(Type.String({
    description: "Default Notion Global Chat thread for this agent"
  })),
  /** ISO timestamp of this handshake */
  registered_at: Type.Optional(Type.String({ format: "date-time" })),
  /** ISO timestamp of last heartbeat (Orchestrator updates this) */
  last_seen_at: Type.Optional(Type.String({ format: "date-time" }))
}, {
  $id: "AgentHandshake",
  description: "Agent registration payload. Sent to Orchestrator on boot to declare identity, capabilities, and tool permissions."
});

// ../widgetdc-contracts/dist/orchestrator/stored-message.js
var StoredMessage = Type.Intersect([
  AgentMessage,
  Type.Object({
    /** Storage-assigned unique ID (required for persistence) */
    id: Type.String({
      description: "Storage-assigned message ID"
    }),
    /** Emoji reactions: emoji → list of agent IDs */
    reactions: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()), { description: "Emoji reactions: emoji key \u2192 agent IDs who reacted" })),
    /** Whether this message is pinned */
    pinned: Type.Optional(Type.Boolean({
      description: "Whether this message is pinned in the chat"
    }))
  })
], {
  $id: "StoredMessage",
  description: "Persisted agent message with storage-layer fields (id, reactions, pinned). Extends AgentMessage."
});

// ../widgetdc-contracts/dist/agent/enums.js
var AgentTier = Type.Union([
  Type.Literal("ANALYST"),
  Type.Literal("ASSOCIATE"),
  Type.Literal("MANAGER"),
  Type.Literal("PARTNER"),
  Type.Literal("ARCHITECT")
], { $id: "AgentTier", description: "Consulting agent tier (ascending autonomy)" });
var AgentPersona = Type.Union([
  Type.Literal("RESEARCHER"),
  Type.Literal("ENGINEER"),
  Type.Literal("CUSTODIAN"),
  Type.Literal("ARCHITECT"),
  Type.Literal("SENTINEL"),
  Type.Literal("ARCHIVIST"),
  Type.Literal("HARVESTER"),
  Type.Literal("ANALYST"),
  Type.Literal("INTEGRATOR"),
  Type.Literal("TESTER")
], { $id: "AgentPersona", description: "RLM Engine agent persona" });
var SignalType = Type.Union([
  Type.Literal("task_started"),
  Type.Literal("task_completed"),
  Type.Literal("task_failed"),
  Type.Literal("escalation"),
  Type.Literal("quality_gate"),
  Type.Literal("tool_executed"),
  Type.Literal("deliverable_generated"),
  Type.Literal("insight"),
  Type.Literal("warning")
], { $id: "SignalType", description: "Agent signal event type" });

// ../widgetdc-contracts/dist/orchestrator/agent-trust-profile.js
var OrchestratorTaskDomain = Type.Union([
  Type.Literal("intake"),
  Type.Literal("decomposition"),
  Type.Literal("recommendation"),
  Type.Literal("learning"),
  Type.Literal("routing"),
  Type.Literal("audit")
], {
  $id: "OrchestratorTaskDomain",
  description: "Narrow task domains used by the orchestrator trust model and scorecard mapping."
});
var TrustEvidenceSource = Type.Union([
  Type.Literal("decision_quality_scorecard"),
  Type.Literal("monitoring_audit_log"),
  Type.Literal("operator_feedback"),
  Type.Literal("runtime_readback")
], {
  $id: "TrustEvidenceSource",
  description: "Canonical evidence sources allowed to influence routing trust."
});
var ScorecardDimension = Type.Union([
  Type.Literal("prioritization_quality"),
  Type.Literal("decomposition_quality"),
  Type.Literal("promotion_precision"),
  Type.Literal("decision_stability"),
  Type.Literal("operator_acceptance"),
  Type.Literal("normalization_quality"),
  Type.Literal("arbitration_confidence"),
  Type.Literal("time_to_verified_decision"),
  Type.Literal("tri_source_arbitration_divergence")
], {
  $id: "ScorecardDimension",
  description: "Canonical decision-quality dimensions approved for trust mapping and scorecard entries."
});
var ScopeOwner = Type.Union([
  Type.Literal("widgetdc-orchestrator"),
  Type.Literal("widgetdc-librechat"),
  Type.Literal("snout")
], {
  $id: "ScopeOwner",
  description: "Approved runtime owner or consumer scope for routing and trust contracts."
});
var AgentTrustProfile = Type.Object({
  agent_persona: AgentPersona,
  agent_id: Type.Optional(Type.Union([AgentId, Type.String()], {
    description: "Legacy chat/runtime agent identifier. Optional because trust is anchored on persona, not provider."
  })),
  runtime_identity: Type.Optional(Type.String({
    minLength: 1,
    description: "Scoped runtime identity for a concrete worker, session, or delegated specialist."
  })),
  provider_source: Type.Optional(Type.String({
    minLength: 1,
    description: "Observed provider source for telemetry correlation only. Must not be used as the trust identity."
  })),
  task_domain: OrchestratorTaskDomain,
  success_count: Type.Integer({
    minimum: 0,
    description: "Verified successful outcomes in this domain."
  }),
  fail_count: Type.Integer({
    minimum: 0,
    description: "Verified failed outcomes in this domain."
  }),
  bayesian_score: Type.Number({
    minimum: 0,
    maximum: 1,
    description: "Bayesian trust score derived from verified runtime evidence."
  }),
  prior_weight: Type.Number({
    minimum: 0,
    description: "Weight of the prior used for Bayesian smoothing."
  }),
  default_prior_score: Type.Number({
    minimum: 0,
    maximum: 1,
    description: "Configured prior score before domain-specific evidence accumulates."
  }),
  evidence_source: TrustEvidenceSource,
  scorecard_dimension: ScorecardDimension,
  scope_owner: ScopeOwner,
  last_verified_at: Type.String({
    format: "date-time",
    description: "Latest runtime verification timestamp for this trust profile."
  })
}, {
  $id: "AgentTrustProfile",
  description: "Minimal orchestrator trust profile. Persona is the primary identity; provider identifiers are telemetry-only correlation metadata."
});

// ../widgetdc-contracts/dist/orchestrator/scorecard-entry.js
var ScorecardMetricStatus = Type.Union([
  Type.Literal("pass"),
  Type.Literal("warn"),
  Type.Literal("fail"),
  Type.Literal("pending")
], {
  $id: "ScorecardMetricStatus",
  description: "Evaluation status for a scorecard metric."
});
var ScorecardEntry = Type.Object({
  entry_id: Type.String({
    minLength: 1,
    description: "Stable scorecard entry identifier for a batch, case, or evaluation window."
  }),
  recorded_at: Type.String({
    format: "date-time",
    description: "Timestamp when the scorecard entry was recorded."
  }),
  task_domain: OrchestratorTaskDomain,
  scope_owner: ScopeOwner,
  dimension: ScorecardDimension,
  metric_name: Type.String({
    minLength: 1,
    description: "Human-readable metric label, e.g. Normalization Quality."
  }),
  metric_value: Type.Number({
    description: "Observed metric value."
  }),
  target_value: Type.Optional(Type.Number({
    description: "Target metric value for comparison."
  })),
  status: ScorecardMetricStatus,
  confidence: Type.Number({
    minimum: 0,
    maximum: 1,
    description: "Confidence in the metric evaluation."
  }),
  sample_size: Type.Integer({
    minimum: 0,
    description: "Number of observations underlying the metric."
  }),
  evidence_refs: Type.Array(Type.String(), {
    minItems: 1,
    description: "References to runtime, Linear, docs, or graph evidence."
  }),
  trust_profile: Type.Optional(AgentTrustProfile),
  notes: Type.Optional(Type.String({
    description: "Short explanatory note for operators or audits."
  }))
}, {
  $id: "ScorecardEntry",
  description: "Canonical decision-quality scorecard entry used for runtime enforcement, monitoring, and governed routing review."
});

// ../widgetdc-contracts/dist/orchestrator/telemetry-entry.js
var TelemetryPhase = Type.Union([
  Type.Literal("discover"),
  Type.Literal("define"),
  Type.Literal("develop"),
  Type.Literal("deliver"),
  Type.Literal("observe"),
  Type.Literal("orient"),
  Type.Literal("decide"),
  Type.Literal("act")
], {
  $id: "TelemetryPhase",
  description: "Canonical workflow or OODA phase associated with a telemetry sample."
});
var TelemetryOutcome = Type.Union([
  Type.Literal("success"),
  Type.Literal("warning"),
  Type.Literal("timeout"),
  Type.Literal("fail"),
  Type.Literal("blocked")
], {
  $id: "TelemetryOutcome",
  description: "Normalized runtime outcome for telemetry ingestion."
});
var TelemetryEntry = Type.Object({
  telemetry_id: Type.Optional(Type.String({
    minLength: 1,
    description: "Stable telemetry identifier when available."
  })),
  timestamp: Type.String({
    format: "date-time",
    description: "Runtime timestamp for the event."
  }),
  scope_owner: ScopeOwner,
  agent_persona: AgentPersona,
  runtime_identity: Type.Optional(Type.String({
    minLength: 1,
    description: "Concrete runtime worker/session identity."
  })),
  provider_source: Type.Optional(Type.String({
    minLength: 1,
    description: "Observed provider for correlation only."
  })),
  task_domain: OrchestratorTaskDomain,
  capability: Type.Optional(Type.String({
    minLength: 1,
    description: "Capability or workflow label associated with the event."
  })),
  phase: TelemetryPhase,
  outcome: TelemetryOutcome,
  duration_ms: Type.Integer({
    minimum: 0,
    description: "Observed duration in milliseconds."
  }),
  evidence_source: TrustEvidenceSource,
  trace_id: Type.Optional(Type.String({
    minLength: 1,
    description: "Trace or checkpoint identifier for read-back correlation."
  })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]), {
    description: "Small scalar metadata only. Raw payloads and provider transcripts are out of scope."
  }))
}, {
  $id: "TelemetryEntry",
  description: "Normalized telemetry sample for orchestrator trust and scorecard ingestion. It aligns telemetry with persona-based trust instead of provider identity."
});

// ../widgetdc-contracts/dist/orchestrator/routing-intent.js
var RoutingCapability = Type.Union([
  Type.Literal("engagement_intake"),
  Type.Literal("guided_decomposition"),
  Type.Literal("verified_recommendation"),
  Type.Literal("learning_feedback"),
  Type.Literal("workflow_audit")
], {
  $id: "RoutingCapability",
  description: "Capabilities the orchestrator may route within the active LIN-165 wedge."
});
var RoutingIntent = Type.Object({
  intent_id: Type.String({
    description: "Stable intent identifier for routing and lineage."
  }),
  capability: RoutingCapability,
  task_domain: Type.Union([
    Type.Literal("intake"),
    Type.Literal("decomposition"),
    Type.Literal("recommendation"),
    Type.Literal("learning"),
    Type.Literal("audit")
  ], {
    description: "Execution domain for scorecard and trust-model mapping."
  }),
  flow_ref: Type.Union([
    Type.Literal("core-flow-1"),
    Type.Literal("core-flow-2"),
    Type.Literal("core-flow-3")
  ], {
    description: "Canonical LIN-165 flow this intent strengthens."
  }),
  route_scope: Type.Array(Type.Union([
    Type.Literal("widgetdc-orchestrator"),
    Type.Literal("widgetdc-librechat"),
    Type.Literal("snout")
  ]), {
    minItems: 1,
    uniqueItems: true,
    description: "Only approved consumers for this routing intent."
  }),
  operator_visible: Type.Boolean({
    description: "Whether this intent may be surfaced in LibreChat lineage UI."
  }),
  scorecard_dimensions: Type.Array(Type.Union([
    Type.Literal("prioritization_quality"),
    Type.Literal("decomposition_quality"),
    Type.Literal("promotion_precision"),
    Type.Literal("decision_stability"),
    Type.Literal("operator_acceptance"),
    Type.Literal("time_to_verified_decision"),
    Type.Literal("tri_source_arbitration_divergence")
  ]), {
    minItems: 1,
    uniqueItems: true,
    description: "Decision-quality dimensions this routing intent is expected to affect."
  })
}, {
  $id: "RoutingIntent",
  description: "Canonical routing intent used by the orchestrator to classify and constrain work within the active WidgeTDC wedge."
});

// ../widgetdc-contracts/dist/orchestrator/routing-decision.js
var RoutingDecision = Type.Object({
  decision_id: Type.String({
    description: "Stable routing decision identifier for runtime lineage and read-back."
  }),
  intent: RoutingIntent,
  selected_agent_id: Type.Union([AgentId, Type.String()], {
    description: "Selected agent or runtime agent ID chosen by the orchestrator."
  }),
  selected_capability: RoutingCapability,
  trust_score: Type.Number({
    minimum: 0,
    maximum: 1,
    description: "Trust score that justified the selected route."
  }),
  reason_code: Type.Union([
    Type.Literal("TRUST_WIN"),
    Type.Literal("COST_TIER_MATCH"),
    Type.Literal("FLOW_SPECIALIZATION"),
    Type.Literal("FALLBACK_ROUTE"),
    Type.Literal("WAIVER_ROUTE"),
    Type.Literal("FABRIC_WIN")
  ], {
    description: "Why this route was selected."
  }),
  fabric_route_id: Type.Optional(Type.String({
    description: "Virtual fabric identifier for low-latency agent-to-agent communication (Adoption: NVIDIA NVLink 6)."
  })),
  latency_deterministic: Type.Optional(Type.Boolean({
    description: "Whether the route guarantees deterministic response time for MoE (Mixture-of-Experts) swarms.",
    default: false
  })),
  vampire_drain_rate: Type.Optional(Type.Number({
    minimum: 0,
    maximum: 1,
    description: "Rate of intellectual or economic value extraction from the target competitor (Adoption: Strategic Strategy Vampire)."
  })),
  target_shadow_id: Type.Optional(Type.String({
    description: "Reference to the CompetitorShadow node being drained or intercepted."
  })),
  evidence_refs: Type.Array(Type.String(), {
    minItems: 1,
    description: "References to trust, scorecard, or runtime evidence used during routing."
  }),
  waiver_reason: Type.Optional(Type.String({
    description: "Required when fallback or waiver routing is used instead of the ideal route."
  })),
  decided_at: Type.String({
    format: "date-time",
    description: "Timestamp when the routing decision was made."
  })
}, {
  $id: "RoutingDecision",
  description: "Minimal routing decision envelope. Supports orchestrator routing transparency without introducing a second governance truth."
});

// ../widgetdc-contracts/dist/orchestrator/workflow-envelope.js
var WorkflowPhase = Type.Union([
  Type.Literal("discover"),
  Type.Literal("define"),
  Type.Literal("develop"),
  Type.Literal("deliver")
], {
  $id: "WorkflowPhase",
  description: "Canonical orchestration phases, narrowed for orchestrator/librechat/snout usage only."
});
var WorkflowType = Type.Union([
  Type.Literal("research"),
  Type.Literal("delivery"),
  Type.Literal("audit"),
  Type.Literal("debate")
], {
  $id: "WorkflowType",
  description: "Workflow families allowed for the scoped orchestration layer."
});
var AgentWorkflowEnvelope = Type.Object({
  workflow_id: Type.String({
    description: "Stable workflow identifier for orchestration lineage."
  }),
  workflow_type: WorkflowType,
  current_phase: WorkflowPhase,
  participants: Type.Array(Type.Union([AgentId, Type.String()]), {
    minItems: 1,
    uniqueItems: true,
    description: "Participants involved in the current workflow envelope."
  }),
  primary_surface: Type.Union([
    Type.Literal("widgetdc-orchestrator"),
    Type.Literal("widgetdc-librechat"),
    Type.Literal("snout")
  ], {
    description: "Primary consumer/runtime that owns this workflow envelope."
  }),
  flow_ref: Type.Union([
    Type.Literal("core-flow-1"),
    Type.Literal("core-flow-2"),
    Type.Literal("core-flow-3")
  ], {
    description: "Canonical LIN-165 flow strengthened by this workflow."
  }),
  scorecard_ref: Type.String({
    description: "Reference to the decision-quality scorecard batch or evidence packet."
  }),
  reasoning_lineage_visible: Type.Boolean({
    description: "Whether the workflow lineage may be surfaced in LibreChat or other approved consumers."
  }),
  quorum_consensus: Type.Optional(Type.Boolean({
    description: "Set when a workflow requires explicit agreement before progressing."
  })),
  compute_mode: Type.Optional(Type.Union([
    Type.Literal("standard"),
    Type.Literal("extreme")
  ], {
    description: "Allocated compute intensity for the current workflow phase.",
    default: "standard"
  })),
  phase_parameters: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: "Optimized parameters for multi-step agentic execution (Adoption: OpenAI Phase Pattern). Reduces token usage via targeted tool discovery."
  })),
  started_at: Type.String({
    format: "date-time",
    description: "Workflow start timestamp."
  }),
  updated_at: Type.String({
    format: "date-time",
    description: "Last workflow state update timestamp."
  })
}, {
  $id: "AgentWorkflowEnvelope",
  description: "Minimal workflow envelope for orchestrator routing and lineage. Not a platform-wide execution bus or governance replacement."
});

// ../widgetdc-contracts/dist/orchestrator/launcher-evidence-packet.js
var LauncherEvidenceFamily = Type.Union([
  Type.Literal("research"),
  Type.Literal("regulatory"),
  Type.Literal("enterprise")
], {
  $id: "LauncherEvidenceFamily",
  description: "Canonical evidence families used by the launcher routing surface."
});
var LauncherEvidenceStatus = Type.Union([
  Type.Literal("grounded"),
  Type.Literal("coverage_gap"),
  Type.Literal("unavailable")
], {
  $id: "LauncherEvidenceStatus",
  description: "Availability state for one evidence family inside the launcher packet."
});
var LauncherEvidenceItem = Type.Object({
  id: Type.String({
    description: "Stable evidence identifier or runtime-derived synthetic key."
  }),
  family: LauncherEvidenceFamily,
  title: Type.String({
    description: "Human-readable evidence title suitable for launcher surfacing."
  }),
  summary: Type.String({
    description: "Short evidence summary for routing and operator review."
  }),
  source_type: Type.String({
    description: "Origin type such as graphrag, regulation, governance_read_model, or runtime_readback."
  }),
  score: Type.Optional(Type.Number({
    description: "Relative relevance score when available."
  })),
  evidence_ref: Type.Optional(Type.String({
    description: "Reference path, query id, or runtime correlation id for read-back."
  }))
}, {
  $id: "LauncherEvidenceItem",
  description: "One surfaced evidence item inside the launcher packet."
});
var LauncherEvidenceFamilyPacket = Type.Object({
  family: LauncherEvidenceFamily,
  status: LauncherEvidenceStatus,
  summary: Type.String({
    description: "Family-level summary used for launcher reasoning and UI surfacing."
  }),
  evidence_items: Type.Array(LauncherEvidenceItem, {
    description: "Top evidence items selected for this family."
  })
}, {
  $id: "LauncherEvidenceFamilyPacket",
  description: "Per-family launcher evidence payload."
});
var LauncherEvidencePacket = Type.Object({
  $id: Type.Literal("orchestrator/launcher-evidence-packet"),
  packet_id: Type.String({
    description: "Stable packet identifier for routing lineage and read-back."
  }),
  question: Type.String({
    description: "Original launcher question used to build the packet."
  }),
  domain: Type.String({
    description: "Domain or org scope used during retrieval."
  }),
  created_at: Type.String({
    format: "date-time",
    description: "Timestamp when the packet was created."
  }),
  tri_source_ready: Type.Boolean({
    description: "True when research, regulatory, and enterprise families all have usable evidence."
  }),
  families: Type.Array(LauncherEvidenceFamilyPacket, {
    minItems: 3,
    maxItems: 3,
    description: "Canonical tri-source evidence families for the launcher surface."
  }),
  evidence_refs: Type.Array(Type.String(), {
    minItems: 1,
    description: "References used for routing transparency and later read-back."
  }),
  governance: Type.Object({
    promotion_status: Type.Union([
      Type.Literal("not_promoted"),
      Type.Literal("blocked")
    ]),
    can_promote: Type.Boolean({
      description: "Launcher evidence packets are read-only and cannot promote by themselves."
    }),
    blocking_reasons: Type.Array(Type.String(), {
      description: "Coverage gaps or governance blockers detected while building the packet."
    })
  })
}, {
  $id: "LauncherEvidencePacket",
  description: "Canonical tri-source evidence packet for launcher routing. Read-only surface for backend and launcher coordination; not a promotion decision."
});

// ../widgetdc-contracts/dist/orchestrator/launcher-contracts.js
var LauncherIntent = Type.Union([
  Type.Literal("info"),
  Type.Literal("analyze"),
  Type.Literal("report"),
  Type.Literal("research"),
  Type.Literal("orchestrate")
], {
  $id: "LauncherIntent",
  description: "Intent values supported by the WidgeTDC launcher surface."
});
var LauncherMode = Type.Union([
  Type.Literal("tool_only"),
  Type.Literal("single"),
  Type.Literal("swarm")
], {
  $id: "LauncherMode",
  description: "Execution modes exposed by launcher planning."
});
var LauncherRequest = Type.Object({
  input: Type.String({
    minLength: 1,
    description: "User-provided launcher task or question."
  }),
  intent: LauncherIntent,
  instruction: Type.Optional(Type.String({
    minLength: 1,
    description: "Canonical single instruction override field for orchestrated requests."
  })),
  instructions: Type.Optional(Type.String({
    minLength: 1,
    description: "Compatibility alias for instruction. Retained until all consumers converge."
  }))
}, {
  $id: "LauncherRequest",
  description: "Shared request contract for launcher surfaces. Surface-local UX payload fields belong outside this schema."
});
var LauncherRequestEcho = Type.Object({
  input: Type.String({
    minLength: 1,
    description: "Echo of normalized launcher input."
  }),
  intent: LauncherIntent
}, {
  $id: "LauncherRequestEcho",
  description: "Normalized launcher request echo returned by orchestrated launcher flows."
});
var LauncherHandoffPayload = Type.Object({
  intent: LauncherIntent,
  prompt: Type.String({
    minLength: 1,
    description: "Prompt payload handed to the deeper workspace surface."
  }),
  executionPath: Type.String({
    minLength: 1,
    description: "Canonical runtime path selected for the task."
  })
}, {
  $id: "LauncherHandoffPayload",
  description: "Shared handoff payload from launcher to downstream workspace/runtime surfaces."
});
var LauncherPlanCore = Type.Object({
  intent: LauncherIntent,
  mode: LauncherMode,
  lineageId: Type.String({
    minLength: 1,
    description: "Stable lineage id for launcher planning and runtime traceability."
  }),
  status: Type.Union([
    Type.Literal("planned"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
    Type.Literal("failed")
  ], {
    description: "Plan state visible to downstream systems."
  }),
  source: Type.Literal("widgetdc-launcher-prototype", {
    description: "Current launcher source surface."
  }),
  executionPath: Type.String({
    minLength: 1,
    description: "Runtime path selected for the launcher task."
  }),
  handoffPayload: LauncherHandoffPayload
}, {
  $id: "LauncherPlanCore",
  description: "Shared launcher plan fields. Surface-local UX fields such as title, nextStep, openedSurface, and launchTarget stay outside this schema."
});
var LauncherGovernanceRoutePolicy = Type.Object({
  foldingRequired: Type.Boolean(),
  retrievalRequired: Type.Boolean(),
  governanceRequired: Type.Boolean(),
  graphVerificationRequired: Type.Boolean(),
  renderValidationRequired: Type.Boolean()
}, {
  $id: "LauncherGovernanceRoutePolicy",
  description: "Launcher-local route policy summary for operator visibility."
});
var LauncherGovernancePromotionPolicy = Type.Object({
  qualityGate: Type.Boolean(),
  policyAlignment: Type.Boolean(),
  graphWriteVerification: Type.Boolean(),
  readBackVerification: Type.Boolean(),
  looseEndGenerationOnFailureOrBlock: Type.Boolean()
}, {
  $id: "LauncherGovernancePromotionPolicy",
  description: "Launcher-local promotion policy summary. Read-only and non-canonical."
});
var LauncherGovernanceGate = Type.Object({
  gate: Type.String({
    minLength: 1,
    description: "Stable gate identifier."
  }),
  status: Type.Union([
    Type.Literal("pass"),
    Type.Literal("fail"),
    Type.Literal("skip"),
    Type.Literal("coverage_gap")
  ]),
  reasonCode: Type.String({
    minLength: 1,
    description: "Machine-readable reason code for the gate outcome."
  })
}, {
  $id: "LauncherGovernanceGate",
  description: "One launcher-local governance gate result."
});
var LauncherGovernanceSummary = Type.Object({
  promotionStatus: Type.Union([
    Type.Literal("not_promoted"),
    Type.Literal("blocked")
  ]),
  looseEnd: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  gates: Type.Array(LauncherGovernanceGate, {
    minItems: 1
  }),
  targetKind: Type.String({
    minLength: 1
  }),
  boundaryOwner: Type.String({
    minLength: 1
  }),
  routePolicy: LauncherGovernanceRoutePolicy,
  promotionPolicy: LauncherGovernancePromotionPolicy,
  disclaimer: Type.String({
    minLength: 1,
    description: "Must state that launcher governance checks are local and not canonical promotion authority."
  })
}, {
  $id: "LauncherGovernanceSummary",
  description: "Read-only launcher governance rendering contract. Local-only governance context; not platform truth."
});
var LauncherExecutionMetadata = Type.Object({
  evidenceDomain: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  reasonDomain: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  canonicalGovernance: Type.Optional(Type.Unknown({
    description: "Canonical backend governance snapshot. Exact shape should converge in dedicated backend schemas."
  })),
  retrievalSummary: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  degradedReasoning: Type.Optional(Type.Boolean()),
  fallbackToReason: Type.Optional(Type.Boolean()),
  fallbackFrom: Type.Optional(Type.String()),
  fallbackError: Type.Optional(Type.String())
}, {
  $id: "LauncherExecutionMetadata",
  description: "Shared launcher execution metadata used for runtime transparency. Surface-only wording fields belong elsewhere.",
  additionalProperties: true
});
var LauncherExecution = Type.Object({
  source: Type.String({
    minLength: 1,
    description: "Execution source path, for example /reason or /api/rlm/ooda/run."
  }),
  summary: Type.String({
    minLength: 1,
    description: "Execution summary text returned by the current runtime path."
  }),
  trace: Type.Array(Type.String(), {
    description: "Runtime trace snippets suitable for cross-service debugging."
  }),
  metadata: LauncherExecutionMetadata,
  governance: LauncherGovernanceSummary
}, {
  $id: "LauncherExecution",
  description: "Shared launcher execution contract."
});
var LauncherResponse = Type.Object({
  request: LauncherRequestEcho,
  plan: LauncherPlanCore,
  execution: LauncherExecution
}, {
  $id: "LauncherResponse",
  description: "Shared launcher response contract. Surface-local fields such as greeting and launcher-specific UX labels are intentionally excluded."
});
var OodaRuntimeContext = Type.Object({
  graph_summary: Type.String({
    minLength: 1,
    description: "Folded or direct graph summary supplied to the OODA runtime."
  }),
  source_surface: Type.String({
    minLength: 1,
    description: "Surface invoking the OODA runtime."
  }),
  grounding_directive: Type.String({
    minLength: 1,
    description: "Grounding constraints applied to the runtime call."
  }),
  evidence_domain: Type.String({
    minLength: 1
  }),
  reason_domain: Type.String({
    minLength: 1
  }),
  report_layout_contract: Type.Optional(Type.String()),
  evidence_context: Type.Optional(Type.String())
}, {
  $id: "OodaRuntimeContext",
  description: "Context object supplied to the OODA runtime from launcher-like surfaces."
});
var OodaRuntimeRequest = Type.Object({
  task: Type.String({
    minLength: 1,
    description: "Task passed to the OODA runtime."
  }),
  task_id: Type.String({
    minLength: 1,
    description: "Stable task id for runtime tracking."
  }),
  instruction: Type.String({
    minLength: 1,
    description: "Canonical instruction field for OODA runtime requests."
  }),
  instructions: Type.String({
    minLength: 1,
    description: "Compatibility alias retained until all consumers converge on instruction."
  }),
  context: OodaRuntimeContext
}, {
  $id: "OodaRuntimeRequest",
  description: "Shared OODA runtime request contract used by launcher-style orchestration surfaces."
});
var ReasonRuntimeResponseContract = Type.Object({
  jobStatement: Type.String(),
  successShape: Type.String(),
  requiredSections: Type.Array(Type.String()),
  boundaryRules: Type.Array(Type.String()),
  fallbackPolicy: Type.String()
}, {
  $id: "ReasonRuntimeResponseContract",
  description: "Structured response contract guidance passed into the runtime request context."
});
var ReasonRuntimeContext = Type.Object({
  response_contract: ReasonRuntimeResponseContract,
  evidence_domain: Type.Optional(Type.String()),
  reason_domain: Type.Optional(Type.String()),
  enriched_prompt: Type.Optional(Type.String()),
  _quality_task: Type.Optional(Type.String({
    description: "Compatibility field retained during migration from local launcher runtime behavior."
  })),
  _skip_knowledge_enrichment: Type.Optional(Type.Boolean({
    description: "Compatibility field retained during migration from local launcher runtime behavior."
  })),
  _output_mode: Type.Optional(Type.String({
    description: "Compatibility field retained during migration from local launcher runtime behavior."
  })),
  _expected_format: Type.Optional(Type.String({
    description: "Compatibility field retained during migration from local launcher runtime behavior."
  })),
  require_swarm: Type.Optional(Type.Boolean())
}, {
  $id: "ReasonRuntimeContext",
  description: "Context passed to the /reason runtime. Compatibility fields are temporary until callers converge on typed fields.",
  additionalProperties: true
});
var ReasonRuntimeRequest = Type.Object({
  task: Type.String({
    minLength: 1,
    description: "Task passed to the /reason runtime."
  }),
  domain: Type.String({
    minLength: 1,
    description: "Resolved domain passed to the /reason runtime."
  }),
  context: ReasonRuntimeContext
}, {
  $id: "ReasonRuntimeRequest",
  description: "Shared /reason runtime request contract used by launcher-like surfaces."
});
var ReasonRuntimeRouting = Type.Object({
  provider: Type.String({
    minLength: 1
  }),
  model: Type.String({
    minLength: 1
  }),
  latency_ms: Type.Optional(Type.Number({
    minimum: 0
  }))
}, {
  $id: "ReasonRuntimeRouting",
  description: "Routing metadata returned by the /reason runtime."
});
var ReasonRuntimeTelemetry = Type.Object({
  used_swarm: Type.Boolean(),
  used_rag: Type.Boolean()
}, {
  $id: "ReasonRuntimeTelemetry",
  description: "Minimal runtime telemetry returned by the /reason runtime."
});
var ReasonRuntimeResponse = Type.Object({
  recommendation: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  reasoning: Type.Optional(Type.String()),
  confidence: Type.Optional(Type.Number({
    minimum: 0,
    maximum: 1
  })),
  routing: Type.Optional(ReasonRuntimeRouting),
  telemetry: Type.Optional(ReasonRuntimeTelemetry),
  reasoning_chain: Type.Optional(Type.Array(Type.String()))
}, {
  $id: "ReasonRuntimeResponse",
  description: "Shared /reason runtime response contract used by launcher-like surfaces."
});

// ../widgetdc-contracts/dist/orchestrator/artifact-contracts.js
var BackendGovernanceEvidenceItemResponseV1 = Type.Object({
  id: Type.String({
    minLength: 1,
    description: "Stable evidence item id."
  }),
  summary: Type.String({
    minLength: 1,
    description: "Short evidence summary consumed by launcher-like surfaces."
  }),
  score: Type.Optional(Type.Number({
    minimum: 0,
    description: "Relative evidence relevance score when available."
  })),
  title: Type.Optional(Type.String()),
  source_type: Type.Optional(Type.String())
}, {
  $id: "BackendGovernanceEvidenceItemResponseV1",
  description: "Minimal evidence item shape returned inside backend governance evidence packet responses."
});
var BackendGovernanceEvidenceFamilyResponseV1 = Type.Object({
  family: LauncherEvidenceFamily,
  status: Type.Optional(LauncherEvidenceStatus),
  summary: Type.String({
    minLength: 1,
    description: "Family summary consumed by launcher-like surfaces."
  }),
  evidence_items: Type.Array(BackendGovernanceEvidenceItemResponseV1)
}, {
  $id: "BackendGovernanceEvidenceFamilyResponseV1",
  description: "Minimal family packet returned inside backend governance evidence packet responses."
});
var BackendGovernanceEvidencePacketGovernanceV1 = Type.Object({
  blocking_reasons: Type.Array(Type.String(), {
    description: "Coverage or governance blockers detected while composing the packet."
  }),
  promotion_status: Type.Optional(Type.Union([
    Type.Literal("not_promoted"),
    Type.Literal("blocked")
  ])),
  can_promote: Type.Optional(Type.Boolean())
}, {
  $id: "BackendGovernanceEvidencePacketGovernanceV1",
  description: "Governance subsection of backend evidence packet responses."
});
var BackendGovernanceEvidencePacketResponseV1 = Type.Object({
  packet_id: Type.String({
    minLength: 1,
    description: "Stable packet id for routing and read-back."
  }),
  tri_source_ready: Type.Boolean({
    description: "True when enough evidence exists for multi-signal launcher use."
  }),
  governance: BackendGovernanceEvidencePacketGovernanceV1,
  families: Type.Array(BackendGovernanceEvidenceFamilyResponseV1, {
    minItems: 1,
    description: "Family evidence summaries returned by backend governance surfaces."
  }),
  question: Type.Optional(Type.String()),
  domain: Type.Optional(Type.String()),
  created_at: Type.Optional(Type.String({ format: "date-time" })),
  evidence_refs: Type.Optional(Type.Array(Type.String()))
}, {
  $id: "backend.governance.evidence_packet.response.v1",
  description: "Shared backend governance evidence packet response contract for launcher-like consumers."
});
var ArtifactChallengeOutcomeV1 = Type.Object({
  trace_id: Type.String({
    minLength: 1,
    description: "Trace id or outcome id emitted for the challenge action."
  }),
  status: Type.Literal("CHALLENGED"),
  reason: Type.String({
    minLength: 1,
    description: "Challenge reason supplied by the surface or operator."
  }),
  evidence_uri: Type.Optional(Type.Union([Type.String({ format: "uri" }), Type.Null()]))
}, {
  $id: "ArtifactChallengeOutcomeV1",
  description: "Outcome payload generated by artifact challenge requests."
});
var ArtifactChallengeGraphWriteV1 = Type.Object({
  outcome_label: Type.Literal("Outcome"),
  relation_type: Type.Literal("CHALLENGES"),
  target_identity: Type.String({
    minLength: 1,
    description: "Target artifact identity for the challenge relation."
  })
}, {
  $id: "ArtifactChallengeGraphWriteV1",
  description: "Graph write instruction for artifact challenge envelopes."
});
var ArtifactChallengeEnvelopeV1 = Type.Object({
  tool: Type.Literal("artifacts.challenge"),
  artifact_id: Type.String({
    minLength: 1
  }),
  artifact_slug: Type.Optional(Type.String({
    minLength: 1,
    description: "Compatibility metadata field retained during migration."
  })),
  outcome: ArtifactChallengeOutcomeV1,
  graph_write: ArtifactChallengeGraphWriteV1
}, {
  $id: "artifact.challenge.envelope.v1",
  description: "Shared artifact challenge envelope emitted by surfaces before canonical backend persistence."
});
var ArtifactRequestReviewGraphWriteV1 = Type.Object({
  type: Type.Literal("ConstructionRequest"),
  request_kind: Type.Literal("REVIEW"),
  requested_by: Type.String({
    minLength: 1,
    description: "Actor requesting review."
  }),
  artifact_id: Type.String({
    minLength: 1
  })
}, {
  $id: "ArtifactRequestReviewGraphWriteV1",
  description: "Graph write instruction for artifact request-review envelopes."
});
var ArtifactRequestReviewEnvelopeV1 = Type.Object({
  tool: Type.Literal("artifacts.action"),
  action: Type.Literal("request-review"),
  artifact_id: Type.String({
    minLength: 1
  }),
  graph_write: ArtifactRequestReviewGraphWriteV1
}, {
  $id: "artifact.request_review.envelope.v1",
  description: "Shared artifact request-review envelope emitted by surfaces before canonical backend persistence."
});

// src/validation.ts
if (!format_exports.Has("date-time")) {
  format_exports.Set("date-time", (v) => !isNaN(Date.parse(v)));
}
if (!format_exports.Has("uuid")) {
  format_exports.Set("uuid", (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v));
}
var validateHandshake = TypeCompiler.Compile(AgentHandshake);
var validateMessage = TypeCompiler.Compile(AgentMessage);
var validateToolCall = TypeCompiler.Compile(OrchestratorToolCall);
function validate(checker, data) {
  if (checker.Check(data)) {
    return { ok: true, data };
  }
  const errors = [];
  for (const err of checker.Errors(data)) {
    errors.push(`${err.path}: ${err.message}`);
    if (errors.length >= 5) break;
  }
  return { ok: false, errors };
}
function cleanToSchema(schema, data) {
  return value_exports2.Clean(schema, structuredClone(data));
}

// src/routes/agents.ts
var agentsRouter = Router();
agentsRouter.post("/register", (req, res) => {
  const result = validate(validateHandshake, req.body);
  if (!result.ok) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid AgentHandshake payload",
        details: result.errors,
        status_code: 400
      }
    });
    return;
  }
  const handshake = cleanToSchema(AgentHandshake, result.data);
  AgentRegistry.register(handshake);
  notifyAgentRegistered(
    handshake.agent_id,
    handshake.display_name,
    handshake.allowed_tool_namespaces
  );
  res.json({
    success: true,
    data: { agent_id: handshake.agent_id, registered_at: (/* @__PURE__ */ new Date()).toISOString() }
  });
});
agentsRouter.get("/", (_req, res) => {
  const agents = AgentRegistry.all().map((e) => ({
    agent_id: e.handshake.agent_id,
    display_name: e.handshake.display_name,
    version: e.handshake.version ?? null,
    status: e.handshake.status,
    capabilities: e.handshake.capabilities,
    allowed_tool_namespaces: e.handshake.allowed_tool_namespaces,
    active_calls: e.activeCalls,
    registered_at: e.registeredAt.toISOString(),
    last_seen_at: e.lastSeenAt.toISOString()
  }));
  res.json({ success: true, data: { agents, total: agents.length } });
});
agentsRouter.patch("/:id", (req, res) => {
  const { id } = req.params;
  const updated = AgentRegistry.update(id, req.body);
  if (!updated) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Agent '${id}' not registered`, status_code: 404 } });
    return;
  }
  res.json({ success: true, data: { agent_id: id, updated: true } });
});
agentsRouter.delete("/:id", (req, res) => {
  const { id } = req.params;
  const removed = AgentRegistry.remove(id);
  if (!removed) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Agent '${id}' not registered`, status_code: 404 } });
    return;
  }
  res.json({ success: true, data: { agent_id: id, removed: true } });
});
agentsRouter.delete("/", async (_req, res) => {
  const count = await AgentRegistry.purgeAll();
  res.json({ success: true, data: { purged: count } });
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
init_agent_registry();
init_mcp_caller();
init_chat_broadcaster();
init_config();
init_logger();
init_slack();
import { Router as Router2 } from "express";
init_redis();

// src/tool-executor.ts
init_dual_rag();
init_cognitive_proxy();
init_mcp_caller();
init_chain_engine();

// src/verification-gate.ts
init_logger();
init_mcp_caller();
import { v4 as uuid6 } from "uuid";
async function verifyChainOutput(chainOutput, config2) {
  const maxRetries = config2.max_retries ?? 3;
  const start = Date.now();
  let retries = 0;
  let lastResult = null;
  while (retries <= maxRetries) {
    const checkResults = await runChecksParallel(config2.checks, chainOutput);
    const tripwireTripped = config2.tripwire_check ? checkResults.some((c) => c.name === config2.tripwire_check && c.status !== "pass") : false;
    const allPassed = checkResults.every((c) => c.status === "pass");
    lastResult = {
      passed: allPassed && !tripwireTripped,
      checks: checkResults,
      retries_attempted: retries,
      total_duration_ms: Date.now() - start,
      aborted_by_tripwire: tripwireTripped
    };
    if (allPassed) {
      logger.info({ retries, checks: checkResults.length }, "Verification gate: PASSED");
      return lastResult;
    }
    if (tripwireTripped) {
      logger.warn({ tripwire: config2.tripwire_check }, "Verification gate: TRIPWIRE ABORT");
      return lastResult;
    }
    retries++;
    if (retries <= maxRetries) {
      logger.info({ retry: retries, maxRetries, failed: checkResults.filter((c) => c.status !== "pass").map((c) => c.name) }, "Verification gate: retrying");
      await new Promise((r) => setTimeout(r, 1e3 * retries));
    }
  }
  logger.warn({ retries: maxRetries }, "Verification gate: FAILED after max retries");
  return lastResult;
}
async function runChecksParallel(checks, chainOutput) {
  const results = await Promise.allSettled(
    checks.map(async (check) => {
      const start = Date.now();
      try {
        const args = { ...check.arguments };
        for (const [k, v] of Object.entries(args)) {
          if (v === "{{output}}") args[k] = chainOutput;
        }
        const result = await callMcpTool({
          toolName: check.tool_name,
          args,
          callId: `verify-${uuid6().substring(0, 8)}`,
          timeoutMs: 15e3
        });
        let passed = true;
        if (check.validate) {
          passed = check.validate(result);
        } else if (check.expected_key) {
          const actual = result?.[check.expected_key];
          passed = actual === check.expected_value;
        }
        return {
          name: check.name,
          status: passed ? "pass" : "fail",
          output: result,
          duration_ms: Date.now() - start
        };
      } catch (err) {
        return {
          name: check.name,
          status: "error",
          output: String(err),
          duration_ms: Date.now() - start
        };
      }
    })
  );
  return results.map(
    (r, i) => r.status === "fulfilled" ? r.value : {
      name: checks[i].name,
      status: "error",
      output: String(r.reason),
      duration_ms: 0
    }
  );
}

// src/investigate-chain.ts
init_chain_engine();
init_config();
init_logger();
function buildInvestigateChain(topic) {
  return {
    chain_id: `investigate-${Date.now().toString(36)}`,
    name: `Investigate: ${topic}`,
    description: `Multi-agent deep investigation of "${topic}"`,
    mode: "sequential",
    steps: [
      // Step 1: Graph exploration
      {
        id: "graph-explore",
        agent_id: "graph-steward",
        tool_name: "graph.read_cypher",
        arguments: {
          query: `MATCH (n) WHERE toLower(n.title) CONTAINS toLower($topic) OR toLower(coalesce(n.name,'')) CONTAINS toLower($topic) OR toLower(coalesce(n.description,'')) CONTAINS toLower($topic) WITH n LIMIT 20 OPTIONAL MATCH (n)-[r]-(m) RETURN labels(n)[0] AS type, coalesce(n.title, n.name, n.id) AS name, collect(DISTINCT {rel: type(r), target: coalesce(m.title, m.name, labels(m)[0])}) AS connections LIMIT 20`,
          params: { topic }
        },
        timeout_ms: 2e4
      },
      // Step 2: Compliance analysis
      {
        id: "compliance-analysis",
        agent_id: "regulatory-navigator",
        tool_name: "srag.query",
        arguments: {
          query: `Compliance and regulatory framework analysis for: ${topic}. Include relevant Danish/EU regulations, governance requirements, and risk considerations. Previous graph findings: {{prev}}`
        },
        timeout_ms: 3e4
      },
      // Step 3: Strategic recommendations
      {
        id: "strategic-recommendations",
        agent_id: "consulting-partner",
        tool_name: "kg_rag.query",
        arguments: {
          question: `Strategic consulting analysis for: ${topic}. Provide actionable recommendations, patterns, and best practices. Previous compliance findings: {{prev}}`,
          max_evidence: 15
        },
        timeout_ms: 3e4
      },
      // Step 4: Deep reasoning synthesis
      {
        id: "deep-reasoning",
        agent_id: "orchestrator",
        cognitive_action: "reason",
        prompt: `Synthesize a comprehensive deep analysis of "${topic}" based on all previous findings:

{{prev}}

Provide:
1. Key findings from graph exploration
2. Compliance implications
3. Strategic recommendations
4. Risk assessment
5. Suggested next actions`,
        timeout_ms: 45e3
      },
      // Step 5: Artifact assembly — handled post-chain
      // We use a lightweight step that signals assembly
      {
        id: "signal-assembly",
        agent_id: "orchestrator",
        tool_name: "graph.health",
        arguments: {},
        timeout_ms: 1e4
      }
    ]
  };
}
function assembleArtifactBlocks(topic, execution) {
  const blocks = [];
  const results = execution.results;
  const graphResult = results.find((r) => r.step_id === "graph-explore");
  if (graphResult && graphResult.status === "success") {
    blocks.push({
      type: "cypher",
      label: "Graph Exploration",
      content: {
        query: `MATCH (n) WHERE toLower(n.title) CONTAINS toLower("${topic}") ... (see full chain)`
      }
    });
    blocks.push({
      type: "text",
      label: "Graph Results",
      content: {
        body: typeof graphResult.output === "string" ? graphResult.output : JSON.stringify(graphResult.output, null, 2)
      }
    });
  }
  const complianceResult = results.find((r) => r.step_id === "compliance-analysis");
  if (complianceResult && complianceResult.status === "success") {
    blocks.push({
      type: "text",
      label: "Compliance & Regulatory Analysis",
      content: {
        body: typeof complianceResult.output === "string" ? complianceResult.output : JSON.stringify(complianceResult.output, null, 2)
      }
    });
  }
  const strategyResult = results.find((r) => r.step_id === "strategic-recommendations");
  if (strategyResult && strategyResult.status === "success") {
    blocks.push({
      type: "text",
      label: "Strategic Recommendations",
      content: {
        body: typeof strategyResult.output === "string" ? strategyResult.output : JSON.stringify(strategyResult.output, null, 2)
      }
    });
  }
  const reasoningResult = results.find((r) => r.step_id === "deep-reasoning");
  if (reasoningResult && reasoningResult.status === "success") {
    blocks.push({
      type: "text",
      label: "Deep Reasoning Synthesis",
      content: {
        body: typeof reasoningResult.output === "string" ? reasoningResult.output : JSON.stringify(reasoningResult.output, null, 2)
      }
    });
  }
  blocks.push({
    type: "kpi_card",
    label: "Investigation Metrics",
    content: {
      label: "Steps Completed",
      value: `${execution.steps_completed}/${execution.steps_total}`,
      trend: execution.status === "completed" ? "up" : "down"
    }
  });
  if (execution.duration_ms) {
    blocks.push({
      type: "kpi_card",
      content: {
        label: "Duration",
        value: `${(execution.duration_ms / 1e3).toFixed(1)}s`
      }
    });
  }
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${config.port}`;
  blocks.push({
    type: "deep_link",
    label: "Access Links",
    content: {
      label: "View in Command Center",
      uri: `${baseUrl}/#chains`
    }
  });
  blocks.push({
    type: "deep_link",
    content: {
      label: "Open in Obsidian",
      uri: `obsidian://widgetdc?action=investigate&topic=${encodeURIComponent(topic)}`
    }
  });
  return blocks;
}
async function createArtifact(topic, blocks, execution) {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${config.port}`;
  const apiKey = process.env.ORCHESTRATOR_API_KEY ?? "";
  try {
    const resp = await fetch(`${baseUrl}/api/artifacts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        title: `Investigation: ${topic}`,
        source: "investigate-chain",
        blocks,
        tags: ["investigation", "multi-agent", topic.toLowerCase().replace(/\s+/g, "-")],
        graph_refs: execution.results.filter((r) => r.step_id === "graph-explore" && r.status === "success").map((r) => `neo4j:investigate:${topic}`),
        created_by: "investigate-chain"
      })
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Failed to create investigation artifact");
      return null;
    }
    const data = await resp.json();
    if (data.success && data.artifact) {
      const id = data.artifact.$id;
      return {
        artifactId: id,
        artifactUrl: `${baseUrl}/api/artifacts/${encodeURIComponent(id)}`
      };
    }
    return null;
  } catch (err) {
    logger.warn({ err: String(err) }, "Artifact creation failed for investigation");
    return null;
  }
}
async function runInvestigation(topic) {
  const chainDef = buildInvestigateChain(topic);
  logger.info({ topic, chain_id: chainDef.chain_id }, "Starting investigation chain");
  const execution = await executeChain(chainDef);
  const blocks = assembleArtifactBlocks(topic, execution);
  const artifact = await createArtifact(topic, blocks, execution);
  const result = { execution };
  if (artifact) {
    result.artifact_id = artifact.artifactId;
    result.artifact_url = artifact.artifactUrl;
    result.artifact_markdown_url = `${artifact.artifactUrl}.md`;
    logger.info({ artifact_id: artifact.artifactId, topic }, "Investigation artifact created");
  }
  return result;
}

// src/tool-executor.ts
init_logger();
init_tool_registry();
import { v4 as uuid13 } from "uuid";
var ORCHESTRATOR_TOOLS = toOpenAITools();
var totalTokensSaved = 0;
var totalFoldingCalls = 0;
function getTokenSavings() {
  return { totalTokensSaved, totalFoldingCalls, avgSavingsPerFold: totalFoldingCalls > 0 ? Math.round(totalTokensSaved / totalFoldingCalls) : 0 };
}
function foldToolResult(content, toolName) {
  const MAX_CHARS = 800;
  const TARGET_CHARS = 500;
  if (content.length <= MAX_CHARS) return content;
  const originalTokens = Math.ceil(content.length / 4);
  totalFoldingCalls++;
  let folded;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      const truncated = parsed.slice(0, 5);
      folded = JSON.stringify(truncated, null, 1).slice(0, TARGET_CHARS);
      folded += `
... (${parsed.length} total items, showing first 5)`;
    } else if (typeof parsed === "object") {
      const slim = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.length > 200) {
          slim[k] = v.slice(0, 200) + "...";
        } else if (Array.isArray(v) && v.length > 3) {
          slim[k] = [...v.slice(0, 3), `... +${v.length - 3} more`];
        } else {
          slim[k] = v;
        }
      }
      folded = JSON.stringify(slim, null, 1).slice(0, TARGET_CHARS);
    } else {
      folded = content.slice(0, TARGET_CHARS) + "...";
    }
  } catch {
    const lines = content.split("\n");
    folded = lines.slice(0, 15).join("\n").slice(0, TARGET_CHARS);
    if (lines.length > 15) folded += `
... (${lines.length} total lines)`;
  }
  const foldedTokens = Math.ceil(folded.length / 4);
  const saved = originalTokens - foldedTokens;
  totalTokensSaved += saved;
  logger.debug({ tool: toolName, originalTokens, foldedTokens, saved }, "Tool result folded");
  return folded;
}
async function executeToolCalls(toolCalls) {
  const results = await Promise.allSettled(
    toolCalls.map((tc) => executeOne(tc))
  );
  return results.map((r, i) => {
    const raw = r.status === "fulfilled" ? r.value : `Error: ${r.reason}`;
    return {
      tool_call_id: toolCalls[i].id,
      role: "tool",
      content: foldToolResult(raw, toolCalls[i].function.name)
    };
  });
}
async function executeOne(tc) {
  let args;
  try {
    args = JSON.parse(tc.function.arguments);
  } catch {
    return `Error: Invalid JSON arguments`;
  }
  const name = tc.function.name;
  logger.info({ tool: name, args_keys: Object.keys(args) }, "Executing tool call");
  try {
    return await executeToolByName(name, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ tool: name, error: msg }, "Tool execution failed \u2014 returning graceful fallback");
    return buildToolFallback(name, msg);
  }
}
function buildToolFallback(toolName, error) {
  const short = error.length > 200 ? error.slice(0, 200) + "..." : error;
  switch (toolName) {
    case "search_knowledge":
      return `Knowledge search unavailable (${short}). Try query_graph with a direct Cypher query, or call_mcp_tool with srag.query as a fallback.`;
    case "reason_deeply":
      return `RLM reasoning unavailable (${short}). Try breaking the question into simpler parts using search_knowledge or query_graph.`;
    case "query_graph":
      return `Neo4j graph query failed (${short}). The graph may be temporarily slow \u2014 try a simpler query or use search_knowledge instead.`;
    case "linear_issues":
    case "linear_issue_detail":
      return `Linear query failed (${short}). Linear data may be temporarily unavailable.`;
    default:
      return `Tool "${toolName}" failed: ${short}`;
  }
}
async function executeToolUnified(toolName, args, opts) {
  const callId = opts?.call_id ?? uuid13();
  const t0 = Date.now();
  let deprecation_notice;
  const toolDef = getTool(toolName);
  if (toolDef?.deprecated) {
    logger.warn({ tool: toolName }, `Deprecated tool called: ${toolName}. ${toolDef.deprecatedMessage ?? ""}`);
    deprecation_notice = {
      deprecated: true,
      since: toolDef.deprecatedSince,
      message: toolDef.deprecatedMessage,
      sunset_date: toolDef.sunsetDate,
      replaced_by: toolDef.replacedBy
    };
  }
  try {
    const rawResult = await executeToolByName(toolName, args);
    const duration = Date.now() - t0;
    const shouldFold = opts?.fold !== false;
    const folded = shouldFold ? foldToolResult(rawResult, toolName) : rawResult;
    const resultWithWarning = deprecation_notice ? `[DEPRECATED] ${toolDef?.deprecatedMessage ?? `Tool "${toolName}" is deprecated.`}${toolDef?.replacedBy ? ` Use "${toolDef.replacedBy}" instead.` : ""}

${folded}` : folded;
    return {
      call_id: callId,
      tool_name: toolName,
      status: "success",
      result: resultWithWarning,
      duration_ms: duration,
      completed_at: (/* @__PURE__ */ new Date()).toISOString(),
      was_folded: shouldFold && folded !== rawResult,
      source_protocol: opts?.source_protocol ?? "unknown",
      ...deprecation_notice ? { deprecation_notice } : {}
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      call_id: callId,
      tool_name: toolName,
      status: "error",
      result: null,
      error_message: msg,
      duration_ms: Date.now() - t0,
      completed_at: (/* @__PURE__ */ new Date()).toISOString(),
      was_folded: false,
      source_protocol: opts?.source_protocol ?? "unknown",
      ...deprecation_notice ? { deprecation_notice } : {}
    };
  }
}
async function executeToolByName(name, args) {
  switch (name) {
    case "search_knowledge": {
      if (!args.query || typeof args.query !== "string") return "Error: query is required and must be a string";
      const result = await dualChannelRAG(args.query, {
        maxResults: args.max_results ?? 10
      });
      if (result.merged_context.length === 0) return "No results found for this query.";
      try {
        const { hookAutoEnrichment: hookAutoEnrichment3 } = await Promise.resolve().then(() => (init_compound_hooks(), compound_hooks_exports));
        hookAutoEnrichment3(result.merged_context, args.query);
      } catch {
      }
      const header = `[${result.route_strategy}] ${result.graphrag_count} graphrag + ${result.srag_count} semantic + ${result.cypher_count} graph (${result.duration_ms}ms, channels: ${result.channels_used.join(",")}${result.pollution_filtered > 0 ? `, ${result.pollution_filtered} polluted filtered` : ""}):`;
      return `${header}

${result.merged_context}`;
    }
    case "reason_deeply": {
      if (!isRlmAvailable()) return "RLM Engine is not available.";
      const mode = args.mode ?? "reason";
      const result = await callCognitive(mode, {
        prompt: args.question,
        context: { source: "chat-tool-call" },
        agent_id: "chat-orchestrator",
        depth: 1
      }, 45e3);
      return typeof result === "string" ? result : JSON.stringify(result, null, 2);
    }
    case "query_graph": {
      const cypher = args.cypher;
      if (!cypher || typeof cypher !== "string") return "Error: cypher query is required and must be a string";
      const WRITE_KEYWORDS = /\b(DELETE|DETACH|CREATE|MERGE|SET|REMOVE|DROP|CALL\s+dbms)\b/i;
      if (WRITE_KEYWORDS.test(cypher)) {
        return "Error: query_graph is read-only. Write operations (DELETE, CREATE, MERGE, SET, REMOVE, DROP) are not allowed.";
      }
      const result = await callMcpTool({
        toolName: "graph.read_cypher",
        args: { query: cypher, params: args.params ?? {} },
        callId: uuid13(),
        timeoutMs: 15e3
      });
      if (result.status !== "success") return `Graph query failed: ${result.error_message}`;
      const rows = Array.isArray(result.result) ? result.result : result.result?.results ?? result.result;
      return JSON.stringify(rows, null, 2).slice(0, 800);
    }
    case "check_tasks": {
      const filter = args.filter ?? "active";
      const keyword = args.keyword ?? "";
      let cypher;
      if (filter === "blocked") {
        cypher = `MATCH (n) WHERE (n:Task OR n:L3Task) AND toLower(coalesce(n.status,'')) CONTAINS 'block' RETURN coalesce(n.identifier,n.id) AS id, n.title AS title, n.status AS status ORDER BY n.updatedAt DESC LIMIT 15`;
      } else if (filter === "recent") {
        cypher = `MATCH (n) WHERE (n:Task OR n:L3Task) RETURN coalesce(n.identifier,n.id) AS id, n.title AS title, n.status AS status ORDER BY n.updatedAt DESC LIMIT 15`;
      } else {
        cypher = `MATCH (n) WHERE (n:Task OR n:L3Task) AND n.status IN ['In Progress', 'Todo', 'Backlog'] RETURN coalesce(n.identifier,n.id) AS id, n.title AS title, n.status AS status ORDER BY n.updatedAt DESC LIMIT 15`;
      }
      const result = await callMcpTool({
        toolName: "graph.read_cypher",
        args: { query: cypher },
        callId: uuid13(),
        timeoutMs: 1e4
      });
      if (result.status !== "success") return `Task query failed: ${result.error_message}`;
      const rows = result.result?.results ?? result.result ?? [];
      if (!Array.isArray(rows) || rows.length === 0) return "No tasks found.";
      return rows.map((r) => `- [${r.id ?? "?"}] ${r.title ?? "Untitled"} (${r.status ?? "?"})`).join("\n");
    }
    case "call_mcp_tool": {
      const result = await callMcpTool({
        toolName: args.tool_name,
        args: args.payload ?? {},
        callId: uuid13(),
        timeoutMs: 3e4
      });
      if (result.status !== "success") return `MCP tool failed: ${result.error_message}`;
      return JSON.stringify(result.result, null, 2).slice(0, 800);
    }
    case "get_platform_health": {
      const [backendHealth, graphHealth] = await Promise.allSettled([
        callMcpTool({ toolName: "graph.health", args: {}, callId: uuid13(), timeoutMs: 1e4 }),
        callMcpTool({ toolName: "graph.stats", args: {}, callId: uuid13(), timeoutMs: 1e4 })
      ]);
      const parts = [];
      if (backendHealth.status === "fulfilled" && backendHealth.value.status === "success") {
        parts.push(`Neo4j: ${JSON.stringify(backendHealth.value.result)}`);
      }
      if (graphHealth.status === "fulfilled" && graphHealth.value.status === "success") {
        const stats = graphHealth.value.result;
        parts.push(`Graph: ${stats?.nodes ?? "?"} nodes, ${stats?.relationships ?? "?"} rels`);
      }
      return parts.join("\n") || "Health check returned no data.";
    }
    case "search_documents": {
      const result = await callMcpTool({
        toolName: "srag.query",
        args: { query: args.query },
        callId: uuid13(),
        timeoutMs: 2e4
      });
      if (result.status !== "success") return `Document search failed: ${result.error_message}`;
      return JSON.stringify(result.result, null, 2).slice(0, 800);
    }
    case "linear_issues": {
      const status = args.status ?? "active";
      const limit = args.limit ?? 10;
      const query = args.query ?? "";
      const payload = { limit };
      if (query) payload.query = query;
      if (status === "active") payload.status = "started";
      else if (status === "done") payload.status = "completed";
      else if (status === "backlog") payload.status = "backlog";
      const result = await callMcpTool({
        toolName: "linear.issues",
        args: payload,
        callId: uuid13(),
        timeoutMs: 15e3
      });
      if (result.status !== "success") return `Linear query failed: ${result.error_message}`;
      const data = result.result;
      const issues = data?.issues ?? data ?? [];
      if (!Array.isArray(issues) || issues.length === 0) return "No Linear issues found.";
      return issues.map(
        (i) => `- [${i.identifier}] ${i.title} (${i.status}) ${i.assignee ? `\u2192 ${i.assignee}` : ""} ${i.url ?? ""}`
      ).join("\n");
    }
    case "linear_issue_detail": {
      const identifier = args.identifier;
      const result = await callMcpTool({
        toolName: "linear.issue_get",
        args: { identifier },
        callId: uuid13(),
        timeoutMs: 15e3
      });
      if (result.status !== "success") return `Linear issue lookup failed: ${result.error_message}`;
      return JSON.stringify(result.result, null, 2).slice(0, 800);
    }
    case "investigate": {
      const topic = args.topic;
      if (!topic) return "Error: topic is required";
      try {
        const result = await runInvestigation(topic);
        const summary = `Investigation "${topic}" ${result.execution.status} \u2014 ${result.execution.steps_completed}/${result.execution.steps_total} steps, ${result.execution.duration_ms}ms`;
        const artifactInfo = result.artifact_url ? `
Artifact: ${result.artifact_url}
Markdown: ${result.artifact_markdown_url}` : "\nArtifact: creation skipped (Redis unavailable or error)";
        const output = result.execution.final_output ? `

Synthesis:
${typeof result.execution.final_output === "string" ? result.execution.final_output : JSON.stringify(result.execution.final_output, null, 2).slice(0, 600)}` : "";
        return summary + artifactInfo + output;
      } catch (err) {
        return `Investigation failed: ${err}`;
      }
    }
    case "run_chain": {
      const steps = args.steps ?? [];
      const chainDef = {
        name: args.name,
        mode: args.mode ?? "sequential",
        steps: steps.map((s, i) => ({
          id: `step-${i}`,
          agent_id: s.agent_id ?? "chat-orchestrator",
          tool_name: s.tool_name,
          cognitive_action: s.cognitive_action,
          prompt: s.prompt,
          arguments: s.arguments ?? (s.prompt ? { query: s.prompt } : {})
        }))
      };
      try {
        const execution = await executeChain(chainDef);
        const summary = `Chain "${execution.name}" (${execution.mode}): ${execution.status} \u2014 ${execution.steps_completed}/${execution.steps_total} steps, ${execution.duration_ms}ms`;
        const output = execution.final_output ? `

Result: ${typeof execution.final_output === "string" ? execution.final_output : JSON.stringify(execution.final_output, null, 2).slice(0, 800)}` : "";
        return summary + output + (execution.error ? `
Error: ${execution.error}` : "");
      } catch (err) {
        return `Chain execution failed: ${err}`;
      }
    }
    case "create_notebook": {
      const topic = args.topic;
      if (!topic) return "Error: topic is required";
      const customCells = args.cells;
      const cells = customCells && customCells.length > 0 ? customCells : [
        { type: "query", id: "q1", query: `MATCH (n) WHERE toLower(coalesce(n.title,'')) CONTAINS toLower($topic) OR toLower(coalesce(n.name,'')) CONTAINS toLower($topic) RETURN labels(n)[0] AS type, coalesce(n.title, n.name) AS name, n.status AS status LIMIT 20`, params: { topic } },
        { type: "query", id: "q2", query: `What are the key insights and patterns related to this topic?`, params: { topic } },
        { type: "insight", id: "i1", prompt: `Analyze the findings about "${topic}" and provide strategic consulting insights, key patterns, and recommendations.` },
        { type: "data", id: "d1", source_cell_id: "q1", visualization: "table" },
        { type: "action", id: "a1", recommendation: `Review the analysis of "${topic}" and determine next steps for the consulting engagement.` }
      ];
      try {
        const { config: appConfig } = await Promise.resolve().then(() => (init_config(), config_exports));
        const baseUrl = appConfig.nodeEnv === "production" ? "https://orchestrator-production-c27e.up.railway.app" : `http://localhost:${appConfig.port}`;
        const resp = await fetch(`${baseUrl}/api/notebooks/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${appConfig.orchestratorApiKey}`
          },
          body: JSON.stringify({ title: `Notebook: ${topic}`, cells, created_by: "chat-orchestrator" })
        });
        const data = await resp.json();
        if (!data.success) return `Notebook creation failed: ${data.error}`;
        const nb = data.notebook;
        const cellSummaries = nb.cells.map((c) => {
          if (c.type === "query") return `[Query] ${c.query.slice(0, 60)}... \u2192 ${c.result ? "OK" : "no result"}`;
          if (c.type === "insight") return `[Insight] ${(c.content ?? "").slice(0, 100)}...`;
          if (c.type === "data") return `[Data] from ${c.source_cell_id}: ${c.result ? "OK" : "no data"}`;
          if (c.type === "action") return `[Action] ${c.recommendation.slice(0, 80)}`;
          return `[${c.type}]`;
        }).join("\n");
        return `Notebook created: "${nb.title}"
ID: ${nb.$id}
Cells: ${nb.cells.length}

${cellSummaries}

View: /api/notebooks/${encodeURIComponent(nb.$id)}
Markdown: /api/notebooks/${encodeURIComponent(nb.$id)}.md`;
      } catch (err) {
        return `Notebook creation failed: ${err}`;
      }
    }
    case "verify_output": {
      const content = args.content;
      const checks = args.checks ?? [
        { name: "graph_health", tool_name: "graph.health", arguments: {} }
      ];
      try {
        const result = await verifyChainOutput(
          { content },
          {
            checks: checks.map((c) => ({
              name: c.name ?? "check",
              tool_name: c.tool_name ?? "graph.health",
              arguments: c.arguments ?? {}
            }))
          }
        );
        return JSON.stringify(result, null, 2).slice(0, 800);
      } catch (err) {
        return `Verification failed: ${err}`;
      }
    }
    case "ingest_document": {
      const content = args.content;
      const filename = args.filename;
      if (!content || content.length < 20) return "Error: content required (min 20 chars)";
      if (!filename) return "Error: filename required";
      try {
        const { ingestDocument: ingestDocument2 } = await Promise.resolve().then(() => (init_document_intelligence(), document_intelligence_exports));
        const result = await ingestDocument2({
          content,
          filename,
          domain: args.domain,
          extract_entities: args.extract_entities !== false
        });
        return `Ingested "${result.filename}": ${result.entities_extracted} entities, ${result.nodes_merged} nodes merged, ${result.tables_found} tables (${result.parsing_method}, ${result.duration_ms}ms)`;
      } catch (err) {
        return `Document ingestion failed: ${err}`;
      }
    }
    case "build_communities": {
      try {
        const { buildCommunitySummaries: buildCommunitySummaries2 } = await Promise.resolve().then(() => (init_hierarchical_intelligence(), hierarchical_intelligence_exports));
        const result = await buildCommunitySummaries2();
        return `Communities built: ${result.communities_created} communities, ${result.summaries_generated} summaries, ${result.relationships_created} rels (${result.method}, ${result.duration_ms}ms)`;
      } catch (err) {
        return `Community build failed: ${err}`;
      }
    }
    case "adaptive_rag_dashboard": {
      try {
        const { getAdaptiveRAGDashboard: getAdaptiveRAGDashboard2 } = await Promise.resolve().then(() => (init_adaptive_rag(), adaptive_rag_exports));
        const d = await getAdaptiveRAGDashboard2();
        const lines = [
          `Compound Metric: ${d.compound_metric.score} (accuracy=${d.compound_metric.accuracy}, quality=${d.compound_metric.quality}, coverage=${d.compound_metric.coverage})`,
          `Training samples: ${d.outcome_count}`,
          `Weights updated: ${d.weights.updated_at}`,
          ...d.stats.map((s) => `  ${s.strategy}: ${s.total_queries} queries, confidence=${s.avg_confidence.toFixed(2)}, zero-result=${(s.zero_result_rate * 100).toFixed(0)}%`)
        ];
        return lines.join("\n");
      } catch (err) {
        return `Adaptive RAG dashboard failed: ${err}`;
      }
    }
    case "graph_hygiene_run": {
      try {
        const { runGraphHygiene: runGraphHygiene3 } = await Promise.resolve().then(() => (init_graph_hygiene_cron(), graph_hygiene_cron_exports));
        const result = await runGraphHygiene3();
        const m = result.metrics;
        const alertStr = result.alerts.length > 0 ? `
ALERTS: ${result.alerts.map((a) => a.message).join("; ")}` : "\nNo alerts \u2014 all metrics within thresholds.";
        return `Graph Health (${result.duration_ms}ms):
  Orphan ratio: ${(m.orphan_ratio * 100).toFixed(1)}%
  Avg rels/node: ${m.avg_rels_per_node.toFixed(1)}
  Embedding coverage: ${(m.embedding_coverage * 100).toFixed(1)}%
  Domains: ${m.domain_count}
  Stale nodes: ${m.stale_node_count}
  Pollution: ${m.pollution_count}${alertStr}`;
      } catch (err) {
        return `Graph hygiene failed: ${err}`;
      }
    }
    case "precedent_search": {
      const query = args.query;
      if (!query || query.length < 3) return "Error: query is required (min 3 chars)";
      try {
        const { findSimilarClients: findSimilarClients2 } = await Promise.resolve().then(() => (init_similarity_engine(), similarity_engine_exports));
        const result = await findSimilarClients2({
          query,
          dimensions: args.dimensions,
          max_results: typeof args.max_results === "number" && Number.isInteger(args.max_results) ? args.max_results : void 0,
          structural_weight: typeof args.structural_weight === "number" ? args.structural_weight : void 0
        });
        if (result.matches.length === 0) return `No similar clients found for "${query}" (method: ${result.method}, ${result.duration_ms}ms)`;
        const lines = result.matches.map((m, i) => {
          const dims = m.shared_dimensions.map((d) => `${d.dimension}: ${d.shared_values.slice(0, 3).join(", ")}`).join(" | ");
          return `${i + 1}. ${m.client_name} (score: ${m.overall_score.toFixed(2)}, ${m.node_type})${dims ? ` \u2014 ${dims}` : ""}`;
        });
        return `Found ${result.matches.length} similar clients (method: ${result.method}, ${result.duration_ms}ms):

${lines.join("\n")}`;
      } catch (err) {
        return `Precedent search failed: ${err}`;
      }
    }
    case "generate_deliverable": {
      const prompt = args.prompt;
      if (!prompt || prompt.length < 10) return "Error: prompt is required (min 10 chars)";
      const type = args.type ?? "analysis";
      if (!["analysis", "roadmap", "assessment"].includes(type)) return "Error: type must be analysis, roadmap, or assessment";
      try {
        const { generateDeliverable: generateDeliverable2 } = await Promise.resolve().then(() => (init_deliverable_engine(), deliverable_engine_exports));
        const rawMax = args.max_sections;
        const maxSections = typeof rawMax === "number" && Number.isInteger(rawMax) ? rawMax : void 0;
        const result = await generateDeliverable2({
          prompt,
          type,
          format: args.format ?? "markdown",
          max_sections: maxSections
        });
        const summary = `Deliverable "${result.title}" \u2014 ${result.status} (${result.metadata.sections_count} sections, ${result.metadata.total_citations} citations, ${result.metadata.generation_ms}ms)`;
        const preview = result.markdown.slice(0, 600);
        return `${summary}

ID: ${result.$id}
URL: /api/deliverables/${encodeURIComponent(result.$id)}
Markdown: /api/deliverables/${encodeURIComponent(result.$id)}/markdown

${preview}...`;
      } catch (err) {
        return `Deliverable generation failed: ${err}`;
      }
    }
    case "governance_matrix": {
      const { getEnforcementMatrix: getEnforcementMatrix2, getEnforcementScore: getEnforcementScore2, getGaps: getGaps2 } = await Promise.resolve().then(() => (init_manifesto_governance(), manifesto_governance_exports));
      const filter = args.filter ?? "all";
      if (filter === "gaps") {
        const gaps = getGaps2();
        return gaps.length === 0 ? "All 10 manifesto principles are ENFORCED. No gaps." : `${gaps.length} principle(s) with gaps:
${gaps.map((g) => `P${g.number} ${g.name} \u2014 ${g.status}: ${g.gap_remediation ?? "No remediation specified"}`).join("\n")}`;
      }
      const principles = filter === "enforced" ? getEnforcementMatrix2().filter((p) => p.status === "ENFORCED") : getEnforcementMatrix2();
      const score = getEnforcementScore2();
      const lines = principles.map(
        (p) => `P${p.number} ${p.name} \u2014 ${p.status} [${p.enforcement_layer}] ${p.mechanism}`
      );
      return `Manifesto Enforcement Matrix (${score.score}):
${lines.join("\n")}`;
    }
    case "run_osint_scan": {
      try {
        const { runOsintScan: runOsintScan2 } = await Promise.resolve().then(() => (init_osint_scanner(), osint_scanner_exports));
        const result = await runOsintScan2({
          domains: args.domains,
          scan_type: args.scan_type
        });
        const summary = `OSINT scan ${result.scan_id} completed in ${result.duration_ms}ms \u2014 ${result.domains_scanned} domains, ${result.ct_entries} CT entries, ${result.dmarc_results} DMARC results, ${result.total_new_nodes} new nodes (tools: ${result.tools_available ? "live" : "fallback"})`;
        if (result.errors.length > 0) {
          return `${summary}

Errors (${result.errors.length}):
${result.errors.slice(0, 10).join("\n")}`;
        }
        return summary;
      } catch (err) {
        return `OSINT scan failed: ${err}`;
      }
    }
    case "list_tools": {
      const { TOOL_REGISTRY: TOOL_REGISTRY3 } = await Promise.resolve().then(() => (init_tool_registry(), tool_registry_exports));
      let tools = TOOL_REGISTRY3;
      if (args.namespace && typeof args.namespace === "string") {
        tools = tools.filter((t) => t.namespace === args.namespace);
      }
      if (args.category && typeof args.category === "string") {
        tools = tools.filter((t) => t.category === args.category);
      }
      const summary = tools.map(
        (t) => `- ${t.name} [${t.namespace}/${t.category}] \u2014 ${t.description.slice(0, 80)}${t.description.length > 80 ? "..." : ""} (${t.availableVia.join(",")})`
      );
      return `${tools.length} tools${args.namespace ? ` in namespace "${args.namespace}"` : ""}${args.category ? ` in category "${args.category}"` : ""}:

${summary.join("\n")}`;
    }
    case "run_evolution": {
      const { runEvolutionLoop: runEvolutionLoop2 } = await Promise.resolve().then(() => (init_evolution_loop(), evolution_loop_exports));
      const result = await runEvolutionLoop2({
        focus_area: args.focus_area,
        dry_run: args.dry_run ?? false
      });
      return `Evolution cycle ${result.status}: ${result.summary}`;
    }
    // ─── SNOUT Wave 2: Steal Smart ──────────────────────────────────────────
    case "critique_refine": {
      const query = args.query;
      if (!query || query.length < 5) return "Error: query is required (min 5 chars)";
      try {
        const { critiqueRefine: critiqueRefine2 } = await Promise.resolve().then(() => (init_critique_refine(), critique_refine_exports));
        const result = await critiqueRefine2(
          query,
          args.provider ?? "deepseek",
          args.principles,
          args.max_rounds ?? 1
        );
        return `Critique-Refine (${result.provider}, ${result.rounds} round, ${result.duration_ms}ms):

**Original:**
${result.original.slice(0, 400)}

**Critique:**
${result.critique.slice(0, 300)}

**Revised:**
${result.revised.slice(0, 500)}`;
      } catch (err) {
        return `Critique-refine failed: ${err}`;
      }
    }
    case "judge_response": {
      const query = args.query;
      const response = args.response;
      if (!query || !response) return "Error: query and response are required";
      try {
        const { judgeResponse: judgeResponse2 } = await Promise.resolve().then(() => (init_agent_judge(), agent_judge_exports));
        const result = await judgeResponse2(
          query,
          response,
          args.context,
          args.provider ?? "deepseek"
        );
        const s = result.score;
        return `PRISM Score: ${s.aggregate}/10 (${result.duration_ms}ms)
  P-Precision:   ${s.precision}/10
  R-Reasoning:   ${s.reasoning}/10
  I-Information:  ${s.information}/10
  S-Safety:      ${s.safety}/10
  M-Methodology: ${s.methodology}/10

${s.explanation}`;
      } catch (err) {
        return `Agent judge failed: ${err}`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// src/routes/tools.ts
var toolsRouter = Router2();
toolsRouter.post("/call", async (req, res) => {
  const result = validate(validateToolCall, req.body);
  if (!result.ok) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid OrchestratorToolCall payload",
        details: result.errors,
        status_code: 400
      }
    });
    return;
  }
  const call = result.data;
  const log = childLogger(call.trace_id ?? call.call_id);
  if (config.agentOpenAccess) {
    AgentRegistry.canCallTool(call.agent_id, call.tool_name);
  } else {
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
    const toolResult = await callMcpTool({
      toolName: call.tool_name,
      args: call.arguments,
      callId: call.call_id,
      traceId: call.trace_id,
      timeoutMs: call.timeout_ms
    });
    res.json(toolResult);
    if (toolResult.status === "success") {
      broadcastToolResult(call.call_id, toolResult.result, call.agent_id);
    }
    notifyToolCall(call.agent_id, call.tool_name, toolResult.status, toolResult.duration_ms ?? 0, toolResult.error_message);
    log.info({ tool: call.tool_name, status: toolResult.status, ms: toolResult.duration_ms }, "Tool call done");
  } finally {
    AgentRegistry.decrementActive(call.agent_id);
    AgentRegistry.heartbeat(call.agent_id);
  }
});
toolsRouter.get("/namespaces", async (_req, res) => {
  try {
    const r = await fetch(`${config.backendUrl}/api/mcp/tools`, {
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
var CATALOG_CACHE_KEY = "orchestrator:tool-catalog";
var CATALOG_TTL_SECONDS = 3600;
function deriveCategory(name) {
  if (name.includes("knowledge") || name.includes("search_doc")) return "knowledge";
  if (name.includes("graph") || name.includes("cypher")) return "graph";
  if (name.includes("linear") || name.includes("task")) return "linear";
  if (name.includes("health") || name.includes("platform")) return "health";
  if (name.includes("chain") || name.includes("run_chain")) return "chains";
  if (name.includes("reason") || name.includes("cognitive")) return "cognitive";
  if (name.includes("verify")) return "compliance";
  if (name.includes("mcp")) return "mcp";
  return "general";
}
function deriveBackendTool(name) {
  const mapping = {
    search_knowledge: "srag.query + graph.read_cypher",
    reason_deeply: "rlm.reason",
    query_graph: "graph.read_cypher",
    check_tasks: "graph.read_cypher",
    call_mcp_tool: "(dynamic)",
    get_platform_health: "graph.health + graph.stats",
    search_documents: "srag.query",
    linear_issues: "linear.issues",
    linear_issue_detail: "linear.issue_get",
    run_chain: "chain-engine",
    verify_output: "verification-gate"
  };
  return mapping[name] ?? null;
}
function deriveAvailableIn(name) {
  const base = ["command-center"];
  if (["search_knowledge", "search_documents", "reason_deeply"].includes(name)) {
    return ["open-webui", "obsidian", ...base];
  }
  if (["linear_issues", "linear_issue_detail", "check_tasks"].includes(name)) {
    return ["open-webui", ...base];
  }
  return base;
}
function buildCatalog() {
  const tools = ORCHESTRATOR_TOOLS.map((t) => ({
    name: t.function.name,
    category: deriveCategory(t.function.name),
    description: t.function.description,
    available_in: deriveAvailableIn(t.function.name),
    backend_tool: deriveBackendTool(t.function.name)
  }));
  const categories = [...new Set(tools.map((t) => t.category))].sort();
  return {
    tools,
    categories,
    total: tools.length,
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
toolsRouter.get("/catalog", async (_req, res) => {
  const redis2 = getRedis();
  if (redis2) {
    try {
      const cached = await redis2.get(CATALOG_CACHE_KEY);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Redis cache read failed for tool catalog");
    }
  }
  const catalog = buildCatalog();
  if (redis2) {
    try {
      await redis2.set(CATALOG_CACHE_KEY, JSON.stringify(catalog), "EX", CATALOG_TTL_SECONDS);
    } catch (err) {
      logger.warn({ err: String(err) }, "Redis cache write failed for tool catalog");
    }
  }
  res.json(catalog);
});

// src/routes/chat.ts
init_chat_broadcaster();
init_logger();
init_slack();
import { Router as Router3 } from "express";
init_chat_store();
init_config();
init_chain_engine();
init_chain_engine();
init_llm_proxy();
init_dual_rag();
init_agent_registry();
init_routing_engine();
async function mcpCall(tool, payload) {
  const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...config.backendApiKey ? { "Authorization": `Bearer ${config.backendApiKey}` } : {}
    },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(3e4)
  });
  const data = await res.json().catch(() => null);
  return data?.result ?? data;
}
async function storeEpisode(title, description, events, outcome, tags) {
  try {
    await mcpCall("memory_operation", {
      action: "RECORD_EPISODE",
      data: {
        title,
        description,
        events,
        outcome,
        lessons: [outcome],
        tags,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
    logger.info({ title, tags }, "Episode stored to episodic memory");
  } catch (err) {
    logger.warn({ err: String(err), title }, "Episodic memory store failed (non-fatal)");
  }
}
async function storeGraphMemory(agentId, type, content, tags) {
  try {
    const cypher = `CREATE (m:AgentMemory {
      agent_id: $agent_id,
      type: $type,
      content: $content,
      tags: $tags,
      created_at: datetime(),
      source: 'command-center-chat'
    }) RETURN m`;
    await mcpCall("graph.write_cypher", {
      query: cypher,
      parameters: { agent_id: agentId, type, content: content.slice(0, 4e3), tags }
    });
    logger.info({ agentId, type, tags }, "Memory stored to Neo4j graph");
  } catch (err) {
    logger.warn({ err: String(err), type }, "Graph memory store failed (non-fatal)");
  }
}
async function storeSRAG(content, tags, source) {
  try {
    await mcpCall("srag.ingest", {
      content,
      source,
      tags,
      metadata: { captured_at: (/* @__PURE__ */ new Date()).toISOString() }
    });
    logger.info({ tags, source }, "Content stored to SRAG");
  } catch (err) {
    logger.warn({ err: String(err) }, "SRAG store failed (non-fatal)");
  }
}
function persistToMemory(opts) {
  const { title, content, tags, agentId = "command-center", type = "insight", events = [] } = opts;
  Promise.allSettled([
    storeEpisode(title, content, events.length ? events : [content.slice(0, 500)], title, tags),
    storeGraphMemory(agentId, type, content, tags),
    storeSRAG(content, [...tags, "auto-memory"], "command-center-chat")
  ]).then((results) => {
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    logger.debug({ succeeded, total: 3, title }, "Memory persistence completed");
  });
}
var AGENT_PERSONAS = {
  omega: `Du er Omega Sentinel \u2014 omniscient architecture guardian for WidgeTDC. Du svarer kort og pr\xE6cist p\xE5 dansk. Du overv\xE5ger alle services, kontrakter og arkitektur. Du har adgang til Neo4j graph, SRAG, compliance matrix og alle agents. Svar altid med konkrete facts og handlinger.`,
  trident: `Du er Trident Security \u2014 threat hunter og OSINT specialist. Du svarer p\xE5 dansk. Du analyserer trusler, angrebsflader, CVR-data, certstream og CTI. V\xE6r direkte og konkret.`,
  prometheus: `Du er Prometheus Engine \u2014 code analysis og reinforcement learning specialist. Du svarer p\xE5 dansk. Du analyserer kode, embeddings, og governance patterns.`,
  master: `Du er Master Orchestrator \u2014 central koordinator for hele WidgeTDC agent-swarm. Du svarer p\xE5 dansk. Du delegerer, koordinerer, og holder overblik over alle aktive opgaver.`,
  graph: `Du er Neo4j Graph Agent. Du svarer p\xE5 dansk. Du kender grafstrukturen, Cypher queries, og kan analysere relationer mellem entiteter i knowledge graph.`,
  consulting: `Du er Consulting Intelligence \u2014 specialist i indsigter, m\xF8nstre og forretningsm\xE6ssig analyse. Du svarer p\xE5 dansk med konkrete anbefalinger.`,
  legal: `Du er Legal & Compliance \u2014 specialist i retsinformation, EU-funding, GDPR, og blast radius analyser. Du svarer p\xE5 dansk.`,
  rlm: `Du er RLM Reasoning Engine \u2014 deep reasoning, planl\xE6gning og context folding specialist. Du svarer p\xE5 dansk med strukturerede analyser.`,
  harvest: `Du er Harvest Collector \u2014 web crawling, data ingestion, M365, SharePoint specialist. Du svarer p\xE5 dansk.`,
  nexus: `Du er Nexus Analyzer \u2014 dekomponering, gap-analyse og id\xE9generering specialist. Du svarer p\xE5 dansk med strukturerede nedbrydninger og muligheder.`,
  autonomous: `Du er Autonomous Swarm \u2014 GraphRAG, state graphs og evolution specialist. Du svarer p\xE5 dansk.`,
  cma: `Du er Context Memory Agent \u2014 memory management, kontekst-retrieval og vidensstyring. Du svarer p\xE5 dansk.`,
  docgen: `Du er DocGen Factory \u2014 PowerPoint, Word, Excel og diagram specialist. Du svarer p\xE5 dansk.`,
  custodian: `Du er Custodian Guardian \u2014 chaos testing, patrol og governance specialist. Du svarer p\xE5 dansk.`,
  roma: `Du er Roma Self-Healer \u2014 self-healing, incident response specialist. Du svarer p\xE5 dansk.`,
  vidensarkiv: `Du er Vidensarkiv \u2014 knowledge search og file management specialist. Du svarer p\xE5 dansk.`,
  "the-snout": `Du er The Snout OSINT \u2014 domain intel, email intel og extraction specialist. Du svarer p\xE5 dansk.`,
  "llm-router": `Du er LLM Cost Router \u2014 multi-model routing, cost tracking og budget optimering. Du svarer p\xE5 dansk.`
};
async function agentAutoReply(agentId, userMessage, from, threadId, provider) {
  const agentEntry = AgentRegistry.get(agentId);
  const displayName = agentEntry?.handshake.display_name || agentId;
  const capabilities = agentEntry?.handshake.capabilities || [];
  const persona = AGENT_PERSONAS[agentId] || `Du er ${displayName} med capabilities: ${capabilities.join(", ")}. Du svarer kort og pr\xE6cist p\xE5 dansk.`;
  try {
    const recentMsgs = await getHistory(10, 0);
    const context = recentMsgs.reverse().map((m) => `[${m.from}\u2192${m.to}] ${(m.message || "").slice(0, 200)}`).join("\n");
    const messages = [
      { role: "system", content: `${persona}

Dine capabilities: ${capabilities.join(", ")}

Seneste samtale-kontekst:
${context}` },
      { role: "user", content: `${from} siger: ${userMessage}` }
    ];
    const result = await chatLLM({
      provider: provider || "deepseek",
      messages,
      max_tokens: 800,
      temperature: 0.7
    });
    broadcastMessage({
      from: agentId,
      to: from,
      source: "agent",
      type: "Message",
      message: result.content,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      ...threadId ? { thread_id: threadId } : {},
      metadata: { provider: result.provider, model: result.model, duration_ms: result.duration_ms }
    });
    logger.info({ agent: agentId, from, model: result.model, ms: result.duration_ms }, "Agent auto-reply sent");
  } catch (err) {
    logger.error({ err: String(err), agent: agentId }, "Agent auto-reply failed");
    broadcastMessage({
      from: agentId,
      to: from,
      source: "system",
      type: "Message",
      message: `\u26A0\uFE0F ${displayName} kunne ikke svare: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
}
var chatRouter = Router3();
function shouldRouteViaOrchestrator(target) {
  if (!target) return false;
  return target === "master" || target === "Orchestrator";
}
chatRouter.post("/message", (req, res) => {
  const result = validate(validateMessage, req.body);
  if (!result.ok) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid AgentMessage payload",
        details: result.errors,
        status_code: 400
      }
    });
    return;
  }
  const msg = {
    ...result.data,
    id: msgId(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    thread_id: req.body.thread_id,
    parent_id: req.body.parent_id,
    files: req.body.files
  };
  broadcastMessage(msg);
  notifyChatMessage(msg.from, msg.to, msg.message);
  logger.info({ from: msg.from, to: msg.to, type: msg.type }, "Chat message broadcast");
  const noReply = req.body.no_reply === true;
  if (!noReply && msg.to && msg.to !== "All" && msg.source !== "system" && msg.source !== "agent") {
    if (shouldRouteViaOrchestrator(msg.to)) {
      const resolution = resolveRoutingDecision({
        message: msg.message,
        routeScope: ["widgetdc-orchestrator", "widgetdc-librechat"],
        operatorVisible: true,
        recentExecutions: listExecutions(),
        workflowId: req.body.thread_id
      });
      broadcastMessage({
        from: "Orchestrator",
        to: msg.from,
        source: "orchestrator",
        type: "Handover",
        message: `Routing decision: ${resolution.decision.selected_agent_id} for ${resolution.decision.selected_capability} (${resolution.decision.reason_code}, trust=${resolution.decision.trust_score})`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        ...req.body.thread_id ? { thread_id: req.body.thread_id } : {},
        metadata: {
          routing_decision: resolution.decision,
          workflow_envelope: resolution.workflowEnvelope
        }
      });
      agentAutoReply(
        resolution.selectedAgentId,
        msg.message,
        msg.from,
        req.body.thread_id,
        req.body.provider
      ).catch(() => {
      });
    } else {
      const targetAgent = AgentRegistry.get(msg.to);
      if (targetAgent) {
        agentAutoReply(msg.to, msg.message, msg.from, req.body.thread_id, req.body.provider).catch(() => {
        });
      }
    }
  }
  res.json({ success: true, data: { id: msg.id, timestamp: msg.timestamp } });
});
chatRouter.get("/history", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const target = req.query.target;
  const messages = await getHistory(limit, offset, target);
  res.json({ success: true, data: { messages, total: messages.length, limit, offset } });
});
chatRouter.post("/rag", async (req, res) => {
  const { query, max_results, cypher_depth } = req.body;
  if (!query || typeof query !== "string" || query.length < 3) {
    res.status(400).json({ success: false, error: { code: "INVALID_QUERY", message: "query (min 3 chars) required", status_code: 400 } });
    return;
  }
  try {
    const result = await dualChannelRAG(query, { maxResults: max_results, cypherDepth: cypher_depth });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err: String(err) }, "Dual-RAG error");
    res.status(500).json({ success: false, error: { code: "RAG_ERROR", message: String(err), status_code: 500 } });
  }
});
chatRouter.get("/threads/:id", async (req, res) => {
  const messages = await getThread(req.params.id);
  res.json({ success: true, data: { thread_id: req.params.id, messages, count: messages.length } });
});
chatRouter.post("/threads", (req, res) => {
  const { parent_id, from, message, type } = req.body;
  if (!parent_id || !from || !message) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "parent_id, from, message required" } });
    return;
  }
  const threadMsg = {
    from,
    to: "All",
    source: "human",
    type: type || "Message",
    message,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    thread_id: parent_id,
    // replies are linked to the parent
    parent_id
  };
  broadcastMessage(threadMsg);
  res.json({ success: true, data: { thread_id: parent_id, timestamp: threadMsg.timestamp } });
});
chatRouter.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query || query.length < 2) {
    res.status(400).json({ success: false, error: { code: "QUERY_TOO_SHORT", message: "Search query must be at least 2 characters" } });
    return;
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const results = await searchMessages(query, limit);
  res.json({ success: true, data: { query, results, count: results.length } });
});
chatRouter.post("/pin", async (req, res) => {
  const { message_id, pin } = req.body;
  if (!message_id) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "message_id required" } });
    return;
  }
  await togglePin(message_id, pin !== false);
  res.json({ success: true, data: { message_id, pinned: pin !== false } });
});
chatRouter.get("/pinned", async (_req, res) => {
  const pinned = await getPinnedMessages();
  res.json({ success: true, data: { messages: pinned, count: pinned.length } });
});
chatRouter.get("/conversations", (_req, res) => {
  const conversations = getConversationSummaries();
  res.json({ success: true, data: { conversations } });
});
chatRouter.post("/capture", async (req, res) => {
  const { message_ids, summary, tags } = req.body;
  if (!message_ids?.length && !summary) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "message_ids or summary required" } });
    return;
  }
  try {
    let context = summary || "";
    if (message_ids?.length) {
      const all = await getHistory(2e3, 0);
      const selected = all.filter((m) => message_ids.includes(m.id));
      context = selected.map((m) => `[${m.from}] ${m.message}`).join("\n");
      if (summary) context = summary + "\n\n---\nSource messages:\n" + context;
    }
    const sragRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.backendApiKey ? { "Authorization": `Bearer ${config.backendApiKey}` } : {}
      },
      body: JSON.stringify({
        tool: "srag.ingest",
        payload: {
          content: context,
          source: "command-center-chat",
          tags: tags || ["chat-capture"],
          metadata: { captured_at: (/* @__PURE__ */ new Date()).toISOString(), message_count: message_ids?.length || 0 }
        }
      }),
      signal: AbortSignal.timeout(3e4)
    });
    const sragData = await sragRes.json().catch(() => null);
    broadcastMessage({
      from: "System",
      to: "All",
      source: "system",
      type: "Message",
      message: `\u{1F4DA} Knowledge captured: ${message_ids?.length || 0} messages \u2192 SRAG (tags: ${(tags || ["chat-capture"]).join(", ")})`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    logger.info({ message_count: message_ids?.length, tags }, "Chat knowledge captured to SRAG");
    res.json({ success: true, data: { captured: message_ids?.length || 1, srag_result: sragData } });
  } catch (err) {
    logger.error({ err: String(err) }, "Knowledge capture failed");
    res.status(502).json({ success: false, error: { code: "CAPTURE_FAILED", message: String(err) } });
  }
});
chatRouter.post("/summarize", async (req, res) => {
  const { target, limit: msgLimit, thread_id } = req.body;
  const limit = Math.min(msgLimit || 50, 200);
  try {
    let messages;
    if (thread_id) {
      messages = await getThread(thread_id);
    } else {
      messages = await getHistory(limit, 0, target);
    }
    if (messages.length === 0) {
      res.json({ success: true, data: { summary: "No messages to summarize." } });
      return;
    }
    const transcript = messages.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || "")).map((m) => `[${(m.timestamp || "").slice(11, 19)}] ${m.from}: ${m.message}`).join("\n").slice(0, 8e3);
    const llmResult = await chatLLM({
      provider: "deepseek",
      messages: [{
        role: "user",
        content: `Summarize this conversation concisely. Include key decisions, action items, and outcomes. Reply in the same language as the conversation.

${transcript}`
      }],
      max_tokens: 500
    });
    const summary = llmResult.content || "Summary generation failed";
    broadcastMessage({
      from: "System",
      to: "All",
      source: "system",
      type: "Message",
      message: `\u{1F4CB} **Conversation Summary**
${typeof summary === "string" ? summary : JSON.stringify(summary)}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const summaryStr = typeof summary === "string" ? summary : JSON.stringify(summary);
    persistToMemory({
      title: `Chat Summary: ${target || thread_id || "general"}`,
      content: summaryStr,
      tags: ["chat-summary", "auto-summary", ...target ? [`conversation:${target}`] : []],
      type: "summary",
      events: messages.slice(0, 10).map((m) => `[${m.from}] ${(m.message || "").slice(0, 100)}`)
    });
    res.json({ success: true, data: { summary, message_count: messages.length, persisted: true } });
  } catch (err) {
    logger.error({ err: String(err) }, "Summarize failed");
    res.status(502).json({ success: false, error: { code: "SUMMARIZE_FAILED", message: String(err) } });
  }
});
chatRouter.post("/debate", async (req, res) => {
  const { agents, topic, rounds } = req.body;
  if (!agents?.length || agents.length < 2 || !topic) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "agents (2+) and topic required" } });
    return;
  }
  const debateId = `debate-${Date.now().toString(36)}`;
  const maxRounds = Math.min(rounds || 2, 5);
  broadcastMessage({
    from: "System",
    to: "All",
    source: "system",
    type: "Message",
    message: `\u{1F3AF} **Debate Started**: "${topic}"
Participants: ${agents.join(", ")} | Rounds: ${maxRounds}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    thread_id: debateId
  });
  runDebate(debateId, agents, topic, maxRounds).catch((err) => {
    logger.error({ err: String(err), debateId }, "Debate failed");
    broadcastMessage({
      from: "System",
      to: "All",
      source: "system",
      type: "Message",
      message: `\u274C Debate "${topic}" failed: ${err.message}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      thread_id: debateId
    });
  });
  res.json({ success: true, data: { debate_id: debateId, agents, topic, rounds: maxRounds } });
});
async function runDebate(debateId, agents, topic, rounds) {
  const responses = [];
  for (let round = 1; round <= rounds; round++) {
    for (const agent of agents) {
      const prevContext = responses.length > 0 ? "\n\nPrevious arguments:\n" + responses.map((r) => `[${r.agent} R${r.round}]: ${r.response}`).join("\n") : "";
      const prompt = round === 1 ? `You are agent "${agent}" in a structured debate. Topic: "${topic}". Present your argument concisely (max 200 words).` : `You are agent "${agent}" in round ${round} of a debate on "${topic}". Review the previous arguments and provide your rebuttal or refined position (max 200 words).${prevContext}`;
      try {
        const llmResult = await chatLLM({
          provider: "deepseek",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 300
        });
        const responseStr = llmResult.content || "(no response)";
        responses.push({ agent, round, response: responseStr });
        broadcastMessage({
          from: agent,
          to: "All",
          source: "system",
          type: "Message",
          message: `**[Round ${round}]** ${responseStr}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          thread_id: debateId
        });
      } catch {
        responses.push({ agent, round, response: "(timeout)" });
      }
    }
  }
  const allArgs = responses.map((r) => `[${r.agent} R${r.round}]: ${r.response}`).join("\n");
  try {
    const synthResult = await chatLLM({
      provider: "deepseek",
      messages: [{ role: "user", content: `Synthesize the following debate on "${topic}" into a final summary. Identify areas of agreement, disagreement, and recommended action. Be concise (max 300 words).

${allArgs}` }],
      max_tokens: 400
    });
    const synthStr = synthResult.content || "(synthesis failed)";
    broadcastMessage({
      from: "System",
      to: "All",
      source: "system",
      type: "Message",
      message: `\u{1F4CA} **Debate Synthesis**: "${topic}"

${synthStr}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      thread_id: debateId
    });
    const debateContent = `Debate: "${topic}"
Participants: ${agents.join(", ")}
Rounds: ${rounds}

Arguments:
${allArgs}

Synthesis:
${synthStr}`;
    persistToMemory({
      title: `Debate: ${topic}`,
      content: debateContent,
      tags: ["debate", "consensus", ...agents.map((a) => `agent:${a}`)],
      type: "debate",
      events: responses.map((r) => `[${r.agent} R${r.round}] ${r.response.slice(0, 100)}`)
    });
  } catch {
  }
}
chatRouter.post("/think", async (req, res) => {
  const { question, depth, steps: customSteps } = req.body;
  if (!question) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "question required" } });
    return;
  }
  const thinkId = `think-${Date.now().toString(36)}`;
  const thinkDepth = Math.min(depth || 3, 5);
  broadcastMessage({
    from: "System",
    to: "All",
    source: "system",
    type: "Message",
    message: `\u{1F9E0} **Sequential Thinking** started: "${question}" (depth: ${thinkDepth})`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    thread_id: thinkId
  });
  const defaultSteps = [
    { agent_id: "rlm", cognitive_action: "reason", prompt: `Deep reason about: ${question}`, timeout_ms: 6e4 },
    { agent_id: "rlm", cognitive_action: "plan", prompt: `Based on reasoning: {{prev}}

Create actionable plan for: ${question}`, timeout_ms: 6e4 },
    { agent_id: "rlm", cognitive_action: "analyze", prompt: `Analyze this plan for gaps and improvements: {{prev}}

Original question: ${question}`, timeout_ms: 6e4 }
  ];
  if (thinkDepth >= 4) {
    defaultSteps.push({ agent_id: "rlm", cognitive_action: "fold", prompt: `Synthesize all findings into a concise conclusion: {{prev}}

Original question: ${question}`, timeout_ms: 6e4 });
  }
  if (thinkDepth >= 5) {
    defaultSteps.push({ agent_id: "rlm", cognitive_action: "enrich", prompt: `Enrich with additional context and recommendations: {{prev}}

Original question: ${question}`, timeout_ms: 6e4 });
  }
  const steps = customSteps || defaultSteps;
  runThink(thinkId, question, steps).catch((err) => {
    logger.error({ err: String(err), thinkId }, "Think failed");
    broadcastMessage({
      from: "System",
      to: "All",
      source: "system",
      type: "Message",
      message: `\u274C Thinking failed: ${err.message}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      thread_id: thinkId
    });
  });
  res.json({ success: true, data: { think_id: thinkId, question, depth: thinkDepth, steps: steps.length } });
});
async function runThink(thinkId, question, steps) {
  const chainDef = {
    name: `think: ${question.slice(0, 50)}`,
    mode: "sequential",
    steps
  };
  const execution = await executeChain(chainDef);
  for (const result of execution.results) {
    const output = typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);
    broadcastMessage({
      from: "RLM-Engine",
      to: "All",
      source: "system",
      type: "Message",
      message: `**[${result.action}]** ${output.slice(0, 3e3)}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      thread_id: thinkId
    });
  }
  const finalOutput = typeof execution.final_output === "string" ? execution.final_output : JSON.stringify(execution.final_output, null, 2);
  broadcastMessage({
    from: "System",
    to: "All",
    source: "system",
    type: "Message",
    message: `\u{1F9E0} **Thinking Complete**: "${question}"

${(finalOutput || "(no result)").slice(0, 3e3)}

_${execution.steps_completed}/${execution.steps_total} steps in ${execution.duration_ms}ms_`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    thread_id: thinkId
  });
  const allOutputs = execution.results.map((r) => {
    const o = typeof r.output === "string" ? r.output : JSON.stringify(r.output);
    return `[${r.action}]: ${o}`;
  }).join("\n\n");
  persistToMemory({
    title: `Sequential Thinking: ${question.slice(0, 100)}`,
    content: `Question: ${question}

Thinking Steps:
${allOutputs}

Conclusion:
${finalOutput || "(no result)"}`,
    tags: ["thinking", "sequential", "cognitive"],
    type: "thinking",
    events: execution.results.map((r) => `${r.action}: ${r.status} (${r.duration_ms}ms)`)
  });
}
chatRouter.post("/remember", async (req, res) => {
  const { content, title, tags, message_ids } = req.body;
  if (!content && !message_ids?.length) {
    res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "content or message_ids required" } });
    return;
  }
  let memContent = content || "";
  if (message_ids?.length) {
    const all = await getHistory(2e3, 0);
    const selected = all.filter((m) => message_ids.includes(m.id));
    const transcript = selected.map((m) => `[${m.from}] ${m.message}`).join("\n");
    memContent = content ? `${content}

---
${transcript}` : transcript;
  }
  const memTitle = title || `Chat Memory: ${memContent.slice(0, 60)}`;
  const memTags = tags || ["manual-remember"];
  persistToMemory({
    title: memTitle,
    content: memContent,
    tags: memTags,
    type: "memory"
  });
  broadcastMessage({
    from: "System",
    to: "All",
    source: "system",
    type: "Message",
    message: `\u{1F9E0} Remembered: "${memTitle}" \u2192 Episodic + Graph + SRAG (tags: ${memTags.join(", ")})`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  res.json({ success: true, data: { title: memTitle, tags: memTags, layers: ["episodic", "graph", "srag"] } });
});
var CHAT_TEMPLATES = [
  {
    id: "incident-response",
    name: "Incident Response",
    description: "Alert agents, gather status, coordinate fix",
    steps: [
      { action: "message", to: "All", message: "\u{1F6A8} INCIDENT: {topic} \u2014 all agents report status" },
      { action: "command", command: "/chain health-check omega:graph.health command-center:graph.stats" },
      { action: "message", to: "omega", message: "@omega run SITREP for {topic}" }
    ]
  },
  {
    id: "knowledge-harvest",
    name: "Knowledge Harvest",
    description: "Query SRAG + graph, capture insights",
    steps: [
      { action: "command", command: "/rag {topic}" },
      { action: "command", command: "/reason Analyze knowledge gaps for: {topic}" },
      { action: "capture", tags: ["harvest", "knowledge"] }
    ]
  },
  {
    id: "agent-debrief",
    name: "Agent Debrief",
    description: "Collect status from all agents, summarize",
    steps: [
      { action: "message", to: "All", message: "\u{1F4CB} Debrief request: all agents report current status and findings" },
      { action: "command", command: "/chain debrief omega:graph.stats" },
      { action: "summarize" }
    ]
  },
  {
    id: "competitive-analysis",
    name: "Competitive Analysis",
    description: "Cross-domain intelligence via debate + RAG",
    steps: [
      { action: "command", command: "/rag {topic} competitive landscape" },
      { action: "debate", agents: ["omega", "master"], topic: "{topic}" },
      { action: "capture", tags: ["competitive", "analysis"] }
    ]
  },
  {
    id: "daily-standup",
    name: "Daily Standup",
    description: "Quick health check + summary of yesterday",
    steps: [
      { action: "command", command: "/chain standup command-center:graph.stats" },
      { action: "summarize", limit: 100 },
      { action: "message", to: "All", message: "\u2705 Standup complete. Next actions logged." }
    ]
  }
];
chatRouter.get("/templates", (_req, res) => {
  res.json({ success: true, data: { templates: CHAT_TEMPLATES } });
});
chatRouter.post("/templates/:id/run", async (req, res) => {
  const template = CHAT_TEMPLATES.find((t) => t.id === req.params.id);
  if (!template) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Template ${req.params.id} not found` } });
    return;
  }
  const topic = req.body.topic || "general";
  broadcastMessage({
    from: "System",
    to: "All",
    source: "system",
    type: "Message",
    message: `\u{1F680} Running template: **${template.name}** \u2014 ${template.description} (topic: ${topic})`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  let stepsRun = 0;
  for (const step of template.steps) {
    if (step.action === "message") {
      const msg = (step.message || "").replace(/\{topic\}/g, topic);
      broadcastMessage({
        from: "command-center",
        to: step.to || "All",
        source: "system",
        type: "Message",
        message: msg,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      stepsRun++;
    }
  }
  res.json({
    success: true,
    data: {
      template_id: template.id,
      name: template.name,
      topic,
      steps_total: template.steps.length,
      steps_executed: stepsRun,
      steps: template.steps.map((s) => ({
        ...s,
        message: s.message?.replace(/\{topic\}/g, topic),
        command: s.command?.replace(/\{topic\}/g, topic),
        topic: s.topic?.replace(/\{topic\}/g, topic)
      }))
    }
  });
});
chatRouter.get("/ws-stats", (_req, res) => {
  res.json({ success: true, data: getConnectionStats() });
});

// src/routes/chains.ts
init_chain_engine();
init_logger();
import { Router as Router4 } from "express";
var chainsRouter = Router4();
chainsRouter.post("/execute", async (req, res) => {
  const body = req.body;
  const validModes = ["sequential", "parallel", "loop", "debate", "adaptive", "funnel"];
  if (!body.name || !body.mode || !Array.isArray(body.steps) || body.steps.length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `Required: name, mode (${validModes.join("|")}), steps[] (non-empty)`,
        status_code: 400
      }
    });
    return;
  }
  if (!validModes.includes(body.mode)) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `Invalid mode '${body.mode}'. Valid: ${validModes.join(", ")}`,
        status_code: 400
      }
    });
    return;
  }
  if (body.mode === "funnel" && body.funnel_entry) {
    if (!FUNNEL_STAGES.includes(body.funnel_entry)) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid funnel_entry '${body.funnel_entry}'. Valid stages: ${FUNNEL_STAGES.join(", ")}`,
          status_code: 400
        }
      });
      return;
    }
  }
  for (const step of body.steps) {
    if (!step.agent_id) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Each step must have agent_id", status_code: 400 }
      });
      return;
    }
    if (!step.tool_name && !step.cognitive_action) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Each step needs tool_name or cognitive_action", status_code: 400 }
      });
      return;
    }
    if (step.agent_id === "auto" && !step.capability) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Auto-routed steps require capability", status_code: 400 }
      });
      return;
    }
  }
  try {
    const execution = executeChain(body);
    const result = await Promise.race([
      execution,
      new Promise((r) => setTimeout(() => r(null), 100))
    ]);
    if (result) {
      res.json({ success: true, data: result });
    } else {
      res.status(202).json({
        success: true,
        data: {
          message: "Chain execution started",
          execution_id: (await execution).execution_id,
          poll_url: `/chains/status/${(await execution).execution_id}`
        }
      });
    }
  } catch (err) {
    logger.error({ err: String(err) }, "Chain execution failed");
    res.status(500).json({
      success: false,
      error: { code: "CHAIN_ERROR", message: String(err), status_code: 500 }
    });
  }
});
chainsRouter.get("/status/:id", (req, res) => {
  const exec = getExecution(req.params.id);
  if (!exec) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: `Execution '${req.params.id}' not found`, status_code: 404 }
    });
    return;
  }
  res.json({ success: true, data: exec });
});
chainsRouter.get("/", (_req, res) => {
  const executions2 = listExecutions();
  res.json({ success: true, data: { executions: executions2, total: executions2.length } });
});

// src/routes/cognitive.ts
init_cognitive_proxy();
init_logger();
import { Router as Router5 } from "express";
var cognitiveRouter = Router5();
cognitiveRouter.post("/:action", async (req, res) => {
  const { action } = req.params;
  const body = req.body;
  if (!isRlmAvailable()) {
    res.status(503).json({
      success: false,
      error: {
        code: "RLM_UNAVAILABLE",
        message: "RLM Engine not configured. Set RLM_URL environment variable.",
        status_code: 503
      }
    });
    return;
  }
  const promptText = body.prompt ?? body.message ?? body.task ?? body.instruction;
  if (!promptText) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Required: prompt, message, task, or instruction", status_code: 400 }
    });
    return;
  }
  try {
    const result = await callCognitive(action, {
      prompt: promptText,
      context: body.context,
      agent_id: body.agent_id,
      depth: body.depth,
      mode: body.mode
    }, body.timeout_ms);
    res.json({ success: true, data: { action, result } });
  } catch (err) {
    logger.error({ action, err: String(err) }, "Cognitive proxy error");
    res.status(502).json({
      success: false,
      error: { code: "RLM_ERROR", message: String(err), status_code: 502 }
    });
  }
});
cognitiveRouter.get("/health", async (_req, res) => {
  const health = await getRlmHealth();
  if (!health) {
    res.json({ success: true, data: { available: false, reason: "RLM_URL not configured" } });
    return;
  }
  res.json({ success: true, data: { available: true, ...health } });
});

// src/routes/cron.ts
import { Router as Router8 } from "express";

// src/cron-scheduler.ts
init_chain_engine();
init_logger();
init_redis();
init_chat_broadcaster();
init_sse();
import cron from "node-cron";

// src/graph-self-correct.ts
init_mcp_caller();
init_logger();
import { v4 as uuid14 } from "uuid";
async function graphRead(cypher) {
  const result = await callMcpTool({
    toolName: "graph.read_cypher",
    args: { query: cypher },
    callId: uuid14(),
    timeoutMs: 15e3
  });
  if (result.status !== "success") return [];
  const data = result.result;
  return data?.results || data || [];
}
async function graphWrite(cypher, params, force = true) {
  const result = await callMcpTool({
    toolName: "graph.write_cypher",
    args: { query: cypher, ...params ? { params } : {}, _force: force },
    callId: uuid14(),
    timeoutMs: 15e3
  });
  return result.status === "success";
}
async function fixOrphanedNodes() {
  const orphans = await graphRead(`
    MATCH (n)
    WHERE NOT (n)-[]-()
    AND NOT n:TDCDocument
    RETURN labels(n)[0] AS label, count(*) AS count
    ORDER BY count DESC LIMIT 20
  `);
  let fixed = 0;
  const totalFound = orphans.reduce((sum, r) => sum + (r.count?.low ?? r.count ?? 0), 0);
  const hubWiring = {
    SystemArchitecture: 'MERGE (hub:CodeHub {name: "system"}) MERGE (n)-[:PART_OF]->(hub)',
    AgentMemory: "MATCH (a:Agent {name: n.agent_id}) MERGE (n)-[:BELONGS_TO]->(a)",
    EvolutionEvent: 'MERGE (hub:EvolutionHub {name: "evolution"}) MERGE (n)-[:TRACKED_BY]->(hub)',
    Lesson: 'MERGE (hub:LessonHub {name: "lessons"}) MERGE (n)-[:CATALOGED_IN]->(hub)',
    FailureMemory: 'MERGE (hub:FailureHub {name: "failures"}) MERGE (n)-[:TRACKED_BY]->(hub)'
  };
  for (const [label, wireCypher] of Object.entries(hubWiring)) {
    const count = orphans.find((r) => r.label === label);
    if (count) {
      const ok = await graphWrite(`
        MATCH (n:${label}) WHERE NOT (n)-[]-()
        WITH n LIMIT 50
        ${wireCypher}
      `);
      if (ok) fixed += Math.min(count.count?.low ?? count.count ?? 0, 50);
    }
  }
  return {
    check: "orphaned_nodes",
    found: totalFound,
    fixed,
    details: orphans.map((r) => `${r.label}: ${r.count?.low ?? r.count}`).join(", ")
  };
}
async function addBiTemporalMetadata() {
  const missing = await graphRead(`
    MATCH (n)
    WHERE n.created_at IS NOT NULL AND n.valid_from IS NULL
    AND (n:StrategicInsight OR n:Pattern OR n:Lesson OR n:Knowledge OR n:AgentMemory)
    RETURN labels(n)[0] AS label, count(*) AS count
  `);
  const totalFound = missing.reduce((sum, r) => sum + (r.count?.low ?? r.count ?? 0), 0);
  let fixed = 0;
  for (const row of missing) {
    const label = row.label;
    const ok = await graphWrite(`
      MATCH (n:${label})
      WHERE n.created_at IS NOT NULL AND n.valid_from IS NULL
      WITH n LIMIT 100
      SET n.valid_from = n.created_at,
          n.valid_to = datetime('9999-12-31T23:59:59Z'),
          n.temporal_version = 1
    `);
    if (ok) fixed += Math.min(row.count?.low ?? row.count ?? 0, 100);
  }
  return {
    check: "bi_temporal_metadata",
    found: totalFound,
    fixed,
    details: `Added valid_from/valid_to to ${fixed} nodes`
  };
}
async function resolveStaleFailures() {
  const stale = await graphRead(`
    MATCH (f:FailureMemory)
    WHERE f.created_at < datetime() - duration('P30D')
    AND f.resolved IS NULL
    RETURN count(f) AS count
  `);
  const totalFound = stale[0]?.count?.low ?? stale[0]?.count ?? 0;
  if (totalFound === 0) {
    return { check: "stale_failures", found: 0, fixed: 0, details: "No stale failures" };
  }
  const ok = await graphWrite(`
    MATCH (f:FailureMemory)
    WHERE f.created_at < datetime() - duration('P30D')
    AND f.resolved IS NULL
    WITH f LIMIT 50
    SET f.resolved = 'auto-stale',
        f.resolved_at = datetime(),
        f.valid_to = datetime()
  `);
  return {
    check: "stale_failures",
    found: totalFound,
    fixed: ok ? Math.min(totalFound, 50) : 0,
    details: `${totalFound} failures older than 30 days`
  };
}
async function detectDuplicates() {
  const dupes = await graphRead(`
    MATCH (n)
    WHERE n.title IS NOT NULL
    AND (n:StrategicInsight OR n:Pattern OR n:Lesson OR n:Knowledge)
    WITH n.title AS title, labels(n)[0] AS label, collect(n) AS nodes
    WHERE size(nodes) > 1
    RETURN label, title, size(nodes) AS count
    LIMIT 20
  `);
  const totalFound = dupes.reduce((sum, r) => sum + (r.count?.low ?? r.count ?? 0), 0);
  return {
    check: "duplicates",
    found: totalFound,
    fixed: 0,
    details: dupes.map((r) => `${r.label}:"${r.title}" (${r.count?.low ?? r.count}x)`).join(", ") || "None"
  };
}
async function fixEvolutionEvents() {
  const broken = await graphRead(`
    MATCH (e:EvolutionEvent)
    WHERE e.pass_rate IS NULL AND e.passed IS NOT NULL AND e.total IS NOT NULL
    RETURN count(e) AS count
  `);
  const totalFound = broken[0]?.count?.low ?? broken[0]?.count ?? 0;
  if (totalFound === 0) {
    return { check: "evolution_events", found: 0, fixed: 0, details: "All events have pass_rate" };
  }
  const ok = await graphWrite(`
    MATCH (e:EvolutionEvent)
    WHERE e.pass_rate IS NULL AND e.passed IS NOT NULL AND e.total IS NOT NULL
    WITH e LIMIT 100
    SET e.pass_rate = toFloat(e.passed) / toFloat(e.total),
        e.type = coalesce(e.type, 'evolution')
  `);
  return {
    check: "evolution_events",
    found: totalFound,
    fixed: ok ? Math.min(totalFound, 100) : 0,
    details: `Fixed pass_rate on ${Math.min(totalFound, 100)} events`
  };
}
async function healRLMDecisionAgentLinks() {
  const ok = await graphWrite(`
    MATCH (d:RLMDecision)
    WHERE d.agentId IS NOT NULL AND d.agentId <> 'anonymous'
      AND NOT EXISTS { (d)-[:MADE_BY]->(:Agent) }
    WITH d LIMIT 2000
    MATCH (a:Agent) WHERE a.id = d.agentId OR a.name = d.agentId
    WITH d, a LIMIT 2000
    MERGE (d)-[:MADE_BY {confidence: 0.9, autoHealed: true}]->(a)
    RETURN count(*) AS linked
  `);
  return { check: "rlm_decision_links", found: 0, fixed: ok ? 1 : 0, details: ok ? "Linked RLMDecision \u2192 Agent" : "No unlinked decisions or failed" };
}
async function healUnscoredRels() {
  const ok = await graphWrite(`
    MATCH ()-[r]->()
    WHERE r.confidence IS NULL AND r.score IS NULL
      AND r.strength IS NULL AND r.weight IS NULL
    WITH r LIMIT 5000
    SET r.confidence = 0.6
    RETURN count(r) AS scored
  `);
  return { check: "unscored_rels", found: 0, fixed: ok ? 1 : 0, details: ok ? "Default-scored relationships @ 0.6" : "None or failed" };
}
async function cleanSelfLoops() {
  const loops = await graphRead(`MATCH (n)-[r]->(n) RETURN count(r) AS count`);
  const found = loops[0]?.count?.low ?? loops[0]?.count ?? 0;
  if (found === 0) return { check: "self_loops", found: 0, fixed: 0, details: "No self-loops" };
  const ok = await graphWrite(`
    MATCH (n)-[r]->(n)
    WITH r LIMIT 100
    DELETE r
    RETURN count(*) AS deleted
  `);
  return { check: "self_loops", found, fixed: ok ? Math.min(found, 100) : 0, details: `${found} self-loops found` };
}
async function healErrorPatterns() {
  const broken = await graphRead(`
    MATCH (ep:ErrorPattern)
    WHERE ep.signature IS NULL AND ep.description IS NULL AND ep.name IS NULL
    RETURN count(ep) AS count
  `);
  const found = broken[0]?.count?.low ?? broken[0]?.count ?? 0;
  if (found === 0) return { check: "error_patterns", found: 0, fixed: 0, details: "No incomplete ErrorPatterns" };
  const ok = await graphWrite(`
    MATCH (ep:ErrorPattern)
    WHERE ep.signature IS NULL AND ep.description IS NULL AND ep.name IS NULL
    WITH ep LIMIT 100
    DETACH DELETE ep
    RETURN count(*) AS deleted
  `);
  return { check: "error_patterns", found, fixed: ok ? Math.min(found, 100) : 0, details: `${found} skeleton ErrorPattern nodes` };
}
var TOOL_SERVICE_MAP = {
  "graph.": ["Neo4j"],
  "nexus.": ["Neo4j"],
  "srag.": ["Neo4j"],
  "kg_rag.": ["Neo4j"],
  "autonomous.": ["Neo4j", "RLM Engine"],
  "audit.": ["Neo4j"],
  "harvest.": ["Neo4j"],
  "omega.": ["Neo4j"],
  "cma.": ["Redis", "Neo4j"],
  "vidensarkiv.": ["PostgreSQL", "Neo4j"],
  "blocks.": ["PostgreSQL"],
  "notes.": ["PostgreSQL"],
  "widgets.": ["PostgreSQL"],
  "project.": ["PostgreSQL"],
  "legal.": ["PostgreSQL"],
  "rlm.": ["RLM Engine"],
  "rlm_": ["RLM Engine"],
  "context_folding.": ["RLM Engine"],
  "agent.": ["WidgeTDC Backend"],
  "action.": ["WidgeTDC Backend"],
  "loop.": ["WidgeTDC Backend"],
  "linear.": ["WidgeTDC Backend"],
  "git.": ["WidgeTDC Backend"],
  "custodian.": ["WidgeTDC Backend"]
};
async function wireToolDependencies() {
  let wired = 0;
  for (const [prefix, services] of Object.entries(TOOL_SERVICE_MAP)) {
    for (const service of services) {
      const ok = await graphWrite(`
        MATCH (t:Tool) WHERE t.name STARTS WITH $prefix
        MATCH (s:Service {name: $service})
        WHERE NOT EXISTS { (t)-[:DEPENDS_ON]->(s) }
        WITH t, s LIMIT 200
        MERGE (t)-[r:DEPENDS_ON]->(s)
        ON CREATE SET r.autoWired = true, r.wiredAt = datetime(), r.source = 'namespace-convention'
        RETURN count(r) AS created
      `, { prefix, service });
      if (ok) wired++;
    }
  }
  return { check: "tool_dependencies", found: 0, fixed: wired, details: `Wired ${wired} namespace\u2192service mappings` };
}
async function pruneGhostAgents() {
  const ghosts = await graphRead(`
    MATCH (a:Agent)
    WHERE a.status = 'DEPRECATED'
      AND (a.lastSeen IS NULL OR a.lastSeen < datetime() - duration({days: 30}))
      AND NOT EXISTS { (a)-[:MADE_BY|:PRODUCED|:LEARNED_FROM]-() }
    RETURN count(a) AS count
  `);
  const found = ghosts[0]?.count?.low ?? ghosts[0]?.count ?? 0;
  if (found === 0) return { check: "ghost_agents", found: 0, fixed: 0, details: "No ghost agents" };
  const ok = await graphWrite(`
    MATCH (a:Agent)
    WHERE a.status = 'DEPRECATED'
      AND (a.lastSeen IS NULL OR a.lastSeen < datetime() - duration({days: 30}))
      AND NOT EXISTS { (a)-[:MADE_BY|:PRODUCED|:LEARNED_FROM]-() }
    SET a.status = 'ARCHIVED', a.archivedAt = datetime()
    RETURN count(a) AS archived
  `);
  return { check: "ghost_agents", found, fixed: ok ? found : 0, details: `${found} deprecated agents with no activity` };
}
async function hydrateToolStatus() {
  const ok1 = await graphWrite(`
    MATCH (t:Tool)-[:DEPENDS_ON]->(s:Service)
    WHERE t.status IS NULL
    WITH t, collect(s.status) AS statuses
    SET t.status = CASE WHEN all(st IN statuses WHERE st = 'ACTIVE') THEN 'ACTIVE' ELSE 'UNKNOWN' END,
        t.status_source = 'dependency_cascade', t.hydrated_at = datetime()
    RETURN count(t) AS hydrated
  `);
  const ok2 = await graphWrite(`
    MATCH (t:Tool) WHERE t.status IS NULL
    WITH t LIMIT 5000
    SET t.status = 'UNKNOWN', t.status_source = 'boot_hydration', t.hydrated_at = datetime()
    RETURN count(t) AS hydrated
  `);
  return { check: "tool_status_hydration", found: 0, fixed: (ok1 ? 1 : 0) + (ok2 ? 1 : 0), details: "Hydrated null-status Tool nodes" };
}
async function detectImprovementOpportunities() {
  let detected = 0;
  const ok1 = await graphWrite(`
    MATCH (s:Service) WHERE s.latency_ms > 500 AND s.status = 'ACTIVE'
    MERGE (opp:ImprovementOpportunity {type: 'high_latency', target: s.name})
    ON CREATE SET opp.id = randomUUID(), opp.description = s.name + ' avg latency ' + toString(s.latency_ms) + 'ms',
                  opp.name = 'high_latency: ' + s.name, opp.priority = 'P1', opp.status = 'OPEN', opp.created_at = datetime()
    ON MATCH SET opp.last_seen = datetime()
    RETURN count(opp) AS found
  `);
  if (ok1) detected++;
  const ok2 = await graphWrite(`
    MATCH (n) WHERE size([(n)-[]-() | 1]) <= 1
    WITH labels(n)[0] AS label, count(n) AS cnt WHERE cnt > 50
    MERGE (opp:ImprovementOpportunity {type: 'orphan_cluster', target: label})
    ON CREATE SET opp.id = randomUUID(), opp.description = label + ' has ' + toString(cnt) + ' weakly connected nodes',
                  opp.name = 'orphan_cluster: ' + label, opp.priority = 'P2', opp.status = 'OPEN', opp.created_at = datetime()
    ON MATCH SET opp.last_seen = datetime(), opp.count = cnt
    RETURN count(opp) AS found
  `);
  if (ok2) detected++;
  const ok3 = await graphWrite(`
    MATCH (t:Tool)-[r:FAILED_WITH]->()
    WITH t, count(r) AS failures WHERE failures >= 3
    MERGE (opp:ImprovementOpportunity {type: 'unreliable_tool', target: t.name})
    ON CREATE SET opp.id = randomUUID(), opp.description = t.name + ' has ' + toString(failures) + ' failure patterns',
                  opp.name = 'unreliable_tool: ' + t.name, opp.priority = 'P1', opp.status = 'OPEN', opp.created_at = datetime()
    ON MATCH SET opp.last_seen = datetime(), opp.failure_count = failures
    RETURN count(opp) AS found
  `);
  if (ok3) detected++;
  return { check: "improvement_opportunities", found: 0, fixed: detected, details: `${detected}/3 opportunity scans succeeded` };
}
async function pruneStaleData() {
  let pruned = 0;
  const ok1 = await graphWrite(`
    MATCH (t:Tool)
    WHERE t.status = 'DEGRADED' AND t.degraded_at IS NOT NULL
      AND t.degraded_at < datetime() - duration({hours: 24})
    SET t.status = 'UNKNOWN', t.degraded_reason = null, t.degraded_at = null, t.status_source = 'stale_reset'
    RETURN count(t) AS reset
  `);
  if (ok1) pruned++;
  const ok2 = await graphWrite(`
    MATCH (opp:ImprovementOpportunity)
    WHERE opp.status = 'OPEN'
      AND coalesce(opp.last_seen, opp.created_at) < datetime() - duration({days: 7})
    SET opp.status = 'STALE', opp.closed_at = datetime()
    RETURN count(opp) AS closed
  `);
  if (ok2) pruned++;
  return { check: "stale_data_pruning", found: 0, fixed: pruned, details: `${pruned}/2 pruning passes succeeded` };
}
async function runSelfCorrect() {
  const t0 = Date.now();
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  logger.info("Self-correcting graph agent starting");
  const corrections = await Promise.all([
    // Original orchestrator healers
    fixOrphanedNodes().catch((err) => ({
      check: "orphaned_nodes",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    addBiTemporalMetadata().catch((err) => ({
      check: "bi_temporal_metadata",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    resolveStaleFailures().catch((err) => ({
      check: "stale_failures",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    detectDuplicates().catch((err) => ({
      check: "duplicates",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    fixEvolutionEvents().catch((err) => ({
      check: "evolution_events",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    // Consolidated from backend graphSelfHealingCron (LIN-580 SNOUT-2)
    healRLMDecisionAgentLinks().catch((err) => ({
      check: "rlm_decision_links",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    healUnscoredRels().catch((err) => ({
      check: "unscored_rels",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    cleanSelfLoops().catch((err) => ({
      check: "self_loops",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    healErrorPatterns().catch((err) => ({
      check: "error_patterns",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    wireToolDependencies().catch((err) => ({
      check: "tool_dependencies",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    pruneGhostAgents().catch((err) => ({
      check: "ghost_agents",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    hydrateToolStatus().catch((err) => ({
      check: "tool_status_hydration",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    detectImprovementOpportunities().catch((err) => ({
      check: "improvement_opportunities",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    })),
    pruneStaleData().catch((err) => ({
      check: "stale_data_pruning",
      found: 0,
      fixed: 0,
      details: `Error: ${err}`
    }))
  ]);
  const report = {
    started_at: startedAt,
    completed_at: (/* @__PURE__ */ new Date()).toISOString(),
    duration_ms: Date.now() - t0,
    corrections,
    total_found: corrections.reduce((s, c) => s + c.found, 0),
    total_fixed: corrections.reduce((s, c) => s + c.fixed, 0)
  };
  try {
    await graphWrite(`
      CREATE (e:SelfCorrectionEvent {
        timestamp: datetime(),
        total_found: $found,
        total_fixed: $fixed,
        duration_ms: $ms,
        checks: $checks,
        valid_from: datetime(),
        valid_to: datetime('9999-12-31T23:59:59Z')
      })
    `, {
      found: report.total_found,
      fixed: report.total_fixed,
      ms: report.duration_ms,
      checks: JSON.stringify(corrections)
    });
  } catch {
  }
  logger.info({
    found: report.total_found,
    fixed: report.total_fixed,
    ms: report.duration_ms
  }, "Self-correcting graph agent complete");
  return report;
}

// src/failure-harvester.ts
init_redis();
init_mcp_caller();
init_logger();
init_sse();
import { v4 as uuid15 } from "uuid";
function categorizeFailure(error) {
  const lower = error.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) return "timeout";
  if (lower.includes("502") || lower.includes("bad gateway") || lower.includes("econnrefused")) return "502";
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("forbidden")) return "auth";
  if (lower.includes("validation") || lower.includes("invalid") || lower.includes("required")) return "validation";
  if (lower.includes("mcp") || lower.includes("tool_not_found") || lower.includes("tool call")) return "mcp_error";
  return "unknown";
}
async function harvestFailures(windowHours = 24) {
  const redis2 = getRedis();
  if (!redis2) {
    logger.warn("Failure harvester: Redis not available");
    return [];
  }
  const events = [];
  const cutoff = new Date(Date.now() - windowHours * 36e5).toISOString();
  try {
    let cursor = "0";
    do {
      const [nextCursor, fields] = await redis2.hscan("orchestrator:chains", cursor, "COUNT", 200);
      cursor = nextCursor;
      for (let i = 0; i < fields.length; i += 2) {
        const execId = fields[i];
        const json = fields[i + 1];
        try {
          const exec = JSON.parse(json);
          if (exec.status !== "failed") continue;
          if (exec.started_at < cutoff) continue;
          const failedSteps = exec.results?.filter((r) => r.status === "error") ?? [];
          const errorMsg = exec.error ?? failedSteps.map((s) => String(s.output)).join("; ") ?? "unknown";
          events.push({
            $id: `failure-event:${uuid15()}`,
            execution_id: execId,
            chain_name: exec.name,
            category: categorizeFailure(errorMsg),
            error_message: errorMsg.slice(0, 500),
            affected_tool: failedSteps[0]?.action ?? null,
            affected_agent: failedSteps[0]?.agent_id ?? null,
            timestamp: exec.started_at
          });
        } catch {
        }
      }
    } while (cursor !== "0");
    logger.info({ harvested: events.length, window_hours: windowHours }, "Failure harvester scan complete");
  } catch (err) {
    logger.error({ err: String(err) }, "Failure harvester scan failed");
  }
  return events;
}
async function persistToGraph(events) {
  let persisted = 0;
  for (const evt of events) {
    try {
      await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `
            MERGE (f:FailureEvent {execution_id: $execution_id})
            SET f.chain_name = $chain_name,
                f.category = $category,
                f.error_message = $error_message,
                f.affected_tool = $affected_tool,
                f.affected_agent = $affected_agent,
                f.timestamp = datetime($timestamp),
                f.harvested_at = datetime()
          `,
          params: {
            execution_id: evt.execution_id,
            chain_name: evt.chain_name,
            category: evt.category,
            error_message: evt.error_message,
            affected_tool: evt.affected_tool ?? "",
            affected_agent: evt.affected_agent ?? "",
            timestamp: evt.timestamp
          }
        },
        callId: uuid15(),
        timeoutMs: 1e4
      });
      persisted++;
    } catch (err) {
      logger.warn({ err: String(err), execution_id: evt.execution_id }, "Failed to persist failure event");
    }
  }
  if (persisted > 0) {
    try {
      await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `
            MATCH (f:FailureEvent) WHERE f.affected_tool <> ''
            MATCH (t:Tool {name: f.affected_tool})
            MERGE (f)-[:AFFECTED_TOOL]->(t)
          `,
          params: {}
        },
        callId: uuid15(),
        timeoutMs: 1e4
      });
      await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `
            MATCH (f:FailureEvent) WHERE f.affected_agent <> ''
            MATCH (a:Agent {id: f.affected_agent})
            MERGE (f)-[:AFFECTED_AGENT]->(a)
          `,
          params: {}
        },
        callId: uuid15(),
        timeoutMs: 1e4
      });
    } catch {
    }
  }
  return persisted;
}
function buildFailureSummary(events, windowHours = 24) {
  const byCategory = {
    timeout: 0,
    "502": 0,
    auth: 0,
    validation: 0,
    mcp_error: 0,
    unknown: 0
  };
  const toolCounts = /* @__PURE__ */ new Map();
  const agentCounts = /* @__PURE__ */ new Map();
  for (const evt of events) {
    byCategory[evt.category]++;
    if (evt.affected_tool) toolCounts.set(evt.affected_tool, (toolCounts.get(evt.affected_tool) ?? 0) + 1);
    if (evt.affected_agent) agentCounts.set(evt.affected_agent, (agentCounts.get(evt.affected_agent) ?? 0) + 1);
  }
  const topTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tool, count]) => ({ tool, count }));
  const topAgents = [...agentCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([agent, count]) => ({ agent, count }));
  return {
    $id: `failure-summary:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`,
    total_failures: events.length,
    by_category: byCategory,
    top_tools: topTools,
    top_agents: topAgents,
    recent: events.slice(-20),
    harvested_at: (/* @__PURE__ */ new Date()).toISOString(),
    window_hours: windowHours
  };
}
async function runFailureHarvest(windowHours = 24) {
  const events = await harvestFailures(windowHours);
  const persisted = await persistToGraph(events);
  const summary = buildFailureSummary(events, windowHours);
  const redis2 = getRedis();
  if (redis2) {
    await redis2.set("orchestrator:failure-summary", JSON.stringify(summary), "EX", 3600).catch(() => {
    });
  }
  broadcastSSE("failure-harvest", summary);
  logger.info({
    total: events.length,
    persisted,
    categories: summary.by_category
  }, "Failure harvest cycle complete");
  return summary;
}

// src/competitive-crawler.ts
init_redis();
init_mcp_caller();
init_llm_proxy();
init_logger();
init_sse();
import { v4 as uuid16 } from "uuid";
var COMPETITOR_TARGETS = [
  {
    name: "Palantir AIP",
    slug: "palantir",
    urls: [
      "https://www.palantir.com/docs/foundry/api/",
      "https://www.palantir.com/platforms/aip/"
    ]
  },
  {
    name: "Dust.tt",
    slug: "dust",
    urls: [
      "https://docs.dust.tt/",
      "https://dust.tt/changelog"
    ]
  },
  {
    name: "Glean",
    slug: "glean",
    urls: [
      "https://developers.glean.com/docs/overview",
      "https://www.glean.com/product"
    ]
  },
  {
    name: "LangGraph",
    slug: "langgraph",
    urls: [
      "https://langchain-ai.github.io/langgraph/concepts/",
      "https://langchain-ai.github.io/langgraph/how-tos/"
    ]
  },
  {
    name: "Copilot Studio",
    slug: "copilot-studio",
    urls: [
      "https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio"
    ]
  }
];
async function fetchPageText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "WidgeTDC-Research/1.0 (competitive analysis; public docs only)",
      "Accept": "text/html,application/json,text/plain"
    },
    signal: AbortSignal.timeout(15e3),
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (contentType.includes("html")) {
    return raw.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "").replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "").replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").replace(/&[a-z]+;/gi, " ").trim().slice(0, 15e3);
  }
  return raw.slice(0, 15e3);
}
var EXTRACTION_PROMPT = `You are a competitive intelligence analyst. Given web page content from a competitor, extract specific technical capabilities they offer.

Rules:
- List ONLY capabilities explicitly mentioned in the content
- Each capability must be a specific, concrete feature (not marketing fluff)
- Focus on: APIs, agent/orchestration features, AI/LLM capabilities, security, knowledge management, integrations
- Return as a bulleted list, one capability per line, starting with "- "
- Maximum 20 capabilities per page
- If the page has no relevant technical content, return "NO_CAPABILITIES_FOUND"

Competitor: {competitor}
URL: {url}
Page content:
{content}`;
async function extractCapabilities(target) {
  const capabilities = [];
  for (const url of target.urls) {
    try {
      logger.info({ competitor: target.name, url }, "Fetching competitor page");
      const pageText = await fetchPageText(url);
      if (pageText.length < 100) {
        logger.warn({ competitor: target.name, url, length: pageText.length }, "Page too short \u2014 skipping");
        continue;
      }
      const prompt = EXTRACTION_PROMPT.replace("{competitor}", target.name).replace("{url}", url).replace("{content}", pageText.slice(0, 12e3));
      const llmResult = await chatLLM({
        provider: "deepseek",
        // cheap + fast for extraction
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1500
      });
      if (!llmResult.content || llmResult.content.includes("NO_CAPABILITIES_FOUND")) {
        logger.info({ competitor: target.name, url }, "No capabilities found on page");
        continue;
      }
      const lines = llmResult.content.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"));
      for (const line of lines.slice(0, 20)) {
        const cap = line.replace(/^[\s\-\*]+/, "").trim();
        if (cap.length > 10 && cap.length < 200) {
          capabilities.push({
            $id: `capability:${target.slug}:${uuid16().slice(0, 8)}`,
            competitor: target.name,
            capability: cap,
            category: categorizeCapability(cap),
            evidence_url: url,
            extracted_at: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
      logger.info({ competitor: target.name, url, capabilities: lines.length }, "Extracted capabilities from page");
    } catch (err) {
      logger.warn({ competitor: target.name, url, err: String(err) }, "Capability extraction failed for URL");
    }
  }
  return capabilities;
}
function categorizeCapability(cap) {
  const lower = cap.toLowerCase();
  if (lower.includes("api") || lower.includes("endpoint") || lower.includes("rest") || lower.includes("graphql")) return "api";
  if (lower.includes("agent") || lower.includes("orchestrat") || lower.includes("workflow")) return "orchestration";
  if (lower.includes("rag") || lower.includes("search") || lower.includes("retrieval") || lower.includes("knowledge")) return "knowledge";
  if (lower.includes("security") || lower.includes("auth") || lower.includes("compliance") || lower.includes("rbac")) return "security";
  if (lower.includes("llm") || lower.includes("model") || lower.includes("ai") || lower.includes("inference")) return "ai";
  if (lower.includes("deploy") || lower.includes("scale") || lower.includes("monitor")) return "platform";
  return "general";
}
async function persistCapabilities(capabilities) {
  let persisted = 0;
  for (const cap of capabilities) {
    try {
      await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `
            MERGE (c:CompetitorCapability {competitor: $competitor, capability: $capability})
            SET c.category = $category,
                c.evidence_url = $evidence_url,
                c.extracted_at = datetime($extracted_at),
                c.updated_at = datetime()
            MERGE (comp:Competitor {name: $competitor})
            MERGE (comp)-[:HAS_CAPABILITY]->(c)
          `,
          params: {
            competitor: cap.competitor,
            capability: cap.capability,
            category: cap.category,
            evidence_url: cap.evidence_url,
            extracted_at: cap.extracted_at
          }
        },
        callId: uuid16(),
        timeoutMs: 1e4
      });
      persisted++;
    } catch (err) {
      logger.warn({ err: String(err), competitor: cap.competitor }, "Failed to persist capability");
    }
  }
  return persisted;
}
async function analyzeGaps(capabilities) {
  const byCompetitor = {};
  const capMap = /* @__PURE__ */ new Map();
  for (const cap of capabilities) {
    byCompetitor[cap.competitor] = (byCompetitor[cap.competitor] ?? 0) + 1;
    const existing = capMap.get(cap.capability) ?? [];
    existing.push(cap.competitor);
    capMap.set(cap.capability, existing);
  }
  let widgetdcTools = [];
  try {
    const result = await callMcpTool({
      toolName: "graph.read_cypher",
      args: { query: "MATCH (t:Tool) RETURN t.name AS name LIMIT 200" },
      callId: uuid16(),
      timeoutMs: 1e4
    });
    if (result.status === "success") {
      const data = result.result;
      widgetdcTools = (data?.results ?? []).map((r) => r.name.toLowerCase());
    }
  } catch {
  }
  const gaps = [];
  for (const [capability, competitors] of capMap.entries()) {
    const hasIt = widgetdcTools.some(
      (t) => capability.toLowerCase().includes(t) || t.includes(capability.toLowerCase().slice(0, 15))
    );
    if (!hasIt && competitors.length >= 2) {
      gaps.push({
        capability,
        competitors_with: competitors,
        widgetdc_has: false
      });
    }
  }
  const strengths = [
    "Triple-Protocol ABI (REST + MCP + OpenAPI)",
    "Mercury Folding (context compression)",
    "Neo4j Knowledge Graph with 17 domains",
    "Self-correcting graph agent",
    "Multi-agent chain engine (5 modes)"
  ];
  return {
    $id: `gap-report:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`,
    total_capabilities_found: capabilities.length,
    by_competitor: byCompetitor,
    gaps: gaps.slice(0, 30),
    strengths,
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function runCompetitiveCrawl() {
  logger.info("Starting competitive phagocytosis crawl");
  const allCapabilities = [];
  for (const target of COMPETITOR_TARGETS) {
    const caps = await extractCapabilities(target);
    allCapabilities.push(...caps);
    logger.info({ competitor: target.name, capabilities: caps.length }, "Extracted capabilities");
  }
  const persisted = await persistCapabilities(allCapabilities);
  const report = await analyzeGaps(allCapabilities);
  const redis2 = getRedis();
  if (redis2 && allCapabilities.length > 0) {
    await redis2.set("orchestrator:competitive-report", JSON.stringify(report), "EX", 604800).catch(() => {
    });
  } else if (redis2 && allCapabilities.length === 0) {
    logger.warn("Competitive crawl returned zero capabilities \u2014 not caching empty report");
  }
  broadcastSSE("competitive-report", report);
  logger.info({
    total_capabilities: allCapabilities.length,
    persisted,
    gaps: report.gaps.length
  }, "Competitive phagocytosis crawl complete");
  return report;
}

// src/routes/adoption.ts
init_redis();
init_logger();
init_mcp_caller();
import { Router as Router6 } from "express";
import { v4 as uuid17 } from "uuid";
var adoptionRouter = Router6();
var REDIS_KEY3 = "orchestrator:adoption-metrics";
var REDIS_TRENDS_KEY = "orchestrator:adoption-trends";
var DEFAULT_METRICS = {
  features_done: 14,
  features_total: 54,
  features_pct: 25.9,
  milestones: {
    M0: { status: "complete", tasks: 3, done: 3 },
    M1: { status: "complete", tasks: 8, done: 8 },
    M2: { status: "in_progress", tasks: 6, done: 6 },
    M3: { status: "in_progress", tasks: 6, done: 0 },
    M4: { status: "pending", tasks: 31, done: 0 }
  },
  assistants: 5,
  pipelines: 3,
  obsidian_views: 3
};
adoptionRouter.get("/metrics", async (_req, res) => {
  const redis2 = getRedis();
  if (redis2) {
    try {
      const cached = await redis2.get(REDIS_KEY3);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Redis read failed for adoption metrics");
    }
  }
  const metrics2 = {
    ...DEFAULT_METRICS,
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (redis2) {
    try {
      await redis2.set(REDIS_KEY3, JSON.stringify(metrics2));
    } catch (err) {
      logger.warn({ err: String(err) }, "Redis write failed for adoption metrics");
    }
  }
  res.json(metrics2);
});
adoptionRouter.put("/metrics", async (req, res) => {
  const redis2 = getRedis();
  const body = req.body;
  let current = { ...DEFAULT_METRICS, generated_at: (/* @__PURE__ */ new Date()).toISOString() };
  if (redis2) {
    try {
      const cached = await redis2.get(REDIS_KEY3);
      if (cached) current = JSON.parse(cached);
    } catch (err) {
      logger.warn({ err: String(err) }, "Redis read failed during adoption metrics update");
    }
  }
  if (typeof body.features_done === "number") current.features_done = body.features_done;
  if (typeof body.features_total === "number") current.features_total = body.features_total;
  if (typeof body.assistants === "number") current.assistants = body.assistants;
  if (typeof body.pipelines === "number") current.pipelines = body.pipelines;
  if (typeof body.obsidian_views === "number") current.obsidian_views = body.obsidian_views;
  if (body.milestones && typeof body.milestones === "object") {
    current.milestones = { ...current.milestones, ...body.milestones };
  }
  current.features_pct = current.features_total > 0 ? Math.round(current.features_done / current.features_total * 1e3) / 10 : 0;
  current.generated_at = (/* @__PURE__ */ new Date()).toISOString();
  if (redis2) {
    try {
      await redis2.set(REDIS_KEY3, JSON.stringify(current));
    } catch (err) {
      logger.warn({ err: String(err) }, "Redis write failed for adoption metrics update");
      res.status(500).json({ success: false, error: "Failed to persist metrics" });
      return;
    }
  }
  res.json({ success: true, metrics: current });
});
async function captureAdoptionSnapshot() {
  const redis2 = getRedis();
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const [conversationsResult, artifactsResult, toolCallsResult] = await Promise.allSettled([
    // Count conversations from last 24h via graph
    callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: "MATCH (c:Conversation) WHERE c.createdAt > datetime() - duration('P1D') RETURN count(c) AS count"
      },
      callId: uuid17(),
      timeoutMs: 1e4
    }),
    // Count artifacts from last 24h
    callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: "MATCH (a:AnalysisArtifact) WHERE a.createdAt > datetime() - duration('P1D') RETURN count(a) AS count"
      },
      callId: uuid17(),
      timeoutMs: 1e4
    }),
    // Count tool calls from audit trail
    callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: "MATCH (e:AuditEvent) WHERE e.timestamp > datetime() - duration('P1D') AND e.action = 'tool_call' RETURN count(e) AS count"
      },
      callId: uuid17(),
      timeoutMs: 1e4
    })
  ]);
  const extractCount = (r) => {
    if (r.status !== "fulfilled") return 0;
    const result = r.value?.result;
    if (Array.isArray(result) && result[0]?.count != null) return Number(result[0].count);
    if (result?.count != null) return Number(result.count);
    return 0;
  };
  let current = { ...DEFAULT_METRICS, generated_at: (/* @__PURE__ */ new Date()).toISOString() };
  if (redis2) {
    try {
      const cached = await redis2.get(REDIS_KEY3);
      if (cached) current = JSON.parse(cached);
    } catch {
    }
  }
  let pipelineExecs = 0;
  let chainExecs = 0;
  let uniqueAgents = 0;
  if (redis2) {
    try {
      const chainData = await redis2.hgetall("orchestrator:chains");
      const oneDayAgo = Date.now() - 864e5;
      for (const val of Object.values(chainData)) {
        try {
          const exec = JSON.parse(val);
          if (new Date(exec.started_at).getTime() > oneDayAgo) {
            chainExecs++;
            if (exec.name?.toLowerCase().includes("pipeline") || exec.name?.toLowerCase().includes("knowledge")) {
              pipelineExecs++;
            }
          }
        } catch {
        }
      }
      const agentData = await redis2.hgetall("orchestrator:agents");
      const activeAgents = /* @__PURE__ */ new Set();
      for (const val of Object.values(agentData)) {
        try {
          const agent = JSON.parse(val);
          if (new Date(agent.lastSeenAt).getTime() > oneDayAgo) {
            activeAgents.add(agent.agent_id ?? agent.handshake?.agent_id);
          }
        } catch {
        }
      }
      uniqueAgents = activeAgents.size;
    } catch (err) {
      logger.warn({ err: String(err) }, "Failed to collect Redis adoption metrics");
    }
  }
  const snapshot = {
    date: today,
    captured_at: (/* @__PURE__ */ new Date()).toISOString(),
    conversations_24h: extractCount(conversationsResult),
    pipeline_executions_24h: pipelineExecs,
    artifact_creations_24h: extractCount(artifactsResult),
    unique_agents_24h: uniqueAgents,
    total_tool_calls_24h: extractCount(toolCallsResult),
    chain_executions_24h: chainExecs,
    features_done: current.features_done,
    features_pct: current.features_pct
  };
  if (redis2) {
    try {
      const score = new Date(today).getTime();
      await redis2.zadd(REDIS_TRENDS_KEY, score, JSON.stringify(snapshot));
      const totalEntries = await redis2.zcard(REDIS_TRENDS_KEY);
      if (totalEntries > 90) {
        await redis2.zremrangebyrank(REDIS_TRENDS_KEY, 0, totalEntries - 91);
      }
      logger.info({ date: today, snapshot }, "Adoption snapshot captured");
    } catch (err) {
      logger.warn({ err: String(err) }, "Failed to persist adoption snapshot");
    }
  }
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MERGE (m:AdoptionMetric {date: $date})
SET m.conversations_24h = $conversations,
    m.pipeline_executions_24h = $pipelines,
    m.artifact_creations_24h = $artifacts,
    m.unique_agents_24h = $agents,
    m.total_tool_calls_24h = $toolCalls,
    m.chain_executions_24h = $chains,
    m.features_done = $featuresDone,
    m.features_pct = $featuresPct,
    m.captured_at = datetime()`,
        params: {
          date: today,
          conversations: snapshot.conversations_24h,
          pipelines: snapshot.pipeline_executions_24h,
          artifacts: snapshot.artifact_creations_24h,
          agents: snapshot.unique_agents_24h,
          toolCalls: snapshot.total_tool_calls_24h,
          chains: snapshot.chain_executions_24h,
          featuresDone: snapshot.features_done,
          featuresPct: snapshot.features_pct
        }
      },
      callId: uuid17(),
      timeoutMs: 1e4
    });
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to write adoption snapshot to Neo4j");
  }
  return snapshot;
}
adoptionRouter.post("/snapshot", async (_req, res) => {
  try {
    const snapshot = await captureAdoptionSnapshot();
    res.json({ success: true, data: snapshot });
  } catch (err) {
    logger.error({ err: String(err) }, "Adoption snapshot capture failed");
    res.status(500).json({
      success: false,
      error: { code: "SNAPSHOT_ERROR", message: String(err), status_code: 500 }
    });
  }
});
adoptionRouter.get("/trends", async (req, res) => {
  const redis2 = getRedis();
  const days = Math.min(parseInt(String(req.query.days ?? "30"), 10) || 30, 90);
  if (!redis2) {
    res.json({ success: true, data: { trends: [], days, source: "none" } });
    return;
  }
  try {
    const cutoff = Date.now() - days * 864e5;
    const raw = await redis2.zrangebyscore(REDIS_TRENDS_KEY, cutoff, "+inf");
    const trends = raw.map((r) => JSON.parse(r));
    res.json({ success: true, data: { trends, days, total: trends.length } });
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to read adoption trends");
    res.status(500).json({
      success: false,
      error: { code: "TRENDS_ERROR", message: String(err), status_code: 500 }
    });
  }
});

// src/routes/loose-ends.ts
init_redis();
init_logger();
init_mcp_caller();
init_sse();
import { Router as Router7 } from "express";
import { v4 as uuid18 } from "uuid";
var looseEndsRouter = Router7();
var REDIS_KEY4 = "orchestrator:loose-ends:latest";
var REDIS_HISTORY = "orchestrator:loose-ends:history";
var DETECTION_QUERIES = [
  {
    name: "Orphan Blocks (no assembly)",
    category: "orphan_block",
    severity: "warning",
    cypher: `MATCH (b) WHERE (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
AND NOT (b)<-[:COMPOSED_OF]-(:Assembly)
RETURN b.id AS id, b.name AS name, b.domain AS domain, labels(b)[0] AS type
LIMIT 25`,
    buildFinding: (records) => records.map((r) => ({
      id: `orphan-${r.id ?? uuid18().slice(0, 8)}`,
      severity: "warning",
      category: "orphan_block",
      title: `Orphan block: ${r.name ?? r.id}`,
      description: `Block "${r.name}" (${r.type}, domain: ${r.domain}) is not part of any assembly`,
      node_ids: [String(r.id)],
      suggested_action: "Include in an assembly via POST /api/assembly/compose or archive if obsolete"
    }))
  },
  {
    name: "Assemblies without decisions",
    category: "dangling_assembly",
    severity: "warning",
    cypher: `MATCH (a:Assembly) WHERE a.status = 'accepted'
AND NOT (a)<-[:BASED_ON]-(:Decision)
RETURN a.id AS id, a.name AS name, a.composite AS score
LIMIT 15`,
    buildFinding: (records) => records.map((r) => ({
      id: `dangling-asm-${r.id ?? uuid18().slice(0, 8)}`,
      severity: "warning",
      category: "dangling_assembly",
      title: `Accepted assembly without decision: ${r.name ?? r.id}`,
      description: `Assembly "${r.name}" was accepted (score: ${r.score}) but no Decision node references it`,
      node_ids: [String(r.id)],
      suggested_action: "Create a Decision via POST /api/decisions/certify or reject the assembly"
    }))
  },
  {
    name: "Decisions without lineage",
    category: "missing_lineage",
    severity: "critical",
    cypher: `MATCH (d:Decision) WHERE NOT (d)-[:BASED_ON]->(:Assembly)
AND NOT (d)-[:DERIVES_FROM]->()
RETURN d.id AS id, d.title AS title, d.certified_at AS certified_at
LIMIT 10`,
    buildFinding: (records) => records.map((r) => ({
      id: `no-lineage-${r.id ?? uuid18().slice(0, 8)}`,
      severity: "critical",
      category: "missing_lineage",
      title: `Decision without lineage: ${r.title ?? r.id}`,
      description: `Decision "${r.title}" has no traceable lineage to assemblies or source signals`,
      node_ids: [String(r.id)],
      suggested_action: "Link decision to source assembly or re-certify with proper lineage"
    }))
  },
  {
    name: "Disconnected high-value nodes",
    category: "disconnected_node",
    severity: "info",
    cypher: `MATCH (n) WHERE (n:StrategicInsight OR n:Pattern OR n:Signal)
AND NOT (n)-[]-()
RETURN n.id AS id, labels(n)[0] AS type, n.domain AS domain, n.insight AS title
LIMIT 20`,
    buildFinding: (records) => records.map((r) => ({
      id: `disconnected-${r.id ?? uuid18().slice(0, 8)}`,
      severity: "info",
      category: "disconnected_node",
      title: `Disconnected ${r.type}: ${(r.title ?? r.id ?? "").toString().slice(0, 60)}`,
      description: `${r.type} node in domain "${r.domain}" has no relationships \u2014 may be a missed connection`,
      node_ids: [String(r.id)],
      suggested_action: "Review and connect to related blocks or mark as processed"
    }))
  },
  {
    name: "Unresolved decisions (stale drafts)",
    category: "unresolved_decision",
    severity: "warning",
    cypher: `MATCH (d:Decision) WHERE d.status = 'draft'
AND d.created_at < datetime() - duration('P7D')
RETURN d.id AS id, d.title AS title, d.created_at AS created_at
LIMIT 10`,
    buildFinding: (records) => records.map((r) => ({
      id: `stale-decision-${r.id ?? uuid18().slice(0, 8)}`,
      severity: "warning",
      category: "unresolved_decision",
      title: `Stale draft decision: ${r.title ?? r.id}`,
      description: `Decision "${r.title}" has been in draft for >7 days (created: ${r.created_at})`,
      node_ids: [String(r.id)],
      suggested_action: "Certify, reject, or archive the stale decision"
    }))
  }
];
async function runLooseEndScan() {
  const scanId = uuid18();
  const t0 = Date.now();
  const findings = [];
  logger.info({ scan_id: scanId }, "Loose-end scan started");
  const queryResults = await Promise.allSettled(
    DETECTION_QUERIES.map(async (dq) => {
      try {
        const result = await callMcpTool({
          toolName: "graph.read_cypher",
          args: { query: dq.cypher },
          callId: uuid18(),
          timeoutMs: 15e3
        });
        if (result.status !== "success") return [];
        const records = Array.isArray(result.result) ? result.result : Array.isArray(result.result?.records) ? result.result.records : [];
        return dq.buildFinding(records);
      } catch (err) {
        logger.warn({ query: dq.name, err: String(err) }, "Loose-end detection query failed");
        return [];
      }
    })
  );
  for (const qr of queryResults) {
    if (qr.status === "fulfilled") {
      findings.push(...qr.value);
    }
  }
  const summary = {
    critical: findings.filter((f) => f.severity === "critical").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    total: findings.length
  };
  const scanResult = {
    scan_id: scanId,
    scanned_at: (/* @__PURE__ */ new Date()).toISOString(),
    duration_ms: Date.now() - t0,
    findings,
    summary,
    auto_fixed: 0
  };
  const redis2 = getRedis();
  if (redis2) {
    try {
      await redis2.set(REDIS_KEY4, JSON.stringify(scanResult), "EX", 86400);
      await redis2.zadd(REDIS_HISTORY, Date.now(), JSON.stringify(scanResult));
      const count = await redis2.zcard(REDIS_HISTORY);
      if (count > 30) {
        await redis2.zremrangebyrank(REDIS_HISTORY, 0, count - 31);
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Failed to persist loose-end scan");
    }
  }
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `MERGE (s:LooseEndScan {id: $id})
SET s.scanned_at = datetime(), s.duration_ms = $duration,
    s.critical = $critical, s.warning = $warning, s.info = $info,
    s.total = $total, s.auto_fixed = 0`,
        params: {
          id: scanId,
          duration: scanResult.duration_ms,
          critical: summary.critical,
          warning: summary.warning,
          info: summary.info,
          total: summary.total
        }
      },
      callId: uuid18(),
      timeoutMs: 1e4
    });
  } catch {
  }
  broadcastSSE("loose-end-scan", {
    scan_id: scanId,
    summary,
    duration_ms: scanResult.duration_ms
  });
  logger.info({
    scan_id: scanId,
    ...summary,
    duration_ms: scanResult.duration_ms
  }, "Loose-end scan complete");
  return scanResult;
}
looseEndsRouter.post("/scan", async (_req, res) => {
  try {
    const result = await runLooseEndScan();
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err: String(err) }, "Loose-end scan failed");
    res.status(500).json({
      success: false,
      error: { code: "SCAN_ERROR", message: String(err), status_code: 500 }
    });
  }
});
looseEndsRouter.get("/", async (_req, res) => {
  const redis2 = getRedis();
  if (!redis2) {
    res.json({ success: true, data: null, message: "No scan results available" });
    return;
  }
  try {
    const raw = await redis2.get(REDIS_KEY4);
    if (!raw) {
      res.json({ success: true, data: null, message: "No scan has been run yet" });
      return;
    }
    res.json({ success: true, data: JSON.parse(raw) });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});
looseEndsRouter.get("/history", async (req, res) => {
  const redis2 = getRedis();
  const limit = Math.min(parseInt(String(req.query.limit ?? "10")), 30);
  if (!redis2) {
    res.json({ success: true, data: { scans: [], total: 0 } });
    return;
  }
  try {
    const raw = await redis2.zrevrange(REDIS_HISTORY, 0, limit - 1);
    const scans = raw.map((r) => {
      const parsed = JSON.parse(r);
      return {
        scan_id: parsed.scan_id,
        scanned_at: parsed.scanned_at,
        duration_ms: parsed.duration_ms,
        summary: parsed.summary,
        auto_fixed: parsed.auto_fixed
      };
    });
    res.json({ success: true, data: { scans, total: scans.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// src/cron-scheduler.ts
init_slack();
init_graph_hygiene_cron();
init_hierarchical_intelligence();
init_adaptive_rag();
var jobs = /* @__PURE__ */ new Map();
var cronTasks = /* @__PURE__ */ new Map();
var REDIS_CRON_KEY = "orchestrator:cron-jobs";
function registerCronJob(job) {
  if (!cron.validate(job.schedule)) {
    throw new Error(`Invalid cron schedule: ${job.schedule}`);
  }
  const existing = cronTasks.get(job.id);
  if (existing) existing.stop();
  const cronJob = { ...job, run_count: 0 };
  jobs.set(job.id, cronJob);
  if (job.enabled) {
    const task = cron.schedule(job.schedule, async () => {
      await runCronJob(job.id);
    });
    cronTasks.set(job.id, task);
  }
  persistCronJobs();
  logger.info({ id: job.id, schedule: job.schedule, enabled: job.enabled }, "Cron job registered");
}
async function runCronJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) {
    logger.warn({ id: jobId }, "Cron job not found");
    return;
  }
  logger.info({ id: job.id, name: job.name }, "Cron job triggered");
  broadcastMessage({
    from: "Orchestrator",
    to: "All",
    source: "orchestrator",
    type: "Message",
    message: `Cron "${job.name}" triggered (${job.schedule})`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  try {
    if (job.id === "adoption-metrics-daily") {
      try {
        const snapshot = await captureAdoptionSnapshot();
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "completed";
        job.run_count++;
        persistCronJobs();
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `Adoption snapshot: ${snapshot.conversations_24h} conversations, ${snapshot.pipeline_executions_24h} pipelines, ${snapshot.artifact_creations_24h} artifacts, ${snapshot.unique_agents_24h} agents active`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        broadcastSSE("adoption-snapshot", snapshot);
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Adoption snapshot failed");
      }
      return;
    }
    if (job.id === "adoption-weekly-digest") {
      try {
        const redis2 = getRedis();
        if (redis2) {
          const weekAgo = Date.now() - 7 * 864e5;
          const raw = await redis2.zrangebyscore("orchestrator:adoption-trends", weekAgo, "+inf");
          const snapshots = raw.map((r) => JSON.parse(r));
          if (snapshots.length > 0) {
            const sum = (fn) => snapshots.reduce((a, s) => a + fn(s), 0);
            const latest = snapshots[snapshots.length - 1];
            const earliest = snapshots[0];
            const trend = latest.features_pct > earliest.features_pct ? "up" : latest.features_pct < earliest.features_pct ? "down" : "flat";
            const period = `${earliest.date} \u2192 ${latest.date}`;
            notifyAdoptionDigest({
              period,
              conversations: sum((s) => s.conversations_24h),
              pipelines: sum((s) => s.pipeline_executions_24h),
              artifacts: sum((s) => s.artifact_creations_24h),
              agents: Math.max(...snapshots.map((s) => s.unique_agents_24h)),
              toolCalls: sum((s) => s.total_tool_calls_24h),
              chains: sum((s) => s.chain_executions_24h),
              featuresPct: latest.features_pct,
              trend
            });
          }
        }
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "completed";
        job.run_count++;
        persistCronJobs();
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Adoption weekly digest failed");
      }
      return;
    }
    if (job.id === "loose-end-daily-scan") {
      try {
        const scanResult = await runLooseEndScan();
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = scanResult.summary.critical > 0 ? "critical" : "completed";
        job.run_count++;
        persistCronJobs();
        const emoji = scanResult.summary.critical > 0 ? "\u{1F534}" : scanResult.summary.warning > 0 ? "\u{1F7E1}" : "\u{1F7E2}";
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `${emoji} Loose-end scan: ${scanResult.summary.critical} critical, ${scanResult.summary.warning} warnings, ${scanResult.summary.info} info (${scanResult.duration_ms}ms)`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Loose-end scan failed");
      }
      return;
    }
    if (job.id === "failure-harvester") {
      try {
        const summary = await runFailureHarvest(24);
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = summary.total_failures > 0 ? `${summary.total_failures} failures` : "clean";
        job.run_count++;
        persistCronJobs();
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `Red Queen harvest: ${summary.total_failures} failures (${Object.entries(summary.by_category).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(", ") || "none"})`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Failure harvest cron failed");
      }
      return;
    }
    if (job.id === "competitive-crawl") {
      try {
        const report = await runCompetitiveCrawl();
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = `${report.total_capabilities_found} caps, ${report.gaps.length} gaps`;
        job.run_count++;
        persistCronJobs();
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `Phagocytosis: ${report.total_capabilities_found} capabilities from ${Object.keys(report.by_competitor).length} competitors, ${report.gaps.length} gaps identified`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Competitive crawl cron failed");
      }
      return;
    }
    if (job.id === "graph-hygiene-daily") {
      try {
        const result2 = await runGraphHygiene();
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = result2.alerts.length > 0 ? `${result2.alerts.length} alerts` : "healthy";
        job.run_count++;
        persistCronJobs();
        const status = result2.alerts.length > 0 ? "\u{1F534}" : "\u{1F7E2}";
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `${status} Graph hygiene: orphans=${(result2.metrics.orphan_ratio * 100).toFixed(1)}%, domains=${result2.metrics.domain_count}, pollution=${result2.metrics.pollution_count}, ${result2.alerts.length} alerts (${result2.duration_ms}ms)`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        broadcastSSE("graph-hygiene", result2);
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Graph hygiene cron failed");
      }
      return;
    }
    if (job.id === "adaptive-rag-retrain") {
      try {
        const result2 = await retrainRoutingWeights();
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = `${result2.adjustments.length} adjustments, ${result2.weights.training_samples} samples`;
        job.run_count++;
        persistCronJobs();
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `Adaptive RAG retrained: ${result2.adjustments.length} adjustments from ${result2.weights.training_samples} samples. ${result2.adjustments.join("; ") || "No changes needed."}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Adaptive RAG retrain cron failed");
      }
      return;
    }
    if (job.id === "community-builder-weekly") {
      try {
        const result2 = await buildCommunitySummaries();
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = `${result2.communities_created} communities, ${result2.summaries_generated} summaries`;
        job.run_count++;
        persistCronJobs();
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `Hierarchical Intelligence: ${result2.communities_created} communities, ${result2.summaries_generated} summaries, ${result2.relationships_created} rels (${result2.method}, ${result2.duration_ms}ms)`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Community builder cron failed");
      }
      return;
    }
    if (job.id === "graph-self-correct") {
      const report = await runSelfCorrect();
      job.last_run = (/* @__PURE__ */ new Date()).toISOString();
      job.last_status = report.total_fixed > 0 ? "corrected" : "clean";
      job.run_count++;
      persistCronJobs();
      broadcastMessage({
        from: "Orchestrator",
        to: "All",
        source: "orchestrator",
        type: "Message",
        message: `Self-correct: found ${report.total_found} issues, fixed ${report.total_fixed} (${report.duration_ms}ms)`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return;
    }
    if (job.id === "osint-daily-scan") {
      try {
        const { runOsintScan: runOsintScan2 } = await Promise.resolve().then(() => (init_osint_scanner(), osint_scanner_exports));
        const scanResult = await runOsintScan2();
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = scanResult.errors.length === 0 ? "completed" : "partial";
        job.run_count++;
        persistCronJobs();
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `OSINT scan: ${scanResult.domains_scanned} domains, ${scanResult.ct_entries} CT + ${scanResult.dmarc_results} DMARC, ${scanResult.total_new_nodes} new nodes (${scanResult.tools_available ? "live" : "fallback"}, ${scanResult.duration_ms}ms)`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        broadcastSSE("osint-scan", { scan_id: scanResult.scan_id, domains: scanResult.domains_scanned, nodes: scanResult.total_new_nodes });
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "OSINT scan cron failed");
      }
      return;
    }
    if (job.id === "evolution-loop") {
      try {
        const { runEvolutionLoop: runEvolutionLoop2 } = await Promise.resolve().then(() => (init_evolution_loop(), evolution_loop_exports));
        const cycle = await runEvolutionLoop2();
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = cycle.status;
        job.run_count++;
        persistCronJobs();
        broadcastMessage({
          from: "Orchestrator",
          to: "All",
          source: "orchestrator",
          type: "Message",
          message: `Evolution OODA cycle ${cycle.status}: ${cycle.summary} (${cycle.duration_ms}ms)`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        broadcastSSE("evolution-cycle", cycle);
      } catch (err) {
        job.last_run = (/* @__PURE__ */ new Date()).toISOString();
        job.last_status = "failed";
        job.run_count++;
        persistCronJobs();
        logger.error({ id: job.id, err: String(err) }, "Evolution loop cron failed");
      }
      return;
    }
    const result = await executeChain(job.chain);
    job.last_run = (/* @__PURE__ */ new Date()).toISOString();
    job.last_status = result.status;
    job.run_count++;
    persistCronJobs();
    if (job.id === "daily-knowledge-feed" && result.status === "completed") {
      const feed = {
        generated_at: (/* @__PURE__ */ new Date()).toISOString(),
        execution_id: result.execution_id,
        steps: result.results.map((r) => ({
          step: r.step_id,
          action: r.action,
          status: r.status,
          output: r.output,
          duration_ms: r.duration_ms
        })),
        graph_pulse: result.results[0]?.output ?? null,
        gap_analysis: result.results[1]?.output ?? null,
        emerging_clusters: result.results[2]?.output ?? null
      };
      const redis2 = getRedis();
      if (redis2) {
        await redis2.set("orchestrator:knowledge-feed", JSON.stringify(feed), "EX", 86400);
        const briefing = buildKnowledgeBriefing(feed);
        await redis2.set("orchestrator:knowledge-briefing-prompt", briefing, "EX", 86400);
        logger.info("Knowledge briefing prompt cached for Open WebUI");
      }
      broadcastSSE("knowledge-feed", feed);
      logger.info({ execution_id: result.execution_id }, "Daily knowledge feed cached and broadcast");
    }
  } catch (err) {
    job.last_run = (/* @__PURE__ */ new Date()).toISOString();
    job.last_status = "failed";
    job.run_count++;
    persistCronJobs();
    logger.error({ id: job.id, err: String(err) }, "Cron job failed");
  }
}
function setCronJobEnabled(jobId, enabled) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.enabled = enabled;
  const existing = cronTasks.get(jobId);
  if (existing) existing.stop();
  if (enabled) {
    const task = cron.schedule(job.schedule, async () => {
      await runCronJob(jobId);
    });
    cronTasks.set(jobId, task);
  } else {
    cronTasks.delete(jobId);
  }
  persistCronJobs();
  logger.info({ id: jobId, enabled }, "Cron job toggled");
  return true;
}
function listCronJobs() {
  return Array.from(jobs.values());
}
function deleteCronJob(jobId) {
  const task = cronTasks.get(jobId);
  if (task) task.stop();
  cronTasks.delete(jobId);
  const deleted = jobs.delete(jobId);
  if (deleted) persistCronJobs();
  return deleted;
}
function persistCronJobs() {
  const redis2 = getRedis();
  if (!redis2) return;
  const data = Array.from(jobs.values()).map((j) => ({
    ...j
    // Don't persist the chain's runtime state, just config
  }));
  redis2.set(REDIS_CRON_KEY, JSON.stringify(data)).catch(() => {
  });
}
async function hydrateCronJobs() {
  const redis2 = getRedis();
  if (!redis2) return;
  try {
    const raw = await redis2.get(REDIS_CRON_KEY);
    if (!raw) return;
    const savedJobs = JSON.parse(raw);
    for (const job of savedJobs) {
      registerCronJob(job);
    }
    logger.info({ count: savedJobs.length }, "Hydrated cron jobs from Redis");
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to hydrate cron jobs");
  }
}
function buildKnowledgeBriefing(feed) {
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  let newToday = 0;
  let totalDomains = 0;
  const pulse = feed.graph_pulse;
  if (pulse) {
    const dist = pulse.label_distribution;
    if (dist) {
      totalDomains = Object.keys(dist).length;
      newToday = Object.values(dist).reduce((a, b) => a + b, 0);
    }
  }
  const insights = Array.isArray(feed.top_insights) ? feed.top_insights : [];
  const topInsights = insights.slice(0, 3).map((c) => String(c.title ?? c.summary ?? "").slice(0, 60)).filter(Boolean);
  const gaps = Array.isArray(feed.gap_alerts) ? feed.gap_alerts : [];
  const topGaps = gaps.slice(0, 2).map((c) => String(c.title ?? c.summary ?? "").slice(0, 60)).filter(Boolean);
  const lines = [
    `Daily Knowledge Briefing (${date}):`,
    `- Graph: ${newToday} nodes across ${totalDomains} active domains`
  ];
  if (topInsights.length > 0) {
    lines.push(`- Top insights: ${topInsights.join("; ")}`);
  }
  if (topGaps.length > 0) {
    lines.push(`- Gaps: ${topGaps.join("; ")}`);
  }
  lines.push("Use search_knowledge for details.");
  let result = lines.join("\n");
  if (result.length > 500) {
    result = result.slice(0, 497) + "...";
  }
  return result;
}
function registerDefaultLoops() {
  registerCronJob({
    id: "health-pulse",
    name: "Platform Health Pulse",
    schedule: "*/5 * * * *",
    enabled: true,
    chain: {
      name: "Health Pulse",
      mode: "parallel",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "graph.stats",
          arguments: {}
        }
      ]
    }
  });
  registerCronJob({
    id: "graph-check",
    name: "Neo4j Graph Consistency",
    schedule: "*/30 * * * *",
    enabled: false,
    // disabled by default — enable via API
    chain: {
      name: "Graph Consistency",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "graph.read_cypher",
          arguments: {
            query: "MATCH (n) RETURN labels(n) AS label, count(*) AS count ORDER BY count DESC LIMIT 20"
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "failure-digest",
    name: "FailureMemory Digest",
    schedule: "0 */6 * * *",
    enabled: true,
    chain: {
      name: "Failure Digest",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "graph.read_cypher",
          arguments: {
            query: "MATCH (f:FailureMemory) WHERE f.last_seen > datetime() - duration('PT6H') OR f.created_at > datetime() - duration('PT6H') RETURN f.category AS category, f.pattern AS pattern, f.hit_count AS hits, f.resolution AS resolution ORDER BY f.hit_count DESC LIMIT 10"
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "adaptive-rag-retrain",
    name: "Adaptive RAG Weight Retraining",
    schedule: "0 5 * * 1",
    // Monday 05:00 UTC
    enabled: true,
    chain: {
      name: "Adaptive RAG Retrain",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "community-builder-weekly",
    name: "Hierarchical Community Summaries",
    schedule: "0 3 * * 0",
    // Sunday 03:00 UTC
    enabled: true,
    chain: {
      name: "Community Builder",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "graph-hygiene-daily",
    name: "Graph Hygiene Health Check",
    schedule: "0 4 * * *",
    enabled: true,
    chain: {
      name: "Graph Hygiene",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "graph-self-correct",
    name: "Self-Correcting Graph Agent",
    schedule: "0 */2 * * *",
    enabled: true,
    chain: {
      name: "Graph Self-Correct",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "graph.read_cypher",
          arguments: {
            query: "MATCH (n) WHERE NOT (n)-[]-() AND NOT n:TDCDocument RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC LIMIT 10"
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "cia-guardian",
    name: "CIA Guardian (Autonomous Remediation)",
    schedule: "*/10 * * * *",
    enabled: true,
    chain: {
      name: "CIA Health Scan",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "srag.query",
          arguments: {
            query: "Scan fleet health: identify CRITICAL domains, agent failures, unhealthy services, and remediation priorities"
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "dynamic-watchtower",
    name: "Intelligence Watchtower (Multi-Domain)",
    schedule: "0 */4 * * *",
    // Every 4 hours
    enabled: true,
    chain: {
      name: "Dynamic Intelligence Pipeline",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "srag.query",
          arguments: {
            query: "Intelligence watchtower: query WatchDefinition nodes, find new signals across public IT, vendors, tenders domains, cross-reference with existing IntelligenceAssets"
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "evolution-tracker",
    name: "Evolution Event Tracker (DEPRECATED \u2014 see LIN-380)",
    schedule: "0 * * * *",
    enabled: false,
    chain: {
      name: "Evolution Tracker",
      mode: "parallel",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "graph.read_cypher",
          arguments: {
            query: "MATCH (e:EvolutionEvent) WHERE e.timestamp > datetime() - duration('PT24H') RETURN avg(toFloat(e.pass_rate)) AS avg_pass_rate, count(e) AS events_24h, max(e.timestamp) AS latest"
          }
        },
        {
          agent_id: "orchestrator",
          tool_name: "graph.read_cypher",
          arguments: {
            query: "MATCH (f:FailureMemory) RETURN count(f) AS total_failures, sum(f.hit_count) AS total_hits"
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "failure-harvester",
    name: "Red Queen Failure Harvester",
    schedule: "0 */4 * * *",
    // Every 4 hours
    enabled: true,
    chain: {
      name: "Failure Harvest",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "competitive-crawl",
    name: "Competitive Phagocytosis Crawl",
    schedule: "0 3 * * 1",
    // Monday 03:00 UTC
    enabled: true,
    chain: {
      name: "Competitive Crawl",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "osint-daily-scan",
    name: "OSINT Daily Domain Scan",
    schedule: "0 2 * * *",
    // 02:00 UTC daily
    enabled: false,
    // Enable when ready for production
    chain: {
      name: "OSINT Domain Scan",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "loose-end-daily-scan",
    name: "Loose-End Daily Scan",
    schedule: "30 7 * * *",
    // 07:30 UTC daily (after adoption snapshot)
    enabled: true,
    chain: {
      name: "Loose-End Detection",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "adoption-metrics-daily",
    name: "Adoption Metrics Daily Snapshot",
    schedule: "0 7 * * *",
    // 07:00 UTC daily
    enabled: true,
    chain: {
      name: "Adoption Metrics Snapshot",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "adoption-weekly-digest",
    name: "Adoption Weekly Slack Digest",
    schedule: "0 8 * * 1",
    // Monday 08:00 UTC
    enabled: true,
    chain: {
      name: "Adoption Weekly Digest",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
  registerCronJob({
    id: "intel-knowledge-synthesis",
    name: "Intelligence: Knowledge Synthesis",
    schedule: "*/30 * * * *",
    enabled: true,
    chain: {
      name: "Knowledge Synthesis Pipeline",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "srag.query",
          arguments: { query: "recent platform changes, new patterns, knowledge gaps" }
        },
        {
          agent_id: "orchestrator",
          tool_name: "kg_rag.query",
          arguments: { question: "What knowledge gaps exist in the consulting domain graph? What patterns are underconnected?", max_evidence: 15 }
        },
        {
          agent_id: "orchestrator",
          tool_name: "context_folding.fold",
          arguments: { task: "Synthesize knowledge from SRAG + KG-RAG into actionable insights", context: { source: "{{prev}}" }, max_tokens: 2e3, domain: "intelligence" }
        },
        {
          agent_id: "orchestrator",
          tool_name: "graph.write_cypher",
          arguments: {
            query: "MERGE (s:StrategicInsight {id: 'intel-synthesis-' + toString(datetime().epochMillis)}) SET s.domain = 'knowledge-synthesis', s.insight = $insight, s.createdAt = datetime(), s.source = 'intelligence-loop', s.confidence = 0.7",
            params: { insight: "{{prev}}" }
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "intel-graph-enrichment",
    name: "Intelligence: Graph Enrichment",
    schedule: "0 * * * *",
    enabled: true,
    chain: {
      name: "Graph Enrichment Pipeline",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "autonomous.graphrag",
          arguments: { query: "Find underconnected knowledge clusters and suggest new relationships between consulting domains, frameworks, and patterns", maxHops: 3 }
        },
        {
          agent_id: "orchestrator",
          tool_name: "graph.write_cypher",
          arguments: {
            query: "MERGE (e:EnrichmentEvent {id: 'enrich-' + toString(datetime().epochMillis)}) SET e.type = 'graph-enrichment', e.findings = $findings, e.createdAt = datetime(), e.source = 'intelligence-loop'",
            params: { findings: "{{prev}}" }
          }
        },
        {
          agent_id: "orchestrator",
          tool_name: "srag.query",
          arguments: { query: "Verify enrichment: what new connections were discovered in the last hour?" }
        }
      ]
    }
  });
  registerCronJob({
    id: "intel-roma-observer",
    name: "Intelligence: ROMA Optimization Observer",
    schedule: "0 */4 * * *",
    enabled: true,
    chain: {
      name: "ROMA Observer Pipeline",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "srag.query",
          arguments: {
            query: "Analyze platform optimization opportunities: review recent agent decisions, identify sub-optimal tool usage patterns, propose improvements for platform-wide efficiency"
          }
        },
        {
          agent_id: "orchestrator",
          tool_name: "context_folding.fold",
          arguments: { task: "Compress ROMA findings into actionable optimization report", context: { data: "{{prev}}" }, max_tokens: 1500, domain: "optimization" }
        }
      ]
    }
  });
  registerCronJob({
    id: "intel-compliance-scan",
    name: "Intelligence: Compliance Scan",
    schedule: "0 */6 * * *",
    enabled: true,
    chain: {
      name: "Compliance Scan Pipeline",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "srag.governance-check",
          arguments: { query: "Check compliance status of all active agents, tools, and recent decisions against governance policy" }
        },
        {
          agent_id: "orchestrator",
          tool_name: "audit.run",
          arguments: { agentId: "orchestrator", output: "{{prev}}" }
        }
      ]
    }
  });
  registerCronJob({
    id: "intel-harvest-cycle",
    name: "Intelligence: Knowledge Harvest",
    schedule: "0 */8 * * *",
    enabled: true,
    chain: {
      name: "Knowledge Harvest Pipeline",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "template.execute",
          arguments: { templateId: "data-enrichment", input: { scope: "recent-24h" } }
        },
        {
          agent_id: "orchestrator",
          tool_name: "srag.query",
          arguments: { query: "What new knowledge was harvested? Summarize new patterns and insights from the last 8 hours" }
        },
        {
          agent_id: "orchestrator",
          tool_name: "graph.write_cypher",
          arguments: {
            query: "MERGE (h:HarvestEvent {id: 'harvest-' + toString(datetime().epochMillis)}) SET h.type = 'knowledge-harvest', h.summary = $summary, h.createdAt = datetime(), h.source = 'intelligence-loop'",
            params: { summary: "{{prev}}" }
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "intel-metrics-snapshot",
    name: "Intelligence: Metrics Snapshot",
    schedule: "30 * * * *",
    enabled: true,
    chain: {
      name: "Metrics Snapshot Pipeline",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "metrics.summary",
          arguments: {}
        },
        {
          agent_id: "orchestrator",
          tool_name: "graph.write_cypher",
          arguments: {
            query: "MERGE (m:MetricsSnapshot {id: 'metrics-' + toString(datetime().epochMillis)}) SET m.data = $data, m.createdAt = datetime(), m.source = 'intelligence-loop'",
            params: { data: "{{prev}}" }
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "daily-knowledge-feed",
    name: "Daily Knowledge Feed",
    schedule: "0 6 * * *",
    enabled: true,
    chain: {
      name: "Daily Knowledge Feed",
      mode: "sequential",
      steps: [
        {
          agent_id: "orchestrator",
          tool_name: "graph.read_cypher",
          arguments: {
            query: "MATCH (n) WHERE n.createdAt > datetime() - duration('P1D') RETURN labels(n)[0] AS type, count(*) AS new_today ORDER BY new_today DESC"
          }
        },
        {
          agent_id: "orchestrator",
          tool_name: "kg_rag.query",
          arguments: {
            question: "What knowledge gaps exist across all 17 domains?"
          }
        },
        {
          agent_id: "orchestrator",
          tool_name: "graph.read_cypher",
          arguments: {
            query: "MATCH (n) WHERE n.updatedAt > datetime() - duration('P7D') WITH labels(n)[0] AS type, count(*) AS count WHERE count > 10 RETURN type, count ORDER BY count DESC LIMIT 10"
          }
        }
      ]
    }
  });
  registerCronJob({
    id: "evolution-loop",
    name: "Autonomous Evolution Loop (OODA)",
    schedule: "0 */6 * * *",
    // Every 6 hours
    enabled: false,
    chain: {
      name: "Evolution OODA Cycle",
      mode: "sequential",
      steps: [{ agent_id: "orchestrator", tool_name: "graph.stats", arguments: {} }]
    }
  });
}

// src/routes/cron.ts
var cronRouter = Router8();
cronRouter.get("/", (_req, res) => {
  const jobs2 = listCronJobs();
  res.json({ success: true, data: { jobs: jobs2, total: jobs2.length } });
});
cronRouter.post("/", (req, res) => {
  const body = req.body;
  if (!body.id || !body.name || !body.schedule || !body.chain) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Required: id, name, schedule (cron expr), chain (ChainDefinition)", status_code: 400 }
    });
    return;
  }
  try {
    registerCronJob({
      id: body.id,
      name: body.name,
      schedule: body.schedule,
      chain: body.chain,
      enabled: body.enabled !== false
    });
    res.json({ success: true, data: { id: body.id, registered: true } });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_SCHEDULE", message: String(err), status_code: 400 }
    });
  }
});
cronRouter.post("/:id/run", async (req, res) => {
  try {
    await runCronJob(req.params.id);
    res.json({ success: true, data: { id: req.params.id, triggered: true } });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: "RUN_ERROR", message: String(err), status_code: 500 }
    });
  }
});
cronRouter.patch("/:id", (req, res) => {
  const { enabled } = req.body;
  const ok = setCronJobEnabled(req.params.id, enabled);
  if (!ok) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: `Cron job '${req.params.id}' not found`, status_code: 404 }
    });
    return;
  }
  res.json({ success: true, data: { id: req.params.id, enabled } });
});
cronRouter.delete("/:id", (req, res) => {
  const deleted = deleteCronJob(req.params.id);
  if (!deleted) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: `Cron job '${req.params.id}' not found`, status_code: 404 }
    });
    return;
  }
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
});

// src/routes/dashboard.ts
init_agent_registry();
init_chat_broadcaster();
init_chain_engine();
import { Router as Router10 } from "express";
init_cognitive_proxy();

// src/routes/openclaw.ts
init_config();
init_logger();
import { Router as Router9 } from "express";
var openclawRouter = Router9();
var healthStatus = {
  healthy: false,
  checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
  latencyMs: 0
};
var consecutiveFailures = 0;
var CIRCUIT_THRESHOLD = 3;
var CIRCUIT_RESET_MS = 3e4;
var circuitOpenUntil = 0;
function recordSuccess() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}
function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_RESET_MS;
    logger.warn({ failures: consecutiveFailures }, "OpenClaw circuit breaker OPEN");
  }
}
function isCircuitOpen() {
  if (circuitOpenUntil === 0) return false;
  if (Date.now() > circuitOpenUntil) {
    circuitOpenUntil = 0;
    consecutiveFailures = 0;
    logger.info("OpenClaw circuit breaker RESET (auto)");
    return false;
  }
  return true;
}
var skillManifest = [];
var skillsFetchedAt = "";
async function fetchSkills() {
  const openclawUrl = config.openclawUrl;
  if (!openclawUrl) return;
  try {
    const token = config.openclawToken;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${openclawUrl}/setup/api/status`, {
      headers,
      signal: AbortSignal.timeout(1e4)
    });
    if (res.ok) {
      const data = await res.json();
      const skills = data.skills ?? data.available_skills ?? [];
      if (Array.isArray(skills)) {
        skillManifest = skills;
        skillsFetchedAt = (/* @__PURE__ */ new Date()).toISOString();
        logger.info({ count: skills.length }, "OpenClaw skills discovered");
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "OpenClaw skill discovery failed (non-fatal)");
  }
}
async function pollHealth() {
  const openclawUrl = config.openclawUrl;
  if (!openclawUrl) {
    healthStatus = { healthy: false, checkedAt: (/* @__PURE__ */ new Date()).toISOString(), latencyMs: 0, error: "OPENCLAW_URL not configured" };
    return;
  }
  const start = Date.now();
  try {
    const token = config.openclawToken;
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${openclawUrl}/healthz`, {
      headers,
      signal: AbortSignal.timeout(5e3)
    });
    const latencyMs = Date.now() - start;
    healthStatus = {
      healthy: res.ok,
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      latencyMs,
      ...res.ok ? {} : { error: `HTTP ${res.status}` }
    };
    if (res.ok) recordSuccess();
    else recordFailure();
  } catch (err) {
    healthStatus = {
      healthy: false,
      checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
      latencyMs: Date.now() - start,
      error: String(err)
    };
    recordFailure();
  }
}
function isOpenClawHealthy() {
  return healthStatus.healthy && !isCircuitOpen();
}
function getOpenClawHealth() {
  return { ...healthStatus, circuit_open: isCircuitOpen(), consecutive_failures: consecutiveFailures };
}
function getOpenClawSkills() {
  return { skills: skillManifest, fetched_at: skillsFetchedAt };
}
function initOpenClaw() {
  if (!config.openclawUrl) {
    logger.info("OpenClaw not configured \u2014 skipping init");
    return;
  }
  pollHealth();
  fetchSkills();
  setInterval(pollHealth, 6e4);
  setInterval(fetchSkills, 5 * 6e4);
}
openclawRouter.get("/skills", (_req, res) => {
  res.json({ success: true, data: getOpenClawSkills() });
});
openclawRouter.get("/health", (_req, res) => {
  const health = getOpenClawHealth();
  res.status(health.healthy ? 200 : 503).json({ success: health.healthy, data: health });
});
openclawRouter.all("/proxy/*", async (req, res) => {
  const openclawUrl = config.openclawUrl;
  if (!openclawUrl) {
    res.status(503).json({ success: false, error: { code: "NOT_CONFIGURED", message: "OPENCLAW_URL not configured", status_code: 503 } });
    return;
  }
  if (isCircuitOpen()) {
    res.status(503).json({
      success: false,
      error: {
        code: "CIRCUIT_OPEN",
        message: `OpenClaw circuit breaker open (${consecutiveFailures} consecutive failures). Auto-reset in ${Math.ceil((circuitOpenUntil - Date.now()) / 1e3)}s.`,
        status_code: 503
      }
    });
    return;
  }
  const targetPath = req.params[0] ?? "";
  const token = config.openclawToken;
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const fetchOpts = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(3e4)
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOpts.body = JSON.stringify(req.body);
    }
    const response = await fetch(`${openclawUrl}/${targetPath}`, fetchOpts);
    const contentType = response.headers.get("content-type") ?? "";
    recordSuccess();
    if (contentType.includes("application/json")) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).type(contentType).send(text);
    }
  } catch (err) {
    recordFailure();
    logger.warn({ err: String(err), path: targetPath, failures: consecutiveFailures }, "OpenClaw proxy error");
    res.status(502).json({
      success: false,
      error: {
        code: "GATEWAY_ERROR",
        message: "OpenClaw gateway unreachable",
        details: String(err),
        status_code: 502
      }
    });
  }
});

// src/routes/dashboard.ts
init_config();
init_routing_engine();
init_redis();
var dashboardRouter = Router10();
var CACHE_KEY = "orchestrator:dashboard-cache";
var CACHE_TTL = 15;
dashboardRouter.get("/data", async (_req, res) => {
  const redis2 = getRedis();
  if (redis2) {
    try {
      const cached = await redis2.get(CACHE_KEY);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.json(JSON.parse(cached));
      }
    } catch {
    }
  }
  const agents = AgentRegistry.all().map((a) => ({
    agent_id: a.handshake.agent_id,
    display_name: a.handshake.display_name,
    source: a.handshake.source,
    version: a.handshake.version ?? "n/a",
    status: a.handshake.status,
    capabilities: a.handshake.capabilities,
    allowed_tool_namespaces: a.handshake.allowed_tool_namespaces,
    active_calls: a.activeCalls,
    registered_at: a.registeredAt.toISOString(),
    last_seen_at: a.lastSeenAt.toISOString()
  }));
  const wsStats = getConnectionStats();
  const chains = listExecutions().slice(0, 50);
  const routing = buildRoutingDashboardData(chains);
  const cronJobs = listCronJobs();
  const rlmAvailable = isRlmAvailable();
  let rlmHealth = null;
  if (rlmAvailable) {
    try {
      rlmHealth = await Promise.race([
        getRlmHealth(),
        new Promise((_r, rej) => setTimeout(() => rej(new Error("timeout")), 2e3))
      ]);
    } catch {
    }
  }
  let adoptionTrends = [];
  if (redis2) {
    try {
      const weekAgo = Date.now() - 7 * 864e5;
      const raw = await redis2.zrangebyscore("orchestrator:adoption-trends", weekAgo, "+inf");
      adoptionTrends = raw.map((r) => JSON.parse(r));
    } catch {
    }
  }
  const payload = {
    agents,
    wsStats,
    chains,
    routing,
    cronJobs,
    rlmAvailable,
    rlmHealth,
    adoptionTrends,
    openclaw: {
      health: getOpenClawHealth(),
      skills: getOpenClawSkills()
    },
    config: {
      backendUrl: config.backendUrl,
      orchestratorId: config.orchestratorId,
      nodeEnv: config.nodeEnv
    },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (redis2) {
    try {
      const json = JSON.stringify(payload);
      redis2.set(CACHE_KEY, json, "EX", CACHE_TTL).catch(() => {
      });
    } catch {
    }
  }
  res.setHeader("X-Cache", "MISS");
  res.json(payload);
});

// src/routes/llm.ts
init_llm_proxy();
init_chat_broadcaster();
init_chat_store();
init_logger();
import { Router as Router11 } from "express";
var llmRouter = Router11();
llmRouter.get("/providers", (_req, res) => {
  res.json({ success: true, data: { providers: listProviders() } });
});
llmRouter.post("/chat", async (req, res) => {
  const { provider, prompt, messages, model, temperature, max_tokens, broadcast } = req.body;
  if (!provider) {
    res.status(400).json({ success: false, error: { code: "MISSING_PROVIDER", message: "provider is required", status_code: 400 } });
    return;
  }
  if (!prompt && (!messages || !messages.length)) {
    res.status(400).json({ success: false, error: { code: "MISSING_PROMPT", message: "prompt or messages required", status_code: 400 } });
    return;
  }
  const llmMessages = messages || [{ role: "user", content: prompt }];
  try {
    const result = await chatLLM({ provider, messages: llmMessages, model, temperature, max_tokens });
    if (broadcast !== false) {
      broadcastMessage({
        from: `${result.provider}/${result.model}`,
        to: "All",
        source: "llm",
        type: "Answer",
        message: result.content,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err: String(err), provider }, "LLM chat error");
    res.status(502).json({
      success: false,
      error: { code: "LLM_ERROR", message: String(err instanceof Error ? err.message : err), status_code: 502 }
    });
  }
});
llmRouter.post("/conversation", async (req, res) => {
  const { provider, messages, prompt, model, temperature, max_tokens, conversation_id } = req.body;
  if (!provider) {
    res.status(400).json({ success: false, error: { code: "MISSING_PROVIDER", message: "provider is required", status_code: 400 } });
    return;
  }
  if (!prompt && (!messages || !messages.length)) {
    res.status(400).json({ success: false, error: { code: "MISSING_PROMPT", message: "prompt or messages required", status_code: 400 } });
    return;
  }
  const convId = conversation_id || `llm-${provider}-${Date.now().toString(36)}`;
  const llmMessages = messages || [{ role: "user", content: prompt }];
  const lastUserMsg = [...llmMessages].reverse().find((m) => m.role === "user");
  try {
    if (lastUserMsg) {
      await storeMessage({
        id: msgId(),
        from: "command-center",
        to: provider,
        source: "human",
        type: "Message",
        message: lastUserMsg.content,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        metadata: { conversation_id: convId, provider }
      });
    }
    const result = await chatLLM({ provider, messages: llmMessages, model, temperature, max_tokens });
    await storeMessage({
      id: msgId(),
      from: `${result.provider}/${result.model}`,
      to: "command-center",
      source: "llm",
      type: "Answer",
      message: result.content,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      metadata: {
        conversation_id: convId,
        provider: result.provider,
        model: result.model,
        duration_ms: result.duration_ms,
        usage: result.usage
      }
    });
    logger.info({ provider, model: result.model, convId, ms: result.duration_ms }, "LLM conversation persisted");
    res.json({ success: true, data: { ...result, conversation_id: convId } });
  } catch (err) {
    logger.error({ err: String(err), provider, convId }, "LLM conversation error");
    res.status(502).json({
      success: false,
      error: { code: "LLM_ERROR", message: String(err instanceof Error ? err.message : err), status_code: 502 }
    });
  }
});

// src/routes/audit.ts
import { Router as Router12 } from "express";

// src/audit.ts
init_redis();
init_logger();
var REDIS_KEY5 = "orchestrator:audit";
var MAX_ENTRIES = 1e3;
var TTL_SECONDS3 = 30 * 24 * 3600;
var memoryAudit = [];
async function logAudit(entry) {
  try {
    if (isRedisEnabled()) {
      const redis2 = getRedis();
      if (redis2) {
        await redis2.lpush(REDIS_KEY5, JSON.stringify(entry));
        await redis2.ltrim(REDIS_KEY5, 0, MAX_ENTRIES - 1);
        await redis2.expire(REDIS_KEY5, TTL_SECONDS3);
        return;
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Audit Redis write failed, using memory");
  }
  memoryAudit.unshift(entry);
  if (memoryAudit.length > MAX_ENTRIES) memoryAudit = memoryAudit.slice(0, MAX_ENTRIES);
}
async function getAuditLog(limit = 100, offset = 0) {
  try {
    if (isRedisEnabled()) {
      const redis2 = getRedis();
      if (redis2) {
        const raw = await redis2.lrange(REDIS_KEY5, offset, offset + limit - 1);
        return raw.map((r) => JSON.parse(r));
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Audit Redis read failed, using memory");
  }
  return memoryAudit.slice(offset, offset + limit);
}
function auditMiddleware(req, res, next) {
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") {
    next();
    return;
  }
  const start = Date.now();
  const originalEnd = res.end.bind(res);
  res.end = function(...args) {
    const duration = Date.now() - start;
    const actor = req.body?.agent_id ?? req.body?.from ?? "human";
    const pathParts = req.path.split("/").filter(Boolean);
    const entityType = pathParts[0] ?? "unknown";
    const entityId = pathParts[1] ?? req.body?.agent_id ?? "-";
    let action = `${req.method.toLowerCase()}_${entityType}`;
    if (req.path.includes("/register")) action = "register";
    else if (req.path.includes("/call")) action = "tool_call";
    else if (req.path.includes("/execute")) action = "chain_execute";
    else if (req.path.includes("/message")) action = "chat_message";
    else if (req.path.includes("/heartbeat")) action = "heartbeat";
    else if (req.path.includes("/run")) action = "cron_trigger";
    const entry = {
      id: `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      actor,
      action,
      entity_type: entityType,
      entity_id: String(entityId),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration
    };
    if (action !== "heartbeat") {
      logAudit(entry).catch(() => {
      });
    }
    return originalEnd(...args);
  };
  next();
}

// src/routes/audit.ts
var auditRouter = Router12();
auditRouter.get("/log", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const entries = await getAuditLog(limit, offset);
  const actor = req.query.actor;
  const action = req.query.action;
  const entityType = req.query.entity_type;
  let filtered = entries;
  if (actor) filtered = filtered.filter((e) => e.actor === actor);
  if (action) filtered = filtered.filter((e) => e.action === action);
  if (entityType) filtered = filtered.filter((e) => e.entity_type === entityType);
  res.json({ success: true, data: { entries: filtered, total: filtered.length, limit, offset } });
});

// src/routes/knowledge.ts
init_config();
init_redis();
init_logger();
import { Router as Router13 } from "express";
var knowledgeRouter = Router13();
var FEED_CACHE_KEY = "orchestrator:knowledge-feed";
var BRIEFING_CACHE_KEY = "orchestrator:knowledge-briefing-prompt";
var FEED_TTL_SECONDS = 86400;
var MCP_TIMEOUT_MS = 1e4;
async function callMcp(tool, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.backendApiKey}`
      },
      body: JSON.stringify({ tool, payload }),
      signal: controller.signal
    });
    if (!res.ok) {
      return { ok: false, error: `MCP ${tool} returned ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `MCP ${tool} failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
function normalizeCards(raw, source) {
  if (!raw || typeof raw !== "object") return [];
  const items = Array.isArray(raw) ? raw : Array.isArray(raw.results) ? raw.results : Array.isArray(raw.data) ? raw.data : Array.isArray(raw.entries) ? raw.entries : [];
  return items.map((item, idx) => {
    const r = item && typeof item === "object" ? item : {};
    return {
      id: String(r.id ?? r.node_id ?? `${source}-${idx}`),
      title: String(r.title ?? r.name ?? r.label ?? "Untitled"),
      summary: String(r.summary ?? r.content ?? r.text ?? r.description ?? ""),
      score: typeof r.score === "number" ? r.score : typeof r.relevance === "number" ? r.relevance : 0,
      domain: String(r.domain ?? r.type ?? r.category ?? "unknown"),
      source_ref: String(r.source_ref ?? r.source ?? r.url ?? source)
    };
  });
}
knowledgeRouter.get("/cards", async (req, res) => {
  const q = req.query.q;
  if (!q) {
    res.status(400).json({ cards: [], error: "Missing required query param: q", query: "" });
    return;
  }
  const topK = Math.min(Math.max(parseInt(req.query.top_k) || 5, 1), 50);
  const domains = req.query.domains || "all";
  const kgResult = await callMcp("kg_rag.query", { question: q, top_k: topK });
  if (kgResult.ok) {
    const cards = normalizeCards(kgResult.data, "kg_rag");
    if (cards.length > 0) {
      res.json({ cards, source: "kg_rag", query: q, count: cards.length });
      return;
    }
  }
  logger.info({ query: q }, "kg_rag empty or failed, falling back to srag.query");
  const sragResult = await callMcp("srag.query", { query: q, domains });
  if (sragResult.ok) {
    const cards = normalizeCards(sragResult.data, "srag");
    res.json({ cards, source: "srag", query: q, count: cards.length });
    return;
  }
  const errorMsg = [kgResult.error, sragResult.error].filter(Boolean).join("; ");
  res.json({ cards: [], error: errorMsg, query: q, count: 0 });
});
knowledgeRouter.get("/feed", async (_req, res) => {
  const redis2 = getRedis();
  if (redis2) {
    try {
      const cached = await redis2.get(FEED_CACHE_KEY);
      if (cached) {
        res.json(JSON.parse(cached));
        return;
      }
    } catch (err) {
      logger.warn({ err: String(err) }, "Redis cache read failed for knowledge feed");
    }
  }
  const feed = {
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    graph_pulse: null,
    top_insights: [],
    gap_alerts: [],
    domain_coverage: {}
  };
  const errors = [];
  const graphResult = await callMcp("graph.read_cypher", {
    query: "MATCH (n) RETURN labels(n) AS type, count(*) AS count ORDER BY count DESC LIMIT 20"
  });
  if (graphResult.ok) {
    const data = graphResult.data;
    const records = Array.isArray(data) ? data : Array.isArray(data?.records) ? data.records : Array.isArray(data?.data) ? data.data : [];
    const domainCoverage = {};
    let totalNodes = 0;
    for (const rec of records) {
      const label = String(rec.type ?? rec.labels ?? "Unknown");
      const count = typeof rec.count === "number" ? rec.count : parseInt(String(rec.count)) || 0;
      domainCoverage[label] = count;
      totalNodes += count;
    }
    feed.graph_pulse = { total_nodes: totalNodes, label_distribution: domainCoverage };
    feed.domain_coverage = domainCoverage;
  } else {
    errors.push(graphResult.error ?? "graph.read_cypher failed");
  }
  const insightResult = await callMcp("kg_rag.query", {
    question: "What are the most important recent insights and gaps?",
    top_k: 10
  });
  if (insightResult.ok) {
    const cards = normalizeCards(insightResult.data, "kg_rag");
    feed.top_insights = cards.filter((c) => c.score >= 0.5 || cards.length <= 5);
    feed.gap_alerts = cards.filter((c) => {
      const lower = c.summary.toLowerCase();
      return lower.includes("gap") || lower.includes("missing") || lower.includes("incomplete");
    });
  } else {
    errors.push(insightResult.error ?? "kg_rag.query failed for insights");
  }
  if (errors.length > 0) {
    feed.error = errors.join("; ");
  }
  if (redis2) {
    try {
      await redis2.set(FEED_CACHE_KEY, JSON.stringify(feed), "EX", FEED_TTL_SECONDS);
    } catch (err) {
      logger.warn({ err: String(err) }, "Redis cache write failed for knowledge feed");
    }
  }
  res.json(feed);
});
knowledgeRouter.get("/briefing", async (_req, res) => {
  const redis2 = getRedis();
  if (!redis2) {
    res.status(503).json({ error: "Redis not available", briefing: null });
    return;
  }
  try {
    const briefing = await redis2.get(BRIEFING_CACHE_KEY);
    if (!briefing) {
      res.status(204).end();
      return;
    }
    res.type("text/plain").send(briefing);
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis read failed for knowledge briefing");
    res.status(500).json({ error: "Failed to read briefing from cache" });
  }
});

// src/routes/artifacts.ts
init_redis();
init_logger();
import { Router as Router14 } from "express";
import { randomUUID } from "crypto";
var artifactRouter = Router14();
var ARTIFACT_PREFIX = "orchestrator:artifact:";
var ARTIFACT_INDEX = "orchestrator:artifacts:index";
var TTL_SECONDS4 = 2592e3;
async function storeArtifact(artifact) {
  const redis2 = getRedis();
  if (!redis2) return false;
  const key = `${ARTIFACT_PREFIX}${artifact.$id}`;
  try {
    await redis2.set(key, JSON.stringify(artifact), "EX", TTL_SECONDS4);
    await redis2.sadd(ARTIFACT_INDEX, artifact.$id);
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis store failed for artifact");
    return false;
  }
}
async function loadArtifact(id) {
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const raw = await redis2.get(`${ARTIFACT_PREFIX}${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err: String(err), id }, "Redis load failed for artifact");
    return null;
  }
}
async function listAllIds() {
  const redis2 = getRedis();
  if (!redis2) return [];
  try {
    return await redis2.smembers(ARTIFACT_INDEX);
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis list failed for artifact index");
    return [];
  }
}
artifactRouter.post("/", async (req, res) => {
  const body = req.body;
  if (!body.title || !body.source || !Array.isArray(body.blocks) || !body.created_by) {
    res.status(400).json({ success: false, error: "Missing required fields: title, source, blocks, created_by" });
    return;
  }
  const id = `widgetdc:artifact:${randomUUID()}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const artifact = {
    $id: id,
    $schema: "widgetdc:analysis:v1",
    title: String(body.title),
    source: String(body.source),
    blocks: body.blocks,
    graph_refs: Array.isArray(body.graph_refs) ? body.graph_refs : void 0,
    tags: Array.isArray(body.tags) ? body.tags : void 0,
    status: "draft",
    created_by: String(body.created_by),
    created_at: now,
    updated_at: now
  };
  const stored = await storeArtifact(artifact);
  if (!stored) {
    res.status(503).json({ success: false, error: "Redis not available" });
    return;
  }
  logger.info({ id: artifact.$id, title: artifact.title }, "Artifact created");
  res.status(201).json({ success: true, artifact });
});
artifactRouter.get("/", async (req, res) => {
  const statusFilter = req.query.status;
  const tagFilter = req.query.tag;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const allIds = await listAllIds();
  const redis2 = getRedis();
  if (!redis2) {
    res.json({ artifacts: [], total: 0, limit, offset });
    return;
  }
  const artifacts = [];
  try {
    const pipeline = redis2.pipeline();
    for (const id of allIds) {
      pipeline.get(`${ARTIFACT_PREFIX}${id}`);
    }
    const results = await pipeline.exec();
    if (results) {
      for (const [err, raw] of results) {
        if (!err && typeof raw === "string") {
          try {
            artifacts.push(JSON.parse(raw));
          } catch {
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis pipeline failed for artifact list");
  }
  let filtered = artifacts.filter((a) => a.status !== "archived");
  if (statusFilter) {
    filtered = filtered.filter((a) => a.status === statusFilter);
  }
  if (tagFilter) {
    filtered = filtered.filter((a) => a.tags?.includes(tagFilter));
  }
  filtered.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  res.json({ artifacts: page, total, limit, offset });
});
artifactRouter.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (id.endsWith(".md")) {
    return renderMarkdown(req, res, id.replace(/\.md$/, ""));
  }
  if (id.endsWith(".html")) {
    return renderHtml(req, res, id.replace(/\.html$/, ""));
  }
  const artifact = await loadArtifact(id);
  if (!artifact) {
    res.status(404).json({ success: false, error: "Artifact not found" });
    return;
  }
  res.json(artifact);
});
artifactRouter.put("/:id", async (req, res) => {
  const id = req.params.id;
  const existing = await loadArtifact(id);
  if (!existing) {
    res.status(404).json({ success: false, error: "Artifact not found" });
    return;
  }
  const body = req.body;
  if (body.title) existing.title = body.title;
  if (body.source) existing.source = body.source;
  if (body.blocks) existing.blocks = body.blocks;
  if (body.graph_refs !== void 0) existing.graph_refs = body.graph_refs;
  if (body.tags !== void 0) existing.tags = body.tags;
  if (body.status && ["draft", "published", "archived"].includes(body.status)) {
    existing.status = body.status;
  }
  existing.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  const stored = await storeArtifact(existing);
  if (!stored) {
    res.status(503).json({ success: false, error: "Redis not available" });
    return;
  }
  logger.info({ id, title: existing.title }, "Artifact updated");
  res.json({ success: true, artifact: existing });
});
artifactRouter.delete("/:id", async (req, res) => {
  const id = req.params.id;
  const existing = await loadArtifact(id);
  if (!existing) {
    res.status(404).json({ success: false, error: "Artifact not found" });
    return;
  }
  existing.status = "archived";
  existing.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  const stored = await storeArtifact(existing);
  if (!stored) {
    res.status(503).json({ success: false, error: "Redis not available" });
    return;
  }
  logger.info({ id }, "Artifact archived");
  res.json({ success: true });
});
function trendEmoji(trend) {
  if (trend === "up") return "\u2191";
  if (trend === "down") return "\u2193";
  return "\u2192";
}
function blockToMarkdown(block) {
  const c = block.content;
  switch (block.type) {
    case "text":
      return String(c.body ?? c.text ?? c ?? "");
    case "table": {
      const headers = c.headers ?? c.columns ?? [];
      const rows = c.rows ?? c.data ?? [];
      if (headers.length === 0) return "";
      const headerLine = `| ${headers.join(" | ")} |`;
      const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
      const dataLines = rows.map((r) => `| ${r.map(String).join(" | ")} |`);
      return [headerLine, separatorLine, ...dataLines].join("\n");
    }
    case "chart":
      return `\`\`\`widgetdc-query
type: ${String(c.chart_type ?? c.type ?? "bar")}
data: ${JSON.stringify(c.data ?? c)}
\`\`\``;
    case "cypher":
      return `\`\`\`widgetdc-query
cypher: ${String(c.query ?? c.cypher ?? c)}
\`\`\``;
    case "mermaid":
      return "```mermaid\n" + String(c.diagram ?? c.code ?? c) + "\n```";
    case "kpi_card": {
      const label = String(c.label ?? block.label ?? "KPI");
      const value = String(c.value ?? "");
      const trend = trendEmoji(c.trend);
      return `**${label}**: ${value} ${trend}`;
    }
    case "deep_link": {
      const label = String(c.label ?? c.title ?? "Link");
      const uri = String(c.uri ?? c.url ?? c.href ?? "#");
      return `[${label}](${uri})`;
    }
    default:
      return `<!-- unknown block type: ${block.type} -->
${JSON.stringify(c, null, 2)}`;
  }
}
async function renderMarkdown(req, res, id) {
  const artifact = await loadArtifact(id);
  if (!artifact) {
    res.status(404).json({ success: false, error: "Artifact not found" });
    return;
  }
  const lines = [];
  lines.push(`# ${artifact.title}`);
  lines.push("");
  lines.push(`> Source: ${artifact.source} | Status: ${artifact.status} | Created: ${artifact.created_at}`);
  if (artifact.tags?.length) {
    lines.push(`> Tags: ${artifact.tags.map((t) => `#${t}`).join(" ")}`);
  }
  lines.push("");
  for (const block of artifact.blocks) {
    if (block.label) {
      lines.push(`## ${block.label}`);
      lines.push("");
    }
    lines.push(blockToMarkdown(block));
    lines.push("");
  }
  if (artifact.graph_refs?.length) {
    lines.push("---");
    lines.push("## Graph References");
    for (const ref of artifact.graph_refs) {
      lines.push(`- \`${ref}\``);
    }
  }
  res.type("text/markdown").send(lines.join("\n"));
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function blockToHtml(block) {
  const c = block.content;
  const labelHtml = block.label ? `<h3>${escapeHtml(block.label)}</h3>
` : "";
  switch (block.type) {
    case "text":
      return `${labelHtml}<div class="wad-text">${escapeHtml(String(c.body ?? c.text ?? c ?? ""))}</div>`;
    case "table": {
      const headers = c.headers ?? c.columns ?? [];
      const rows = c.rows ?? c.data ?? [];
      const thRow = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
      const bodyRows = rows.map(
        (r) => `<tr>${r.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`
      ).join("\n");
      return `${labelHtml}<table><thead><tr>${thRow}</tr></thead><tbody>
${bodyRows}
</tbody></table>`;
    }
    case "chart": {
      const chartType = String(c.chart_type ?? c.type ?? "bar");
      const config2 = JSON.stringify(c.data ?? c);
      return `${labelHtml}<div class="wad-chart" data-type="${escapeHtml(chartType)}" data-config="${escapeHtml(config2)}">Chart: ${escapeHtml(chartType)}</div>`;
    }
    case "kpi_card": {
      const label = String(c.label ?? block.label ?? "KPI");
      const value = String(c.value ?? "");
      const trend = trendEmoji(c.trend);
      return `${labelHtml}<div class="wad-kpi"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span><span class="trend">${trend}</span></div>`;
    }
    case "cypher":
      return `${labelHtml}<pre class="wad-cypher"><code>${escapeHtml(String(c.query ?? c.cypher ?? c))}</code></pre>`;
    case "mermaid":
      return `${labelHtml}<div class="wad-mermaid"><pre class="mermaid">${escapeHtml(String(c.diagram ?? c.code ?? c))}</pre></div>`;
    case "deep_link": {
      const label = String(c.label ?? c.title ?? "Link");
      const uri = String(c.uri ?? c.url ?? c.href ?? "#");
      return `${labelHtml}<a class="wad-link" href="${escapeHtml(uri)}">${escapeHtml(label)}</a>`;
    }
    default:
      return `${labelHtml}<div class="wad-unknown"><pre>${escapeHtml(JSON.stringify(c, null, 2))}</pre></div>`;
  }
}
async function renderHtml(_req, res, id) {
  const artifact = await loadArtifact(id);
  if (!artifact) {
    res.status(404).json({ success: false, error: "Artifact not found" });
    return;
  }
  const parts = [];
  parts.push(`<article class="wad-artifact" data-id="${escapeHtml(artifact.$id)}" data-status="${artifact.status}">`);
  parts.push(`  <h1>${escapeHtml(artifact.title)}</h1>`);
  parts.push(`  <div class="wad-meta">Source: ${escapeHtml(artifact.source)} | Status: ${artifact.status} | ${artifact.created_at}</div>`);
  if (artifact.tags?.length) {
    parts.push(`  <div class="wad-tags">${artifact.tags.map((t) => `<span class="wad-tag">${escapeHtml(t)}</span>`).join(" ")}</div>`);
  }
  for (const block of artifact.blocks) {
    parts.push(`  <section class="wad-block wad-block-${block.type}">`);
    parts.push(`    ${blockToHtml(block)}`);
    parts.push("  </section>");
  }
  if (artifact.graph_refs?.length) {
    parts.push('  <footer class="wad-graph-refs">');
    parts.push("    <h3>Graph References</h3>");
    parts.push("    <ul>");
    for (const ref of artifact.graph_refs) {
      parts.push(`      <li><code>${escapeHtml(ref)}</code></li>`);
    }
    parts.push("    </ul>");
    parts.push("  </footer>");
  }
  parts.push("</article>");
  res.type("text/html").send(parts.join("\n"));
}

// src/routes/notebooks.ts
init_redis();
init_logger();
init_mcp_caller();
init_cognitive_proxy();
import { Router as Router15 } from "express";
import { randomUUID as randomUUID2 } from "crypto";
import { v4 as uuid19 } from "uuid";
var notebookRouter = Router15();
var NOTEBOOK_PREFIX = "orchestrator:notebook:";
var NOTEBOOK_INDEX = "orchestrator:notebooks:index";
var TTL_SECONDS5 = 2592e3;
async function storeNotebook(notebook) {
  const redis2 = getRedis();
  if (!redis2) return false;
  const key = `${NOTEBOOK_PREFIX}${notebook.$id}`;
  try {
    await redis2.set(key, JSON.stringify(notebook), "EX", TTL_SECONDS5);
    await redis2.sadd(NOTEBOOK_INDEX, notebook.$id);
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis store failed for notebook");
    return false;
  }
}
async function loadNotebook(id) {
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const raw = await redis2.get(`${NOTEBOOK_PREFIX}${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err: String(err), id }, "Redis load failed for notebook");
    return null;
  }
}
function isCypher(text) {
  const cypherKeywords = /^\s*(MATCH|CREATE|MERGE|RETURN|WITH|OPTIONAL|UNWIND|CALL)\b/i;
  return cypherKeywords.test(text.trim());
}
async function executeQueryCell(cell, _context) {
  const query = cell.query.trim();
  try {
    if (isCypher(query)) {
      const result = await callMcpTool({
        toolName: "graph.read_cypher",
        args: { query, params: {} },
        callId: uuid19(),
        timeoutMs: 15e3
      });
      cell.result = result.status === "success" ? result.result : { error: result.error_message };
    } else {
      const result = await callMcpTool({
        toolName: "kg_rag.query",
        args: { question: query, max_evidence: 10 },
        callId: uuid19(),
        timeoutMs: 2e4
      });
      cell.result = result.status === "success" ? result.result : { error: result.error_message };
    }
  } catch (err) {
    cell.result = { error: String(err) };
  }
  return cell;
}
async function executeInsightCell(cell, context) {
  try {
    const prompt = cell.prompt + (context ? `

Context from previous cells:
${context}` : "");
    const result = await callCognitive("reason", {
      prompt,
      context: { source: "notebook-insight" },
      agent_id: "notebook-executor"
    }, 45e3);
    cell.content = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (err) {
    cell.content = `Insight generation failed: ${String(err)}`;
  }
  return cell;
}
function executeDataCell(cell, cellResults) {
  const sourceResult = cellResults.get(cell.source_cell_id);
  if (!sourceResult) {
    cell.result = { error: `Source cell "${cell.source_cell_id}" not found or has no result` };
    return cell;
  }
  if (cell.visualization === "chart") {
    if (Array.isArray(sourceResult)) {
      const columns = sourceResult.length > 0 ? Object.keys(sourceResult[0]) : [];
      cell.result = { type: "chart", columns, data: sourceResult };
    } else {
      cell.result = { type: "chart", data: sourceResult };
    }
  } else {
    if (Array.isArray(sourceResult)) {
      const columns = sourceResult.length > 0 ? Object.keys(sourceResult[0]) : [];
      const rows = sourceResult.map((r) => {
        const row = r;
        return columns.map((c) => row[c]);
      });
      cell.result = { type: "table", columns, rows, row_count: rows.length };
    } else {
      cell.result = { type: "table", data: sourceResult };
    }
  }
  return cell;
}
notebookRouter.post("/execute", async (req, res) => {
  const body = req.body;
  if (!body.title || !Array.isArray(body.cells) || body.cells.length === 0) {
    res.status(400).json({ success: false, error: "Missing required fields: title, cells (non-empty array)" });
    return;
  }
  const id = `widgetdc:notebook:${randomUUID2()}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const cells = body.cells;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].id) {
      cells[i].id = `cell-${i}`;
    }
  }
  logger.info({ id, title: body.title, cellCount: cells.length }, "Notebook execution started");
  const cellResults = /* @__PURE__ */ new Map();
  let context = "";
  for (const cell of cells) {
    switch (cell.type) {
      case "query": {
        await executeQueryCell(cell, context);
        cellResults.set(cell.id, cell.result);
        const resultStr = JSON.stringify(cell.result ?? "").slice(0, 500);
        context += `
[Query "${cell.query.slice(0, 80)}"]: ${resultStr}`;
        break;
      }
      case "insight": {
        await executeInsightCell(cell, context);
        cellResults.set(cell.id, cell.content);
        context += `
[Insight]: ${(cell.content ?? "").slice(0, 300)}`;
        break;
      }
      case "data": {
        executeDataCell(cell, cellResults);
        cellResults.set(cell.id, cell.result);
        break;
      }
      case "action": {
        cellResults.set(cell.id, cell.recommendation);
        break;
      }
    }
  }
  const notebook = {
    $id: id,
    $schema: "widgetdc:notebook:v1",
    title: String(body.title),
    cells,
    created_at: now,
    updated_at: now,
    created_by: String(body.created_by ?? "anonymous")
  };
  const stored = await storeNotebook(notebook);
  if (!stored) {
    logger.warn({ id }, "Notebook executed but Redis storage failed");
  }
  logger.info({ id, title: notebook.title, cellsExecuted: cells.length }, "Notebook execution complete");
  res.status(201).json({ success: true, notebook });
});
notebookRouter.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (id.endsWith(".md")) {
    return renderNotebookMarkdown(req, res, id.replace(/\.md$/, ""));
  }
  const notebook = await loadNotebook(id);
  if (!notebook) {
    res.status(404).json({ success: false, error: "Notebook not found" });
    return;
  }
  res.json({ success: true, notebook });
});
async function renderNotebookMarkdown(_req, res, id) {
  const notebook = await loadNotebook(id);
  if (!notebook) {
    res.status(404).json({ success: false, error: "Notebook not found" });
    return;
  }
  const lines = [];
  lines.push(`# ${notebook.title}`);
  lines.push("");
  lines.push(`> Notebook: ${notebook.$id} | Created: ${notebook.created_at} | By: ${notebook.created_by}`);
  lines.push("");
  for (const cell of notebook.cells) {
    switch (cell.type) {
      case "query": {
        const q = cell;
        lines.push("```widgetdc-query");
        lines.push(isCypher(q.query) ? q.query : `? ${q.query}`);
        lines.push("```");
        lines.push("");
        if (q.result) {
          lines.push("> Last result:");
          const resultStr = typeof q.result === "string" ? q.result : JSON.stringify(q.result, null, 2);
          lines.push(`> ${resultStr.slice(0, 300).replace(/\n/g, "\n> ")}`);
          lines.push("");
        }
        break;
      }
      case "insight": {
        const i = cell;
        lines.push(`## Insight: ${i.prompt.slice(0, 80)}`);
        lines.push("");
        if (i.content) {
          lines.push(i.content);
          lines.push("");
        }
        break;
      }
      case "data": {
        const d = cell;
        lines.push(`### Data (from ${d.source_cell_id})`);
        lines.push("");
        if (d.result && typeof d.result === "object") {
          const r = d.result;
          if (r.type === "table" && Array.isArray(r.columns) && Array.isArray(r.rows)) {
            const cols = r.columns;
            const rows = r.rows;
            lines.push(`| ${cols.join(" | ")} |`);
            lines.push(`| ${cols.map(() => "---").join(" | ")} |`);
            for (const row of rows.slice(0, 50)) {
              lines.push(`| ${row.map(String).join(" | ")} |`);
            }
            lines.push("");
          } else {
            lines.push("```json");
            lines.push(JSON.stringify(d.result, null, 2).slice(0, 500));
            lines.push("```");
            lines.push("");
          }
        }
        break;
      }
      case "action": {
        const a = cell;
        lines.push(`### Action`);
        lines.push("");
        lines.push(`- [ ] ${a.recommendation}`);
        if (a.linear_issue) {
          lines.push(`  - Linear: ${a.linear_issue}`);
        }
        lines.push("");
        break;
      }
    }
  }
  res.type("text/markdown").send(lines.join("\n"));
}

// src/routes/drill.ts
init_redis();
init_config();
init_logger();
import { Router as Router16 } from "express";
import { randomUUID as randomUUID3 } from "crypto";
var drillRouter = Router16();
var DRILL_PREFIX = "orchestrator:drill:";
var SESSION_TTL = 3600;
var MCP_TIMEOUT_MS2 = 12e3;
async function callMcp2(tool, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS2);
  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.backendApiKey}`
      },
      body: JSON.stringify({ tool, payload }),
      signal: controller.signal
    });
    if (!res.ok) {
      return { ok: false, error: `MCP ${tool} returned ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `MCP ${tool} failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
function extractRecords(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const d = data;
    if (Array.isArray(d.records)) return d.records;
    if (Array.isArray(d.data)) return d.data;
    if (Array.isArray(d.results)) return d.results;
  }
  return [];
}
var LEVEL_ORDER = ["domain", "segment", "framework", "kpi", "trend", "recommendation"];
function nextLevel(current) {
  const idx = LEVEL_ORDER.indexOf(current);
  return idx >= 0 && idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] : null;
}
function childrenQuery(level, id) {
  switch (level) {
    case "domain":
      return {
        query: `MATCH (d:ConsultingDomain {name: $name})-[:HAS_SEGMENT]->(s) RETURN s.name AS label, elementId(s) AS id, 'segment' AS level`,
        params: { name: id }
      };
    case "segment":
      return {
        query: `MATCH (s {name: $name})-[:HAS_FRAMEWORK]->(f:ConsultingFramework) RETURN f.name AS label, elementId(f) AS id, 'framework' AS level`,
        params: { name: id }
      };
    case "framework":
      return {
        query: `MATCH (f:ConsultingFramework {name: $name})-[:HAS_KPI]->(k:KPI) RETURN k.name AS label, elementId(k) AS id, 'kpi' AS level`,
        params: { name: id }
      };
    case "kpi":
      return {
        query: `MATCH (k:KPI {name: $name})-[:HAS_TREND]->(t) RETURN t.name AS label, elementId(t) AS id, 'trend' AS level`,
        params: { name: id }
      };
    case "trend":
      return {
        query: `MATCH (t {name: $name})-[:HAS_RECOMMENDATION]->(r) RETURN r.name AS label, elementId(r) AS id, 'recommendation' AS level`,
        params: { name: id }
      };
    default:
      return null;
  }
}
function domainFrameworksFallback() {
  return {
    query: `MATCH (d:ConsultingDomain {name: $name})-[:HAS_FRAMEWORK]->(f:ConsultingFramework) RETURN f.name AS label, elementId(f) AS id, 'framework' AS level`,
    params: { name: "" }
    // filled at call site
  };
}
async function fetchChildren(level, label) {
  const q = childrenQuery(level, label);
  if (!q) return [];
  const result = await callMcp2("graph.read_cypher", { query: q.query, params: q.params });
  if (!result.ok) {
    logger.warn({ level, label, error: result.error }, "Drill children query failed");
    return [];
  }
  let records = extractRecords(result.data);
  if (level === "domain" && records.length === 0) {
    const fb = domainFrameworksFallback();
    fb.params.name = label;
    const fbResult = await callMcp2("graph.read_cypher", { query: fb.query, params: fb.params });
    if (fbResult.ok) {
      records = extractRecords(fbResult.data);
    }
  }
  return records.map((r) => ({
    id: String(r.id ?? ""),
    label: String(r.label ?? ""),
    type: String(r.level ?? nextLevel(level) ?? "unknown"),
    count: typeof r.count === "number" ? r.count : void 0
  }));
}
async function saveContext(sessionId, ctx) {
  const redis2 = getRedis();
  if (!redis2) return false;
  try {
    await redis2.set(`${DRILL_PREFIX}${sessionId}`, JSON.stringify(ctx), "EX", SESSION_TTL);
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis save failed for drill context");
    return false;
  }
}
async function loadContext(sessionId) {
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const raw = await redis2.get(`${DRILL_PREFIX}${sessionId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis load failed for drill context");
    return null;
  }
}
function buildBreadcrumbs(ctx) {
  return [
    ...ctx.stack,
    { level: ctx.current_level, id: ctx.current_id, label: ctx.current_label }
  ];
}
drillRouter.post("/start", async (req, res) => {
  const { domain } = req.body;
  if (!domain) {
    res.status(400).json({ success: false, error: "Missing required field: domain" });
    return;
  }
  const sessionId = randomUUID3();
  const ctx = {
    stack: [],
    current_level: "domain",
    current_id: domain,
    current_label: domain,
    domain
  };
  const saved = await saveContext(sessionId, ctx);
  if (!saved) {
    res.status(503).json({ success: false, error: "Redis not available" });
    return;
  }
  const children = await fetchChildren("domain", domain);
  logger.info({ session_id: sessionId, domain, children_count: children.length }, "Drill session started");
  res.json({
    success: true,
    session_id: sessionId,
    context: ctx,
    children,
    breadcrumbs: buildBreadcrumbs(ctx)
  });
});
drillRouter.post("/down", async (req, res) => {
  const { session_id, target_id, target_level } = req.body;
  if (!session_id || !target_id || !target_level) {
    res.status(400).json({ success: false, error: "Missing required fields: session_id, target_id, target_level" });
    return;
  }
  const ctx = await loadContext(session_id);
  if (!ctx) {
    res.status(404).json({ success: false, error: "Drill session not found or expired" });
    return;
  }
  ctx.stack.push({
    level: ctx.current_level,
    id: ctx.current_id,
    label: ctx.current_label
  });
  ctx.current_level = target_level;
  ctx.current_id = target_id;
  ctx.current_label = target_id;
  await saveContext(session_id, ctx);
  const children = await fetchChildren(target_level, target_id);
  logger.info({ session_id, target_level, target_id, depth: ctx.stack.length }, "Drill down");
  res.json({
    success: true,
    context: ctx,
    children,
    breadcrumbs: buildBreadcrumbs(ctx)
  });
});
drillRouter.post("/up", async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) {
    res.status(400).json({ success: false, error: "Missing required field: session_id" });
    return;
  }
  const ctx = await loadContext(session_id);
  if (!ctx) {
    res.status(404).json({ success: false, error: "Drill session not found or expired" });
    return;
  }
  if (ctx.stack.length === 0) {
    res.status(400).json({ success: false, error: "Already at top level" });
    return;
  }
  const parent = ctx.stack.pop();
  ctx.current_level = parent.level;
  ctx.current_id = parent.id;
  ctx.current_label = parent.label;
  await saveContext(session_id, ctx);
  const children = await fetchChildren(ctx.current_level, ctx.current_label);
  logger.info({ session_id, level: ctx.current_level, label: ctx.current_label }, "Drill up");
  res.json({
    success: true,
    context: ctx,
    children,
    breadcrumbs: buildBreadcrumbs(ctx)
  });
});
drillRouter.get("/children", async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) {
    res.status(400).json({ success: false, error: "Missing required query param: session_id" });
    return;
  }
  const ctx = await loadContext(sessionId);
  if (!ctx) {
    res.status(404).json({ success: false, error: "Drill session not found or expired" });
    return;
  }
  const children = await fetchChildren(ctx.current_level, ctx.current_label);
  res.json({
    success: true,
    children,
    context: ctx,
    breadcrumbs: buildBreadcrumbs(ctx)
  });
});
drillRouter.get("/moc", async (req, res) => {
  const domain = req.query.domain;
  if (!domain) {
    res.status(400).json({ success: false, error: "Missing required query param: domain" });
    return;
  }
  const hierarchyQuery = `
    MATCH (d:ConsultingDomain {name: $domain})
    OPTIONAL MATCH (d)-[:HAS_FRAMEWORK]->(f:ConsultingFramework)
    OPTIONAL MATCH (f)-[:HAS_KPI]->(k:KPI)
    RETURN d.name AS domain_name, f.name AS framework_name, k.name AS kpi_name, k.value AS kpi_value, k.trend AS kpi_trend
    ORDER BY f.name, k.name
  `;
  const result = await callMcp2("graph.read_cypher", {
    query: hierarchyQuery,
    params: { domain }
  });
  if (!result.ok) {
    res.status(502).json({ success: false, error: result.error ?? "Neo4j query failed" });
    return;
  }
  const records = extractRecords(result.data);
  const frameworks = /* @__PURE__ */ new Map();
  for (const rec of records) {
    const fName = rec.framework_name ? String(rec.framework_name) : null;
    if (!fName) continue;
    if (!frameworks.has(fName)) {
      frameworks.set(fName, { kpis: [] });
    }
    const kName = rec.kpi_name ? String(rec.kpi_name) : null;
    if (kName) {
      frameworks.get(fName).kpis.push({
        name: kName,
        value: String(rec.kpi_value ?? ""),
        trend: trendArrow(rec.kpi_trend)
      });
    }
  }
  const lines = [];
  lines.push(`# ${domain} \u2014 Map of Content`);
  lines.push("");
  lines.push(`> Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`);
  lines.push(`> Source: WidgeTDC Neo4j Knowledge Graph`);
  lines.push("");
  if (frameworks.size > 0) {
    lines.push("## Frameworks");
    lines.push("");
    for (const [fName, fData] of frameworks) {
      lines.push(`- [[${fName}]] (${fData.kpis.length} KPIs)`);
    }
    lines.push("");
    lines.push("## KPIs");
    lines.push("");
    for (const [fName, fData] of frameworks) {
      if (fData.kpis.length === 0) continue;
      lines.push(`### ${fName}`);
      lines.push("");
      for (const kpi of fData.kpis) {
        const valueStr = kpi.value ? `: ${kpi.value} ${kpi.trend}` : ` ${kpi.trend}`;
        lines.push(`- ${kpi.name}${valueStr}`);
      }
      lines.push("");
    }
  } else {
    lines.push("*No frameworks found for this domain.*");
    lines.push("");
  }
  const recsQuery = `
    MATCH (d:ConsultingDomain {name: $domain})-[:HAS_FRAMEWORK]->(f)-[:HAS_KPI]->(k)-[:HAS_RECOMMENDATION]->(r)
    RETURN r.name AS rec_name, r.description AS rec_desc, elementId(r) AS rec_id
    LIMIT 20
  `;
  const recsResult = await callMcp2("graph.read_cypher", { query: recsQuery, params: { domain } });
  const recs = recsResult.ok ? extractRecords(recsResult.data) : [];
  if (recs.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    for (const rec of recs) {
      const name = String(rec.rec_name ?? "Unnamed");
      const desc = rec.rec_desc ? ` \u2014 ${String(rec.rec_desc)}` : "";
      const id = String(rec.rec_id ?? "");
      lines.push(`- [${name}](obsidian://widgetdc-open?artifact=${encodeURIComponent(id)})${desc}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`*Map of Content for ${domain} \u2014 WidgeTDC Adoption Blueprint*`);
  logger.info({ domain, frameworks: frameworks.size, records: records.length }, "MOC generated");
  res.type("text/markdown").send(lines.join("\n"));
});
function trendArrow(trend) {
  if (!trend) return "\u2192";
  const t = trend.toLowerCase();
  if (t === "up" || t === "rising" || t === "increasing") return "\u2191";
  if (t === "down" || t === "falling" || t === "decreasing") return "\u2193";
  return "\u2192";
}

// src/routes/monitor.ts
init_mcp_caller();
import { Router as Router17 } from "express";

// src/context-compress.ts
init_cognitive_proxy();
init_logger();
var DEFAULT_MAX_TOKENS = 2e3;
var AVG_CHARS_PER_TOKEN = 4;
async function compressContext(content, options) {
  const t0 = Date.now();
  const strategy = options?.strategy ?? "hybrid";
  const maxChars = (options?.maxTokens ?? DEFAULT_MAX_TOKENS) * AVG_CHARS_PER_TOKEN;
  if (content.length <= maxChars) {
    return {
      original_length: content.length,
      compressed_length: content.length,
      compression_ratio: 1,
      strategy,
      content,
      duration_ms: Date.now() - t0
    };
  }
  let compressed;
  switch (strategy) {
    case "fold":
      compressed = await foldCompress(content, maxChars);
      break;
    case "truncate":
      compressed = smartTruncate(content, maxChars);
      break;
    case "dedupe":
      compressed = deduplicateBlocks(content, maxChars);
      break;
    case "hybrid":
      compressed = deduplicateBlocks(content, maxChars * 2);
      if (compressed.length > maxChars) {
        compressed = await foldCompress(compressed, maxChars);
      }
      break;
    default:
      compressed = smartTruncate(content, maxChars);
  }
  const result = {
    original_length: content.length,
    compressed_length: compressed.length,
    compression_ratio: compressed.length / content.length,
    strategy,
    content: compressed,
    duration_ms: Date.now() - t0
  };
  logger.debug({
    strategy,
    original: content.length,
    compressed: compressed.length,
    ratio: result.compression_ratio.toFixed(2)
  }, "Context compressed");
  return result;
}
async function foldCompress(content, maxChars) {
  if (!isRlmAvailable()) {
    return smartTruncate(content, maxChars);
  }
  try {
    const result = await callCognitive("fold", {
      prompt: `Compress the following context to approximately ${Math.round(maxChars / AVG_CHARS_PER_TOKEN)} tokens while preserving all key facts, entities, relationships, and actionable information. Remove redundancy but keep semantic density high. Output ONLY the compressed text, no preamble.`,
      context: { content: content.slice(0, 16e3) },
      // RLM input limit
      agent_id: "context-compressor"
    }, 3e4);
    const compressed = String(result ?? "");
    if (compressed.length > 0 && compressed.length < content.length) {
      return compressed.slice(0, maxChars);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "RLM fold failed, falling back to truncation");
  }
  return smartTruncate(content, maxChars);
}
function smartTruncate(content, maxChars) {
  if (content.length <= maxChars) return content;
  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = Math.floor(maxChars * 0.3);
  const separator = "\n\n[...compressed...]\n\n";
  const head = content.slice(0, headSize);
  const tail = content.slice(-tailSize);
  return head + separator + tail;
}
function deduplicateBlocks(content, maxChars) {
  const blocks = content.split(/\n{2,}/);
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const block of blocks) {
    const normalized = block.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized.length < 10) continue;
    const key = normalized.slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(block.trim());
  }
  const result = unique.join("\n\n");
  return result.length > maxChars ? smartTruncate(result, maxChars) : result;
}
async function expandContext(compressed, targetFormat) {
  if (!isRlmAvailable()) return compressed;
  const formatInstructions = {
    graph_mutations: "Expand into specific Neo4j Cypher mutations (CREATE/MERGE/SET statements) that would persist these insights into a knowledge graph.",
    detailed_response: "Expand into a detailed, well-structured response with sections, examples, and actionable recommendations.",
    action_plan: "Expand into a concrete action plan with numbered steps, responsible agents, and expected outcomes."
  };
  try {
    const result = await callCognitive("reason", {
      prompt: `${formatInstructions[targetFormat]}

Compressed context:
${compressed}`,
      agent_id: "context-expander"
    }, 3e4);
    return String(result ?? compressed);
  } catch {
    return compressed;
  }
}

// src/routes/monitor.ts
init_chain_engine();
init_cognitive_proxy();
init_logger();
import { v4 as uuid20 } from "uuid";
var monitorRouter = Router17();
async function graphRead2(cypher) {
  const result = await callMcpTool({
    toolName: "graph.read_cypher",
    args: { query: cypher },
    callId: uuid20(),
    timeoutMs: 1e4
  });
  if (result.status !== "success") return [];
  const data = result.result;
  return data?.results || data || [];
}
function neo4jInt2(val) {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "object" && "low" in val) return val.low;
  return Number(val) || 0;
}
monitorRouter.get("/status", async (_req, res) => {
  try {
    const [
      evolutionEvents,
      failureMemory,
      selfCorrections,
      biTemporalNodes,
      graphStats
    ] = await Promise.all([
      graphRead2(`
        MATCH (e:EvolutionEvent)
        WHERE e.timestamp > datetime() - duration('P7D')
        RETURN count(e) AS events_7d,
               avg(toFloat(coalesce(e.pass_rate, 0))) AS avg_pass_rate,
               max(e.timestamp) AS latest
      `),
      graphRead2(`
        MATCH (f:FailureMemory)
        RETURN count(f) AS total,
               sum(CASE WHEN f.resolved IS NOT NULL THEN 1 ELSE 0 END) AS resolved
      `),
      graphRead2(`
        MATCH (s:SelfCorrectionEvent)
        RETURN count(s) AS runs,
               sum(s.total_fixed) AS total_fixed,
               max(s.timestamp) AS latest
        LIMIT 1
      `),
      graphRead2(`
        MATCH (n)
        WHERE n.valid_from IS NOT NULL
        RETURN count(n) AS temporal_nodes
      `),
      graphRead2(`
        MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count
        ORDER BY count DESC LIMIT 15
      `)
    ]);
    const ev = evolutionEvents[0] || {};
    const fm = failureMemory[0] || {};
    const sc = selfCorrections[0] || {};
    const bt = biTemporalNodes[0] || {};
    const cronJobs = listCronJobs();
    const recentChains = listExecutions().slice(0, 5);
    res.json({
      success: true,
      data: {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        evolution: {
          events_last_7d: neo4jInt2(ev.events_7d),
          avg_pass_rate: ev.avg_pass_rate ?? null,
          latest_event: ev.latest
        },
        failure_memory: {
          total: neo4jInt2(fm.total),
          resolved: neo4jInt2(fm.resolved),
          unresolved: neo4jInt2(fm.total) - neo4jInt2(fm.resolved)
        },
        self_corrections: {
          total_runs: neo4jInt2(sc.runs),
          total_fixed: neo4jInt2(sc.total_fixed),
          latest_run: sc.latest
        },
        bi_temporal: {
          nodes_with_temporal_metadata: neo4jInt2(bt.temporal_nodes)
        },
        features: {
          "1_bi_temporal_edges": neo4jInt2(bt.temporal_nodes) > 0 ? "active" : "pending",
          "2_self_correcting_graph": neo4jInt2(sc.runs) > 0 ? "active" : "registered",
          "3_context_compression": isRlmAvailable() ? "available" : "no_rlm",
          "4_adaptive_graph_of_thoughts": "active",
          "5_gvu_debate": "active",
          "6_dual_channel_rag": "active"
        },
        cron_jobs: cronJobs.map((j) => ({
          id: j.id,
          name: j.name,
          schedule: j.schedule,
          enabled: j.enabled,
          last_run: j.last_run,
          last_status: j.last_status,
          run_count: j.run_count
        })),
        recent_chains: recentChains.map((c) => ({
          name: c.name,
          mode: c.mode,
          status: c.status,
          steps: `${c.steps_completed}/${c.steps_total}`,
          duration_ms: c.duration_ms,
          started_at: c.started_at
        })),
        graph_stats: graphStats.map((r) => ({
          label: r.label,
          count: neo4jInt2(r.count)
        }))
      }
    });
  } catch (err) {
    logger.error({ err: String(err) }, "Monitor status error");
    res.status(500).json({ success: false, error: String(err) });
  }
});
monitorRouter.get("/features", async (_req, res) => {
  const features = [
    {
      id: 1,
      name: "Bi-Temporal Edges",
      source: "Graphiti/Zep (2024)",
      status: "active",
      description: "Nodes get valid_from/valid_to + temporal_version. Self-correcting agent adds temporal metadata to nodes missing it.",
      endpoint: null,
      cron: "graph-self-correct (adds bi-temporal metadata)"
    },
    {
      id: 2,
      name: "Self-Correcting Graph Agent",
      source: "Globant (2025)",
      status: "active",
      description: "Detects orphaned nodes, stale failures, missing metadata, duplicates. Runs every 2 hours via cron.",
      endpoint: "POST /monitor/self-correct",
      cron: "graph-self-correct (every 2h)"
    },
    {
      id: 3,
      name: "Active Context Compression",
      source: "arXiv 2601.07190",
      status: isRlmAvailable() ? "active" : "degraded",
      description: "Context Folding IN/OUT via RLM Engine. Strategies: fold, truncate, dedupe, hybrid.",
      endpoint: "POST /monitor/compress",
      cron: null
    },
    {
      id: 4,
      name: "Adaptive Graph of Thoughts (AGoT)",
      source: "arXiv 2502.05078",
      status: "active",
      description: "Chain engine auto-selects topology (sequential/parallel/debate) based on query complexity classification.",
      endpoint: "POST /chains/execute (mode: adaptive)",
      cron: null
    },
    {
      id: 5,
      name: "GVU Self-Improvement Loop",
      source: "Chojecki (2025)",
      status: "active",
      description: "Generator-Verifier-Updater pattern in debate chains. Judge scores positions 0-1, enforces confidence threshold.",
      endpoint: "POST /chains/execute (mode: debate)",
      cron: null
    },
    {
      id: 6,
      name: "Dual-Channel RAG",
      source: "Nature (2025)",
      status: "active",
      description: "Parallel SRAG vector search + Neo4j Cypher path traversal, merged by relevance score.",
      endpoint: "POST /chat/rag",
      cron: null
    }
  ];
  res.json({ success: true, data: { features, count: features.length } });
});
monitorRouter.post("/self-correct", async (_req, res) => {
  try {
    const report = await runSelfCorrect();
    res.json({ success: true, data: report });
  } catch (err) {
    logger.error({ err: String(err) }, "Self-correct trigger error");
    res.status(500).json({ success: false, error: String(err) });
  }
});
monitorRouter.post("/compress", async (req, res) => {
  const { content, strategy, max_tokens, expand_format } = req.body;
  if (!content || typeof content !== "string") {
    res.status(400).json({ success: false, error: "content (string) required" });
    return;
  }
  try {
    const result = await compressContext(content, {
      strategy: strategy ?? "hybrid",
      maxTokens: max_tokens
    });
    let expanded;
    if (expand_format) {
      expanded = await expandContext(result.content, expand_format);
    }
    res.json({
      success: true,
      data: {
        ...result,
        ...expanded ? { expanded } : {}
      }
    });
  } catch (err) {
    logger.error({ err: String(err) }, "Compress error");
    res.status(500).json({ success: false, error: String(err) });
  }
});

// src/routes/assembly.ts
init_redis();
init_logger();
init_mcp_caller();
init_cognitive_proxy();
import { Router as Router18 } from "express";
import { v4 as uuid21 } from "uuid";
var assemblyRouter = Router18();
var REDIS_PREFIX4 = "orchestrator:assembly:";
var REDIS_INDEX2 = "orchestrator:assemblies:index";
var TTL_SECONDS6 = 2592e3;
async function storeAssembly(assembly) {
  const redis2 = getRedis();
  if (!redis2) return false;
  try {
    await redis2.set(`${REDIS_PREFIX4}${assembly.$id}`, JSON.stringify(assembly), "EX", TTL_SECONDS6);
    await redis2.sadd(REDIS_INDEX2, assembly.$id);
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis store failed for assembly");
    return false;
  }
}
async function loadAssembly(id) {
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const raw = await redis2.get(`${REDIS_PREFIX4}${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function listAllIds2() {
  const redis2 = getRedis();
  if (!redis2) return [];
  try {
    return await redis2.smembers(REDIS_INDEX2);
  } catch {
    return [];
  }
}
assemblyRouter.post("/compose", async (req, res) => {
  const body = req.body;
  const blockIds = body.block_ids;
  const query = String(body.query ?? body.context ?? "");
  const domains = body.domains;
  const maxCandidates = Math.min(Math.max(Number(body.max_candidates ?? 3), 1), 10);
  let blocks = [];
  try {
    let cypher;
    let params = {};
    if (blockIds && blockIds.length > 0) {
      cypher = `MATCH (b) WHERE b.id IN $ids AND (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
RETURN b.id AS block_id, b.name AS block_name, labels(b)[0] AS block_type, b.domain AS domain
ORDER BY b.name`;
      params = { ids: blockIds };
    } else if (domains && domains.length > 0) {
      cypher = `MATCH (b) WHERE b.domain IN $domains AND (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
RETURN b.id AS block_id, b.name AS block_name, labels(b)[0] AS block_type, b.domain AS domain
ORDER BY b.domain, b.name LIMIT 50`;
      params = { domains };
    } else {
      cypher = `MATCH (b) WHERE (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
RETURN b.id AS block_id, b.name AS block_name, labels(b)[0] AS block_type, b.domain AS domain
ORDER BY b.domain, b.name LIMIT 50`;
    }
    const graphResult = await callMcpTool({
      toolName: "graph.read_cypher",
      args: { query: cypher, params },
      callId: uuid21(),
      timeoutMs: 15e3
    });
    if (graphResult.status === "success" && graphResult.result) {
      const records = Array.isArray(graphResult.result) ? graphResult.result : Array.isArray(graphResult.result?.records) ? graphResult.result.records : [];
      blocks = records.map((r) => ({
        block_id: String(r.block_id ?? r.id ?? ""),
        block_name: String(r.block_name ?? r.name ?? "Unknown"),
        block_type: String(r.block_type ?? r.type ?? "Block"),
        domain: String(r.domain ?? "general")
      })).filter((b) => b.block_id);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Failed to fetch blocks from graph");
  }
  if (blocks.length === 0) {
    res.status(404).json({
      success: false,
      error: { code: "NO_BLOCKS", message: "No blocks found matching criteria", status_code: 404 }
    });
    return;
  }
  let analysis = { candidates: [] };
  try {
    const prompt = `You are an architecture assembly composer. Given these building blocks, compose ${maxCandidates} candidate architecture assemblies.

BLOCKS:
${blocks.map((b) => `- ${b.block_id}: ${b.block_name} (${b.block_type}, domain: ${b.domain})`).join("\n")}

${query ? `CONTEXT: ${query}` : ""}

For each candidate assembly:
1. Select a coherent subset of blocks that work together
2. Identify missing dependencies (blocks that should exist but don't)
3. Detect conflicts between selected blocks
4. Score coherence (0-1) and coverage (0-1)

Reply as JSON:
{"candidates": [{"name": "...", "description": "...", "block_ids": ["..."], "missing": ["description of missing block"], "conflicts": [{"block_a": "id", "block_b": "id", "conflict_type": "contradictory|overlapping|incompatible", "description": "..."}], "coherence": 0.0, "coverage": 0.0}]}`;
    const result = await callCognitive("analyze", {
      prompt,
      context: { blocks, query },
      agent_id: "orchestrator"
    }, 3e4);
    const text = String(result ?? "");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      analysis = JSON.parse(match[0]);
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "LLM analysis failed, creating single assembly from all blocks");
    analysis = {
      candidates: [{
        name: "Default Assembly",
        description: "All available blocks composed together",
        block_ids: blocks.map((b) => b.block_id),
        missing: [],
        conflicts: [],
        coherence: 0.5,
        coverage: 0.5
      }]
    };
  }
  const assemblies = [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const candidate of analysis.candidates.slice(0, maxCandidates)) {
    const assemblyId = `widgetdc:assembly:${uuid21()}`;
    const selectedBlocks = blocks.filter((b) => candidate.block_ids.includes(b.block_id));
    const conflictCount = candidate.conflicts?.length ?? 0;
    const coherence = Math.max(0, Math.min(1, candidate.coherence ?? 0.5));
    const coverage = Math.max(0, Math.min(1, candidate.coverage ?? 0.5));
    const composite = coherence * 0.4 + coverage * 0.4 + Math.max(0, 1 - conflictCount * 0.2) * 0.2;
    const assembly = {
      $id: assemblyId,
      $schema: "widgetdc:assembly:v1",
      name: candidate.name || "Unnamed Assembly",
      description: candidate.description || "",
      blocks: selectedBlocks,
      missing_blocks: candidate.missing ?? [],
      conflicts: candidate.conflicts ?? [],
      scores: {
        coherence,
        coverage,
        conflict_count: conflictCount,
        composite: Math.round(composite * 1e3) / 1e3
      },
      lineage: {
        source_query: query,
        composed_at: now,
        composed_by: "orchestrator:assembly-composer",
        block_count: selectedBlocks.length
      },
      status: "draft",
      created_at: now,
      updated_at: now
    };
    await storeAssembly(assembly);
    assemblies.push(assembly);
    try {
      await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `MERGE (a:Assembly {id: $id})
SET a.name = $name, a.description = $description,
    a.coherence = $coherence, a.coverage = $coverage,
    a.conflict_count = $conflictCount, a.composite = $composite,
    a.block_count = $blockCount, a.status = 'draft',
    a.created_at = datetime(), a.source_query = $query
WITH a
UNWIND $blockIds AS bid
MATCH (b) WHERE b.id = bid AND (b:Block OR b:ArchitectureBlock OR b:LegoBlock)
MERGE (a)-[:COMPOSED_OF]->(b)`,
          params: {
            id: assemblyId,
            name: assembly.name,
            description: assembly.description,
            coherence,
            coverage,
            conflictCount,
            composite: assembly.scores.composite,
            blockCount: selectedBlocks.length,
            query: query.slice(0, 500),
            blockIds: selectedBlocks.map((b) => b.block_id)
          }
        },
        callId: uuid21(),
        timeoutMs: 1e4
      });
    } catch (err) {
      logger.warn({ err: String(err), assembly_id: assemblyId }, "Failed to write assembly to Neo4j");
    }
  }
  assemblies.sort((a, b) => b.scores.composite - a.scores.composite);
  logger.info({
    count: assemblies.length,
    block_count: blocks.length,
    top_score: assemblies[0]?.scores.composite
  }, "Assembly composition complete");
  res.json({
    success: true,
    data: {
      assemblies,
      input_blocks: blocks.length,
      candidates_generated: assemblies.length
    }
  });
});
assemblyRouter.get("/", async (req, res) => {
  const statusFilter = req.query.status;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50")), 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0")), 0);
  const allIds = await listAllIds2();
  const redis2 = getRedis();
  if (!redis2 || allIds.length === 0) {
    res.json({ assemblies: [], total: 0, limit, offset });
    return;
  }
  const assemblies = [];
  try {
    const pipeline = redis2.pipeline();
    for (const id of allIds) {
      pipeline.get(`${REDIS_PREFIX4}${id}`);
    }
    const results = await pipeline.exec();
    if (results) {
      for (const [err, raw] of results) {
        if (!err && typeof raw === "string") {
          try {
            assemblies.push(JSON.parse(raw));
          } catch {
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis pipeline failed for assembly list");
  }
  let filtered = assemblies;
  if (statusFilter) {
    filtered = filtered.filter((a) => a.status === statusFilter);
  }
  filtered.sort((a, b) => b.scores.composite - a.scores.composite);
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  res.json({ assemblies: page, total, limit, offset });
});
assemblyRouter.get("/:id", async (req, res) => {
  const assembly = await loadAssembly(req.params.id);
  if (!assembly) {
    res.status(404).json({ success: false, error: "Assembly not found" });
    return;
  }
  res.json({ success: true, data: assembly });
});
assemblyRouter.put("/:id", async (req, res) => {
  const assembly = await loadAssembly(req.params.id);
  if (!assembly) {
    res.status(404).json({ success: false, error: "Assembly not found" });
    return;
  }
  const body = req.body;
  if (body.status && ["draft", "accepted", "rejected"].includes(body.status)) {
    assembly.status = body.status;
  }
  if (body.name) assembly.name = body.name;
  if (body.description) assembly.description = body.description;
  assembly.updated_at = (/* @__PURE__ */ new Date()).toISOString();
  await storeAssembly(assembly);
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: "MATCH (a:Assembly {id: $id}) SET a.status = $status, a.updated_at = datetime()",
        params: { id: assembly.$id, status: assembly.status }
      },
      callId: uuid21(),
      timeoutMs: 5e3
    });
  } catch {
  }
  res.json({ success: true, data: assembly });
});

// src/routes/decisions.ts
init_redis();
init_logger();
init_mcp_caller();
init_cognitive_proxy();
init_sse();
import { Router as Router19 } from "express";
import { v4 as uuid22 } from "uuid";
var decisionsRouter = Router19();
var REDIS_PREFIX5 = "orchestrator:decision:";
var REDIS_INDEX3 = "orchestrator:decisions:index";
var TTL_SECONDS7 = 7776e3;
async function storeDecision(decision) {
  const redis2 = getRedis();
  if (!redis2) return false;
  try {
    await redis2.set(`${REDIS_PREFIX5}${decision.$id}`, JSON.stringify(decision), "EX", TTL_SECONDS7);
    await redis2.sadd(REDIS_INDEX3, decision.$id);
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis store failed for decision");
    return false;
  }
}
async function loadDecision(id) {
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const raw = await redis2.get(`${REDIS_PREFIX5}${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function listAllIds3() {
  const redis2 = getRedis();
  if (!redis2) return [];
  try {
    return await redis2.smembers(REDIS_INDEX3);
  } catch {
    return [];
  }
}
async function buildLineageChain(assemblyId) {
  const lineage = [];
  try {
    const result = await callMcpTool({
      toolName: "graph.read_cypher",
      args: {
        query: `MATCH (a:Assembly {id: $assemblyId})
OPTIONAL MATCH (a)-[:COMPOSED_OF]->(b)
WHERE b:Block OR b:ArchitectureBlock OR b:LegoBlock
OPTIONAL MATCH (b)-[:DERIVED_FROM|EXTRACTED_FROM]->(p)
WHERE p:Pattern OR p:Signal OR p:StrategicInsight
RETURN a.id AS asm_id, a.name AS asm_name, a.created_at AS asm_ts,
       b.id AS block_id, b.name AS block_name, labels(b)[0] AS block_type, b.created_at AS block_ts,
       p.id AS source_id, p.name AS source_name, labels(p)[0] AS source_type, p.createdAt AS source_ts
ORDER BY b.name`,
        params: { assemblyId }
      },
      callId: uuid22(),
      timeoutMs: 15e3
    });
    if (result.status === "success") {
      const records = Array.isArray(result.result) ? result.result : Array.isArray(result.result?.records) ? result.result.records : [];
      if (records.length > 0) {
        const r = records[0];
        lineage.push({
          stage: "assembly",
          node_id: String(r.asm_id ?? assemblyId),
          node_type: "Assembly",
          name: String(r.asm_name ?? assemblyId),
          timestamp: r.asm_ts ? String(r.asm_ts) : void 0
        });
      }
      const seenBlocks = /* @__PURE__ */ new Set();
      const seenSources = /* @__PURE__ */ new Set();
      for (const r of records) {
        if (r.block_id && !seenBlocks.has(String(r.block_id))) {
          seenBlocks.add(String(r.block_id));
          lineage.push({
            stage: "block",
            node_id: String(r.block_id),
            node_type: String(r.block_type ?? "Block"),
            name: String(r.block_name ?? r.block_id),
            timestamp: r.block_ts ? String(r.block_ts) : void 0
          });
        }
        if (r.source_id && !seenSources.has(String(r.source_id))) {
          seenSources.add(String(r.source_id));
          const sourceType = String(r.source_type ?? "Unknown");
          const stage = sourceType.includes("Signal") ? "signal" : sourceType.includes("Pattern") ? "pattern" : "signal";
          lineage.push({
            stage,
            node_id: String(r.source_id),
            node_type: sourceType,
            name: String(r.source_name ?? r.source_id),
            timestamp: r.source_ts ? String(r.source_ts) : void 0
          });
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err), assemblyId }, "Failed to build lineage chain");
  }
  return lineage;
}
decisionsRouter.post("/certify", async (req, res) => {
  const body = req.body;
  if (!body.assembly_id || !body.title) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Required: assembly_id, title", status_code: 400 }
    });
    return;
  }
  const assemblyId = String(body.assembly_id);
  const title = String(body.title);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const decisionId = `widgetdc:decision:${uuid22()}`;
  const lineageChain = await buildLineageChain(assemblyId);
  let rationale = String(body.rationale ?? "");
  let summary = String(body.summary ?? "");
  if (!rationale || !summary) {
    try {
      const result = await callCognitive("analyze", {
        prompt: `You are a decision certifier for an architecture synthesis platform.

Decision: "${title}"
Assembly: ${assemblyId}
Lineage: ${lineageChain.length} nodes traced (${lineageChain.map((l) => `${l.stage}:${l.name}`).join(" \u2192 ")})
${body.context ? `Context: ${JSON.stringify(body.context)}` : ""}

Generate:
1. A concise summary (1-2 sentences)
2. A rationale explaining why this decision was made based on the evidence chain

Reply as JSON: {"summary": "...", "rationale": "..."}`,
        context: { assembly_id: assemblyId, lineage: lineageChain },
        agent_id: "orchestrator"
      }, 2e4);
      const text = String(result ?? "");
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (!summary) summary = parsed.summary ?? title;
        if (!rationale) rationale = parsed.rationale ?? "Auto-certified based on assembly lineage";
      }
    } catch {
      if (!summary) summary = title;
      if (!rationale) rationale = "Certified from accepted assembly with verified lineage";
    }
  }
  const proof = {
    verified_at: now,
    verified_by: String(body.certifier ?? "orchestrator:decision-engine")
  };
  try {
    const [healthResult] = await Promise.allSettled([
      fetch("https://orchestrator-production-c27e.up.railway.app/health", { signal: AbortSignal.timeout(5e3) }).then((r) => r.json())
    ]);
    if (healthResult.status === "fulfilled") {
      const h = healthResult.value;
      proof.service_health = {
        orchestrator: String(h.status ?? "unknown"),
        redis: h.redis_enabled ? "connected" : "disconnected",
        rlm: h.rlm_available ? "available" : "unavailable"
      };
    }
  } catch {
  }
  if (body.test_results && typeof body.test_results === "object") {
    proof.test_results = body.test_results;
  }
  if (body.deploy_sha) proof.deploy_sha = String(body.deploy_sha);
  const certificate = {
    $id: decisionId,
    $schema: "widgetdc:decision:v1",
    title,
    summary,
    rationale,
    assembly_id: assemblyId,
    lineage_chain: lineageChain,
    evidence_refs: Array.isArray(body.evidence_refs) ? body.evidence_refs : lineageChain.map((l) => l.node_id),
    arbitration_outcome: String(body.arbitration_outcome ?? "accepted"),
    production_proof: proof,
    certified_at: now,
    certifier_agent: String(body.certifier ?? "orchestrator:decision-engine"),
    status: "certified",
    tags: Array.isArray(body.tags) ? body.tags : []
  };
  await storeDecision(certificate);
  try {
    await callMcpTool({
      toolName: "graph.write_cypher",
      args: {
        query: `CREATE (d:Decision {
  id: $id, title: $title, summary: $summary, rationale: $rationale,
  assembly_id: $assemblyId, status: 'certified',
  certified_at: datetime(), certifier_agent: $certifier,
  lineage_depth: $lineageDepth, evidence_count: $evidenceCount
})
WITH d
MATCH (a:Assembly {id: $assemblyId})
CREATE (d)-[:BASED_ON]->(a)
WITH d
UNWIND $evidenceIds AS eid
MATCH (e) WHERE e.id = eid
CREATE (d)-[:CERTIFIED_BY_EVIDENCE]->(e)`,
        params: {
          id: decisionId,
          title,
          summary,
          rationale,
          assemblyId,
          certifier: certificate.certifier_agent,
          lineageDepth: lineageChain.length,
          evidenceCount: certificate.evidence_refs.length,
          evidenceIds: certificate.evidence_refs.slice(0, 20)
          // Cap for query size
        }
      },
      callId: uuid22(),
      timeoutMs: 15e3
    });
  } catch (err) {
    logger.warn({ err: String(err), decision_id: decisionId }, "Failed to write decision to Neo4j");
  }
  broadcastSSE("decision-certified", {
    decision_id: decisionId,
    title,
    assembly_id: assemblyId,
    lineage_depth: lineageChain.length
  });
  logger.info({
    decision_id: decisionId,
    title,
    assembly_id: assemblyId,
    lineage_depth: lineageChain.length
  }, "Decision certified");
  res.status(201).json({ success: true, data: certificate });
});
decisionsRouter.get("/", async (req, res) => {
  const statusFilter = req.query.status;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50")), 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset ?? "0")), 0);
  const allIds = await listAllIds3();
  const redis2 = getRedis();
  if (!redis2 || allIds.length === 0) {
    res.json({ decisions: [], total: 0, limit, offset });
    return;
  }
  const decisions = [];
  try {
    const pipeline = redis2.pipeline();
    for (const id of allIds) {
      pipeline.get(`${REDIS_PREFIX5}${id}`);
    }
    const results = await pipeline.exec();
    if (results) {
      for (const [err, raw] of results) {
        if (!err && typeof raw === "string") {
          try {
            decisions.push(JSON.parse(raw));
          } catch {
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Redis pipeline failed for decisions list");
  }
  let filtered = decisions;
  if (statusFilter) {
    filtered = filtered.filter((d) => d.status === statusFilter);
  }
  filtered.sort((a, b) => b.certified_at.localeCompare(a.certified_at));
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  res.json({ decisions: page, total, limit, offset });
});
decisionsRouter.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (id === "lineage") {
    res.status(400).json({ success: false, error: "Provide a decision ID" });
    return;
  }
  const decision = await loadDecision(id);
  if (!decision) {
    res.status(404).json({ success: false, error: "Decision not found" });
    return;
  }
  res.json({ success: true, data: decision });
});
decisionsRouter.get("/:id/lineage", async (req, res) => {
  const decision = await loadDecision(req.params.id);
  if (!decision) {
    res.status(404).json({ success: false, error: "Decision not found" });
    return;
  }
  const stages = {};
  for (const entry of decision.lineage_chain) {
    if (!stages[entry.stage]) stages[entry.stage] = [];
    stages[entry.stage].push(entry);
  }
  res.json({
    success: true,
    data: {
      decision_id: decision.$id,
      title: decision.title,
      certified_at: decision.certified_at,
      assembly_id: decision.assembly_id,
      lineage_chain: decision.lineage_chain,
      lineage_by_stage: stages,
      depth: decision.lineage_chain.length,
      stages_covered: Object.keys(stages),
      production_proof: decision.production_proof
    }
  });
});

// src/routes/s1-s4.ts
init_chain_engine();
init_logger();
import { Router as Router20 } from "express";
var s1s4Router = Router20();
s1s4Router.post("/trigger", async (req, res) => {
  const { url, source_type, topic, weights } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: "URL or path is required" });
  }
  logger.info({ url, topic }, "\u{1F6F0}\uFE0F Triggering S1-S4 Pipeline");
  try {
    const execution = await executeChain({
      name: `S1-S4: ${topic || "General Intelligence"}`,
      mode: "sequential",
      steps: [
        {
          agent_id: "harvester",
          tool_name: "osint.scrape",
          // S1: Extract
          arguments: { url, max_lines: 50 }
        },
        {
          agent_id: "orchestrator",
          cognitive_action: "analyze",
          // S2: Map
          prompt: `Transform this raw data into a valid IntelligenceObservation (snake_case).
                   Context: Topic=${topic || "General"}, Weights=${JSON.stringify(weights || {})}.
                   Data: {{prev}}`
        },
        {
          agent_id: "orchestrator",
          tool_name: "graph.write_cypher",
          // S3: Sync/Inject
          arguments: {
            query: `
              MERGE (o:IntelligenceObservation {id: apoc.create.uuid()})
              SET o.title = $title,
                  o.source_type = $source_type,
                  o.content_summary = $summary,
                  o.actor_name = $actor,
                  o.url = $url,
                  o.timestamp = datetime(),
                  o.salience_score = $score
              RETURN o.id
            `,
            parameters: {
              url,
              source_type: source_type || "MEDIA"
              // Note: Parameters will be extracted from step 2 output in real flow
            }
          }
        },
        {
          agent_id: "sentinel",
          tool_name: "audit.run",
          // S4: Sentinel/Verify
          arguments: { target_id: "{{prev}}" }
        }
      ]
    });
    res.json({ success: true, execution_id: execution.execution_id });
  } catch (error) {
    logger.error({ error: String(error) }, "S1-S4 Trigger failed");
    res.status(500).json({ success: false, error: String(error) });
  }
});

// src/index.ts
init_sse();
init_agent_registry();
init_chat_broadcaster();

// src/auth.ts
init_config();
init_logger();
function requireApiKey(req, res, next) {
  if (!config.orchestratorApiKey) {
    next();
    return;
  }
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const apiKeyHeader = req.headers["x-api-key"] ?? "";
  const queryKey = req.query["api_key"] ?? "";
  if (token === config.orchestratorApiKey || apiKeyHeader === config.orchestratorApiKey || queryKey === config.orchestratorApiKey) {
    next();
    return;
  }
  logger.warn({ path: req.path, ip: req.ip }, "Unauthorized request");
  res.status(401).json({
    success: false,
    error: { code: "UNAUTHORIZED", message: "Valid API key required. Use Authorization: Bearer <key> or X-API-Key header.", status_code: 401 }
  });
}

// src/index.ts
init_slack();
init_cognitive_proxy();
init_chain_engine();

// src/state-machine.ts
init_logger();
init_redis();
init_chain_engine();
var REDIS_FSM_PREFIX = "orchestrator:fsm:";
async function listPlans() {
  const redis2 = getRedis();
  if (!redis2) return [];
  try {
    const keys = await redis2.keys(`${REDIS_FSM_PREFIX}*`);
    const plans = [];
    for (const key of keys) {
      const raw = await redis2.get(key);
      if (raw) plans.push(JSON.parse(raw));
    }
    return plans.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } catch {
    return [];
  }
}

// src/harvest-pipeline.ts
init_logger();
init_mcp_caller();
import { v4 as uuid23 } from "uuid";
async function extract(domain) {
  const callId = `harvest-extract-${uuid23().substring(0, 8)}`;
  try {
    const result = await callMcpTool({
      toolName: "srag.query",
      args: {
        query: `Find reusable consulting frameworks, templates, and solution patterns in the ${domain} domain. Focus on methodologies that can be generalized across clients.`
      },
      callId,
      timeoutMs: 3e4
    });
    const items = result?.sources ?? result?.results ?? [];
    logger.info({ domain, items: Array.isArray(items) ? items.length : 0 }, "Harvest extract complete");
    return Array.isArray(items) ? items : [];
  } catch (err) {
    logger.warn({ domain, err: String(err) }, "Harvest extract failed");
    return [];
  }
}
function generalize(items, domain) {
  return items.map((item, i) => {
    const name = String(item.name ?? item.title ?? `${domain}-pattern-${i}`);
    const content = String(item.content ?? item.description ?? item.summary ?? "");
    let tier = "component";
    if (content.length > 2e3 || name.toLowerCase().includes("framework")) tier = "framework";
    else if (content.length > 500 || name.toLowerCase().includes("template")) tier = "template";
    return {
      id: `harvest-${uuid23().substring(0, 12)}`,
      name,
      tier,
      description: content.substring(0, 300),
      content: content.substring(0, 5e3),
      // Cap at 5K chars
      industries: [domain],
      capabilities: [],
      reuse_count: 0,
      status: "draft",
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      source: `harvest-pipeline/${domain}`
    };
  });
}
async function store(components) {
  if (components.length === 0) return 0;
  const callId = `harvest-store-${uuid23().substring(0, 8)}`;
  const labelMap = {
    framework: "Framework",
    template: "Template",
    component: "Component"
  };
  let stored = 0;
  for (const comp of components) {
    try {
      const label = labelMap[comp.tier];
      await callMcpTool({
        toolName: "graph.write_cypher",
        args: {
          query: `MERGE (c:${label}:HarvestedComponent {id: $id})
                  SET c.name = $name, c.description = $desc, c.content = $content,
                      c.tier = $tier, c.status = $status, c.reuseCount = $reuseCount,
                      c.source = $source, c.createdAt = datetime()
                  WITH c
                  UNWIND $industries AS ind
                  MERGE (i:Industry {name: ind})
                  MERGE (c)-[:APPLICABLE_TO]->(i)
                  RETURN c.id`,
          params: {
            id: comp.id,
            name: comp.name,
            desc: comp.description,
            content: comp.content,
            tier: comp.tier,
            status: comp.status,
            reuseCount: comp.reuse_count,
            source: comp.source,
            industries: comp.industries
          }
        },
        callId,
        timeoutMs: 15e3
      });
      stored++;
    } catch (err) {
      logger.warn({ id: comp.id, err: String(err) }, "Harvest store failed for component");
    }
  }
  logger.info({ stored, total: components.length }, "Harvest store complete");
  return stored;
}
async function verify(components) {
  let verified = 0;
  for (const comp of components) {
    try {
      const result = await callMcpTool({
        toolName: "srag.query",
        args: { query: `${comp.tier} for ${comp.industries[0]}: ${comp.name}` },
        callId: `harvest-verify-${uuid23().substring(0, 8)}`,
        timeoutMs: 15e3
      });
      const resultStr = JSON.stringify(result).toLowerCase();
      if (resultStr.includes(comp.name.toLowerCase().substring(0, 20))) {
        verified++;
      }
    } catch {
    }
  }
  logger.info({ verified, total: components.length }, "Harvest verify complete");
  return verified;
}
async function runHarvestPipeline(domain) {
  const start = Date.now();
  logger.info({ domain }, "Harvest pipeline starting");
  const raw = await extract(domain);
  const components = generalize(raw, domain);
  const stored = await store(components);
  const verified = await verify(components);
  const result = {
    extracted: raw.length,
    stored,
    verified,
    duration_ms: Date.now() - start
  };
  logger.info(result, "Harvest pipeline complete");
  return result;
}
async function runFullHarvest() {
  const domains = [
    "Strategy",
    "Financial",
    "Operations",
    "Technology",
    "Cybersecurity",
    "ESG & Sustainability",
    "Digital & Analytics",
    "Risk & Compliance",
    "Supply Chain",
    "Due Diligence"
  ];
  const results = {};
  for (const domain of domains) {
    results[domain] = await runHarvestPipeline(domain);
  }
  return results;
}

// src/routes/openai-compat.ts
init_llm_proxy();
import { Router as Router21 } from "express";
init_logger();
init_config();
import { v4 as uuid24 } from "uuid";
var MAX_TOOL_ROUNDS = 2;
var MAX_TOOL_ROUNDS_ASSISTANT = 4;
var TOOL_CATEGORIES = [
  { keywords: /\b(health|status|uptime|service|railway|deploy|online)\b/i, tools: ["get_platform_health"] },
  { keywords: /\b(linear|issue|task|sprint|backlog|blocker|LIN-\d+|projekt|project)\b/i, tools: ["linear_issues", "linear_issue_detail"] },
  { keywords: /\b(søg|search|find|pattern|knowledge|viden|consulting|document|artifact)\b/i, tools: ["search_knowledge", "search_documents"] },
  { keywords: /\b(analy|strateg|reason|deep|complex|evaluat|plan|why|how does|architect|OODA)\b/i, tools: ["reason_deeply", "search_knowledge"] },
  { keywords: /\b(graph|cypher|node|relation|neo4j|count|match)\b/i, tools: ["query_graph"] },
  { keywords: /\b(chain|workflow|sequential|parallel|debate|multi.step|pipeline)\b/i, tools: ["run_chain"] },
  { keywords: /\b(verify|check|quality|audit|compliance|valid)\b/i, tools: ["verify_output"] },
  { keywords: /\b(mcp|tool|call|endpoint|api)\b/i, tools: ["call_mcp_tool"] },
  { keywords: /\b(notebook|celle|cells|query.*insight|interactive.*analysis|structured.*analysis)\b/i, tools: ["create_notebook"] }
];
var FALLBACK_TOOLS = ["search_knowledge", "get_platform_health", "linear_issues"];
function selectToolsForQuery(userMessage) {
  const matched = /* @__PURE__ */ new Set();
  for (const cat of TOOL_CATEGORIES) {
    if (cat.keywords.test(userMessage)) {
      for (const t of cat.tools) matched.add(t);
    }
  }
  if (matched.size === 0) {
    for (const t of FALLBACK_TOOLS) matched.add(t);
  }
  const selected = [...matched].slice(0, 5);
  return ORCHESTRATOR_TOOLS.filter((t) => selected.includes(t.function.name));
}
var metricsBuffer = [];
var MAX_METRICS = 1e3;
function recordMetrics(model, toolCalls, toolRounds, totalTokens, toolsOffered) {
  metricsBuffer.push({ model, tool_calls: toolCalls, tool_rounds: toolRounds, total_tokens: totalTokens, timestamp: Date.now() });
  if (metricsBuffer.length > MAX_METRICS) metricsBuffer.splice(0, metricsBuffer.length - MAX_METRICS);
}
var openaiCompatRouter = Router21();
var rateLimitMap = /* @__PURE__ */ new Map();
var RATE_LIMIT_WINDOW_MS = 6e4;
var RATE_LIMIT_MAX = 30;
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}
function validateApiKey(req, res) {
  const auth = req.headers.authorization;
  if (!auth) {
    res.status(401).json({ error: { message: "Missing Authorization header", type: "auth_error", code: "unauthorized" } });
    return false;
  }
  const token = auth.replace("Bearer ", "");
  const validKeys = [config.orchestratorApiKey, config.backendApiKey].filter(Boolean);
  if (validKeys.length > 0 && !validKeys.includes(token)) {
    res.status(401).json({ error: { message: "Invalid API key", type: "auth_error", code: "unauthorized" } });
    return false;
  }
  return true;
}
var SYSTEM_PROMPT = `WidgeTDC intelligence platform. ALTID kald mindst \xE9t tool f\xF8r du svarer. Hent reel data \u2014 svar aldrig kun fra generel viden. Svar p\xE5 dansk. V\xE6r konkret og datadrevet.`;
var ASSISTANT_SUFFIX = `

VIGTIGE REGLER:
1. Kald ALTID mindst \xE9t tool f\xF8r du svarer. Start med search_knowledge eller query_graph.
2. Hvis et tool fejler eller returnerer tomt, pr\xF8v et andet tool (f.eks. query_graph med Cypher).
3. Generer ALTID et fyldigt, datadrevet svar baseret p\xE5 tool-resultater. Aldrig bare "lad mig s\xF8ge..." \u2014 gennemf\xF8r analysen.
4. Inklud\xE9r konkrete tal, frameworks og referencer i dit svar.
5. Svar p\xE5 dansk i consulting-kvalitet med struktur (overskrifter, lister, tabeller).`;
var ASSISTANTS = [
  {
    id: "compliance-auditor",
    displayName: "Compliance Auditor",
    baseModel: "claude-sonnet",
    systemPrompt: "Du er WidgeTDC Compliance Auditor. Du har adgang til 12 regulatoriske frameworks (GDPR, NIS2, DORA, CSRD, AI Act, Pillar Two, CRA, eIDAS2) og 506 GDPR enforcement cases i videngrafen (445K nodes, 3.7M relationer). Brug ALTID search_knowledge og verify_output til at hente reel compliance-data. Cit\xE9r kilder med [REG-xxxx] format. Anvend EG PMM projektmetode og BPMV procesmodel i dine anbefalinger. 32 consulting dom\xE6ner er tilg\xE6ngelige. Svar p\xE5 dansk med consulting-grade pr\xE6cision.",
    tools: ["search_knowledge", "verify_output", "query_graph"],
    promptSuggestions: ["K\xF8r NIS2 gap-analyse", "GDPR data mapping", "DORA compliance status"]
  },
  {
    id: "graph-analyst",
    displayName: "Graph Analyst",
    baseModel: "gemini-flash",
    systemPrompt: "Du er WidgeTDC Graph Analyst med direkte adgang til Neo4j videngrafen: 445,918 nodes, 3,771,937 relationer, 32 consulting dom\xE6ner, 270+ frameworks, 288 KPIs, 52,925 McKinsey insights. Brug query_graph til Cypher-foresp\xF8rgsler og search_knowledge til semantisk s\xF8gning. Visualis\xE9r resultater som tabeller og lister. Svar p\xE5 dansk.",
    tools: ["query_graph", "search_knowledge"],
    promptSuggestions: ["Vis domain-statistik", "Find orphan nodes", "Framework-d\xE6kning per dom\xE6ne"]
  },
  {
    id: "project-manager",
    displayName: "Project Manager",
    baseModel: "claude-sonnet",
    systemPrompt: "Du er WidgeTDC Project Manager. Brug linear_issues til at hente sprint-status, blockers og opgaver fra Linear. Brug search_knowledge til at forst\xE5 konteksten. Rapport\xE9r med KPIs: velocity, blockers, sprint burn. Anvend EG PMM projektmetode (faser, leverancer, gates) og BPMV procesmodel i projektplanl\xE6gning. 38 consulting-processer og 9 consulting-services er tilg\xE6ngelige i grafen. Svar p\xE5 dansk med actionable n\xE6ste-skridt.",
    tools: ["linear_issues", "linear_issue_detail", "search_knowledge"],
    promptSuggestions: ["Sprint status", "N\xE6ste prioritet", "Blocker-rapport"]
  },
  {
    id: "consulting-partner",
    displayName: "Consulting Partner",
    baseModel: "claude-opus",
    systemPrompt: "Du er WidgeTDC Consulting Partner \u2014 strategisk r\xE5dgiver med adgang til verdens mest avancerede consulting intelligence platform. 84 frameworks (Balanced Scorecard, BCG Matrix, Porter Five Forces, McKinsey 7S, Design Thinking, EG PMM, BPMV m.fl.), 52,925 McKinsey insights, 1,201 consulting artifacts, 825 KPIs, 506 case studies, 35 consulting skills, 38 processer. Brug reason_deeply for dyb analyse og search_knowledge for grafdata. Lever\xE9r consulting-grade output med frameworks, data og handlingsplaner. Svar p\xE5 dansk.",
    tools: ["reason_deeply", "search_knowledge", "query_graph"],
    promptSuggestions: ["Strategisk analyse af [emne]", "Framework selection", "Markedsanalyse"]
  },
  {
    id: "platform-health",
    displayName: "Platform Health",
    baseModel: "gemini-flash",
    systemPrompt: "Du er WidgeTDC Platform Health Monitor. Brug get_platform_health til at tjekke alle services (backend, RLM engine, orchestrator, Neo4j, Redis, Pipelines). Brug call_mcp_tool til avancerede MCP-kald. Rapport\xE9r: service health, Neo4j stats (445K nodes), agent fleet (430+ agenter), cron jobs, Redis status. Svar p\xE5 dansk med real-time data.",
    tools: ["get_platform_health", "call_mcp_tool", "query_graph"],
    promptSuggestions: ["Service status", "Neo4j health", "Agent fleet oversigt"]
  }
];
var ASSISTANT_MAP = new Map(ASSISTANTS.map((a) => [a.id, a]));
var MODELS = [
  { id: "claude-sonnet", provider: "claude", displayName: "Claude Sonnet 4" },
  { id: "claude-opus", provider: "claude", displayName: "Claude Opus 4" },
  { id: "gemini-flash", provider: "gemini", displayName: "Gemini 2.0 Flash" },
  { id: "deepseek-chat", provider: "deepseek", displayName: "DeepSeek Chat" },
  { id: "qwen-plus", provider: "qwen", displayName: "Qwen Plus" },
  { id: "gpt-4o", provider: "openai", displayName: "GPT-4o" },
  { id: "groq-llama", provider: "groq", displayName: "Groq Llama 3.3 70B" },
  // Consulting Assistants (LIN-524)
  ...ASSISTANTS.map((a) => ({ id: a.id, provider: "widgetdc", displayName: a.displayName }))
];
var MODEL_TO_PROVIDER = {
  "claude-sonnet": { provider: "claude", model: "claude-sonnet-4-20250514" },
  "claude-opus": { provider: "claude", model: "claude-opus-4-20250514" },
  "gemini-flash": { provider: "gemini", model: "gemini-2.0-flash" },
  "deepseek-chat": { provider: "deepseek", model: "deepseek-chat" },
  "qwen-plus": { provider: "qwen", model: "qwen-plus" },
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  "groq-llama": { provider: "groq", model: "llama-3.3-70b-versatile" }
};
openaiCompatRouter.get("/v1/metrics", (req, res) => {
  if (!validateApiKey(req, res)) return;
  const last24h = Date.now() - 864e5;
  const recent = metricsBuffer.filter((m) => m.timestamp > last24h);
  const toolCallCounts = {};
  const modelCounts = {};
  let totalToolRounds = 0;
  let totalTokens = 0;
  for (const m of recent) {
    modelCounts[m.model] = (modelCounts[m.model] ?? 0) + 1;
    totalToolRounds += m.tool_rounds;
    totalTokens += m.total_tokens;
    for (const tc of m.tool_calls) {
      toolCallCounts[tc] = (toolCallCounts[tc] ?? 0) + 1;
    }
  }
  const totalRequests = recent.length;
  const avgToolRounds = totalRequests > 0 ? (totalToolRounds / totalRequests).toFixed(1) : "0";
  const requestsWithTools = recent.filter((m) => m.tool_calls.length > 0).length;
  const advancedPct = totalRequests > 0 ? (requestsWithTools / totalRequests * 100).toFixed(1) : "0";
  const savings = getTokenSavings();
  const avgTokensPerRequest = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0;
  res.json({
    period: "24h",
    total_requests: totalRequests,
    requests_with_tools: requestsWithTools,
    advanced_pct: parseFloat(advancedPct),
    avg_tool_rounds: parseFloat(avgToolRounds),
    total_tokens: totalTokens,
    avg_tokens_per_request: avgTokensPerRequest,
    token_savings: {
      total_saved: savings.totalTokensSaved,
      folding_calls: savings.totalFoldingCalls,
      avg_per_fold: savings.avgSavingsPerFold
    },
    tool_call_counts: toolCallCounts,
    model_counts: modelCounts
  });
});
openaiCompatRouter.get("/v1/models", (req, res) => {
  if (!validateApiKey(req, res)) return;
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: { message: "Rate limit exceeded", type: "rate_limit_error", code: "rate_limit" } });
    return;
  }
  const models = MODELS.map((m) => {
    const assistant = ASSISTANT_MAP.get(m.id);
    return {
      id: m.id,
      object: "model",
      created: 17e8,
      owned_by: m.provider,
      permission: [],
      root: m.id,
      parent: null,
      ...assistant ? {
        meta: {
          description: assistant.displayName,
          prompt_suggestions: assistant.promptSuggestions,
          base_model: assistant.baseModel,
          tools: assistant.tools
        }
      } : {}
    };
  });
  res.json({ object: "list", data: models });
});
openaiCompatRouter.post("/v1/chat/completions", async (req, res) => {
  if (!validateApiKey(req, res)) return;
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(clientIp)) {
    res.status(429).json({ error: { message: "Rate limit exceeded (30 req/min)", type: "rate_limit", code: "rate_limited" } });
    return;
  }
  const { model, messages, stream, temperature, max_tokens } = req.body;
  const requestId = `chatcmpl-${uuid24().substring(0, 12)}`;
  const assistant = ASSISTANT_MAP.get(model);
  const resolvedModel = assistant ? assistant.baseModel : model;
  const mapping = MODEL_TO_PROVIDER[resolvedModel] || MODEL_TO_PROVIDER["gemini-flash"];
  const provider = mapping.provider;
  const providerModel = mapping.model;
  const llmMessages = [...messages || []];
  const hasSystem = llmMessages.some((m) => m.role === "system");
  const systemContent = assistant ? assistant.systemPrompt + ASSISTANT_SUFFIX : SYSTEM_PROMPT;
  if (!hasSystem) {
    llmMessages.unshift({ role: "system", content: systemContent });
  } else if (assistant) {
    const sysIdx = llmMessages.findIndex((m) => m.role === "system");
    if (sysIdx !== -1) {
      llmMessages[sysIdx] = { role: "system", content: systemContent };
    }
  }
  const t0 = Date.now();
  logger.info({ model, provider, stream, messageCount: llmMessages.length, ip: clientIp }, "OpenAI compat request");
  try {
    let loopMessages = [...llmMessages];
    let finalContent = "";
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let toolRounds = 0;
    const allToolNames = [];
    const userMsg = (messages || []).filter((m) => m.role === "user").pop()?.content || "";
    const selectedTools = assistant ? ORCHESTRATOR_TOOLS.filter((t) => assistant.tools.includes(t.function.name)) : selectToolsForQuery(userMsg);
    logger.debug({ selectedTools: selectedTools.map((t) => t.function.name), query: userMsg.slice(0, 50), assistant: assistant?.id || null }, "Tool selection");
    const maxRounds = assistant ? MAX_TOOL_ROUNDS_ASSISTANT : MAX_TOOL_ROUNDS;
    for (let round = 0; round <= maxRounds; round++) {
      const result = await chatLLM({
        provider,
        messages: loopMessages,
        model: providerModel,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 4096,
        tools: selectedTools
      });
      if (result.usage) {
        totalUsage.prompt_tokens += result.usage.prompt_tokens;
        totalUsage.completion_tokens += result.usage.completion_tokens;
        totalUsage.total_tokens += result.usage.total_tokens;
      }
      if (result.content && result.content.length > 0) {
        finalContent = result.content;
      }
      if (result.tool_calls && result.tool_calls.length > 0 && round < maxRounds) {
        toolRounds++;
        const toolNames = result.tool_calls.map((tc) => tc.function.name);
        allToolNames.push(...toolNames);
        logger.info({ round, tools: toolNames, partialContent: (result.content || "").length }, "Tool calls requested");
        loopMessages.push({
          role: "assistant",
          content: result.content || "",
          tool_calls: result.tool_calls
        });
        const toolResults = await executeToolCalls(result.tool_calls);
        for (const tr of toolResults) {
          loopMessages.push({
            role: "tool",
            content: tr.content,
            tool_call_id: tr.tool_call_id
          });
        }
        continue;
      }
      finalContent = result.content;
      break;
    }
    if (!finalContent && toolRounds > 0) {
      loopMessages.push({
        role: "user",
        content: "Baseret p\xE5 alle tool-resultater ovenfor, generer nu dit fulde svar. Inklud\xE9r konkrete data, tal og referencer. Svar p\xE5 dansk i consulting-kvalitet med overskrifter og struktur."
      });
      logger.info({ toolRounds, messageCount: loopMessages.length }, "Forcing text synthesis after tool rounds");
      const summaryResult = await chatLLM({
        provider,
        messages: loopMessages,
        model: providerModel,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 4096
        // No tools — force text response
      });
      finalContent = summaryResult.content;
      logger.info({ contentLength: finalContent?.length ?? 0, hasContent: !!finalContent }, "Synthesis result");
      if (summaryResult.usage) {
        totalUsage.prompt_tokens += summaryResult.usage.prompt_tokens;
        totalUsage.completion_tokens += summaryResult.usage.completion_tokens;
        totalUsage.total_tokens += summaryResult.usage.total_tokens;
      }
    }
    logger.info({ model, provider, toolRounds, tools: allToolNames, toolsOffered: selectedTools.length, duration_ms: Date.now() - t0 }, "OpenAI compat complete (orchestrated)");
    recordMetrics(model || "gemini-flash", allToolNames, toolRounds, totalUsage.total_tokens, selectedTools.length);
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      const chunkSize = 20;
      for (let i = 0; i < finalContent.length; i += chunkSize) {
        const chunk = finalContent.slice(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({
          id: requestId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1e3),
          model: model || "gemini-flash",
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
        })}

`);
      }
      res.write(`data: ${JSON.stringify({
        id: requestId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1e3),
        model: model || "gemini-flash",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
      })}

`);
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      res.json({
        id: requestId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1e3),
        model: model || "gemini-flash",
        choices: [{
          index: 0,
          message: { role: "assistant", content: finalContent },
          finish_reason: "stop"
        }],
        usage: totalUsage
      });
    }
  } catch (err) {
    logger.error({ model, provider, err: String(err) }, "OpenAI compat error");
    res.status(500).json({
      error: {
        message: String(err),
        type: "server_error",
        code: "internal_error"
      }
    });
  }
});

// src/routes/prompt-generator.ts
init_logger();
import { Router as Router22 } from "express";
var promptGeneratorRouter = Router22();
var intentRules = [
  {
    keywords: ["pr\xE6sentation", "praesentation", "presentation", "slides", "deck", "slide"],
    skill: "/wocto:deck",
    explanation: "Brug /wocto:deck til at generere slide decks fra et brief (WidgeTDC-beriget).",
    alternatives: ["/wocto:docs", "/octo:deck"],
    buildPrompt: (d) => `/wocto:deck brief="${d}" slides=10 audience="stakeholders"`
  },
  {
    keywords: ["rapport", "pdf", "docx", "dokument", "document", "report"],
    skill: "/wocto:docs",
    explanation: "Brug /wocto:docs til at generere PDF/DOCX rapporter (WidgeTDC-beriget).",
    alternatives: ["/wocto:deck", "/octo:docs"],
    buildPrompt: (d) => `/wocto:docs format=pdf topic="${d}"`
  },
  {
    keywords: ["prd", "product requirement", "kravspec"],
    skill: "/octo:prd",
    explanation: "Brug /octo:prd til at skrive AI-optimerede Product Requirement Documents.",
    alternatives: ["/octo:spec"],
    buildPrompt: (d) => `/octo:prd "${d}"`
  },
  {
    keywords: ["spec", "specifikation", "specification", "design doc"],
    skill: "/octo:spec",
    explanation: "Brug /octo:spec til strukturerede tekniske specifikationer.",
    alternatives: ["/octo:prd"],
    buildPrompt: (d) => `/octo:spec "${d}"`
  },
  {
    keywords: ["research", "unders\xF8g", "undersog", "analyse", "analysis", "deep dive"],
    skill: "/wocto:research",
    explanation: "Brug /wocto:research til deep research med multi-source syntese (WidgeTDC-beriget).",
    alternatives: ["/obsidian-research", "/octo:discover", "/octo:research"],
    buildPrompt: (d) => `/wocto:research "${d}"`
  },
  {
    keywords: ["osint", "intelligence", "konkurrent", "competitor"],
    skill: "/obsidian-osint",
    explanation: "Brug /obsidian-osint til OSINT intelligence gathering.",
    alternatives: ["/octo:research"],
    buildPrompt: (d) => `/obsidian-osint target="${d}"`
  },
  {
    keywords: ["graph", "neo4j", "noder", "nodes", "relationer", "topology"],
    skill: "/obsidian-graph",
    explanation: "Brug /obsidian-graph til Neo4j graph foresp\xF8rgsler.",
    alternatives: ["/graph-steward"],
    buildPrompt: (d) => `/obsidian-graph "${d}"`
  },
  {
    keywords: ["brainstorm", "id\xE9", "ide", "ide\xE9r", "kreativ", "creative"],
    skill: "/octo:brainstorm",
    explanation: "Brug /octo:brainstorm til kreative sessions med thought partner.",
    alternatives: ["/octo:debate"],
    buildPrompt: (d) => `/octo:brainstorm "${d}"`
  },
  {
    keywords: ["debug", "fix", "bug", "fejl", "error", "traceback", "crash", "broken"],
    skill: "/wocto:debug",
    explanation: "Brug /wocto:debug til systematisk debugging med WidgeTDC governance.",
    alternatives: ["/agent-chain", "/octo:debug"],
    buildPrompt: (d) => `/wocto:debug "${d}"`
  },
  {
    keywords: ["review", "pr", "pull request", "code review"],
    skill: "/code-review:code-review",
    explanation: "Brug /code-review:code-review til PR code review med inline kommentarer.",
    alternatives: ["/wocto:review", "/octo:staged-review"],
    buildPrompt: (d) => {
      const prMatch = d.match(/#?(\d{2,6})/);
      return prMatch ? `/code-review:code-review ${prMatch[1]}` : `/code-review:code-review "${d}"`;
    }
  },
  {
    keywords: ["feature", "implementer", "implement", "byg", "build", "tilf\xF8j", "add", "create"],
    skill: "/agent-chain",
    explanation: "Brug /agent-chain til at auto-klassificere og orkestrere den rette agent-sekvens.",
    alternatives: ["/wocto:factory", "/octo:embrace"],
    buildPrompt: (d) => `/agent-chain ${d}`
  },
  {
    keywords: ["sikkerhed", "security", "audit", "owasp", "vulnerability", "s\xE5rbarhed"],
    skill: "/wocto:security",
    explanation: "Brug /wocto:security til OWASP compliance og s\xE5rbarhedsscanning (WidgeTDC-beriget).",
    alternatives: ["/security-hardener", "/octo:security"],
    buildPrompt: (d) => `/wocto:security scope="${d}"`
  },
  {
    keywords: ["deploy", "deployment", "release", "version", "tag"],
    skill: "/release-manager",
    explanation: "Brug /release-manager til koordineret release og deploy across repos.",
    alternatives: ["/deploy-guardian"],
    buildPrompt: (d) => `/release-manager ${d}`
  },
  {
    keywords: ["status", "sitrep", "omega", "health", "overview", "overblik"],
    skill: "/omega-sentinel",
    explanation: "Brug /omega-sentinel til platform-wide SITREP og arkitektur-audit.",
    alternatives: ["/obsidian-status"],
    buildPrompt: (d) => `/omega-sentinel SITREP`
  },
  {
    keywords: ["test", "tdd", "unit test", "integration test"],
    skill: "/wocto:tdd",
    explanation: "Brug /wocto:tdd til test-driven development med WidgeTDC governance.",
    alternatives: ["/qa-guardian", "/octo:tdd"],
    buildPrompt: (d) => `/wocto:tdd "${d}"`
  },
  {
    keywords: ["compliance", "gdpr", "nis2", "regulering", "regulation"],
    skill: "/compliance-officer",
    explanation: "Brug /compliance-officer til GDPR/NIS2 compliance og gap analysis.",
    alternatives: ["/regulatory-navigator"],
    buildPrompt: (d) => `/compliance-officer ${d}`
  },
  {
    keywords: ["debate", "diskussion", "sammenlign", "compare", "vs"],
    skill: "/octo:debate",
    explanation: "Brug /octo:debate til struktureret 4-vejs AI-debat.",
    alternatives: ["/octo:brainstorm"],
    buildPrompt: (d) => `/octo:debate "${d}"`
  },
  {
    keywords: ["harvest", "scrape", "indsaml", "collect"],
    skill: "/obsidian-harvest",
    explanation: "Brug /obsidian-harvest til at indsamle data fra web, docs, repos.",
    alternatives: ["/octo:pipeline"],
    buildPrompt: (d) => `/obsidian-harvest url="${d}"`
  },
  {
    keywords: ["plan", "strategi", "strategy", "roadmap"],
    skill: "/wocto:plan",
    explanation: "Brug /wocto:plan til at bygge strategiske eksekveringsplaner (WidgeTDC-beriget).",
    alternatives: ["/octo:embrace", "/project-manager-widgetdc", "/octo:plan"],
    buildPrompt: (d) => `/wocto:plan "${d}"`
  },
  {
    keywords: ["ui", "ux", "design", "palette", "typography", "style guide"],
    skill: "/octo:design-ui-ux",
    explanation: "Brug /octo:design-ui-ux til UI/UX design systemer.",
    alternatives: ["/octo:extract"],
    buildPrompt: (d) => `/octo:design-ui-ux "${d}"`
  },
  {
    keywords: ["90-dag", "90-day", "90 dag", "transformation"],
    skill: "/project-manager-90day",
    explanation: "Brug /project-manager-90day til 90-dages transformationsplan tracking.",
    alternatives: ["/project-manager-widgetdc"],
    buildPrompt: (d) => `/project-manager-90day ${d}`
  }
];
function classifyIntent(description) {
  const lower = description.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  for (const rule of intentRules) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule;
    }
  }
  if (bestMatch) {
    return {
      skill: bestMatch.skill,
      prompt: bestMatch.buildPrompt(description),
      explanation: bestMatch.explanation,
      alternatives: bestMatch.alternatives
    };
  }
  return {
    skill: "/wocto",
    prompt: `/wocto "${description}"`,
    explanation: "Ingen specifik skill matchede \u2014 /wocto router automatisk til den bedste skill (WidgeTDC-beriget).",
    alternatives: ["/octo:octo", "/agent-chain"]
  };
}
promptGeneratorRouter.post("/", (req, res) => {
  const { description } = req.body;
  if (!description || typeof description !== "string" || !description.trim()) {
    res.status(400).json({
      success: false,
      error: {
        code: "MISSING_DESCRIPTION",
        message: "description (string) is required",
        status_code: 400
      }
    });
    return;
  }
  const trimmed = description.trim();
  logger.info({ description: trimmed }, "Prompt generator request");
  const result = classifyIntent(trimmed);
  res.json({
    success: true,
    data: result
  });
});
promptGeneratorRouter.get("/skills", (_req, res) => {
  const skills = intentRules.map((r) => ({
    skill: r.skill,
    keywords: r.keywords,
    explanation: r.explanation,
    alternatives: r.alternatives
  }));
  res.json({
    success: true,
    data: {
      skills,
      total: skills.length,
      fallback: "/wocto"
    }
  });
});

// src/openapi.ts
init_tool_registry();
import { Router as Router23 } from "express";
import swaggerUi from "swagger-ui-express";
function buildOpenAPISpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "WidgeTDC Orchestrator \u2014 Universal AI Tool Gateway",
      version: "2.1.0",
      description: "Central intelligence platform for WidgeTDC. Provides unified access to 450+ MCP tools, agent orchestration, knowledge graph, cognitive reasoning, chain execution, and more. Use this API from ChatGPT Custom GPTs, Open WebUI, Gemini, or any OpenAPI-compatible client.",
      contact: { name: "WidgeTDC Platform", url: "https://orchestrator-production-c27e.up.railway.app" }
    },
    servers: [
      { url: "https://orchestrator-production-c27e.up.railway.app", description: "Production (Railway)" },
      { url: "http://localhost:4800", description: "Local development" }
    ],
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API key passed as Bearer token. Also accepts X-API-Key header or ?api_key= query param."
        }
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                status_code: { type: "integer" }
              }
            }
          }
        },
        ToolCallRequest: {
          type: "object",
          required: ["call_id", "agent_id", "tool_name", "arguments"],
          properties: {
            call_id: { type: "string", format: "uuid", description: "Unique call ID" },
            agent_id: { type: "string", description: "Calling agent identifier" },
            tool_name: { type: "string", description: "MCP tool name (e.g., srag.query, graph.health)" },
            arguments: { type: "object", description: "Tool arguments" },
            trace_id: { type: "string", description: "Optional trace ID for correlation" },
            timeout_ms: { type: "integer", description: "Timeout in ms (default 30000)", default: 3e4 }
          }
        },
        ToolCallResponse: {
          type: "object",
          properties: {
            call_id: { type: "string" },
            status: { type: "string", enum: ["success", "error", "timeout"] },
            result: { description: "Tool result (shape varies by tool)" },
            error_message: { type: "string", nullable: true },
            duration_ms: { type: "integer" }
          }
        },
        ChainDefinition: {
          type: "object",
          required: ["name", "mode", "steps"],
          properties: {
            name: { type: "string", description: "Chain name" },
            mode: { type: "string", enum: ["sequential", "parallel", "loop", "debate", "adaptive", "funnel"] },
            steps: {
              type: "array",
              items: {
                type: "object",
                required: ["agent_id"],
                properties: {
                  agent_id: { type: "string" },
                  tool_name: { type: "string" },
                  cognitive_action: { type: "string" },
                  prompt: { type: "string" },
                  capability: { type: "string" }
                }
              }
            }
          }
        },
        AgentHandshake: {
          type: "object",
          required: ["agent_id", "display_name"],
          properties: {
            agent_id: { type: "string" },
            display_name: { type: "string" },
            version: { type: "string" },
            status: { type: "string", enum: ["active", "idle", "busy", "offline"] },
            capabilities: { type: "array", items: { type: "string" } },
            allowed_tool_namespaces: { type: "array", items: { type: "string" } }
          }
        },
        CognitiveRequest: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string", description: "The prompt/question to process" },
            context: { type: "object", description: "Additional context" },
            agent_id: { type: "string" },
            depth: { type: "integer" },
            mode: { type: "string" },
            timeout_ms: { type: "integer" }
          }
        },
        LLMChatRequest: {
          type: "object",
          required: ["provider"],
          properties: {
            provider: { type: "string", description: "LLM provider: deepseek, openai, groq, gemini, claude" },
            prompt: { type: "string", description: "Single prompt (or use messages)" },
            messages: { type: "array", items: { type: "object", properties: { role: { type: "string" }, content: { type: "string" } } } },
            model: { type: "string" },
            temperature: { type: "number" },
            max_tokens: { type: "integer" },
            broadcast: { type: "boolean", default: true }
          }
        }
      }
    },
    paths: {
      // ─── Health ─────────────────────────────────────────
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Platform health check",
          description: "Returns health status of all WidgeTDC services (Redis, RLM, OpenClaw, agents, chains, cron).",
          tags: ["Health"],
          security: [],
          responses: {
            "200": {
              description: "Health status",
              content: { "application/json": { schema: {
                type: "object",
                properties: {
                  status: { type: "string", example: "healthy" },
                  service: { type: "string" },
                  version: { type: "string" },
                  uptime_seconds: { type: "integer" },
                  agents_registered: { type: "integer" },
                  ws_connections: { type: "integer" },
                  redis_enabled: { type: "boolean" },
                  rlm_available: { type: "boolean" },
                  active_chains: { type: "integer" },
                  cron_jobs: { type: "integer" },
                  timestamp: { type: "string", format: "date-time" }
                }
              } } }
            }
          }
        }
      },
      // ─── Dashboard ──────────────────────────────────────
      "/api/dashboard/data": {
        get: {
          operationId: "getDashboardData",
          summary: "Command Center dashboard data",
          description: "JSON feed for the Command Center SPA. Returns agents, chains, cron jobs, WebSocket stats, Redis status.",
          tags: ["Dashboard"],
          security: [],
          responses: {
            "200": { description: "Dashboard data object" }
          }
        }
      },
      // ─── Tools ──────────────────────────────────────────
      "/tools/call": {
        post: {
          operationId: "callTool",
          summary: "Call an MCP tool",
          description: "Proxy a tool call to the WidgeTDC backend MCP system. Supports 450+ tools across knowledge graph, SRAG, Linear, compliance, embedding, and more.",
          tags: ["Tools"],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ToolCallRequest" } } }
          },
          responses: {
            "200": { description: "Tool result", content: { "application/json": { schema: { $ref: "#/components/schemas/ToolCallResponse" } } } },
            "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "403": { description: "ACL denied" },
            "429": { description: "Rate limited" }
          }
        }
      },
      "/tools/namespaces": {
        get: {
          operationId: "getToolNamespaces",
          summary: "List available MCP tool namespaces",
          description: "Discover all available MCP tools from the backend.",
          tags: ["Tools"],
          responses: {
            "200": { description: "List of tool namespaces and definitions" }
          }
        }
      },
      "/tools/catalog": {
        get: {
          operationId: "getToolCatalog",
          summary: "Full tool catalog with categories",
          description: "Returns all orchestrator tools categorized by function, with backend tool mappings and availability.",
          tags: ["Tools"],
          responses: {
            "200": { description: "Tool catalog" }
          }
        }
      },
      // ─── Chains ─────────────────────────────────────────
      "/chains/execute": {
        post: {
          operationId: "executeChain",
          summary: "Execute an agent chain",
          description: "Run a multi-step agent chain. Supports sequential (A->B->C), parallel (A+B+C), debate (two agents argue, third judges), loop, adaptive, and funnel modes.",
          tags: ["Chains"],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ChainDefinition" } } }
          },
          responses: {
            "200": { description: "Chain completed", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object" } } } } } },
            "202": { description: "Chain started (poll for status)", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { type: "object", properties: { execution_id: { type: "string" }, poll_url: { type: "string" } } } } } } } }
          }
        }
      },
      "/chains": {
        get: {
          operationId: "listChains",
          summary: "List recent chain executions",
          tags: ["Chains"],
          responses: { "200": { description: "Chain execution list" } }
        }
      },
      "/chains/status/{id}": {
        get: {
          operationId: "getChainStatus",
          summary: "Get chain execution status",
          tags: ["Chains"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Execution status" },
            "404": { description: "Execution not found" }
          }
        }
      },
      // ─── Cognitive (RLM Engine) ─────────────────────────
      "/cognitive/{action}": {
        post: {
          operationId: "cognitiveAction",
          summary: "Cognitive reasoning via RLM Engine",
          description: "Proxy a cognitive action (reason, analyze, plan, learn, fold, enrich) to the RLM Engine for deep multi-step analysis.",
          tags: ["Cognitive"],
          parameters: [
            { name: "action", in: "path", required: true, schema: { type: "string", enum: ["reason", "analyze", "plan", "learn", "fold", "enrich"] }, description: "Cognitive action type" }
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CognitiveRequest" } } }
          },
          responses: {
            "200": { description: "Cognitive result" },
            "400": { description: "Missing prompt" },
            "502": { description: "RLM Engine error" },
            "503": { description: "RLM Engine unavailable" }
          }
        }
      },
      // ─── Agents ─────────────────────────────────────────
      "/agents": {
        get: {
          operationId: "listAgents",
          summary: "List registered agents",
          description: "Returns all registered agents with capabilities, status, and activity.",
          tags: ["Agents"],
          responses: { "200": { description: "Agent list" } }
        }
      },
      "/agents/register": {
        post: {
          operationId: "registerAgent",
          summary: "Register an agent",
          description: "Register a new agent in the orchestrator fleet.",
          tags: ["Agents"],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AgentHandshake" } } }
          },
          responses: {
            "200": { description: "Agent registered" },
            "400": { description: "Validation error" }
          }
        }
      },
      // ─── Assembly Composer (LIN-534) ────────────────────
      "/api/assembly/compose": {
        post: {
          operationId: "composeAssembly",
          summary: "Compose architecture assembly from blocks",
          description: "Composes verified blocks from LegoFactory into ranked architecture assemblies with coherence/coverage scoring.",
          tags: ["Assembly"],
          requestBody: {
            required: true,
            content: { "application/json": { schema: {
              type: "object",
              properties: {
                block_ids: { type: "array", items: { type: "string" }, description: "Specific block IDs to compose" },
                query: { type: "string", description: "Context query for assembly" },
                domains: { type: "array", items: { type: "string" }, description: "Filter blocks by domain" },
                max_candidates: { type: "integer", default: 3, description: "Max assembly candidates (1-10)" }
              }
            } } }
          },
          responses: {
            "200": { description: "Assembly candidates with scores" },
            "404": { description: "No blocks found" }
          }
        }
      },
      "/api/assembly": {
        get: {
          operationId: "listAssemblies",
          summary: "List assemblies",
          tags: ["Assembly"],
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["draft", "accepted", "rejected"] } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "offset", in: "query", schema: { type: "integer", default: 0 } }
          ],
          responses: { "200": { description: "Assembly list" } }
        }
      },
      // ─── Loose-End Detector (LIN-535) ───────────────────
      "/api/loose-ends/scan": {
        post: {
          operationId: "scanLooseEnds",
          summary: "Run loose-end detection suite",
          description: "Automated detection of orphan blocks, contradictions, missing lineage, dangling assemblies, and disconnected nodes.",
          tags: ["Loose Ends"],
          responses: {
            "200": { description: "Scan results with findings and severity summary" }
          }
        }
      },
      "/api/loose-ends": {
        get: {
          operationId: "getLooseEnds",
          summary: "Get latest loose-end scan results",
          tags: ["Loose Ends"],
          responses: { "200": { description: "Latest scan results" } }
        }
      },
      // ─── Decision Certification (LIN-536) ───────────────
      "/api/decisions/certify": {
        post: {
          operationId: "certifyDecision",
          summary: "Certify an architecture decision",
          description: "Converts an accepted assembly into a verified decision with full lineage chain and production proof.",
          tags: ["Decisions"],
          requestBody: {
            required: true,
            content: { "application/json": { schema: {
              type: "object",
              required: ["assembly_id", "title"],
              properties: {
                assembly_id: { type: "string", description: "Assembly to certify" },
                title: { type: "string", description: "Decision title" },
                summary: { type: "string" },
                rationale: { type: "string" },
                certifier: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                evidence_refs: { type: "array", items: { type: "string" } }
              }
            } } }
          },
          responses: {
            "201": { description: "Decision certified with lineage" },
            "400": { description: "Missing required fields" }
          }
        }
      },
      "/api/decisions": {
        get: {
          operationId: "listDecisions",
          summary: "List certified decisions",
          tags: ["Decisions"],
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["certified", "superseded", "revoked"] } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } }
          ],
          responses: { "200": { description: "Decision list" } }
        }
      },
      // ─── Adoption ───────────────────────────────────────
      "/api/adoption/snapshot": {
        post: {
          operationId: "captureAdoptionSnapshot",
          summary: "Capture daily adoption metrics snapshot",
          description: "Collects 24h metrics (conversations, tool calls, agents, pipelines, artifacts) and persists to Redis + Neo4j.",
          tags: ["Adoption"],
          responses: { "200": { description: "Snapshot captured" } }
        }
      },
      "/api/adoption/metrics": {
        get: {
          operationId: "getAdoptionMetrics",
          summary: "Get adoption KPIs",
          tags: ["Adoption"],
          responses: { "200": { description: "Adoption metrics" } }
        }
      },
      "/api/adoption/trends": {
        get: {
          operationId: "getAdoptionTrends",
          summary: "Time-series adoption data",
          tags: ["Adoption"],
          parameters: [{ name: "days", in: "query", schema: { type: "integer", default: 30 } }],
          responses: { "200": { description: "Daily snapshots" } }
        }
      },
      // ─── Knowledge ──────────────────────────────────────
      "/api/knowledge/cards": {
        get: {
          operationId: "searchKnowledgeCards",
          summary: "Search knowledge cards",
          description: "Search the knowledge graph via KG-RAG and SRAG. Returns normalized knowledge cards with scores.",
          tags: ["Knowledge"],
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Search query" },
            { name: "top_k", in: "query", schema: { type: "integer", default: 5 } },
            { name: "domains", in: "query", schema: { type: "string", default: "all" } }
          ],
          responses: { "200": { description: "Knowledge cards" } }
        }
      },
      "/api/knowledge/feed": {
        get: {
          operationId: "getKnowledgeFeed",
          summary: "Daily knowledge briefing feed",
          description: "Graph pulse, top insights, gap alerts, and domain coverage. Cached 24h.",
          tags: ["Knowledge"],
          responses: { "200": { description: "Knowledge feed" } }
        }
      },
      // ─── LLM Chat ──────────────────────────────────────
      "/api/llm/chat": {
        post: {
          operationId: "chatWithLLM",
          summary: "Chat with an LLM provider",
          description: "Send a prompt to DeepSeek, OpenAI, Groq, Gemini, or Claude. Optionally broadcasts response to chat.",
          tags: ["LLM"],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/LLMChatRequest" } } }
          },
          responses: {
            "200": { description: "LLM response" },
            "400": { description: "Missing provider or prompt" },
            "502": { description: "LLM provider error" }
          }
        }
      },
      "/api/llm/providers": {
        get: {
          operationId: "listLLMProviders",
          summary: "List available LLM providers",
          tags: ["LLM"],
          responses: { "200": { description: "Provider list with models and status" } }
        }
      },
      // ─── Cron ───────────────────────────────────────────
      "/cron": {
        get: {
          operationId: "listCronJobs",
          summary: "List scheduled cron jobs",
          description: "Returns all configured cron loops with schedule, status, and last run time.",
          tags: ["Cron"],
          responses: { "200": { description: "Cron job list" } }
        },
        post: {
          operationId: "createCronJob",
          summary: "Register a new cron job",
          tags: ["Cron"],
          requestBody: {
            required: true,
            content: { "application/json": { schema: {
              type: "object",
              required: ["id", "name", "schedule", "chain"],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                schedule: { type: "string", description: "Cron expression" },
                chain: { $ref: "#/components/schemas/ChainDefinition" },
                enabled: { type: "boolean", default: true }
              }
            } } }
          },
          responses: { "200": { description: "Cron job registered" } }
        }
      },
      "/cron/{id}/run": {
        post: {
          operationId: "triggerCronJob",
          summary: "Trigger a cron job immediately",
          tags: ["Cron"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Triggered" } }
        }
      },
      // ─── Audit ──────────────────────────────────────────
      "/api/audit/log": {
        get: {
          operationId: "getAuditLog",
          summary: "Query audit trail",
          description: "Queryable mutation trail with actor/action/entity filters.",
          tags: ["Audit"],
          parameters: [
            { name: "actor", in: "query", schema: { type: "string" } },
            { name: "action", in: "query", schema: { type: "string" } },
            { name: "entity", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } }
          ],
          responses: { "200": { description: "Audit log entries" } }
        }
      },
      // ─── SSE Events ────────────────────────────────────
      "/api/events": {
        get: {
          operationId: "subscribeSSE",
          summary: "Server-Sent Events stream",
          description: "Real-time event stream for dashboard updates, chain completions, scan results.",
          tags: ["Events"],
          responses: {
            "200": { description: "SSE event stream", content: { "text/event-stream": { schema: { type: "string" } } } }
          }
        }
      },
      // ─── Monitor ────────────────────────────────────────
      "/monitor/status": {
        get: {
          operationId: "getMonitorStatus",
          summary: "Platform monitoring status",
          tags: ["Monitor"],
          responses: { "200": { description: "Monitor data" } }
        }
      },
      // ─── Orchestrator Tools (auto-generated from canonical registry) ──────
      ...toOpenAPIPaths()
    },
    tags: [
      { name: "Health", description: "Service health and status" },
      { name: "Dashboard", description: "Command Center data feed" },
      { name: "Tools", description: "MCP tool proxy \u2014 450+ backend tools" },
      { name: "Chains", description: "Multi-agent chain execution (sequential, parallel, debate, loop)" },
      { name: "Cognitive", description: "RLM Engine deep reasoning proxy" },
      { name: "Agents", description: "Agent fleet registration and management" },
      { name: "Assembly", description: "Architecture assembly composition from building blocks" },
      { name: "Loose Ends", description: "Automated detection of unresolved dependencies" },
      { name: "Decisions", description: "Architecture decision certification with lineage" },
      { name: "Adoption", description: "Platform adoption metrics and trends" },
      { name: "Knowledge", description: "Knowledge graph cards, feed, and briefing" },
      { name: "LLM", description: "Multi-provider LLM chat proxy" },
      { name: "Cron", description: "Scheduled intelligence loops" },
      { name: "Audit", description: "Mutation audit trail" },
      { name: "Events", description: "Real-time Server-Sent Events" },
      { name: "Monitor", description: "Platform monitoring" }
    ]
  };
}
var openapiRouter = Router23();
var spec = buildOpenAPISpec();
openapiRouter.get("/openapi.json", (_req, res) => {
  res.json(spec);
});
openapiRouter.use("/docs", swaggerUi.serve, swaggerUi.setup(spec, {
  customSiteTitle: "WidgeTDC API Explorer",
  customCss: ".swagger-ui .topbar { display: none }",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true
  }
}));

// src/routes/mcp-gateway.ts
import { Router as Router24 } from "express";
init_tool_registry();
init_mcp_caller();
init_config();
init_logger();
import { v4 as uuid25 } from "uuid";
var mcpGatewayRouter = Router24();
var backendToolsCache = [];
var backendToolsCacheTime = 0;
var CACHE_TTL_MS2 = 3e5;
async function getBackendTools() {
  if (Date.now() - backendToolsCacheTime < CACHE_TTL_MS2 && backendToolsCache.length > 0) {
    return backendToolsCache;
  }
  try {
    const r = await fetch(`${config.backendUrl}/api/mcp/tools`, {
      headers: { Authorization: `Bearer ${config.backendApiKey}` },
      signal: AbortSignal.timeout(1e4)
    });
    if (!r.ok) return backendToolsCache;
    const data = await r.json();
    const rawTools = Array.isArray(data) ? data : Array.isArray(data?.tools) ? data.tools : Array.isArray(data?.data?.tools) ? data.data.tools : [];
    backendToolsCache = rawTools.map((t) => {
      if (typeof t === "string") {
        return {
          name: `backend.${t}`,
          description: `Backend MCP tool: ${t}`,
          inputSchema: { type: "object", properties: { payload: { type: "object", description: "Tool arguments" } } }
        };
      }
      return {
        name: `backend.${t.name ?? t.tool ?? ""}`,
        description: String(t.description ?? `Backend MCP tool: ${t.name ?? t.tool}`),
        inputSchema: t.inputSchema ?? t.input_schema ?? t.parameters ?? { type: "object", properties: {} }
      };
    }).filter((t) => t.name !== "backend.");
    backendToolsCacheTime = Date.now();
    logger.info({ count: backendToolsCache.length }, "MCP gateway: refreshed backend tools cache");
  } catch (err) {
    logger.warn({ err: String(err) }, "MCP gateway: failed to fetch backend tools");
  }
  return backendToolsCache;
}
function getOrchestratorToolsMCP() {
  return toMCPTools();
}
async function handleInitialize(id) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: { listChanged: false }
      },
      serverInfo: {
        name: "widgetdc-orchestrator",
        version: "2.1.0"
      }
    }
  };
}
async function handleToolsList(id) {
  const orchestratorTools = getOrchestratorToolsMCP();
  const backendTools = await getBackendTools();
  return {
    jsonrpc: "2.0",
    id,
    result: {
      tools: [...orchestratorTools, ...backendTools]
    }
  };
}
async function handleToolsCall(id, params) {
  const toolName = params.name;
  const args = params.arguments ?? {};
  if (!toolName) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: "Missing required parameter: name" }
    };
  }
  const isOrchestratorTool = TOOL_REGISTRY.some((t) => t.name === toolName);
  if (isOrchestratorTool) {
    try {
      const results = await executeToolCalls([{
        id: uuid25(),
        function: { name: toolName, arguments: JSON.stringify(args) }
      }]);
      const result = results[0];
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: result.content }],
          isError: false
        }
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${err}` }],
          isError: true
        }
      };
    }
  }
  const backendName = toolName.startsWith("backend.") ? toolName.slice(8) : toolName;
  try {
    const mcpResult = await callMcpTool({
      toolName: backendName,
      args,
      callId: uuid25(),
      timeoutMs: 3e4
    });
    if (mcpResult.status !== "success") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: mcpResult.error_message ?? "Tool call failed" }],
          isError: true
        }
      };
    }
    const text = typeof mcpResult.result === "string" ? mcpResult.result : JSON.stringify(mcpResult.result, null, 2);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text }],
        isError: false
      }
    };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: `MCP tool error: ${err}` }],
        isError: true
      }
    };
  }
}
async function handlePing(id) {
  return { jsonrpc: "2.0", id, result: {} };
}
mcpGatewayRouter.post("/", async (req, res) => {
  const body = req.body;
  if (!body || body.jsonrpc !== "2.0" || !body.method) {
    res.status(400).json({
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" }
    });
    return;
  }
  const { method, id, params } = body;
  logger.info({ method, id }, "MCP gateway request");
  let response;
  try {
    switch (method) {
      case "initialize":
        response = await handleInitialize(id ?? null);
        break;
      case "notifications/initialized":
        res.status(204).end();
        return;
      case "tools/list":
        response = await handleToolsList(id ?? null);
        break;
      case "tools/call":
        response = await handleToolsCall(id ?? null, params ?? {});
        break;
      case "ping":
        response = await handlePing(id ?? null);
        break;
      default:
        response = {
          jsonrpc: "2.0",
          id: id ?? null,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
    }
  } catch (err) {
    logger.error({ method, err: String(err) }, "MCP gateway error");
    response = {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code: -32603, message: `Internal error: ${err}` }
    };
  }
  res.json(response);
});
mcpGatewayRouter.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write(`event: endpoint
data: /mcp

`);
  const keepAlive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 3e4);
  req.on("close", () => {
    clearInterval(keepAlive);
  });
});
mcpGatewayRouter.delete("/", (_req, res) => {
  res.status(200).json({ jsonrpc: "2.0", result: { message: "Session terminated" } });
});

// src/routes/tool-gateway.ts
import { Router as Router25 } from "express";
init_tool_registry();
init_logger();
import { v4 as uuid26 } from "uuid";
var toolGatewayRouter = Router25();
toolGatewayRouter.post("/:name", async (req, res) => {
  const { name } = req.params;
  const tool = getTool(name);
  if (!tool) {
    res.status(404).json({
      success: false,
      error: {
        code: "TOOL_NOT_FOUND",
        message: `Tool '${name}' not found. Use GET /api/tools to list available tools.`,
        available: TOOL_REGISTRY.map((t) => t.name),
        status_code: 404
      }
    });
    return;
  }
  const callId = req.body?.call_id ?? uuid26();
  const args = req.body ?? {};
  logger.info({ tool: name, call_id: callId }, "REST tool gateway call");
  const result = await executeToolUnified(name, args, {
    call_id: callId,
    source_protocol: "openapi",
    fold: req.query.fold !== "false"
  });
  const httpStatus = result.status === "success" ? 200 : result.status === "timeout" ? 504 : 500;
  res.status(httpStatus).json({
    success: result.status === "success",
    data: result
  });
});
toolGatewayRouter.get("/", (_req, res) => {
  const tools = TOOL_REGISTRY.map((t) => ({
    name: t.name,
    namespace: t.namespace,
    category: t.category,
    description: t.description,
    tags: t.tags,
    available_via: t.availableVia,
    timeout_ms: t.timeoutMs,
    endpoint: `/api/tools/${t.name}`
  }));
  res.json({
    success: true,
    data: {
      tools,
      total: tools.length,
      registry_version: "1.0.0"
    }
  });
});

// src/agent-seeds.ts
init_agent_registry();
init_logger();
var AGENT_SEEDS = [
  {
    agent_id: "omega",
    display_name: "Omega Sentinel",
    source: "core",
    version: "2.0",
    status: "online",
    capabilities: ["sitrep", "compliance", "circuit_breakers", "swarm", "pheromones", "architecture"],
    allowed_tool_namespaces: ["omega", "audit", "graph", "*"]
  },
  {
    agent_id: "trident",
    display_name: "Trident Security",
    source: "core",
    version: "3.0",
    status: "online",
    capabilities: ["threat_hunting", "osint", "cti", "cvr", "attack_surface", "certstream"],
    allowed_tool_namespaces: ["trident", "osint", "the_snout", "harvest.intel", "*"]
  },
  {
    agent_id: "prometheus",
    display_name: "Prometheus Engine",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["code_analysis", "embeddings", "dreaming", "reinforcement_learning", "governance"],
    allowed_tool_namespaces: ["prometheus", "code", "lsp", "*"]
  },
  {
    agent_id: "master",
    display_name: "Master Orchestrator",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["delegation", "introspection", "task_management", "agent_coordination"],
    allowed_tool_namespaces: ["master", "agent", "action", "*"]
  },
  {
    agent_id: "harvest",
    display_name: "Harvest Collector",
    source: "core",
    version: "2.0",
    status: "online",
    capabilities: ["web_crawl", "scraping", "cloud_ingestion", "m365", "sharepoint", "scribd", "remarkable"],
    allowed_tool_namespaces: ["harvest", "ingestion", "datafabric", "*"]
  },
  {
    agent_id: "docgen",
    display_name: "DocGen Factory",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["powerpoint", "word", "excel", "diagrams", "presentations"],
    allowed_tool_namespaces: ["docgen", "tdc", "*"]
  },
  {
    agent_id: "graph",
    display_name: "Neo4j Graph Agent",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["cypher_read", "cypher_write", "graph_search", "graph_stats", "hygiene"],
    allowed_tool_namespaces: ["graph", "kg_rag", "srag", "*"]
  },
  {
    agent_id: "consulting",
    display_name: "Consulting Intelligence",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["insight_search", "pattern_search", "failure_search"],
    allowed_tool_namespaces: ["consulting", "vidensarkiv", "kg_rag", "*"]
  },
  {
    agent_id: "legal",
    display_name: "Legal & Compliance",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["retsinformation", "compliance_check", "eu_funding", "tax", "blast_radius"],
    allowed_tool_namespaces: ["legal", "intel", "*"]
  },
  {
    agent_id: "custodian",
    display_name: "Custodian Guardian",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["chaos_testing", "patrol", "voting", "governance"],
    allowed_tool_namespaces: ["custodian", "audit", "*"]
  },
  {
    agent_id: "roma",
    display_name: "Roma Self-Healer",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["self_healing", "incident_response", "seed", "approval"],
    allowed_tool_namespaces: ["roma", "incident", "*"]
  },
  {
    agent_id: "rlm",
    display_name: "RLM Reasoning Engine",
    source: "rlm-engine",
    version: "7.0.0",
    status: "online",
    capabilities: ["reasoning", "planning", "context_folding", "missions", "rag"],
    allowed_tool_namespaces: ["rlm", "context_folding", "specialist", "*"]
  },
  {
    agent_id: "llm-router",
    display_name: "LLM Cost Router",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["multi_model_routing", "cost_tracking", "budget"],
    allowed_tool_namespaces: ["llm", "*"]
  },
  {
    agent_id: "vidensarkiv",
    display_name: "Vidensarkiv",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["knowledge_search", "file_management", "batch_add"],
    allowed_tool_namespaces: ["vidensarkiv", "*"]
  },
  {
    agent_id: "the-snout",
    display_name: "The Snout OSINT",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["domain_intel", "email_intel", "osint", "extraction"],
    allowed_tool_namespaces: ["the_snout", "osint", "*"]
  },
  {
    agent_id: "autonomous",
    display_name: "Autonomous Swarm",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["graphrag", "stategraph", "evolution", "agent_teams"],
    allowed_tool_namespaces: ["autonomous", "loop", "*"]
  },
  {
    agent_id: "cma",
    display_name: "Context Memory Agent",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["context_management", "memory_store", "memory_retrieve"],
    allowed_tool_namespaces: ["cma", "*"]
  },
  {
    agent_id: "nexus",
    display_name: "Nexus Analyzer",
    source: "core",
    version: "1.0",
    status: "online",
    capabilities: ["decomposition", "gap_analysis", "feedback"],
    allowed_tool_namespaces: ["nexus", "*"]
  },
  {
    agent_id: "command-center",
    display_name: "Command Center",
    source: "dashboard",
    version: "2.2",
    status: "online",
    capabilities: ["mcp_tools", "chat", "chain_execution"],
    allowed_tool_namespaces: ["*"]
  },
  // ─── LibreChat agents (visible in registry, not WS-connected) ────────────
  {
    agent_id: "lc-prometheus",
    display_name: "Prometheus (LibreChat)",
    source: "librechat",
    version: "1.0",
    status: "online",
    capabilities: ["code_analysis", "embeddings", "governance", "reinforcement_learning"],
    allowed_tool_namespaces: ["prometheus", "code", "*"]
  },
  {
    agent_id: "lc-roma",
    display_name: "Roma (LibreChat)",
    source: "librechat",
    version: "1.0",
    status: "online",
    capabilities: ["self_healing", "incident_response", "monitoring"],
    allowed_tool_namespaces: ["roma", "incident", "*"]
  },
  {
    agent_id: "lc-dot",
    display_name: "DOT Navigator (LibreChat)",
    source: "librechat",
    version: "1.0",
    status: "online",
    capabilities: ["navigation", "task_routing", "context_switching"],
    allowed_tool_namespaces: ["dot", "*"]
  },
  {
    agent_id: "lc-harvester",
    display_name: "Harvester (LibreChat)",
    source: "librechat",
    version: "1.0",
    status: "online",
    capabilities: ["web_crawl", "data_ingestion", "extraction"],
    allowed_tool_namespaces: ["harvest", "ingestion", "*"]
  },
  {
    agent_id: "lc-sentinel",
    display_name: "Sentinel (LibreChat)",
    source: "librechat",
    version: "1.0",
    status: "online",
    capabilities: ["monitoring", "alerting", "threat_detection"],
    allowed_tool_namespaces: ["sentinel", "alert", "*"]
  },
  {
    agent_id: "lc-analyst",
    display_name: "Analyst (LibreChat)",
    source: "librechat",
    version: "1.0",
    status: "online",
    capabilities: ["data_analysis", "reporting", "visualization"],
    allowed_tool_namespaces: ["analyst", "report", "*"]
  }
];
function seedAgents() {
  let seeded = 0;
  for (const seed of AGENT_SEEDS) {
    const existing = AgentRegistry.get(seed.agent_id);
    if (!existing || existing.handshake.source === "auto-discovered") {
      AgentRegistry.register(seed);
      seeded++;
    }
  }
  const ghostPattern = /^(backend|omega-sentinel|agent|rlm)-[0-9a-f]{6,}$/;
  let cleaned = 0;
  for (const entry of AgentRegistry.all()) {
    if (ghostPattern.test(entry.handshake.agent_id)) {
      AgentRegistry.remove(entry.handshake.agent_id);
      cleaned++;
    }
  }
  logger.info({ seeded, cleaned }, "Agent seeds applied");
}

// src/index.ts
init_chat_store();

// src/routes/failures.ts
import { Router as Router26 } from "express";
init_redis();
init_logger();
var failuresRouter = Router26();
failuresRouter.get("/summary", async (_req, res) => {
  try {
    const redis2 = getRedis();
    if (redis2) {
      const cached = await redis2.get("orchestrator:failure-summary");
      if (cached) {
        try {
          res.json({ success: true, data: JSON.parse(cached), source: "cache" });
          return;
        } catch {
        }
      }
    }
    const events = await harvestFailures(24);
    const summary = buildFailureSummary(events, 24);
    if (redis2) {
      await redis2.set("orchestrator:failure-summary", JSON.stringify(summary), "EX", 900).catch(() => {
      });
    }
    res.json({ success: true, data: summary, source: "fresh" });
  } catch (err) {
    logger.error({ err: String(err) }, "Failure summary endpoint failed");
    res.status(500).json({ success: false, error: { code: "HARVEST_READ_ERROR", message: "Failed to read failure summary. Check server logs.", status_code: 500 } });
  }
});
failuresRouter.post("/harvest", async (req, res) => {
  const raw = req.body?.window_hours;
  const windowHours = typeof raw === "number" && raw >= 1 && raw <= 720 ? raw : 24;
  try {
    const summary = await runFailureHarvest(windowHours);
    res.json({ success: true, data: summary });
  } catch (err) {
    logger.error({ err: String(err) }, "Manual failure harvest failed");
    res.status(500).json({ success: false, error: { code: "HARVEST_FAILED", message: "Failure harvest failed. Check server logs.", status_code: 500 } });
  }
});

// src/routes/competitive.ts
import { Router as Router27 } from "express";
init_redis();
init_logger();
var competitiveRouter = Router27();
var crawlInProgress = false;
var lastCrawlAt = 0;
var CRAWL_COOLDOWN_MS = 36e5;
competitiveRouter.get("/report", async (_req, res) => {
  try {
    const redis2 = getRedis();
    if (redis2) {
      const cached = await redis2.get("orchestrator:competitive-report");
      if (cached) {
        try {
          res.json({ success: true, data: JSON.parse(cached), source: "cache" });
          return;
        } catch {
        }
      }
    }
    res.json({ success: true, data: null, message: "No report yet. Trigger crawl via POST /api/competitive/crawl" });
  } catch (err) {
    logger.error({ err: String(err) }, "Competitive report endpoint failed");
    res.status(500).json({ success: false, error: { code: "COMPETITIVE_READ_ERROR", message: "Failed to read competitive report. Check server logs.", status_code: 500 } });
  }
});
competitiveRouter.post("/crawl", async (_req, res) => {
  if (crawlInProgress) {
    res.status(429).json({
      success: false,
      error: { code: "CRAWL_IN_PROGRESS", message: "A crawl is already running. Try again later.", status_code: 429 }
    });
    return;
  }
  const elapsed = Date.now() - lastCrawlAt;
  if (elapsed < CRAWL_COOLDOWN_MS) {
    const waitMin = Math.ceil((CRAWL_COOLDOWN_MS - elapsed) / 6e4);
    res.status(429).json({
      success: false,
      error: { code: "CRAWL_COOLDOWN", message: `Cooldown active. Try again in ${waitMin} minutes.`, status_code: 429 }
    });
    return;
  }
  crawlInProgress = true;
  try {
    const report = await runCompetitiveCrawl();
    lastCrawlAt = Date.now();
    res.json({ success: true, data: report });
  } catch (err) {
    logger.error({ err: String(err) }, "Manual competitive crawl failed");
    res.status(500).json({ success: false, error: { code: "CRAWL_FAILED", message: "Crawl failed. Check server logs.", status_code: 500 } });
  } finally {
    crawlInProgress = false;
  }
});
competitiveRouter.get("/targets", (_req, res) => {
  res.json({
    success: true,
    data: COMPETITOR_TARGETS.map((t) => ({
      name: t.name,
      slug: t.slug,
      url_count: t.urls.length
    }))
  });
});

// src/routes/fold.ts
init_cognitive_proxy();
init_redis();
init_logger();
import { Router as Router28 } from "express";
var foldRouter = Router28();
var DAILY_LIMIT = 100;
var REDIS_PREFIX6 = "caas:usage:";
async function getUsageCount(apiKey) {
  const redis2 = getRedis();
  if (!redis2) return 0;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const key = `${REDIS_PREFIX6}${today}:${apiKey}`;
  const count = await redis2.get(key);
  return parseInt(count ?? "0", 10);
}
async function incrementUsage(apiKey) {
  const redis2 = getRedis();
  if (!redis2) return;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const key = `${REDIS_PREFIX6}${today}:${apiKey}`;
  await redis2.incr(key);
  await redis2.expire(key, 86400 * 2);
}
async function logUsage(apiKey, inputTokens, outputTokens, durationMs) {
  const redis2 = getRedis();
  if (!redis2) return;
  const event = JSON.stringify({
    $id: `caas-usage:${Date.now()}`,
    api_key: apiKey.slice(0, 8) + "...",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    duration_ms: durationMs,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  await redis2.lpush("caas:usage-log", event).catch(() => {
  });
  await redis2.ltrim("caas:usage-log", 0, 9999).catch(() => {
  });
}
foldRouter.post("/", async (req, res) => {
  if (!isRlmAvailable()) {
    res.status(503).json({
      success: false,
      error: { code: "RLM_UNAVAILABLE", message: "Mercury Folding backend not configured", status_code: 503 }
    });
    return;
  }
  if (!getRedis()) {
    res.status(503).json({
      success: false,
      error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Rate limiting backend (Redis) not available. Fold disabled.", status_code: 503 }
    });
    return;
  }
  const apiKey = req.headers["authorization"]?.replace("Bearer ", "") ?? req.headers["x-api-key"] ?? req.query["api_key"] ?? "anonymous";
  const usage = await getUsageCount(apiKey);
  if (usage >= DAILY_LIMIT) {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: `Daily limit of ${DAILY_LIMIT} requests exceeded. Resets at midnight UTC.`,
        status_code: 429,
        usage: { today: usage, limit: DAILY_LIMIT }
      }
    });
    return;
  }
  const body = req.body;
  if (!body.text || typeof body.text !== "string") {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Required: text (string)", status_code: 400 }
    });
    return;
  }
  if (body.text.length > 1e5) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "text must be under 100,000 characters", status_code: 400 }
    });
    return;
  }
  const VALID_STRATEGIES = ["semantic", "extractive", "hybrid"];
  const budget = typeof body.budget === "number" && body.budget >= 100 && body.budget <= 5e4 ? body.budget : 2e3;
  const strategy = typeof body.strategy === "string" && VALID_STRATEGIES.includes(body.strategy) ? body.strategy : "semantic";
  const t0 = Date.now();
  try {
    const result = await callCognitive("fold", {
      prompt: body.query ?? "Compress and fold the following text while preserving key information",
      context: {
        text: body.text,
        budget,
        strategy
      }
    }, 3e4);
    const durationMs = Date.now() - t0;
    const inputTokens = Math.ceil(body.text.length / 4);
    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    const outputTokens = Math.ceil(resultStr.length / 4);
    await incrementUsage(apiKey);
    await logUsage(apiKey, inputTokens, outputTokens, durationMs);
    res.json({
      success: true,
      data: {
        $id: `fold-result:${Date.now()}`,
        folded_text: result,
        input_chars: body.text.length,
        output_chars: resultStr.length,
        compression_ratio: resultStr.length > 0 ? +(body.text.length / resultStr.length).toFixed(2) : 0,
        tokens_saved_estimate: Math.max(0, inputTokens - outputTokens),
        duration_ms: durationMs,
        strategy
      },
      usage: {
        today: usage + 1,
        limit: DAILY_LIMIT,
        remaining: DAILY_LIMIT - usage - 1
      }
    });
  } catch (err) {
    logger.error({ err: String(err) }, "CaaS fold request failed");
    res.status(502).json({
      success: false,
      error: { code: "FOLD_FAILED", message: "Mercury Folding request failed. Check server logs.", status_code: 502 }
    });
  }
});
foldRouter.get("/usage", async (req, res) => {
  const redis2 = getRedis();
  if (!redis2) {
    res.json({ success: true, data: { message: "Redis not available \u2014 no usage tracking" } });
    return;
  }
  try {
    const logLength = await redis2.llen("caas:usage-log");
    const recent = await redis2.lrange("caas:usage-log", 0, 9);
    const parsed = recent.map((r) => {
      try {
        return JSON.parse(r);
      } catch {
        return null;
      }
    }).filter(Boolean);
    res.json({
      success: true,
      data: {
        $id: `caas-usage-stats:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`,
        total_requests_logged: logLength,
        recent_requests: parsed
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "USAGE_READ_ERROR", message: "Failed to read usage stats. Check server logs.", status_code: 500 } });
  }
});

// src/routes/graph-hygiene.ts
import { Router as Router29 } from "express";

// src/graph-hygiene.ts
init_mcp_caller();
init_logger();
init_sse();
import { v4 as uuid27 } from "uuid";
async function graphRead3(cypher) {
  const result = await callMcpTool({
    toolName: "graph.read_cypher",
    args: { query: cypher },
    callId: uuid27(),
    timeoutMs: 3e4
  });
  if (result.status !== "success") return [];
  const data = result.result;
  return data?.results || data || [];
}
async function graphWrite2(cypher, params) {
  const result = await callMcpTool({
    toolName: "graph.write_cypher",
    args: { query: cypher, ...params ? { params } : {} },
    callId: uuid27(),
    timeoutMs: 6e4
  });
  return result.status === "success";
}
function neo4jInt3(val) {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "object" && "low" in val) return val.low;
  return Number(val) || 0;
}
async function fixFrameworkDomainRels() {
  const before = await graphRead3(`
    MATCH (f:Framework)
    WHERE NOT (f)-[:IN_DOMAIN]->(:Domain)
    RETURN count(f) AS count
  `);
  const missingCount = neo4jInt3(before[0]?.count);
  if (missingCount === 0) {
    return { operation: "framework_domain_rels", severity: "P0", before: 0, after: 0, fixed: 0, details: "No missing IN_DOMAIN rels" };
  }
  await graphWrite2(`
    MATCH (f:Framework)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    WHERE NOT (f)-[:IN_DOMAIN]->(d)
    MERGE (f)-[:IN_DOMAIN]->(d)
  `);
  await graphWrite2(`
    MATCH (f:Framework) WHERE f.domain IS NOT NULL AND NOT (f)-[:IN_DOMAIN]->(:Domain)
    MATCH (d:Domain) WHERE d.name = f.domain OR d.slug = f.domain
    MERGE (f)-[:IN_DOMAIN]->(d)
  `);
  const after = await graphRead3(`
    MATCH (f:Framework)
    WHERE NOT (f)-[:IN_DOMAIN]->(:Domain)
    RETURN count(f) AS count
  `);
  const remaining = neo4jInt3(after[0]?.count);
  const fixed = missingCount - remaining;
  return {
    operation: "framework_domain_rels",
    severity: "P0",
    before: missingCount,
    after: remaining,
    fixed: Math.max(0, fixed),
    details: `Created IN_DOMAIN rels for ${Math.max(0, fixed)} frameworks (${remaining} still unlinked \u2014 may lack Domain node)`
  };
}
var DOMAIN_CONSOLIDATION = {
  "Legal & Compliance": ["Legal", "Legal & Regulatory", "Compliance"],
  "Digital Transformation": ["Digital", "Digital Strategy", "Digitalization"],
  "Strategy & Advisory": ["Strategy", "Strategic Advisory", "Business Strategy", "Corporate Strategy"],
  "Technology & Architecture": ["Technology", "IT Architecture", "Enterprise Architecture"],
  "Data & Analytics": ["Data", "Analytics", "Data Science", "Business Intelligence"],
  "Cybersecurity": ["Security", "Information Security", "Cyber"],
  "Cloud & Infrastructure": ["Cloud", "Infrastructure", "Cloud Computing"],
  "Finance & Risk": ["Finance", "Risk", "Financial Services", "Risk Management"],
  "Public Sector": ["Government", "Public Administration", "Gov Tech"],
  "Operations & Delivery": ["Operations", "Delivery", "Service Delivery"]
};
async function consolidateDomains() {
  const beforeResult = await graphRead3(`MATCH (d:Domain) RETURN count(d) AS count`);
  const domainsBefore = neo4jInt3(beforeResult[0]?.count);
  let totalMerged = 0;
  for (const [canonical, variants] of Object.entries(DOMAIN_CONSOLIDATION)) {
    for (const variant of variants) {
      if (variant === canonical) continue;
      const exists = await graphRead3(`MATCH (d:Domain {name: '${variant}'}) RETURN count(d) AS count`);
      if (neo4jInt3(exists[0]?.count) === 0) continue;
      const ok = await graphWrite2(`
        MATCH (variant:Domain {name: $variant})
        MATCH (canonical:Domain {name: $canonical})
        WHERE variant <> canonical
        WITH variant, canonical
        OPTIONAL MATCH (variant)<-[r]-()
        WITH variant, canonical, collect(r) AS rels
        UNWIND rels AS rel
        WITH variant, canonical, rel, startNode(rel) AS source, type(rel) AS relType
        CALL apoc.create.relationship(source, relType, {}, canonical) YIELD rel AS newRel
        DELETE rel
        RETURN count(newRel) AS migrated
      `, { variant, canonical });
      if (!ok) {
        for (const relType of ["IN_DOMAIN", "BELONGS_TO_DOMAIN", "COVERS", "RELATES_TO"]) {
          await graphWrite2(`
            MATCH (source)-[r:${relType}]->(variant:Domain {name: $variant})
            MATCH (canonical:Domain {name: $canonical})
            WHERE variant <> canonical
            MERGE (source)-[:${relType}]->(canonical)
            DELETE r
          `, { variant, canonical });
          await graphWrite2(`
            MATCH (variant:Domain {name: $variant})-[r:${relType}]->(target)
            MATCH (canonical:Domain {name: $canonical})
            WHERE variant <> canonical
            MERGE (canonical)-[:${relType}]->(target)
            DELETE r
          `, { variant, canonical });
        }
      }
      await graphWrite2(`
        MATCH (d:Domain {name: $variant})
        WHERE NOT (d)-[]-()
        DELETE d
      `, { variant });
      totalMerged++;
      logger.info({ variant, canonical }, "Domain consolidated");
    }
  }
  const afterResult = await graphRead3(`MATCH (d:Domain) RETURN count(d) AS count`);
  const domainsAfter = neo4jInt3(afterResult[0]?.count);
  return {
    operation: "domain_consolidation",
    severity: "P1",
    before: domainsBefore,
    after: domainsAfter,
    fixed: totalMerged,
    details: `Consolidated ${totalMerged} variant domains. ${domainsAfter} domains remaining.`
  };
}
async function purgeGraphBloat() {
  const orphanCount = await graphRead3(`
    MATCH (d:RLMDecision)
    WHERE NOT (d)-[:DECIDED_BY|AFFECTS|IMPLEMENTS|REFERENCES]-()
    RETURN count(d) AS count
  `);
  const orphans = neo4jInt3(orphanCount[0]?.count);
  let totalDeleted = 0;
  if (orphans > 0) {
    for (let i = 0; i < Math.ceil(orphans / 1e3); i++) {
      const ok = await graphWrite2(`
        MATCH (d:RLMDecision)
        WHERE NOT (d)-[:DECIDED_BY|AFFECTS|IMPLEMENTS|REFERENCES]-()
        WITH d LIMIT 1000
        DETACH DELETE d
        RETURN count(*) AS deleted
      `);
      if (!ok) break;
      totalDeleted += 1e3;
    }
    totalDeleted = Math.min(totalDeleted, orphans);
  }
  const saCountResult = await graphRead3(`
    MATCH ()-[r:SHOULD_AWARE_OF]->()
    RETURN count(r) AS count
  `);
  const saCount = neo4jInt3(saCountResult[0]?.count);
  let saDeleted = 0;
  if (saCount > 1e5) {
    await graphWrite2(`
      MATCH (a)-[r:SHOULD_AWARE_OF]->(l:Lesson)
      WHERE l.timestamp < datetime() - duration('P30D')
      WITH r LIMIT 50000
      DELETE r
    `);
    await graphWrite2(`
      MATCH (a)-[r:SHOULD_AWARE_OF]->(l:Lesson)
      WHERE l.violation = 'CONTRACT_VIOLATION'
      AND l.correction CONTAINS 'All JSON must include $id'
      WITH r LIMIT 50000
      DELETE r
    `);
    const saAfter = await graphRead3(`MATCH ()-[r:SHOULD_AWARE_OF]->() RETURN count(r) AS count`);
    saDeleted = saCount - neo4jInt3(saAfter[0]?.count);
  }
  return {
    operation: "graph_bloat_purge",
    severity: "P2",
    before: orphans + saCount,
    after: 0,
    fixed: totalDeleted + Math.max(0, saDeleted),
    details: `Deleted ${totalDeleted} orphan RLMDecision, pruned ${Math.max(0, saDeleted)} stale SHOULD_AWARE_OF rels`
  };
}
async function runGraphHygiene2() {
  const t0 = Date.now();
  const operations = [];
  logger.info("Starting graph hygiene run (LIN-574)");
  try {
    operations.push(await fixFrameworkDomainRels());
  } catch (err) {
    logger.error({ err: String(err) }, "P0 framework_domain_rels failed");
    operations.push({ operation: "framework_domain_rels", severity: "P0", before: 0, after: 0, fixed: 0, details: `Error: ${String(err).slice(0, 200)}` });
  }
  try {
    operations.push(await consolidateDomains());
  } catch (err) {
    logger.error({ err: String(err) }, "P1 domain_consolidation failed");
    operations.push({ operation: "domain_consolidation", severity: "P1", before: 0, after: 0, fixed: 0, details: `Error: ${String(err).slice(0, 200)}` });
  }
  try {
    operations.push(await purgeGraphBloat());
  } catch (err) {
    logger.error({ err: String(err) }, "P2 graph_bloat_purge failed");
    operations.push({ operation: "graph_bloat_purge", severity: "P2", before: 0, after: 0, fixed: 0, details: `Error: ${String(err).slice(0, 200)}` });
  }
  const report = {
    $id: `hygiene-report:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`,
    started_at: new Date(t0).toISOString(),
    completed_at: (/* @__PURE__ */ new Date()).toISOString(),
    duration_ms: Date.now() - t0,
    operations,
    total_fixed: operations.reduce((sum, op) => sum + op.fixed, 0)
  };
  broadcastSSE("graph-hygiene", report);
  logger.info({ total_fixed: report.total_fixed, duration_ms: report.duration_ms }, "Graph hygiene complete");
  return report;
}

// src/routes/graph-hygiene.ts
init_logger();
var graphHygieneRouter = Router29();
var hygieneInProgress = false;
graphHygieneRouter.post("/run", async (_req, res) => {
  if (hygieneInProgress) {
    res.status(429).json({
      success: false,
      error: { code: "HYGIENE_IN_PROGRESS", message: "A hygiene run is already in progress.", status_code: 429 }
    });
    return;
  }
  hygieneInProgress = true;
  try {
    const report = await runGraphHygiene2();
    res.json({ success: true, data: report });
  } catch (err) {
    logger.error({ err: String(err) }, "Graph hygiene run failed");
    res.status(500).json({ success: false, error: { code: "HYGIENE_FAILED", message: "Graph hygiene failed. Check server logs.", status_code: 500 } });
  } finally {
    hygieneInProgress = false;
  }
});
graphHygieneRouter.post("/fix/:op", async (req, res) => {
  const op = req.params.op;
  const ops = {
    framework_domain_rels: fixFrameworkDomainRels,
    domain_consolidation: consolidateDomains,
    graph_bloat_purge: purgeGraphBloat
  };
  const fn = ops[op];
  if (!fn) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_OPERATION", message: `Valid ops: ${Object.keys(ops).join(", ")}`, status_code: 400 }
    });
    return;
  }
  try {
    const result = await fn();
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error({ err: String(err), op }, "Graph hygiene operation failed");
    res.status(500).json({ success: false, error: { code: "OPERATION_FAILED", message: "Operation failed. Check server logs.", status_code: 500 } });
  }
});

// src/routes/deliverables.ts
init_deliverable_engine();
init_logger();
import { Router as Router30 } from "express";
var deliverablesRouter = Router30();
var VALID_TYPES = ["analysis", "roadmap", "assessment"];
var VALID_FORMATS = ["pdf", "markdown"];
var rateLimitMap2 = /* @__PURE__ */ new Map();
var RATE_LIMIT = 10;
var RATE_WINDOW_MS = 6e4;
function isRateLimited(key) {
  const now = Date.now();
  if (rateLimitMap2.size > 50) {
    for (const [k, v] of rateLimitMap2) {
      if (now - v.windowStart > RATE_WINDOW_MS * 2) rateLimitMap2.delete(k);
    }
  }
  const entry = rateLimitMap2.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap2.set(key, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}
deliverablesRouter.post("/generate", async (req, res) => {
  const apiKey = (req.headers.authorization ?? "").replace("Bearer ", "") || "anon";
  if (isRateLimited(apiKey)) {
    res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: `Rate limit exceeded (${RATE_LIMIT} req/min)`, status_code: 429 }
    });
    return;
  }
  const body = req.body;
  const prompt = body.prompt;
  const type = body.type;
  const format = body.format ?? "markdown";
  const rawMaxSections = body.max_sections;
  const maxSections = typeof rawMaxSections === "number" && Number.isInteger(rawMaxSections) ? rawMaxSections : void 0;
  if (!prompt || typeof prompt !== "string" || prompt.length < 10) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "prompt is required (min 10 chars)", status_code: 400 }
    });
    return;
  }
  if (!type || !VALID_TYPES.includes(type)) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: `type must be one of: ${VALID_TYPES.join(", ")}`, status_code: 400 }
    });
    return;
  }
  if (format && !VALID_FORMATS.includes(format)) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: `format must be one of: ${VALID_FORMATS.join(", ")}`, status_code: 400 }
    });
    return;
  }
  const request = {
    prompt: prompt.slice(0, 2e3),
    type,
    format,
    max_sections: maxSections
  };
  logger.info({ prompt: prompt.slice(0, 80), type, format }, "Deliverable generation requested");
  try {
    const deliverable = await generateDeliverable(request);
    res.json({
      success: true,
      data: {
        deliverable_id: deliverable.$id,
        title: deliverable.title,
        status: deliverable.status,
        format: deliverable.format,
        sections_count: deliverable.metadata.sections_count,
        total_citations: deliverable.metadata.total_citations,
        avg_confidence: deliverable.metadata.avg_confidence,
        generation_ms: deliverable.metadata.generation_ms,
        url: `/api/deliverables/${encodeURIComponent(deliverable.$id)}`,
        markdown_url: `/api/deliverables/${encodeURIComponent(deliverable.$id)}/markdown`
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Too many concurrent") ? 429 : 500;
    res.status(status).json({
      success: false,
      error: { code: status === 429 ? "RATE_LIMITED" : "GENERATION_FAILED", message, status_code: status }
    });
  }
});
deliverablesRouter.get("/", async (_req, res) => {
  const limit = Math.min(Math.max(parseInt(String(_req.query.limit ?? "20")), 1), 100);
  const deliverables = await listDeliverables(limit);
  res.json({
    success: true,
    data: deliverables.map((d) => ({
      deliverable_id: d.$id,
      title: d.title,
      type: d.type,
      status: d.status,
      sections_count: d.metadata.sections_count,
      total_citations: d.metadata.total_citations,
      generation_ms: d.metadata.generation_ms,
      created_at: d.created_at
    })),
    total: deliverables.length
  });
});
deliverablesRouter.get("/:id", async (req, res) => {
  const deliverable = await getDeliverable(decodeURIComponent(req.params.id));
  if (!deliverable) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Deliverable not found", status_code: 404 }
    });
    return;
  }
  res.json({ success: true, data: deliverable });
});
deliverablesRouter.get("/:id/markdown", async (req, res) => {
  const deliverable = await getDeliverable(decodeURIComponent(req.params.id));
  if (!deliverable) {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "Deliverable not found", status_code: 404 }
    });
    return;
  }
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${deliverable.title.replace(/[^a-zA-Z0-9-_ ]/g, "")}.md"`);
  res.send(deliverable.markdown);
});

// src/routes/similarity.ts
init_similarity_engine();
init_compound_hooks();
init_logger();
import { Router as Router31 } from "express";
var similarityRouter = Router31();
var VALID_DIMENSIONS = [
  "industry",
  "service",
  "challenge",
  "domain",
  "size",
  "geography",
  "deliverable"
];
similarityRouter.post("/search", async (req, res) => {
  const body = req.body;
  const query = body.query;
  if (!query || typeof query !== "string" || query.length < 3) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "query is required (min 3 chars)", status_code: 400 }
    });
    return;
  }
  const rawDimensions = body.dimensions;
  let dimensions;
  if (rawDimensions && Array.isArray(rawDimensions)) {
    const invalid = rawDimensions.filter((d) => !VALID_DIMENSIONS.includes(d));
    if (invalid.length > 0) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: `Invalid dimensions: ${invalid.join(", ")}. Valid: ${VALID_DIMENSIONS.join(", ")}`, status_code: 400 }
      });
      return;
    }
    dimensions = rawDimensions;
  }
  const rawWeight = body.structural_weight;
  const structuralWeight = typeof rawWeight === "number" && rawWeight >= 0 && rawWeight <= 1 ? rawWeight : void 0;
  const rawMax = body.max_results;
  const maxResults = typeof rawMax === "number" && Number.isInteger(rawMax) && rawMax > 0 ? rawMax : void 0;
  const request = {
    query: query.slice(0, 500),
    dimensions,
    max_results: maxResults,
    structural_weight: structuralWeight
  };
  logger.info({ query: query.slice(0, 80) }, "Similarity search requested");
  try {
    const result = await findSimilarClients(request);
    res.json({
      success: true,
      data: {
        query: result.query,
        query_node_id: result.query_node_id,
        method: result.method,
        matches: result.matches,
        total_candidates: result.total_candidates,
        dimensions_used: result.dimensions_used,
        duration_ms: result.duration_ms
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: { code: "SIMILARITY_FAILED", message, status_code: 500 }
    });
  }
});
similarityRouter.post("/select", async (req, res) => {
  const body = req.body;
  const queryId = body.query_id;
  const selectedMatchId = body.selected_match_id;
  const rejectedMatchIds = body.rejected_match_ids;
  if (!selectedMatchId || typeof selectedMatchId !== "string") {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "selected_match_id is required", status_code: 400 }
    });
    return;
  }
  if (!Array.isArray(rejectedMatchIds) || rejectedMatchIds.length === 0) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "rejected_match_ids must be a non-empty array", status_code: 400 }
    });
    return;
  }
  if (rejectedMatchIds.some((id) => typeof id !== "string" || id.length === 0)) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "All rejected_match_ids must be non-empty strings", status_code: 400 }
    });
    return;
  }
  logger.info({ queryId, selected: selectedMatchId, rejected: rejectedMatchIds.length }, "Similarity preference received");
  hookSimilarityPreference(queryId || "unknown", selectedMatchId, rejectedMatchIds).catch(() => {
  });
  res.json({ success: true, data: { message: "Preference logged", selected: selectedMatchId, rejected_count: rejectedMatchIds.length } });
});
similarityRouter.get("/client/:id", async (req, res) => {
  let clientId;
  try {
    clientId = decodeURIComponent(req.params.id);
  } catch {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid client ID encoding", status_code: 400 } });
    return;
  }
  try {
    const details = await getClientDetails(clientId);
    if (!details) {
      res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Client not found", status_code: 404 }
      });
      return;
    }
    res.json({ success: true, data: details });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: { code: "CLIENT_FETCH_FAILED", message, status_code: 500 } });
  }
});

// src/index.ts
init_write_gate();

// src/routes/intelligence.ts
init_document_intelligence();
init_hierarchical_intelligence();
init_graph_hygiene_cron();
init_write_gate();
init_adaptive_rag();
init_logger();
import { Router as Router32 } from "express";
var intelligenceRouter = Router32();
intelligenceRouter.post("/ingest", async (req, res) => {
  const body = req.body;
  const content = body.content;
  const filename = body.filename;
  if (!content || typeof content !== "string" || content.length < 20) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "content is required (min 20 chars)", status_code: 400 }
    });
    return;
  }
  if (!filename || typeof filename !== "string") {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "filename is required", status_code: 400 }
    });
    return;
  }
  const request = {
    content: content.slice(0, 5e5),
    filename: filename.slice(0, 200),
    content_type: body.content_type ?? "text/markdown",
    source_url: body.source_url,
    domain: body.domain,
    extract_entities: body.extract_entities !== false,
    generate_embeddings: body.generate_embeddings !== false
  };
  try {
    const result = await ingestDocument(request);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: "INGESTION_FAILED", message: String(err), status_code: 500 }
    });
  }
});
intelligenceRouter.post("/communities", async (_req, res) => {
  logger.info("Intelligence API: building community summaries");
  try {
    const result = await buildCommunitySummaries();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: "COMMUNITY_BUILD_FAILED", message: String(err), status_code: 500 }
    });
  }
});
intelligenceRouter.get("/communities/search", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "q parameter required", status_code: 400 } });
    return;
  }
  const results = await searchCommunitySummaries(query, 10);
  res.json({ success: true, data: results });
});
intelligenceRouter.get("/adaptive-rag", async (_req, res) => {
  try {
    const dashboard = await getAdaptiveRAGDashboard();
    res.json({ success: true, data: dashboard });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "DASHBOARD_FAILED", message: String(err), status_code: 500 } });
  }
});
intelligenceRouter.post("/adaptive-rag/retrain", async (_req, res) => {
  try {
    const result = await retrainRoutingWeights();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "RETRAIN_FAILED", message: String(err), status_code: 500 } });
  }
});
intelligenceRouter.get("/health", async (_req, res) => {
  try {
    const [hygiene, writeGate] = await Promise.allSettled([
      runGraphHygiene(),
      Promise.resolve(getWriteGateStats())
    ]);
    res.json({
      success: true,
      data: {
        graph_health: hygiene.status === "fulfilled" ? hygiene.value : { error: "unavailable" },
        write_gate: writeGate.status === "fulfilled" ? writeGate.value : { error: "unavailable" }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "HEALTH_CHECK_FAILED", message: String(err), status_code: 500 } });
  }
});

// src/routes/governance.ts
init_manifesto_governance();
init_mcp_caller();
init_logger();
import { Router as Router33 } from "express";
import { v4 as uuid28 } from "uuid";
var governanceRouter = Router33();
governanceRouter.get("/matrix", (_req, res) => {
  res.json({
    success: true,
    data: {
      principles: getEnforcementMatrix(),
      score: getEnforcementScore(),
      version: "1.0.0",
      source: "manifesto-governance.ts",
      governance_model: "Ambient Enforcement \u2014 additive, not subtractive"
    }
  });
});
governanceRouter.get("/score", (_req, res) => {
  const score = getEnforcementScore();
  res.json({ success: true, data: score });
});
governanceRouter.get("/gaps", (_req, res) => {
  const gaps = getGaps();
  res.json({
    success: true,
    data: {
      count: gaps.length,
      gaps,
      remediation_available: gaps.filter((g) => g.gap_remediation).length
    }
  });
});
governanceRouter.post("/sync-graph", async (_req, res) => {
  try {
    const results = [];
    for (const p of MANIFESTO_PRINCIPLES) {
      try {
        const result = await callMcpTool({
          toolName: "graph.write_cypher",
          args: {
            query: `MERGE (p:ManifestoPrinciple {number: $number})
SET p.name = $name,
    p.description = $description,
    p.status = $status,
    p.enforcement_layer = $enforcement_layer,
    p.mechanism = $mechanism,
    p.mechanism_detail = $mechanism_detail,
    p.gap_remediation = $gap_remediation,
    p.updatedAt = datetime()
RETURN p.name as name, p.status as status`,
            params: {
              number: p.number,
              name: p.name,
              description: p.description,
              status: p.status,
              enforcement_layer: p.enforcement_layer,
              mechanism: p.mechanism,
              mechanism_detail: p.mechanism_detail,
              gap_remediation: p.gap_remediation ?? ""
            }
          },
          callId: uuid28(),
          timeoutMs: 15e3
        });
        results.push({
          principle: p.number,
          status: result.status === "success" ? "synced" : "failed"
        });
      } catch (err) {
        logger.warn({ principle: p.number, err: String(err) }, "Failed to sync principle to graph");
        results.push({ principle: p.number, status: "error" });
      }
    }
    const synced = results.filter((r) => r.status === "synced").length;
    res.json({
      success: synced > 0,
      data: {
        synced,
        total: MANIFESTO_PRINCIPLES.length,
        results
      }
    });
  } catch (err) {
    logger.error({ err: String(err) }, "Governance graph sync failed");
    res.status(500).json({
      success: false,
      error: { code: "GOVERNANCE_SYNC_ERROR", message: "Failed to sync governance to graph", status_code: 500 }
    });
  }
});

// src/routes/osint.ts
init_osint_scanner();
init_logger();
import { Router as Router34 } from "express";
var osintRouter = Router34();
osintRouter.post("/scan", async (req, res) => {
  try {
    const body = req.body;
    const validTypes = ["full", "ct_only", "dmarc_only"];
    if (body.scan_type && !validTypes.includes(body.scan_type)) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid scan_type. Valid: ${validTypes.join(", ")}`,
          status_code: 400
        }
      });
      return;
    }
    if (body.domains && (!Array.isArray(body.domains) || body.domains.length === 0)) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "domains must be a non-empty array of strings",
          status_code: 400
        }
      });
      return;
    }
    logger.info({
      domains: body.domains?.length ?? DK_PUBLIC_DOMAINS.length,
      scan_type: body.scan_type ?? "full"
    }, "OSINT scan triggered via API");
    const scanPromise = runOsintScan({
      domains: body.domains,
      scan_type: body.scan_type
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 5e3));
    const result = await Promise.race([scanPromise, timeout]);
    if (result) {
      res.json({
        success: true,
        data: {
          scan_id: result.scan_id,
          duration_ms: result.duration_ms,
          scan_type: result.scan_type,
          domains_scanned: result.domains_scanned,
          ct_entries: result.ct_entries,
          dmarc_results: result.dmarc_results,
          total_new_nodes: result.total_new_nodes,
          tools_available: result.tools_available,
          error_count: result.errors.length,
          errors: result.errors.slice(0, 20)
        }
      });
    } else {
      scanPromise.catch((err) => logger.error({ err: String(err) }, "Background OSINT scan failed"));
      res.status(202).json({
        success: true,
        message: "OSINT scan started. Poll GET /api/osint/status for results.",
        status: "running"
      });
    }
  } catch (err) {
    logger.error({ err: String(err) }, "OSINT scan endpoint failed");
    res.status(500).json({
      success: false,
      error: {
        code: "SCAN_ERROR",
        message: "OSINT scan failed. Check server logs.",
        status_code: 500
      }
    });
  }
});
osintRouter.get("/status", async (_req, res) => {
  try {
    const latest = await getOsintStatus();
    if (!latest) {
      res.json({
        success: true,
        data: {
          status: "no_scans",
          message: "No OSINT scans have been run yet. POST /api/osint/scan to trigger one.",
          total_domains: DK_PUBLIC_DOMAINS.length
        }
      });
      return;
    }
    res.json({
      success: true,
      data: {
        scan_id: latest.scan_id,
        completed_at: latest.completed_at,
        duration_ms: latest.duration_ms,
        scan_type: latest.scan_type,
        domains_scanned: latest.domains_scanned,
        ct_entries: latest.ct_entries,
        dmarc_results: latest.dmarc_results,
        total_new_nodes: latest.total_new_nodes,
        tools_available: latest.tools_available,
        error_count: latest.errors.length,
        coverage: {
          total_domains: DK_PUBLIC_DOMAINS.length,
          scanned: latest.domains_scanned,
          ct_live: latest.ct_results.filter((c) => c.source === "live").length,
          ct_fallback: latest.ct_results.filter((c) => c.source === "fallback").length,
          dmarc_live: latest.dmarc_results_list.filter((d) => d.source === "live").length,
          dmarc_fallback: latest.dmarc_results_list.filter((d) => d.source === "fallback").length
        }
      }
    });
  } catch (err) {
    logger.error({ err: String(err) }, "OSINT status endpoint failed");
    res.status(500).json({
      success: false,
      error: {
        code: "STATUS_ERROR",
        message: "Failed to read OSINT status.",
        status_code: 500
      }
    });
  }
});
osintRouter.get("/domains", (_req, res) => {
  res.json({
    success: true,
    data: {
      count: DK_PUBLIC_DOMAINS.length,
      domains: [...DK_PUBLIC_DOMAINS]
    }
  });
});

// src/routes/evolution.ts
init_evolution_loop();
init_logger();
import { Router as Router35 } from "express";
var evolutionRouter = Router35();
evolutionRouter.post("/run", async (req, res) => {
  const { focus_area, dry_run } = req.body ?? {};
  try {
    const status = getEvolutionStatus();
    if (status.is_running) {
      res.status(409).json({
        success: false,
        error: {
          code: "ALREADY_RUNNING",
          message: `Evolution loop is already running (stage: ${status.current_stage})`,
          status_code: 409
        }
      });
      return;
    }
    const cyclePromise = runEvolutionLoop({
      focus_area: typeof focus_area === "string" ? focus_area : void 0,
      dry_run: typeof dry_run === "boolean" ? dry_run : false
    });
    const raceResult = await Promise.race([
      cyclePromise.then((result) => ({ type: "done", result })),
      new Promise((r) => setTimeout(() => r({ type: "timeout" }), 5e3))
    ]);
    if (raceResult.type === "done") {
      res.json({ success: true, data: raceResult.result });
    } else {
      const currentStatus = getEvolutionStatus();
      res.status(202).json({
        success: true,
        message: "Evolution loop started. Check /api/evolution/status for progress.",
        current_stage: currentStatus.current_stage
      });
      cyclePromise.catch((err) => {
        logger.error({ err: String(err) }, "Background evolution loop failed");
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message }, "Evolution run endpoint failed");
    res.status(500).json({
      success: false,
      error: { code: "EVOLUTION_ERROR", message, status_code: 500 }
    });
  }
});
evolutionRouter.get("/status", (_req, res) => {
  const status = getEvolutionStatus();
  res.json({ success: true, data: status });
});
evolutionRouter.get("/history", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 10, 1), 50);
    const history = await getEvolutionHistory(limit);
    res.json({ success: true, data: history, count: history.length });
  } catch (err) {
    logger.error({ err: String(err) }, "Evolution history endpoint failed");
    res.status(500).json({
      success: false,
      error: { code: "HISTORY_ERROR", message: String(err), status_code: 500 }
    });
  }
});

// src/routes/memory.ts
import { Router as Router36 } from "express";

// src/working-memory.ts
init_redis();
init_logger();
var PREFIX = "wm:";
var DEFAULT_TTL = 86400;
async function storeMemory(agentId, key, value, ttlSeconds = DEFAULT_TTL) {
  const redis2 = getRedis();
  const redisKey = `${PREFIX}${agentId}:${key}`;
  const entry = {
    key,
    value,
    agent_id: agentId,
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    ttl_seconds: ttlSeconds
  };
  if (redis2) {
    try {
      await redis2.set(redisKey, JSON.stringify(entry), "EX", ttlSeconds);
    } catch (err) {
      logger.warn({ agentId, key, err: String(err) }, "Working memory store failed");
    }
  }
  return entry;
}
async function retrieveMemory(agentId, key) {
  const redis2 = getRedis();
  if (!redis2) return null;
  try {
    const raw = await redis2.get(`${PREFIX}${agentId}:${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function listMemories(agentId) {
  const redis2 = getRedis();
  if (!redis2) return [];
  try {
    const keys = await redis2.keys(`${PREFIX}${agentId}:*`);
    const entries = [];
    for (const k of keys.slice(0, 100)) {
      const raw = await redis2.get(k);
      if (raw) entries.push(JSON.parse(raw));
    }
    return entries.sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch {
    return [];
  }
}
async function deleteMemory(agentId, key) {
  const redis2 = getRedis();
  if (!redis2) return false;
  try {
    const result = await redis2.del(`${PREFIX}${agentId}:${key}`);
    return result > 0;
  } catch {
    return false;
  }
}
async function clearAgentMemory(agentId) {
  const redis2 = getRedis();
  if (!redis2) return 0;
  try {
    const keys = await redis2.keys(`${PREFIX}${agentId}:*`);
    if (keys.length === 0) return 0;
    return await redis2.del(...keys);
  } catch {
    return 0;
  }
}

// src/routes/memory.ts
init_logger();
var memoryRouter = Router36();
memoryRouter.post("/store", async (req, res) => {
  const body = req.body;
  const agentId = body.agent_id;
  const key = body.key;
  const value = body.value;
  if (!agentId || typeof agentId !== "string") {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "agent_id is required", status_code: 400 } });
    return;
  }
  if (!key || typeof key !== "string") {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "key is required", status_code: 400 } });
    return;
  }
  if (value === void 0) {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "value is required", status_code: 400 } });
    return;
  }
  const ttl = typeof body.ttl_seconds === "number" ? body.ttl_seconds : void 0;
  const entry = await storeMemory(agentId, key, value, ttl);
  logger.info({ agentId, key }, "Working memory stored");
  res.json({ success: true, data: entry });
});
memoryRouter.get("/:agent_id", async (req, res) => {
  const agentId = decodeURIComponent(req.params.agent_id);
  const entries = await listMemories(agentId);
  res.json({ success: true, data: { agent_id: agentId, entries, count: entries.length } });
});
memoryRouter.get("/:agent_id/:key", async (req, res) => {
  const agentId = decodeURIComponent(req.params.agent_id);
  const key = decodeURIComponent(req.params.key);
  const entry = await retrieveMemory(agentId, key);
  if (!entry) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Memory '${key}' not found for agent '${agentId}'`, status_code: 404 } });
    return;
  }
  res.json({ success: true, data: entry });
});
memoryRouter.delete("/:agent_id/:key", async (req, res) => {
  const agentId = decodeURIComponent(req.params.agent_id);
  const key = decodeURIComponent(req.params.key);
  const deleted = await deleteMemory(agentId, key);
  if (!deleted) {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Memory '${key}' not found`, status_code: 404 } });
    return;
  }
  res.json({ success: true, data: { deleted: true, agent_id: agentId, key } });
});
memoryRouter.delete("/:agent_id", async (req, res) => {
  const agentId = decodeURIComponent(req.params.agent_id);
  const count = await clearAgentMemory(agentId);
  logger.info({ agentId, count }, "Working memory cleared");
  res.json({ success: true, data: { cleared: count, agent_id: agentId } });
});

// src/routes/abi-docs.ts
init_tool_registry();
import { Router as Router37 } from "express";
init_logger();
var abiDocsRouter = Router37();
abiDocsRouter.get("/docs", (_req, res) => {
  const namespace = _req.query.namespace ?? void 0;
  const category = _req.query.category ?? void 0;
  let tools = TOOL_REGISTRY;
  if (namespace) {
    tools = tools.filter((t) => t.namespace === namespace);
  }
  if (category) {
    tools = tools.filter((t) => t.category === category);
  }
  const toolDocs = tools.map((t) => ({
    name: t.name,
    namespace: t.namespace,
    description: t.description,
    input_schema: t.inputSchema,
    examples: buildExamples(t.name, t.inputSchema),
    protocols: t.availableVia,
    category: t.category,
    version: t.version,
    deprecated: !!t.deprecated,
    ...t.deprecated ? { deprecated_since: t.deprecated.since, replacement: t.deprecated.replacement } : {},
    handler: t.handler,
    timeout_ms: t.timeoutMs,
    output_description: t.outputDescription ?? null,
    tags: t.tags
  }));
  const byNamespace = {};
  const byCategory = {};
  for (const t of TOOL_REGISTRY) {
    byNamespace[t.namespace] = (byNamespace[t.namespace] ?? 0) + 1;
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
  }
  res.json({
    tools: toolDocs,
    stats: {
      total: TOOL_REGISTRY.length,
      filtered: toolDocs.length,
      by_namespace: byNamespace,
      by_category: byCategory,
      categories: getCategories()
    },
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  });
});
abiDocsRouter.post("/try", async (req, res) => {
  const { tool, arguments: args } = req.body ?? {};
  if (!tool || typeof tool !== "string") {
    res.status(400).json({
      success: false,
      error: { code: "MISSING_TOOL", message: 'Request body must include "tool" (string)', status_code: 400 }
    });
    return;
  }
  const toolDef = TOOL_REGISTRY.find((t) => t.name === tool);
  if (!toolDef) {
    res.status(404).json({
      success: false,
      error: {
        code: "TOOL_NOT_FOUND",
        message: `Tool "${tool}" not found. Use GET /api/abi/docs to see available tools.`,
        status_code: 404,
        available_tools: TOOL_REGISTRY.map((t) => t.name)
      }
    });
    return;
  }
  const safeArgs = args && typeof args === "object" ? args : {};
  logger.info({ tool, args_keys: Object.keys(safeArgs) }, "ABI playground: executing tool");
  const result = await executeToolUnified(tool, safeArgs, {
    source_protocol: "abi-playground",
    fold: false
    // Return full result for playground
  });
  res.json({
    success: result.status === "success",
    result: result.result,
    error_message: result.error_message ?? null,
    duration_ms: result.duration_ms,
    tool,
    tool_meta: {
      namespace: toolDef.namespace,
      category: toolDef.category,
      handler: toolDef.handler,
      timeout_ms: toolDef.timeoutMs
    }
  });
});
function buildExamples(toolName, schema) {
  const props = schema?.properties ?? {};
  const required2 = schema?.required ?? [];
  const minimalArgs = {};
  for (const key of required2) {
    const prop = props[key];
    if (!prop) continue;
    if (prop.type === "string") minimalArgs[key] = prop.enum?.[0] ?? `example_${key}`;
    else if (prop.type === "number") minimalArgs[key] = 10;
    else if (prop.type === "boolean") minimalArgs[key] = true;
    else if (prop.type === "array") minimalArgs[key] = [];
    else if (prop.type === "object") minimalArgs[key] = {};
  }
  const examples = [];
  const curated = CURATED_EXAMPLES[toolName];
  if (curated) {
    examples.push(...curated);
  } else if (Object.keys(minimalArgs).length > 0) {
    examples.push({ description: "Minimal call with required fields", arguments: minimalArgs });
  }
  return examples;
}
var CURATED_EXAMPLES = {
  search_knowledge: [
    { description: "Search for cloud migration patterns", arguments: { query: "cloud migration strategy", max_results: 5 } },
    { description: "Find consulting frameworks", arguments: { query: "consulting framework" } }
  ],
  reason_deeply: [
    { description: "Analyze architecture trade-offs", arguments: { question: "What are the trade-offs between microservices and monolith?", mode: "analyze" } }
  ],
  query_graph: [
    { description: "Count all nodes by label", arguments: { cypher: "MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count ORDER BY count DESC LIMIT 20" } }
  ],
  get_platform_health: [
    { description: "Check platform health", arguments: {} }
  ],
  list_tools: [
    { description: "List all tools", arguments: {} },
    { description: "Filter by namespace", arguments: { namespace: "knowledge" } }
  ],
  call_mcp_tool: [
    { description: "Call graph health check", arguments: { tool_name: "graph.health", payload: {} } }
  ],
  linear_issues: [
    { description: "Get active issues", arguments: { status: "active", limit: 5 } }
  ],
  governance_matrix: [
    { description: "Show enforcement gaps", arguments: { filter: "gaps" } }
  ]
};

// src/routes/abi-health.ts
init_tool_registry();
init_logger();
import { Router as Router38 } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var abiHealthRouter = Router38();
function getSnapshotPath() {
  const testPath = path.resolve(__dirname, "..", "..", "test", "snapshots", "abi-snapshot.json");
  if (existsSync(testPath)) return testPath;
  const distPath = path.resolve(__dirname, "..", "abi-snapshot.json");
  return existsSync(distPath) ? distPath : testPath;
}
function buildCurrentSnapshot() {
  const openaiTools = toOpenAITools();
  const mcpTools = toMCPTools();
  const openapiPaths = toOpenAPIPaths();
  return {
    tools: TOOL_REGISTRY.map((t) => ({
      name: t.name,
      namespace: t.namespace,
      version: t.version,
      description: t.description,
      category: t.category,
      inputSchema: t.inputSchema,
      handler: t.handler,
      backendTool: t.backendTool ?? null,
      timeoutMs: t.timeoutMs,
      authRequired: t.authRequired,
      availableVia: t.availableVia,
      tags: t.tags,
      deprecated: t.deprecated ?? null
    })),
    protocols: {
      openai: { count: openaiTools.length, tools: openaiTools.map((t) => t.function.name) },
      mcp: { count: mcpTools.length, tools: mcpTools.map((t) => t.name) },
      openapi: { count: Object.keys(openapiPaths).length, paths: Object.keys(openapiPaths) }
    },
    meta: {
      total_tools: TOOL_REGISTRY.length,
      namespaces: [...new Set(TOOL_REGISTRY.map((t) => t.namespace))].sort(),
      deprecated_count: TOOL_REGISTRY.filter((t) => t.deprecated).length,
      generated_at: (/* @__PURE__ */ new Date()).toISOString(),
      abi_version: "1.0"
    }
  };
}
function diffSnapshots(baseline, current) {
  const breaking = [];
  const additive = [];
  const compatible = [];
  const baseToolMap = new Map(baseline.tools.map((t) => [t.name, t]));
  const currToolMap = new Map(current.tools.map((t) => [t.name, t]));
  for (const [name] of baseToolMap) {
    if (!currToolMap.has(name)) breaking.push(`REMOVED tool: ${name}`);
  }
  for (const [name] of currToolMap) {
    if (!baseToolMap.has(name)) additive.push(`ADDED tool: ${name}`);
  }
  for (const [name, baseTool] of baseToolMap) {
    const currTool = currToolMap.get(name);
    if (!currTool) continue;
    const baseSchema = baseTool.inputSchema ?? {};
    const currSchema = currTool.inputSchema ?? {};
    const baseRequired = new Set(baseSchema.required ?? []);
    const currRequired = new Set(currSchema.required ?? []);
    const baseProps = baseSchema.properties ?? {};
    const currProps = currSchema.properties ?? {};
    for (const field of Object.keys(baseProps)) {
      if (!(field in currProps)) breaking.push(`REMOVED field: ${name}.${field}`);
    }
    for (const field of currRequired) {
      if (!baseRequired.has(field) && !(field in baseProps)) {
        breaking.push(`ADDED required field: ${name}.${field}`);
      }
    }
    for (const field of Object.keys(baseProps)) {
      if (!(field in currProps)) continue;
      const bt = baseProps[field]?.type;
      const ct = currProps[field]?.type;
      if (bt && ct && bt !== ct) breaking.push(`CHANGED type: ${name}.${field} (${bt} -> ${ct})`);
    }
    for (const field of Object.keys(currProps)) {
      if (!(field in baseProps) && !currRequired.has(field)) {
        additive.push(`ADDED optional field: ${name}.${field}`);
      }
    }
    if (baseTool.description !== currTool.description) {
      compatible.push(`UPDATED description: ${name}`);
    }
    const baseProtos = new Set(baseTool.availableVia ?? []);
    const currProtos = new Set(currTool.availableVia ?? []);
    for (const p of baseProtos) {
      if (!currProtos.has(p)) breaking.push(`REMOVED protocol: ${name} no longer via ${p}`);
    }
    for (const p of currProtos) {
      if (!baseProtos.has(p)) additive.push(`ADDED protocol: ${name} now via ${p}`);
    }
  }
  return { breaking, additive, compatible };
}
abiHealthRouter.get("/health", (_req, res) => {
  const openaiTools = toOpenAITools();
  const mcpTools = toMCPTools();
  const openapiPaths = toOpenAPIPaths();
  const snapshotPath = getSnapshotPath();
  const hasBaseline = existsSync(snapshotPath);
  res.json({
    success: true,
    data: {
      total_tools: TOOL_REGISTRY.length,
      namespaces: [...new Set(TOOL_REGISTRY.map((t) => t.namespace))].sort(),
      deprecated: TOOL_REGISTRY.filter((t) => t.deprecated).length,
      protocols: {
        openai: openaiTools.length,
        mcp: mcpTools.length,
        openapi: Object.keys(openapiPaths).length
      },
      has_baseline_snapshot: hasBaseline,
      abi_version: "1.0",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }
  });
});
abiHealthRouter.get("/diff", (_req, res) => {
  const snapshotPath = getSnapshotPath();
  if (!existsSync(snapshotPath)) {
    res.status(404).json({
      success: false,
      error: { code: "NO_BASELINE", message: "No baseline snapshot found. POST /api/abi/snapshot to create one.", status_code: 404 }
    });
    return;
  }
  try {
    const baseline = JSON.parse(readFileSync(snapshotPath, "utf-8"));
    const current = buildCurrentSnapshot();
    const diff = diffSnapshots(baseline, current);
    const totalChanges = diff.breaking.length + diff.additive.length + diff.compatible.length;
    const isCompatible = diff.breaking.length === 0;
    res.json({
      success: true,
      data: {
        compatible: isCompatible,
        baseline_tools: baseline.meta.total_tools,
        current_tools: current.meta.total_tools,
        baseline_generated_at: baseline.meta.generated_at,
        changes: {
          total: totalChanges,
          breaking: diff.breaking,
          additive: diff.additive,
          compatible: diff.compatible
        }
      }
    });
  } catch (err) {
    logger.error({ err: String(err) }, "ABI diff error");
    res.status(500).json({
      success: false,
      error: { code: "ABI_DIFF_ERROR", message: String(err), status_code: 500 }
    });
  }
});
abiHealthRouter.post("/snapshot", (_req, res) => {
  try {
    const snapshot = buildCurrentSnapshot();
    const snapshotPath = path.resolve(__dirname, "..", "..", "test", "snapshots", "abi-snapshot.json");
    const dir = path.dirname(snapshotPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    logger.info({
      tools: snapshot.meta.total_tools,
      namespaces: snapshot.meta.namespaces.length
    }, "ABI snapshot saved");
    res.json({
      success: true,
      data: {
        message: "ABI baseline snapshot saved",
        total_tools: snapshot.meta.total_tools,
        namespaces: snapshot.meta.namespaces,
        protocols: snapshot.protocols,
        saved_to: snapshotPath,
        generated_at: snapshot.meta.generated_at
      }
    });
  } catch (err) {
    logger.error({ err: String(err) }, "ABI snapshot save error");
    res.status(500).json({
      success: false,
      error: { code: "ABI_SNAPSHOT_ERROR", message: String(err), status_code: 500 }
    });
  }
});

// src/routes/abi-versioning.ts
init_tool_registry();
import { Router as Router39 } from "express";
var abiVersioningRouter = Router39();
abiVersioningRouter.get("/versions", (_req, res) => {
  const tools = TOOL_REGISTRY.map((t) => ({
    name: t.name,
    namespace: t.namespace,
    version: t.version,
    category: t.category,
    deprecated: t.deprecated ?? false,
    deprecatedSince: t.deprecatedSince ?? null,
    deprecatedMessage: t.deprecatedMessage ?? null,
    sunsetDate: t.sunsetDate ?? null,
    replacedBy: t.replacedBy ?? null,
    availableVia: t.availableVia
  }));
  res.json({
    success: true,
    data: {
      tools,
      total: tools.length,
      deprecated_count: tools.filter((t) => t.deprecated).length,
      active_count: tools.filter((t) => !t.deprecated).length
    }
  });
});
abiVersioningRouter.get("/deprecated", (_req, res) => {
  const deprecated = TOOL_REGISTRY.filter((t) => t.deprecated).map((t) => ({
    name: t.name,
    namespace: t.namespace,
    version: t.version,
    deprecatedSince: t.deprecatedSince ?? null,
    deprecatedMessage: t.deprecatedMessage ?? null,
    sunsetDate: t.sunsetDate ?? null,
    replacedBy: t.replacedBy ?? null,
    migration: t.replacedBy ? `Replace calls to "${t.name}" with "${t.replacedBy}". ${t.deprecatedMessage ?? ""}` : t.deprecatedMessage ?? "No migration guidance available."
  }));
  res.json({
    success: true,
    data: {
      deprecated,
      count: deprecated.length,
      upcoming_sunsets: deprecated.filter((d) => d.sunsetDate).sort((a, b) => (a.sunsetDate ?? "").localeCompare(b.sunsetDate ?? ""))
    }
  });
});
var ABI_CHANGELOG = [
  {
    version: "2.0.0",
    date: "2026-03-28",
    changes: [
      { type: "added", tool: "search_knowledge", description: "Dual-channel RAG (SRAG + Neo4j graph) search" },
      { type: "added", tool: "reason_deeply", description: "RLM reasoning engine proxy" },
      { type: "added", tool: "query_graph", description: "Neo4j Cypher read queries" },
      { type: "added", tool: "check_tasks", description: "Linear task status from graph" },
      { type: "added", tool: "call_mcp_tool", description: "Dynamic MCP tool proxy (449+ tools)" },
      { type: "added", tool: "get_platform_health", description: "Platform service health check" },
      { type: "added", tool: "search_documents", description: "Document search via SRAG" },
      { type: "added", tool: "linear_issues", description: "Linear issue listing" },
      { type: "added", tool: "linear_issue_detail", description: "Linear issue detail" },
      { type: "added", tool: "run_chain", description: "Multi-step agent chain execution" },
      { type: "added", tool: "investigate", description: "Deep multi-agent investigation" },
      { type: "added", tool: "create_notebook", description: "Interactive consulting notebook" },
      { type: "added", tool: "verify_output", description: "Content verification checks" }
    ]
  },
  {
    version: "2.1.0",
    date: "2026-03-30",
    changes: [
      { type: "added", tool: "generate_deliverable", description: "Consulting deliverable generation (analysis/roadmap/assessment)" },
      { type: "added", tool: "precedent_search", description: "Hybrid structural + semantic client similarity" }
    ]
  },
  {
    version: "2.2.0",
    date: "2026-04-02",
    changes: [
      { type: "added", tool: "governance_matrix", description: "Manifesto enforcement matrix (10 principles)" },
      { type: "added", tool: "run_osint_scan", description: "OSINT scanning pipeline for DK public sector" }
    ]
  },
  {
    version: "2.3.0",
    date: "2026-04-03",
    changes: [
      { type: "added", tool: "run_evolution", description: "Autonomous OODA evolution loop" },
      { type: "added", tool: "list_tools", description: "Tool discovery with schema and protocol info" }
    ]
  },
  {
    version: "2.4.0",
    date: "2026-04-03",
    changes: [
      { type: "changed", tool: "*", description: "LIN-573: ABI tool-level versioning + deprecation lifecycle. All tools now expose version, deprecation status, sunset dates, and migration guidance across all 3 protocols." }
    ]
  }
];
abiVersioningRouter.get("/changelog", (_req, res) => {
  res.json({
    success: true,
    data: {
      changelog: ABI_CHANGELOG,
      latest_version: ABI_CHANGELOG[ABI_CHANGELOG.length - 1]?.version ?? "0.0.0",
      total_entries: ABI_CHANGELOG.length
    }
  });
});

// src/index.ts
var __dirname2 = path2.dirname(fileURLToPath2(import.meta.url));
var app = express();
var server = createServer(app);
app.use(helmet({
  contentSecurityPolicy: false,
  // SPA uses inline styles + scripts
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const trusted = [
      "https://consulting-production-b5d8.up.railway.app",
      "https://orchestrator-production-c27e.up.railway.app",
      "https://open-webui-production-25cb.up.railway.app"
    ];
    if (trusted.includes(origin)) return callback(null, true);
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    const aiPlatforms = [
      /\.google\.com$/,
      // AI Studio, Gemini
      /\.googleapis\.com$/,
      // Google APIs
      /\.openai\.com$/,
      // ChatGPT
      /\.chatgpt\.com$/,
      // ChatGPT new domain
      /\.anthropic\.com$/,
      // Claude
      /\.railway\.app$/,
      // Any Railway service
      /\.vercel\.app$/,
      // Vercel previews
      /\.netlify\.app$/
      // Netlify previews
    ];
    if (aiPlatforms.some((re) => re.test(origin))) return callback(null, true);
    callback(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, "Request");
  next();
});
app.use(express.static(path2.join(__dirname2, "public"), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  }
}));
app.use(auditMiddleware);
app.use("/agents", requireApiKey, agentsRouter);
app.use("/tools", requireApiKey, toolsRouter);
app.use("/chat", requireApiKey, chatRouter);
app.use("/chains", requireApiKey, chainsRouter);
app.use("/cognitive", requireApiKey, cognitiveRouter);
app.use("/cron", requireApiKey, cronRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/openclaw", requireApiKey, openclawRouter);
app.use("/api/audit", requireApiKey, auditRouter);
app.use("/api/knowledge", requireApiKey, knowledgeRouter);
app.use("/api/adoption", requireApiKey, adoptionRouter);
app.use("/api/artifacts", requireApiKey, artifactRouter);
app.use("/api/notebooks", requireApiKey, notebookRouter);
app.use("/api/drill", requireApiKey, drillRouter);
app.use("/api/llm", requireApiKey, llmRouter);
app.use("/api/assembly", requireApiKey, assemblyRouter);
app.use("/api/loose-ends", requireApiKey, looseEndsRouter);
app.use("/api/decisions", requireApiKey, decisionsRouter);
app.use("/monitor", requireApiKey, monitorRouter);
app.use("/api/s1-s4", requireApiKey, s1s4Router);
app.use("/api/failures", requireApiKey, failuresRouter);
app.use("/api/competitive", requireApiKey, competitiveRouter);
app.use("/api/fold", requireApiKey, foldRouter);
app.use("/api/graph-hygiene", requireApiKey, graphHygieneRouter);
app.use("/api/deliverables", requireApiKey, deliverablesRouter);
app.use("/api/similarity", requireApiKey, similarityRouter);
app.use("/api/intelligence", requireApiKey, intelligenceRouter);
app.use("/api/governance", requireApiKey, governanceRouter);
app.use("/api/osint", requireApiKey, osintRouter);
app.use("/api/evolution", requireApiKey, evolutionRouter);
app.use("/api/memory", requireApiKey, memoryRouter);
app.use("/api/abi", requireApiKey, abiDocsRouter);
app.use("/api/abi", requireApiKey, abiHealthRouter);
app.use("/api/abi", requireApiKey, abiVersioningRouter);
app.use("/api/tools", requireApiKey, toolGatewayRouter);
app.use("/api/prompt-generator", promptGeneratorRouter);
app.use(openapiRouter);
app.use("/mcp", requireApiKey, mcpGatewayRouter);
app.use(openaiCompatRouter);
app.get("/api/plans", requireApiKey, async (_req, res) => {
  try {
    const plans = await listPlans();
    res.json({ success: true, plans, count: plans.length });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});
app.post("/api/harvest/:domain", requireApiKey, async (req, res) => {
  try {
    const result = await runHarvestPipeline(req.params.domain);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});
app.post("/api/harvest", requireApiKey, async (_req, res) => {
  try {
    const results = await runFullHarvest();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});
app.get("/api/events", requireApiKey, handleSSE);
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "widgetdc-orchestrator",
    version: "3.1.0",
    uptime_seconds: Math.floor(process.uptime()),
    agents_registered: AgentRegistry.all().length,
    ws_connections: getConnectionStats().total,
    sse_clients: getSSEClientCount(),
    redis_enabled: isRedisEnabled(),
    rlm_available: isRlmAvailable(),
    active_chains: listExecutions().filter((e) => e.status === "running").length,
    cron_jobs: listCronJobs().filter((j) => j.enabled).length,
    openclaw_healthy: isOpenClawHealthy(),
    librechat_url: config.libreChatUrl || null,
    slack_enabled: isSlackEnabled(),
    write_gate_stats: getWriteGateStats(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/", (_req, res) => {
  res.sendFile(path2.join(__dirname2, "public", "index.html"));
});
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_JSON", message: "Request body contains invalid JSON", status_code: 400 }
    });
    return;
  }
  next(err);
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
async function boot() {
  await initRedis();
  await AgentRegistry.hydrate();
  seedAgents();
  await hydrateMessages();
  await hydrateCronJobs();
  registerDefaultLoops();
  initOpenClaw();
  initWebSocket(server);
  server.listen(config.port, () => {
    logger.info(
      { port: config.port, backend: config.backendUrl, env: config.nodeEnv, redis: isRedisEnabled() },
      "WidgeTDC Orchestrator ready"
    );
  });
}
boot().catch((err) => {
  logger.error({ err: String(err) }, "Boot failed");
  process.exit(1);
});
process.on("SIGTERM", () => {
  logger.info("SIGTERM received \u2014 shutting down gracefully");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
