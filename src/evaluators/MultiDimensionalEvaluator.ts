/**
 * MultiDimensionalEvaluator.ts — Phase F5 I-5 Dimensional Scoring Gate.
 *
 * Per Architect & Executive Phase F5 directive: every proposed
 * PhantomBOMRun (or solution artifact) MUST be scored on 5 dimensions
 * before being presented upstream. The Executive must NEVER see a
 * solution with an average score below 4.0.
 *
 * Dimensions (each 1.0–5.0; 5.0 = best):
 *   - Risk        — inverse blast-radius score (5 = no production risk)
 *   - ROI         — value-per-cost (5 = highest leverage)
 *   - Compliance  — governance + contract conformance (5 = fully compliant)
 *   - Lineage     — Phantom Trinity + EventSpine evidence (5 = fully traced)
 *   - Feasibility — implementation effort + dependency clarity (5 = trivial)
 *
 * Hard constraint:
 *   if average(scores) < 4.0  →  throw AutoRejectException
 *                                with self-rewrite mandate
 *
 * Reference: docs/governance/CANARY_CLASSES.md (Tier-5 evidence weight)
 *            docs/governance/PATTERN_LIBRARY.md Pattern #4 (Evidence-Gated
 *            Claim Control) Pattern #5 (Canary Skeptic).
 */

export type DimensionId = 'risk' | 'roi' | 'compliance' | 'lineage' | 'feasibility';

export const DIMENSION_IDS: ReadonlyArray<DimensionId> = [
  'risk',
  'roi',
  'compliance',
  'lineage',
  'feasibility',
];

export const SCORE_MIN = 1.0;
export const SCORE_MAX = 5.0;
export const DEFAULT_THRESHOLD = 4.0;

export interface DimensionScores {
  readonly risk: number;
  readonly roi: number;
  readonly compliance: number;
  readonly lineage: number;
  readonly feasibility: number;
}

export interface DimensionRationale {
  readonly risk?: string;
  readonly roi?: string;
  readonly compliance?: string;
  readonly lineage?: string;
  readonly feasibility?: string;
}

export interface ScoringInput {
  /** Stable id of the PhantomBOMRun or solution artifact under review. */
  readonly subject_id: string;
  readonly subject_type: 'phantom_bom_run' | 'solution_artifact' | 'pr_proposal' | 'plan_envelope';
  readonly scores: DimensionScores;
  /** Per-dimension rationale (optional, but recommended for low scores). */
  readonly rationales?: DimensionRationale;
  /** Override threshold (default 4.0). MUST NOT be lowered to mask rejection. */
  readonly threshold?: number;
  /** Correlation id for cross-system tracing (EventSpine, Linear, etc). */
  readonly correlation_id?: string;
}

export interface ScoringResult {
  readonly subject_id: string;
  readonly subject_type: ScoringInput['subject_type'];
  readonly scores: DimensionScores;
  readonly average: number;
  readonly threshold: number;
  readonly passed: boolean;
  /** Dimensions that fell below threshold individually. */
  readonly weak_dimensions: ReadonlyArray<DimensionId>;
  /** If !passed, this is the self-rewrite mandate the caller MUST satisfy. */
  readonly rewrite_mandate: string | null;
  readonly correlation_id: string;
  readonly evaluated_at: string;
}

export class AutoRejectException extends Error {
  public readonly result: ScoringResult;
  public readonly code: 'I5_GATE_AUTO_REJECT' = 'I5_GATE_AUTO_REJECT';

  constructor(result: ScoringResult) {
    super(
      `I-5 gate auto-reject: subject '${result.subject_id}' (${result.subject_type}) ` +
        `scored ${result.average.toFixed(2)} below threshold ${result.threshold.toFixed(2)}. ` +
        `Weak dimensions: ${result.weak_dimensions.join(', ') || 'none individually'}.\n` +
        `REWRITE MANDATE: ${result.rewrite_mandate ?? '(missing)'}`,
    );
    this.name = 'AutoRejectException';
    this.result = result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateScore(name: DimensionId, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Dimension '${name}' must be a finite number, got ${value}`);
  }
  if (value < SCORE_MIN || value > SCORE_MAX) {
    throw new RangeError(
      `Dimension '${name}' score ${value} outside allowed range [${SCORE_MIN}, ${SCORE_MAX}]`,
    );
  }
}

function validateScores(scores: DimensionScores): void {
  for (const id of DIMENSION_IDS) {
    validateScore(id, scores[id]);
  }
}

function average5(scores: DimensionScores): number {
  // Round to 2 decimals so 3.9 reports as 3.9 (not 3.8999999999...).
  const sum =
    scores.risk + scores.roi + scores.compliance + scores.lineage + scores.feasibility;
  return Math.round((sum / 5) * 100) / 100;
}

function makeCorrelationId(): string {
  return `i5-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-rewrite mandate
// ─────────────────────────────────────────────────────────────────────────────

const MANDATE_BY_DIMENSION: Readonly<Record<DimensionId, string>> = {
  risk:
    'Reduce blast radius: scope to fewer files, gate behind env flag, add canary tier-4 ' +
    'with deployed-SHA evidence. Apply Pattern #1 Runtime Truth Verification + Pattern #5 Canary Skeptic.',
  roi:
    'Justify the leverage: cite the user-visible / metric-visible win this slice unlocks. ' +
    'If the win is speculative, downgrade to a research spike; do not ship speculation as production_write.',
  compliance:
    'Verify against widgetdc-contracts (snake_case + $id), CLAUDE.md rules, and applicable governance docs. ' +
    'If a rule is unclear, route through HyperAgent plan rather than guessing.',
  lineage:
    'Add Phantom Trinity edges: SkillMaterialization USES_SKILL PhantomSkill + PhantomBOMRun MATERIALIZED_SKILL ' +
    'SkillMaterialization. Emit EventSpine event before declaring success. Apply Pattern #8 Phantom Composition Spine + Pattern #9 EventSpine Before Success.',
  feasibility:
    'Decompose: identify the single smallest slice that can ship inside the budget lane. Surface dependencies ' +
    'explicitly; if any dependency is missing or stale, gate the slice behind it instead of fudging the implementation.',
};

function buildRewriteMandate(
  weakDimensions: ReadonlyArray<DimensionId>,
  rationales?: DimensionRationale,
): string {
  if (weakDimensions.length === 0) {
    return (
      'Average below threshold despite no individual dimension under threshold. ' +
      'Re-evaluate: if all five dimensions are honestly close to threshold, the work is overall low-leverage; ' +
      'consider parking and choosing a higher-impact slice.'
    );
  }
  const blocks = weakDimensions.map((d) => {
    const reason = rationales?.[d] ? ` (rationale: ${rationales[d]})` : '';
    return `- ${d.toUpperCase()}: ${MANDATE_BY_DIMENSION[d]}${reason}`;
  });
  return [
    `Weak dimensions detected (${weakDimensions.length}/${DIMENSION_IDS.length}). Address EACH before re-submission:`,
    ...blocks,
    '',
    'After self-rewrite: re-score and only re-submit when average >= threshold AND every dimension >= threshold-0.5.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score the subject without throwing. Use for non-gating reviews where
 * the caller wants the full envelope but will decide what to do.
 */
export function evaluate(input: ScoringInput): ScoringResult {
  validateScores(input.scores);

  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  if (threshold < SCORE_MIN || threshold > SCORE_MAX) {
    throw new RangeError(`Threshold ${threshold} outside [${SCORE_MIN}, ${SCORE_MAX}]`);
  }

  const avg = average5(input.scores);
  const weak = DIMENSION_IDS.filter((d) => input.scores[d] < threshold);
  const passed = avg >= threshold;

  return {
    subject_id: input.subject_id,
    subject_type: input.subject_type,
    scores: input.scores,
    average: avg,
    threshold,
    passed,
    weak_dimensions: weak,
    rewrite_mandate: passed ? null : buildRewriteMandate(weak, input.rationales),
    correlation_id: input.correlation_id ?? makeCorrelationId(),
    evaluated_at: new Date().toISOString(),
  };
}

/**
 * Gated evaluate: throws AutoRejectException when average < threshold.
 *
 * This is the canonical entry point per Phase F5 directive. Callers that
 * want to surface a result upstream MUST go through this function — never
 * through `evaluate()` directly when the consumer is The Executive or any
 * other operator-facing surface.
 */
export function gatedEvaluate(input: ScoringInput): ScoringResult {
  const result = evaluate(input);
  if (!result.passed) {
    throw new AutoRejectException(result);
  }
  return result;
}
