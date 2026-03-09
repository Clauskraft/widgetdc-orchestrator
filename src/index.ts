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
import { openclawRouter } from './routes/openclaw.js'
import { auditRouter } from './routes/audit.js'
import { auditMiddleware } from './audit.js'
import { handleSSE, getSSEClientCount } from './sse.js'
import { AgentRegistry } from './agent-registry.js'
import { getConnectionStats } from './chat-broadcaster.js'
import { requireApiKey } from './auth.js'
import { isSlackEnabled } from './slack.js'
import { isRlmAvailable } from './cognitive-proxy.js'
import { hydrateCronJobs, registerDefaultLoops, listCronJobs } from './cron-scheduler.js'
import { listExecutions } from './chain-engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const server = createServer(app)

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // SPA uses inline styles + scripts
  crossOriginEmbedderPolicy: false,
}))
app.use(cors({
  origin: [
    'https://consulting-production-b5d8.up.railway.app',
    'https://orchestrator-production-c27e.up.railway.app',
    /^https?:\/\/localhost(:\d+)?$/,
  ],
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
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

// Dashboard data API + OpenClaw proxy + Audit log + SSE
app.use('/api/dashboard', dashboardRouter)
app.use('/api/openclaw', requireApiKey, openclawRouter)
app.use('/api/audit', requireApiKey, auditRouter)
app.get('/api/events', requireApiKey, handleSSE)

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'widgetdc-orchestrator',
    version: '1.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    agents_registered: AgentRegistry.all().length,
    ws_connections: getConnectionStats().total,
    sse_clients: getSSEClientCount(),
    redis_enabled: isRedisEnabled(),
    rlm_available: isRlmAvailable(),
    active_chains: listExecutions().filter(e => e.status === 'running').length,
    cron_jobs: listCronJobs().filter(j => j.enabled).length,
    slack_enabled: isSlackEnabled(),
    timestamp: new Date().toISOString(),
  })
})

// ─── SPA fallback — serve index.html for all non-API routes ──────────────────
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
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
  await hydrateCronJobs()
  registerDefaultLoops()
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
