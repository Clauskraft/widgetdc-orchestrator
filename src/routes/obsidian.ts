/**
 * routes/obsidian.ts — Proxy to Obsidian Local REST API plugin (LIN-652)
 *
 * Set OBSIDIAN_API_URL=http://localhost:27123 (or tunnel URL) and
 * OBSIDIAN_API_TOKEN=<your-api-key> in Railway environment variables.
 *
 * Obsidian REST API plugin: https://github.com/coddingtonbear/obsidian-local-rest-api
 */
import { Router } from 'express'
import { config } from '../config.js'
import { logger } from '../logger.js'

export const obsidianRouter = Router()

const TIMEOUT_MS = 8_000

async function obsidianFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const base = config.obsidianUrl.replace(/\/$/, '')
  const url = `${base}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  if (config.obsidianToken) {
    headers['Authorization'] = `Bearer ${config.obsidianToken}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, headers, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Status / config check ────────────────────────────────────────────────────

obsidianRouter.get('/status', async (_req, res) => {
  if (!config.obsidianUrl) {
    return res.status(503).json({
      connected: false,
      error: 'OBSIDIAN_API_URL not configured',
      setup: 'Set OBSIDIAN_API_URL=http://localhost:27123 and OBSIDIAN_API_TOKEN in Railway env vars',
    })
  }
  try {
    const r = await obsidianFetch('/')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json() as Record<string, unknown>
    res.json({ connected: true, ...data })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Obsidian status check failed')
    res.status(503).json({ connected: false, error: err.message })
  }
})

// ─── Vault stats ──────────────────────────────────────────────────────────────

obsidianRouter.get('/vault/stats', async (_req, res) => {
  if (!config.obsidianUrl) return res.status(503).json({ error: 'OBSIDIAN_API_URL not configured' })
  try {
    const r = await obsidianFetch('/vault/')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    res.json(data)
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

// ─── List directory ───────────────────────────────────────────────────────────

obsidianRouter.get('/vault/list', async (req, res) => {
  if (!config.obsidianUrl) return res.status(503).json({ error: 'OBSIDIAN_API_URL not configured' })
  const path = (req.query.path as string) ?? '/'
  try {
    const r = await obsidianFetch(`/vault${path}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    res.json(data)
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

// ─── Search notes ─────────────────────────────────────────────────────────────

obsidianRouter.get('/search', async (req, res) => {
  if (!config.obsidianUrl) return res.status(503).json({ error: 'OBSIDIAN_API_URL not configured' })
  const query = req.query.q as string
  if (!query) return res.status(400).json({ error: 'q parameter required' })
  try {
    const r = await obsidianFetch(`/search/simple/?query=${encodeURIComponent(query)}&contextLength=100`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    res.json(data)
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

// ─── Read note ────────────────────────────────────────────────────────────────

obsidianRouter.get('/note', async (req, res) => {
  if (!config.obsidianUrl) return res.status(503).json({ error: 'OBSIDIAN_API_URL not configured' })
  const path = req.query.path as string
  if (!path) return res.status(400).json({ error: 'path parameter required' })
  try {
    const r = await obsidianFetch(`/vault/${encodeURIComponent(path)}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const content = await r.text()
    res.json({ path, content })
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})

// ─── List tags ────────────────────────────────────────────────────────────────

obsidianRouter.get('/tags', async (_req, res) => {
  if (!config.obsidianUrl) return res.status(503).json({ error: 'OBSIDIAN_API_URL not configured' })
  try {
    // Get all files and extract tags from front matter via search
    const r = await obsidianFetch('/search/simple/?query=%23&contextLength=0')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    res.json(data)
  } catch (err: any) {
    res.status(503).json({ error: err.message })
  }
})
