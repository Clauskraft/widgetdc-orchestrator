# WidgeTDC Vision: The Unified Intelligence Cockpit

**Date**: 2026-04-08  
**Author**: CLAK + Platform Intelligence  
**Status**: Strategic Direction — v1.0

---

## 1. Where We Are Today

### Platform Vital Signs

| Metric | Current | Assessment |
|--------|---------|------------|
| Neo4j Knowledge Graph | **588K nodes, 1.7M relationships** | Massive. Living. Growing every minute. |
| MCP Tools Registered | **72 tools** across 12 namespaces | Full Triple-Protocol ABI (OpenAI/OpenAPI/MCP) |
| Agent Fleet | **19 canonical agents** + 250+ registered | Active fleet with PeerEval learning |
| Consulting Domains | **14 canonical** (TEC: 25K, Cyber: 20K, PEVC: 10K, STR: 6.6K) | Strong in tech/security, gaps in HC/SCM/MCX |
| Pheromone Layer | **418 deposits, 96 amplifications** | Stigmergic coordination working |
| Cron Intelligence Loops | **33 scheduled jobs** | Continuous self-improvement running |
| Arch-MCP-Server | **1,018 arch nodes, 24 data sources** | Isolated. Not connected. Underused. |
| Command Center | **v3.2 — 16 panels, 72 tools, full a11y** | Enterprise-grade but still dashboard, not cockpit |

### What We've Built (the honest assessment)

**Strengths — genuinely impressive:**
- A knowledge graph that *remembers everything* — 588K nodes of decisions, reasoning, insights, memories
- A self-improving agent fleet with pheromone coordination, PeerEval learning, and failure harvesting
- An Inventor evolution engine that can iterate on its own output (LEARN→DESIGN→EXPERIMENT→ANALYZE)
- A Command Center that's gone from nothing to 16 enterprise panels in weeks
- Triple-Protocol ABI with pre-commit adoption gates — zero drift, zero broken deploys
- 72 MCP tools callable by any agent, any protocol

**Gaps — where it hurts:**
- **arch-mcp-server is an island.** 1,018 architecture nodes sitting on a separate Railway service with no connection to the 588K-node knowledge graph. No shared auth. No cross-query. No unified view.
- **The Command Center is a *dashboard*, not a *cockpit*.** You look at data. You don't *drive* from it. No inline agent invocation. No drag-and-drop chain building. No live graph exploration.
- **Human interactivity is shallow.** The frontend shows status but doesn't enable action. An operator can't grab an agent, assign it a task, watch it work, and course-correct — all from the same view.
- **Agent interactivity is API-only.** Agents call tools via JSON-RPC. There's no visual trace of their reasoning, no way for a human to see an agent's decision tree *as it unfolds*, no co-piloting.
- **The Knowledge panel queries nodes that don't exist** (IntelligenceAsset — zero in graph). The actual intelligence is scattered across McKinseyInsight, VectorDocument, AgentMemory, LLMDecision, CVE — not unified under a single queryable model.

---

## 2. The Vision: Every Interaction Elevates

### Core Principle

> **Every interaction — human or agent — must produce a knowledge artifact, strengthen a connection, or improve a capability. Nothing is lost. Everything compounds.**

This isn't a dashboard. It's a **Sovereign Intelligence Cockpit** where:

- A human opens a panel and *works inside it* — not just reads from it
- An agent executes a chain and *the cockpit shows it live* — reasoning steps, tool calls, decisions, scores
- An architect explores the system graph and *the architecture updates itself* as they discover patterns
- A consultant queries domain knowledge and *the answer feeds back into the graph* as a new evidence node
- Every click, every query, every agent call generates signal that the pheromone layer picks up and routes

### The Three Unifications

#### Unification 1: Arch + Orchestrator = One Graph, One View

**Current state:** arch-mcp-server (1,018 nodes, 104 edges) runs separately from the orchestrator's Neo4j (588K nodes, 1.7M rels). Two services. Two graphs. Two frontends. No cross-references.

**Target state:** Merge arch-mcp-server's architecture graph INTO the orchestrator's Neo4j as first-class node types:

```
(:ArchService)-[:DEPENDS_ON]->(:ArchService)
(:ArchService)-[:HOSTS]->(:Agent)
(:ArchService)-[:EXPOSES]->(:MCPTool)
(:Agent)-[:MADE_DECISION]->(:RLMDecision)
(:RLMDecision)-[:ABOUT]->(:ConsultingDomain)
```

The DataPulse health monitoring (24 sources, avgHealth 55%) becomes a live feed into the Anomaly Watcher. The architecture dependency graph becomes explorable *inside* the Command Center — not on a separate URL.

**Blast radius:** One new ingestion pipeline + retire arch-mcp-server as standalone. The frontend visualizer (force-directed graph) moves into the cockpit as a panel.

#### Unification 2: Dashboard → Interactive Cockpit

**Current state:** 16 panels show read-only status. You look at agents, chains, pheromones — but you don't drive them.

**Target state:** Every panel becomes a *workbench*:

| Panel | Now (read) | Target (interactive) |
|-------|-----------|---------------------|
| Agents | Status table | Drag-assign tasks, live reasoning trace, inline chat |
| Chains | Execution history | Visual chain builder (drag nodes), live step-through |
| Knowledge | Static stats | Interactive graph explorer (click→expand→query) |
| Inventor | Evolution log | Configure + launch experiments, watch nodes evolve live |
| Pheromone | Heatmap display | Click trails to trace agent coordination paths |
| Anomaly | Alert feed | Click-to-investigate → auto-spawns investigation chain |
| Cost | Static report | Model routing simulator (drag sliders, see cost impact) |
| Architecture | *doesn't exist* | **NEW:** Live system graph from merged arch data |

The interaction model: **See → Act → Learn → See (improved)**

Every action from the cockpit generates a `CockpitInteraction` node in the graph with the operator, timestamp, action, and outcome. The system learns *how* humans use it and surfaces better defaults.

#### Unification 3: Human + Agent = Co-Pilot Mode

**Current state:** Humans observe. Agents execute. They don't collaborate in real-time.

**Target state:** The cockpit supports a **co-pilot loop**:

1. **Human spots signal** — anomaly detected, knowledge gap, performance drop
2. **Human assigns agent** — clicks "Investigate" → spawns a chain with the right agent
3. **Agent works live** — reasoning steps, tool calls, intermediate results stream into the panel
4. **Human course-corrects** — "No, focus on the PE domain, not Technology" → agent pivots
5. **Agent delivers** — artifact, report, or graph update appears in the panel
6. **System learns** — the interaction, the human override, the final outcome → all stored as evidence

This is the **Neural Bridge** from the PRD — the cognitive feedback loop where human judgment and agent capability compound.

---

## 3. Open Source DNA: What We Harvest

The vision is to pull the best open-source patterns through our harvester and wire them into the cockpit:

| Capability | Best-in-Class OSS | What We Take |
|-----------|-------------------|-------------|
| Graph exploration | Neo4j Bloom, Graphistry, Cytoscape.js | Force-directed layout, click-to-expand, relationship highlighting |
| Agent observability | LangSmith, Langfuse, AgentOps | Trace waterfall, token counting, step-by-step replay |
| Dashboard framework | Grafana, Metabase | Panel system, variable templating, alert rules |
| Chain building | LangGraph Studio, n8n, Node-RED | Visual DAG editor, drag-drop, live execution overlay |
| Real-time streaming | Phoenix (Arize), Weights & Biases | SSE trace streaming, metric sparklines, live updating |
| Knowledge management | Obsidian Graph View, Roam Research | Bi-directional linking, backlink surfacing, daily graph |

The key insight: we don't clone these tools. We **harvest their patterns** through our competitive crawler and Inventor, then **evolve our own implementation** that's native to our graph, our agents, our MCP protocol.

---

## 4. Development Roadmap

### Phase 1: Merge (2 weeks)
- Ingest arch-mcp-server graph into Neo4j (ArchService, ArchDependency, DataPulseSource nodes)
- Add Architecture panel to Command Center with force-directed visualizer
- Wire DataPulse health → Anomaly Watcher
- Retire arch-mcp-server standalone (redirect to orchestrator)

### Phase 2: Interact (3 weeks)
- Agent panel: inline task assignment + live reasoning trace (SSE → panel)
- Chain panel: visual chain builder (drag-drop nodes, configure modes)
- Knowledge panel: click-to-expand graph explorer (Cytoscape.js)
- Every panel action → `CockpitInteraction` node in graph

### Phase 3: Co-Pilot (3 weeks)
- Human-agent collaboration protocol (override, redirect, approve)
- Split-pane mode: agent reasoning left, human controls right
- Natural language command bar that routes to the right agent + tool
- Co-pilot session replay for training and audit

### Phase 4: Compound (ongoing)
- Pheromone trails from cockpit usage → surface most-used paths
- Auto-suggested actions based on context (time of day, recent anomalies, domain focus)
- Inventor experiments on the cockpit itself (evolve the UI from usage data)
- Cross-session memory: cockpit remembers your preferences, your focus domains, your agents

---

## 5. The Metric That Matters

**Interaction → Intelligence conversion rate.**

For every 100 human interactions with the cockpit:
- How many produce a new knowledge node?
- How many strengthen an existing connection?
- How many improve an agent's capability?
- How many resolve an anomaly?

Today this rate is effectively **0%** — the Command Center is read-only.

Target: **>40%** of interactions produce a measurable intelligence gain.

That's the vision. Everything connects. Every interaction elevates.

---

## 6. Sovereign Edges — Current Scores

| Edge | Danish | Focus | Current | Target |
|------|--------|-------|---------|--------|
| **Husker** | Remembers | Knowledge graph completeness | 588K nodes, 14 domains | 750K+, all 17 domains >5K each |
| **Lærer** | Learns | PeerEval + failure harvesting | 78 evals, 13 task types | 500+ evals, pattern extraction |
| **Heler** | Heals | Self-correction + anomaly response | 2 active anomalies | Auto-resolve P2+, human only for P0 |
| **Forklarer** | Explains | Reasoning transparency | RLM trace exists but hidden | Every decision visible in cockpit |
| **Vokser** | Grows | Inventor + evolution | Engine works, empty artifacts | Continuous evolution producing real artifacts |
| **Integrerer** | Integrates | Cross-service unification | Arch isolated, 2 separate frontends | Single cockpit, unified graph |

---

*This document is itself a knowledge artifact. It will be ingested into the graph and linked to the Strategy domain.*
