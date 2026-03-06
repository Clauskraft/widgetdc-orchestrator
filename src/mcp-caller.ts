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
import { childLogger } from './logger.js'

interface McpCallOptions {
  toolName: string
  args: Record<string, unknown>
  callId: string
  traceId?: string
  timeoutMs?: number
}

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

export async function callMcpTool(opts: McpCallOptions): Promise<OrchestratorToolResult> {
  const log = childLogger(opts.traceId ?? opts.callId)
  const t0 = Date.now()
  const timeoutMs = opts.timeoutMs ?? config.mcpTimeoutMs

  const url = `${config.backendUrl}/api/mcp/route`
  const body = JSON.stringify({ tool: opts.toolName, payload: opts.args })

  log.debug({ tool: opts.toolName, url }, 'MCP call start')

  // Retry loop for transient CDN 503 errors
  let lastError: string | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      log.debug({ attempt, tool: opts.toolName }, 'Retrying after transient error')
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt))
    }

    const result = await callMcpToolOnce(opts, url, body, timeoutMs, log, t0)
    if (result.status !== 'error' || !result.error_message?.includes('503')) {
      return result
    }
    lastError = result.error_message
  }

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
}

async function callMcpToolOnce(
  opts: McpCallOptions, url: string, body: string,
  timeoutMs: number, log: ReturnType<typeof childLogger>, t0: number
): Promise<OrchestratorToolResult> {
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
      // Plain JSON response
      const raw = await res.text()
      let result: unknown
      try {
        const parsed = JSON.parse(raw)
        // Unwrap common envelope shapes
        result = parsed?.result ?? parsed?.data ?? parsed
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
