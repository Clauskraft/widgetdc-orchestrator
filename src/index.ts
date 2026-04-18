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
import './tracing.js'  // OTel must be first (LIN-589)
import 'dotenv/config'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

// S1+S6: Build-time version injection (esbuild define)
declare const __PKG_VERSION__: string
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createServer } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { logger } from './logger.js'
import { initWebSocket } from './chat-broadcaster.js'
import { initRedis, isRedisEnabled } from './redis.js'
import { agentsRouter } from './routes/agents.js'
import { toolsRouter } from './routes/tools.js'
import { chatRouter } from './routes/chat.js'
import { chainsRouter } from './routes/chains.js'
import { cognitiveRouter } from './routes/cognitive.js'
import { cronRouter } from './routes/cron.js'
import { dashboardRouter } from './routes/dashboard.js'
import { cockpitRouter } from './routes/cockpit.js'
import { openclawRouter, initOpenClaw, isOpenClawHealthy } from './routes/openclaw.js'
import { llmRouter } from './routes/llm.js'
import { auditRouter } from './routes/audit.js'
import { toolOutputRouter } from './routes/tool-output.js'
import { knowledgeRouter } from './routes/knowledge.js'
import { neuralBusRouter } from './routes/neural-bus.js'
import { pheromoneRouter } from './routes/pheromone.js'
import { adoptionRouter } from './routes/adoption.js'
import { artifactRouter } from './routes/artifacts.js'
import { notebookRouter } from './routes/notebooks.js'
import { drillRouter } from './routes/drill.js'
import { monitorRouter } from './routes/monitor.js'
import { assemblyRouter } from './routes/assembly.js'
import { looseEndsRouter } from './routes/loose-ends.js'
import { decisionsRouter } from './routes/decisions.js'
import { s1s4Router } from './routes/s1-s4.js'
import { auditMiddleware } from './audit.js'
import { handleSSE, getSSEClientCount } from './sse.js'
import { AgentRegistry } from './agents/agent-registry.js'
import { getConnectionStats } from './chat-broadcaster.js'
import { requireApiKey } from './auth.js'
import { isSlackEnabled } from './slack.js'
import { isRlmAvailable } from './cognitive-proxy.js'
import { hydrateCronJobs, registerDefaultLoops, listCronJobs, bootKickstartOverdueJobs } from './cron-scheduler.js'
import { listExecutions } from './chain/chain-engine.js'
import { listPlans, type FSMState } from './chain/state-machine.js'
import { runHarvestPipeline, runFullHarvest } from './flywheel/harvest-pipeline.js'
import { openaiCompatRouter } from './routes/openai-compat.js'
import { promptGeneratorRouter } from './routes/prompt-generator.js'
import { openapiRouter } from './openapi.js'
import { mcpGatewayRouter } from './routes/mcp-gateway.js'
import { toolGatewayRouter } from './routes/tool-gateway.js'
import { seedAgents } from './agents/agent-seeds.js'
import { hydrateMessages } from './chat-store.js'
import { failuresRouter } from './routes/failures.js'
import { competitiveRouter } from './routes/competitive.js'
import { foldRouter } from './routes/fold.js'
import { graphHygieneRouter } from './routes/graph-hygiene.js'
import { deliverablesRouter } from './routes/deliverables.js'
import { similarityRouter } from './routes/similarity.js'
import { engagementsRouter } from './routes/engagements.js'
import { processesRouter } from './routes/processes.js'
import { getWriteGateStats } from './write-gate.js'
import { getBackendCircuitState, getRateLimitState } from './mcp-caller.js'
import { intelligenceRouter } from './routes/intelligence.js'
import { governanceRouter } from './routes/governance.js'
import { osintRouter } from './routes/osint.js'
import { evolutionRouter } from './routes/evolution.js'
import { memoryRouter } from './routes/memory.js'
import { abiDocsRouter } from './routes/abi-docs.js'
import { abiHealthRouter } from './routes/abi-health.js'
import { abiVersioningRouter } from './routes/abi-versioning.js'
import { hyperagentRouter } from './routes/hyperagent.js'
import { hyperagentAutoRouter } from './routes/hyperagent-autonomous.js'
import { produceRouter } from './routes/produce.js'
import { inventorRouter } from './routes/inventor.js'
import { anomalyWatcherRouter } from './routes/anomaly-watcher.js'
import { initAnomalyWatcher, getWatcherState } from './swarm/anomaly-watcher.js'
import { peerEvalRouter } from './routes/peer-eval.js'
import { flywheelRouter } from './routes/flywheel.js'
import { benchmarkRouter } from './routes/benchmark.js'
import { loadBenchmarkRuns } from './benchmark-runner.js'
import { obsidianRouter } from './routes/obsidian.js'
import { grafanaProxyRouter } from './routes/grafana-proxy.js'
import { phantomBomRouter } from './routes/phantom-bom.js'
import { linearProxyRouter } from './routes/linear-proxy.js'
import { prometheusMetricsRouter } from './routes/prometheus-metrics.js'
import { initPheromoneLayer, getPheromoneState } from './swarm/pheromone-layer.js'
import { initPeerEval, getPeerEvalState } from './swarm/peer-eval.js'
import { initKnowledgeBus } from './knowledge/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
// v4.0.10: trust Railway edge proxy so req.ip reflects real client (enables correct IPv6 fallback in rate limiter)
app.set('trust proxy', 1)
const server = createServer(app)

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // SPA uses inline styles + scripts
  crossOriginEmbedderPolicy: false,
}))
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, MCP clients, server-to-server)
    // Also allow 'null' origin (file:// and sandboxed iframes — e.g. Inventor dashboard opened locally)
    if (!origin || origin === 'null') return callback(null, true)

    // Always allow known WidgeTDC services
    const trusted = [
      'https://consulting-production-b5d8.up.railway.app',
      'https://orchestrator-production-c27e.up.railway.app',
      'https://open-webui-production-25cb.up.railway.app',
    ]
    if (trusted.includes(origin)) return callback(null, true)

    // Allow localhost (any port)
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true)

    // Allow AI platform domains (ChatGPT, Google AI Studio, Gemini, etc.)
    const aiPlatforms = [
      /\.google\.com$/,        // AI Studio, Gemini
      /\.googleapis\.com$/,    // Google APIs
      /\.openai\.com$/,        // ChatGPT
      /\.chatgpt\.com$/,       // ChatGPT new domain
      /\.anthropic\.com$/,     // Claude
      /\.railway\.app$/,       // Any Railway service
      /\.vercel\.app$/,        // Vercel previews
      /\.netlify\.app$/,       // Netlify previews
    ]
    if (aiPlatforms.some(re => re.test(origin))) return callback(null, true)

    // Unknown origins: reject (API key auth doesn't protect against CORS+credentials abuse)
    callback(null, false)
  },
  credentials: true,
}))
app.use(express.json({ limit: '100kb' }))
app.use(express.urlencoded({ extended: false }))

// AEGIS fix: payload-too-large handler — return 413 instead of crashing to 500
// v4.0.10: log 413/400 events for SIEM/probing detection
app.use((err: Error & { type?: string; status?: number }, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    logger.warn({ ip: req.ip, path: req.path, method: req.method }, 'Payload too large (413)')
    res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 100kb limit', status_code: 413 } })
    return
  }
  if (err.type === 'entity.parse.failed') {
    logger.warn({ ip: req.ip, path: req.path, method: req.method }, 'Invalid JSON body (400)')
    res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', status_code: 400 } })
    return
  }
  next(err)
})

// v4.0.10: shared rate limiter for all expensive/write routes — prevents valid-key DoS / cost runaway
// Keyed per API key (not IP), so same key across IPs shares one budget.
// Falls back to ipKeyGenerator (IPv6-safe /64 normalization) only when no API key present.
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 120 req/min per API key (2/sec avg, burst-friendly)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const auth = req.headers.authorization ?? ''
    const headerKey = req.headers['x-api-key']
    const queryKey = req.query.api_key
    const apiKey =
      (typeof headerKey === 'string' ? headerKey : Array.isArray(headerKey) ? headerKey[0] : '') ||
      (typeof queryKey === 'string' ? queryKey : Array.isArray(queryKey) ? queryKey[0] : '') ||
      auth.replace(/^Bearer\s+/i, '')
    return apiKey || ipKeyGenerator(req.ip ?? '', 64)
  },
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests — max 120/min per API key', status_code: 429 } },
  skip: (req) => req.method === 'GET', // Only limit writes; GETs (lists, health, dashboard) are free
})

// F4: IP deny list — block known scanner ranges (env: IP_DENY_LIST, comma-separated CIDRs or IPs)
const ipDenyRaw = process.env.IP_DENY_LIST ?? ''
const ipDenyList = ipDenyRaw.split(',').map(s => s.trim()).filter(Boolean)

if (ipDenyList.length > 0) {
  app.use((req, res, next) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? ''
    const blocked = ipDenyList.some(entry => {
      if (entry.includes('/')) {
        // CIDR match (supports /24 and /32)
        const [base, bits] = entry.split('/')
        const mask = ~((1 << (32 - parseInt(bits))) - 1) >>> 0
        const toNum = (ip: string) => ip.split('.').reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0
        return (toNum(clientIp) & mask) === (toNum(base) & mask)
      }
      return clientIp === entry
    })
    if (blocked) {
      logger.warn({ ip: clientIp }, 'Blocked request from denied IP')
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  })
  logger.info({ count: ipDenyList.length }, 'IP deny list active')
}

// Request logging
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Request')
  next()
})

// ─── Prometheus metrics — Grafana Cloud scraping (no auth) ───────────────────
// MUST be before static files + SPA catch-all
app.use(prometheusMetricsRouter)

// ─── Static frontend (Command Center SPA) ───────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate') },
}))

// ─── SPA content negotiation (MUST be before API routes) ────────────────────
// Browser navigation (Accept: text/html) gets the SPA; API calls (Accept: json) pass through.
const spaIndexPath = path.join(__dirname, 'public', 'index.html')
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  // Always skip: WebSocket, SSE, health, /api/*, metrics, static assets
  if (req.path.startsWith('/ws') || req.path.startsWith('/sse') ||
      req.path.startsWith('/health') || req.path.startsWith('/api/') ||
      req.path.startsWith('/v1/') ||
      req.path.startsWith('/metrics') || req.path.match(/\.\w+$/)) return next()
  // API-only paths — no SPA pages exist at these paths, always pass to API
  const apiOnlyPaths = ['/agents', '/tools', '/chains', '/chat', '/cognitive', '/cron', '/v1']
  if (apiOnlyPaths.some((p) => req.path.startsWith(p))) return next()
  // Serve SPA only for explicit browser navigation (Accept includes text/html).
  // Node.js fetch/curl send Accept: */* which must NOT get HTML — only real browsers
  // include text/html explicitly. application/json always wins over */*.
  const accept = req.headers.accept || ''
  if (accept.includes('text/html') && !accept.includes('application/json') && req.accepts('html', 'json') === 'html') {
    return res.sendFile(spaIndexPath)
  }
  next()
})

// ─── Audit middleware (logs all mutations) ───────────────────────────────────
app.use(auditMiddleware)

// ─── Routes ──────────────────────────────────────────────────────────────────
// Auth required for mutating endpoints (if ORCHESTRATOR_API_KEY is set)
app.use('/agents', requireApiKey, agentsRouter)
app.use('/tools', requireApiKey, apiRateLimiter, toolsRouter)
app.use('/chat', requireApiKey, chatRouter)
app.use('/api/chat', requireApiKey, chatRouter)  // A2A alias — agents call /api/chat/send
app.use('/chains', requireApiKey, apiRateLimiter, chainsRouter)
app.use('/cognitive', requireApiKey, apiRateLimiter, cognitiveRouter)
app.use('/cron', requireApiKey, cronRouter)

// Dashboard data API + OpenClaw proxy + Audit log + LLM + SSE
app.use('/api/dashboard', dashboardRouter)
app.use('/api/cockpit', requireApiKey, apiRateLimiter, cockpitRouter)
app.use('/api/openclaw', requireApiKey, openclawRouter)
app.use('/api/audit', requireApiKey, auditRouter)
app.use('/api/tool-output', toolOutputRouter)  // Public — MCP tools embed these URLs in results
app.use('/api/knowledge', requireApiKey, knowledgeRouter)
app.use('/api/adoption', requireApiKey, adoptionRouter)
app.use('/api/artifacts', requireApiKey, artifactRouter)
app.use('/api/notebooks', requireApiKey, notebookRouter)
app.use('/api/drill', requireApiKey, drillRouter)
app.use('/api/llm', requireApiKey, apiRateLimiter, llmRouter)
app.use('/api/assembly', requireApiKey, assemblyRouter)
app.use('/api/loose-ends', requireApiKey, looseEndsRouter)
app.use('/api/decisions', requireApiKey, decisionsRouter)
app.use('/monitor', requireApiKey, monitorRouter)
app.use('/api/s1-s4', requireApiKey, s1s4Router)

// Grafana Cloud proxy — stream Prometheus metrics to cc-v4 dashboard
// No rate limiter — Grafana queries are read-only, proxied to Cloud
app.use('/api/grafana', requireApiKey, grafanaProxyRouter)

// Linear proxy — SPA frontend reads/writes Linear issues via orchestrator
app.use('/api/linear', requireApiKey, linearProxyRouter)

// LIN-567: Red Queen Failure Harvester
app.use('/api/failures', requireApiKey, apiRateLimiter, failuresRouter)
// LIN-566: Competitive Phagocytosis MVP
app.use('/api/competitive', requireApiKey, apiRateLimiter, competitiveRouter)
// LIN-568: CaaS Mercury Folding API
app.use('/api/fold', requireApiKey, apiRateLimiter, foldRouter)
// LIN-574: Knowledge Graph Hygiene
app.use('/api/graph-hygiene', requireApiKey, graphHygieneRouter)
app.use('/api/deliverables', requireApiKey, deliverablesRouter)
app.use('/api/similarity', requireApiKey, similarityRouter)
app.use('/api/engagements', requireApiKey, engagementsRouter)
app.use('/api/processes', requireApiKey, apiRateLimiter, processesRouter)
app.use('/api/intelligence', requireApiKey, apiRateLimiter, intelligenceRouter)
app.use('/api/governance', requireApiKey, governanceRouter)
// LIN-480: OSINT Scanning Pipeline
app.use('/api/osint', requireApiKey, osintRouter)
// LIN-342: Autonomous Evolution Loop (OODA)
app.use('/api/evolution', requireApiKey, evolutionRouter)
// LIN-582: Working Memory (Redis replacement for PostgreSQL WorkingMemoryStore)
app.use('/api/memory', requireApiKey, memoryRouter)
// LIN-572: ABI Auto-Docs + Live Playground
app.use('/api/abi', requireApiKey, abiDocsRouter)
// LIN-570: ABI Snapshot Testing + Breaking Change Detection
app.use('/api/abi', requireApiKey, abiHealthRouter)
// LIN-573: ABI Tool-Level Versioning + Deprecation
app.use('/api/abi', requireApiKey, abiVersioningRouter)

// Orchestrator_Inventor: ASI-Evolve-inspired evolution engine (testable variant)
app.use('/api/inventor', requireApiKey, apiRateLimiter, inventorRouter)

// Proactive Anomaly Watcher: DETECT→LEARN→REASON→ACT→REMEMBER pipeline
app.use('/api/anomaly-watcher', requireApiKey, anomalyWatcherRouter)

// PeerEval: fleet learning engine (self-assessment + best practice broadcasting)
app.use('/api/peer-eval', requireApiKey, peerEvalRouter)

// Value Flywheel: 5-pillar compound health, consolidation scan, cost optimizer
app.use('/api/flywheel', requireApiKey, flywheelRouter)

// Benchmark: Inventor vs. research baselines (circle-packing / scheduler-opt / ablation)
app.use('/api/benchmark', requireApiKey, benchmarkRouter)

// PhantomBOM Extractor — repo → LLM → PhantomComponent nodes in Neo4j
app.use('/api/phantom-bom', requireApiKey, apiRateLimiter, phantomBomRouter)

// Obsidian Vault proxy (LIN-652) — set OBSIDIAN_API_URL + OBSIDIAN_API_TOKEN in env
app.use('/api/obsidian', requireApiKey, obsidianRouter)

// HyperAgent Autonomous Executor: self-driving cycle engine with SSE streaming
app.use('/api/hyperagent/auto', requireApiKey, apiRateLimiter, hyperagentAutoRouter)

// HyperAgent: plan-based execution with approval gate & KPI persistence (LIN-626/627/628)
app.use('/api/hyperagent', requireApiKey, apiRateLimiter, hyperagentRouter)

// Produce gateway (W4): plugin-facing /produce route, HyperAgent-gated.
app.use('/api', requireApiKey, apiRateLimiter, produceRouter)

// Tool Gateway — REST access to ALL orchestrator tools (Triple-Protocol ABI)
// v4.0.10: uses shared apiRateLimiter (same budget shared across /tools, /chains, /api/tools, /mcp, etc.)
app.use('/api/tools', requireApiKey, apiRateLimiter, toolGatewayRouter)

// Agent Task REST API — for OpenClaw agents (Omega Sentinel) to fetch/claim/complete tasks
// This allows agents without MCP access to interact with the task system via REST
app.get('/api/tasks', requireApiKey, async (req, res) => {
  try {
    const agentId = (req.query.agentId as string) ?? 'omega_sentinel';
    const { config } = await import('./config.js');
    const fetchRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({ tool: 'agent.task.fetch', payload: { agentId } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!fetchRes.ok) {
      res.status(fetchRes.status).json({ error: `Task fetch failed: ${fetchRes.status}` });
      return;
    }
    const data = await fetchRes.json();
    res.json({ success: true, tasks: data?.result ?? data ?? [] });
  } catch (err) {
    res.status(502).json({ error: `Task fetch error: ${String(err)}` });
  }
});

app.post('/api/tasks/:taskId/complete', requireApiKey, async (req, res) => {
  try {
    const { config } = await import('./config.js');
    const fetchRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({ tool: 'agent.task.complete', payload: { taskId: req.params.taskId, result: req.body } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!fetchRes.ok) {
      res.status(fetchRes.status).json({ error: `Task complete failed: ${fetchRes.status}` });
      return;
    }
    const data = await fetchRes.json();
    res.json({ success: true, result: data?.result ?? data });
  } catch (err) {
    res.status(502).json({ error: `Task complete error: ${String(err)}` });
  }
});

app.post('/api/tasks/:taskId/fail', requireApiKey, async (req, res) => {
  try {
    const { config } = await import('./config.js');
    const fetchRes = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({ tool: 'agent.task.fail', payload: { taskId: req.params.taskId, reason: req.body?.reason ?? 'Unknown' } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!fetchRes.ok) {
      res.status(fetchRes.status).json({ error: `Task fail failed: ${fetchRes.status}` });
      return;
    }
    const data = await fetchRes.json();
    res.json({ success: true, result: data?.result ?? data });
  } catch (err) {
    res.status(502).json({ error: `Task fail error: ${String(err)}` });
  }
});

// Update HEARTBEAT.md in OpenClaw workspace
// Called to update Omega Sentinel heartbeat instructions
app.post('/api/heartbeat/update', requireApiKey, async (req, res) => {
  try {
    const openclawUrl = config.openclawUrl || 'https://openclaw-production-9570.up.railway.app';
    const content = req.body?.content;
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const fetchRes = await fetch(`${openclawUrl}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(15000),
    });
    if (!fetchRes.ok) {
      res.status(fetchRes.status).json({ error: `OpenClaw heartbeat update failed: ${fetchRes.status}` });
      return;
    }
    const data = await fetchRes.json();
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(502).json({ error: `Heartbeat update error: ${String(err)}` });
  }
});

// Neural Bus — unified agent-to-agent communication (internal + external)
// All agents use the SAME endpoints — OpenClaw = Orchestrator
app.use('/api/bus', requireApiKey, apiRateLimiter, neuralBusRouter)

// Pheromone layer — for OpenClaw agents to sense/follow/deposit pheromones
app.use('/api/pheromone', requireApiKey, apiRateLimiter, pheromoneRouter)

// Prompt Generator (no auth — utility endpoint)
app.use('/api/prompt-generator', promptGeneratorRouter)

// OpenAPI spec + Swagger UI (no auth — discovery endpoint)
app.use(openapiRouter)

// MCP Streamable HTTP gateway — auth handled inside gateway via query param + Bearer
// v4.1.5: external MCP clients (Qwen, Open WebUI) can't reliably send custom headers
// on SSE GET + JSON-RPC POST. Auth moved into mcp-gateway.ts to support api_key query param.
app.use('/mcp', apiRateLimiter, mcpGatewayRouter)

// OpenAI-compatible API (for Open WebUI)
app.use(openaiCompatRouter)

// FSM Plans endpoint
app.get('/api/plans', requireApiKey, async (_req, res) => {
  try {
    const plans = await listPlans()
    res.json({ success: true, plans, count: plans.length })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

// Harvest pipeline endpoints
app.post('/api/harvest/:domain', requireApiKey, async (req, res) => {
  try {
    const result = await runHarvestPipeline(req.params.domain)
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})

app.post('/api/harvest', requireApiKey, async (_req, res) => {
  try {
    const results = await runFullHarvest()
    res.json({ success: true, results })
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) })
  }
})
app.get('/api/events', requireApiKey, handleSSE)

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'widgetdc-orchestrator',
    version: typeof __PKG_VERSION__ !== 'undefined' ? __PKG_VERSION__ : '0.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    agents_registered: AgentRegistry.all().length,
    ws_connections: getConnectionStats().total,
    sse_clients: getSSEClientCount(),
    redis_enabled: isRedisEnabled(),
    rlm_available: isRlmAvailable(),
    active_chains: listExecutions().filter(e => e.status === 'running').length,
    cron_jobs: listCronJobs().filter(j => j.enabled).length,
    openclaw_healthy: isOpenClawHealthy(),
    librechat_url: config.libreChatUrl || null,
    slack_enabled: isSlackEnabled(),
    write_gate_stats: getWriteGateStats(),
    backend_circuit_breaker: getBackendCircuitState(),
    rate_limit_backpressure: getRateLimitState(),
    anomaly_watcher: (() => { const s = getWatcherState(); return { totalScans: s.totalScans, activeAnomalies: s.activeAnomalies.length, patterns: s.patterns.length } })(),
    pheromone_layer: getPheromoneState(),
    peer_eval: getPeerEvalState(),
    timestamp: new Date().toISOString(),
  })
})

// ─── SPA fallback — serve index.html for all non-API routes ──────────────────
// SPA catch-all handled by middleware above (before API routes)

// ─── JSON parse error handler (P1 fix: return 400 not 500 for malformed JSON) ─
app.use((err: Error & { type?: string }, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON', status_code: 400 },
    })
    return
  }
  next(err)
})

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, status_code: 404 },
  })
})

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled error')
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', status_code: 500 },
  })
})

// ─── Boot ────────────────────────────────────────────────────────────────────
// Start listening immediately so Railway healthcheck passes while boot runs.
// Validation (74 live backend calls) can take >2min when backend is rate-limiting —
// moving it after listen() prevents healthcheck timeout on deploy.
initWebSocket(server)
// Wire KnowledgeBus handler immediately — it's pure EventEmitter, no async deps.
// Must run BEFORE boot() so a Redis/pheromone crash can't prevent routing.
initKnowledgeBus()
server.listen(config.port, () => {
  logger.info(
    { port: config.port, backend: config.backendUrl, env: config.nodeEnv, redis: isRedisEnabled() },
    'WidgeTDC Orchestrator listening (booting...)'
  )
})

async function boot() {
  // Bulletproof W1: Fail-fast startup validation — registry↔executor parity
  // If any tool in TOOL_REGISTRY has no executor case, refuse to start.
  // Catches regressions like missing imports, broken switch statements.
  const { validateOrThrow } = await import('./startup-validator.js')
  await validateOrThrow()

  // initRedis() races against 7s timeout internally — never hangs boot
  await initRedis()
  // Restore HyperAgent closed-ids directly from Redis before any cron/API can trigger a cycle.
  // Uses direct Redis read (no callMcpTool) — immune to validator-bypass and backend timing issues.
  await import('./hyperagent/hyperagent-autonomous.js')
    .then(m => m.initHyperAgentBootRestore())
    .catch(err => logger.warn({ err: String(err) }, 'HyperAgent boot-init restore failed (non-fatal)'))
  await AgentRegistry.hydrate().catch(err => logger.warn({ err: String(err) }, 'AgentRegistry hydrate failed (non-fatal)'))
  seedAgents()
  // LIN-594: Load persisted forged tools from Redis
  import('./llm/skill-forge.js').then(m => m.loadForgedTools()).catch(() => {})
  await hydrateMessages().catch(err => logger.warn({ err: String(err) }, 'hydrateMessages failed (non-fatal)'))
  await hydrateCronJobs().catch(err => logger.warn({ err: String(err) }, 'hydrateCronJobs failed (non-fatal)'))
  try { registerDefaultLoops() } catch (err) { logger.warn({ err: String(err) }, 'registerDefaultLoops failed (non-fatal)') }
  // Initialize proactive anomaly watcher (loads state from Redis — non-fatal: broken socket can throw)
  await initAnomalyWatcher().catch(err => logger.warn({ err: String(err) }, 'initAnomalyWatcher failed (non-fatal)'))
  // Initialize pheromone layer + peer-eval fleet learning (non-fatal — KB already wired above)
  await initPheromoneLayer().catch(err => logger.warn({ err: String(err) }, 'initPheromoneLayer failed (non-fatal)'))
  await initPeerEval().catch(err => logger.warn({ err: String(err) }, 'initPeerEval failed (non-fatal)'))
  // Note: initKnowledgeBus() already called before server.listen() — idempotent guard inside
  // Load persisted benchmark runs from Redis (non-blocking)
  loadBenchmarkRuns().catch(err => {
    logger.warn({ err: String(err) }, 'Benchmark run hydration failed (non-critical)')
  })
  // S1.2 (6-edges handlingsplan): fire any overdue absolute-hour jobs at boot.
  // Non-blocking — server continues starting even if individual jobs fail.
  bootKickstartOverdueJobs().catch(err => {
    logger.warn({ err: String(err) }, 'Cron boot-kickstart encountered error')
  })
  initOpenClaw()

  logger.info('WidgeTDC Orchestrator boot complete')
}

boot().catch(err => {
  logger.error({ err: String(err) }, 'Boot failed')
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received - shutting down gracefully')
  server.close(() => {
    logger.info('HTTP server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  logger.info('SIGINT received - shutting down')
  server.close(() => { process.exit(0) })
})

// Graceful shutdown on unhandled rejections
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'Unhandled rejection')
})
