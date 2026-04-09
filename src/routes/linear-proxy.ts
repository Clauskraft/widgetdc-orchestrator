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
import { callMcpTool } from '../mcp-caller.js'

export const linearProxyRouter = Router()

/**
 * GET /api/linear/issues?limit=100&state=...
 * List issues from Linear via MCP tool.
 */
linearProxyRouter.get('/issues', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 250)
    const state = req.query.state as string | undefined

    const result = await callMcpTool({
      toolName: 'linear_issues',
      args: {
        limit,
        state: state ?? undefined,
        orderBy: 'updatedAt',
      },
      callId: `linear-issues-${Date.now()}`,
    })

    // Parse and normalize the response
    const issues = Array.isArray(result) ? result
      : (result && typeof result === 'object' && 'issues' in result) ? result.issues
      : (result && typeof result === 'object' && 'nodes' in result) ? result.nodes
      : []

    res.json(issues)
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
    const result = await callMcpTool({
      toolName: 'linear_labels',
      args: { limit: 100 },
      callId: `linear-labels-${Date.now()}`,
    })

    const labels = Array.isArray(result) ? result
      : (result && typeof result === 'object' && 'nodes' in result) ? result.nodes
      : []

    res.json(labels)
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

    const result = await callMcpTool({
      toolName: 'linear_save_issue',
      args: {
        id: body.id,
        title: body.title,
        description: body.description,
        team: body.team ?? 'WidgeTDC',
        priority: body.priority,
        assignee: body.assignee,
        labels: body.labels,
        state: body.state,
        estimate: body.estimate,
      },
      callId: `linear-save-${body.id ?? 'new'}-${Date.now()}`,
    })

    res.json(result)
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

    const result = await callMcpTool({
      toolName: 'linear_save_issue',
      args: {
        id,
        title: body.title,
        description: body.description,
        priority: body.priority,
        assignee: body.assignee,
        labels: body.labels,
        state: body.state,
        estimate: body.estimate,
      },
      callId: `linear-update-${id}-${Date.now()}`,
    })

    res.json(result)
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
    const result = await callMcpTool({
      toolName: 'linear_get_issue',
      args: { id: req.params.id },
      callId: `linear-detail-${req.params.id}-${Date.now()}`,
    })

    res.json(result)
  } catch (err) {
    logger.error({ err: String(err) }, `Linear proxy: failed to get issue ${req.params.id}`)
    res.status(502).json({ error: `Failed to get Linear issue: ${String(err)}` })
  }
})
