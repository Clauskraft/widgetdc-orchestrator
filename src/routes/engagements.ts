/**
 * routes/engagements.ts — v4.0 Engagement Intelligence Engine API
 *
 * Backend for StitchLive v4.0 engagement tool in Open WebUI.
 * This file exposes data only — rendering is StitchLive's job.
 *
 *   POST /api/engagements              — Create engagement (draft)
 *   GET  /api/engagements              — List recent engagements
 *   GET  /api/engagements/:id          — Single engagement
 *   POST /api/engagements/match        — Find similar precedents
 *   POST /api/engagements/plan         — Generate structured plan
 *   GET  /api/engagements/:id/plan     — Retrieve stored plan
 *   POST /api/engagements/:id/outcome  — Record completion outcome
 *   GET  /api/engagements/:id/outcome  — Retrieve stored outcome
 */
import { Router, Request, Response } from 'express'
import {
  createEngagement,
  getEngagement,
  listEngagements,
  matchPrecedents,
  generatePlan,
  getPlan,
  recordOutcome,
  getOutcome,
  PlanGateRejection,
  type CreateEngagementRequest,
  type MatchRequest,
  type PlanRequest,
  type RecordOutcomeRequest,
  type OutcomeGrade,
} from '../engagement/engagement-engine.js'
import { listArtifactsForEngagement, listDeliverablesForEngagement } from '../engagement/engagement-lineage.js'
import { recommendPhantomSkillLoop } from '../services/phantom-loop-selector.js'
import { logger } from '../logger.js'

export const engagementsRouter = Router()

const VALID_GRADES: OutcomeGrade[] = ['exceeded', 'met', 'partial', 'missed']

// ─── Rate limiting (shared pattern with deliverables) ──────────────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

function isRateLimited(key: string): boolean {
  const now = Date.now()
  if (rateLimitMap.size > 100) {
    for (const [k, v] of rateLimitMap) {
      if (now - v.windowStart > RATE_WINDOW_MS * 2) rateLimitMap.delete(k)
    }
  }
  const entry = rateLimitMap.get(key)
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message, status_code: 400 },
  })
}

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && !Number.isNaN(Date.parse(s))
}

// ─── POST / — Create engagement ─────────────────────────────────────────────

engagementsRouter.post('/', async (req: Request, res: Response) => {
  const apiKey = (req.headers.authorization ?? '').replace('Bearer ', '') || 'anon'
  if (isRateLimited(apiKey)) {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded', status_code: 429 },
    })
    return
  }

  const body = req.body as Record<string, unknown>
  const client = body.client as string
  const domain = body.domain as string
  const objective = body.objective as string
  const startDate = body.start_date as string
  const targetEndDate = body.target_end_date as string

  if (!client || typeof client !== 'string' || client.length < 2) return badRequest(res, 'client required (min 2 chars)')
  if (!domain || typeof domain !== 'string') return badRequest(res, 'domain required')
  if (!objective || typeof objective !== 'string' || objective.length < 10) return badRequest(res, 'objective required (min 10 chars)')
  if (!isIsoDate(startDate)) return badRequest(res, 'start_date must be ISO date')
  if (!isIsoDate(targetEndDate)) return badRequest(res, 'target_end_date must be ISO date')
  if (new Date(targetEndDate) <= new Date(startDate)) return badRequest(res, 'target_end_date must be after start_date')

  const request: CreateEngagementRequest = {
    client,
    domain,
    objective,
    start_date: startDate,
    target_end_date: targetEndDate,
    budget_dkk: typeof body.budget_dkk === 'number' && body.budget_dkk >= 0 ? body.budget_dkk : undefined,
    team_size: typeof body.team_size === 'number' && body.team_size > 0 && body.team_size < 500 ? body.team_size : undefined,
    methodology_refs: Array.isArray(body.methodology_refs)
      ? (body.methodology_refs as unknown[]).filter(x => typeof x === 'string').map(String)
      : undefined,
  }

  try {
    const engagement = await createEngagement(request)
    res.status(201).json({ success: true, data: engagement })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn({ error: message }, 'Engagement create failed')
    res.status(500).json({
      success: false,
      error: { code: 'CREATE_FAILED', message, status_code: 500 },
    })
  }
})

// ─── GET / — List engagements ───────────────────────────────────────────────

engagementsRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20')), 1), 100)
  try {
    const engagements = await listEngagements(limit)
    res.json({ success: true, data: engagements, total: engagements.length })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'LIST_FAILED', message: err instanceof Error ? err.message : String(err), status_code: 500 },
    })
  }
})

// ─── POST /match — Find precedents ──────────────────────────────────────────

engagementsRouter.post('/match', async (req: Request, res: Response) => {
  const apiKey = (req.headers.authorization ?? '').replace('Bearer ', '') || 'anon'
  if (isRateLimited(apiKey)) {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded', status_code: 429 },
    })
    return
  }

  const body = req.body as Record<string, unknown>
  const objective = body.objective as string
  const domain = body.domain as string
  if (!objective || typeof objective !== 'string' || objective.length < 5) return badRequest(res, 'objective required (min 5 chars)')
  if (!domain || typeof domain !== 'string') return badRequest(res, 'domain required')

  const rawMax = body.max_results
  const maxResults = (typeof rawMax === 'number' && rawMax > 0 && rawMax <= 20) ? rawMax : 5

  const request: MatchRequest = { objective, domain, max_results: maxResults }

  try {
    const result = await matchPrecedents(request)
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'MATCH_FAILED', message: err instanceof Error ? err.message : String(err), status_code: 500 },
    })
  }
})

// ─── POST /plan — Generate structured plan ──────────────────────────────────

engagementsRouter.post('/plan', async (req: Request, res: Response) => {
  const apiKey = (req.headers.authorization ?? '').replace('Bearer ', '') || 'anon'
  if (isRateLimited(apiKey)) {
    res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded', status_code: 429 },
    })
    return
  }

  const body = req.body as Record<string, unknown>
  const objective = body.objective as string
  const domain = body.domain as string
  const durationWeeks = body.duration_weeks
  const teamSize = body.team_size

  // v4.0.3: Route does minimal TYPE validation only. Semantic limits (ranges, hard
  // caps, sanity checks) are enforced by the engagement-engine smart gates which
  // return a typed PlanGateRejection mapped to HTTP 422.
  if (typeof objective !== 'string' || objective.length === 0) return badRequest(res, 'objective required (string)')
  if (!domain || typeof domain !== 'string') return badRequest(res, 'domain required')
  if (typeof durationWeeks !== 'number') return badRequest(res, 'duration_weeks must be a number')
  if (typeof teamSize !== 'number') return badRequest(res, 'team_size must be a number')

  const request: PlanRequest = {
    engagement_id: typeof body.engagement_id === 'string' ? body.engagement_id : undefined,
    objective,
    domain,
    duration_weeks: durationWeeks,
    team_size: teamSize,
    budget_dkk: typeof body.budget_dkk === 'number' ? body.budget_dkk : undefined,
  }

  try {
    const plan = await generatePlan(request)
    res.json({ success: true, data: plan })
  } catch (err) {
    // v4.0.3: gate rejections map to 422 Unprocessable Entity with specific code.
    if (err instanceof PlanGateRejection) {
      logger.warn({ code: err.code, reason: err.reason, details: err.details }, 'Engagement plan: gate rejection')
      res.status(422).json({
        success: false,
        error: {
          code: err.code,
          message: err.reason,
          details: err.details,
          status_code: 422,
        },
      })
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    logger.warn({ error: message }, 'Engagement plan failed')
    res.status(500).json({
      success: false,
      error: { code: 'PLAN_FAILED', message, status_code: 500 },
    })
  }
})

// ─── GET /:id — Single engagement ───────────────────────────────────────────

engagementsRouter.get('/:id', async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id)
  const engagement = await getEngagement(id)
  if (!engagement) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Engagement not found', status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: engagement })
})

engagementsRouter.get('/:id/context', async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id)
  const engagement = await getEngagement(id)
  if (!engagement) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Engagement not found', status_code: 404 },
    })
    return
  }

  try {
    const [plan, outcome, deliverables, artifacts] = await Promise.all([
      getPlan(id),
      getOutcome(id),
      listDeliverablesForEngagement(id, 8),
      listArtifactsForEngagement(id, 8),
    ])

    res.json({
      success: true,
      data: {
        engagement,
        plan,
        outcome,
        deliverables,
        artifacts,
      },
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'CONTEXT_FAILED', message: err instanceof Error ? err.message : String(err), status_code: 500 },
    })
  }
})

engagementsRouter.get('/:id/intelligence', async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id)
  const engagement = await getEngagement(id)
  if (!engagement) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Engagement not found', status_code: 404 },
    })
    return
  }

  try {
    const [deliverables, artifacts, recommendation, plan] = await Promise.all([
      listDeliverablesForEngagement(id, 8),
      listArtifactsForEngagement(id, 8),
      recommendPhantomSkillLoop(engagement.objective, engagement.domain),
      getPlan(id),
    ])

    const recommendedNextAction =
      deliverables.length === 0
        ? {
            label: 'Generate deliverable',
            route: '/deliverable/draft',
            rationale: 'This engagement has no linked deliverable yet, so the next trustworthy move is to materialize the first client-facing output.',
          }
        : artifacts.length === 0
          ? {
              label: 'Send artifact to Obsidian',
              route: '/obsidian',
              rationale: 'The engagement has a deliverable but no deep-work artifact lineage yet. Materialization closes the consultant loop.',
            }
          : recommendation.recommended_loop.id === 'standard_to_implementation'
            ? {
                label: 'Move to Project Board',
                route: '/project-board',
                rationale: 'Coverage and runtime confidence are strong enough to convert recommendations into accountable execution.',
              }
            : recommendation.recommended_loop.id === 'research_to_standard' || recommendation.recommended_loop.id === 'harvest_to_pattern_library'
              ? {
                  label: 'Expand evidence in Knowledge',
                  route: '/knowledge',
                  rationale: 'The evidence pattern suggests that discovery or standardization should continue before more delivery work.',
                }
              : {
                  label: 'Inspect Adoption Loop',
                  route: '/adoption',
                  rationale: 'The best next move is to inspect reuse, pattern ranking, and adoption telemetry before acting further.',
                }

    res.json({
      success: true,
      data: {
        engagement_id: id,
        framework_map: [
          ...engagement.methodology_refs.map((framework) => ({
            title: framework,
            kind: 'methodology_ref',
            rationale: 'Explicitly declared on the engagement object.',
          })),
          {
            title: `${engagement.domain} operating profile`,
            kind: 'domain_profile',
            rationale: 'Derived from the engagement domain for routing and framework framing.',
          },
        ],
        recommendation,
        recommended_next_action: recommendedNextAction,
        proof_state: {
          has_plan: !!plan,
          deliverables_count: deliverables.length,
          artifacts_count: artifacts.length,
        },
      },
    })
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTELLIGENCE_FAILED', message: err instanceof Error ? err.message : String(err), status_code: 500 },
    })
  }
})

// ─── GET /:id/plan — Retrieve stored plan ───────────────────────────────────

engagementsRouter.get('/:id/plan', async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id)
  const plan = await getPlan(id)
  if (!plan) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Plan not found — call POST /plan first', status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: plan })
})

// ─── POST /:id/outcome — Record outcome ─────────────────────────────────────

engagementsRouter.post('/:id/outcome', async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id)
  const body = req.body as Record<string, unknown>

  const grade = body.grade as string
  const actualEndDate = body.actual_end_date as string
  const whatWentWell = body.what_went_well as string
  const whatWentWrong = body.what_went_wrong as string
  const recordedBy = body.recorded_by as string

  if (!VALID_GRADES.includes(grade as OutcomeGrade)) return badRequest(res, `grade must be one of: ${VALID_GRADES.join(', ')}`)
  if (!isIsoDate(actualEndDate)) return badRequest(res, 'actual_end_date must be ISO date')
  if (!whatWentWell || typeof whatWentWell !== 'string') return badRequest(res, 'what_went_well required')
  if (!whatWentWrong || typeof whatWentWrong !== 'string') return badRequest(res, 'what_went_wrong required')
  if (!recordedBy || typeof recordedBy !== 'string') return badRequest(res, 'recorded_by required')

  const deliverablesShipped = Array.isArray(body.deliverables_shipped)
    ? (body.deliverables_shipped as unknown[]).filter(x => typeof x === 'string').map(String)
    : []

  const request: RecordOutcomeRequest = {
    engagement_id: id,
    actual_end_date: actualEndDate,
    grade: grade as OutcomeGrade,
    deliverables_shipped: deliverablesShipped,
    what_went_well: whatWentWell,
    what_went_wrong: whatWentWrong,
    precedent_match_accuracy: typeof body.precedent_match_accuracy === 'number' ? body.precedent_match_accuracy : undefined,
    recorded_by: recordedBy,
  }

  try {
    const outcome = await recordOutcome(request)
    res.status(201).json({ success: true, data: outcome })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('not found') ? 404 : 500
    res.status(status).json({
      success: false,
      error: { code: status === 404 ? 'NOT_FOUND' : 'OUTCOME_FAILED', message, status_code: status },
    })
  }
})

// ─── GET /:id/outcome — Retrieve outcome ────────────────────────────────────

engagementsRouter.get('/:id/outcome', async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id)
  const outcome = await getOutcome(id)
  if (!outcome) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Outcome not recorded', status_code: 404 },
    })
    return
  }
  res.json({ success: true, data: outcome })
})
