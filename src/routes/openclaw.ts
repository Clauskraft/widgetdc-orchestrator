/**
 * routes/openclaw.ts — Intelligent proxy to OpenClaw gateway
 *
 * Features:
 *   1. Health cache — polls /healthz every 60s, exports isOpenClawHealthy()
 *   2. Skill discovery — fetches skill manifest at boot, exports getOpenClawSkills()
 *   3. Circuit breaker — 3 consecutive failures → unhealthy, auto-reset after 30s
 *   4. Generic proxy with timeout + structured errors
 */
import { Router } from 'express'
import { config } from '../config.js'
import { logger } from '../logger.js'

export const openclawRouter = Router()

// ─── Health cache ────────────────────────────────────────────────────────────

let healthStatus: { healthy: boolean; checkedAt: string; latencyMs: number; error?: string } = {
  healthy: false,
  checkedAt: new Date().toISOString(),
  latencyMs: 0,
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

let consecutiveFailures = 0
const CIRCUIT_THRESHOLD = 3
const CIRCUIT_RESET_MS = 30_000
let circuitOpenUntil = 0

function recordSuccess(): void {
  consecutiveFailures = 0
  circuitOpenUntil = 0
}

function recordFailure(): void {
  consecutiveFailures++
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_RESET_MS
    logger.warn({ failures: consecutiveFailures }, 'OpenClaw circuit breaker OPEN')
  }
}

function isCircuitOpen(): boolean {
  if (circuitOpenUntil === 0) return false
  if (Date.now() > circuitOpenUntil) {
    // Auto-reset
    circuitOpenUntil = 0
    consecutiveFailures = 0
    logger.info('OpenClaw circuit breaker RESET (auto)')
    return false
  }
  return true
}

// ─── Skill manifest cache ────────────────────────────────────────────────────

interface OpenClawSkill {
  name: string
  description?: string
  tool_count?: number
}

let skillManifest: OpenClawSkill[] = []
let skillsFetchedAt = ''

/** Fetch skill manifest from OpenClaw */
async function fetchSkills(): Promise<void> {
  const openclawUrl = config.openclawUrl
  if (!openclawUrl) return

  try {
    const token = config.openclawToken
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${openclawUrl}/setup/api/status`, {
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (res.ok) {
      const data = await res.json() as Record<string, unknown>
      // Extract skills from status response
      const skills = (data.skills ?? data.available_skills ?? []) as OpenClawSkill[]
      if (Array.isArray(skills)) {
        skillManifest = skills
        skillsFetchedAt = new Date().toISOString()
        logger.info({ count: skills.length }, 'OpenClaw skills discovered')
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'OpenClaw skill discovery failed (non-fatal)')
  }
}

/** Poll OpenClaw health */
async function pollHealth(): Promise<void> {
  const openclawUrl = config.openclawUrl
  if (!openclawUrl) {
    healthStatus = { healthy: false, checkedAt: new Date().toISOString(), latencyMs: 0, error: 'OPENCLAW_URL not configured' }
    return
  }

  const start = Date.now()
  try {
    const token = config.openclawToken
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${openclawUrl}/healthz`, {
      headers,
      signal: AbortSignal.timeout(5000),
    })

    const latencyMs = Date.now() - start
    healthStatus = {
      healthy: res.ok,
      checkedAt: new Date().toISOString(),
      latencyMs,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    }

    if (res.ok) recordSuccess()
    else recordFailure()
  } catch (err) {
    healthStatus = {
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      error: String(err),
    }
    recordFailure()
  }
}

// ─── Exported state accessors ────────────────────────────────────────────────

export function isOpenClawHealthy(): boolean {
  return healthStatus.healthy && !isCircuitOpen()
}

export function getOpenClawHealth() {
  return { ...healthStatus, circuit_open: isCircuitOpen(), consecutive_failures: consecutiveFailures }
}

export function getOpenClawSkills(): { skills: OpenClawSkill[]; fetched_at: string } {
  return { skills: skillManifest, fetched_at: skillsFetchedAt }
}

/** Boot-time init: fetch skills + start health polling */
export function initOpenClaw(): void {
  if (!config.openclawUrl) {
    logger.info('OpenClaw not configured — skipping init')
    return
  }

  // Initial health check + skill discovery
  pollHealth()
  fetchSkills()

  // Poll health every 60 seconds
  setInterval(pollHealth, 60_000)

  // Refresh skills every 5 minutes
  setInterval(fetchSkills, 5 * 60_000)
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/** GET /skills — Discovered skill manifest */
openclawRouter.get('/skills', (_req, res) => {
  res.json({ success: true, data: getOpenClawSkills() })
})

/** GET /health — OpenClaw health status */
openclawRouter.get('/health', (_req, res) => {
  const health = getOpenClawHealth()
  res.status(health.healthy ? 200 : 503).json({ success: health.healthy, data: health })
})

/** ALL /proxy/* — Generic proxy with circuit breaker + timeout */
openclawRouter.all('/proxy/*', async (req, res) => {
  const openclawUrl = config.openclawUrl
  if (!openclawUrl) {
    res.status(503).json({ success: false, error: { code: 'NOT_CONFIGURED', message: 'OPENCLAW_URL not configured', status_code: 503 } })
    return
  }

  if (isCircuitOpen()) {
    res.status(503).json({
      success: false,
      error: {
        code: 'CIRCUIT_OPEN',
        message: `OpenClaw circuit breaker open (${consecutiveFailures} consecutive failures). Auto-reset in ${Math.ceil((circuitOpenUntil - Date.now()) / 1000)}s.`,
        status_code: 503,
      },
    })
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
      signal: AbortSignal.timeout(30000),
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOpts.body = JSON.stringify(req.body)
    }

    const response = await fetch(`${openclawUrl}/${targetPath}`, fetchOpts)
    const contentType = response.headers.get('content-type') ?? ''

    recordSuccess()

    if (contentType.includes('application/json')) {
      const data = await response.json()
      res.status(response.status).json(data)
    } else {
      const text = await response.text()
      res.status(response.status).type(contentType).send(text)
    }
  } catch (err) {
    recordFailure()
    logger.warn({ err: String(err), path: targetPath, failures: consecutiveFailures }, 'OpenClaw proxy error')
    res.status(502).json({
      success: false,
      error: {
        code: 'GATEWAY_ERROR',
        message: 'OpenClaw gateway unreachable',
        details: String(err),
        status_code: 502,
      },
    })
  }
})
