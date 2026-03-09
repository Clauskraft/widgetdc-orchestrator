/**
 * validation.ts — TypeBox runtime validation for API boundaries.
 *
 * Uses the contract schemas from @widgetdc/contracts to validate
 * incoming requests at the route level.
 */
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { FormatRegistry } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import {
  AgentHandshake,
  AgentMessage,
  OrchestratorToolCall,
} from '@widgetdc/contracts/orchestrator'

// Register TypeBox formats used by contract schemas
if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (v) => !isNaN(Date.parse(v)))
}
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))
}

// Pre-compiled validators (fast repeated checks)
export const validateHandshake = TypeCompiler.Compile(AgentHandshake)
export const validateMessage = TypeCompiler.Compile(AgentMessage)
export const validateToolCall = TypeCompiler.Compile(OrchestratorToolCall)

/**
 * Validate data against a compiled schema.
 * Returns { ok: true, data } or { ok: false, errors }.
 */
export function validate<T>(
  checker: { Check: (v: unknown) => boolean; Errors: (v: unknown) => IterableIterator<{ path: string; message: string }> },
  data: unknown,
): { ok: true; data: T } | { ok: false; errors: string[] } {
  if (checker.Check(data)) {
    return { ok: true, data: data as T }
  }

  const errors: string[] = []
  for (const err of checker.Errors(data)) {
    errors.push(`${err.path}: ${err.message}`)
    if (errors.length >= 5) break // limit error output
  }
  return { ok: false, errors }
}

/**
 * Strip unknown properties from data to match schema exactly.
 * Useful for sanitising input before storage.
 */
export function cleanToSchema<T>(schema: Parameters<typeof Value.Clean>[0], data: unknown): T {
  return Value.Clean(schema, structuredClone(data)) as T
}
