/**
 * linear-proxy.ts — Proxy Linear API calls through orchestrator via backend MCP
 *
 * Allows cc-v4 frontend to read/write Linear issues, labels, and projects
 * via the orchestrator, avoiding CORS and auth issues.
 *
 * Routes all requests through backend MCP (which has valid LINEAR_API_KEY).
 */
import { Router, Request, Response } from 'express'
import { logger } from '../logger.js'
import { config } from '../config.js'

export const linearProxyRouter = Router()

/** Call backend MCP directly */
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
 */
linearProxyRouter.get('/issues', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 250)
    const state = req.query.state as string | undefined

    const payload: Record<string, unknown> = { limit }
    if (state) payload.status = state

    const data = await callBackendMcp('linear.issues', payload)
    const result = data?.result ?? data
    const rawIssues = result?.issues ?? result?.nodes ?? result ?? []
    // Normalize: ensure state is a string, not an object
    const issues = rawIssues.map((issue: any) => ({
      ...issue,
      state: issue.state?.name ?? issue.state ?? 'Backlog',
    }))
    res.json(Array.isArray(issues) ? issues : [])
  } catch (err) {
    logger.error({ err: String(err) }, 'Linear proxy: failed to fetch issues')
    res.status(502).json({ error: `Failed to fetch Linear issues: ${String(err)}` })
  }
})

/**
 * GET /api/linear/labels
 */
linearProxyRouter.get('/labels', async (_req: Request, res: Response) => {
  try {
    const data = await callBackendMcp('linear.labels', { limit: 100 })
    const result = data?.result ?? data
    const labels = result?.labels ?? result?.nodes ?? result ?? []
    res.json(Array.isArray(labels) ? labels : [])
  } catch (err) {
    logger.error({ err: String(err) }, 'Linear proxy: failed to fetch labels')
    res.status(502).json({ error: `Failed to fetch Linear labels: ${String(err)}` })
  }
})

/**
 * GET /api/linear/issue/:id
 */
linearProxyRouter.get('/issue/:id', async (req: Request, res: Response) => {
  try {
    const data = await callBackendMcp('linear.issue_get', { identifier: req.params.id })
    res.json(data?.result ?? data ?? {})
  } catch (err) {
    logger.error({ err: String(err) }, `Linear proxy: failed to fetch issue ${req.params.id}`)
    res.status(502).json({ error: `Failed to fetch Linear issue: ${String(err)}` })
  }
})

/**
 * POST /api/linear/issues — Create or update
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
      team: body.team,
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
 * POST /api/linear/issues/:id — Update specific issue
 */
linearProxyRouter.post('/issues/:id', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>
    const data = await callBackendMcp('linear.save_issue', {
      id: req.params.id,
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
