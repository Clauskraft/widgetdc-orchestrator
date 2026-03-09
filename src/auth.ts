/**
 * auth.ts — API key authentication middleware.
 * If ORCHESTRATOR_API_KEY is set, all mutating endpoints require it.
 * GET /health and GET / are always public.
 */
import type { Request, Response, NextFunction } from 'express'
import { config } from './config.js'
import { logger } from './logger.js'

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // If no API key configured, allow all (dev mode)
  if (!config.orchestratorApiKey) {
    next()
    return
  }

  const authHeader = req.headers['authorization'] ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  // Also accept x-api-key header or query param (needed for SSE EventSource)
  const apiKeyHeader = (req.headers['x-api-key'] ?? '') as string
  const queryKey = (req.query['api_key'] ?? '') as string

  if (token === config.orchestratorApiKey || apiKeyHeader === config.orchestratorApiKey || queryKey === config.orchestratorApiKey) {
    next()
    return
  }

  logger.warn({ path: req.path, ip: req.ip }, 'Unauthorized request')
  res.status(401).json({
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Valid API key required. Use Authorization: Bearer <key> or X-API-Key header.', status_code: 401 },
  })
}
