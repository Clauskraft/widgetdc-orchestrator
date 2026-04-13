# WidgeTDC × NordicFin ApS — EU AI Act Compliance Audit

**10-slide demo deck | 2026-04-13 | Live audit in 3 ms**

> Target audience: Danish consulting firm CIOs, DPOs, compliance officers.
> Purpose: Hill 1 proof artifact. Uses real output from production V1 audit against NordicFin synthetic stack.
> Source: `docs/dogfood/nordicfin-audit-report.md`, audit_id `ai-act-mnwf44go`.

---

## Slide 1 — The problem

**By 2026-08-02, every EU financial institution deploying AI must prove Annex III compliance.**

- Art. 6 classifies credit scoring, AML, KYC, biometric ID as **high-risk**.
- Art. 14 mandates human oversight. Art. 13 mandates transparency.
- Fines: up to €35M or 7% of global turnover.
- Danish FSA has no tooling to assess your stack. Your auditors don't either.

*Who owns the gap list? Nobody, yet.*

---

## Slide 2 — What a compliance audit looks like today

**Manual, expensive, slow:**

| Step | Who | Cost | Time |
|------|-----|------|------|
| Interview dev teams | Big-4 senior | 50k+ DKK | 2 weeks |
| Catalogue AI systems | Junior consultant | 30k DKK | 1 week |
| Map to Annex III | Senior partner | 80k DKK | 2 weeks |
| Write gap report | Manager | 40k DKK | 1 week |
| **Total (one audit)** | | **~200k DKK** | **6 weeks** |

Deliverable: a PDF with opinions. No reproducibility. No audit trail.

---

## Slide 3 — What WidgeTDC produces in 3 ms

**Live run against NordicFin ApS synthetic stack (5 AI components):**

```
Audit completed in 3 ms
Compliance score: 48.6 / 100
Gaps: 35 total | 2 critical | 10 high | 11 medium | 12 low
Components: 5 (credit-scorer-ml, aml-monitor, customer-chatbot,
             kyc-parser, fraud-queue)
```

Full report generated at `docs/dogfood/nordicfin-audit-report.md`.
Every gap cites the Article, component, evidence, remediation, deadline.

**From 6 weeks + 200k DKK → 3 ms + reproducible.**

---

## Slide 4 — One concrete gap, end to end

```
HIGH — Art. 8: Risk Management System for high-risk AI
  Status:       non-compliant
  Affected:     credit-scorer-ml
  Evidence:     No risk assessment found
  Remediation:  Implement continuous risk management per Annex III.
                Document all known and foreseeable risks.
                Define risk mitigation measures.
  Deadline:     2026-08-02
```

Every gap in NordicFin's 35-gap report has this shape. A junior compliance officer can work the list directly — no interpretation layer needed.

---

## Slide 5 — Why WidgeTDC's audit is defensible (vs generic GPT)

| | Generic LLM ("ChatGPT for compliance") | WidgeTDC |
|---|---|---|
| Jurisdiction | English, generic EU | Danish + EU + Nordic case law |
| Evidence | Hallucinated references | Phantom BOM: 85 curated official sources |
| Audit trail | None | Bi-temporal Neo4j graph, every decision timestamped |
| Reproducibility | Non-deterministic | Same stack → same report, byte-identical |
| Procurement | Black box | Published Constitution v1.0 (CC-BY-SA) |

**This is the D1 moat — not a feature.**

---

## Slide 6 — The consulting firm's economics flip

**Before WidgeTDC:**
- Sell 200k DKK audit. Margin ~25%. One client/quarter per partner.
- Junior time goes to cataloguing. Senior time goes to mapping.

**With WidgeTDC (as a consulting partner):**
- Audit runs in 3 ms. Partner time goes to **remediation planning**.
- Fixed fee 50k DKK POC per client stack → 10× throughput.
- Produce Art. 13 transparency notice + Art. 14 HITL playbook as follow-on work — **where the margin actually lives.**

The consulting firm keeps the client relationship. WidgeTDC never sells direct. Non-disintermediation is Art. 7.4 of our Constitution.

---

## Slide 7 — The deliverable layer (V4)

**Once the gap report exists, V4 generates the client-facing deliverable:**

```
POST /api/tools/deliverable_draft
{
  prompt: "Udarbejd en AI-Act compliance-rapport for NordicFin ApS...",
  type: "assessment"
}

→ 4 sections, 4 citations, 4.6 s, client-presentable markdown
```

No `[object Object]`, no RLM thinking leaks, no hallucinated citations.
Regression-gated by weekly dogfood re-runs (2026-04-13 passed).

---

## Slide 8 — The Constitution (procurement artifact)

**Published 2026-04-13 — `docs/WIDGETDC_CONSTITUTION_v1.md`, 13 articles, CC-BY-SA 4.0**

Covers:
- Canonical contract (interoperability guarantee)
- Memory + provenance (PROV-O + CoALA + bi-temporal)
- Art. 14 HITL primitives
- Data residency + non-disintermediation covenant
- EU AI Act + GDPR + NIS2 + DORA mapping

**When your client's legal team reads it, the procurement conversation gets shorter.**

Regulators can cite it. Competitors can implement against it. The runtime is ours.

---

## Slide 9 — Pricing (Hill 1 POC offer)

**Fixed-fee POC for one Danish consulting firm:**

- Price: **50,000 DKK**
- Scope: One end-client AI stack (≤ 10 systems), full Annex III audit, client-presentable deliverable.
- Turnaround: 24 hours from stack description to delivered report.
- Includes: training session for 3 firm staff, access to WidgeTDC Constitution as citable vendor doc.
- Success metric: client signs remediation plan based on the report.

Goal: 1 signed firm by end of June 2026 (PATH_TO_THE_TOP Hill 1 summit).

---

## Slide 10 — The next 12 months

```
                 ╱◤ Hill 3 (Q2-2027): Category leader
                ╱◤  25+ firms, 2M+ DKK ARR, inbound > outbound
               ╱◤
         ╱◤◤◤◤◤
      Hill 2 (Q3-2026): Open contract + Sovereign EU SKU
      + Marketplace v1. Three firms, 300k DKK/mo ARR.
   ╱◤
╱◤◤◤◤◤
Hill 1 (NOW — Q2-2026): ONE paid Danish firm. One engagement delivered.
Case study published. This deck is that proof.
```

**Right now we are 7 days from the first client meeting.**
Every slide above is running in production.

---

*This deck is a living artifact. Re-generated from production after every dogfood pass.*
*Prepared by: WidgeTDC (Claus Kraft) | For: Danish consulting firm partners | 2026-04-13*
