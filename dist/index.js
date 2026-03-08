import { createRequire } from 'module'; const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/index.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

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
  // RLM Engine (optional — cognitive reasoning proxy)
  rlmUrl: optional("RLM_URL", "https://rlm-engine-production.up.railway.app"),
  // Redis (optional — for agent registry persistence across restarts)
  redisUrl: optional("REDIS_URL", ""),
  // Orchestrator API key (required for /agents/register and /tools/call)
  orchestratorApiKey: optional("ORCHESTRATOR_API_KEY", ""),
  // OpenClaw gateway (optional — for terminal/agent spawning)
  openclawUrl: optional("OPENCLAW_URL", ""),
  openclawToken: optional("OPENCLAW_GATEWAY_TOKEN", ""),
  // Orchestrator identity
  orchestratorId: optional("ORCHESTRATOR_ID", "widgetdc-orchestrator-v1"),
  // WebSocket heartbeat interval (ms)
  wsHeartbeatMs: parseInt(optional("WS_HEARTBEAT_MS", "30000"), 10),
  // MCP tool call timeout (ms)
  mcpTimeoutMs: parseInt(optional("MCP_TIMEOUT_MS", "60000"), 10),
  // Rate limiting: max concurrent tool calls per agent
  maxConcurrentPerAgent: parseInt(optional("MAX_CONCURRENT_PER_AGENT", "5"), 10),
  agentOpenAccess: optional("AGENT_OPEN_ACCESS", "true") === "true"
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

// src/redis.ts
import Redis from "ioredis";
var redisUrl = process.env["REDIS_URL"] ?? "";
var redis = null;
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

// src/routes/agents.ts
import { Router } from "express";

// src/agent-registry.ts
var REDIS_KEY = "orchestrator:agents";
var registry = /* @__PURE__ */ new Map();
function persistToRedis(agentId, entry) {
  const redis2 = getRedis();
  if (!redis2) return;
  const serialised = JSON.stringify({
    handshake: entry.handshake,
    registeredAt: entry.registeredAt.toISOString(),
    lastSeenAt: entry.lastSeenAt.toISOString()
  });
  redis2.hset(REDIS_KEY, agentId, serialised).catch((err) => {
    logger.warn({ err: String(err), agent_id: agentId }, "Redis persist failed");
  });
}
var AgentRegistry = {
  /** Hydrate registry from Redis on startup */
  async hydrate() {
    const redis2 = getRedis();
    if (!redis2) return;
    try {
      const all = await redis2.hgetall(REDIS_KEY);
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

// src/slack.ts
var webhookUrl = process.env["SLACK_WEBHOOK_URL"] ?? "";
function isSlackEnabled() {
  return webhookUrl.length > 0;
}
async function postToSlack(blocks, text) {
  if (!isSlackEnabled()) return;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks })
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Slack webhook failed");
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Slack webhook error");
  }
}
function notifyAgentRegistered(agentId, displayName, namespaces) {
  postToSlack([
    {
      type: "header",
      text: { type: "plain_text", text: `Agent Registered: ${displayName}`, emoji: true }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Agent ID:*
\`${agentId}\`` },
        { type: "mrkdwn", text: `*Tool Namespaces:*
${namespaces.join(", ")}` }
      ]
    }
  ], `Agent ${displayName} (${agentId}) registered`);
}
function notifyToolCall(agentId, toolName, status, durationMs, errorMessage) {
  const emoji = status === "success" ? ":white_check_mark:" : ":x:";
  const color = status === "success" ? "#36a64f" : "#e01e5a";
  const fields = [
    { type: "mrkdwn", text: `*Agent:*
\`${agentId}\`` },
    { type: "mrkdwn", text: `*Tool:*
\`${toolName}\`` },
    { type: "mrkdwn", text: `*Status:*
${emoji} ${status}` },
    { type: "mrkdwn", text: `*Duration:*
${durationMs}ms` }
  ];
  if (errorMessage) {
    fields.push({ type: "mrkdwn", text: `*Error:*
\`${errorMessage.slice(0, 200)}\`` });
  }
  postToSlack([
    { type: "section", fields },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `Orchestrator: \`${config.orchestratorId}\`` }]
    }
  ], `${emoji} ${agentId} called ${toolName} \u2192 ${status} (${durationMs}ms)`);
}
function notifyChatMessage(from, to, message) {
  postToSlack([
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${from}* \u2192 *${to}*
${message.slice(0, 500)}`
      }
    }
  ], `${from} \u2192 ${to}: ${message.slice(0, 100)}`);
}

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
function Create(errorType, schema, path2, value, errors = []) {
  return {
    type: errorType,
    schema,
    path: path2,
    value,
    message: GetErrorFunction()({ errorType, path: path2, schema, value, errors }),
    errors
  };
}
function* FromAny2(schema, references, path2, value) {
}
function* FromArgument2(schema, references, path2, value) {
}
function* FromArray4(schema, references, path2, value) {
  if (!IsArray(value)) {
    return yield Create(ValueErrorType.Array, schema, path2, value);
  }
  if (IsDefined2(schema.minItems) && !(value.length >= schema.minItems)) {
    yield Create(ValueErrorType.ArrayMinItems, schema, path2, value);
  }
  if (IsDefined2(schema.maxItems) && !(value.length <= schema.maxItems)) {
    yield Create(ValueErrorType.ArrayMaxItems, schema, path2, value);
  }
  for (let i = 0; i < value.length; i++) {
    yield* Visit4(schema.items, references, `${path2}/${i}`, value[i]);
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
    yield Create(ValueErrorType.ArrayUniqueItems, schema, path2, value);
  }
  if (!(IsDefined2(schema.contains) || IsDefined2(schema.minContains) || IsDefined2(schema.maxContains))) {
    return;
  }
  const containsSchema = IsDefined2(schema.contains) ? schema.contains : Never();
  const containsCount = value.reduce((acc, value2, index) => Visit4(containsSchema, references, `${path2}${index}`, value2).next().done === true ? acc + 1 : acc, 0);
  if (containsCount === 0) {
    yield Create(ValueErrorType.ArrayContains, schema, path2, value);
  }
  if (IsNumber(schema.minContains) && containsCount < schema.minContains) {
    yield Create(ValueErrorType.ArrayMinContains, schema, path2, value);
  }
  if (IsNumber(schema.maxContains) && containsCount > schema.maxContains) {
    yield Create(ValueErrorType.ArrayMaxContains, schema, path2, value);
  }
}
function* FromAsyncIterator2(schema, references, path2, value) {
  if (!IsAsyncIterator(value))
    yield Create(ValueErrorType.AsyncIterator, schema, path2, value);
}
function* FromBigInt2(schema, references, path2, value) {
  if (!IsBigInt(value))
    return yield Create(ValueErrorType.BigInt, schema, path2, value);
  if (IsDefined2(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    yield Create(ValueErrorType.BigIntExclusiveMaximum, schema, path2, value);
  }
  if (IsDefined2(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    yield Create(ValueErrorType.BigIntExclusiveMinimum, schema, path2, value);
  }
  if (IsDefined2(schema.maximum) && !(value <= schema.maximum)) {
    yield Create(ValueErrorType.BigIntMaximum, schema, path2, value);
  }
  if (IsDefined2(schema.minimum) && !(value >= schema.minimum)) {
    yield Create(ValueErrorType.BigIntMinimum, schema, path2, value);
  }
  if (IsDefined2(schema.multipleOf) && !(value % schema.multipleOf === BigInt(0))) {
    yield Create(ValueErrorType.BigIntMultipleOf, schema, path2, value);
  }
}
function* FromBoolean2(schema, references, path2, value) {
  if (!IsBoolean(value))
    yield Create(ValueErrorType.Boolean, schema, path2, value);
}
function* FromConstructor2(schema, references, path2, value) {
  yield* Visit4(schema.returns, references, path2, value.prototype);
}
function* FromDate2(schema, references, path2, value) {
  if (!IsDate(value))
    return yield Create(ValueErrorType.Date, schema, path2, value);
  if (IsDefined2(schema.exclusiveMaximumTimestamp) && !(value.getTime() < schema.exclusiveMaximumTimestamp)) {
    yield Create(ValueErrorType.DateExclusiveMaximumTimestamp, schema, path2, value);
  }
  if (IsDefined2(schema.exclusiveMinimumTimestamp) && !(value.getTime() > schema.exclusiveMinimumTimestamp)) {
    yield Create(ValueErrorType.DateExclusiveMinimumTimestamp, schema, path2, value);
  }
  if (IsDefined2(schema.maximumTimestamp) && !(value.getTime() <= schema.maximumTimestamp)) {
    yield Create(ValueErrorType.DateMaximumTimestamp, schema, path2, value);
  }
  if (IsDefined2(schema.minimumTimestamp) && !(value.getTime() >= schema.minimumTimestamp)) {
    yield Create(ValueErrorType.DateMinimumTimestamp, schema, path2, value);
  }
  if (IsDefined2(schema.multipleOfTimestamp) && !(value.getTime() % schema.multipleOfTimestamp === 0)) {
    yield Create(ValueErrorType.DateMultipleOfTimestamp, schema, path2, value);
  }
}
function* FromFunction2(schema, references, path2, value) {
  if (!IsFunction(value))
    yield Create(ValueErrorType.Function, schema, path2, value);
}
function* FromImport2(schema, references, path2, value) {
  const definitions = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  yield* Visit4(target, [...references, ...definitions], path2, value);
}
function* FromInteger2(schema, references, path2, value) {
  if (!IsInteger(value))
    return yield Create(ValueErrorType.Integer, schema, path2, value);
  if (IsDefined2(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    yield Create(ValueErrorType.IntegerExclusiveMaximum, schema, path2, value);
  }
  if (IsDefined2(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    yield Create(ValueErrorType.IntegerExclusiveMinimum, schema, path2, value);
  }
  if (IsDefined2(schema.maximum) && !(value <= schema.maximum)) {
    yield Create(ValueErrorType.IntegerMaximum, schema, path2, value);
  }
  if (IsDefined2(schema.minimum) && !(value >= schema.minimum)) {
    yield Create(ValueErrorType.IntegerMinimum, schema, path2, value);
  }
  if (IsDefined2(schema.multipleOf) && !(value % schema.multipleOf === 0)) {
    yield Create(ValueErrorType.IntegerMultipleOf, schema, path2, value);
  }
}
function* FromIntersect4(schema, references, path2, value) {
  let hasError = false;
  for (const inner of schema.allOf) {
    for (const error of Visit4(inner, references, path2, value)) {
      hasError = true;
      yield error;
    }
  }
  if (hasError) {
    return yield Create(ValueErrorType.Intersect, schema, path2, value);
  }
  if (schema.unevaluatedProperties === false) {
    const keyCheck = new RegExp(KeyOfPattern(schema));
    for (const valueKey of Object.getOwnPropertyNames(value)) {
      if (!keyCheck.test(valueKey)) {
        yield Create(ValueErrorType.IntersectUnevaluatedProperties, schema, `${path2}/${valueKey}`, value);
      }
    }
  }
  if (typeof schema.unevaluatedProperties === "object") {
    const keyCheck = new RegExp(KeyOfPattern(schema));
    for (const valueKey of Object.getOwnPropertyNames(value)) {
      if (!keyCheck.test(valueKey)) {
        const next = Visit4(schema.unevaluatedProperties, references, `${path2}/${valueKey}`, value[valueKey]).next();
        if (!next.done)
          yield next.value;
      }
    }
  }
}
function* FromIterator2(schema, references, path2, value) {
  if (!IsIterator(value))
    yield Create(ValueErrorType.Iterator, schema, path2, value);
}
function* FromLiteral2(schema, references, path2, value) {
  if (!(value === schema.const))
    yield Create(ValueErrorType.Literal, schema, path2, value);
}
function* FromNever2(schema, references, path2, value) {
  yield Create(ValueErrorType.Never, schema, path2, value);
}
function* FromNot2(schema, references, path2, value) {
  if (Visit4(schema.not, references, path2, value).next().done === true)
    yield Create(ValueErrorType.Not, schema, path2, value);
}
function* FromNull2(schema, references, path2, value) {
  if (!IsNull(value))
    yield Create(ValueErrorType.Null, schema, path2, value);
}
function* FromNumber2(schema, references, path2, value) {
  if (!TypeSystemPolicy.IsNumberLike(value))
    return yield Create(ValueErrorType.Number, schema, path2, value);
  if (IsDefined2(schema.exclusiveMaximum) && !(value < schema.exclusiveMaximum)) {
    yield Create(ValueErrorType.NumberExclusiveMaximum, schema, path2, value);
  }
  if (IsDefined2(schema.exclusiveMinimum) && !(value > schema.exclusiveMinimum)) {
    yield Create(ValueErrorType.NumberExclusiveMinimum, schema, path2, value);
  }
  if (IsDefined2(schema.maximum) && !(value <= schema.maximum)) {
    yield Create(ValueErrorType.NumberMaximum, schema, path2, value);
  }
  if (IsDefined2(schema.minimum) && !(value >= schema.minimum)) {
    yield Create(ValueErrorType.NumberMinimum, schema, path2, value);
  }
  if (IsDefined2(schema.multipleOf) && !(value % schema.multipleOf === 0)) {
    yield Create(ValueErrorType.NumberMultipleOf, schema, path2, value);
  }
}
function* FromObject2(schema, references, path2, value) {
  if (!TypeSystemPolicy.IsObjectLike(value))
    return yield Create(ValueErrorType.Object, schema, path2, value);
  if (IsDefined2(schema.minProperties) && !(Object.getOwnPropertyNames(value).length >= schema.minProperties)) {
    yield Create(ValueErrorType.ObjectMinProperties, schema, path2, value);
  }
  if (IsDefined2(schema.maxProperties) && !(Object.getOwnPropertyNames(value).length <= schema.maxProperties)) {
    yield Create(ValueErrorType.ObjectMaxProperties, schema, path2, value);
  }
  const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
  const knownKeys = Object.getOwnPropertyNames(schema.properties);
  const unknownKeys = Object.getOwnPropertyNames(value);
  for (const requiredKey of requiredKeys) {
    if (unknownKeys.includes(requiredKey))
      continue;
    yield Create(ValueErrorType.ObjectRequiredProperty, schema.properties[requiredKey], `${path2}/${EscapeKey(requiredKey)}`, void 0);
  }
  if (schema.additionalProperties === false) {
    for (const valueKey of unknownKeys) {
      if (!knownKeys.includes(valueKey)) {
        yield Create(ValueErrorType.ObjectAdditionalProperties, schema, `${path2}/${EscapeKey(valueKey)}`, value[valueKey]);
      }
    }
  }
  if (typeof schema.additionalProperties === "object") {
    for (const valueKey of unknownKeys) {
      if (knownKeys.includes(valueKey))
        continue;
      yield* Visit4(schema.additionalProperties, references, `${path2}/${EscapeKey(valueKey)}`, value[valueKey]);
    }
  }
  for (const knownKey of knownKeys) {
    const property = schema.properties[knownKey];
    if (schema.required && schema.required.includes(knownKey)) {
      yield* Visit4(property, references, `${path2}/${EscapeKey(knownKey)}`, value[knownKey]);
      if (ExtendsUndefinedCheck(schema) && !(knownKey in value)) {
        yield Create(ValueErrorType.ObjectRequiredProperty, property, `${path2}/${EscapeKey(knownKey)}`, void 0);
      }
    } else {
      if (TypeSystemPolicy.IsExactOptionalProperty(value, knownKey)) {
        yield* Visit4(property, references, `${path2}/${EscapeKey(knownKey)}`, value[knownKey]);
      }
    }
  }
}
function* FromPromise2(schema, references, path2, value) {
  if (!IsPromise(value))
    yield Create(ValueErrorType.Promise, schema, path2, value);
}
function* FromRecord2(schema, references, path2, value) {
  if (!TypeSystemPolicy.IsRecordLike(value))
    return yield Create(ValueErrorType.Object, schema, path2, value);
  if (IsDefined2(schema.minProperties) && !(Object.getOwnPropertyNames(value).length >= schema.minProperties)) {
    yield Create(ValueErrorType.ObjectMinProperties, schema, path2, value);
  }
  if (IsDefined2(schema.maxProperties) && !(Object.getOwnPropertyNames(value).length <= schema.maxProperties)) {
    yield Create(ValueErrorType.ObjectMaxProperties, schema, path2, value);
  }
  const [patternKey, patternSchema] = Object.entries(schema.patternProperties)[0];
  const regex = new RegExp(patternKey);
  for (const [propertyKey, propertyValue] of Object.entries(value)) {
    if (regex.test(propertyKey))
      yield* Visit4(patternSchema, references, `${path2}/${EscapeKey(propertyKey)}`, propertyValue);
  }
  if (typeof schema.additionalProperties === "object") {
    for (const [propertyKey, propertyValue] of Object.entries(value)) {
      if (!regex.test(propertyKey))
        yield* Visit4(schema.additionalProperties, references, `${path2}/${EscapeKey(propertyKey)}`, propertyValue);
    }
  }
  if (schema.additionalProperties === false) {
    for (const [propertyKey, propertyValue] of Object.entries(value)) {
      if (regex.test(propertyKey))
        continue;
      return yield Create(ValueErrorType.ObjectAdditionalProperties, schema, `${path2}/${EscapeKey(propertyKey)}`, propertyValue);
    }
  }
}
function* FromRef2(schema, references, path2, value) {
  yield* Visit4(Deref(schema, references), references, path2, value);
}
function* FromRegExp2(schema, references, path2, value) {
  if (!IsString(value))
    return yield Create(ValueErrorType.String, schema, path2, value);
  if (IsDefined2(schema.minLength) && !(value.length >= schema.minLength)) {
    yield Create(ValueErrorType.StringMinLength, schema, path2, value);
  }
  if (IsDefined2(schema.maxLength) && !(value.length <= schema.maxLength)) {
    yield Create(ValueErrorType.StringMaxLength, schema, path2, value);
  }
  const regex = new RegExp(schema.source, schema.flags);
  if (!regex.test(value)) {
    return yield Create(ValueErrorType.RegExp, schema, path2, value);
  }
}
function* FromString2(schema, references, path2, value) {
  if (!IsString(value))
    return yield Create(ValueErrorType.String, schema, path2, value);
  if (IsDefined2(schema.minLength) && !(value.length >= schema.minLength)) {
    yield Create(ValueErrorType.StringMinLength, schema, path2, value);
  }
  if (IsDefined2(schema.maxLength) && !(value.length <= schema.maxLength)) {
    yield Create(ValueErrorType.StringMaxLength, schema, path2, value);
  }
  if (IsString(schema.pattern)) {
    const regex = new RegExp(schema.pattern);
    if (!regex.test(value)) {
      yield Create(ValueErrorType.StringPattern, schema, path2, value);
    }
  }
  if (IsString(schema.format)) {
    if (!format_exports.Has(schema.format)) {
      yield Create(ValueErrorType.StringFormatUnknown, schema, path2, value);
    } else {
      const format = format_exports.Get(schema.format);
      if (!format(value)) {
        yield Create(ValueErrorType.StringFormat, schema, path2, value);
      }
    }
  }
}
function* FromSymbol2(schema, references, path2, value) {
  if (!IsSymbol(value))
    yield Create(ValueErrorType.Symbol, schema, path2, value);
}
function* FromTemplateLiteral2(schema, references, path2, value) {
  if (!IsString(value))
    return yield Create(ValueErrorType.String, schema, path2, value);
  const regex = new RegExp(schema.pattern);
  if (!regex.test(value)) {
    yield Create(ValueErrorType.StringPattern, schema, path2, value);
  }
}
function* FromThis2(schema, references, path2, value) {
  yield* Visit4(Deref(schema, references), references, path2, value);
}
function* FromTuple4(schema, references, path2, value) {
  if (!IsArray(value))
    return yield Create(ValueErrorType.Tuple, schema, path2, value);
  if (schema.items === void 0 && !(value.length === 0)) {
    return yield Create(ValueErrorType.TupleLength, schema, path2, value);
  }
  if (!(value.length === schema.maxItems)) {
    return yield Create(ValueErrorType.TupleLength, schema, path2, value);
  }
  if (!schema.items) {
    return;
  }
  for (let i = 0; i < schema.items.length; i++) {
    yield* Visit4(schema.items[i], references, `${path2}/${i}`, value[i]);
  }
}
function* FromUndefined2(schema, references, path2, value) {
  if (!IsUndefined(value))
    yield Create(ValueErrorType.Undefined, schema, path2, value);
}
function* FromUnion4(schema, references, path2, value) {
  if (Check(schema, references, value))
    return;
  const errors = schema.anyOf.map((variant) => new ValueErrorIterator(Visit4(variant, references, path2, value)));
  yield Create(ValueErrorType.Union, schema, path2, value, errors);
}
function* FromUint8Array2(schema, references, path2, value) {
  if (!IsUint8Array(value))
    return yield Create(ValueErrorType.Uint8Array, schema, path2, value);
  if (IsDefined2(schema.maxByteLength) && !(value.length <= schema.maxByteLength)) {
    yield Create(ValueErrorType.Uint8ArrayMaxByteLength, schema, path2, value);
  }
  if (IsDefined2(schema.minByteLength) && !(value.length >= schema.minByteLength)) {
    yield Create(ValueErrorType.Uint8ArrayMinByteLength, schema, path2, value);
  }
}
function* FromUnknown2(schema, references, path2, value) {
}
function* FromVoid2(schema, references, path2, value) {
  if (!TypeSystemPolicy.IsVoidLike(value))
    yield Create(ValueErrorType.Void, schema, path2, value);
}
function* FromKind2(schema, references, path2, value) {
  const check = type_exports.Get(schema[Kind]);
  if (!check(schema, value))
    yield Create(ValueErrorType.Kind, schema, path2, value);
}
function* Visit4(schema, references, path2, value) {
  const references_ = IsDefined2(schema.$id) ? [...references, schema] : references;
  const schema_ = schema;
  switch (schema_[Kind]) {
    case "Any":
      return yield* FromAny2(schema_, references_, path2, value);
    case "Argument":
      return yield* FromArgument2(schema_, references_, path2, value);
    case "Array":
      return yield* FromArray4(schema_, references_, path2, value);
    case "AsyncIterator":
      return yield* FromAsyncIterator2(schema_, references_, path2, value);
    case "BigInt":
      return yield* FromBigInt2(schema_, references_, path2, value);
    case "Boolean":
      return yield* FromBoolean2(schema_, references_, path2, value);
    case "Constructor":
      return yield* FromConstructor2(schema_, references_, path2, value);
    case "Date":
      return yield* FromDate2(schema_, references_, path2, value);
    case "Function":
      return yield* FromFunction2(schema_, references_, path2, value);
    case "Import":
      return yield* FromImport2(schema_, references_, path2, value);
    case "Integer":
      return yield* FromInteger2(schema_, references_, path2, value);
    case "Intersect":
      return yield* FromIntersect4(schema_, references_, path2, value);
    case "Iterator":
      return yield* FromIterator2(schema_, references_, path2, value);
    case "Literal":
      return yield* FromLiteral2(schema_, references_, path2, value);
    case "Never":
      return yield* FromNever2(schema_, references_, path2, value);
    case "Not":
      return yield* FromNot2(schema_, references_, path2, value);
    case "Null":
      return yield* FromNull2(schema_, references_, path2, value);
    case "Number":
      return yield* FromNumber2(schema_, references_, path2, value);
    case "Object":
      return yield* FromObject2(schema_, references_, path2, value);
    case "Promise":
      return yield* FromPromise2(schema_, references_, path2, value);
    case "Record":
      return yield* FromRecord2(schema_, references_, path2, value);
    case "Ref":
      return yield* FromRef2(schema_, references_, path2, value);
    case "RegExp":
      return yield* FromRegExp2(schema_, references_, path2, value);
    case "String":
      return yield* FromString2(schema_, references_, path2, value);
    case "Symbol":
      return yield* FromSymbol2(schema_, references_, path2, value);
    case "TemplateLiteral":
      return yield* FromTemplateLiteral2(schema_, references_, path2, value);
    case "This":
      return yield* FromThis2(schema_, references_, path2, value);
    case "Tuple":
      return yield* FromTuple4(schema_, references_, path2, value);
    case "Undefined":
      return yield* FromUndefined2(schema_, references_, path2, value);
    case "Union":
      return yield* FromUnion4(schema_, references_, path2, value);
    case "Uint8Array":
      return yield* FromUint8Array2(schema_, references_, path2, value);
    case "Unknown":
      return yield* FromUnknown2(schema_, references_, path2, value);
    case "Void":
      return yield* FromVoid2(schema_, references_, path2, value);
    default:
      if (!type_exports.Has(schema_[Kind]))
        throw new ValueErrorsUnknownTypeError(schema);
      return yield* FromKind2(schema_, references_, path2, value);
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
  constructor(schema, path2, value, error) {
    super(error instanceof Error ? error.message : "Unknown error");
    this.schema = schema;
    this.path = path2;
    this.value = value;
    this.error = error;
  }
};
function Default(schema, path2, value) {
  try {
    return IsTransform(schema) ? schema[TransformKind].Decode(value) : value;
  } catch (error) {
    throw new TransformDecodeError(schema, path2, value, error);
  }
}
function FromArray5(schema, references, path2, value) {
  return IsArray(value) ? Default(schema, path2, value.map((value2, index) => Visit5(schema.items, references, `${path2}/${index}`, value2))) : Default(schema, path2, value);
}
function FromIntersect5(schema, references, path2, value) {
  if (!IsObject(value) || IsValueType(value))
    return Default(schema, path2, value);
  const knownEntries = KeyOfPropertyEntries(schema);
  const knownKeys = knownEntries.map((entry) => entry[0]);
  const knownProperties = { ...value };
  for (const [knownKey, knownSchema] of knownEntries)
    if (knownKey in knownProperties) {
      knownProperties[knownKey] = Visit5(knownSchema, references, `${path2}/${knownKey}`, knownProperties[knownKey]);
    }
  if (!IsTransform(schema.unevaluatedProperties)) {
    return Default(schema, path2, knownProperties);
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const unevaluatedProperties = schema.unevaluatedProperties;
  const unknownProperties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.includes(key)) {
      unknownProperties[key] = Default(unevaluatedProperties, `${path2}/${key}`, unknownProperties[key]);
    }
  return Default(schema, path2, unknownProperties);
}
function FromImport3(schema, references, path2, value) {
  const additional = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  const result = Visit5(target, [...references, ...additional], path2, value);
  return Default(schema, path2, result);
}
function FromNot3(schema, references, path2, value) {
  return Default(schema, path2, Visit5(schema.not, references, path2, value));
}
function FromObject3(schema, references, path2, value) {
  if (!IsObject(value))
    return Default(schema, path2, value);
  const knownKeys = KeyOfPropertyKeys(schema);
  const knownProperties = { ...value };
  for (const key of knownKeys) {
    if (!HasPropertyKey(knownProperties, key))
      continue;
    if (IsUndefined(knownProperties[key]) && (!IsUndefined3(schema.properties[key]) || TypeSystemPolicy.IsExactOptionalProperty(knownProperties, key)))
      continue;
    knownProperties[key] = Visit5(schema.properties[key], references, `${path2}/${key}`, knownProperties[key]);
  }
  if (!IsSchema(schema.additionalProperties)) {
    return Default(schema, path2, knownProperties);
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const additionalProperties = schema.additionalProperties;
  const unknownProperties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.includes(key)) {
      unknownProperties[key] = Default(additionalProperties, `${path2}/${key}`, unknownProperties[key]);
    }
  return Default(schema, path2, unknownProperties);
}
function FromRecord3(schema, references, path2, value) {
  if (!IsObject(value))
    return Default(schema, path2, value);
  const pattern = Object.getOwnPropertyNames(schema.patternProperties)[0];
  const knownKeys = new RegExp(pattern);
  const knownProperties = { ...value };
  for (const key of Object.getOwnPropertyNames(value))
    if (knownKeys.test(key)) {
      knownProperties[key] = Visit5(schema.patternProperties[pattern], references, `${path2}/${key}`, knownProperties[key]);
    }
  if (!IsSchema(schema.additionalProperties)) {
    return Default(schema, path2, knownProperties);
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const additionalProperties = schema.additionalProperties;
  const unknownProperties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.test(key)) {
      unknownProperties[key] = Default(additionalProperties, `${path2}/${key}`, unknownProperties[key]);
    }
  return Default(schema, path2, unknownProperties);
}
function FromRef3(schema, references, path2, value) {
  const target = Deref(schema, references);
  return Default(schema, path2, Visit5(target, references, path2, value));
}
function FromThis3(schema, references, path2, value) {
  const target = Deref(schema, references);
  return Default(schema, path2, Visit5(target, references, path2, value));
}
function FromTuple5(schema, references, path2, value) {
  return IsArray(value) && IsArray(schema.items) ? Default(schema, path2, schema.items.map((schema2, index) => Visit5(schema2, references, `${path2}/${index}`, value[index]))) : Default(schema, path2, value);
}
function FromUnion5(schema, references, path2, value) {
  for (const subschema of schema.anyOf) {
    if (!Check(subschema, references, value))
      continue;
    const decoded = Visit5(subschema, references, path2, value);
    return Default(schema, path2, decoded);
  }
  return Default(schema, path2, value);
}
function Visit5(schema, references, path2, value) {
  const references_ = Pushref(schema, references);
  const schema_ = schema;
  switch (schema[Kind]) {
    case "Array":
      return FromArray5(schema_, references_, path2, value);
    case "Import":
      return FromImport3(schema_, references_, path2, value);
    case "Intersect":
      return FromIntersect5(schema_, references_, path2, value);
    case "Not":
      return FromNot3(schema_, references_, path2, value);
    case "Object":
      return FromObject3(schema_, references_, path2, value);
    case "Record":
      return FromRecord3(schema_, references_, path2, value);
    case "Ref":
      return FromRef3(schema_, references_, path2, value);
    case "Symbol":
      return Default(schema_, path2, value);
    case "This":
      return FromThis3(schema_, references_, path2, value);
    case "Tuple":
      return FromTuple5(schema_, references_, path2, value);
    case "Union":
      return FromUnion5(schema_, references_, path2, value);
    default:
      return Default(schema_, path2, value);
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
  constructor(schema, path2, value, error) {
    super(`${error instanceof Error ? error.message : "Unknown error"}`);
    this.schema = schema;
    this.path = path2;
    this.value = value;
    this.error = error;
  }
};
function Default2(schema, path2, value) {
  try {
    return IsTransform(schema) ? schema[TransformKind].Encode(value) : value;
  } catch (error) {
    throw new TransformEncodeError(schema, path2, value, error);
  }
}
function FromArray6(schema, references, path2, value) {
  const defaulted = Default2(schema, path2, value);
  return IsArray(defaulted) ? defaulted.map((value2, index) => Visit6(schema.items, references, `${path2}/${index}`, value2)) : defaulted;
}
function FromImport4(schema, references, path2, value) {
  const additional = globalThis.Object.values(schema.$defs);
  const target = schema.$defs[schema.$ref];
  const result = Default2(schema, path2, value);
  return Visit6(target, [...references, ...additional], path2, result);
}
function FromIntersect6(schema, references, path2, value) {
  const defaulted = Default2(schema, path2, value);
  if (!IsObject(value) || IsValueType(value))
    return defaulted;
  const knownEntries = KeyOfPropertyEntries(schema);
  const knownKeys = knownEntries.map((entry) => entry[0]);
  const knownProperties = { ...defaulted };
  for (const [knownKey, knownSchema] of knownEntries)
    if (knownKey in knownProperties) {
      knownProperties[knownKey] = Visit6(knownSchema, references, `${path2}/${knownKey}`, knownProperties[knownKey]);
    }
  if (!IsTransform(schema.unevaluatedProperties)) {
    return knownProperties;
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const unevaluatedProperties = schema.unevaluatedProperties;
  const properties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.includes(key)) {
      properties[key] = Default2(unevaluatedProperties, `${path2}/${key}`, properties[key]);
    }
  return properties;
}
function FromNot4(schema, references, path2, value) {
  return Default2(schema.not, path2, Default2(schema, path2, value));
}
function FromObject4(schema, references, path2, value) {
  const defaulted = Default2(schema, path2, value);
  if (!IsObject(defaulted))
    return defaulted;
  const knownKeys = KeyOfPropertyKeys(schema);
  const knownProperties = { ...defaulted };
  for (const key of knownKeys) {
    if (!HasPropertyKey(knownProperties, key))
      continue;
    if (IsUndefined(knownProperties[key]) && (!IsUndefined3(schema.properties[key]) || TypeSystemPolicy.IsExactOptionalProperty(knownProperties, key)))
      continue;
    knownProperties[key] = Visit6(schema.properties[key], references, `${path2}/${key}`, knownProperties[key]);
  }
  if (!IsSchema(schema.additionalProperties)) {
    return knownProperties;
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const additionalProperties = schema.additionalProperties;
  const properties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.includes(key)) {
      properties[key] = Default2(additionalProperties, `${path2}/${key}`, properties[key]);
    }
  return properties;
}
function FromRecord4(schema, references, path2, value) {
  const defaulted = Default2(schema, path2, value);
  if (!IsObject(value))
    return defaulted;
  const pattern = Object.getOwnPropertyNames(schema.patternProperties)[0];
  const knownKeys = new RegExp(pattern);
  const knownProperties = { ...defaulted };
  for (const key of Object.getOwnPropertyNames(value))
    if (knownKeys.test(key)) {
      knownProperties[key] = Visit6(schema.patternProperties[pattern], references, `${path2}/${key}`, knownProperties[key]);
    }
  if (!IsSchema(schema.additionalProperties)) {
    return knownProperties;
  }
  const unknownKeys = Object.getOwnPropertyNames(knownProperties);
  const additionalProperties = schema.additionalProperties;
  const properties = { ...knownProperties };
  for (const key of unknownKeys)
    if (!knownKeys.test(key)) {
      properties[key] = Default2(additionalProperties, `${path2}/${key}`, properties[key]);
    }
  return properties;
}
function FromRef4(schema, references, path2, value) {
  const target = Deref(schema, references);
  const resolved = Visit6(target, references, path2, value);
  return Default2(schema, path2, resolved);
}
function FromThis4(schema, references, path2, value) {
  const target = Deref(schema, references);
  const resolved = Visit6(target, references, path2, value);
  return Default2(schema, path2, resolved);
}
function FromTuple6(schema, references, path2, value) {
  const value1 = Default2(schema, path2, value);
  return IsArray(schema.items) ? schema.items.map((schema2, index) => Visit6(schema2, references, `${path2}/${index}`, value1[index])) : [];
}
function FromUnion6(schema, references, path2, value) {
  for (const subschema of schema.anyOf) {
    if (!Check(subschema, references, value))
      continue;
    const value1 = Visit6(subschema, references, path2, value);
    return Default2(schema, path2, value1);
  }
  for (const subschema of schema.anyOf) {
    const value1 = Visit6(subschema, references, path2, value);
    if (!Check(schema, references, value1))
      continue;
    return Default2(schema, path2, value1);
  }
  return Default2(schema, path2, value);
}
function Visit6(schema, references, path2, value) {
  const references_ = Pushref(schema, references);
  const schema_ = schema;
  switch (schema[Kind]) {
    case "Array":
      return FromArray6(schema_, references_, path2, value);
    case "Import":
      return FromImport4(schema_, references_, path2, value);
    case "Intersect":
      return FromIntersect6(schema_, references_, path2, value);
    case "Not":
      return FromNot4(schema_, references_, path2, value);
    case "Object":
      return FromObject4(schema_, references_, path2, value);
    case "Record":
      return FromRecord4(schema_, references_, path2, value);
    case "Ref":
      return FromRef4(schema_, references_, path2, value);
    case "This":
      return FromThis4(schema_, references_, path2, value);
    case "Tuple":
      return FromTuple6(schema_, references_, path2, value);
    case "Union":
      return FromUnion6(schema_, references_, path2, value);
    default:
      return Default2(schema_, path2, value);
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
  constructor(value, path2, update) {
    super("Cannot set root value");
    this.value = value;
    this.path = path2;
    this.update = update;
  }
};
var ValuePointerRootDeleteError = class extends TypeBoxError {
  constructor(value, path2) {
    super("Cannot delete root value");
    this.value = value;
    this.path = path2;
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
function CreateUpdate(path2, value) {
  return { type: "update", path: path2, value };
}
function CreateInsert(path2, value) {
  return { type: "insert", path: path2, value };
}
function CreateDelete(path2) {
  return { type: "delete", path: path2 };
}
function AssertDiffable(value) {
  if (globalThis.Object.getOwnPropertySymbols(value).length > 0)
    throw new ValueDiffError(value, "Cannot diff objects with symbols");
}
function* ObjectType4(path2, current, next) {
  AssertDiffable(current);
  AssertDiffable(next);
  if (!IsStandardObject(next))
    return yield CreateUpdate(path2, next);
  const currentKeys = globalThis.Object.getOwnPropertyNames(current);
  const nextKeys = globalThis.Object.getOwnPropertyNames(next);
  for (const key of nextKeys) {
    if (HasPropertyKey(current, key))
      continue;
    yield CreateInsert(`${path2}/${key}`, next[key]);
  }
  for (const key of currentKeys) {
    if (!HasPropertyKey(next, key))
      continue;
    if (Equal(current, next))
      continue;
    yield* Visit13(`${path2}/${key}`, current[key], next[key]);
  }
  for (const key of currentKeys) {
    if (HasPropertyKey(next, key))
      continue;
    yield CreateDelete(`${path2}/${key}`);
  }
}
function* ArrayType4(path2, current, next) {
  if (!IsArray(next))
    return yield CreateUpdate(path2, next);
  for (let i = 0; i < Math.min(current.length, next.length); i++) {
    yield* Visit13(`${path2}/${i}`, current[i], next[i]);
  }
  for (let i = 0; i < next.length; i++) {
    if (i < current.length)
      continue;
    yield CreateInsert(`${path2}/${i}`, next[i]);
  }
  for (let i = current.length - 1; i >= 0; i--) {
    if (i < next.length)
      continue;
    yield CreateDelete(`${path2}/${i}`);
  }
}
function* TypedArrayType2(path2, current, next) {
  if (!IsTypedArray(next) || current.length !== next.length || globalThis.Object.getPrototypeOf(current).constructor.name !== globalThis.Object.getPrototypeOf(next).constructor.name)
    return yield CreateUpdate(path2, next);
  for (let i = 0; i < Math.min(current.length, next.length); i++) {
    yield* Visit13(`${path2}/${i}`, current[i], next[i]);
  }
}
function* ValueType2(path2, current, next) {
  if (current === next)
    return;
  yield CreateUpdate(path2, next);
}
function* Visit13(path2, current, next) {
  if (IsStandardObject(current))
    return yield* ObjectType4(path2, current, next);
  if (IsArray(current))
    return yield* ArrayType4(path2, current, next);
  if (IsTypedArray(current))
    return yield* TypedArrayType2(path2, current, next);
  if (IsValueType(current))
    return yield* ValueType2(path2, current, next);
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
function ObjectType5(root, path2, current, next) {
  if (!IsStandardObject2(current)) {
    pointer_exports.Set(root, path2, Clone2(next));
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
      Visit14(root, `${path2}/${nextKey}`, current[nextKey], next[nextKey]);
    }
  }
}
function ArrayType5(root, path2, current, next) {
  if (!IsArray(current)) {
    pointer_exports.Set(root, path2, Clone2(next));
  } else {
    for (let index = 0; index < next.length; index++) {
      Visit14(root, `${path2}/${index}`, current[index], next[index]);
    }
    current.splice(next.length);
  }
}
function TypedArrayType3(root, path2, current, next) {
  if (IsTypedArray(current) && current.length === next.length) {
    for (let i = 0; i < current.length; i++) {
      current[i] = next[i];
    }
  } else {
    pointer_exports.Set(root, path2, Clone2(next));
  }
}
function ValueType3(root, path2, current, next) {
  if (current === next)
    return;
  pointer_exports.Set(root, path2, next);
}
function Visit14(root, path2, current, next) {
  if (IsArray(next))
    return ArrayType5(root, path2, current, next);
  if (IsTypedArray(next))
    return TypedArrayType3(root, path2, current, next);
  if (IsStandardObject2(next))
    return ObjectType5(root, path2, current, next);
  if (IsValueType(next))
    return ValueType3(root, path2, current, next);
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
function Boolean(options) {
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
  return trim === "boolean" ? yield Boolean() : trim === "number" ? yield Number2() : trim === "bigint" ? yield BigInt2() : trim === "string" ? yield String3() : yield (() => {
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
  Boolean: () => Boolean,
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
  Type.Literal("ToolResult")
  // Result of an Orchestrator tool call
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
  Type.Literal("audit"),
  // Can use audit.* tools
  Type.String()
  // Extensible: custom capabilities allowed
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
  /** Declared capabilities — Orchestrator enforces these as ACL */
  capabilities: Type.Array(AgentCapability, {
    description: "List of capabilities this agent is authorized to use",
    minItems: 0
  }),
  /**
   * Allowed MCP tool namespaces (e.g. ["graph", "audit", "consulting"])
   * Empty = no MCP tool access. ["*"] = all tools (superuser — use with caution).
   */
  allowed_tool_namespaces: Type.Array(Type.String(), {
    description: 'MCP tool namespaces this agent may invoke (e.g. ["graph", "audit"])'
  }),
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

// src/validation.ts
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
var MAX_RETRIES = 2;
var RETRY_DELAY_MS = 1e3;
async function callMcpTool(opts) {
  const log = childLogger(opts.traceId ?? opts.callId);
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? config.mcpTimeoutMs;
  const url = `${config.backendUrl}/api/mcp/route`;
  const body = JSON.stringify({ tool: opts.toolName, payload: opts.args });
  log.debug({ tool: opts.toolName, url }, "MCP call start");
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      log.debug({ attempt, tool: opts.toolName }, "Retrying after transient error");
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
    const result = await callMcpToolOnce(opts, url, body, timeoutMs, log, t0);
    if (result.status !== "error" || !result.error_message?.includes("503")) {
      return result;
    }
    lastError = result.error_message;
  }
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

// src/routes/chat.ts
import { Router as Router3 } from "express";
var chatRouter = Router3();
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
  const msg = { ...result.data, timestamp: (/* @__PURE__ */ new Date()).toISOString() };
  broadcastMessage(msg);
  notifyChatMessage(msg.from, msg.to, msg.message);
  logger.info({ from: msg.from, to: msg.to, type: msg.type }, "Chat message broadcast");
  res.json({ success: true, data: { timestamp: msg.timestamp } });
});
chatRouter.get("/ws-stats", (_req, res) => {
  res.json({ success: true, data: getConnectionStats() });
});

// src/routes/chains.ts
import { Router as Router4 } from "express";

// src/chain-engine.ts
import { v4 as uuid } from "uuid";

// src/cognitive-proxy.ts
var COGNITIVE_ROUTES = {
  reason: "/reason",
  analyze: "/cognitive/analyze",
  plan: "/cognitive/plan",
  learn: "/cognitive/learn",
  fold: "/cognitive/fold",
  enrich: "/cognitive/enrich"
};
function isRlmAvailable() {
  return config.rlmUrl.length > 0;
}
async function callCognitive(action, params, timeoutMs) {
  if (!config.rlmUrl) {
    throw new Error("RLM Engine not configured (set RLM_URL)");
  }
  const path2 = COGNITIVE_ROUTES[action];
  if (!path2) {
    throw new Error(`Unknown cognitive action: ${action}. Valid: ${Object.keys(COGNITIVE_ROUTES).join(", ")}`);
  }
  const url = `${config.rlmUrl}${path2}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 6e4);
  try {
    logger.debug({ action, url, agent: params.agent_id }, "Cognitive proxy call");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.backendApiKey ? { "Authorization": `Bearer ${config.backendApiKey}` } : {}
      },
      body: JSON.stringify({
        prompt: params.prompt,
        context: params.context,
        agent_id: params.agent_id,
        depth: params.depth ?? 0,
        mode: params.mode ?? "standard"
      }),
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
      throw new Error(`RLM ${action} timed out after ${timeoutMs ?? 6e4}ms`);
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

// src/chain-engine.ts
var executions = /* @__PURE__ */ new Map();
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
  const stepId = step.id ?? uuid().slice(0, 8);
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
      const result = await callMcpTool({
        toolName: step.tool_name,
        args,
        callId: uuid(),
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
async function runDebate(steps, judgeAgent) {
  const debateResults = await runParallel(steps);
  if (!judgeAgent) return debateResults;
  const positions = debateResults.map((r) => ({
    agent: r.agent_id,
    position: r.output
  }));
  const judgeResult = await executeStep({
    agent_id: judgeAgent,
    cognitive_action: "analyze",
    prompt: `You are the judge. Evaluate these positions and synthesize the best answer:

${JSON.stringify(positions, null, 2)}`
  }, positions);
  return [...debateResults, judgeResult];
}
async function executeChain(def) {
  const executionId = uuid();
  const chainId = def.chain_id ?? uuid().slice(0, 12);
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
    let results;
    switch (def.mode) {
      case "sequential":
        results = await runSequential(def.steps);
        break;
      case "parallel":
        results = await runParallel(def.steps);
        break;
      case "loop":
        results = await runLoop(def.steps, def.max_iterations ?? 5, def.exit_condition);
        break;
      case "debate":
        results = await runDebate(def.steps, def.judge_agent);
        break;
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

// src/routes/chains.ts
var chainsRouter = Router4();
chainsRouter.post("/execute", async (req, res) => {
  const body = req.body;
  if (!body.name || !body.mode || !Array.isArray(body.steps) || body.steps.length === 0) {
    res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Required: name, mode (sequential|parallel|loop|debate), steps[] (non-empty)",
        status_code: 400
      }
    });
    return;
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
  if (!body.prompt && !body.message) {
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Required: prompt or message", status_code: 400 }
    });
    return;
  }
  try {
    const result = await callCognitive(action, {
      prompt: body.prompt ?? body.message,
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
import { Router as Router6 } from "express";

// src/cron-scheduler.ts
import cron from "node-cron";
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
    const result = await executeChain(job.chain);
    job.last_run = (/* @__PURE__ */ new Date()).toISOString();
    job.last_status = result.status;
    job.run_count++;
    persistCronJobs();
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
}

// src/routes/cron.ts
var cronRouter = Router6();
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
import { Router as Router7 } from "express";
var dashboardRouter = Router7();
dashboardRouter.get("/data", async (_req, res) => {
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
  const cronJobs = listCronJobs();
  const rlmAvailable = isRlmAvailable();
  let rlmHealth = null;
  if (rlmAvailable) {
    try {
      rlmHealth = await getRlmHealth();
    } catch {
    }
  }
  res.json({
    agents,
    wsStats,
    chains,
    cronJobs,
    rlmAvailable,
    rlmHealth,
    config: {
      backendUrl: config.backendUrl,
      orchestratorId: config.orchestratorId,
      nodeEnv: config.nodeEnv
    },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});

// src/routes/openclaw.ts
import { Router as Router8 } from "express";
var openclawRouter = Router8();
openclawRouter.all("/proxy/*", async (req, res) => {
  const openclawUrl = config.openclawUrl;
  if (!openclawUrl) {
    res.status(503).json({ success: false, error: "OPENCLAW_URL not configured" });
    return;
  }
  const targetPath = req.params[0] ?? "";
  const token = config.openclawToken;
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const fetchOpts = {
      method: req.method,
      headers
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOpts.body = JSON.stringify(req.body);
    }
    const response = await fetch(`${openclawUrl}/${targetPath}`, fetchOpts);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      res.status(response.status).json(data);
    } else {
      const text = await response.text();
      res.status(response.status).type(contentType).send(text);
    }
  } catch (err) {
    logger.warn({ err: String(err), path: targetPath }, "OpenClaw proxy error");
    res.status(502).json({ success: false, error: "OpenClaw gateway unreachable" });
  }
});

// src/auth.ts
function requireApiKey(req, res, next) {
  if (!config.orchestratorApiKey) {
    next();
    return;
  }
  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const apiKeyHeader = req.headers["x-api-key"] ?? "";
  if (token === config.orchestratorApiKey || apiKeyHeader === config.orchestratorApiKey) {
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
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var app = express();
var server = createServer(app);
app.use(helmet({
  contentSecurityPolicy: false,
  // SPA uses inline styles + scripts
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: [
    "https://consulting-production-b5d8.up.railway.app",
    "https://orchestrator-production-c27e.up.railway.app",
    /^https?:\/\/localhost(:\d+)?$/
  ],
  credentials: true
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, "Request");
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use("/agents", requireApiKey, agentsRouter);
app.use("/tools", requireApiKey, toolsRouter);
app.use("/chat", requireApiKey, chatRouter);
app.use("/chains", requireApiKey, chainsRouter);
app.use("/cognitive", requireApiKey, cognitiveRouter);
app.use("/cron", requireApiKey, cronRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/openclaw", requireApiKey, openclawRouter);
app.get("/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "widgetdc-orchestrator",
    version: "1.0.0",
    uptime_seconds: Math.floor(process.uptime()),
    agents_registered: AgentRegistry.all().length,
    ws_connections: getConnectionStats().total,
    redis_enabled: isRedisEnabled(),
    rlm_available: isRlmAvailable(),
    active_chains: listExecutions().filter((e) => e.status === "running").length,
    cron_jobs: listCronJobs().filter((j) => j.enabled).length,
    slack_enabled: isSlackEnabled(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
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
  await hydrateCronJobs();
  registerDefaultLoops();
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
