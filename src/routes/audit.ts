/**
 * routes/audit.ts — Audit log query endpoints
 */
import { Router } from 'express'
import { getAuditLog } from '../audit.js'

export const auditRouter = Router()

auditRouter.get('/log', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
  const offset = parseInt(req.query.offset as string) || 0
  const entries = await getAuditLog(limit, offset)

  // Optional filtering
  const actor = req.query.actor as string
  const action = req.query.action as string
  const entityType = req.query.entity_type as string

  let filtered = entries
  if (actor) filtered = filtered.filter(e => e.actor === actor)
  if (action) filtered = filtered.filter(e => e.action === action)
  if (entityType) filtered = filtered.filter(e => e.entity_type === entityType)

  res.json({ success: true, data: { entries: filtered, total: filtered.length, limit, offset } })
})
