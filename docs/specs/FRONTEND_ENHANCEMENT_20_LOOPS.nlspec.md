# Frontend Enhancement 20 Loops — Execution Playbook

**Date:** 2026-04-13  
**Repo:** `widgetdc-orchestrator/cc-v4`  
**Goal:** Maximize frontend quality and proof-readiness through 20 tightly-scoped enhancement loops, using existing WidgeTDC skills, Phantom BOM evidence, internal knowledge, and typed templates.

---

## 1. Recommendation

Do **not** run 20 generic frontend polish loops.

Run **20 evidence-gated enhancement loops** where each loop:

1. classifies the intent,
2. checks existing patterns and sources,
3. reuses before inventing,
4. ships one concrete frontend improvement,
5. verifies type/runtime/UX impact,
6. deposits learnings back into procedural knowledge.

This is the highest-leverage way to improve `cc-v4` without drifting into architecture theater or random visual churn.

---

## 2. Best Inputs to Use

### 2.1 Best skills

These are the strongest skills for frontend enhancement in this repo:

| Rank | Skill | Why it matters |
|---|---|---|
| 1 | `flow-discover` | Forces pattern harvest before implementation |
| 2 | `flow-develop` | Turns findings into narrow, real code changes |
| 3 | `flow-deliver` | Validates the shipped change instead of hand-waving |
| 4 | `skill-verify` | Prevents false completion claims |
| 5 | `skill-intent-contract` | Locks the actual user-facing goal for each loop |
| 6 | `octopus-architecture` | Useful when a route/component contract needs design clarity |
| 7 | `skill-extract` | Useful for reverse-engineering strong UI patterns |
| 8 | `playwright` | Required when the loop has visual/runtime behavior |
| 9 | `skill-visual-feedback` | Best for visual correction after screenshots or UI review |
| 10 | `skill-writing-plans` | Useful only when a loop grows beyond one narrow enhancement |

### 2.2 Best Phantom BOM / evidence surfaces

Use these existing surfaces as the loop evidence engine:

| Surface | Why it matters |
|---|---|
| `src/phantom-bom.ts` | Existing supply/pattern extractor with deterministic Tree-sitter-first extraction |
| `src/services/phantom-skill-router.ts` | Already computes evidence-based routing patterns |
| `src/routes/phantom-bom.ts` | Public API surface for extraction, providers, clusters |
| `docs/PHANTOM_PRIORITY_NOW.md` | Best internal playbook for which phantom patterns change behavior fastest |
| `docs/FLEET_LEARNING_MAXIMIZATION_PLAN.md` | Shows how Phantom BOM should feed learning and routing, not sit idle |

### 2.3 Best knowledge sources

These should drive frontend decisions first:

| Source | Why it matters |
|---|---|
| `docs/FRONTEND_CORE_PLAN.md` | Canonical route/value-prop roadmap for `cc-v4` |
| `@widgetdc/contracts` | Canonical request/response and orchestration contracts |
| `src/routes/prompt-generator.ts` | Existing natural-language → skill mapping patterns |
| `src/intent/intent-router.ts` | Canonical skill composition patterns and trigger logic |
| existing `cc-v4/src/routes/_authenticated/*` | Real local UI conventions you should extend rather than replace |

### 2.4 Best templates

These templates should govern the 20 loops:

| Template | Source | Purpose |
|---|---|---|
| `Research → Standard` | `phantom-skill-router` | Find known route/component/API patterns before new design |
| `Reuse Before Design` | `phantom-skill-router` | Prefer existing UI, route, store, or contract surfaces |
| `Standard → Implementation` | `phantom-skill-router` | Implement only after pattern and contract are clear |
| `AgentRequest → AgentResponse` frontend facade | `docs/FRONTEND_CORE_PLAN.md` | Preserve contract-first frontend behavior |
| `Verify before claim` | repo governance | Every loop ends with type/runtime/read-back verification |

---

## 3. Canonical Loop Template

Each enhancement loop should follow this exact template:

### Loop Input

- `target_surface`
- `user_value`
- `route_or_component`
- `current_gap`
- `acceptance_signal`

### Loop Steps

1. **Intent lock**
   - What user-facing outcome is this loop trying to improve?

2. **Evidence harvest**
   - Check `FRONTEND_CORE_PLAN`, local route patterns, and Phantom evidence.

3. **Reuse scan**
   - Check whether the route, component, store, contract, or prompt surface already exists.

4. **Narrow design**
   - Define the smallest meaningful improvement.

5. **Implement**
   - Ship the code change.

6. **Verify**
   - Typecheck, targeted tests, visual/runtime check.

7. **Deposit learning**
   - Record what pattern worked, what failed, and what should be reused next loop.

### Exit Gate

A loop is complete only if all are true:

- type-safe or explicitly isolated,
- UI behavior improved in a user-visible way,
- no contract drift introduced,
- verification evidence exists,
- next loop is clearer because of this loop.

---

## 4. The 20 Loops

These 20 loops are ordered for maximum frontend leverage.

### Foundation Loops

1. **Type Substrate Stabilization**
   - Finish strict TS cleanup in `cc-v4` so new work is judged on signal, not environment noise.

2. **Shared Response Layer Hardening**
   - Harden `agent-client`, telemetry, jobs, and shared response cards.

3. **Authenticated Shell Upgrade**
   - Make the authenticated layout feel like a real operator product, not a placeholder shell.

4. **Navigation Clarity**
   - Rework sidebar labels/grouping around V-props and operator tasks.

5. **Error and Empty States**
   - Standardize loading, empty, degraded, and failure states across authenticated routes.

### Proof-Facing Revenue Loops

6. **V1 Compliance Audit Route**
   - Make `/compliance/audit` the strongest first-value demo path.

7. **V3 Cost Story Route**
   - Make `/engagements/[id]/costs` legible, executive, and consultative.

8. **V4 Deliverable Draft Route**
   - Turn `/deliverable/draft` into a high-trust progress-driven workflow.

9. **V5 Drift Route**
   - Make `/fleet/drift` visually useful, not just a data dump.

10. **Citation Rendering Loop**
   - Build professional citation/footnote rendering for V1/V4 outputs.

### Product Confidence Loops

11. **Session Cost Visibility**
   - Make `<CostBadge />` and cost breakdown obviously useful.

12. **Job Progress Experience**
   - Upgrade long-running jobs from spinner behavior to staged system behavior.

13. **Conflict Resolution UX**
   - Make agent conflicts feel actionable, not scary or opaque.

14. **Search / Strategy Indicator**
   - Make route-level reasoning and retrieval strategies visible where they matter.

15. **Sign-In / Trust Layer**
   - Make auth and platform entry feel intentional and operationally credible.

### Experience Polish Loops

16. **Typography and Tone System**
   - Remove generic dashboard tone; move toward consulting-grade visual voice.

17. **Color and Density System**
   - Improve hierarchy, rhythm, and contrast without bloating the UI.

18. **Motion and Transition Discipline**
   - Add only meaningful motion: stage progress, reveal order, state transitions.

19. **Responsive Readability**
   - Ensure tablet/mobile read-only support is genuinely usable.

20. **Demo Narrative Pass**
   - Tune the core journey so a stakeholder can move from sign-in to first result without confusion.

---

## 5. How to Route Each Loop

Use this routing table.

| Loop type | Primary pattern | Skills |
|---|---|---|
| Unknown route/problem | `flow-discover` | `skill-intent-contract` → `flow-discover` → `skill-verify` |
| Existing route needs tightening | `reuse-before-design` | `skill-intent-contract` → `flow-develop` → `flow-deliver` → `skill-verify` |
| Shared component/system loop | `research-to-standard` | `skill-intent-contract` → `flow-discover` → `octopus-architecture` → `flow-develop` |
| Visual quality loop | `standard-to-implementation` | `skill-intent-contract` → `skill-extract` → `playwright` → `skill-visual-feedback` → `skill-verify` |
| Demo-flow loop | `reuse-before-design` | `skill-intent-contract` → `flow-develop` → `flow-deliver` → `playwright` |

---

## 6. Loop Scoring

Every loop should be scored before running.

`loop_score = (proof_value * 0.35) + (user_clarity * 0.25) + (reuse_gain * 0.15) + (visual_gain * 0.15) + (verification_ease * 0.10)`

Run highest-score loops first.

Interpretation:

- `proof_value`: Does it improve V1/V4/demo strength?
- `user_clarity`: Does it reduce confusion or friction?
- `reuse_gain`: Does it improve shared primitives or multiple routes?
- `visual_gain`: Does it materially improve perceived product quality?
- `verification_ease`: Can we verify it cheaply and clearly?

---

## 7. What Not to Do

Do **not** let the 20 loops become:

- a cockpit/architecture UI detour,
- random “make it prettier” edits,
- broad refactors with no proof-facing output,
- raw LLM-driven redesign without local pattern reuse,
- unverified visual changes,
- feature creep into mission control before the proof flows are strong.

---

## 8. First 5 Loops to Run Now

If execution starts immediately, run these first:

1. Type Substrate Stabilization
2. Shared Response Layer Hardening
3. Authenticated Shell Upgrade
4. V1 Compliance Audit Route
5. V4 Deliverable Draft Route

This sequence maximizes proof-readiness while building reusable frontend leverage.

---

## 9. Success Metrics

The 20-loop program is working if these improve:

- TypeScript strict errors in `cc-v4` trend to zero or are explicitly isolated.
- First-demo path becomes shorter and more legible.
- Shared primitives are reused across multiple routes.
- V1 and V4 look credible in screenshots without explanation.
- Long-running flows communicate state, confidence, and cost clearly.
- Operators need less narration from us to understand the UI.

---

## 10. Final Recommendation

The strongest execution model is:

- **Phantom BOM for evidence**
- **Frontend Core Plan for route priorities**
- **Contract-first types for safety**
- **Skill composition for discipline**
- **20 narrow enhancement loops for momentum**

That gives you a frontend improvement engine, not just another backlog list.
