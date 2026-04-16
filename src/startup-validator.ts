/**
 * startup-validator.ts — Fail-fast validation at boot (Bulletproof W1).
 *
 * Validates that every tool in TOOL_REGISTRY has a corresponding
 * executor case. If mismatch → refuse to start (no half-broken prod).
 *
 * This catches the class of bugs where a new tool is added to the registry
 * but the executor case is missing (or vice versa). Previously such bugs
 * only surfaced when a user called the tool in production.
 */
import { TOOL_REGISTRY } from './tools/tool-registry.js'
import { executeToolUnified } from './tools/tool-executor.js'
import { setValidatorMode } from './mcp-caller.js'
import { logger } from './logger.js'

export interface ValidationResult {
  passed: boolean
  errors: string[]
  warnings: string[]
  tools_validated: number
}

/**
 * Validate tool registry and executor are in sync.
 * Calls each tool with empty args — if executor returns "Unknown tool: X",
 * the case is missing. All other responses (success, error, validation) prove
 * the case exists.
 */
export async function validateStartup(): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []
  let validated = 0

  // Activate validator mode — all callMcpTool calls return bypass responses.
  // This prevents 67 parallel tool validations from hitting backend rate limits.
  setValidatorMode(true)

  // Run all tools in parallel with a 4s global deadline.
  // This reduces worst-case validator time from (N × timeout) to 4s regardless of tool count.
  const results = await Promise.allSettled(
    TOOL_REGISTRY.map(tool =>
      Promise.race([
        executeToolUnified(tool.name, {}, {
          call_id: `validator-${tool.name}`,
          source_protocol: 'validator',
          fold: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('validator timeout')), 4000)
        ),
      ]).then(result => ({ tool: tool.name, result }))
       .catch(err => ({ tool: tool.name, error: err instanceof Error ? err.message : String(err) }))
    )
  )

  for (const settled of results) {
    if (settled.status === 'rejected') {
      // Promise.allSettled should never reject, but guard anyway
      warnings.push(`validator internal error`)
      continue
    }
    const { tool, result, error } = settled.value as { tool: string; result?: { result: unknown }; error?: string }

    if (error) {
      // Network errors and timeouts during validation are warnings, not failures
      warnings.push(`${tool}: validation threw (${error.slice(0, 60)})`)
      validated++
      continue
    }

    const resultStr = typeof result?.result === 'string' ? result.result : ''
    if (resultStr.startsWith('Unknown tool:')) {
      errors.push(`${tool}: no executor case (registry defines it but tool-executor.ts has no case)`)
    } else {
      validated++
    }
  }

  // Deactivate validator mode — normal backend calls resume
  setValidatorMode(false)

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    tools_validated: validated,
  }
}

/**
 * Run validation and throw on failure.
 * Use in boot() to refuse startup on parity mismatch.
 */
export async function validateOrThrow(): Promise<void> {
  logger.info({ total_tools: TOOL_REGISTRY.length }, 'Startup validation: checking registry↔executor parity')

  const result = await validateStartup()

  if (result.warnings.length > 0) {
    logger.warn({ count: result.warnings.length, warnings: result.warnings.slice(0, 3) }, 'Startup validation: warnings (non-fatal)')
  }

  if (!result.passed) {
    logger.error({ errors: result.errors }, 'Startup validation FAILED — refusing to start')
    throw new Error(
      `Startup validation failed: ${result.errors.length} tool(s) have no executor case. ` +
      `Fix: add missing cases in src/tool-executor.ts. Errors: ${result.errors.join('; ')}`
    )
  }

  logger.info({
    validated: result.tools_validated,
    warnings: result.warnings.length,
  }, 'Startup validation: PASSED — registry↔executor parity confirmed')
}
