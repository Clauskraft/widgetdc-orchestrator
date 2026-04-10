/**
 * linear-proxy.ts — Proxy Linear API calls through orchestrator
 *
 * Allows cc-v4 frontend to read/write Linear issues, labels, and projects
 * via the orchestrator, avoiding CORS and auth issues.
 *
 * Endpoints:
 * GET  /api/linear/issues?limit=100&state=... — List issues
 * GET  /api/linear/labels — List labels
 * POST /api/linear/issues — Create or update issue
 * POST /api/linear/issues/:id — Update issue
 * POST /api/linear/issues/:id/state — Quick state change
 */
import { Router, Request, Response } from 'express'
import { logger } from '../logger.js'
import { config } from '../config.js'

export const linearProxyRouter = Router()

/** Call backend MCP directly (bypasses local executor text formatting) */
async function callBackendMcp(toolName: string, payload: Record<string, unknown>) {
  const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.backendApiKey}`,
    },
    body: JSON.stringify({ tool: toolName, payload }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Backend MCP ${toolName}: ${res.status}`)
  return res.json()
}

/**
 * GET /api/linear/issues?limit=100&state=...
 * List issues from Linear via backend MCP.
 */
linearProxyRouter.get('/issues', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 250)
    const state = req.query.state as string | undefined

    const payload: Record<string, unknown> = { limit }
    if (state === 'active') payload.status = 'started'
    else if (state === 'done') payload.status = 'completed'
    else if (state === 'backlog') payload.status = 'backlog'
    else payload.status = state // pass through custom state

    const data = await callBackendMcp('linear.issues', payload)
    const issues = data?.result?.issues ?? data?.result ?? data ?? []
    res.json(Array.isArray(issues) ? issues : [])
  } catch (err) {
    logger.error({ err: String(err) }, 'Linear proxy: failed to fetch issues')
    res.status(502).json({ error: `Failed to fetch Linear issues: ${String(err)}` })
  }
})

/**
 * GET /api/linear/labels
 * List available Linear labels.
 */
linearProxyRouter.get('/labels', async (_req: Request, res: Response) => {
  try {
    const data = await callBackendMcp('linear.labels', { limit: 100 })
    const labels = data?.result?.nodes ?? data?.result ?? []
    res.json(Array.isArray(labels) ? labels : [])
  } catch (err) {
    logger.error({ err: String(err) }, 'Linear proxy: failed to fetch labels')
    res.status(502).json({ error: `Failed to fetch Linear labels: ${String(err)}` })
  }
})

/**
 * POST /api/linear/issues
 * Create or update a Linear issue.
 * Body: { title, description, team, priority, assignee, labels, state, estimate }
 * If body has 'id', it updates; otherwise creates.
 */
linearProxyRouter.post('/issues', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>

    if (!body.title && !body.id) {
      res.status(400).json({ error: 'title required for new issues' })
      return
    }

    const data = await callBackendMcp('linear.save_issue', {
      id: body.id,
      title: body.title,
      description: body.description,
      team: body.team ?? 'WidgeTDC',
      priority: body.priority,
      assignee: body.assignee,
      labels: body.labels,
      state: body.state,
      estimate: body.estimate,
    })

    res.json(data?.result ?? data)
  } catch (err) {
    logger.error({ err: String(err) }, 'Linear proxy: failed to save issue')
    res.status(502).json({ error: `Failed to save Linear issue: ${String(err)}` })
  }
})

/**
 * POST /api/linear/issues/:id
 * Update a specific Linear issue.
 * Body: { title?, description?, priority?, assignee?, labels?, state?, estimate? }
 */
linearProxyRouter.post('/issues/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const body = req.body as Record<string, unknown>

    const data = await callBackendMcp('linear.save_issue', {
      id,
      title: body.title,
      description: body.description,
      priority: body.priority,
      assignee: body.assignee,
      labels: body.labels,
      state: body.state,
      estimate: body.estimate,
    })

    res.json(data?.result ?? data)
  } catch (err) {
    logger.error({ err: String(err) }, `Linear proxy: failed to update issue ${req.params.id}`)
    res.status(502).json({ error: `Failed to update Linear issue: ${String(err)}` })
  }
})

/**
 * GET /api/linear/issue/:id
 * Get a single issue detail.
 */
linearProxyRouter.get('/issue/:id', async (req: Request, res: Response) => {
  try {
    const data = await callBackendMcp('linear.get_issue', { id: req.params.id })
    res.json(data?.result ?? data)
  } catch (err) {
    logger.error({ err: String(err) }, `Linear proxy: failed to get issue ${req.params.id}`)
    res.status(502).json({ error: `Failed to get Linear issue: ${String(err)}` })
  }
})
