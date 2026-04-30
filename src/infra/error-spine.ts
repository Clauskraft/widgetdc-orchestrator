import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { logger } from '../logger.js'
import { v4 as uuid } from 'uuid'

export type ErrorSpineEventType =
  | 'tool_failed'
  | 'unhandled_rejection'
  | 'uncaught_exception'
  | 'route_failed'
  | 'boot_warning'

export interface ErrorSpineEvent {
  type: ErrorSpineEventType
  timestamp: string
  source: string
  correlation_id: string
  tool_name?: string
  route?: string
  error_class: string
  error_message: string
  stack?: string
  actor_id?: string
  workflow_id?: string
  plan_id?: string
  severity?: 'warning' | 'error' | 'fatal'
  metadata?: Record<string, unknown>
}

export function newCorrelationId(): string {
  return uuid()
}

export function classifyError(err: unknown): string {
  if (err instanceof Error && err.name) return err.name
  if (typeof err === 'object' && err && 'code' in err) return String((err as { code?: unknown }).code)
  return 'Error'
}

export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined
}

const eventFile = process.env.ERROR_SPINE_FILE ?? 'tmp/error-spine-events.ndjson'

async function appendDurable(event: ErrorSpineEvent): Promise<void> {
  const dir = path.dirname(eventFile)
  await mkdir(dir, { recursive: true })
  await appendFile(eventFile, `${JSON.stringify(event)}\n`, 'utf8')
}

export async function persistErrorEvent(event: Omit<ErrorSpineEvent, 'timestamp'> & { timestamp?: string }): Promise<ErrorSpineEvent> {
  const enriched: ErrorSpineEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  }

  // File-backed NDJSON gives deterministic local/CI proof. Production can replace this
  // adapter with Postgres spine_events without changing callers.
  await appendDurable(enriched)
  logger.error({ error_spine: enriched }, 'ErrorSpine event persisted')
  return enriched
}

export async function captureFailure(input: {
  type: ErrorSpineEventType
  source: string
  error: unknown
  correlation_id?: string
  tool_name?: string
  route?: string
  actor_id?: string
  workflow_id?: string
  plan_id?: string
  severity?: ErrorSpineEvent['severity']
  metadata?: Record<string, unknown>
}): Promise<ErrorSpineEvent> {
  return persistErrorEvent({
    type: input.type,
    source: input.source,
    correlation_id: input.correlation_id ?? newCorrelationId(),
    tool_name: input.tool_name,
    route: input.route,
    actor_id: input.actor_id,
    workflow_id: input.workflow_id,
    plan_id: input.plan_id,
    error_class: classifyError(input.error),
    error_message: safeErrorMessage(input.error),
    stack: errorStack(input.error),
    severity: input.severity ?? 'error',
    metadata: input.metadata,
  })
}

export function installGlobalErrorSpine(): void {
  process.on('unhandledRejection', (reason) => {
    void captureFailure({
      type: 'unhandled_rejection',
      source: 'process',
      error: reason,
      severity: 'fatal',
    }).finally(() => {
      // Keep process alive for now: existing runtime has non-fatal boot restores.
      // A later enforce-mode can exit(1) for production_write contexts.
    })
  })

  process.on('uncaughtException', (err) => {
    void captureFailure({
      type: 'uncaught_exception',
      source: 'process',
      error: err,
      severity: 'fatal',
    }).finally(() => process.exit(1))
  })
}

export async function withErrorSpine<T>(input: {
  source: string
  tool_name?: string
  route?: string
  correlation_id?: string
  metadata?: Record<string, unknown>
  run: () => Promise<T>
}): Promise<T> {
  try {
    return await input.run()
  } catch (err) {
    await captureFailure({
      type: input.tool_name ? 'tool_failed' : 'route_failed',
      source: input.source,
      tool_name: input.tool_name,
      route: input.route,
      correlation_id: input.correlation_id,
      metadata: input.metadata,
      error: err,
    })
    throw err
  }
}
