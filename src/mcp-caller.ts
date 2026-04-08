/**
 * mcp-caller.ts — Calls the WidgeTDC Railway MCP backend.
 *
 * The backend exposes MCP tools via:
 *   POST /mcp/route  { tool: string, payload: object }
 *   Authorization: Bearer <BACKEND_API_KEY>
 *
 * It returns either:
 *   { result: any }          — immediate response
 *   SSE stream               — streaming response (aggregated here)
 *
 * This module handles both cases and always returns a plain object.
 */
import type { OrchestratorToolResult } from '@widgetdc/contracts/orchestrator'
import { config } from './config.js'
import { childLogger, logger } from './logger.js'
import { validateBeforeMerge } from './write-gate.js'
import { withMcpSpan } from './tracing.js'

interface McpCallOptions {
  toolName: string
  args: Record<string, unknown>
  callId: string
  traceId?: string
  timeoutMs?: number
}

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

// ─── Rate-Limit Backpressure ────────────────────────────────────────────────
// Adaptive throttle: when 429s spike, introduce increasing delay before calls.
// Prevents thundering-herd retry storms like the CANVAS 820-call cascade.
const RL_WINDOW_MS = 10_000       // 10s sliding window
const RL_THRESHOLD = 5            // 5 rate-limits in window → start throttling
const RL_MAX_DELAY_MS = 30_000    // max 30s backoff
const RL_DECAY_FACTOR = 0.8       // shrink delay each window without new 429s

let _rlTimestamps: number[] = []   // timestamps of recent 429 responses
let _rlDelayMs = 0                 // current adaptive delay
let _rlLastDecay = Date.now()

function recordRateLimit(): void {
  const now = Date.now()
  _rlTimestamps.push(now)
  // Trim old entries
  _rlTimestamps = _rlTimestamps.filter(t => now - t < RL_WINDOW_MS)
  // If over threshold, increase delay exponentially
  if (_rlTimestamps.length >= RL_THRESHOLD) {
    _rlDelayMs = Math.min(_rlDelayMs === 0 ? 1000 : _rlDelayMs * 2, RL_MAX_DELAY_MS)
    if (_rlDelayMs >= 5000) {
      logger.warn({ delay_ms: _rlDelayMs, count_in_window: _rlTimestamps.length },
        'MCP rate-limit backpressure: throttling all calls')
    }
  }
}

function decayRateLimitDelay(): void {
  const now = Date.now()
  if (now - _rlLastDecay > RL_WINDOW_MS && _rlDelayMs > 0) {
    _rlTimestamps = _rlTimestamps.filter(t => now - t < RL_WINDOW_MS)
    if (_rlTimestamps.length < RL_THRESHOLD) {
      _rlDelayMs = Math.floor(_rlDelayMs * RL_DECAY_FACTOR)
      if (_rlDelayMs < 200) _rlDelayMs = 0
    }
    _rlLastDecay = now
  }
}

async function applyBackpressure(): Promise<void> {
  decayRateLimitDelay()
  if (_rlDelayMs > 0) {
    await new Promise(r => setTimeout(r, _rlDelayMs + Math.floor(Math.random() * 500)))
  }
}

export function getRateLimitState() {
  return {
    current_delay_ms: _rlDelayMs,
    hits_in_window: _rlTimestamps.length,
    threshold: RL_THRESHOLD,
    window_ms: RL_WINDOW_MS,
  }
}

// ─── Backend Circuit Breaker ─────────────────────────────────────────────────
// When backend is down (502/timeout), fail fast instead of queueing 20+ cron
// jobs that each wait 10-15s for a timeout. Pattern matches openclaw.ts.
const BACKEND_CB_THRESHOLD = 5       // consecutive failures before opening
const BACKEND_CB_COOLDOWN_MS = 60_000 // 60s cooldown before probe
let _backendFailures = 0
let _backendCircuitOpenUntil = 0
let _backendCircuitLoggedAt = 0

function backendRecordSuccess(): void {
  if (_backendFailures > 0) {
    logger.info({ previous_failures: _backendFailures }, 'Backend circuit breaker CLOSED — backend recovered')
  }
  _backendFailures = 0
  _backendCircuitOpenUntil = 0
}

function backendRecordFailure(): void {
  _backendFailures++
  if (_backendFailures >= BACKEND_CB_THRESHOLD && _backendCircuitOpenUntil === 0) {
    _backendCircuitOpenUntil = Date.now() + BACKEND_CB_COOLDOWN_MS
    logger.warn({ failures: _backendFailures, cooldown_s: BACKEND_CB_COOLDOWN_MS / 1000 },
      'Backend circuit breaker OPEN — failing fast for all MCP calls')
  }
}

function isBackendCircuitOpen(): boolean {
  if (_backendCircuitOpenUntil === 0) return false
  if (Date.now() > _backendCircuitOpenUntil) {
    // Cooldown expired — allow one probe call through
    _backendCircuitOpenUntil = 0
    logger.info('Backend circuit breaker HALF-OPEN — allowing probe call')
    return false
  }
  return true
}

export function getBackendCircuitState() {
  return {
    failures: _backendFailures,
    open: _backendCircuitOpenUntil > 0,
    cooldown_remaining_ms: Math.max(0, _backendCircuitOpenUntil - Date.now()),
  }
}

// F2: Cached audit.lessons — prevents hydration warning spam from backend.
let _auditLessonsCache: { data: unknown; fetchedAt: number } | null = null
const AUDIT_LESSONS_TTL_MS = 10 * 60 * 1000

async function ensureAuditLessonsRead(): Promise<void> {
  const now = Date.now()
  if (_auditLessonsCache && now - _auditLessonsCache.fetchedAt < AUDIT_LESSONS_TTL_MS) return
  if (isBackendCircuitOpen()) return // don't waste time if backend is down

  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.backendApiKey}`,
        'X-Call-Id': 'audit-lessons-prefetch',
      },
      body: JSON.stringify({ tool: 'audit.lessons', payload: {} }),
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const parsed = await res.json().catch(() => null) as Record<string, unknown> | null
      _auditLessonsCache = { data: parsed?.result ?? parsed, fetchedAt: now }
    }
  } catch {
    // Non-fatal — write calls proceed regardless
  }
}

// Tools that have local implementations in tool-executor.ts — execute locally instead of remote MCP
const LOCAL_TOOLS = new Set([
  'memory_store', 'memory_retrieve', 'adaptive_rag_reward',
  'critique_refine', 'context_fold', 'failure_harvest',
])

export async function callMcpTool(opts: McpCallOptions): Promise<OrchestratorToolResult> {
  // Local-first: if tool has a local executor case, run it locally (avoids 404 on backend)
  if (LOCAL_TOOLS.has(opts.toolName)) {
    const t0 = Date.now()
    try {
      const { executeToolUnified } = await import('./tool-executor.js')
      const result = await executeToolUnified(opts.toolName, opts.args, { call_id: opts.callId, fold: false })
      return {
        call_id: opts.callId,
        status: result.error ? 'error' : 'success',
        result: result.error ? null : result.result,
        error_message: result.error ?? null,
        error_code: result.error ? 'LOCAL_ERROR' : null,
        duration_ms: Date.now() - t0,
        trace_id: opts.traceId ?? null,
        completed_at: new Date().toISOString(),
      }
    } catch (err) {
      return {
        call_id: opts.callId,
        status: 'error',
        result: null,
        error_message: `Local execution failed: ${err instanceof Error ? err.message : String(err)}`,
        error_code: 'LOCAL_ERROR',
        duration_ms: Date.now() - t0,
        trace_id: opts.traceId ?? null,
        completed_at: new Date().toISOString(),
      }
    }
  }

  return withMcpSpan(opts.toolName, opts.callId, async (span) => {
    const log = childLogger(opts.traceId ?? opts.callId)
    const t0 = Date.now()
    const timeoutMs = opts.timeoutMs ?? config.mcpTimeoutMs

    // Backend circuit breaker — fail fast when backend is known-down
    if (isBackendCircuitOpen()) {
      const now = Date.now()
      // Log at most once per 30s to avoid spam
      if (now - _backendCircuitLoggedAt > 30_000) {
        _backendCircuitLoggedAt = now
        log.warn({ tool: opts.toolName, cooldown_remaining_ms: _backendCircuitOpenUntil - now },
          'Backend circuit breaker OPEN — fast-failing MCP call')
      }
      span.setAttribute('mcp.circuit_breaker', 'open')
      return {
        call_id: opts.callId,
        status: 'error',
        result: null,
        error_message: `Backend circuit breaker open (${_backendFailures} consecutive failures). Retrying in ${Math.ceil((_backendCircuitOpenUntil - now) / 1000)}s.`,
        error_code: 'BACKEND_ERROR',
        duration_ms: 0,
        trace_id: opts.traceId ?? null,
        completed_at: new Date().toISOString(),
      }
    }

    const url = `${config.backendUrl}/api/mcp/route`
    // Strip internal _force sentinel before sending to backend
    const { _force: _stripForce, ...wireArgs } = opts.args
    const body = JSON.stringify({ tool: opts.toolName, payload: wireArgs })

    log.debug({ tool: opts.toolName, url }, 'MCP call start')

    // B-1: Write-path circuit breaker — intercept graph.write_cypher
    if (opts.toolName === 'graph.write_cypher') {
      // F2: Read audit.lessons before writing (cached, non-blocking)
      await ensureAuditLessonsRead()

      const query = typeof opts.args.query === 'string' ? opts.args.query : ''
      const params = (opts.args.params as Record<string, unknown>) ?? opts.args
      const force = opts.args._force === true
      const validation = validateBeforeMerge(query, params, force)
      if (!validation.allowed) {
        span.setAttribute('mcp.write_gate', 'rejected')
        span.setAttribute('mcp.rejection_reason', validation.reason ?? 'unknown')
        return {
          call_id: opts.callId,
          status: 'error',
          result: null,
          error_message: `Write-path validation rejected: ${validation.reason}`,
          error_code: 'VALIDATION_REJECTED',
          duration_ms: Date.now() - t0,
          trace_id: opts.traceId ?? null,
          completed_at: new Date().toISOString(),
        }
      }
    }

    // Retry loop for transient CDN 503 errors
    let lastError: string | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        span.setAttribute('mcp.retry_attempt', attempt)
        log.debug({ attempt, tool: opts.toolName }, 'Retrying after transient error')
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt))
      }

      const result = await callMcpToolOnce(opts, url, body, timeoutMs, log, t0)

      // Track backend health for circuit breaker
      const isTransientError = result.status === 'error' || result.status === 'timeout'
      const is502 = result.error_message?.includes('502') || result.error_message?.includes('503')
      const isTimeout = result.status === 'timeout'

      if (isTransientError && (is502 || isTimeout)) {
        backendRecordFailure()
      } else if (result.status === 'success') {
        backendRecordSuccess()
      }

      if (result.status !== 'error' || !result.error_message?.includes('503')) {
        span.setAttribute('mcp.status', result.status)
        span.setAttribute('mcp.duration_ms', result.duration_ms)
        return result
      }
      lastError = result.error_message
    }

    span.setAttribute('mcp.status', 'error')
    span.setAttribute('mcp.retries_exhausted', true)
    return {
      call_id: opts.callId,
      status: 'error',
      result: null,
      error_message: `Failed after ${MAX_RETRIES + 1} attempts: ${lastError}`,
      error_code: 'BACKEND_ERROR',
      duration_ms: Date.now() - t0,
      trace_id: opts.traceId ?? null,
      completed_at: new Date().toISOString(),
    }
  })
}

async function callMcpToolOnce(
  opts: McpCallOptions, url: string, body: string,
  timeoutMs: number, log: ReturnType<typeof childLogger>, t0: number
): Promise<OrchestratorToolResult> {
  // Rate-limit backpressure: delay if 429 storm detected
  await applyBackpressure()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.backendApiKey}`,
        'X-Trace-Id': opts.traceId ?? opts.callId,
        'X-Call-Id': opts.callId,
      },
      body,
      signal: controller.signal,
    })

    clearTimeout(timer)

    const duration_ms = Date.now() - t0

    if (!res.ok) {
      const errorText = await res.text().catch(() => `HTTP ${res.status}`)
      log.warn({ status: res.status, tool: opts.toolName, duration_ms }, 'MCP call HTTP error')

      // Record 429 for backpressure system
      if (res.status === 429) recordRateLimit()

      // Map HTTP status to error code
      const errorCode = res.status === 401 || res.status === 403
        ? 'UNAUTHORIZED'
        : res.status === 404
        ? 'TOOL_NOT_FOUND'
        : res.status === 429
        ? 'RATE_LIMITED'
        : 'BACKEND_ERROR'

      return {
        call_id: opts.callId,
        status: errorCode === 'UNAUTHORIZED' ? 'unauthorized' : errorCode === 'RATE_LIMITED' ? 'rate_limited' : 'error',
        result: null,
        error_message: errorText,
        error_code: errorCode as OrchestratorToolResult['error_code'],
        duration_ms,
        trace_id: opts.traceId ?? null,
        completed_at: new Date().toISOString(),
      }
    }

    // Check if the response is SSE or JSON
    const contentType = res.headers.get('content-type') ?? ''

    if (contentType.includes('text/event-stream')) {
      // Aggregate SSE stream
      const result = await aggregateSseStream(res, opts.callId, log)
      const final_duration = Date.now() - t0

      log.info({ tool: opts.toolName, duration_ms: final_duration }, 'MCP SSE call complete')

      return {
        call_id: opts.callId,
        status: 'success',
        result,
        error_message: null,
        error_code: null,
        duration_ms: final_duration,
        trace_id: opts.traceId ?? null,
        completed_at: new Date().toISOString(),
      }
    } else {
      // Plain JSON response — strict envelope handling
      const raw = await res.text()
      let result: unknown
      try {
        const parsed = JSON.parse(raw)
        // Backend MCP route returns { result: ... } envelope.
        // Accept { result }, { data }, or raw — but log unexpected shapes.
        if (parsed !== null && typeof parsed === 'object' && 'result' in parsed) {
          result = parsed.result
        } else if (parsed !== null && typeof parsed === 'object' && 'data' in parsed) {
          log.warn({ tool: opts.toolName }, 'MCP response used "data" envelope instead of "result" — consider standardising')
          result = parsed.data
        } else {
          log.warn({ tool: opts.toolName, keys: Object.keys(parsed ?? {}) }, 'MCP response had no standard envelope — passing through raw')
          result = parsed
        }
      } catch {
        result = raw
      }

      log.info({ tool: opts.toolName, duration_ms }, 'MCP JSON call complete')

      return {
        call_id: opts.callId,
        status: 'success',
        result,
        error_message: null,
        error_code: null,
        duration_ms,
        trace_id: opts.traceId ?? null,
        completed_at: new Date().toISOString(),
      }
    }
  } catch (err: unknown) {
    clearTimeout(timer)
    const duration_ms = Date.now() - t0

    if (err instanceof Error && err.name === 'AbortError') {
      log.warn({ tool: opts.toolName, timeout_ms: timeoutMs }, 'MCP call timed out')
      return {
        call_id: opts.callId,
        status: 'timeout',
        result: null,
        error_message: `Call timed out after ${timeoutMs}ms`,
        error_code: 'TIMEOUT',
        duration_ms,
        trace_id: opts.traceId ?? null,
        completed_at: new Date().toISOString(),
      }
    }

    const message = err instanceof Error ? err.message : String(err)
    log.error({ tool: opts.toolName, err: message }, 'MCP call failed')

    return {
      call_id: opts.callId,
      status: 'error',
      result: null,
      error_message: message,
      error_code: 'BACKEND_ERROR',
      duration_ms,
      trace_id: opts.traceId ?? null,
      completed_at: new Date().toISOString(),
    }
  }
}

/**
 * Aggregate an SSE stream into a single result object.
 * Collects all `data:` events and returns the final meaningful payload.
 */
async function aggregateSseStream(
  res: Response,
  callId: string,
  log: ReturnType<typeof childLogger>
): Promise<unknown> {
  const events: unknown[] = []
  let lastResult: unknown = null

  try {
    if (!res.body) {
      throw new Error('SSE response has no body')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue // comment/heartbeat

        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim()
          if (dataStr === '[DONE]' || dataStr === 'done') continue

          try {
            const parsed = JSON.parse(dataStr)
            events.push(parsed)

            // Track last meaningful result
            if (parsed?.result !== undefined) lastResult = parsed.result
            else if (parsed?.content !== undefined) lastResult = parsed.content
            else if (parsed?.type !== 'ping' && parsed?.type !== 'heartbeat') lastResult = parsed
          } catch {
            // Non-JSON data line — treat as text
            if (dataStr.length > 0) lastResult = dataStr
          }
        }
      }
    }

    log.debug({ event_count: events.length, call_id: callId }, 'SSE stream aggregated')

    // Return the most useful shape:
    if (lastResult !== null && lastResult !== undefined) return lastResult
    if (events.length === 1) return events[0]
    if (events.length > 1) return events
    return null
  } catch (err) {
    log.warn({ err: String(err), call_id: callId }, 'SSE stream parse error')
    throw Object.assign(new Error(`SSE_PARSE_ERROR: ${err}`), { code: 'SSE_PARSE_ERROR' })
  }
}
