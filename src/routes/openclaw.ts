/**
 * routes/openclaw.ts — Proxy to OpenClaw gateway
 */
import { Router } from 'express'
import { config } from '../config.js'
import { logger } from '../logger.js'

export const openclawRouter = Router()

openclawRouter.all('/proxy/*', async (req, res) => {
  const openclawUrl = config.openclawUrl
  if (!openclawUrl) {
    res.status(503).json({ success: false, error: 'OPENCLAW_URL not configured' })
    return
  }

  const targetPath = (req.params as Record<string, string>)[0] ?? ''
  const token = config.openclawToken

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const fetchOpts: RequestInit = {
      method: req.method,
      headers,
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOpts.body = JSON.stringify(req.body)
    }

    const response = await fetch(`${openclawUrl}/${targetPath}`, fetchOpts)
    const contentType = response.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
      const data = await response.json()
      res.status(response.status).json(data)
    } else {
      const text = await response.text()
      res.status(response.status).type(contentType).send(text)
    }
  } catch (err) {
    logger.warn({ err: String(err), path: targetPath }, 'OpenClaw proxy error')
    res.status(502).json({ success: false, error: 'OpenClaw gateway unreachable' })
  }
})
