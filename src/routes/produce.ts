/**
 * routes/produce.ts — /produce gateway (W4 of SYSTEM_WIRING_PLAN.md)
 *
 * Plugin-facing entrypoint for "produce a world-class artifact":
 *
 *   POST /produce                    — kick off a /api/mrp/produce run
 *   GET  /produce/:order_id/status   — proxy :ProductionOrder lookup
 *   GET  /produce/:order_id/artifact — stream composer output (DOCX/PPTX/PDF)
 *
 * Gating: selectProfile() picks read_only / staged_write / production_write
 * based on product_type + compliance_tier.  read_only skips approval; writes
 * create a HyperAgent plan that the client can approve via /approve/:planId
 * (see routes/hyperagent.ts).
 */
import { Router, Request, Response } from 'express'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { createPlan } from '../hyperagent/hyperagent.js'
import { selectProfile, type ProduceRequestLike, type RequestFeaturesLike } from '../hyperagent/policy-profile.js'

export const produceRouter = Router()

// ─── POST /produce ────────────────────────────────────────────────────────

produceRouter.post('/produce', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown> | undefined
  const productType = body?.product_type as ProduceRequestLike['product_type']
  const features = (body?._request_features ?? {}) as RequestFeaturesLike

  if (!productType) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Required: product_type', status_code: 400 },
    })
    return
  }

  const profileId = selectProfile({ product_type: productType }, features)
  const sessionId = (body?.agent_id as string | undefined) ?? `produce-${Date.now().toString(36)}`

  // Create HyperAgent plan for governance (always — even read_only gets
  // logged / evaluated).
  let planId: string | undefined
  try {
    const plan = await createPlan(
      `produce ${productType}`,
      sessionId,
      profileId,
      {
        targetServices: ['backend/mrp'],
        successMetrics: `ProductionOrder.closed for product_type=${productType}`,
      },
    )
    planId = plan.planId
    logger.info({ planId, profileId, productType }, 'produce: plan created')
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), profileId }, 'produce: HyperAgent plan creation failed, falling through')
    // Fall through — backend still runs, but plan/kpi linkage is lost.
  }

  // Forward to backend /api/mrp/produce.
  try {
    const upstream = await fetch(`${config.backendUrl}/api/mrp/produce`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({ ...body, _orchestrator_plan_id: planId, _profile: profileId }),
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      res.status(upstream.status).json({
        success: false,
        error: { code: 'UPSTREAM_ERROR', message: `backend returned ${upstream.status}`, details: errText.slice(0, 500), status_code: upstream.status },
        planId,
      })
      return
    }

    const upstreamBody = (await upstream.json()) as Record<string, unknown>
    res.json({
      success: true,
      planId,
      profileId,
      ...upstreamBody,
    })
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), planId }, 'produce: upstream fetch failed')
    res.status(502).json({
      success: false,
      error: { code: 'UPSTREAM_UNREACHABLE', message: 'Backend unreachable', status_code: 502 },
      planId,
    })
  }
})

// ─── GET /produce/:order_id/status ───────────────────────────────────────

produceRouter.get('/produce/:order_id/status', async (req: Request, res: Response) => {
  const orderId = req.params.order_id
  if (!orderId || orderId.length > 100) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid order_id' } })
    return
  }

  try {
    const upstream = await fetch(`${config.backendUrl}/api/mrp/order/${encodeURIComponent(orderId)}/status`, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.backendApiKey}` },
    })
    if (!upstream.ok) {
      res.status(upstream.status).json({
        success: false,
        error: { code: 'UPSTREAM_ERROR', message: `backend returned ${upstream.status}`, status_code: upstream.status },
      })
      return
    }
    const body = await upstream.json() as Record<string, unknown>
    res.json({ success: true, ...body })
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), orderId }, 'produce-status: fetch failed')
    res.status(502).json({ success: false, error: { code: 'UPSTREAM_UNREACHABLE', message: 'Backend unreachable' } })
  }
})

// ─── GET /produce/:order_id/artifact ─────────────────────────────────────

produceRouter.get('/produce/:order_id/artifact', async (req: Request, res: Response) => {
  const orderId = req.params.order_id
  if (!orderId || orderId.length > 100) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid order_id' } })
    return
  }

  try {
    const upstream = await fetch(`${config.backendUrl}/api/mrp/order/${encodeURIComponent(orderId)}/artifact`, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.backendApiKey}` },
    })
    if (!upstream.ok) {
      res.status(upstream.status).json({
        success: false,
        error: { code: 'UPSTREAM_ERROR', message: `backend returned ${upstream.status}`, status_code: upstream.status },
      })
      return
    }
    // Proxy binary payload to the client.
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    const contentDisposition = upstream.headers.get('content-disposition')
    res.setHeader('content-type', contentType)
    if (contentDisposition) res.setHeader('content-disposition', contentDisposition)
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.send(buf)
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), orderId }, 'produce-artifact: fetch failed')
    res.status(502).json({ success: false, error: { code: 'UPSTREAM_UNREACHABLE', message: 'Backend unreachable' } })
  }
})
