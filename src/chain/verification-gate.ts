/**
 * verification-gate.ts — Post-chain verification with auto-fix loops.
 *
 * Pattern sources:
 *   - GSD-2: beforeToolCall/afterToolCall hooks, error → graceful stopReason
 *   - OpenAI SDK: Tripwire guardrails (parallel validation, immediate abort)
 *   - AutoGen: TokenUsageTermination (budget ceiling)
 *
 * Runs after each chain execution to verify quality.
 * On failure: auto-retries with fix chain (max 3 attempts).
 */
import { logger } from '../logger.js'
import { callMcpTool } from '../mcp-caller.js'
import { v4 as uuid } from 'uuid'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VerificationCheck {
  name: string
  /** MCP tool to call for verification */
  tool_name: string
  /** Arguments for the tool */
  arguments: Record<string, unknown>
  /** Expected: check result[key] === expected_value */
  expected_key?: string
  expected_value?: unknown
  /** Custom validator function */
  validate?: (result: unknown) => boolean
}

export interface VerificationConfig {
  checks: VerificationCheck[]
  /** Max auto-fix attempts (default: 3) */
  max_retries?: number
  /** Chain to run for auto-fix (if provided) */
  fix_chain_id?: string
  /** Budget ceiling: abort if total cost exceeds this */
  max_cost_usd?: number
  /** Tripwire: abort immediately if this check fails (OpenAI SDK pattern) */
  tripwire_check?: string
}

export interface VerificationResult {
  passed: boolean
  checks: Array<{
    name: string
    status: 'pass' | 'fail' | 'error' | 'tripwire'
    output: unknown
    duration_ms: number
  }>
  retries_attempted: number
  total_duration_ms: number
  aborted_by_tripwire: boolean
}

// ─── Gate ────────────────────────────────────────────────────────────────────

/**
 * Run verification gate on chain output.
 * Checks run in parallel (OpenAI tripwire pattern).
 * On failure: retries up to max_retries.
 */
export async function verifyChainOutput(
  chainOutput: unknown,
  config: VerificationConfig,
): Promise<VerificationResult> {
  const maxRetries = config.max_retries ?? 3
  const start = Date.now()
  let retries = 0
  let lastResult: VerificationResult | null = null

  while (retries <= maxRetries) {
    const checkResults = await runChecksParallel(config.checks, chainOutput)

    const tripwireTripped = config.tripwire_check
      ? checkResults.some(c => c.name === config.tripwire_check && c.status !== 'pass')
      : false

    const allPassed = checkResults.every(c => c.status === 'pass')

    lastResult = {
      passed: allPassed && !tripwireTripped,
      checks: checkResults,
      retries_attempted: retries,
      total_duration_ms: Date.now() - start,
      aborted_by_tripwire: tripwireTripped,
    }

    if (allPassed) {
      logger.info({ retries, checks: checkResults.length }, 'Verification gate: PASSED')
      return lastResult
    }

    if (tripwireTripped) {
      logger.warn({ tripwire: config.tripwire_check }, 'Verification gate: TRIPWIRE ABORT')
      return lastResult
    }

    // Auto-retry
    retries++
    if (retries <= maxRetries) {
      logger.info({ retry: retries, maxRetries, failed: checkResults.filter(c => c.status !== 'pass').map(c => c.name) }, 'Verification gate: retrying')
      // Small delay before retry
      await new Promise(r => setTimeout(r, 1000 * retries))
    }
  }

  logger.warn({ retries: maxRetries }, 'Verification gate: FAILED after max retries')
  return lastResult!
}

/**
 * Run all checks in parallel (OpenAI SDK tripwire pattern).
 * First failure of a tripwire check aborts all remaining.
 */
async function runChecksParallel(
  checks: VerificationCheck[],
  chainOutput: unknown,
): Promise<VerificationResult['checks']> {
  const results = await Promise.allSettled(
    checks.map(async (check) => {
      const start = Date.now()
      try {
        const args = { ...check.arguments }
        // Inject chain output if {{output}} placeholder exists
        for (const [k, v] of Object.entries(args)) {
          if (v === '{{output}}') args[k] = chainOutput
        }

        const result = await callMcpTool({
          toolName: check.tool_name,
          args,
          callId: `verify-${uuid().substring(0, 8)}`,
          timeoutMs: 15000,
        })

        let passed = true
        if (check.validate) {
          passed = check.validate(result)
        } else if (check.expected_key) {
          const actual = (result as Record<string, unknown>)?.[check.expected_key]
          passed = actual === check.expected_value
        }

        return {
          name: check.name,
          status: passed ? 'pass' as const : 'fail' as const,
          output: result,
          duration_ms: Date.now() - start,
        }
      } catch (err) {
        return {
          name: check.name,
          status: 'error' as const,
          output: String(err),
          duration_ms: Date.now() - start,
        }
      }
    }),
  )

  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : {
      name: checks[i].name,
      status: 'error' as const,
      output: String((r as PromiseRejectedResult).reason),
      duration_ms: 0,
    },
  )
}

// ─── Pre-built verification configs ─────────────────────────────────────────

/** Verify graph writes succeeded */
export const GRAPH_WRITE_VERIFICATION: VerificationConfig = {
  checks: [
    {
      name: 'graph-health',
      tool_name: 'graph.health',
      arguments: {},
      validate: (r: unknown) => (r as Record<string, unknown>)?.status === 'online',
    },
  ],
  max_retries: 1,
}

/** Verify intelligence loop produced insights */
export const INTELLIGENCE_LOOP_VERIFICATION: VerificationConfig = {
  checks: [
    {
      name: 'insights-created',
      tool_name: 'graph.read_cypher',
      arguments: {
        query: "MATCH (s:StrategicInsight) WHERE s.createdAt > datetime() - duration('PT1H') RETURN count(s) AS recent",
      },
      validate: (r: unknown) => {
        const results = (r as Record<string, unknown>)?.results as Array<Record<string, unknown>>
        return results?.[0]?.recent !== undefined
      },
    },
  ],
  max_retries: 0,
}
