# NLSpec: Truth Gap Spike v0.1

**Version:** 0.1 | **Date:** 2026-04-13 | **Strategic Position:** Hill 1-safe spike for Q2 2026
**Parent:** [PATH_TO_THE_TOP.md](/C:/Users/claus/Projetcs/widgetdc-orchestrator/docs/PATH_TO_THE_TOP.md:28)
**Target:** `widgetdc-orchestrator` | **Effort:** 1 week

---

## System

This spike proves one narrow idea without consuming Hill 1 capacity:

> Can the orchestrator compute a useful **truth gap** between a declared architecture claim and an observed platform fact?

The spike is intentionally constrained:

- one declared source
- one observed source
- no cockpit UI
- no standards export
- no full arch-mcp migration
- no full twin ontology rollout

## Why This Exists

The full Declared-Observed-Supply Twin is strategically aligned with Hill 2 moat work, not Hill 1 proof work.

This spike exists to:

- de-risk the concept
- test the graph model on one thin slice
- produce one concrete operator/debug artifact
- avoid spending Q2 on infrastructure that does not directly help land a paid client

## Scope

### In scope

- one declared ingest path from a small controlled JSON document
- one observed ingest path from one live service health fact
- one query endpoint: `/api/architecture/truth-gap/query`
- three explicit gap types

### Out of scope

- mindmap as master declared source
- cross-profile graph explorer
- cockpit panel
- CycloneDX / SPDX exports
- full `arch-mcp-server` subsume/federate/deprecate migration
- generalized impact mode

## Gap Types

The spike does **not** use one generic `TruthGap` entity for all cases.

It tests three distinct gap types:

| Type | Meaning |
|------|---------|
| `MissingObservedNode` | Declared entity exists, observed entity missing |
| `ContradictionGap` | Declared and observed facts both exist but disagree |
| `SupplyRiskExposure` | Supply-side risk affects a declared or observed asset |

Only the first two are required in v0.1.

## Actors

| Actor | Role |
|-------|------|
| **Declared Spike Ingestor** | Loads one small JSON declaration into Neo4j |
| **Observed Spike Ingestor** | Reads one live health source and writes observed state |
| **Truth Gap Query** | Compares the two and returns structured mismatches |
| **Operator** | Calls the endpoint to inspect drift |

## Behaviors

### B-1: Declared Ingest

**WHEN** a small JSON declaration is posted to the internal spike ingest route  
**THEN** orchestrator writes one `DeclaredService` and its declared properties  
**AND** links it to a `DeclaredSnapshot`

### B-2: Observed Health Ingest

**WHEN** orchestrator reads the live health of one configured service  
**THEN** it writes one `ObservedService` node  
**AND** links it to an `ObservedSnapshot`

### B-3: Truth Gap Query

**WHEN** the operator queries `/api/architecture/truth-gap/query` for the target service  
**THEN** orchestrator compares declared and observed facts  
**AND** returns zero or more of:

- `MissingObservedNode`
- `ContradictionGap`

### B-4: Verified Writes

**WHEN** declared or observed spike writes occur  
**THEN** read-back verification is performed before success is reported

## Canonical Spike Subject

The spike should use **one artificial or tightly scoped service**.

Recommended subject:

- `arch-mcp`

Reason:

- high conceptual relevance
- likely declared/observed mismatch already exists
- useful for future architecture work
- not on Hill 1 critical path for client delivery

## Declared Source

The spike uses a tiny JSON document committed to the repo.

Example:

```json
{
  "source": "truth-gap-spike",
  "version": "2026-04-13",
  "services": [
    {
      "id": "arch-mcp",
      "name": "Arch MCP",
      "expected_status": "ok",
      "declared_health_score": 97
    }
  ]
}
```

## API Contracts

### 1. Declared Spike Ingest

```http
POST /internal/architecture/spike/declared-ingest
X-Service-Token: <internal-token>
Content-Type: application/json
```

### 2. Observed Spike Refresh

```http
POST /internal/architecture/spike/observed-refresh
X-Service-Token: <internal-token>
Content-Type: application/json
```

```json
{
  "service_id": "arch-mcp"
}
```

### 3. Truth Gap Query

```http
POST /api/architecture/truth-gap/query
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "subject": {
    "type": "service",
    "id": "arch-mcp"
  }
}
```

```json
{
  "subject": {
    "type": "service",
    "id": "arch-mcp"
  },
  "declared": {
    "exists": true,
    "expected_status": "ok",
    "declared_health_score": 97
  },
  "observed": {
    "exists": true,
    "status": "ok",
    "observed_health_score": 81
  },
  "gaps": [
    {
      "type": "ContradictionGap",
      "field": "health_score",
      "severity": "medium",
      "summary": "Declared health score differs materially from observed value"
    }
  ]
}
```

## File Map

| File | Change | Purpose |
|------|--------|---------|
| `src/routes/architecture.ts` | **NEW** | Minimal truth-gap query route |
| `src/services/truth-gap-spike.ts` | **NEW** | Thin comparison logic for one subject |
| `src/services/architecture-spike-graph.ts` | **NEW** | Small declared/observed write helpers |
| `src/openapi.ts` | **MODIFY** | Add `truth-gap/query` contract |
| `arch/truth-gap-spike.json` | **NEW** | Tiny declared source artifact |

## Success Metrics

This spike is judged on learning speed, not platform breadth.

| Metric | Baseline | Target |
|--------|----------|--------|
| Time to detect one declared-vs-observed mismatch | manual / undefined | < 1 minute query path |
| Number of concrete gap examples produced | 0 | at least 1 real gap |
| New UI surfaces added | 0 | 0 |
| Hill 1 critical-path disruption | high risk | minimal |

## Acceptance Tests

| ID | Test | Expected |
|----|------|----------|
| T-1 | Ingest declared JSON | `DeclaredService` exists |
| T-2 | Refresh observed state | `ObservedService` exists |
| T-3 | Query known service with mismatch | Returns at least one gap |
| T-4 | Query unknown service | Returns clean not-found error |
| T-5 | Read-back after writes | Verified before success |

## Recommendation

Ship this spike in Q2 only if it stays within one week and does not interfere with Hill 1 deliverables.

If the spike succeeds:

- retain the code
- retain the gap taxonomy
- defer the full twin implementation to Q3 as Hill 2 moat work

If the spike slips beyond one week:

- stop
- document the findings
- move the rest to Q3
