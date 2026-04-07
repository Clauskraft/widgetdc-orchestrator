/**
 * routes/hyperagent.ts — HyperAgent REST endpoints (LIN-626, LIN-627, LIN-628).
 *
 * Endpoints:
 *   POST /plan                    — Create a plan from a natural-language goal
 *   GET  /plans                   — List recent plans
 *   GET  /plans/:planId           — Get plan details
 *   POST /approve/:planId         — Approve a plan for execution
 *   POST /reject/:planId          — Reject a plan
 *   POST /execute/:planId         — Execute an approved plan
 *   POST /evaluate/:executionId   — Score an execution, persist KPI
 *   GET  /kpis                    — Aggregated KPIs from Neo4j
 *   POST /webhook/approval        — External approval callback (Linear/CLI/UI)
 */
import { Router, Request, Response } from 'express'
import {
  createPlan,
  approvePlan,
  rejectPlan,
  executePlan,
  evaluatePlan,
  getKpis,
  getPlan,
  listHyperPlans,
  validateWebhookSignature,
  getHyperAgentHealth,
  POLICY_PROFILES,
} from '../hyperagent.js'
import { logger } from '../logger.js'

export const hyperagentRouter = Router()

// ─── POST /plan — Create plan from goal ─────────────────────────────────────

hyperagentRouter.post('/plan', async (req: Request, res: Response) => {
  const { goal, sessionId, profile } = req.body as {
    goal?: string
    sessionId?: string
    profile?: string
  }

  if (!goal || typeof goal !== 'string') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: goal (string)', status_code: 400 },
    })
    return
  }

  try {
    const plan = await createPlan(goal, sessionId ?? `session-${Date.now()}`, profile)
    res.json({
      success: true,
      planId: plan.planId,
      status: plan.status,
      profile: plan.profile.id,
      steps: plan.steps.map(s => ({
        id: s.id,
        agent_id: s.agent_id,
        tool_name: s.tool_name,
        cognitive_action: s.cognitive_action,
      })),
      requiresApproval: plan.profile.requiresApproval,
      availableProfiles: Object.keys(POLICY_PROFILES),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error({ err, goal }, 'HyperAgent: plan creation failed')
    res.status(500).json({ success: false, error: { code: 'PLAN_CREATION_FAILED', message: msg, status_code: 500 } })
  }
})

// ─── GET /plans — List recent plans ─────────────────────────────────────────

hyperagentRouter.get('/plans', (_req: Request, res: Response) => {
  const plans = listHyperPlans()
  res.json({
    success: true,
    count: plans.length,
    plans: plans.map(p => ({
      planId: p.planId,
      goal: p.goal,
      status: p.status,
      profile: p.profile.id,
      stepsCount: p.steps.length,
      createdAt: p.createdAt,
    })),
  })
})

// ─── GET /plans/:planId — Plan details ──────────────────────────────────────

hyperagentRouter.get('/plans/:planId', (req: Request, res: Response) => {
  const plan = getPlan(req.params.planId)
  if (!plan) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Plan ${req.params.planId} not found`, status_code: 404 } })
    return
  }
  res.json({ success: true, plan })
})

// ─── POST /approve/:planId ──────────────────────────────────────────────────

hyperagentRouter.post('/approve/:planId', async (req: Request, res: Response) => {
  const { approvedBy } = req.body as { approvedBy?: string }

  try {
    const approval = await approvePlan(
      req.params.planId,
      approvedBy ?? 'api-caller',
    )
    res.json({ success: true, approval })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ success: false, error: { code: 'APPROVAL_FAILED', message: msg, status_code: 400 } })
  }
})

// ─── POST /reject/:planId ───────────────────────────────────────────────────

hyperagentRouter.post('/reject/:planId', async (req: Request, res: Response) => {
  const { rejectedBy } = req.body as { rejectedBy?: string }

  try {
    await rejectPlan(req.params.planId, rejectedBy ?? 'api-caller')
    res.json({ success: true, planId: req.params.planId, status: 'rejected' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ success: false, error: { code: 'REJECTION_FAILED', message: msg, status_code: 400 } })
  }
})

// ─── POST /execute/:planId ──────────────────────────────────────────────────

hyperagentRouter.post('/execute/:planId', async (req: Request, res: Response) => {
  try {
    const execution = await executePlan(req.params.planId)
    res.json({
      success: true,
      executionId: execution.execution_id,
      planId: req.params.planId,
      status: execution.status,
      stepsCompleted: execution.steps_completed,
      stepsTotal: execution.steps_total,
      durationMs: execution.duration_ms,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const code = msg.includes('requires approval') ? 403 : msg.includes('not found') ? 404 : 500
    res.status(code).json({ success: false, error: { code: 'EXECUTION_FAILED', message: msg, status_code: code } })
  }
})

// ─── POST /evaluate/:executionId ────────────────────────────────────────────

hyperagentRouter.post('/evaluate/:executionId', async (req: Request, res: Response) => {
  const { planId, score, agentId } = req.body as {
    planId?: string
    score?: number
    agentId?: string
  }

  if (!planId || typeof score !== 'number') {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: planId (string), score (number 0-100)', status_code: 400 },
    })
    return
  }

  try {
    const snapshot = await evaluatePlan(req.params.executionId, planId, score, agentId)
    res.json({ success: true, kpiSnapshot: snapshot })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ success: false, error: { code: 'EVALUATION_FAILED', message: msg, status_code: 500 } })
  }
})

// ─── GET /kpis — Aggregated KPIs ────────────────────────────────────────────

hyperagentRouter.get('/kpis', async (req: Request, res: Response) => {
  const windowHours = parseInt(String(req.query.window ?? '24'), 10) || 24
  try {
    const kpis = await getKpis(windowHours)
    res.json({ success: true, ...kpis })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ success: false, error: { code: 'KPI_FETCH_FAILED', message: msg, status_code: 500 } })
  }
})

// ─── POST /webhook/approval — External approval callback ───────────────────

hyperagentRouter.post('/webhook/approval', async (req: Request, res: Response) => {
  // Validate HMAC signature if secret is configured
  const signature = req.headers['x-webhook-signature'] as string | undefined
  const bodyStr = JSON.stringify(req.body)

  if (!validateWebhookSignature(bodyStr, signature)) {
    res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature validation failed', status_code: 401 } })
    return
  }

  const { planId, action, approvedBy } = req.body as {
    planId?: string
    action?: 'approve' | 'reject'
    approvedBy?: string
  }

  if (!planId || !action) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: planId, action (approve|reject)', status_code: 400 },
    })
    return
  }

  try {
    if (action === 'approve') {
      const approval = await approvePlan(planId, approvedBy ?? 'webhook')
      res.json({ success: true, approval })
    } else {
      await rejectPlan(planId, approvedBy ?? 'webhook')
      res.json({ success: true, planId, status: 'rejected' })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ success: false, error: { code: 'WEBHOOK_FAILED', message: msg, status_code: 400 } })
  }
})

// ─── GET /health — HyperAgent subsystem health ─────────────────────────────

hyperagentRouter.get('/health', (_req: Request, res: Response) => {
  const health = getHyperAgentHealth()
  res.json({ success: true, subsystem: 'hyperagent', ...health })
})
