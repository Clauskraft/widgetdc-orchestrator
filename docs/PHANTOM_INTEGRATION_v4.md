# Phantom Integration v4 — From Harvest to Platform Improvement

**Date:** 2026-04-13
**Purpose:** Close the loop. A harvested phantom is not "done" when it's a `:ExternalKnowledge` node — it's done when its patterns are **in our code**, measurably improving a platform metric.
**Status:** Gap identified post-W7 QA. 85 phantoms ingested in Week 5; zero integration contract until now.

---

## 0. The open loop we had

```
Discover (S1)  →  Normalize (S2)  →  Ingest (S3)  →  Verify (S4)  →  ??? → System improves
```

Week 5 Phantom BOM harvest delivered 85 `:ExternalKnowledge` nodes linked to a
`:ResearchMission`. After that: nothing. No integration backlog, no mapping to
modules, no measurement of whether ingesting a phantom actually helped.

This document specifies the missing stages **S5 (Extract-to-Patch) → S6 (Gate) →
S7 (Measure) → S8 (Rollout or Retire)**.

---

## 1. Per-phantom lifecycle

Every `:ExternalKnowledge` node passes through 8 stages. S1–S4 already run via
`agentic_snout_ingest`. S5–S8 are new.

| Stage | What happens | Where |
|-------|-------------|-------|
| S1 Discover | Find candidate via crawler / research-mission | RLM `/research/curate`, `research_harvest` |
| S2 Normalize | Map to snake_case + `$id`, check license | `agentic-kit/snout_ingestor.py` |
| S3 Inject | Create `:ExternalKnowledge` node + `[:DISCOVERED_BY]->` mission | `agentic_snout_ingest` |
| S4 Verify | License check + audit.run + dedup vs. graph | existing |
| **S5 Extract-to-Patch** | Propose concrete code/config patch per pattern | **new: `phantom-patch-proposer`** |
| **S6 Gate** | Dry-run + feature-flag + canary eval | **new: `phantom-canary-gate`** |
| **S7 Measure** | Before/after flywheel-pillar + adoption delta | **new: `phantom-measure`** |
| **S8 Rollout or Retire** | Full rollout with pheromone attraction OR mark `retired` with reason | **new: `phantom-rollout`** |

Every stage transition writes to the phantom node:

```cypher
SET ek.integration_stage = $stage,     // 'discovered' | 'normalized' | ... | 'retired' | 'integrated'
    ek.stage_history = coalesce(ek.stage_history, []) + [{stage: $stage, at: datetime(), agent: $agent}]
```

---

## 2. S5 — Extract-to-Patch (the missing step)

Each `:ExternalKnowledge` has `extractable_patterns: [...]` (string array).
The Extract-to-Patch step turns each pattern into a concrete, reviewable
code or schema patch.

### 2.1 Patch proposal contract

New node type: `:PhantomPatch` linked to its source phantom.

```cypher
CREATE (p:PhantomPatch {
  id: randomUUID(),
  phantom_id: $ek_id,
  pattern_text: $pattern,             // e.g. "bi-temporal edge validity windows"
  target_module: $module,              // e.g. "src/memory/bitemporal-facts.ts"
  target_repo: $repo,                  // 'widgetdc-orchestrator' | 'WidgeTDC' | ...
  patch_type: $type,                   // 'code' | 'schema' | 'prompt' | 'config' | 'ontology'
  estimated_loc: $loc,                 // lines of code / schema chars
  expected_metric_impact: $metric,     // 'flywheel.compound +0.02' / 'V4 cost -15%'
  risk_level: $risk,                   // 'low' | 'medium' | 'high'
  proposed_at: datetime(),
  proposer_agent: $agent,
  status: 'proposed'                   // proposed | approved | in-progress | merged | rejected
})
MERGE (p)-[:DERIVED_FROM]->(ek:ExternalKnowledge {id: $ek_id})
```

### 2.2 Proposer agent

New MCP tool: `phantom_patch_propose`

Takes `phantom_id`, uses RLM + `document_convert` on the source repo/paper
(fetched lazily), produces 1–N `:PhantomPatch` candidates.

```bash
curl -s -H "Authorization: Bearer $ORCH_KEY" -H "Content-Type: application/json" \
  -d '{"phantom_id":"<ek_id>","max_patches":3}' \
  $ORCH/api/tools/phantom_patch_propose
```

Response: array of patch proposals, each with `target_module`, `estimated_loc`,
`expected_metric_impact`, `risk_level`, `draft_diff` (unified diff preview).

### 2.3 Priority queue — which phantom first?

Weekly cron `phantom-integration-scan` (Monday 08:00 UTC, after flywheel) ranks
pending phantoms by expected impact:

```cypher
MATCH (ek:ExternalKnowledge)
WHERE ek.integration_stage IS NULL OR ek.integration_stage = 'verified'
WITH ek, ek.monster_value_score AS score,
     size(coalesce(ek.extractable_patterns,[])) AS patterns,
     duration.inDays(date(), date(ek.extractedAt)).days AS age_days
RETURN ek.id, ek.name, ek.category,
       score * patterns * (1 / (1 + age_days / 30.0)) AS priority_score,
       ek.source AS url
ORDER BY priority_score DESC LIMIT 10
```

Cron auto-invokes `phantom_patch_propose` for the top-3, creating fresh
`:PhantomPatch` nodes ready for S6.

---

## 3. S6 — Gate (canary + feature flag)

Every `:PhantomPatch` with `status:'approved'` runs through a gated rollout:

1. **Feature flag created** per patch (e.g., `PHANTOM_PATCH_<id>_ENABLED=false`)
2. **A/B canary**: 10% of relevant traffic sees the patched path, 90% the baseline
3. **Eval harness** from Phantom BOM candidate `#C METR/task-standard` patterns
4. **Gate decision**: if measurable lift on target metric after 7 days canary →
   promote. Otherwise retire.

Gate tool: `agentic_canary_evaluate` (already in registry — reuse).

### 3.1 Gate contract

```cypher
MATCH (p:PhantomPatch {id: $patch_id})
SET p.canary_flag = $flag_name,
    p.canary_started_at = datetime(),
    p.canary_traffic_pct = 10,
    p.metric_baseline = $baseline_value,
    p.status = 'canary'
```

After 7 days (cron `phantom-canary-evaluate` — Monday 09:00 UTC):

```cypher
MATCH (p:PhantomPatch {status:'canary'})
WHERE p.canary_started_at < datetime() - duration('P7D')
// Evaluate metric delta
WITH p, $metric_current - p.metric_baseline AS delta
SET p.metric_current = $metric_current,
    p.metric_delta = delta,
    p.status = CASE
      WHEN delta >= p.expected_metric_impact * 0.5 THEN 'approved-for-rollout'
      WHEN delta <= 0 THEN 'retired'
      ELSE 'canary-extended'
    END
```

---

## 4. S7 — Measure

Every phantom integration must prove it helped a specific metric before full
rollout. Measurement piggybacks on what v4 already builds:

| Phantom category | Primary metric | Measurement tool |
|------------------|---------------|------------------|
| A Agent frameworks | Agent success_rate | `runtime_summary` (W4) |
| B KG + memory | RAG precision (cited sources / claims) | `ragas` (Phantom C) if we adopt |
| C Eval harnesses | test coverage / pass@k | V2 `pr_review_parallel` feedback |
| D Consulting knowledge | V1 `compliance_score` distribution | V1 audit reports |
| E Code intelligence | V2 critical_issues caught / PR | V2 merged reviews |
| F Prompts | V9 `quality_score` delta | V9 DSPy loop |
| G Observability | Drift detection lead time | V5 drift cron |
| H Ontology anchors | Graph node/edge growth + query latency | `graph.stats` |

Measurement node:

```cypher
CREATE (m:PhantomMeasurement {
  id: randomUUID(),
  patch_id: $patch_id,
  metric_name: $name,
  baseline: $base,
  current: $current,
  delta_abs: $delta,
  delta_pct: $deltaPct,
  sample_size: $n,
  measured_at: datetime(),
  verdict: $verdict      // 'lift' | 'no-effect' | 'regression'
})
MERGE (m)-[:MEASURES]->(:PhantomPatch {id: $patch_id})
```

---

## 5. S8 — Rollout or Retire

### 5.1 Rollout

On `approved-for-rollout`:
1. Feature flag flipped to 100%
2. **Pheromone attraction deposit** on the source phantom — future discovery
   agents learn "this kind of phantom actually worked":
   ```bash
   pheromone_deposit({type:'ATTRACTION', domain:'phantom-integration',
                      agentId:'phantom-rollout', intensity:0.9,
                      metadata:{phantom_id, category, metric_delta}})
   ```
3. `:PhantomPatch.status = 'merged'`
4. `:ExternalKnowledge.integration_stage = 'integrated'`
5. Closure broadcast to operators + Linear issue closed

### 5.2 Retire

On `retired`:
1. Feature flag removed
2. Patch code reverted (or never merged)
3. **Pheromone alert deposit** — future phantoms of same category get lower priority:
   ```bash
   pheromone_deposit({type:'ALERT', domain:'phantom-integration',
                      agentId:'phantom-rollout', intensity:0.3,
                      metadata:{phantom_id, category, retire_reason}})
   ```
4. `:PhantomPatch.status = 'rejected'`, `retire_reason` populated
5. `:ExternalKnowledge.integration_stage = 'verified-but-retired'` (still in graph,
   searchable, but won't re-surface in priority queue)

---

## 6. Backfill — 85 existing phantoms

Week 5 ingested 85 candidates. Top-12 by monster_value_score are already P0 in
FINAL_PLAN_v4 Week 6–9 (implicit). This doc makes it explicit:

### 6.1 Mapping existing top-12 phantoms to v4 V-props

| Phantom | Score | Expected V-prop integration |
|---------|-------|----------------------------|
| getzep/graphiti | 0.96 | **V10** bi-temporal (already in W9 plan) |
| nibzard/awesome-agentic-patterns | 0.95 | **V6** corpus sync source (W8) |
| microsoft/graphrag | 0.95 | **V7** RAG router strategy: community (W8) |
| OTel gen_ai semconv | 0.95 | **V3**+**V5** wire format for agent_metrics (W6 retrofit) |
| ReAct + Reflexion + ToT | 0.95 | **V9** DSPy loop reference patterns (W9) |
| sickn33/antigravity-awesome-skills | 0.94 | **V6** corpus sync source (W8) |
| princeton-nlp/SWE-bench | 0.94 | **V2** eval harness for pr_review_parallel (W7 retrofit) |
| tree-sitter | 0.94 | Code intelligence foundation — already in orchestrator deps |
| HKUDS/LightRAG | 0.93 | **V7** RAG router fallback (W8) |
| OSU-NLP-Group/HippoRAG | 0.92 | **V7** RAG router PPR strategy (W8) |
| EleutherAI/lm-evaluation-harness | 0.92 | **V9** quality loop eval format (W9) |
| NIST OSCAL | 0.92 | **V1** compliance audit schema (already mapped, W6) |

**Action:** Backfill cron re-scans these 12 and creates `:PhantomPatch` proposals
in Week 8.5 adoption spike. Each proposal gets a Linear issue for human approval
before canary.

### 6.2 Long-tail 73 phantoms

Run `phantom_patch_propose` weekly on next-highest-scored until exhausted.
Retire after 60 days if no proposer agent can map to a module.

---

## 7. Coupling to the Adoption Layer

Every stage in §1 writes standard coordination artifacts from
[`ADOPTION_LAYER_v4.md`](ADOPTION_LAYER_v4.md):

| Stage | Claim | Pheromone | Episode | Lesson |
|-------|-------|-----------|---------|--------|
| S5 Propose | `phantom-propose-<ek_id>` | `INTEL` deposit at proposal | `:Episode` "S5 proposals for <ek>" | — |
| S6 Canary | `phantom-canary-<patch_id>` | `STATUS` at canary start | Episode per canary | `:Lesson` if regression early |
| S7 Measure | — | — | Episode per measurement | — |
| S8 Rollout | `phantom-rollout-<patch_id>` | `ATTRACTION` (merged) / `ALERT` (retired) | Closure episode | `:Lesson` if widely reusable |

This means Mission Control (Week 13–14) automatically sees every phantom in
flight via the generic operator views — no special UI needed beyond one
`/mission/phantoms` dashboard.

---

## 8. New week additions — retrofit into v4 timeline

### Week 7.5 — Phantom Integration Foundation (3 days, after W7)

Deliverables:
1. `:PhantomPatch` schema + Cypher migration (fields in §2.1)
2. `phantom_patch_propose` MCP tool + `src/phantom/patch-proposer.ts`
3. Cron `phantom-integration-scan` (Monday 08:00 UTC)
4. Cron `phantom-canary-evaluate` (Monday 09:00 UTC)
5. Backfill: top-12 phantoms scanned, `:PhantomPatch` nodes created
6. Runbook §12 — Phantom Integration lifecycle + troubleshooting

Exit gates:
- [ ] `:PhantomPatch` nodes exist for top-12 with `status:'proposed'`
- [ ] Priority queue returns expected ranking
- [ ] Linear issues auto-created for each proposal (manual approve)
- [ ] Runbook §12

### Week 9.5 — Phantom Canary + Measurement (3 days, after W9)

Deliverables:
1. Feature-flag framework `config/feature-flags.ts` (if not exists) + CRUD endpoints
2. Canary routing in tool-executor (10% traffic split for flagged tools)
3. `phantom_canary_evaluate` + `phantom_measure` tools
4. `:PhantomMeasurement` schema
5. Auto-promote / auto-retire cron logic
6. 2 backfilled canaries proven end-to-end (e.g., HippoRAG PPR on V7, SWE-bench
   format on V2)
7. Runbook §13

Exit gates:
- [ ] Feature flag lifecycle works (create → canary → promote → cleanup)
- [ ] At least 2 `:PhantomMeasurement` nodes with real deltas
- [ ] One full rollout path (S5 → S8 "merged") demonstrated end-to-end
- [ ] One retire path also demonstrated (to prove regression detection)
- [ ] Runbook §13

---

## 9. Continuous improvement loop — monthly + quarterly

### Monthly — Phantom retrospective (operator review, UI route)

`/mission/phantoms/retro` (new route in W14):
- Phantoms integrated this month: list with `metric_delta`
- Phantoms canaried but not promoted: list with reason
- Phantoms retired: list
- Orphan phantoms (no proposer found after 30 days): flag for manual review or
  second-pass proposer

### Quarterly — Harvest refresh

Every 3 months:
1. Re-run `phantom-bom-harvest` research-mission (same format as 2026-04-12 run)
2. Compare against existing 85+ — flag new arrivals, deprecate stale
3. Retire phantoms where `integration_stage='verified-but-retired'` >180 days old
4. Record quarterly retrospective as `:QuarterlyReport` node

---

## 10. Success metrics

| Metric | Target |
|--------|--------|
| % of monster_value_score ≥0.85 phantoms with `:PhantomPatch` | 100% within 4 weeks of ingestion |
| Mean time from ingest to canary start (for top-quartile phantoms) | <14 days |
| Canary promotion rate | ≥35% (not too loose, not too tight) |
| Canary detected regressions before full rollout | ≥1 per quarter (proves gate works) |
| Measurable platform metric lift per quarter from phantom integration | ≥3 measurable improvements |
| Retired phantoms with lesson captured | 100% |

---

## 11. Anti-patterns (what NOT to do)

- ❌ **Ingest-and-forget** — ingesting a phantom without creating `:PhantomPatch`
  within 30 days is the exact failure mode this doc exists to prevent
- ❌ **Skip canary** — even obviously-good patterns must A/B because context matters
  (stuff that works at hyperscale fails at our scale and vice versa)
- ❌ **Hand-pick favorites** — all P0 priority comes from `priority_score`
  calculation, not taste
- ❌ **Parallel integration infrastructure** — use existing `agentic_canary_evaluate`,
  feature-flag framework, adoption-telemetry. Don't build new canary systems.
- ❌ **Measure without baseline** — every `:PhantomPatch` must capture
  `metric_baseline` BEFORE canary starts
- ❌ **Rollout without closure** — §5.1 step 5 is not optional

---

## 12. Summary

Phantom BOM v1 (Week 5) delivered **85 candidate sources**. Without this
document, they'd sit as `:ExternalKnowledge` nodes forever.

Phantom Integration v4 closes the loop:

```
Harvest (S1-S4)  →  Propose patch (S5)  →  Canary (S6)  →  Measure (S7)  →  Rollout/Retire (S8)
                    ↑                                                          │
                    └────── pheromone attraction / alert feeds next harvest ───┘
```

Every phantom that enters the graph is expected to either **integrate** or be
**retired** within 60 days. Orphans after 60 days are escalated.

This is what makes the 85 phantoms not a trophy shelf but a **continuous
platform-improvement engine**.
