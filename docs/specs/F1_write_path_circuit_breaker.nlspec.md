# NLSpec: F1 — Write-Path Circuit Breaker + Daily Graph Hygiene

**Version:** 1.0 | **Date:** 2026-04-03 | **Parent:** PRD v3.0 (LIN-574)
**Target:** widgetdc-orchestrator | **Effort:** 2-3 days

---

## System

The **Write-Path Circuit Breaker** is a validation gate inside the orchestrator's MCP caller that intercepts all Neo4j write operations before they reach the backend. It prevents known pollution patterns, enforces domain governance, and validates data integrity. The **Daily Graph Hygiene Cron** monitors graph health continuously and alerts on anomalies.

## Actors

| Actor | Role |
|-------|------|
| **MCP Caller** | The `callMcpTool()` function in `src/mcp-caller.ts` that proxies all tool calls to backend |
| **Write Validator** | New `validateBeforeMerge()` function that inspects `graph.write_cypher` payloads |
| **Hygiene Cron** | New cron job (04:00 UTC daily) that runs health queries and stores snapshots |
| **Alert System** | SSE broadcast + Slack webhook for anomaly notifications |
| **Admin** | Human operator who can bypass validation with `force: true` |

## Behaviors

### B-1: Write Interception

**WHEN** `callMcpTool()` is called with `toolName === 'graph.write_cypher'`
**THEN** the system extracts the Cypher query string from `opts.args.query`
**AND** passes it through `validateBeforeMerge(query, params)`
**AND** proceeds to backend ONLY if validation passes
**AND** returns a rejection result (status: `'error'`, error_code: `'VALIDATION_REJECTED'`) if validation fails

**WHEN** `callMcpTool()` is called with any other toolName
**THEN** the system passes through without validation (read operations are never blocked)

### B-2: Pollution Detection

**WHEN** a write Cypher contains node content (via `SET` clause with string values)
**AND** the content matches ≥2 of the 10 POLLUTION_PATTERNS regexes (reused from `dual-rag.ts`)
**THEN** the write is REJECTED with reason: `"Content matches LLM prompt pollution patterns"`

**Examples of rejection:**
- `SET n.content = "You are a helpful AI assistant that..."` → matches `you are a helpful` + `you must always` → REJECTED
- `SET n.description = "NIS2 compliance assessment framework"` → 0 matches → ALLOWED

### B-3: Domain Allowlist

**WHEN** a write Cypher contains `MERGE (d:Domain {name: $name})` or creates a `:Domain` node
**AND** the domain name is NOT in the canonical allowlist of 15 domains
**THEN** the write is REJECTED with reason: `"Domain '${name}' not in canonical allowlist"`

**Canonical domains (15):**
`AI, Architecture, Cloud, Consulting, Cybersecurity, Finance, HR, Learning, Marketing, Operations, Product Management, Public Sector, Risk & Compliance, Strategy, Technology`

### B-4: Embedding Dimension Check

**WHEN** a write Cypher contains an embedding vector (array of numbers in `SET` clause)
**AND** the vector length is NOT 384 (NEXUS) or 1536 (non-NEXUS)
**THEN** the write is REJECTED with reason: `"Embedding dimension ${dim} does not match expected (384 or 1536)"`

**Implementation note:** Detect via params inspection — if a param value is an array of numbers with length > 100, treat it as an embedding vector.

### B-5: Required Fields

**WHEN** a write Cypher creates a new node (contains `CREATE` or `MERGE ... ON CREATE SET`)
**AND** the params do NOT include a non-empty `title`, `name`, or `filename` value
**THEN** the write is REJECTED with reason: `"New nodes must have a non-empty title, name, or filename"`

**Exception:** Relationship-only writes (no node creation) are not subject to this check.

### B-6: Admin Bypass

**WHEN** `callMcpTool()` is called with `opts.args._force === true`
**THEN** ALL validation is skipped
**AND** a warning is logged: `"Write-path validation bypassed (force=true)"`

### B-7: Validation Metrics

**WHEN** a write is validated (pass or reject)
**THEN** the system increments in-memory counters: `writes_total`, `writes_passed`, `writes_rejected`
**AND** on rejection: logs the rejection reason, toolName, and first 200 chars of the Cypher query

### B-8: Daily Hygiene Cron

**WHEN** the cron fires at 04:00 UTC daily
**THEN** the system executes 6 health queries against Neo4j (via `graph.read_cypher`):

| Metric | Query | Alert Threshold |
|--------|-------|----------------|
| `orphan_ratio` | Nodes with 0 relationships / total nodes | >5% |
| `avg_rels_per_node` | Total rels / total nodes | <2 or >50 |
| `embedding_coverage` | Nodes with embedding / total nodes (per label) | <50% for any label |
| `domain_count` | Count of distinct Domain nodes | ≠15 (drift detected) |
| `stale_node_count` | Nodes not updated in 90 days | >10% of total |
| `pollution_probe` | Nodes matching ≥2 pollution patterns | >0 |

**AND** stores results as a `:GraphHealthSnapshot` node in Neo4j:
```
MERGE (s:GraphHealthSnapshot {date: date()})
SET s.orphan_ratio = $orphan_ratio,
    s.avg_rels = $avg_rels,
    s.embedding_coverage = $embedding_coverage,
    s.domain_count = $domain_count,
    s.stale_count = $stale_count,
    s.pollution_count = $pollution_count,
    s.timestamp = datetime()
```

### B-9: Anomaly Detection

**WHEN** the hygiene cron completes
**AND** any metric crosses its alert threshold
**OR** any metric changed by >2× compared to the previous day's snapshot
**THEN** the system broadcasts an alert via SSE (`type: 'graph-health-alert'`)
**AND** sends a Slack notification (if Slack is enabled) with the metric name, current value, and threshold

### B-10: Health Endpoint Extension

**WHEN** `GET /health` is called
**THEN** the response includes `write_gate_stats: { total, passed, rejected }` alongside existing health fields

## Constraints

| ID | Constraint |
|----|-----------|
| C-1 | Validation adds <5ms latency per write call (regex matching is fast) |
| C-2 | Validation NEVER blocks read operations (`graph.read_cypher`, `srag.query`, etc.) |
| C-3 | Pollution patterns are shared with `dual-rag.ts` — single source of truth (extract to shared module) |
| C-4 | The hygiene cron MUST use parameterized Cypher for its queries (no string interpolation) |
| C-5 | `:GraphHealthSnapshot` nodes have 90-day TTL (auto-expire via `DETACH DELETE` in the cron) |
| C-6 | Circuit breaker does NOT modify the Cypher query — it only accepts or rejects |

## File Map

| File | Change | Purpose |
|------|--------|---------|
| `src/write-gate.ts` | **NEW** | `validateBeforeMerge()`, pollution patterns (shared), domain allowlist, metrics |
| `src/mcp-caller.ts` | **MODIFY** | Import + call `validateBeforeMerge()` before `graph.write_cypher` calls |
| `src/dual-rag.ts` | **MODIFY** | Import pollution patterns from `write-gate.ts` (remove duplication) |
| `src/cron-scheduler.ts` | **MODIFY** | Register `graph-hygiene-daily` cron job |
| `src/graph-hygiene-cron.ts` | **NEW** | 6 health queries + snapshot storage + anomaly detection |
| `src/index.ts` | **MODIFY** | Add write gate stats to health endpoint |
| `frontend/index.html` | **MODIFY** | Graph Health panel in Command Center SPA (optional, P2) |

## Acceptance Tests

| ID | Test | Expected |
|----|------|----------|
| T-1 | Call `graph.write_cypher` with polluted content (2+ pattern matches) | Rejected, error_code `VALIDATION_REJECTED` |
| T-2 | Call `graph.write_cypher` with clean content | Passed through to backend, success result |
| T-3 | Call `graph.write_cypher` creating Domain "Junk Domain" | Rejected, not in allowlist |
| T-4 | Call `graph.write_cypher` creating Domain "AI" | Passed (in allowlist) |
| T-5 | Call `graph.write_cypher` with 100-dim embedding | Rejected, wrong dimension |
| T-6 | Call `graph.write_cypher` with 384-dim embedding | Passed |
| T-7 | Call `graph.write_cypher` with `_force: true` + polluted content | Passed (bypass) |
| T-8 | Call `graph.read_cypher` with any content | Always passed (reads never blocked) |
| T-9 | Hygiene cron produces `:GraphHealthSnapshot` node | Node exists with all 6 metrics |
| T-10 | Inject 10 orphan nodes, run cron | `orphan_ratio` triggers alert via SSE |
| T-11 | Health endpoint includes `write_gate_stats` | `{ total, passed, rejected }` in response |

## Completeness Score

| Dimension | Score | Notes |
|-----------|-------|-------|
| Behaviors defined | 10/10 | All 10 behaviors specified with triggers + outcomes |
| Edge cases covered | 9/10 | Bypass, read-only exclusion, metric exposure. Missing: concurrent write validation |
| Testability | 10/10 | 11 acceptance tests, all automatable |
| File map | 10/10 | Exact files + change type |
| Constraints | 9/10 | Performance, security, single-source-of-truth. Missing: error message format spec |
| **Total** | **48/50** | |
