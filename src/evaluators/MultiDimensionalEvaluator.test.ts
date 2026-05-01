/**
 * MultiDimensionalEvaluator.test.ts — Phase F5 Anchor or Abort regression test.
 *
 * Per Architect & Executive directive: this test is the gating evidence
 * before the Phase F5 PR may be opened. It MUST prove that a 3.9-average
 * BOMRun auto-rejects via AutoRejectException. If this test fails, NO PR.
 *
 * Run: npx tsx src/evaluators/MultiDimensionalEvaluator.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AutoRejectException,
  DEFAULT_THRESHOLD,
  DIMENSION_IDS,
  evaluate,
  gatedEvaluate,
  type DimensionScores,
  type ScoringInput,
} from './MultiDimensionalEvaluator.js';
import {
  executeSuperRun,
  type BOMRunSubmission,
} from './SuperRunOrchestrator.js';

// ─── Test fixtures ───────────────────────────────────────────────────────────

function buildScores(partial: Partial<DimensionScores> = {}): DimensionScores {
  return {
    risk: 4.5,
    roi: 4.5,
    compliance: 4.5,
    lineage: 4.5,
    feasibility: 4.5,
    ...partial,
  };
}

function buildInput(scores: DimensionScores, threshold?: number): ScoringInput {
  return {
    subject_id: 'bomrun-test-001',
    subject_type: 'phantom_bom_run',
    scores,
    threshold,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ANCHOR — directive-mandated proof for 3.9 auto-reject
// ─────────────────────────────────────────────────────────────────────────────

describe('I-5 Gate — Anchor or Abort regression (Phase F5 directive)', () => {
  it('ANCHOR: a BOMRun with 3.9 average score throws AutoRejectException', () => {
    // Construct EXACT 3.9 average: (4 + 4 + 4 + 4 + 3.5) / 5 = 3.9
    const scores = buildScores({
      risk: 4.0,
      roi: 4.0,
      compliance: 4.0,
      lineage: 4.0,
      feasibility: 3.5,
    });

    let caught: unknown;
    try {
      gatedEvaluate(buildInput(scores));
      assert.fail('AutoRejectException MUST be thrown for average 3.9 below threshold 4.0');
    } catch (err) {
      caught = err;
    }

    assert.ok(
      caught instanceof AutoRejectException,
      `Expected AutoRejectException, got ${caught instanceof Error ? caught.constructor.name : typeof caught}`,
    );
    assert.equal(
      (caught as AutoRejectException).result.average,
      3.9,
      'average must report exactly 3.9 (not 3.8999... rounding)',
    );
    assert.equal((caught as AutoRejectException).result.passed, false);
    assert.equal(
      (caught as AutoRejectException).code,
      'I5_GATE_AUTO_REJECT',
      'AutoRejectException must carry stable code I5_GATE_AUTO_REJECT for callers',
    );
    assert.deepEqual(
      [...(caught as AutoRejectException).result.weak_dimensions],
      ['feasibility'],
      'weak_dimensions must list feasibility (only one below 4.0)',
    );
    assert.ok(
      (caught as AutoRejectException).result.rewrite_mandate,
      'rewrite_mandate must be present on rejection',
    );
    assert.match(
      (caught as AutoRejectException).result.rewrite_mandate ?? '',
      /FEASIBILITY/i,
      'rewrite_mandate must reference the weak dimension',
    );
  });

  it('ANCHOR: a BOMRun with 3.99 average ALSO auto-rejects (no rounding-up to pass)', () => {
    // (4 + 4 + 4 + 4 + 3.95) / 5 = 3.99
    const scores = buildScores({
      risk: 4.0,
      roi: 4.0,
      compliance: 4.0,
      lineage: 4.0,
      feasibility: 3.95,
    });
    assert.throws(() => gatedEvaluate(buildInput(scores)), AutoRejectException);
  });

  it('ANCHOR: a BOMRun with exactly 4.0 average PASSES (boundary inclusive)', () => {
    const scores = buildScores({
      risk: 4.0,
      roi: 4.0,
      compliance: 4.0,
      lineage: 4.0,
      feasibility: 4.0,
    });
    const result = gatedEvaluate(buildInput(scores));
    assert.equal(result.passed, true);
    assert.equal(result.average, 4.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MultiDimensionalEvaluator — additional invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('MultiDimensionalEvaluator — invariants', () => {
  it('exposes 5 dimension ids in canonical order', () => {
    assert.deepEqual([...DIMENSION_IDS], [
      'risk',
      'roi',
      'compliance',
      'lineage',
      'feasibility',
    ]);
  });

  it('default threshold is 4.0 per directive', () => {
    assert.equal(DEFAULT_THRESHOLD, 4.0);
  });

  it('rejects out-of-range scores at validation', () => {
    assert.throws(
      () => evaluate(buildInput(buildScores({ risk: 5.5 }))),
      RangeError,
    );
    assert.throws(
      () => evaluate(buildInput(buildScores({ compliance: 0.5 }))),
      RangeError,
    );
  });

  it('rejects non-numeric scores', () => {
    assert.throws(
      () => evaluate(buildInput(buildScores({ roi: NaN }))),
      TypeError,
    );
  });

  it('evaluate (non-throwing) returns passed:false instead of throwing', () => {
    const scores = buildScores({ feasibility: 1.0 });
    const result = evaluate(buildInput(scores));
    assert.equal(result.passed, false);
    assert.ok(result.rewrite_mandate);
  });

  it('weak_dimensions lists ALL dimensions below threshold (not just lowest)', () => {
    const scores = buildScores({ feasibility: 2.0, lineage: 3.0, roi: 3.5 });
    const result = evaluate(buildInput(scores));
    assert.deepEqual(
      [...result.weak_dimensions].sort(),
      ['feasibility', 'lineage', 'roi'].sort(),
    );
  });

  it('rewrite_mandate references EVERY weak dimension', () => {
    const scores = buildScores({ feasibility: 2.0, lineage: 3.0, compliance: 3.5 });
    const result = evaluate(buildInput(scores));
    assert.match(result.rewrite_mandate ?? '', /FEASIBILITY/i);
    assert.match(result.rewrite_mandate ?? '', /LINEAGE/i);
    assert.match(result.rewrite_mandate ?? '', /COMPLIANCE/i);
  });

  it('threshold override is honored but cannot be lowered to pass otherwise-failing scores', () => {
    // Caller passes threshold=3.5 to test their own gate. average 3.9 passes 3.5.
    const scores = buildScores({ feasibility: 3.5 });
    const result = gatedEvaluate({
      subject_id: 'bomrun-test-002',
      subject_type: 'phantom_bom_run',
      scores,
      threshold: 3.5,
    });
    assert.equal(result.passed, true);
    assert.equal(result.threshold, 3.5);
  });

  it('threshold override out-of-range rejected', () => {
    assert.throws(
      () =>
        evaluate({
          subject_id: 'x',
          subject_type: 'phantom_bom_run',
          scores: buildScores(),
          threshold: 7.0,
        }),
      RangeError,
    );
  });

  it('AutoRejectException message mentions average, threshold, and subject', () => {
    try {
      gatedEvaluate(buildInput(buildScores({ feasibility: 1.0 }), 4.0));
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof AutoRejectException);
      assert.match((err as Error).message, /3\.\d{2}/);
      assert.match((err as Error).message, /4\.00/);
      assert.match((err as Error).message, /bomrun-test-001/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SuperRunOrchestrator — swarm batch processing
// ─────────────────────────────────────────────────────────────────────────────

describe('SuperRunOrchestrator — swarm batch processing', () => {
  it('processes 12 submissions in parallel under one super_run_id', async () => {
    // First half: feasibility 4.5 → avg 4.5 → passes.
    // Second half: feasibility 1.5 → avg (4.5*4 + 1.5)/5 = 3.9 → rejects.
    const submissions: BOMRunSubmission[] = Array.from({ length: 12 }, (_, i) => ({
      bom_run_id: `swarm-test-${i}`,
      subject_type: 'phantom_bom_run',
      scoring: { scores: buildScores({ feasibility: i < 6 ? 4.5 : 1.5 }) },
    }));

    const result = await executeSuperRun({
      super_run_id: 'super-swarm-test-1',
      submissions,
    });

    assert.equal(result.total, 12);
    assert.equal(result.passed, 6);
    assert.equal(result.auto_rejected, 6);
    assert.equal(result.execution_errors, 0);
    assert.equal(result.outcomes.length, 12);
  });

  it('auto-rejects propagate via outcome.status without throwing', async () => {
    const submissions: BOMRunSubmission[] = [
      {
        bom_run_id: 'swarm-rej-1',
        subject_type: 'phantom_bom_run',
        scoring: {
          scores: buildScores({
            risk: 4.0,
            roi: 4.0,
            compliance: 4.0,
            lineage: 4.0,
            feasibility: 3.5,
          }),
        },
      },
    ];

    const result = await executeSuperRun({
      super_run_id: 'super-rej-test',
      submissions,
    });

    assert.equal(result.outcomes[0].status, 'auto_rejected');
    assert.equal(result.outcomes[0].score, 3.9);
    assert.ok(result.outcomes[0].rewrite_mandate);
  });

  it('runOne is called only for passed submissions', async () => {
    const calls: string[] = [];
    const submissions: BOMRunSubmission[] = [
      {
        bom_run_id: 'pass-1',
        subject_type: 'phantom_bom_run',
        scoring: { scores: buildScores() },
      },
      {
        bom_run_id: 'reject-1',
        subject_type: 'phantom_bom_run',
        scoring: { scores: buildScores({ feasibility: 1.0 }) },
      },
    ];

    const result = await executeSuperRun({
      super_run_id: 'super-runone-test',
      submissions,
      run_one: async (sub) => {
        calls.push(sub.bom_run_id);
        return { ok: true };
      },
    });

    assert.deepEqual(calls, ['pass-1']);
    assert.equal(result.passed, 1);
    assert.equal(result.auto_rejected, 1);
    assert.equal(result.outcomes[0].status, 'passed_and_run');
  });

  it('rejects duplicate bom_run_id within a super-run', async () => {
    await assert.rejects(
      executeSuperRun({
        super_run_id: 'super-dup',
        submissions: [
          { bom_run_id: 'dup', subject_type: 'phantom_bom_run', scoring: { scores: buildScores() } },
          { bom_run_id: 'dup', subject_type: 'phantom_bom_run', scoring: { scores: buildScores() } },
        ],
      }),
      /Duplicate bom_run_id/,
    );
  });

  it('rejects empty submissions array', async () => {
    await assert.rejects(
      executeSuperRun({ super_run_id: 'empty', submissions: [] }),
      /non-empty/,
    );
  });

  it('captures runOne errors as execution_error without crashing the swarm', async () => {
    const submissions: BOMRunSubmission[] = [
      { bom_run_id: 'a', subject_type: 'phantom_bom_run', scoring: { scores: buildScores() } },
      { bom_run_id: 'b', subject_type: 'phantom_bom_run', scoring: { scores: buildScores() } },
    ];

    const result = await executeSuperRun({
      super_run_id: 'super-err',
      submissions,
      run_one: async (sub) => {
        if (sub.bom_run_id === 'b') throw new Error('boom');
        return { ok: true };
      },
    });

    assert.equal(result.passed, 1);
    assert.equal(result.execution_errors, 1);
    assert.equal(result.outcomes[1].status, 'execution_error');
    assert.match(result.outcomes[1].error ?? '', /boom/);
  });

  it('aggregates avg/best/worst scores correctly', async () => {
    const submissions: BOMRunSubmission[] = [
      { bom_run_id: 'a', subject_type: 'phantom_bom_run', scoring: { scores: buildScores({ feasibility: 5.0 }) } }, // avg 4.6
      { bom_run_id: 'b', subject_type: 'phantom_bom_run', scoring: { scores: buildScores() } }, // avg 4.5
      { bom_run_id: 'c', subject_type: 'phantom_bom_run', scoring: { scores: buildScores({ feasibility: 4.0 }) } }, // avg 4.4
    ];
    const result = await executeSuperRun({ super_run_id: 'agg', submissions });
    assert.equal(result.best_score, 4.6);
    assert.equal(result.worst_score, 4.4);
    assert.equal(result.avg_score, 4.5);
  });
});
