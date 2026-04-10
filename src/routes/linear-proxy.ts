/**
 * linear-proxy.ts — Proxy Linear API calls through orchestrator
 *
 * Allows cc-v4 frontend to read/write Linear issues, labels, and projects
 * via the orchestrator, avoiding CORS and auth issues.
 *
 * Calls Linear GraphQL API directly (omega-sentinel pattern: direct, no hop).
 *
 * Endpoints:
 * GET  /api/linear/issues?limit=100&state=... — List issues
 * GET  /api/linear/labels — List labels
 * POST /api/linear/issues — Create or update issue
 * POST /api/linear/issues/:id — Update issue
 * GET  /api/linear/issue/:id — Get single issue
 */
import { Router, Request, Response } from 'express'
import { logger } from '../logger.js'

export const linearProxyRouter = Router()

const LINEAR_API = 'https://api.linear.app/graphql'
const LINEAR_API_KEY = process.env.LINEAR_API_KEY ?? ''

async function linearGraphQL(query: string, variables?: Record<string, unknown>) {
  if (!LINEAR_API_KEY) throw new Error('LINEAR_API_KEY not configured')
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Linear API: ${res.status} ${res.statusText}`)
  const data = await res.json() as { data?: Record<string, unknown>; errors?: { message: string }[] }
  if (data.errors?.length) throw new Error(`Linear GraphQL: ${data.errors.map(e => e.message).join(', ')}`)
  return data.data
}

/** Map frontend state names to Linear state types */
function mapStateFilter(state?: string): string | undefined {
  if (!state) return undefined
  const map: Record<string, string> = {
    'active': 'started',
    'done': 'completed',
    'completed': 'completed',
    'backlog': 'backlog',
    'todo': 'todo',
    'in progress': 'started',
    'started': 'started',
    'canceled': 'canceled',
  }
  return map[state.toLowerCase()] ?? state
}

/**
 * GET /api/linear/issues?limit=100&state=...
 */
linearProxyRouter.get('/issues', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 250)
    const stateFilter = mapStateFilter(req.query.state as string | undefined)

    const where: Record<string, unknown> = {}
    if (stateFilter) where.state = { type: { key: { eq: stateFilter } } }

    const data = await linearGraphQL(
      `query($first: Int!, $filter: IssueFilter) {
        issues(first: $first, filter: $filter) {
          nodes {
            id identifier title description createdAt updatedAt
            priority priorityLabel estimate
            state { name type color }
            assignee { name displayName email }
            labels { nodes { name color description } }
            project { name }
            team { name key }
            url branchName
          }
        }
      }`,
      { first: limit, filter: Object.keys(where).length > 0 ? where : undefined },
    )

    const nodes = (data?.issues as any)?.nodes ?? []
    res.json(nodes.map((issue: any) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state?.name ?? 'Unknown',
      stateType: issue.state?.type,
      stateColor: issue.state?.color,
      priority: issue.priority,
      priorityLabel: issue.priorityLabel,
      assignee: issue.assignee,
      labels: issue.labels?.nodes ?? [],
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      estimate: issue.estimate,
      url: issue.url,
      branchName: issue.branchName,
      team: issue.team,
      project: issue.project,
    })))
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
    const data = await linearGraphQL(
      `query($limit: Int!) {
        issueLabels(limit: $limit) {
          nodes { id name color description }
        }
      }`,
      { limit: 100 },
    )
    const nodes = (data?.issueLabels as any)?.nodes ?? []
    res.json(nodes)
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
    const data = await linearGraphQL(
      `query($id: String!) {
        issue(id: $id) {
          id identifier title description createdAt updatedAt
          priority priorityLabel estimate
          state { name type color }
          assignee { name displayName email }
          labels { nodes { name color description } }
          project { name }
          team { name key }
          url branchName
          comments { nodes { id body createdAt user { name displayName } } }
        }
      }`,
      { id: req.params.id },
    )
    res.json(data?.issue ?? {})
  } catch (err) {
    logger.error({ err: String(err) }, `Linear proxy: failed to get issue ${req.params.id}`)
    res.status(502).json({ error: `Failed to get Linear issue: ${String(err)}` })
  }
})

/**
 * POST /api/linear/issues
 * Create or update a Linear issue.
 */
linearProxyRouter.post('/issues', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>

    if (body.id) {
      // Update existing issue
      const data = await linearGraphQL(
        `mutation($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue { id identifier title state { name } }
          }
        }`,
        {
          id: body.id,
          input: {
            title: body.title,
            description: body.description,
            priority: body.priority,
            assigneeId: body.assignee,
            stateId: body.stateId,
            labelIds: body.labels,
            estimate: body.estimate,
          },
        },
      )
      res.json(data?.issueUpdate ?? {})
    } else {
      // Create new issue
      if (!body.title) {
        res.status(400).json({ error: 'title required for new issues' })
        return
      }
      const data = await linearGraphQL(
        `mutation($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue { id identifier title state { name } url }
          }
        }`,
        {
          input: {
            title: body.title,
            description: body.description,
            priority: body.priority,
            teamId: body.team ?? 'WidgeTDC',
            assigneeId: body.assignee,
            stateId: body.stateId,
            labelIds: body.labels,
            estimate: body.estimate,
          },
        },
      )
      res.json(data?.issueCreate ?? {})
    }
  } catch (err) {
    logger.error({ err: String(err) }, 'Linear proxy: failed to save issue')
    res.status(502).json({ error: `Failed to save Linear issue: ${String(err)}` })
  }
})

/**
 * POST /api/linear/issues/:id
 * Update a specific Linear issue.
 */
linearProxyRouter.post('/issues/:id', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>

    const data = await linearGraphQL(
      `mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier title state { name } }
        }
      }`,
      {
        id: req.params.id,
        input: {
          title: body.title,
          description: body.description,
          priority: body.priority,
          assigneeId: body.assignee,
          stateId: body.stateId,
          labelIds: body.labels,
          estimate: body.estimate,
        },
      },
    )

    res.json(data?.issueUpdate ?? {})
  } catch (err) {
    logger.error({ err: String(err) }, `Linear proxy: failed to update issue ${req.params.id}`)
    res.status(502).json({ error: `Failed to update Linear issue: ${String(err)}` })
  }
})
