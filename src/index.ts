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
import 'dotenv/config'
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
import { openclawRouter, initOpenClaw, isOpenClawHealthy } from './routes/openclaw.js'
import { llmRouter } from './routes/llm.js'
import { auditRouter } from './routes/audit.js'
import { knowledgeRouter } from './routes/knowledge.js'
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
import { AgentRegistry } from './agent-registry.js'
import { getConnectionStats } from './chat-broadcaster.js'
import { requireApiKey } from './auth.js'
import { isSlackEnabled } from './slack.js'
import { isRlmAvailable } from './cognitive-proxy.js'
import { hydrateCronJobs, registerDefaultLoops, listCronJobs } from './cron-scheduler.js'
import { listExecutions } from './chain-engine.js'
import { listPlans, type FSMState } from './state-machine.js'
import { runHarvestPipeline, runFullHarvest } from './harvest-pipeline.js'
import { openaiCompatRouter } from './routes/openai-compat.js'
import { promptGeneratorRouter } from './routes/prompt-generator.js'
import { openapiRouter } from './openapi.js'
import { mcpGatewayRouter } from './routes/mcp-gateway.js'
import { toolGatewayRouter } from './routes/tool-gateway.js'
import { seedAgents } from './agent-seeds.js'
import { hydrateMessages } from './chat-store.js'
import { failuresRouter } from './routes/failures.js'
import { competitiveRouter } from './routes/competitive.js'
import { foldRouter } from './routes/fold.js'
import { graphHygieneRouter } from './routes/graph-hygiene.js'
import { deliverablesRouter } from './routes/deliverables.js'
import { similarityRouter } from './routes/similarity.js'
import { getWriteGateStats } from './write-gate.js'
import { governanceRouter } from './routes/governance.js'
import { osintRouter } from './routes/osint.js'
import { evolutionRouter } from './routes/evolution.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const server = createServer(app)

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // SPA uses inline styles + scripts
  crossOriginEmbedderPolicy: false,
}))
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, MCP clients, server-to-server)
    if (!origin) return callback(null, true)

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

// Request logging
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Request')
  next()
})

// ─── Static frontend (Command Center SPA) ───────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate') },
}))

// ─── Audit middleware (logs all mutations) ───────────────────────────────────
app.use(auditMiddleware)

// ─── Routes ──────────────────────────────────────────────────────────────────
// Auth required for mutating endpoints (if ORCHESTRATOR_API_KEY is set)
app.use('/agents', requireApiKey, agentsRouter)
app.use('/tools', requireApiKey, toolsRouter)
app.use('/chat', requireApiKey, chatRouter)
app.use('/chains', requireApiKey, chainsRouter)
app.use('/cognitive', requireApiKey, cognitiveRouter)
app.use('/cron', requireApiKey, cronRouter)

// Dashboard data API + OpenClaw proxy + Audit log + LLM + SSE
app.use('/api/dashboard', dashboardRouter)
app.use('/api/openclaw', requireApiKey, openclawRouter)
app.use('/api/audit', requireApiKey, auditRouter)
app.use('/api/knowledge', requireApiKey, knowledgeRouter)
app.use('/api/adoption', requireApiKey, adoptionRouter)
app.use('/api/artifacts', requireApiKey, artifactRouter)
app.use('/api/notebooks', requireApiKey, notebookRouter)
app.use('/api/drill', requireApiKey, drillRouter)
app.use('/api/llm', requireApiKey, llmRouter)
app.use('/api/assembly', requireApiKey, assemblyRouter)
app.use('/api/loose-ends', requireApiKey, looseEndsRouter)
app.use('/api/decisions', requireApiKey, decisionsRouter)
app.use('/monitor', requireApiKey, monitorRouter)
app.use('/api/s1-s4', requireApiKey, s1s4Router)

// LIN-567: Red Queen Failure Harvester
app.use('/api/failures', requireApiKey, failuresRouter)
// LIN-566: Competitive Phagocytosis MVP
app.use('/api/competitive', requireApiKey, competitiveRouter)
// LIN-568: CaaS Mercury Folding API
app.use('/api/fold', requireApiKey, foldRouter)
// LIN-574: Knowledge Graph Hygiene
app.use('/api/graph-hygiene', requireApiKey, graphHygieneRouter)
app.use('/api/deliverables', requireApiKey, deliverablesRouter)
app.use('/api/similarity', requireApiKey, similarityRouter)
app.use('/api/governance', requireApiKey, governanceRouter)
// LIN-480: OSINT Scanning Pipeline
app.use('/api/osint', requireApiKey, osintRouter)
// LIN-342: Autonomous Evolution Loop (OODA)
app.use('/api/evolution', requireApiKey, evolutionRouter)

// Tool Gateway — REST access to ALL orchestrator tools (Triple-Protocol ABI)
app.use('/api/tools', requireApiKey, toolGatewayRouter)

// Prompt Generator (no auth — utility endpoint)
app.use('/api/prompt-generator', promptGeneratorRouter)

// OpenAPI spec + Swagger UI (no auth — discovery endpoint)
app.use(openapiRouter)

// MCP Streamable HTTP gateway (auth required)
app.use('/mcp', requireApiKey, mcpGatewayRouter)

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
    version: '2.3.0',
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
    timestamp: new Date().toISOString(),
  })
})

// ─── SPA fallback — serve index.html for all non-API routes ──────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

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
async function boot() {
  await initRedis()
  await AgentRegistry.hydrate()
  seedAgents()
  await hydrateMessages()
  await hydrateCronJobs()
  registerDefaultLoops()
  initOpenClaw()
  initWebSocket(server)

  server.listen(config.port, () => {
    logger.info(
      { port: config.port, backend: config.backendUrl, env: config.nodeEnv, redis: isRedisEnabled() },
      'WidgeTDC Orchestrator ready'
    )
  })
}

boot().catch(err => {
  logger.error({ err: String(err) }, 'Boot failed')
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down gracefully')
  server.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })
})
