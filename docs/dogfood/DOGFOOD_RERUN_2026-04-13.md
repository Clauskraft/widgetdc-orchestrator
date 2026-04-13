# Dogfood Re-run — 2026-04-13 (post V4 fix)

**Per PATH_TO_THE_TOP §2.1 Step 1.4** — verify V4 deliverable produces client-presentable output without `[object Object]`, `<think>` leaks, or "Jeg tænker" narrator leaks.

## Environment
- Orchestrator: `orchestrator-production-c27e.up.railway.app`, v4.3.0, commit `7083cd9`
- RLM: `rlm-engine-production.up.railway.app`, commit `7a5af7d` (LIN-769 force_retrieval active)
- Run at: 2026-04-13T01:17Z
- Test case: NordicFin ApS — 5 critical AI-Act gaps

## Test invocation

```
POST /api/tools/deliverable_draft
{
  "prompt": "Udarbejd en EU AI-Act compliance-rapport for NordicFin ApS. Audit fandt 5 kritiske gaps: credit-scorer-ml mangler Art 14 human oversight og Art 13 transparency, kyc-document-parser mangler data governance, customer-chatbot mangler PII governance. Giv konkrete remediation-skridt per Art 6.",
  "type": "assessment"
}
```

## Result

```
deliverable_id   widgetdc:deliverable:1f4fed3d-fcde-47b3-b488-0f4e027fca0d
sections_count   4
total_citations  4
generation_ms    4671
status           completed
format           markdown
```

## Regression checks

| Bug class | Previous (v1) | This run |
|-----------|---------------|----------|
| `[object Object]` content | **PRESENT** (F5) | ✅ absent |
| `<think>` tag leak | **PRESENT** (F10) | ✅ absent |
| "Jeg tænker/skal..." narrator | **PRESENT** (F10) | ✅ absent |
| Junk citations (gibberish domains) | **PRESENT** (F6) | ✅ absent (4 domain-filtered citations) |
| RLM schema mismatch | **PRESENT** (F4) | ✅ absent |
| Sections generated | 0–2 | ✅ 4 |

## Verdict

**V4 is client-presentable.** All known P0/P1 regressions from prior dogfood runs are fixed. Deliverable-engine at `src/engagement/deliverable-engine.ts:407` now correctly extracts nested RLM responses, strips thinking leaks, and filters citations by domain relevance.

## New findings (filed in this session)

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| LIN-768 | `rag_route` dynamic import to missing bundled path | P0 | Done (commit `d4c9b28`) |
| LIN-769 | RLM `retrieval_policy` ignores caller-forced override | P1 | Done (commit `7a5af7d`) |
| — | `artifact_get` / `artifact_list` / `decision_*` / `drill_*` / `loose_ends_scan` all had identical `./routes/*` import bug | P0 | Done (commit `7083cd9`) |

The third item is a pattern find — same root cause as LIN-768, affecting 9 dynamic imports in `src/tools/tool-executor.ts`. Bulk-fixed to `../routes/*`.

## Next action per PATH_TO_THE_TOP

- [ ] §2.1 Step 1.5 — V1 demo deck (10-slide investor/client deck with NordicFin output)
- [ ] §2.2 Step 1.6 — Landing page (widgetdc.io) with Constitution + V1 audit demo
- [ ] §2.2 Step 1.7 — First outreach: 10 Danish consulting firms
- [ ] Standing order: persistent CI guard against `./routes/*.js` (or any nested dir) dynamic imports emerging in `src/tools/` again
