/**
 * routes/memory.ts — Agent Working Memory API (LIN-582 SNOUT-4).
 *
 * Replaces PostgreSQL WorkingMemoryStore.
 *
 *   POST   /api/memory/store           — Store a memory entry
 *   GET    /api/memory/:agent_id       — List all memories for an agent
 *   GET    /api/memory/:agent_id/:key  — Get a specific memory
 *   DELETE /api/memory/:agent_id/:key  — Delete a specific memory
 *   DELETE /api/memory/:agent_id       — Clear all memories for an agent
 */
import { Router, Request, Response } from 'express'
import { storeMemory, retrieveMemory, listMemories, deleteMemory, clearAgentMemory } from '../memory/working-memory.js'
import { logger } from '../logger.js'

export const memoryRouter = Router()

// ─── POST /store — Store a memory entry ─────────────────────────────────────

memoryRouter.post('/store', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>
  const agentId = body.agent_id as string
  const key = body.key as string
  const value = body.value

  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'agent_id is required', status_code: 400 } })
    return
  }
  if (!key || typeof key !== 'string') {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'key is required', status_code: 400 } })
    return
  }
  if (value === undefined) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'value is required', status_code: 400 } })
    return
  }

  const ttl = typeof body.ttl_seconds === 'number' ? body.ttl_seconds : undefined
  const entry = await storeMemory(agentId, key, value, ttl)

  logger.info({ agentId, key }, 'Working memory stored')
  res.json({ success: true, data: entry })
})

// ─── GET /:agent_id — List all memories ─────────────────────────────────────

memoryRouter.get('/:agent_id', async (req: Request, res: Response) => {
  const agentId = decodeURIComponent(req.params.agent_id)
  const entries = await listMemories(agentId)
  res.json({ success: true, data: { agent_id: agentId, entries, count: entries.length } })
})

// ─── GET /:agent_id/:key — Get specific memory ─────────────────────────────

memoryRouter.get('/:agent_id/:key', async (req: Request, res: Response) => {
  const agentId = decodeURIComponent(req.params.agent_id)
  const key = decodeURIComponent(req.params.key)
  const entry = await retrieveMemory(agentId, key)

  if (!entry) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Memory '${key}' not found for agent '${agentId}'`, status_code: 404 } })
    return
  }

  res.json({ success: true, data: entry })
})

// ─── DELETE /:agent_id/:key — Delete specific memory ────────────────────────

memoryRouter.delete('/:agent_id/:key', async (req: Request, res: Response) => {
  const agentId = decodeURIComponent(req.params.agent_id)
  const key = decodeURIComponent(req.params.key)
  const deleted = await deleteMemory(agentId, key)

  if (!deleted) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Memory '${key}' not found`, status_code: 404 } })
    return
  }

  res.json({ success: true, data: { deleted: true, agent_id: agentId, key } })
})

// ─── DELETE /:agent_id — Clear all agent memories ───────────────────────────

memoryRouter.delete('/:agent_id', async (req: Request, res: Response) => {
  const agentId = decodeURIComponent(req.params.agent_id)
  const count = await clearAgentMemory(agentId)
  logger.info({ agentId, count }, 'Working memory cleared')
  res.json({ success: true, data: { cleared: count, agent_id: agentId } })
})
