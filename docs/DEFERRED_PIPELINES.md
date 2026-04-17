# Deferred Pipelines — Remaining Gated OWUI Artifacts

**Status:** 🟡 PARTIALLY UNBLOCKED  
**Gate:** SNOUT-CLOSE-06 (Thin Facade Spec) + SNOUT-CLOSE-07 (A/B benchmark)  
**Created:** 2026-04-04  
**Authority:** Omega Sentinel + 4-way debate consensus

## Context

During SITREP OS consolidation sprint (SNOUT-CLOSE-01 → -10), **2 pipelines were deployed** to
Open WebUI production (SNOUT-CLOSE-03):

- ✅ `widgetdc_flow_editor` (LIN-588 / SNOUT-18) — visualization, no SITREP OS overlap
- ✅ `widgetdc_data_browser` (LIN-587 / SNOUT-17) — sortable tables, no SITREP OS overlap

`widgetdc_graph_explorer` is no longer deferred. It is treated as part of the normal graph
surface and can be synced to production with the standard OWUI deploy path.

The remaining **3 pipelines are deferred** pending facade A/B test outcome or filter validation.
These artifacts overlap
with existing tool functionality and deploying them directly would increase tool surface
and/or add always-on hooks, risking degraded tool selection or global chat breakage.

## Remaining Deferred Artifacts (3)

### 1. `widgetdc_mcp_bridge.py` — LIN-585 / SNOUT-19
- **Methods:** `mcp_call`, `mcp_list_tools`, `orchestrator_tool`
- **Overlaps with:** `widgetdc_mcp_gateway` (already deployed, 0 methods but functional)
- **Risk:** Tool selection confusion between two MCP routing paths
- **Unblock condition:** Facade spec assigns ONE to primary, other to internal-only
- **Owner:** Platform

### 2. `widgetdc_anticipator.py` — Intelligence Suite companion
- **Methods:** `inlet` (Filter pattern — not user-callable)
- **Type:** Open WebUI Filter hook (runs automatically, not exposed as tool)
- **Overlaps with:** None (different execution model)
- **Risk:** LOW — filters don't affect tool selection
- **Unblock condition:** Verify filter hook contract + test in staging
- **Owner:** Platform

### 3. `widgetdc_beautifier.py` — Intelligence Suite companion
- **Methods:** `outlet` (Filter pattern — not user-callable)
- **Type:** Open WebUI Filter hook (response post-processor)
- **Overlaps with:** None (different execution model)
- **Risk:** LOW — filters don't affect tool selection
- **Unblock condition:** Verify filter contract + ensure no double-formatting with SITREP OS
- **Owner:** Platform

## Why Filters (#3, #4) Are Also Deferred Despite Low Risk

Even though `anticipator` and `beautifier` are filter hooks (not tools), they are deferred
because:

1. **Filter hooks run on every message** — if they have bugs, they break ALL chat interactions
2. **No rollback via feature flag exists** — must be tested in staging first
3. **Interaction with SITREP OS `_envelope` directive is untested** — beautifier might
   override the VERBATIM directive and re-format output, breaking monday_email/push_brief
4. **Sprint scope discipline** — we chose phased deployment (only +2, not +6)

## Unblock Path

```
SNOUT-CLOSE-06: Write facade spec
  ↓
SNOUT-CLOSE-07: A/B benchmark (facade vs flat)
  ↓
SNOUT-CLOSE-08: Omega go/no-go decision
  ↓
If PASS:
  - Deploy remaining deferred artifacts behind facade routing / validated filter rollout
  - Retest tool selection accuracy (must stay ≥90%)
If FAIL:
  - Deploy 2 filters (#2, #3) only with staging validation
  - Keep mcp_bridge frozen
  - Document lesson: flat topology works at current scale
```

## Evidence Base

- **Baseline accuracy:** 90.0% (27/30 via SNOUT-CLOSE-02 benchmark)
- **Current tool count:** 16 (14 pre-existing + 2 SNOUT-18/17)
- **Failure modes observed in baseline:**
  1. `platform_health` → routed to `assembly_certifier` instead of `stitch_live` (overlap)
  2. `list MCP tools` → routed to `uni_mcp` instead of `mcp_gateway` (overlap)
  3. `calculator math` → routed to `vaerktoej1` from innocent chitchat

Deploying additional overlapping pipelines without facade would likely worsen these overlap patterns.

## Governance

This deferral was approved by **Omega Sentinel** after a **4-way AI debate** (Claude, Codex,
Gemini, DeepSeek) with unanimous agreement that:

1. VETO destructive consolidation (do NOT delete the 4 pipelines)
2. HONOR SNOUT W1.5 delivery (preserve all committed work)
3. GATE expansion behind measurement (facade A/B, not big-bang)

See: `consolidation_debate_2026-04-04.md` (memory file)

## Status Tracker

| Pipeline | Status | Blocker | Target unblock |
|----------|--------|---------|---------------|
| widgetdc_mcp_bridge | 🟡 Deferred | SNOUT-CLOSE-06+07+08 | Pending facade decision |
| widgetdc_anticipator | 🟡 Deferred | Staging validation | Pending filter validation |
| widgetdc_beautifier | 🟡 Deferred | Staging validation | Pending filter validation |
