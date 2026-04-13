# Monster Inspiration Hunt v2 — 13 Sources, Compound Synthesis

**Date:** 2026-04-13
**Inputs:** Hunt v1 (Uber, Palantir, Stripe, Cloudflare, Shopify, GitHub, Anthropic) + Hunt v2 (Databricks+Snowflake, Figma, Notion, OpenAI, Temporal.io, deeper Palantir AIP)
**Output:** cross-cutting patterns across all 13, ranked moves, decision register
**Method note:** Hunt v2 had full WebSearch for all 6 subagents; findings are 2026-04 current. Temporal intelligence is especially sharp (full Series D details, pricing, anti-patterns).

---

## 1. The 13 sources at a glance

| # | Source | Primary signature | Depth |
|---|--------|-------------------|-------|
| 1 | Uber | Marketplace + H3 + Cadence + Michelangelo + surge + Jaeger | v1 |
| 2 | Palantir (general) | Ontology-first + kinetic actions + bootcamp GTM | v1 |
| 3 | Stripe | Idempotency + eternal versioning + SDK obsession | v1 |
| 4 | Cloudflare | Durable Objects + AI Gateway + bindings DX | v1 |
| 5 | Shopify | App Store + Liquid + Functions + non-disintermediation | v1 |
| 6 | GitHub | Social git + Actions + Marketplace + Copilot | v1 |
| 7 | Anthropic | Donate protocol + Constitutional AI + tiered fleet | v1 |
| 8 | **Databricks + Snowflake** | Unity Catalog + Delta Sharing + Clean Rooms + context gravity | v2 |
| 9 | **Figma** | LWW-CRDT tree + WASM renderer + dual-context plugin sandbox + Dev Mode | v2 |
| 10 | **Notion** | Blocks as universal unit + databases as views + templates marketplace | v2 |
| 11 | **OpenAI (co-opetition)** | Responses API + Agents SDK + AgentKit + Apps-in-ChatGPT | v2 |
| 12 | **Temporal.io** | Deterministic replay + idempotent activities + versioning disciplines | v2 |
| 13 | **Palantir AIP (deep)** | Typed tool taxonomy (7 kinds) + 3-layer evals + 12-layer architecture | v2 |

---

## 2. What changes after v2 — new signals

### 2.1 Typed tool taxonomy is now 3-source validated — becomes a GO
v1 flagged Palantir's ontology idea at high level. v2 deep-dive revealed Palantir classifies every tool into **5 canonical categories** (Action, Query, Function, Clarify, Command) with typed schemas, property allow-lists, and optional HITL confirmation per Action. Stripe's API has an equivalent discipline (expandable resources, typed errors). Anthropic's MCP is the protocol, Palantir is the tool-taxonomy semantics on top.

**→ Retrofit our 166 MCP tools to 5 canonical categories. This is the single biggest structural move.** Fixes the "Week-N tool not found" syndrome we've hit 4 times (dogfood friction F1-F10). Directly enables AI-Act Art. 14 HITL via Action `confirm` flag.

### 2.2 "Context gravity" replaces "data gravity" — Databricks/Snowflake thesis applied to agents
Classic data-gravity moat (once your data is in Snowflake, egress costs pin you). Applied to agents: **whoever owns the governed long-term memory + regulatory ontology owns the agent**. The LLM is commoditized; the model router is commoditized; the MCP tool list is commoditized. **What is not commoditized: the EU-regulated knowledge graph with lineage + audit + cited provenance.**

**→ Reposition pitch from "AI agent platform" to "Regulated Consulting Intelligence Cloud."** Same stack, 10x more defensible framing. Matches our competitive differentiation doc perfectly.

### 2.3 OpenAI threat window is now quantifiable
v2 identified that OpenAI's Compliance Platform (March 2026) already has 13 DLP/eDiscovery integrations, immutable JSONL audit logs, SOC2/HIPAA/BAA. **The "ChatGPT for Compliance" / "OpenAI Audits" SKU is 80% plumbing-complete and realistically Q3 2026**. Window for us is **3–6 months**, not 12.

**Defense plays:**
- Ship sovereign SKU (EU-hosted, BYO-KMS, air-gapped option) **before they ship EU data boundary for agents**
- Publish Danish/Nordic jurisdictional corpus (Datatilsynet precedent, Danish-language reasoning) that OpenAI won't localize
- Position as "auditor-of-auditors" — matrix fallback means we audit OpenAI outputs with non-OpenAI models (solves "marking your own homework")
- Contract Big-4 Nordic as distribution — **only a local entity can sign Danish ISAE-3402 attestations**

### 2.4 Temporal.io verdict: ADOPT, don't compete
v1 flagged Cadence/Temporal patterns high level. v2 deep-dive revealed Temporal now explicitly repositioned as **"durable execution for AI agents"** (Series D $5B valuation, Mar 2026). They will eat generic chain-engine/workflow layer within 18 months.

**Our move: adopt Temporal (self-host or Cloud Growth tier) as durability layer beneath chain-engine. Move up-stack to V-props + Phantom BOM + ontology where our moat actually lives.** Running our own durable-replay engine is a distraction tax we cannot afford. LangGraph, Restate, Inngest, and Temporal are all making the same bet — durable exec is commodity plumbing within 2 years.

### 2.5 "Blocks as executable primitive" — new category, multi-source signal
Notion (blocks), Figma (objects in tree), Shopify (Liquid templates), Temporal (activities) all converge on a pattern: **typed, composable, addressable units of work with provenance**.

**For WidgeTDC:** every `:Finding`, `:Evidence`, `:Control`, `:Citation` in a deliverable becomes an addressable block with type, schema, provenance, cost, confidence. Deliverables stop being documents and become queryable block trees. V4 rewrite (already needed per dogfood) should adopt this shape.

### 2.6 Multi-agent multiplayer is the next UI category
Figma's LWW-CRDT pattern, extended from human multiplayer to **agent+human multiplayer**, is the genuinely new frontier. The 2015–2025 playbook was "multiplayer X for X" (Figma=Photoshop, Notion=Word, Linear=Jira). The 2026+ playbook is **"multi-agent X for X"** — multiple agents co-editing one document with typed provenance per mutation.

**For WidgeTDC:** Mission Control W13-14 should ship with collaborative deliverables from day 1. Two human reviewers + three reviewer agents editing the same audit report, with per-node attribution, confidence badges, HITL approval envelopes.

---

## 3. All 13 sources — cross-cutting patterns ranked by consensus

### 3.1 Patterns validated by ≥5 sources (**go do immediately**)

| Pattern | Sources | Move |
|---------|---------|------|
| **Own the protocol, monetize the runtime** | Anthropic, Stripe, GitHub, Cloudflare, Databricks (Delta Sharing open) | Open-source canonical contract + Phantom BOM schema to EU foundation |
| **Marketplace flywheel w/ rev share under 30%** | Uber, Shopify, GitHub, Anthropic, OpenAI GPT Store | Marketplace v1 with signed agent manifests + 15% take rate |
| **Ergonomic DX with 5-minute first-value** | Stripe, Cloudflare, GitHub, Shopify, Anthropic, Notion | Self-serve WidgeTDC Cloud tier + multi-language SDKs |
| **Typed primitives > free-form** | Palantir (5 tool kinds), Stripe (expandable+typed), Anthropic (MCP), Notion (block types), Temporal (activities) | Retrofit 166 MCP tools to 5 canonical categories |

### 3.2 Patterns validated by 3–4 sources (**strong go**)

| Pattern | Sources | Move |
|---------|---------|------|
| **Event-sourced workflow history** | Temporal, Stripe (webhooks), GitHub (git), Cloudflare (Queues) | Persist chain-engine history as append-only event log in Neo4j |
| **Governance plane as first-class** | Databricks Unity Catalog, Palantir Foundry, Cloudflare Zero Trust | Single `KnowledgeCatalog` wrapping Neo4j+pgvector+Redis with unified ACL+lineage+audit |
| **Blocks/composable primitives** | Notion, Figma, Shopify Liquid, Temporal | V4 rewrite: deliverables as typed block trees, not strings |
| **Safety/compliance as procurement collateral** | Anthropic Constitutional, Palantir Apollo, Cloudflare Zero Trust | **→ Constitution document (this is what Claus requested after this hunt)** |
| **Clean rooms / data sharing without raw access** | Snowflake, Databricks, Apple Privacy | Multi-firm consulting insights without revealing client engagements |

### 3.3 Patterns with 2-source signal (**evaluate + pilot**)

| Pattern | Sources | Move |
|---------|---------|------|
| Multi-agent + human co-editing (LWW-CRDT) | Figma, Notion (comments) | Mission Control W14 includes collaborative deliverable editing |
| Separate viewer/reviewer seat SKU | Figma Dev Mode, Shopify Partner staff | "Regulator Mode" paid seat for DPOs/auditors |
| Structured Outputs across providers | OpenAI, Anthropic | Enforce TypeBox `$id` schemas at llm-proxy dispatch layer even for DeepSeek/Groq/Gemini |
| Context gravity via egress reluctance | Databricks, Snowflake | Publish Phantom BOM export in open Iceberg format so the moat is governance, not lock-in |

---

## 4. Updated top-15 moves (replaces v1 top-10)

Ranked by (impact × cross-cutting validation × feasibility). Bolded entries are new in v2.

| # | Move | Sources | Effort | Stage |
|---|------|---------|--------|-------|
| 1 | **Retrofit 166 MCP tools to 5 canonical categories (Palantir AIP)** | 5 | 1 week | W10 |
| 2 | Open-source canonical contract + Phantom BOM to EU foundation | 5 | 2 weeks legal | W11 |
| 3 | **Adopt Temporal as durability layer for chain-engine** | 4 | 2 weeks migration | W12 |
| 4 | **Constitution document (AI-Act + GDPR + NIS2 mapped to primitives)** | 3 | 1 week writing | W10 (claus explicit ask) |
| 5 | Idempotency keys on AgentRequest | Stripe | 2 days | W8.5 (in-flight) |
| 6 | H3 capability hexagonal indexing | Uber | 3 days | W10 |
| 7 | **Reposition pitch: "Regulated Consulting Intelligence Cloud"** | 2 (Databricks+Palantir) | 1 week marketing | W10 |
| 8 | Agent PRs — mutations as reviewable diffs | GitHub + Palantir | 1 week | W12 |
| 9 | Signed, replayable event stream (webhooks-grade) | Stripe + CF + GitHub | 1 week | W12 |
| 10 | **3-layer eval harness (TestCase / Grader / Metrics)** | Palantir AIP | 1 week | W11 |
| 11 | **Sovereign EU-hosted SKU (ships BEFORE OpenAI EU boundary)** | OpenAI threat analysis | 4 weeks | W13 |
| 12 | **V4 rewrite as block-tree deliverables (Notion+Figma)** | 3 | 2 weeks | W11 |
| 13 | Marketplace v1 with signed agents | Uber+Shopify+GitHub+Anthropic | 4 weeks | W15 |
| 14 | Bootcamp GTM with leave-behind artifacts | Palantir AIP deep dive | Process | W15 |
| 15 | **"Regulator Mode" read-only seat tier** | Figma + Shopify | 1 week | W14 (Mission Control) |

---

## 5. Critical strategic shifts after v2

### 5.1 From "we compete with AutoGen/LangGraph/CrewAI" to "we absorb or partner with everyone below the orchestration layer"

**Absorb (use their code/patterns as deps):**
- Temporal.io (durable exec layer)
- Anthropic MCP (protocol)
- Langfuse (trace viz via OTLP)
- DSPy (offline prompt compile)

**Partner (distribute through):**
- Anthropic Partner Network (certified MCP server)
- Snowflake / Databricks Marketplace (list Phantom BOM)
- OpenAI Agents SDK (ship WidgeTDC tools as OpenAI-compatible)

**Compete head-on only on (our vertical):**
- EU regulated consulting knowledge graph
- Danish/Nordic jurisdictional depth
- AI-Act Art. 6/9/12/14 native primitives
- Constitutional Consulting AI governance

### 5.2 From "build more features" to "own the contracts + constitution"

Deliverable in next 3 weeks:
1. `WIDGETDC_CONSTITUTION_v1.md` — procurement-citable doc (this hunt's follow-up)
2. `@widgetdc/contracts` v2026-05 — pinned, versioned, multi-language SDK
3. Open-source RFC of canonical contract → EU foundation outreach

### 5.3 From "60 agents" to "60 agents in 5 canonical categories"

Retrofit per Palantir AIP:
- **Query** agents: search_knowledge, kg_rag.query, graph.read_cypher (read-only, property-allow-listed)
- **Action** agents: graph.write_cypher, linear.save_issue, decision_certify (write, auto|confirm flag)
- **Function** agents: compliance_gap_audit, deliverable_draft (pure compute, version-pinned)
- **Clarify** agents: chat_send, audit.lessons (pause-for-user)
- **Command** agents: run_chain, railway_deploy (cross-service trigger)

Every tool registration must declare category + target (object_type or function_id). Rejected at registry boot otherwise.

### 5.4 From "chain-engine runtime" to "V-props + Phantom BOM + Constitution as the product"

Runtime (chain-engine) is commodity. Our value sits in:
- 85-source EU-regulated Phantom BOM
- 10 V-props wired to Danish/Nordic jurisdiction
- Constitution document regulators cite
- Bi-temporal audit trail (W9 V10)

Everything else should eventually be off-the-shelf: Temporal for workflows, Langfuse for traces, DSPy for prompt opt, Anthropic MCP for protocol.

---

## 6. Decision register — this week

| Decision | Rec | Why |
|----------|-----|-----|
| Retrofit MCP tools to 5 categories | **YES W10** | 5-source validation, fixes tool-not-found syndrome, enables HITL natively |
| Open-source contract to EU foundation | **YES — start legal prep now** | 5-source validation, biggest compounding move |
| Adopt Temporal.io | **YES W12** | Do not build own durable engine; distraction tax too high |
| Ship Constitution document | **YES W10 (user request)** | Starts next, draft below |
| Reposition as "Regulated Consulting Intelligence Cloud" | **YES — update all marketing** | Matches D1+D4 moats exactly |
| Sovereign EU SKU | **YES W13 — urgent** | OpenAI window closes in Q3 2026 |
| V4 block-tree rewrite | **YES W11** | Fixes 6 P0 dogfood bugs + matches Notion/Figma pattern |
| Marketplace v1 | **YES W15 (defer, design spike now)** | Wait for V4 fix + Constitution |
| "Regulator Mode" seat | **YES W14** | Ship with Mission Control |

---

## 7. What v2 killed from v1

Not everything in v1 survives. Revisions:

| v1 move | v2 verdict | Why |
|---------|-----------|-----|
| Build Cadence-style workflow discipline in chain-engine | **Killed — adopt Temporal instead** | Temporal deep-dive proved running own durable engine is distraction tax |
| "Shopify App Store" for agent marketplace | **Merged with Uber marketplace** | Same pattern at different level |
| Single-writer agent actors (Durable Objects) | **Deferred to Q4** | Premature optimization until marketplace load signals need |

---

## 8. What I'd stake reputation on

If I had to pick **3 things** from all 13 sources that absolutely must ship before Q3 2026 or we lose:

1. **Constitution document + open-source contract** → locks in D1 procurement moat before OpenAI ships compliance SKU
2. **Sovereign EU-hosted SKU** → only answer to OpenAI's 2026-H2 EU data boundary
3. **Typed tool taxonomy (5 categories)** → fixes tool sprawl + enables HITL natively + marketplace-ready

The other 12 top-15 moves matter but can slip by weeks. These 3 are hard deadlines.

---

## 9. Next hunt candidates (Q3 2026)

Quarterly rhythm preserved. Candidates for next wave:
- **Palo Alto Networks / CrowdStrike** — security-first procurement motions
- **Salesforce Einstein** — enterprise CRM + agent integration pattern
- **dbt Labs** — transformation-as-code + semantic layer GitHub model
- **MongoDB** — dev-first database → AI-first database pivot
- **Vercel** — frontend infra as platform, v0 as agent-native tool

---

## 10. The one-sentence takeaway

**After 13 sources: stop building more; start owning the contracts, the constitution, and the category — because if we're not the EU Regulated Consulting Intelligence Cloud by Q3 2026, OpenAI + Palantir + Snowflake will each try to become it.**
