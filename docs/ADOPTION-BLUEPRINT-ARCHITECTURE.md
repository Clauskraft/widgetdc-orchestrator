# WidgeTDC Adoption Blueprint — Architecture Document v1.0

**Status**: Draft | **Dato**: 2026-04-01 | **Ejer**: Omega Sentinel + Agent Swarm
**Metode**: FDD (Feature-Driven Development) + ODM/PMM alignment
**Constraint**: Open source only, cloud-only, agent-swarm developable

---

## 1. VISION

> Verdens første self-evolving consulting intelligence platform der lærer af hver interaktion,
> beriger sin vidensgraf autonomt, og leverer consulting-grade output gennem to brugerflader:
> Obsidian (knowledge work) og Open WebUI (conversational AI).

**Differentiatorer (verificerbare)**:
- 425K+ Neo4j knowledge nodes med 3.7M relationer (ingen konkurrent har dette)
- Self-evolving Q-learning agent selector (10,406 episodes, konvergeret)
- 7 LLM providers med intelligent cost/quality routing
- 448 MCP tools i ét samlet økosystem
- Compound Cypher persistence (379ms, production-verified)
- Attention-based context folding (QKV multi-head, 10.75% compression)

---

## 2. AS-IS ARKITEKTUR

```
┌─────────────────────────────────────────────────────────────────┐
│                     BRUGERFLADER (2 surfaces)                    │
│                                                                  │
│  ┌────────────────────┐         ┌──────────────────────────┐    │
│  │    OBSIDIAN VAULT   │         │      OPEN WEBUI          │    │
│  │ • Plugin v0.2.0     │         │ • Railway Docker         │    │
│  │ • 6 skills          │         │ • /v1 proxy (7 models)   │    │
│  │ • Strategic Build   │         │ • 11 tools               │    │
│  │ • CORTEX sync       │         │ • Google OAuth           │    │
│  │ • Chat (UNWIRED)    │         │ • Pipelines (UNUSED)     │    │
│  │ • Canvas (STUBS)    │         │ • Assistants (UNUSED)    │    │
│  │ • SSE events        │         │ • Knowledge Bases (EMPTY)│    │
│  └─────────┬──────────┘         └────────────┬─────────────┘    │
│            │                                  │                   │
│            │    ┌──────────────────────┐      │                   │
│            └────┤   COMMAND CENTER     ├──────┘                   │
│                 │   SPA (vanilla JS)   │                          │
│                 │   11 panels          │                          │
│                 └──────────┬───────────┘                          │
├────────────────────────────┴──────────────────────────────────────┤
│                     ORCHESTRATION LAYER                           │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              ORCHESTRATOR (TypeScript, Railway)             │  │
│  │  • 11 OpenAI-format tools          • 7 LLM model proxies  │  │
│  │  • Tool-call loop (max 2 rounds)   • Rate limiting (30/min)│  │
│  │  • Token folding (800 char max)    • Metrics tracking      │  │
│  │  • 6 intelligence loops (cron)     • FSM state machine     │  │
│  │  • Chain engine (5 modes)          • Verification gate     │  │
│  │  • Harvest pipeline                • Agent registry (134)  │  │
│  │  • Graceful tool-call fallbacks    • SSE + WebSocket       │  │
│  └────────────────────────┬───────────────────────────────────┘  │
├────────────────────────────┴──────────────────────────────────────┤
│                     INTELLIGENCE LAYER                             │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              RLM ENGINE (Python/FastAPI, Railway)           │  │
│  │                                                            │  │
│  │  REASONING                    ROUTING                      │  │
│  │  • /reason (semaphore=10)     • 7 providers (DeepSeek,     │  │
│  │  • /cognitive/learn (sem=3)     Gemini, Claude, OpenAI,    │  │
│  │  • OODA state graph             Groq, Qwen, Moonshot)     │  │
│  │  • WSR runtime planner        • 5-strategy routing:        │  │
│  │  • Swarm orchestrator           domain → meta-learn →      │  │
│  │                                 Q-learn → specialist →     │  │
│  │  SELF-EVOLVING                  priority                   │  │
│  │  • Q-Learning (10,406 ep)                                  │  │
│  │  • GP AutoTuner (1,310 obs)   MEMORY                      │  │
│  │  • EMA Optimizer (α=0.15)     • Cortex (27 agents)        │  │
│  │  • Blindspot Remediation      • 7-cap temporal ordering    │  │
│  │  • NeuMF Recommender          • Episodic (TemporalLobe)   │  │
│  │  • Knowledge Gap Analyzer     • Graph (AgentMemory)        │  │
│  │  • Quality Scorer             • Working (Redis TTL 3600)   │  │
│  │                                                            │  │
│  │  CONTEXT                      RAG                          │  │
│  │  • 4 folding strategies       • 5 sources (2 local, 3 rem)│  │
│  │  • QKV attention (d=32,h=4)   • 3-layer cache             │  │
│  │  • Recursive (>20K tokens)    • 2.5s per-source timeout   │  │
│  │  • Neural (TF-IDF)            • Tier 1/2 classification   │  │
│  │                                                            │  │
│  │  PERSISTENCE (LIN-499 optimeret)                           │  │
│  │  • shared_http.py (200 conn, 50 keepalive)                │  │
│  │  • Compound Cypher (379ms-2011ms)                          │  │
│  │  • WriteBuffer (100ms flush, 50 threshold)                 │  │
│  │  • Circuit breaker (3 failures → 120s open)                │  │
│  └────────────────────────┬───────────────────────────────────┘  │
├────────────────────────────┴──────────────────────────────────────┤
│                     DATA LAYER                                    │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ NEO4J AURADB │  │    REDIS     │  │   POSTGRESQL           │  │
│  │ 425K nodes   │  │ Agent state  │  │ + pgvector             │  │
│  │ 3.7M rels    │  │ Audit trail  │  │ Embeddings (1536D)     │  │
│  │ 17 domains   │  │ Chain exec   │  │ Session state          │  │
│  │ 270 frameworks│  │ Cron config  │  │                        │  │
│  │ 288 KPIs     │  │ Q-tables     │  │                        │  │
│  └──────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              BACKEND (Node.js, Railway)                     │  │
│  │  • 448 MCP tools (Tier 0/1/2)   • InsightIntegrityGuard   │  │
│  │  • graph.read/write_cypher      • AgentLearningLoop        │  │
│  │  • srag.query (semantic)        • audit.lessons/acknowledge│  │
│  │  • kg_rag.query (multi-hop)     • Trident threat intel     │  │
│  │  • consulting.* namespace       • linear.* namespace       │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. TO-BE ARKITEKTUR (3 Greb)

```
┌─────────────────────────────────────────────────────────────────┐
│                     BRUGERFLADER (transformeret)                  │
│                                                                  │
│  ┌────────────────────┐         ┌──────────────────────────┐    │
│  │   OBSIDIAN COCKPIT │         │   OPEN WEBUI INTELLIGENCE│    │
│  │ ★ Chat Panel WIRED │         │ ★ 10 Consulting Assist.  │    │
│  │ ★ Dashboard View   │         │ ★ Pipelines Container    │    │
│  │ ★ Canvas Generator │         │ ★ SRAG Filter (auto-RAG) │    │
│  │ ★ CORTEX Sync Cmd  │         │ ★ Knowledge Bases (docs) │    │
│  │ ★ Inline Widgets   │         │ ★ Channels + Webhooks    │    │
│  │ ★ Right-Click Menu │         │ ★ Prompt Suggestions     │    │
│  │ ★ Quality Feedback │         │ ★ Knowledge Cards [MI-x] │    │
│  │   (graph write-back)│         │ ★ Follow-up Nudges      │    │
│  └─────────┬──────────┘         └────────────┬─────────────┘    │
│            │                                  │                   │
│            │    ┌──────────────────────┐      │                   │
│            └────┤   COMMAND CENTER     ├──────┘                   │
│                 │ ★ Knowledge Feed     │                          │
│                 │ ★ Adoption Dashboard │                          │
│                 │ ★ Tool Catalog       │                          │
│                 └──────────┬───────────┘                          │
├────────────────────────────┴──────────────────────────────────────┤
│              ORCHESTRATION + PIPELINES LAYER                      │
│                                                                   │
│  ┌──────────────────┐  ┌─────────────────────────────────────┐  │
│  │  PIPELINES (NEW) │  │     ORCHESTRATOR (eksisterende)      │  │
│  │  Python, port    │  │  + Daily Knowledge Feed cron         │  │
│  │  9099, Railway   │  │  + /api/knowledge/cards endpoint     │  │
│  │                  │  │  + /api/knowledge/feed endpoint      │  │
│  │  ★ SRAG Filter   │→→│  + Adoption metrics endpoint        │  │
│  │  ★ Citation      │  │  + Tool catalog API                  │  │
│  │    Formatter     │  │                                      │  │
│  │  ★ Follow-up     │  │  (alle eksisterende capabilities     │  │
│  │    Generator     │  │   bevaret og uændret)                │  │
│  └──────────────────┘  └─────────────────────────────────────┘  │
├───────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE + DATA (uændret, self-evolving bevaret)             │
│  RLM Engine + Neo4j + Redis + PostgreSQL + Backend                │
│  (alle LIN-499/505 optimeringer aktive)                           │
└───────────────────────────────────────────────────────────────────┘
```

**Princip**: Intelligence layer (RLM + Neo4j + Backend) ændres IKKE.
Kun brugerflader og orchestration-layer beriges.

---

## 4. DE 3 GREB — FEATURE-DRIVEN BREAKDOWN

### GREB 1: Consulting Assistants (Open WebUI Configuration)

**Feature Set 1.1 — Virtuelle Modeller**

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G1.1 | Compliance Auditor assistent | Config | Human (admin UI) | 15 min |
| G1.2 | Graph Analyst assistent | Config | Human (admin UI) | 15 min |
| G1.3 | Project Manager assistent | Config | Human (admin UI) | 15 min |
| G1.4 | Consulting Partner assistent | Config | Human (admin UI) | 15 min |
| G1.5 | Platform Health assistent | Config | Human (admin UI) | 15 min |
| G1.6 | Prompt suggestions per assistent | Config | Human (admin UI) | 30 min |

**Dependency**: Ingen. Kan gøres NU.
**Self-evolving kobling**: Q-learning observerer hvilke assistenter der bruges mest → justerer routing automatisk.

### GREB 2: Knowledge Fabric (Pipelines + Orchestrator)

**Feature Set 2.1 — Pipelines Container**

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G2.1 | Deploy Pipelines container på Railway | DevOps | deploy-guardian | 2h |
| G2.2 | SRAG Filter Pipeline (inlet) | Code | loop-orchestrator | 4h |
| G2.3 | Citation Formatter (outlet) | Code | loop-orchestrator | 2h |
| G2.4 | Follow-up Suggestion Generator | Code | consulting-partner | 2h |

**Feature Set 2.2 — Knowledge API (Orchestrator)**

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G2.5 | GET /api/knowledge/cards?q= | Code | loop-orchestrator | 3h |
| G2.6 | GET /api/knowledge/feed | Code | loop-orchestrator | 3h |
| G2.7 | Daily Knowledge Feed cron chain | Config | omega-sentinel | 2h |
| G2.8 | Push til Open WebUI system prompt | Code | loop-orchestrator | 1h |

**Feature Set 2.3 — Knowledge Bases**

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G2.9 | Upload consulting frameworks docs | Config | Human | 2h |
| G2.10 | Upload regulatory reference docs | Config | Human | 1h |
| G2.11 | Bind KBs til relevante assistenter | Config | Human | 30m |

**Dependency**: G2.1 → G2.2 → G2.3 → G2.4 (sekventiel). G2.5-G2.8 kan paralleliseres.
**Prerequisite**: Milestone 0 SKAL være done (LIN-517 return_exceptions fix — Pipelines kalder /reason).
**Fallback**: Hvis Pipelines container er nede, Open WebUI falder automatisk tilbage til direkte orchestrator /v1 proxy (zero degradation for bruger).
**Self-evolving kobling**: Quality Scorer evaluerer citationens accuracy → feedback til RLM → bedre retrieval over tid.

### GREB 3: Obsidian Cockpit (Plugin Wiring)

**Feature Set 3.1 — Wire Eksisterende Kode**

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G3.1 | Wire chat panel i main.ts | Code | frontend-sentinel | 30m |
| G3.2 | Wire canvas export | Code | frontend-sentinel | 2h |
| G3.3 | Fix quality feedback graph write-back | Code | graph-steward | 2h |
| G3.4 | CORTEX sync som plugin command | Code | frontend-sentinel | 1h |

**Feature Set 3.2 — Nye Views**

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G3.5 | Orchestrator Dashboard ItemView | Code | frontend-sentinel | 4h |
| G3.6 | Knowledge Feed panel | Code | frontend-sentinel | 3h |
| G3.7 | Inline status widgets (PostProcessor) | Code | frontend-sentinel | 3h |

**Feature Set 3.3 — Context Menu + UX**

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G3.8 | Right-click "Analysér med WidgeTDC" | Code | frontend-sentinel | 2h |
| G3.9 | Keyboard shortcuts (10+ bindings) | Code | frontend-sentinel | 1h |
| G3.10 | Status bar mini-dashboard | Code | frontend-sentinel | 1h |

**Dependency**: G3.1 (wire chat) er uafhængig. G3.3 blokerer G3.6 (feedback data).
**Self-evolving kobling**: Hvert workspace quality score feeds GP AutoTuner → bedre strategic pipeline over tid.

### GREB 4: Analysis Bridge (WAD Artifact + Investigate + Drill Stack + Notebook)

> Forbinder Open WebUI og Obsidian via et shared artifact-format der muliggør
> drill-down analyse af tekst og tal på tværs af begge surfaces.

**Feature Set 4.1 — WAD Artifact Format + Orchestrator Broker**

Fundamentet: et portabelt analyse-artefakt (WidgeTDC Analysis Document) der
renderer native i begge surfaces.

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G4.1 | AnalysisArtifact TypeBox schema i widgetdc-contracts | Code | loop-orchestrator | 2h |
| G4.2 | POST/GET /api/artifacts CRUD routes i orchestrator | Code | loop-orchestrator | 4h |
| G4.3 | GET /api/artifacts/:id.md (Obsidian-flavored markdown export) | Code | loop-orchestrator | 2h |
| G4.4 | GET /api/artifacts/:id.html (renderable HTML fragment) | Code | loop-orchestrator | 1h |
| G4.5 | Redis artifact storage (hash, 30-day TTL) | Code | loop-orchestrator | 1h |

WAD Block Types:
```
text       — Markdown content
table      — headers[] + rows[][] (sortable/filterable)
chart      — chart_type (bar|line|radar|sankey) + data + config
cypher     — live Neo4j query + cached result
mermaid    — Mermaid diagram source
kpi_card   — label + value + unit + trend
deep_link  — target (obsidian|open-webui) + URI + label
```

**Dependency**: G4.1 (contracts schema) først — contracts are law.
**Self-evolving kobling**: Artifact quality scores → Quality Scorer → bedre artifact generation over tid.

**Feature Set 4.2 — Open WebUI Pipeline (Auto-detect + Deep-link)**

Outlet filter der detekterer analyse-værdigt indhold og opretter artifacts automatisk.

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G4.6 | Pipeline outlet: analysis detector (heuristisk scoring) | Code | loop-orchestrator | 3h |
| G4.7 | Auto-create WAD artifact fra analysis-worthy responses | Code | loop-orchestrator | 2h |
| G4.8 | Append "📊 Open in Obsidian" deep-link til response | Code | loop-orchestrator | 1h |
| G4.9 | Obsidian URI handler (obsidian://widgetdc-open?artifact=ID) | Code | frontend-sentinel | 2h |
| G4.10 | Auto-materialize artifact som .md note i vault | Code | frontend-sentinel | 2h |

Detection signals: has_table, has_framework_ref, has_data_points (≥3), has_comparison, length >1500 chars.
Score threshold: 0.7 (konfigurerbar via Pipeline Valves).

**Dependency**: G4.1-G4.5 (artifact broker) + G2.1 (Pipelines container).

**Feature Set 4.3 — Investigate Chain (Multi-Agent Deep Analysis)**

Ny chain-type: brugeren skriver `/investigate [emne]` → multi-agent deep analysis → WAD artifact.

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G4.11 | "investigate" chain definition i orchestrator | Code | loop-orchestrator | 3h |
| G4.12 | Artifact assembler step (samler chain output til WAD) | Code | loop-orchestrator | 2h |
| G4.13 | Open WebUI tool: `investigate` (trigger chain via chat) | Code | loop-orchestrator | 1h |
| G4.14 | Obsidian command: "Investigate Topic" (trigger via plugin) | Code | frontend-sentinel | 1h |

Chain flow (sequential mode):
```
Step 1: graph-steward     → Neo4j exploration (nodes, paths, gaps)
Step 2: regulatory-nav    → Compliance framework analysis
Step 3: consulting-partner → Strategic recommendations
Step 4: RLM /reason       → Deep reasoning over combined outputs
Step 5: artifact-assembler → Combine all → WAD artifact + deep-links
```

**Dependency**: G4.1-G4.5 (artifact broker). Chain engine eksisterer allerede.
**Self-evolving kobling**: Chain quality → Q-learning → bedre agent-selection per step.

**Feature Set 4.4 — Drill Stack (Progressive Disclosure)**

Progressiv disclosure i chat: Domain → Framework → KPI → Trend → Anbefaling.
Hvert niveau er ét klik, ikke en ny query.

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G4.15 | DrillContext object i orchestrator (tracks current level) | Code | loop-orchestrator | 3h |
| G4.16 | Breadcrumb renderer i Open WebUI responses | Code | loop-orchestrator | 2h |
| G4.17 | Click-to-drill: re-issue query at selected level | Code | loop-orchestrator | 2h |
| G4.18 | "Pin to Obsidian" button per drill-level | Code | loop-orchestrator | 1h |
| G4.19 | Obsidian MOC (Map of Content) note per drill-path | Code | frontend-sentinel | 2h |

Drill hierarchy (mapper til eksisterende Neo4j taxonomy):
```
Domain (17)
  └─ Segment (per client/industry)
      └─ Framework (270)
          └─ KPI (288)
              └─ Trend (historisk data)
                  └─ Recommendation (RLM-generated)
```

**Dependency**: G4.1 (artifact format for pinning). Kan bygges inkrementelt.
**Self-evolving kobling**: Drill-paths → Knowledge Gap Analyzer → identificerer underafdækkede domæner.

**Feature Set 4.5 — Consulting Notebook (Reactive Analysis Cells)**

Sekvens af celler (query, insight, data, action) der kædes reaktivt.
Ændring i én celle opdaterer downstream.

| ID | Feature | Type | Agent | Effort |
|----|---------|------|-------|--------|
| G4.20 | NotebookSpec type + cell definitions i contracts | Code | loop-orchestrator | 2h |
| G4.21 | POST /api/notebooks/execute endpoint (sekventiel cell execution) | Code | loop-orchestrator | 4h |
| G4.22 | `widgetdc-query` codeblock processor i Obsidian (live Cypher) | Code | frontend-sentinel | 4h |
| G4.23 | Chart.js renderer for numeriske resultater | Code | frontend-sentinel | 3h |
| G4.24 | "Create Notebook" button i Open WebUI responses | Code | loop-orchestrator | 2h |
| G4.25 | "Refresh All Cells" command i Obsidian (re-run mod live Neo4j) | Code | frontend-sentinel | 1h |
| G4.26 | "Push to Open WebUI" command (share notebook som samtale) | Code | frontend-sentinel | 2h |

Cell types:
```
query_cell   — NL spørgsmål eller Cypher → orchestrator eksekverer
insight_cell — AI-genereret analyse med [MI-xxxx] citationer
data_cell    — Tabel eller chart renderet fra query results
action_cell  — Anbefaling med linked Linear issue / next step
```

Notebook i Obsidian er en .md fil med `widgetdc-query` codeblocks:
````markdown
## Client ESG Exposure

```widgetdc-query
MATCH (c:Client)-[:ASSESSED_BY]->(f:Framework)
WHERE f.domain = 'ESG'
RETURN c.name AS Client, count(f) AS Frameworks, avg(f.score) AS AvgScore
ORDER BY AvgScore ASC
```

## Gap Analysis

```widgetdc-query
MATCH (d:Domain {name: 'ESG'})-[:HAS_FRAMEWORK]->(f)
WHERE NOT (f)<-[:ASSESSED_BY]-(:Client)
RETURN f.name AS UnusedFramework, f.maturity_score AS Maturity
```
````

**Dependency**: G4.1 (contracts) + G4.22 (codeblock processor er standalone win).
**Self-evolving kobling**: Notebook execution quality → GP AutoTuner → bedre cell-chaining parameters.

---

## 5. SELF-EVOLVING INTELLIGENCE — BEVARINGS- OG STYRKELSESPLAN

Alle 3 greb STYRKER (ikke bare bevarer) self-evolving mekanismerne:

```
┌─────────────────────────────────────────────────────────┐
│              SELF-EVOLVING FEEDBACK LOOPS                 │
│                                                          │
│  GREB 1 (Assistants)                                     │
│    User vælger assistent → Q-learning observerer valg    │
│    → Assistent-popularity → Justér default routing       │
│    → NeuMF recommender foreslår bedre assistent          │
│                                                          │
│  GREB 2 (Knowledge Fabric)                               │
│    Citation accuracy → Quality Scorer evaluerer          │
│    → Feedback til RLM reasoning → Bedre retrieval        │
│    → Knowledge Gap Analyzer finder huller                │
│    → Daily Feed surfacer gaps → Human/agent fylder hul   │
│    → Graf vokser → Bedre retrieval (flywheel)            │
│                                                          │
│  GREB 3 (Obsidian Cockpit)                               │
│    Workspace quality scores → GP AutoTuner               │
│    → Bedre pipeline parameters                           │
│    → Bedre strategic output                              │
│    → Højere quality scores (flywheel)                    │
│    → Blindspot Remediation dækker nye domæner            │
│                                                          │
│  GREB 4 (Analysis Bridge)                                │
│    Artifact quality scores → Quality Scorer              │
│    → Bedre artifact generation                           │
│    Drill-paths → Knowledge Gap Analyzer                  │
│    → Identificerer underafdækkede domæner                │
│    Notebook cell execution → chain engine metrics        │
│    → GP AutoTuner optimerer cell-chaining                │
│    Investigate chain → Q-learning per agent-step         │
│    → Bedre agent-selection over tid                      │
│                                                          │
│  SAMLET FLYWHEEL:                                        │
│    Mere adoption → Mere artifacts → Bedre Q-tables       │
│    → Bedre routing → Højere quality → Mere drill-down    │
│    → Mere data i graf → Bedre RAG → Mere adoption        │
│    (virtuous cycle med compound acceleration)            │
└─────────────────────────────────────────────────────────┘
```

---

## 6. CLOUD-ONLY DEPLOYMENT

```
Railway Project: widgetdc-prod
├── backend (Node.js)           — eksisterende
├── rlm-engine (Python)         — eksisterende
├── orchestrator (Node.js)      — eksisterende
├── open-webui (Docker)         — eksisterende
├── ★ pipelines (Python, NEW)   — ghcr.io/open-webui/pipelines:main
├── Redis                       — eksisterende
└── PostgreSQL                  — eksisterende

Neo4j AuraDB (cloud)            — eksisterende, v5.27 enterprise
Obsidian Vault                  — git-synced (Clauskraft/Obsidian-Vault, GitHub)

INGEN lokal dependency. Alt kører i cloud.
Obsidian Vault synces via git push (GitHub) — plugin connects via HTTPS til Railway.
Obsidian plugin taler til Railway endpoints via HTTPS.
```

**Ny service**: Kun `pipelines` (1 container, <256MB RAM, ~$5/mdr Railway).

---

## 7. AGENT SWARM DEVELOPMENT MODEL

Hvert feature set kan udvikles af den relevante agent via Claude Code:

```
GREB 1 (Config):     Human operatør i Open WebUI admin
GREB 2 (Pipelines):  /loop-orchestrator → Spec→Dev→Test→Verify
GREB 2 (Knowledge):  /loop-orchestrator → orchestrator repo
GREB 3 (Plugin):     /frontend-sentinel → Obsidian plugin repo
Code Review:          /octo:review eller /octo:staged-review
Deploy:               /deploy-guardian → Railway
QA:                   /qa-guardian → Tests
Governance:           /omega-sentinel → Linear + memory
Architecture:         /master-architect-widgetdc → To-be validation
```

**Prompt template for agent-swarm execution:**
```
/loop-orchestrator

MISSION: Implementér [FEATURE_ID] fra ADOPTION-BLUEPRINT-ARCHITECTURE.md
REPO: [target repo]
SPEC: [feature description fra sektion 4]
CONSTRAINTS: Cloud-only, open source, 729 tests skal passe
VERIFY: Build + test + deploy + Linear update
```

---

## 8. EXECUTION ROADMAP (FDD Milestones)

### MILESTONE 0: "Deploy Blockers + Baseline" (Dag 0)
```
MANDATORY — intet andet starter før dette er done.

P0-#1: LIN-517 asyncio.gather return_exceptions=True     — loop-orchestrator, 30m
P0-#2: LIN-516 Temporal supersession fix                  — loop-orchestrator, 4h
  → Step 1: Temporal schema i widgetdc-contracts           (2h)
     Tilføj valid_from, valid_until til contracts/src/agent/
     Run npm run validate + npx vitest run
     Bump contracts version, push, deploy
  → Step 2: cortex.py compound Cypher (CREATE+supersede)   (2h)
P0-#3: LIN-506 time.sleep → asyncio.sleep                — loop-orchestrator, 30m
Baseline: Mål TTFV for Open WebUI + Obsidian (3 testqueries each)
Deploy: Push alle fixes, verificér 729 tests + Railway health

Forventet KPI: Ingen ændring — dette er fundament-fix.
Contracts dependency resolved → unblocks LIN-510, LIN-519.
```

### MILESTONE 1: "Instant Adoption" (Uge 1)
```
Dag 1: GREB 1 komplet (10 assistenter konfigureret)     — Human, 2h
Dag 1: G3.1 Wire Obsidian chat panel                     — frontend-sentinel, 30m
Dag 2: G2.1 Deploy Pipelines container                   — deploy-guardian, 2h
Dag 2: G3.4 CORTEX sync command                          — frontend-sentinel, 1h
Dag 3: G2.2 SRAG Filter Pipeline                         — loop-orchestrator, 4h
Dag 4: G2.3+G2.4 Citation + Follow-up                    — loop-orchestrator, 4h
Dag 5: G3.3 Fix quality feedback                         — graph-steward, 2h

Forventet KPI: advancedPct 0.9% → 3%
```

### MILESTONE 2: "Knowledge Fabric Live" (Uge 2-3)
```
G2.5-G2.8: Knowledge API + Daily Feed + cron             — loop-orchestrator, 9h
G2.9-G2.11: Knowledge Bases uploaded + bound              — Human, 3.5h
G3.5: Orchestrator Dashboard i Obsidian                   — frontend-sentinel, 4h
G3.6: Knowledge Feed panel i Obsidian                     — frontend-sentinel, 3h
Open WebUI Channels + webhooks (ops status)               — loop-orchestrator, 4h

Forventet KPI: advancedPct 3% → 5%, domain coverage 3→6/17
```

### MILESTONE 3: "Cockpit Complete" (Uge 4)
```
G3.2: Canvas auto-generering                             — frontend-sentinel, 2h
G3.7: Inline status widgets                              — frontend-sentinel, 3h
G3.8: Right-click context menu                           — frontend-sentinel, 2h
G3.9-G3.10: Shortcuts + status bar                       — frontend-sentinel, 2h
Adoption Dashboard i Command Center                       — loop-orchestrator, 4h
Tool Catalog UI                                           — loop-orchestrator, 4h

Forventet KPI: advancedPct 5% → 8%, TTFV < 45s
```

### MILESTONE 4: "Analysis Bridge" (Uge 5-7)
```
Uge 5 — WAD Foundation:
  G4.1: AnalysisArtifact contracts schema                  — loop-orchestrator, 2h
  G4.2-G4.5: Artifact CRUD + Redis + .md/.html export     — loop-orchestrator, 8h
  G4.22: widgetdc-query codeblock processor i Obsidian     — frontend-sentinel, 4h
  G4.23: Chart.js renderer for numeriske resultater        — frontend-sentinel, 3h

Uge 6 — Pipeline + Investigate:
  G4.6-G4.8: Pipeline outlet (auto-detect + deep-link)     — loop-orchestrator, 6h
  G4.9-G4.10: Obsidian URI handler + auto-materialize      — frontend-sentinel, 4h
  G4.11-G4.14: Investigate chain + artifact assembler      — loop-orchestrator, 7h

Uge 7 — Drill Stack + Notebook:
  G4.15-G4.19: DrillContext + breadcrumbs + MOC notes      — loop-orchestrator, 10h
  G4.20-G4.21: NotebookSpec + /notebooks/execute           — loop-orchestrator, 6h
  G4.24-G4.26: Create/Refresh/Push notebook commands       — frontend-sentinel, 5h

Forventet KPI: advancedPct 8% → 14%, TTFV < 35s, domain coverage 8→11/17
```

---

## 9. KPI TRACKING

| KPI | Baseline | M1 (uge 1) | M2 (uge 3) | M3 (uge 4) | M4 (uge 7) | 12 mdr |
|-----|----------|-----------|-----------|-----------|-----------|--------|
| advancedPct | 0.9% | 3% | 5% | 8% | 14% | 20% |
| Avg complexity | 1.73 | 2.0 | 2.3 | 2.5 | 3.0 | 3.5 |
| Domain coverage | 3/17 | 4/17 | 6/17 | 8/17 | 11/17 | 15/17 |
| TTFV (Open WebUI) | M0 baseline | <90s | <60s | <45s | <35s | <25s |
| TTFV (Obsidian) | M0 baseline | <60s | <45s | <30s | <20s | <15s |
| Assistants used | 0 | 5 | 8 | 10 | 12 | 15+ |
| Daily Knowledge Feed | 0 | 0 | 1/dag | 1/dag | 1/dag | 2/dag |
| WAD Artifacts created | 0 | 0 | 0 | 0 | 50/mdr | 200/mdr |
| Notebooks active | 0 | 0 | 0 | 0 | 10 | 50+ |
| Investigate chains/mdr | 0 | 0 | 0 | 0 | 30 | 100+ |

Måling: `/v1/metrics` endpoint + Neo4j AgentMemory timestamps + Linear velocity.

---

## 10. DIFFERENTIERING — HVORFOR DETTE ER VERDENSKLASSE

| Dimension | WidgeTDC (to-be) | Nærmeste konkurrent |
|-----------|-----------------|-------------------|
| Self-evolving routing | Q-learning + GP AutoTuner + EMA | LiteLLM (statisk) |
| Knowledge graph depth | 425K nodes, 17 domains, 270 frameworks | Notion AI (flat docs) |
| RAG architecture | SRAG + GraphRAG + Knowledge Cards + citations | Perplexity (web only) |
| Context optimization | 4 folding strategies + compound Cypher | Standard truncation |
| Agent orchestration | 5-mode chain engine + verification gate | LangChain (basic) |
| Consulting specificity | 288 KPIs, domain classifiers, service alignment | Generic AI assistants |
| Dual-surface UX | Obsidian (deep work) + Open WebUI (conversational) | Ét interface |
| Autonomous evolution | Blindspot remediation, gap analysis, auto-tuning | Manual tuning |

**Danmarksførende claim**: Ingen dansk consulting-virksomhed har en self-evolving AI platform
med 425K knowledge nodes, temporal memory, og dual-surface delivery. Verificerbart via
Neo4j graph stats og Q-learning convergence metrics.

---

## 11. RISICI OG MITIGERING

| Risiko | Sandsynlighed | Impact | Mitigering |
|--------|--------------|--------|-----------|
| Pipelines container ustabil | Lav | Medium | Fallback: orchestrator proxy fungerer uden pipeline |
| Obsidian plugin breaking changes | Medium | Lav | Plugin er versioneret, Obsidian API er stabil |
| Neo4j AuraDB latency spikes | Lav | Høj | Circuit breaker + graceful fallbacks (allerede implementeret) |
| Lav bruger-adoption trods forbedringer | Medium | Høj | Mitigér via onboarding + prompt suggestions + champion users |
| RLM Q-learning divergerer | Lav | Medium | ε-greedy (0.05) + EMA smoothing + reset capability |
| Open WebUI Channels beta instabil | Medium | Lav | Channels er optional — core adoption virker uden |
| Contracts schema mangler temporal props | Høj (known) | Høj | Milestone 0 resolver dette FØR Greb 2 |

---

## 12. GOVERNANCE

- **Contracts**: Alle nye endpoints i orchestrator følger widgetdc-contracts (snake_case, $id)
- **Linear**: Hvert feature har Linear issue under LIN-505 EPIC
- **Tests**: 729 RLM tests + orchestrator build skal passe efter hver ændring
- **Deploy**: Railway auto-deploy via git push til main
- **Memory**: Session findings gemmes som AgentMemory i Neo4j
- **Code Review**: /octo:staged-review efter hver milestone

---

*Dokument genereret af Omega Sentinel + 6 research agents. Valideret mod production logs og Linear backlog.*
