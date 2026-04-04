# Open WebUI Thin-Facade Specification

**Status:** 📝 DRAFT → pending A/B validation (SNOUT-CLOSE-07)
**Authority:** 4-way AI debate consensus (Claude, Codex, Gemini, DeepSeek) + Omega Sentinel approval
**Created:** 2026-04-04
**Linear epic:** SITREP OS Consolidation + Thin Facade Sprint

---

## Purpose

Reduce gpt-4o tool selection ambiguity as the WidgeTDC tool surface grows beyond 16 tools,
**without** collapsing signal-specific tool boundaries that Codex's rebuttal correctly warned
would degrade accuracy.

Current state (post SNOUT-CLOSE-05):
- **16 deployed tools** in Open WebUI
- **96.7%** baseline tool-selection accuracy (29/30 benchmark)
- **4 pipelines deferred** (DEFERRED_PIPELINES.md) — would push to 20 tools

Deploying 4 more tools without facade routing would likely worsen the overlap patterns
already seen in failures (`assembly_certifier` vs `stitch_live`, `uni_mcp` vs `mcp_gateway`).

## Design principles (from debate consensus)

1. **Thin, not thick** — Facade is a *naming abstraction*, not an LLM-in-middle router
2. **Preserve raw access** — `x-raw-signal` bypass keeps original tools callable for edge cases
3. **Evidence-based rollout** — A/B test proves facade ≥ flat before any migration
4. **Rollback path** — Gateway metadata preserves tool-specific schemas for fallback
5. **Codex's guardrail** — Raw tool signal never fully hidden from gpt-4o

## The 4 Master Gateways

### Gateway 1: `wdc_intelligence` — Situational & Operational Data
**Intent family:** *"What is happening? What should I know?"*

| Sub-tool | Purpose |
|----------|---------|
| `widgetdc_stitch_live` (SITREP OS) | PRIMARY — natural language → live dashboard |
| `widgetdc_intelligence_suite` | Proactive notifications, failure analysis, competitive intel |
| `widgetdc_linear_intel` | Linear project tracking |
| `widgetdc_mercury_fold` | Context compression |

**Gateway schema:**
```python
async def wdc_intelligence(
    query: str,                    # Natural language query
    mode: Literal["sitrep","email","brief","intel","fold"] = "sitrep",
    params: dict = {}
) -> str
```

**Routing rule:**
- `mode=sitrep` → `stitch_live.activate`
- `mode=email` → `stitch_live.monday_email`
- `mode=brief` → `stitch_live.push_brief`
- `mode=intel` → `intelligence_suite.intent_resolve` or `intelligence_suite.failure_analysis`
- `mode=fold` → `mercury_fold.fold_usage`

---

### Gateway 2: `wdc_graph` — Knowledge Graph Operations
**Intent family:** *"Query the graph. Visualize relationships. Explore nodes."*

| Sub-tool | Purpose |
|----------|---------|
| `widgetdc_graph_intel` | Hygiene, health, certified search |
| `widgetdc_graph_navigator` | Neo4j query wrapper |
| `widgetdc_data_browser` | Sortable table view of Cypher results |
| `widgetdc_graph_explorer` (deferred) | Cytoscape visualization |

**Gateway schema:**
```python
async def wdc_graph(
    operation: Literal["query","browse","explore","health","hygiene"],
    cypher_or_query: str = "",
    params: dict = {}
) -> str
```

**Routing rule:**
- `operation=query` → `graph_intel.search_knowledge` or `graph_navigator.run_cypher`
- `operation=browse` → `data_browser.browse_data` (returns table)
- `operation=explore` → `graph_explorer.explore_neighborhood` (returns visualization)
- `operation=health` → `graph_intel.graph_health`
- `operation=hygiene` → `graph_intel.run_graph_hygiene`

---

### Gateway 3: `wdc_workflow` — Process & Orchestration
**Intent family:** *"Show me the flow. Visualize the process. Run a tool."*

| Sub-tool | Purpose |
|----------|---------|
| `widgetdc_flow_editor` | Chain/cron/pipeline visualization (SVG) |
| `widgetdc_mcp_gateway` | God-mode: discover + execute 449+ MCP tools |
| `widgetdc_mcp_bridge` (deferred) | Alternative MCP router |
| `widgetdc_assembly_certifier` | Architecture assembly + decision certification |

**Gateway schema:**
```python
async def wdc_workflow(
    action: Literal["visualize","execute","discover","certify"],
    target: str,
    params: dict = {}
) -> str
```

**Routing rule:**
- `action=visualize` → `flow_editor.visualize_chain|visualize_crons|visualize_pipeline`
- `action=execute` → `mcp_gateway.execute_mcp_tool`
- `action=discover` → `mcp_gateway.discover_mcp_tools`
- `action=certify` → `assembly_certifier.certify_decision`

---

### Gateway 4: `wdc_knowledge` — External & Personal Knowledge
**Intent family:** *"Search my notes. Write a briefing. Reason deeply."*

| Sub-tool | Purpose |
|----------|---------|
| `widgetdc_obsidian_bridge` | Vault search, read, write, daily briefing |
| `widgetdc_cognitive` | RLM deep reasoning, multi-agent debates |
| `vaerktoej1` (legacy) | User info (get_user_name_and_email_and_id) |

**Gateway schema:**
```python
async def wdc_knowledge(
    source: Literal["obsidian","cognitive","user"],
    action: str,
    query: str = "",
    params: dict = {}
) -> str
```

**Routing rule:**
- `source=obsidian` + `action=search|read|write|briefing` → `obsidian_bridge.*`
- `source=cognitive` → `cognitive.reason_deeply|trigger_debate|investigate`
- `source=user` → `vaerktoej1.get_user_name_and_email_and_id`

---

## The `x-raw-signal` Bypass (Codex's Concession)

gpt-4o can always fall back to direct tool access by including a bypass marker in its reasoning.
The facade **does not hide** underlying tools from the model — it adds a preferred routing path.

### Bypass mechanisms (in priority order):

1. **Explicit tool selection** — gpt-4o directly calls any of the 16 underlying tools if it
   judges the task needs a specific one. Gateway routing is preferred but never forced.

2. **`x-raw-signal` parameter** — Gateway methods accept `raw_signal=True` which forwards
   the full params to underlying tool with original schema preserved:
   ```python
   await wdc_intelligence(
       query="...",
       mode="sitrep",
       params={"raw_signal": True, "underlying": "widgetdc_stitch_live.activate"}
   )
   ```

3. **Direct call fallback** — If gateway routing fails (wrong mode, unknown operation), the
   error response explicitly lists underlying tools for the LLM to retry with direct call.

### Schema preservation rule

Each gateway method's docstring MUST include the full list of underlying tools + their
specific capabilities:

```python
async def wdc_intelligence(query: str, mode: str, params: dict) -> str:
    """
    Unified interface for situational intelligence.
    
    UNDERLYING TOOLS (callable directly if gateway routing is insufficient):
    - widgetdc_stitch_live.activate(prompt): natural language → live dashboard
    - widgetdc_stitch_live.monday_email(team): manager status email
    - widgetdc_stitch_live.push_brief(threshold): morning brief
    - widgetdc_stitch_live.compiler_stats(): learned patterns
    - widgetdc_intelligence_suite.intent_resolve(intent): route intent
    - widgetdc_intelligence_suite.failure_analysis(scope): analyze failures
    - widgetdc_mercury_fold.fold_usage(text, tokens): compress text
    
    PREFER gateway routing by default. Use raw_signal=True only when a specific
    underlying tool capability is needed.
    """
```

This satisfies Codex's concern that facade must not "compress away decision-relevant tool
distinctions" while giving Gemini's Cognitive Compression benefit as the default path.

---

## Tool-to-Gateway Mapping (16 tools → 4 gateways)

| Tool | Gateway | Raw-callable? |
|------|---------|:--:|
| widgetdc_stitch_live | wdc_intelligence | ✅ |
| widgetdc_intelligence_suite | wdc_intelligence | ✅ |
| widgetdc_linear_intel | wdc_intelligence | ✅ |
| widgetdc_mercury_fold | wdc_intelligence | ✅ |
| widgetdc_graph_intel | wdc_graph | ✅ |
| widgetdc_graph_navigator | wdc_graph | ✅ |
| widgetdc_data_browser | wdc_graph | ✅ |
| widgetdc_flow_editor | wdc_workflow | ✅ |
| widgetdc_mcp_gateway | wdc_workflow | ✅ |
| widgetdc_assembly_certifier | wdc_workflow | ✅ |
| widgetdc_obsidian_bridge | wdc_knowledge | ✅ |
| widgetdc_cognitive | wdc_knowledge | ✅ |
| vaerktoej1 | wdc_knowledge | ✅ |
| widgetdc_stitch_designer | wdc_workflow | ✅ |
| uni_mcp | *(deprecated, wrapped by wdc_workflow)* | ✅ |
| cognitive_orchestrator | *(deprecated, wrapped by wdc_knowledge)* | ✅ |

**Post-facade deployed footprint:**
- **4 new gateway tools** visible to gpt-4o by default
- **16 underlying tools** remain accessible via direct call or `raw_signal=True`
- **Total surface from gpt-4o's perspective:** 4 primary + 16 fallback = **20 tools with hierarchical priority**

This is identical to the count of the original "deploy all 6" plan, but with a **routing layer** that the 4-way debate agreed would improve discoverability.

---

## Acceptance Criteria for A/B Test (SNOUT-CLOSE-07)

Facade is approved for rollout ONLY if ALL of the following hold:

| Metric | Baseline (post SNOUT-CLOSE-05) | Facade must meet |
|--------|:---:|:---:|
| Tool selection accuracy | 96.7% | ≥ 95% (allow -1.7pp slack for abstraction cost) |
| Wrong-tool rate | 3.3% (1/30) | ≤ 5% |
| Avg latency | 4.9s | ≤ 6s (allow +1.1s for routing overhead) |
| No workflow loses access | 100% reachable | 100% reachable via `raw_signal` |
| Rollback possible | — | Must work: `raw_signal=True` returns to direct tool |

**If any fail → facade is rejected, 4 deferred pipelines remain blocked pending alternative
plan.**

---

## Implementation Scope (Post-Approval)

**NOT in this spec** — to be built AFTER SNOUT-CLOSE-08 green light:

1. Gateway tool JSON files (`owui-tools/gateway-*.json`)
2. Python implementations in `pipelines/gateway_*.py`
3. `raw_signal` forwarder logic
4. Updated docstrings on all 16 underlying tools with gateway pointers
5. CI test: "Every underlying tool must be reachable via direct call"

## Governance notes

- **No tool deletions.** 14+2 deployed tools remain regardless of facade outcome.
- **Facade is additive.** It adds 4 wrapper tools; it does not remove anything.
- **A/B decides scope.** If A/B fails, ship NONE of the 4 gateways. Keep flat topology.
- **DEFERRED_PIPELINES.md unblock condition.** Only unblocked if facade A/B passes.

## Debate references

This spec synthesizes positions from 3 rounds of AI debate:
- **Codex (GPT-5.4):** Opposed facade-first, demanded A/B benchmark + raw signal preservation
- **Gemini (2.5):** Proposed Master Intent Gateway, Cognitive Compression rationale
- **DeepSeek:** Hybrid 5-day sprint with facade foundation + CI lock-in
- **Claude (Opus):** Combined position with promotion bar + exit criteria

Full debate transcript: `memory/consolidation_debate_2026-04-04.md`
