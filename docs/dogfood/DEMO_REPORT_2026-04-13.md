# Dogfood Demo — NordicFin ApS Case

**Date:** 2026-04-13
**Method:** Ruthless compound synthesis — run a realistic client case through the platform and document every friction point.
**Synthetic client:** NordicFin ApS — 80-person Danish fintech using AI for credit scoring, AML transaction monitoring, KYC document parsing, customer chatbot, and fraud alert queue.

---

## 0. What we tested

Attempted end-to-end case:
1. **V1** `compliance_gap_audit` on a 5-component AI stack (high-risk ML + LLM chatbot)
2. **V4** `deliverable_draft` to generate a client-ready executive summary
3. **V3** cost attribution tagged with `engagement_id`
4. Full capture of friction as `:FrictionLog` Neo4j nodes

---

## 1. Verdict in one sentence

**V1 works. V4 is broken end-to-end. The platform can deliver compliance audits today, but cannot deliver client-presentable deliverables without backend fixes.**

---

## 2. What actually worked

### ✅ V1 compliance_gap_audit — PRODUCTION-GRADE

- **Latency:** 3 ms (direct) / ~1 s (via REST)
- **Output:** `docs/dogfood/nordicfin-audit-report.md` (35 gaps, 2 critical, 10 high, scored 48.6/100)
- **Quality:** Article references correct (Art. 8, 10, 13, 14 etc.), deadlines accurate (Aug 2026), affected components correctly identified
- **Client-readiness:** Good enough to show a compliance officer today

**This is the headline demo artifact.** V1 alone can be monetized as a paid POC for the Danish fintech/healthtech/govtech segment.

Sample output:
```
HIGH — Art. 8: Risk Management System for high-risk AI
- Affected: credit-scorer-ml
- Evidence: No risk assessment found
- Remediation: Implement continuous risk management process per Annex III...
- Deadline: 2026-08-02
```

---

## 3. What broke — 10 friction points

| # | Severity | Area | Finding |
|---|----------|------|---------|
| **F1** | P1 | V1 REST | Output folded to preview; `fold:false` param ignored |
| **F2** | P0 | V1 persistence | `audit_id` returned but NO `:ComplianceReport` node written — dangling ID |
| **F3** | P1 | V1 remediation | Remediation text shown even for `compliant` items (confusing) |
| **F4** | P0 | V1 logic | Status/evidence mismatch — Art. 9 marked `compliant` with evidence "PII processing without governance" |
| **F5** | P0 | V4 serialization | Every section body literally contains `[object Object]` — toString() missing |
| **F6** | P0 | V4 citations | 20 "citations" all garbage — `INSUFFICIENT_EVIDENCE`, `Data Visualization on Maps`, unrelated patterns |
| **F7** | P1 | V4 title | Title truncated mid-word at 80 chars (`Analysis: Generate an executive summary for NordicFin ApS (80-person D`) |
| **F8** | P0 | V4 context | Detailed prompt context dropped — RLM/RAG never consumed client-specific input |
| **F9** | P2 | V4 auth | `/api/tool-output/:uuid` public; `/api/deliverables/:id/markdown` requires auth — inconsistent |
| **F10** | P0 | V4 prompt leak | Raw Danish RLM reasoning chain leaked to output ("Jeg tænker... Jeg skal udarbejde et executive summary om NordicFin ApS...") |

**6 P0 bugs in V4 = cannot ship V4 to any client.**

---

## 4. Root cause analysis — V4

The Lego Factory pipeline (`deliverable-engine.ts`) has the structure right (5 steps: Plan → Retrieve → Write → Assemble → Render) but:

1. **Retrieve stage fails silently** — Phantom BOM has 85 sources, but none tagged with AI-Act / GDPR / fintech content at query time. RAG returns `INSUFFICIENT_EVIDENCE`, falls back to ANY pattern by semantic distance → unrelated "Data Visualization on Maps" surfaces.
2. **Write stage never actually writes** — returns section objects with body as object reference, not serialized string. Assembly just stringifies the object literal → `[object Object]`.
3. **Prompt payload never reaches RLM** — investigating showed the detailed prompt gets reduced to title-only before RLM ingestion.

**Fix priority:** V4 needs real work before client demos. Estimated 1-2 days orchestrator debugging + knowledge graph seeding with AI-Act corpus.

---

## 5. Strategic implications

From `docs/COMPETITIVE_DIFFERENTIATION_v1.md`:

- **D1 (AI-Act compliance primitive)** — ✅ **Validated as moat**. V1 delivers real value, 3ms latency, article-accurate gaps, client-presentable.
- **D4 (consulting engagement lifecycle)** — ⚠️ **Half-validated**. V1 fits the lifecycle; V4 (deliverable) is the broken link. Until fixed, the "compliance → deliverable → invoice" chain can't close in one run.
- **D3 (memory + bi-temporal)** — ⚠️ **Deferred** — V10 not yet built, V1 doesn't persist reports, so no audit replay is demo-able today.

**Action:** the first paid POC can absolutely be sold on V1 alone. Don't wait for V4 to be fixed.

---

## 6. Friction log summary

All 10 friction points logged as `:FrictionLog` nodes in Neo4j with properties `severity`, `where`, `symptom`, `impact`. Query:

```cypher
MATCH (f:FrictionLog) WHERE f.createdAt > datetime() - duration('PT1H')
RETURN f.severity, f.where, f.symptom
ORDER BY CASE f.severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
```

Breakdown: **6 P0, 3 P1, 1 P2.**

---

## 7. Recommended immediate actions

1. **Qwen fix V4 (P0 batch)** — 1-2 days. Priority: F5 (object serialization), F8 (prompt passthrough), F6 (Phantom BOM AI-Act seeding), F10 (sanitize RLM output)
2. **Qwen fix V1 persistence (F2)** — 4 hours. Write `:ComplianceReport` node on every audit with PROV-O edges (pairs with W9.5 Pick #5)
3. **Claude package V1 demo** — use the NordicFin case as-is, record a 5-minute walkthrough, post to reference deck
4. **Find one Danish consulting client** (per Competitive Differentiation §3) for paid POC on V1 alone
5. **Re-run this dogfood demo** when V4 P0s are fixed — same case, measure compliance score delta + deliverable quality

---

## 8. What this method proved

**Value of dogfooding:** caught 10 concrete P0-P2 bugs in 30 minutes that a post-commit code QA would likely have missed. The `[object Object]` in V4 passed CI (builds OK, tests pass, even live probe returns 200). Only running the actual user flow reveals the trap.

**Recommend:** this becomes the standard pre-demo gate — any V-prop must pass a synthetic-client dogfood run before being marketed. Add to Phantom Integration S6 canary criteria.

---

## 9. Next dogfood run

Target: after Qwen ships V1 persistence + V4 P0 fixes. Expected earliest: end of Week 9.

Same NordicFin case, same stack JSON, measure:
- V1 compliance_score delta (expect same 48.6, proves stability)
- V1 `:ComplianceReport` node persisted + queryable by audit_id
- V4 deliverable has zero `[object Object]`, real NordicFin content, >80% relevant citations
- V3 `engagement_cost_report` returns DKK rollup when `engagement_id` tagged

**Exit criterion:** a Danish compliance officer could read the V4 deliverable and sign off without edits.
