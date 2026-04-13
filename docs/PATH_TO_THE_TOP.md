# The Path to the Top — WidgeTDC 2026 Strategic Execution Plan

**Date:** 2026-04-13
**Horizon:** 12 months (now → 2027-04)
**North Star:** Be the default platform EU regulated consulting firms run on by Q2 2027.
**Foundation:** 13-source inspiration hunt + dogfood learning + competitive differentiation + WidgeTDC Constitution v1.0

---

## 0. Where we are right now (brutally honest)

**Real strengths:**
- V1 compliance audit works (3 ms, 35 gaps, client-presentable) — **only moat validated in production**
- Canonical AgentRequest/Response contract across 3 repos — **genuine D2 differentiator**
- 8-layer CoALA memory + bi-temporal trajectory (V10 pending) — **D3 in progress**
- 166 MCP tools (too many, need discipline)
- WidgeTDC Constitution v1.0 published — **first procurement artifact**
- Phantom BOM with 85 sources ingested

**Real weaknesses:**
- V4 deliverable still broken in production (6 P0 bugs persist after Qwen's attempted fix hit wrong file path)
- V4 `:ComplianceReport` not persisted despite commit claiming otherwise
- Zero paid clients
- Zero self-serve path
- No multi-language SDK
- No sovereign EU SKU
- Mission Control not shipped
- Marketplace not designed
- 49 ACI compliance warnings on existing tools (fixable but untouched)

**The single biggest delta between where we are and where we need to be:** **V4 must work client-ready within 7 days** or our D1+D4 moats remain theoretical.

---

## 1. The 3-hill summit model

Climbing to the top isn't one move. It's three compounding hills, each with its own summit:

```
                               ╱◤ Hill 3: Category
                              ╱◤  Own "EU Regulated Consulting AI"
                             ╱◤   in regulator / analyst language
                            ╱◤
                      ╱◤◤◤◤◤
                  Hill 2: Moat
                  Open contract + sovereign SKU + marketplace
                  + Constitution as procurement weapon
             ╱◤
      ╱◤◤◤◤◤
   Hill 1: Proof
   One paying Danish consulting firm live on V1+V4
   with measurable outcome + testimonial
```

Each hill takes ~3-4 months. Falling off Hill 1 breaks the whole climb. Falling off Hill 2 caps us at boutique niche. Falling off Hill 3 leaves us commoditized within 24 months.

---

## 2. Hill 1 — PROOF (Now → Q2 2026, 3 months)

**Summit condition:** 1 paying Danish consulting firm, 1 real EU-client engagement delivered end-to-end on WidgeTDC, documented case study with measurable outcome (hours saved, compliance gaps found, deliverable quality uplift).

### 2.1 Must-ship this month (April 2026)

| # | Task | Owner | Effort |
|---|------|-------|--------|
| 1.1 | **V4 deliverable actually works** — F5 `[object Object]`, F6 junk citations, F10 RLM thinking leaks all fixed in `deliverable-engine.ts` (not where Qwen fixed) | Claude (just shipped commit pending) | 2h |
| 1.2 | **V1 `:ComplianceReport` persistence** — `persistComplianceReport()` must actually MERGE to Neo4j, verified by round-trip query | Qwen | 4h |
| 1.3 | **Phantom BOM AI-Act seeding** — ensure srag.query returns compliance-domain evidence, not "Data Visualization on Maps" | Qwen | 1 day |
| 1.4 | **Dogfood re-run** — NordicFin case produces client-presentable output, zero `[object Object]`, ≥80% relevant citations | Claude | 2h |
| 1.5 | **V1 demo deck** — 10-slide investor/client deck with real NordicFin output | Claude | 1 day |

### 2.2 Must-ship by end of May 2026

| # | Task | Effort |
|---|------|--------|
| 1.6 | **Landing page** — widgetdc.io with Constitution link + V1 audit demo + Danish/English | 3 days |
| 1.7 | **First outreach** — 10 Danish consulting firms (Net-DK, Implement, Accenture Nordic) cold email with demo deck | Claus + week |
| 1.8 | **Pricing page** — V1 audit as fixed-fee POC: 50,000 DKK for one client stack + 24h turnaround | Claus |
| 1.9 | **CoALA tier memory** (Qwen W8.5 in flight) — verified in production | Qwen |
| 1.10 | **Typed tool taxonomy** (5 categories, Palantir AIP pattern) retrofit | Qwen |

### 2.3 Must-ship by end of June 2026

| # | Task |
|---|------|
| 1.11 | **1 signed paid POC** with a Danish consulting firm |
| 1.12 | **Engagement delivered** — client stack audited, deliverable produced, audit trail exported |
| 1.13 | **Case study written** — measured time-to-gap-report, before/after comparison, firm testimonial |
| 1.14 | **Firm-facing runbook** — how a consultant uses WidgeTDC without seeing the engine |

**Summit of Hill 1 = case study published.** This is the proof document every future pitch references. Without it, we're a thesis.

---

## 3. Hill 2 — MOAT (Q3 2026, 3 months)

**Summit condition:** Competitors (OpenAI, Palantir, CrewAI) cannot easily replicate our EU regulated consulting story. Three concrete deliverables lock this in.

### 3.1 Open-source the canonical contract (Anthropic playbook)

- Target foundation: Linux Foundation / Agentic AI Foundation (where MCP lives) OR Eclipse (EU-hosted alternative)
- Spec: `@widgetdc/contracts` canonical `AgentRequest`/`AgentResponse` + Phantom BOM schema
- License: MIT + CC-BY-SA for schema docs
- Governance: RFC process, versioned, backward-compatible for 24 months
- **GTM move:** "Regulators, you can cite this spec in your AI-Act compliance guidance. Competitors, you can implement it, but the runtime + memory + agents are ours."

Effort: 2 weeks legal + 1 week spec rehash + 4 weeks outreach. Start April 15.

### 3.2 Sovereign EU SKU (OpenAI counter)

**Why:** OpenAI's Compliance Platform is 80% plumbing-complete. "ChatGPT for Compliance" launches Q3 2026 realistically. We must ship **before their EU data boundary for agents**.

Components:
- EU-hosted Railway (already have this)
- BYO-KMS option for Neo4j AuraDB
- Air-gapped deploy option for Tier-1 regulated clients (ship a Docker Compose + Helm chart)
- Per-region pinning: EU-only inference routing via `llm-proxy.ts` with Anthropic Claude EU + Azure OpenAI EU endpoint + DeepSeek+Groq as non-EU fallback gated by operator setting
- Publish data-residency attestation document

Effort: 4 weeks. Start May 1.

### 3.3 Marketplace v1 (Uber + Shopify + GitHub playbooks)

- `:Job`, `:Bid`, `:Settlement` node schema designed (1-day spike, already recommended)
- External agent registration via canonical IAgent contract
- 15% take rate, zero under 50k DKK lifetime
- Rating → routing weight (pheromone feedback loop already exists)
- Signed agent manifests (ACL + capability attenuation)
- **Critical:** non-disintermediation covenant (platform cannot contact end-clients without firm consent) — Article 7.4 of Constitution

Effort: 4 weeks build + 2 weeks partner onboarding. Start June 1.

### 3.4 Other Hill 2 deliverables

| Deliverable | Source | Effort |
|-------------|--------|--------|
| Adopt Temporal as durability layer (replace Redis checkpoint FSM) | Temporal.io hunt | 2 weeks |
| V4 rewritten as block-tree deliverables (Notion + Figma pattern) | Notion+Figma hunt | 2 weeks |
| 3-layer eval harness (TestCase/Grader/Metrics) | Palantir AIP deep | 1 week |
| Danish-language jurisdictional corpus ingest (Datatilsynet precedent, AI-Act DA translation) | OpenAI counter + D1 moat | 2 weeks |
| "Regulator Mode" read-only seat | Figma Dev Mode | 1 week |
| Mission Control ships (W13-14) | Frontend core plan | 4 weeks |

**Summit of Hill 2:** all three anchor deliverables (open contract + sovereign SKU + marketplace) + 3 firms signed + Mission Control live. This is when we stop being a thesis and become a **category**.

---

## 4. Hill 3 — CATEGORY (Q4 2026 → Q2 2027, 6 months)

**Summit condition:** When an EU regulated consulting firm's CIO needs AI for an audit, they don't say "let's pick an agent framework" — they say "let's use WidgeTDC."

This is a language game as much as a technology game.

### 4.1 The "Regulated Consulting Intelligence Cloud" positioning

Stop calling WidgeTDC an "agent platform." That word is owned by AutoGen/CrewAI/LangGraph and commoditized. Instead:

- **Website hero:** "The Regulated Consulting Intelligence Cloud — AI-Act compliance, bi-temporal audit trails, coordinated agent fleets, ready for EU clients on day one."
- **Analyst briefings:** Gartner, Forrester, IDC, Omdia — position category name, not feature list
- **Sales decks:** never lead with agents; lead with "turn EU compliance from cost center to productized revenue"
- **Case studies:** "hours saved," "gaps found," "audit trail depth" — never "tokens generated"

### 4.2 Category anchors

| Move | What |
|------|------|
| **Quarterly inspection report** | Publicly verified metrics (uptime, drift incidents, compliance audit quality) — auditor-signed |
| **Vertical expansion** | Medical compliance (HIPAA + MDR), Financial advisory (MiFID + Basel + DORA), Legal research (EU case law) — Shopify Eats playbook |
| **Research + standards** | Publish whitepapers jointly with EU AI Office / Datatilsynet / ENISA on AI-Act operationalization |
| **Conference presence** | AIPCon attendees poached for Nordic regulated conference; WidgeTDC Summit 2027 in Copenhagen |
| **Partner network** | Big-4 Nordic (Deloitte DK, KPMG DK, EY DK, PwC DK) + 5 boutique specialist firms |

### 4.3 Financial trajectory check

For Hill 3 to be real, by Q2 2027:
- 25+ consulting firms on WidgeTDC (pilot + paid)
- 10+ paying enterprise clients (via consulting firms)
- ARR target: 2-4M DKK/month = 24-48M DKK/year
- Staff: 6-10 (currently 1 + Claude/Qwen/Gemini)
- Fundraising: Seed extension or Series A (if marketplace traction)
- Burn: <50k DKK/month operating cost

If trajectory misses by >30% at any quarter mark → reforecast, not pretend.

---

## 5. The daily rhythm that gets us there

Three interlocking loops:

### 5.1 Weekly dogfood loop (Claude)
- Monday: pick one real or synthetic client case
- Run through V1 + V4 + V7 + relevant V-props end-to-end
- Log every friction as `:FrictionLog`
- Friday: prioritize top 3 frictions for Qwen + measure compounding fixes
- Publish dogfood diary weekly — transparency is marketing

### 5.2 Biweekly inspiration hunt (Claude)
- Every 2 weeks: 1 new competitor or inspiration source analyzed
- Add to `INSPIRATION_HUNT_v*.md` family
- Kill outdated moves from roadmap; promote high-conviction moves

### 5.3 Monthly constitution review (Governance Council)
- Track regulation changes (EU AI Office guidance updates, case law)
- Amend Constitution via RFC
- Publish operator commitment updates

These three rhythms replace the need for meetings-about-roadmaps. The rhythm IS the roadmap.

---

## 6. Stop-doing list (what we kill to make space)

1. ❌ **Building our own durable-workflow engine** — adopt Temporal (Hill 2 §3.4)
2. ❌ **Competing on agent framework features** vs AutoGen/LangGraph — we're not that, stop pretending
3. ❌ **Adding more MCP tools without ACI compliance** — 166 is too many, quality > quantity
4. ❌ **Planning documents that don't change behavior** — this doc is the last strategic planning doc for 3 months; after this it's execution + dogfood + inspiration
5. ❌ **Serving every vertical at once** — focus EU regulated consulting; expand to medical/financial only after Hill 2 summit
6. ❌ **Building Langfuse / DSPy equivalents** — absorb, don't compete
7. ❌ **Scope creep on V7 RAG router** — rag_route works today, defer community-summarization until marketplace demands it
8. ❌ **Generic marketing** — stop "AI agent platform" language entirely. Either "EU regulated consulting intelligence cloud" or silence.

---

## 7. Three risks that could kill the climb

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **V4 stays broken — no viable deliverable demo** | Existential | Fix THIS WEEK (this commit); if Qwen can't land it, Claude writes the rewrite |
| **OpenAI ships "ChatGPT for Compliance" Q3 2026** | Very high | Sovereign EU SKU + Danish corpus depth before they ship; file open-source contract claims |
| **No paid client by end of June 2026** | Very high | Hill 1 summit deadline is fixed; if we miss, strategic pivot conversation required — consulting-firm partners vs solo sales |

These are tracked weekly. Any drift → escalate immediately, not at quarter close.

---

## 8. Success signals (how we know we're climbing)

| Signal | Hill 1 | Hill 2 | Hill 3 |
|--------|--------|--------|--------|
| Paid consulting firms | 1 | 3 | 25+ |
| Monthly ARR | 50k DKK | 300k DKK | 2M+ DKK |
| Enterprise reference logos | 1 | 3 | 10+ |
| Contract cited in regulatory guidance | 0 | 1 | 3+ |
| Inbound vs outbound inquiries | 100% outbound | 50/50 | 70% inbound |
| Marketplace agents (external devs) | 0 | 3 | 30+ |
| Partner network size | 0 | 5 | 20+ |
| Case studies published | 1 | 5 | 20+ |

---

## 9. The one thing that matters most this week

**Fix V4. Run the dogfood again. Get ONE client meeting on the calendar.**

Everything else — Constitution, inspiration hunts, competitive audits, Uber-style marketplace dreams — is preparation for that meeting. No meeting, no Hill 1, no climb.

The commit just pushed fixes the real bug in `deliverable-engine.ts:407` where Qwen missed it. If that compiles + deploys + produces a NordicFin deck without `[object Object]`, we're ready for meeting #1. If not, back to debugging.

**Constitution is the procurement document. V4 is the demo. Together they win the first meeting. Everything else is the climb.**

---

## 10. Revision

Next review: 2026-05-13 (monthly rhythm). Adjust hills based on:
- Dogfood signal (what's actually broken vs documented)
- Client signal (what consulting firms ask for)
- Competitor signal (who shipped what in the window)
- Financial signal (burn vs runway)

If this doc hasn't been materially revised by 2026-07-13, something is wrong — we're either not learning fast enough or not executing fast enough.

---

*This is the last strategic plan for 3 months. Execute.*
