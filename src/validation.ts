/**
 * validation.ts — TypeBox runtime validation for API boundaries.
 *
 * Uses the contract schemas from @widgetdc/contracts to validate
 * incoming requests at the route level.
 */
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { Value } from '@sinclair/typebox/value'
import {
  AgentHandshake,
  AgentMessage,
  OrchestratorToolCall,
} from '@widgetdc/contracts/orchestrator'

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
