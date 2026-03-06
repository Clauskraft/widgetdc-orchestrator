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
import { createServer } from 'http'
import { config } from './config.js'
import { logger } from './logger.js'
import { initWebSocket } from './chat-broadcaster.js'
import { agentsRouter } from './routes/agents.js'
import { toolsRouter } from './routes/tools.js'
import { chatRouter } from './routes/chat.js'
import { AgentRegistry } from './agent-registry.js'
import { getConnectionStats } from './chat-broadcaster.js'
import { requireApiKey } from './auth.js'

const app = express()
const server = createServer(app)

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: false }))

// Request logging
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Request')
  next()
})

// ─── Routes ──────────────────────────────────────────────────────────────────
// Auth required for mutating endpoints (if ORCHESTRATOR_API_KEY is set)
app.use('/agents', requireApiKey, agentsRouter)
app.use('/tools', requireApiKey, toolsRouter)
app.use('/chat', requireApiKey, chatRouter)

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'widgetdc-orchestrator',
    version: '1.0.0',
    uptime_seconds: Math.floor(process.uptime()),
    agents_registered: AgentRegistry.all().length,
    ws_connections: getConnectionStats().total,
    timestamp: new Date().toISOString(),
  })
})

// ─── Dashboard ────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  const agents = AgentRegistry.all()
  const ws = getConnectionStats()

  const agentRows = agents.length === 0
    ? '<tr><td colspan="5" style="text-align:center;color:#888">No agents registered yet</td></tr>'
    : agents.map(a => `
      <tr>
        <td><strong>${a.handshake.agent_id}</strong></td>
        <td>${a.handshake.display_name}</td>
        <td><span class="badge badge-${a.handshake.status}">${a.handshake.status}</span></td>
        <td>${a.handshake.allowed_tool_namespaces.join(', ')}</td>
        <td>${a.activeCalls}</td>
      </tr>`).join('')

  const wsRows = ws.agents.length === 0
    ? '<tr><td colspan="3" style="text-align:center;color:#888">No WebSocket connections</td></tr>'
    : ws.agents.map(c => `
      <tr>
        <td>${c.agent_id}</td>
        <td><span class="badge badge-online">${c.state}</span></td>
        <td>${c.connected_at}</td>
      </tr>`).join('')

  res.setHeader('Content-Type', 'text/html')
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
    <p>Multi-agent coordination layer · Railway deployment · Auto-refresh every 10s</p>
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
        <div class="card-value" style="color:#4ade80">●</div>
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
        <div class="desc">Submit an OrchestratorToolCall → returns OrchestratorToolResult. Requires registered agent_id.</div>
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
        <div class="desc">Send an AgentMessage — broadcasts to all WebSocket connections.</div>
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
</html>`)
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
initWebSocket(server)

server.listen(config.port, () => {
  logger.info(
    { port: config.port, backend: config.backendUrl, env: config.nodeEnv },
    '🚀 WidgeTDC Orchestrator ready'
  )
})

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received — shutting down gracefully')
  server.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })
})
