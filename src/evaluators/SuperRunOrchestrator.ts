/**
 * SuperRunOrchestrator.ts — Phase F5 Swarm Batch Processing.
 *
 * Per Architect & Executive Phase F5 directive: assign one super_run_id
 * to 10+ independent BOMRun submissions and execute them as a parallel
 * swarm (e.g. mass-audit). Every individual submission MUST pass through
 * the I-5 dimensional gate (MultiDimensionalEvaluator) BEFORE its result
 * is surfaced upstream.
 *
 * The orchestrator does NOT execute the underlying work — it accepts a
 * caller-supplied `runOne` function and parallelizes invocations under
 * a single super_run_id, capping concurrency to avoid overload. Failures
 * (including AutoRejectException) are captured per-submission so the
 * caller gets a complete swarm receipt.
 *
 * Reference patterns:
 *   - docs/governance/PATTERN_LIBRARY.md Pattern #4 Evidence-Gated Claim Control
 *   - docs/governance/PATTERN_LIBRARY.md Pattern #11 PhantomBOM/BOMItem
 *   - Pattern #6 Write-Gate Precision Audit (per-run failures must surface
 *     truthfully — silent rejection is the worse failure mode)
 */

import {
  AutoRejectException,
  evaluate,
  type DimensionRationale,
  type DimensionScores,
  type ScoringInput,
  type ScoringResult,
} from './MultiDimensionalEvaluator.js';

export const DEFAULT_MAX_CONCURRENT = 10;
export const HARD_MAX_CONCURRENT = 50;

export interface SubmissionScoring {
  readonly scores: DimensionScores;
  readonly rationales?: DimensionRationale;
  readonly threshold?: number;
}

export interface BOMRunSubmission {
  /** Stable id of the BOMRun candidate (must be unique within the super-run). */
  readonly bom_run_id: string;
  readonly subject_type: ScoringInput['subject_type'];
  readonly scoring: SubmissionScoring;
  /**
   * Optional payload passed through to runOne if the caller chose to
   * actually execute work after the gate passes. The orchestrator does
   * not interpret it.
   */
  readonly payload?: unknown;
}

export type RunOneFn = (
  submission: BOMRunSubmission,
  scoringResult: ScoringResult,
) => Promise<unknown>;

export interface SuperRunInput {
  readonly super_run_id: string;
  readonly submissions: ReadonlyArray<BOMRunSubmission>;
  /** Optional caller-supplied executor for accepted submissions. */
  readonly run_one?: RunOneFn;
  /** Concurrency cap. Default 10, hard cap 50. Caller must justify high values. */
  readonly max_concurrent?: number;
  /** Correlation id for cross-system tracing. */
  readonly correlation_id?: string;
}

export interface PerSubmissionOutcome {
  readonly bom_run_id: string;
  readonly status: 'passed_and_run' | 'passed' | 'auto_rejected' | 'execution_error';
  readonly score: number;
  readonly threshold: number;
  readonly weak_dimensions: ReadonlyArray<string>;
  readonly rewrite_mandate: string | null;
  readonly run_result?: unknown;
  readonly error?: string;
  readonly latency_ms: number;
}

export interface SuperRunResult {
  readonly super_run_id: string;
  readonly correlation_id: string;
  readonly total: number;
  readonly passed: number;
  readonly auto_rejected: number;
  readonly execution_errors: number;
  readonly avg_score: number;
  readonly worst_score: number;
  readonly best_score: number;
  readonly outcomes: ReadonlyArray<PerSubmissionOutcome>;
  readonly started_at: string;
  readonly completed_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency primitive (Promise pool — no external dep)
// ─────────────────────────────────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  worker: (item: T, index: number) => Promise<R>,
  maxConcurrent: number,
): Promise<R[]> {
  const cap = Math.min(Math.max(1, maxConcurrent), HARD_MAX_CONCURRENT);
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function pump(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(cap, items.length); i++) {
    workers.push(pump());
  }
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-submission gate + optional execution
// ─────────────────────────────────────────────────────────────────────────────

async function processSubmission(
  superRunId: string,
  superCorrelationId: string,
  submission: BOMRunSubmission,
  runOne: RunOneFn | undefined,
): Promise<PerSubmissionOutcome> {
  const start = Date.now();

  // Gate: evaluate via I-5. We use `evaluate` (non-throwing) here so the
  // swarm receipt captures every outcome truthfully, then translate the
  // rejected ones into outcome.status='auto_rejected'. Direct
  // gatedEvaluate would require try/catch + AutoRejectException unwrap.
  let scoring: ScoringResult;
  try {
    scoring = evaluate({
      subject_id: submission.bom_run_id,
      subject_type: submission.subject_type,
      scores: submission.scoring.scores,
      rationales: submission.scoring.rationales,
      threshold: submission.scoring.threshold,
      correlation_id: `${superCorrelationId}:${submission.bom_run_id}`,
    });
  } catch (err) {
    // Validation error (malformed input). Surface as execution_error.
    return {
      bom_run_id: submission.bom_run_id,
      status: 'execution_error',
      score: 0,
      threshold: submission.scoring.threshold ?? 4.0,
      weak_dimensions: [],
      rewrite_mandate: null,
      error: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }

  if (!scoring.passed) {
    return {
      bom_run_id: submission.bom_run_id,
      status: 'auto_rejected',
      score: scoring.average,
      threshold: scoring.threshold,
      weak_dimensions: scoring.weak_dimensions,
      rewrite_mandate: scoring.rewrite_mandate,
      latency_ms: Date.now() - start,
    };
  }

  // Passed gate. Execute if caller supplied runOne.
  if (!runOne) {
    return {
      bom_run_id: submission.bom_run_id,
      status: 'passed',
      score: scoring.average,
      threshold: scoring.threshold,
      weak_dimensions: scoring.weak_dimensions,
      rewrite_mandate: null,
      latency_ms: Date.now() - start,
    };
  }

  try {
    const runResult = await runOne(submission, scoring);
    return {
      bom_run_id: submission.bom_run_id,
      status: 'passed_and_run',
      score: scoring.average,
      threshold: scoring.threshold,
      weak_dimensions: scoring.weak_dimensions,
      rewrite_mandate: null,
      run_result: runResult,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      bom_run_id: submission.bom_run_id,
      status: 'execution_error',
      score: scoring.average,
      threshold: scoring.threshold,
      weak_dimensions: scoring.weak_dimensions,
      rewrite_mandate: null,
      error: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - start,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

function makeCorrelationId(): string {
  return `super-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Execute a parallel swarm of BOMRun submissions under a single super_run_id.
 * Every submission flows through the I-5 gate; auto-rejected submissions are
 * captured truthfully in the receipt (caller MUST surface them, not hide them).
 */
export async function executeSuperRun(input: SuperRunInput): Promise<SuperRunResult> {
  if (!input.super_run_id || input.super_run_id.trim() === '') {
    throw new TypeError('super_run_id is required');
  }
  if (!Array.isArray(input.submissions) || input.submissions.length === 0) {
    throw new TypeError('submissions array must be non-empty');
  }

  // Reject duplicate bom_run_id within the same super-run.
  const seen = new Set<string>();
  for (const s of input.submissions) {
    if (seen.has(s.bom_run_id)) {
      throw new TypeError(
        `Duplicate bom_run_id '${s.bom_run_id}' within super-run '${input.super_run_id}'`,
      );
    }
    seen.add(s.bom_run_id);
  }

  const correlationId = input.correlation_id ?? makeCorrelationId();
  const startedAt = new Date().toISOString();
  const cap = input.max_concurrent ?? DEFAULT_MAX_CONCURRENT;

  const outcomes = await runWithConcurrency(
    input.submissions,
    (submission) =>
      processSubmission(
        input.super_run_id,
        correlationId,
        submission,
        input.run_one,
      ),
    cap,
  );

  const completedAt = new Date().toISOString();

  let passedCount = 0;
  let rejectedCount = 0;
  let errorCount = 0;
  let scoreSum = 0;
  let worst = Number.POSITIVE_INFINITY;
  let best = Number.NEGATIVE_INFINITY;
  let scored = 0;

  for (const o of outcomes) {
    if (o.status === 'passed' || o.status === 'passed_and_run') passedCount++;
    if (o.status === 'auto_rejected') rejectedCount++;
    if (o.status === 'execution_error') errorCount++;
    if (o.score > 0) {
      scoreSum += o.score;
      if (o.score < worst) worst = o.score;
      if (o.score > best) best = o.score;
      scored++;
    }
  }

  return {
    super_run_id: input.super_run_id,
    correlation_id: correlationId,
    total: input.submissions.length,
    passed: passedCount,
    auto_rejected: rejectedCount,
    execution_errors: errorCount,
    avg_score: scored > 0 ? Math.round((scoreSum / scored) * 100) / 100 : 0,
    worst_score: scored > 0 && Number.isFinite(worst) ? worst : 0,
    best_score: scored > 0 && Number.isFinite(best) ? best : 0,
    outcomes,
    started_at: startedAt,
    completed_at: completedAt,
  };
}
