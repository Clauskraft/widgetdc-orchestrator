# The WidgeTDC Constitution for Regulated Consulting AI

**Version:** 1.0
**Date:** 2026-04-13
**License:** CC-BY-SA 4.0 (citable, quotable, extendable — attribution required)
**Maintainer:** Claus Kraft + WidgeTDC Governance Council
**Status:** Public — procurement teams, legal counsel, and regulators may cite any section by number

---

## Preamble

WidgeTDC is a platform on which consulting firms build regulated AI agents that serve EU clients. This Constitution defines the non-negotiable properties every agent running on WidgeTDC must satisfy, and the operator commitments WidgeTDC makes in return. It exists because the EU AI Act, GDPR, NIS2, DORA, and sector-specific regulations require AI systems to be *demonstrably* governed — not promised to be governed, but verifiable, auditable, and replayable.

This document is simultaneously: (a) a technical specification, (b) a procurement collateral artifact, (c) a commitment we make to regulators and clients, and (d) a contract every agent and operator signs by using the platform.

It is modelled on the constitutional patterns pioneered by Anthropic's Constitutional AI and Palantir's Apollo governance — but specifically scoped to the EU regulated consulting vertical.

---

## Article 1 — Scope and Jurisdiction

### 1.1 Who this Constitution binds
This Constitution binds:
- The WidgeTDC platform operator (Claus Kraft and any corporate entity operating WidgeTDC)
- Every agent registered via the canonical IAgent contract (`@widgetdc/contracts`)
- Every consulting firm or operator using WidgeTDC to deliver client work
- Every third-party agent registered via the WidgeTDC Marketplace (when live)

### 1.2 Jurisdictional anchor
WidgeTDC data is hosted in the European Union (Railway EU region, Neo4j AuraDB EU, Redis EU). Processing complies with:
- **EU AI Act** (Regulation (EU) 2024/1689) — all articles applicable to high-risk AI systems
- **GDPR** (Regulation (EU) 2016/679) — personal data processing
- **NIS2** (Directive (EU) 2022/2555) — where operator qualifies as essential/important entity
- **DORA** (Regulation (EU) 2022/2554) — where clients are financial entities
- **Danish Persondataloven** — domestic implementation of GDPR
- **ePrivacy Directive** — where electronic communications are processed

### 1.3 What is out of scope
This Constitution does not bind:
- The content of deliverables produced by consulting firms (firm owns output, platform hosts)
- LLM provider terms (Anthropic, OpenAI, etc. — platform uses these under their own agreements)
- Client-side policies not expressed through WidgeTDC (clients remain responsible for their own compliance posture)

---

## Article 2 — Canonical Agent Contract

### 2.1 Every interaction uses `AgentRequest`/`AgentResponse`
Every cross-agent or cross-service interaction on WidgeTDC uses the canonical contracts defined in `@widgetdc/contracts/agent`:
- `AgentRequest` — typed via TypeBox with `$id`, snake_case JSON wire format
- `AgentResponse` — status ∈ {success, partial, failed, conflict}, token usage, cost_dkk, optional conflicts array

No agent may invent its own wire format. Any service accepting agent traffic must validate against these schemas.

### 2.2 Tool taxonomy (per Article 12 and 14 of EU AI Act, operationalized)
Every MCP tool on WidgeTDC is classified as exactly one of five canonical types:

| Type | Behavior | HITL policy |
|------|----------|-------------|
| **Query** | Read-only access to knowledge graph, properties allow-listed | None required |
| **Action** | Mutates persistent state (Neo4j, Redis, external systems) | `auto` or `confirm` flag per tool; `confirm` mandatory for high-risk per Art. 14 |
| **Function** | Pure compute, version-pinned, deterministic where possible | None required |
| **Clarify** | Pauses for human input (chat, approval) | Human always in the loop |
| **Command** | Cross-service trigger (Railway deploy, cron run, Linear issue) | Operator-level permission required |

Tools lacking a category assignment must not be registered.

### 2.3 Idempotency
Every `AgentRequest` carries a unique `request_id`. Every mutation (Action or Command) is keyed on `(agent_id, request_id, tool_name)` and deduplicated for 24 hours. Retries are safe. No operation executes twice.

### 2.4 Versioning
`@widgetdc/contracts` follows strict semver. Breaking changes cut a new version; old clients continue to work via compatibility transformers for at least 24 months. The current pinned API version is `2026-04`.

---

## Article 3 — Memory and Provenance

### 3.1 Five-tier memory classification (CoALA-aligned)
Every piece of `:AgentMemory` carries a `tier` field:

| Tier | Lifespan | Content |
|------|----------|---------|
| working | seconds–minutes | current task state, session context |
| short | hours (24h default) | recent agent exchanges, ephemeral claims |
| episodic | days–weeks (30d default) | specific events, historical decisions |
| semantic | persistent | facts, learned patterns, domain truths |
| procedural | persistent | prompts, skills, optimized routines |

### 3.2 Bi-temporal facts (from EU AI Act Article 12 logging requirement)
Every `:Fact` and `:Lesson` node has `valid_from` and `invalid_at` timestamps. When a fact is superseded, both old (invalid_at set) and new (valid_from set) versions coexist. Audit replay reconstructs the knowledge state as-of any past datetime.

### 3.3 Provenance chain (W3C PROV-O aligned)
Every mutation produces PROV edges:
- `(:Activity)-[:WAS_GENERATED_BY]->(:Agent)` — who did it
- `(:Entity)-[:WAS_DERIVED_FROM]->(:Entity)` — what it came from
- `(:Entity)-[:WAS_ATTRIBUTED_TO]->(:Agent)` — who is responsible

Any claim in any deliverable can be traced to its source via one Cypher query. This satisfies EU AI Act Article 13 transparency and Article 12 logging.

### 3.4 Source citation is not optional
Agents producing synthesized content (V4 deliverables, V1 audit reports, V7 RAG answers) must cite sources in the canonical `[Source: CODE-ID]` format, where CODE-ID references a Phantom BOM or KnowledgePattern node. Uncited claims marked `[insufficient data]`.

---

## Article 4 — Human Oversight (EU AI Act Article 14)

### 4.1 HITL envelopes are mandatory for high-risk Actions
Every Action tool with risk level `high` or `unacceptable` (per EU AI Act Annex III classification) must either:
- Have `confirm: true` requiring human approval before commit, or
- Route through the `HITL Gate` system (dual-key approval, escalation to compliance-officer agent)

No high-risk write commits without human assent. This is enforced at platform level, not optional per-agent.

### 4.2 Operators always see what agents are doing
Every operator (consulting firm partner, compliance officer) has access to Mission Control (when deployed) showing:
- Fleet roster of active agents + claims
- Real-time A2A bus
- Episode browser with lesson extraction
- QA queue for deliverables pending approval
- Cost + budget meter per engagement

### 4.3 The kill switch
Every operator with `owner` or `operator` role can terminate any in-flight agent execution. Terminated chains write a `:FailureMemory` node with `reason: 'operator_terminated'`. No agent is uninterruptible.

---

## Article 5 — Safety and Risk Management (EU AI Act Articles 6, 8, 9, 15)

### 5.1 Risk classification at registration
Every agent, tool, and V-prop declares its risk level:
- `minimal` — no oversight required (e.g. search_knowledge, check_tasks)
- `limited` — transparency notice required
- `high` — HITL + documented risk assessment + monitoring
- `unacceptable` — refused at platform level (e.g. social scoring, real-time biometric identification)

### 5.2 Mandatory risk assessment for high-risk agents
Every `high` risk agent must ship with:
- Intended use description
- Known/foreseeable risks documented (Art. 9)
- Risk mitigation measures active (technical + organizational)
- Monitoring configured (runtime_analytics flagging regression)
- Test and validation results (regression suite passing)

Agents missing any of these are rejected at registry boot.

### 5.3 Continuous monitoring
Every `high` risk agent produces runtime telemetry via `recordAgentResponse()`. Weekly `agent_drift_report` cron compares against baseline. Regression >15% in success rate triggers Linear issue auto-creation and optional agent quarantine.

### 5.4 Verification gate
No chain executes destructive actions without passing verification-gate rules:
- Actions against production data require `confirm: true` OR operator pre-approval
- Cross-service Commands require signed operator credential
- Budget cap enforcement triggers auto-downshift to cheaper model path

---

## Article 6 — Data Governance (GDPR Articles 5, 32, 35)

### 6.1 Data minimization
Agents receive only the data required for their task. `Query` tools use property allow-lists. No "select *" patterns on client data.

### 6.2 Purpose limitation
Every `AgentRequest` context carries a declared purpose (implicit via `engagement_id` tag). Data processed for engagement X cannot be re-used for engagement Y without new consent.

### 6.3 Storage limitation
- `working` memory: evicted after session (Redis TTL)
- `short` memory: evicted after 24h
- `episodic` memory: evicted after 30 days unless promoted
- `semantic`/`procedural` memory: retained until no longer operationally necessary
- PII in `episodic` memory is flagged and subject to GDPR Article 17 erasure on request

### 6.4 Data subject rights (GDPR Chapter III)
Platform supports:
- **Right of access (Art. 15)** — data subject can request all memory referring to them via `:Subject.id`
- **Right of rectification (Art. 16)** — via graph update with PROV trail
- **Right of erasure (Art. 17)** — via tombstone + cascade deletion; bi-temporal audit retains hash only
- **Right to data portability (Art. 20)** — JSON export of all subject data

### 6.5 DPIAs (GDPR Article 35)
Every new V-prop that processes personal data ships with a DPIA summary in its runbook section. Template based on Datatilsynet's DPIA guidance.

---

## Article 7 — Operator Commitments

### 7.1 Availability
Platform maintains 99% monthly uptime target for the core runtime (backend + orchestrator + RLM). Incidents are logged, postmortem published, and affected clients notified within 72 hours.

### 7.2 Breach notification
In event of a personal data breach, operator notifies affected data controllers (consulting firms) within 24 hours and assists GDPR Article 33 notification within 72 hours.

### 7.3 Sub-processor transparency
Current sub-processors (as of 2026-04-13):
- Railway (compute hosting, EU region)
- Neo4j AuraDB (graph database, EU region)
- Upstash (Redis, EU region)
- Anthropic, OpenAI, DeepSeek, Groq, Gemini (LLM inference, per-request)
- GitHub (code hosting, US — no client data stored in repos)

Any addition or change notified to consulting firms 30 days in advance.

### 7.4 Non-disintermediation commitment
WidgeTDC will not solicit business from a consulting firm's end-client during or after an active engagement. The firm owns the client relationship. WidgeTDC is the platform, never the competitor.

### 7.5 Data residency
All client data, agent memory, audit trails, and deliverables remain in EU infrastructure unless the consulting firm explicitly opts into non-EU processing for a specific engagement.

### 7.6 Export and portability
Consulting firms may export all their data (agents, memory, deliverables, audit trail) in open formats (JSON, SQL, Cypher, OCI artifacts) at any time. Wind-down period: 90 days post-termination.

---

## Article 8 — Transparency (EU AI Act Article 13, 50)

### 8.1 Clients are informed
Every deliverable produced by a WidgeTDC-powered agent includes a footer:
> *"This deliverable was generated by the WidgeTDC platform with AI assistance. Original sources cited inline. Human oversight applied per EU AI Act Article 14. Full audit trail available on request."*

### 8.2 Training data declarations
If WidgeTDC agents are trained or fine-tuned, the training data source, retention policy, and GDPR basis are documented in per-agent model cards. Currently: we use pre-trained frontier models without fine-tuning. No client data is used for training.

### 8.3 Content watermarking (AI Act Art. 50)
AI-generated content emitted by WidgeTDC agents is marked as such in the output metadata. Consulting firms are responsible for surfacing this to end-clients.

### 8.4 Accessibility
This Constitution is published in English. Danish translation authoritative for Danish-jurisdiction clients. Both versions updated in sync.

---

## Article 9 — Change Management

### 9.1 How this Constitution evolves
Amendments to this Constitution require:
1. Public RFC posted for at least 14 days in `docs/constitution/rfcs/`
2. Governance Council review (Claus + at least 2 operator representatives)
3. Version bump (semver): patch for clarifications, minor for additive rights, major for reductions
4. 90-day notification to consulting firms before any major reduction takes effect

### 9.2 Major reductions require opt-out
Any amendment that reduces operator commitments or client rights requires affected consulting firms to either accept, negotiate a carve-out, or exit with full data export — no unilateral downgrades.

### 9.3 Constitution version pinning
Every engagement's `:CostReport` carries the Constitution version in force at engagement start. If the Constitution changes mid-engagement, the firm may elect to complete under the original version or upgrade.

---

## Article 10 — Dispute Resolution

### 10.1 Internal escalation
Disputes between WidgeTDC and consulting firms escalate via:
1. Operator-to-operator direct discussion (7-day window)
2. Governance Council mediation (14-day window)
3. Binding arbitration per Danish Arbitration Act or jurisdiction agreed in MSA

### 10.2 Regulator cooperation
WidgeTDC cooperates fully with:
- Datatilsynet (Danish DPA)
- European AI Office (from 2026-08)
- Any competent supervisory authority under NIS2 Article 32

Upon receipt of a valid regulatory inquiry, WidgeTDC provides requested audit trail within 5 working days.

### 10.3 End-client access to audit trail
Any end-client of a consulting firm has the right to request — through the firm — the full audit trail for AI-generated content about them. Honored within 30 days per GDPR Article 15.

---

## Article 11 — Open Components

### 11.1 What is open
- `@widgetdc/contracts` — canonical agent contracts (MIT)
- Phantom BOM schema definitions (CC-BY-SA)
- This Constitution (CC-BY-SA)
- Runbook playbooks for V1–V10 (CC-BY)
- Competitive differentiation + inspiration hunts (CC-BY)

### 11.2 What is closed
- The 166-tool orchestrator runtime
- Pre-built domain agents (compliance-officer, regulatory-navigator, graph-steward, etc.)
- Phantom BOM curated content (the 85 sources as ingested + scored)
- Neo4j schema migrations beyond the canonical contracts
- Mission Control UI

### 11.3 Path to standards bodies
Within 12 months, WidgeTDC will propose the canonical agent contract to:
- Linux Foundation / Agentic AI Foundation
- Eclipse Foundation (EU-hosted alternative)
- OpenSSF (security-aligned foundation)

Goal: turn our contract into a cross-platform RFC so regulators cite it as a reference.

---

## Article 12 — Governance Council

### 12.1 Composition
As of 2026-04-13 the Council is:
- Claus Kraft (founder, chair)
- TBA — operator representative from first 3 paying consulting firms
- TBA — independent EU AI ethics advisor (to be appointed by 2026-07)

### 12.2 Voting
Council decisions (amendments, policy, breach response) require simple majority. Chair holds tie-breaking vote only in 1v1 deadlocks.

### 12.3 Meeting cadence
Monthly minimum, published minutes. Emergency sessions convened within 48h for P0 incidents.

---

## Article 13 — Commencement

This Constitution takes effect on 2026-04-13 and supersedes all prior governance commitments on the WidgeTDC platform. By registering an agent, using any MCP tool, or accepting an engagement through WidgeTDC, the user (individual or organization) accepts the provisions of this Constitution as then in force.

---

## Appendix A — Cross-reference to regulations

| Article of this Constitution | EU AI Act | GDPR | NIS2 | DORA |
|------------------------------|-----------|------|------|------|
| 2.2 Tool taxonomy | Art. 14 HITL | — | — | — |
| 2.3 Idempotency | — | Art. 32 security of processing | — | Art. 8 ICT risk management |
| 3.1 Tier classification | Art. 12 logging | Art. 5 data minimization | — | Art. 7 risk-based |
| 3.2 Bi-temporal facts | Art. 12 logging | Art. 30 records | Art. 21 measures | Art. 26 testing |
| 3.3 Provenance (PROV-O) | Art. 11 technical docs | Art. 30 records | — | Art. 26 |
| 3.4 Source citation | Art. 13 transparency | — | — | — |
| 4.1 HITL envelopes | Art. 14 (verbatim) | — | — | — |
| 4.3 Kill switch | Art. 14(4) | — | Art. 21 | — |
| 5.1–5.3 Risk classification | Art. 6, 9, 15 | Art. 35 DPIA | Art. 21 | Art. 6 |
| 5.4 Verification gate | Art. 9(5) | Art. 32 | Art. 21 | Art. 9 |
| 6.1–6.5 Data governance | — | Art. 5, 32, 35 | Art. 21 | Art. 8 |
| 7.2 Breach notification | — | Art. 33, 34 | Art. 23 | Art. 19 |
| 7.4 Non-disintermediation | — | — | — | — (commercial) |
| 7.5 Data residency | — | Chapter V | — | — |
| 8.1–8.3 Transparency | Art. 13, 50 | Art. 13, 14 | — | — |
| 10.2 Regulator cooperation | Art. 64 | Art. 31 | Art. 32 | Art. 48 |

---

## Appendix B — Sources used to construct this Constitution

- EU AI Act consolidated text (EUR-Lex 32024R1689)
- GDPR consolidated text (EUR-Lex 32016R0679)
- NIS2 Directive (EUR-Lex 32022L2555)
- DORA Regulation (EUR-Lex 32022R2554)
- NIST OSCAL (Phantom BOM source, score 0.92)
- ENISA Reference Incident Classification Taxonomy (Phantom BOM)
- MITRE ATT&CK + ATLAS (Phantom BOM)
- W3C PROV-O specification
- CoALA memory taxonomy (Sumers et al., arXiv:2309.02427)
- Anthropic Constitutional AI (inspiration for form)
- Palantir Apollo governance model (inspiration for operator commitments)

---

## Appendix C — How to cite this document

```
WidgeTDC Governance Council (2026). The WidgeTDC Constitution for
Regulated Consulting AI, Version 1.0. https://github.com/Clauskraft/
widgetdc-orchestrator/blob/main/docs/WIDGETDC_CONSTITUTION_v1.md.
Licensed under CC-BY-SA 4.0.
```

Or for a specific article:
```
WidgeTDC Constitution v1.0, Art. 4.1 (Human Oversight) — HITL envelopes
are mandatory for high-risk Actions.
```

---

## Appendix D — Next revision

Next scheduled review: **2026-10-13** (quarterly) or earlier if:
- A new EU regulation enters into force
- A P0 incident exposes a gap
- The Governance Council votes for interim review

---

*End of Constitution v1.0. This document is alive — RFCs welcome at `docs/constitution/rfcs/`.*
