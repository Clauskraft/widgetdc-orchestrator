# PHANTOM SKILL LOOPS — Evidence-Based Autonomous Improvement

**Date:** 2026-04-13  
**Status:** Proposed  
**Owner:** Codex  
**Scope:** Orchestrator, Phantom BOM, skill routing, adoption telemetry

## 1. Purpose

This spec defines the canonical autonomous improvement loops that should be driven by `Phantom BOM` evidence rather than generic workflow heuristics.

The goal is to improve:

- tool selection accuracy
- reuse before rebuild
- time to correct implementation path
- intelligence output quality
- platform adoption of shipped capabilities

This is not a new workflow system. It is a control layer over what already exists in:

- [src/phantom-bom.ts](/C:/Users/claus/Projetcs/widgetdc-orchestrator/src/phantom-bom.ts:1)
- [src/services/phantom-skill-router.ts](/C:/Users/claus/Projetcs/widgetdc-orchestrator/src/services/phantom-skill-router.ts:1)
- [docs/PHANTOM_PRIORITY_NOW.md](/C:/Users/claus/Projetcs/widgetdc-orchestrator/docs/PHANTOM_PRIORITY_NOW.md:1)

## 2. Strategic Thesis

The platform should not choose execution patterns from text intent alone.

It should route work from:

- declared user intent
- observed platform state
- Phantom BOM evidence about capabilities, standards, gaps, and runtime maturity

The right abstraction is:

`Intent + PhantomEvidence + CapabilityGraph -> Loop Selection -> Verified Delivery -> Adoption Telemetry`

## 3. Phantom Evidence Inputs

Canonical evidence fields:

- `componentCount`
- `externalSourceCount`
- `canonicalNodeCount`
- `knownCapabilityMatches`
- `unknownRelationCount`
- `avgConfidence`
- `hasRuntimeSurface`
- `coverageScore`

Derived routing signals:

- `many_external_sources`
- `canonical_surface_exists`
- `reuse_candidate_exists`
- `domain_poorly_understood`
- `domain_well_understood`
- `runtime_surface_available`

## 4. Canonical Loop Families

These loops are the platform-default methods.

### Loop A — Harvest To Pattern Library

**Use when**

- `externalSourceCount > 3`
- repo/domain is new
- harvested components are not yet mapped to canonical nodes

**Goal**

Convert external components into reusable internal capability patterns.

**Primary skills**

- `flow-discover`
- `skill-intent-contract`
- `omega-sentinel`
- `skill-verify`

**Operational phases**

1. harvest external repo/provider/domain evidence
2. extract meaningful components and relations
3. classify components into internal capability families
4. map to existing patterns or create candidate pattern nodes
5. verify read-back and coverage delta

**Success condition**

- harvested components are queryable
- pattern candidates exist or matches are confirmed
- coverage improves relative to baseline

**Primary KPI contribution**

- evidence coverage per repo/domain
- harvested-to-canonical conversion rate
- time to first useful pattern

### Loop B — Reuse Before Design

**Use when**

- `knownCapabilityMatches > 0`
- `canonicalNodeCount > 0`
- user intent overlaps existing MCPTool, Pattern, Service, or route

**Goal**

Prevent unnecessary rebuilds and raise tool adoption.

**Primary skills**

- `flow-discover`
- `skill-decision-support`
- `skill-verify`
- `omega-sentinel`

**Operational phases**

1. search for existing tools, patterns, routes, and services
2. rank reuse candidates
3. compare fit, risk, and adaptation effort
4. select reuse path or explicitly justify non-reuse
5. verify chosen surface actually exists and is callable

**Success condition**

- one reuse path is selected or explicitly rejected with evidence
- implementation starts from an existing surface where possible

**Primary KPI contribution**

- reuse rate before new implementation
- tool selection accuracy
- reduction in duplicate surfaces

### Loop C — Research To Standard

**Use when**

- `canonicalNodeCount > 0`
- policy/template/contract work is needed
- domain has fragmented patterns that should converge

**Goal**

Convert scattered evidence into canonical standards and templates.

**Primary skills**

- `flow-discover`
- `flow-spec`
- `omega-sentinel`
- `skill-verify`

**Operational phases**

1. gather canonical nodes and relevant repo evidence
2. compare competing patterns
3. define the preferred standard or contract
4. encode the standard as spec, schema, template, or route contract
5. verify that the standard is readable and referenceable

**Success condition**

- standard exists in spec/contracts/docs/code surface
- future work can implement against it directly

**Primary KPI contribution**

- standardization rate
- reduction in architecture drift
- time from discovery to reusable standard

### Loop D — Standard To Implementation

**Use when**

- `avgConfidence >= 0.75`
- `coverageScore >= 0.60`
- `hasRuntimeSurface = true`
- intent is implementation or extension

**Goal**

Ship against known standards with minimal exploratory overhead.

**Primary skills**

- `flow-develop`
- `skill-tdd`
- `omega-sentinel`
- `skill-verify`

**Operational phases**

1. confirm standard and runtime surface
2. implement minimal change against the canonical path
3. run tests/type checks/build checks relevant to the surface
4. verify read-back or runtime behavior
5. record delivery outcome for future routing confidence

**Success condition**

- implementation is merged into the canonical surface
- relevant verification passes
- no contract drift introduced

**Primary KPI contribution**

- time to verified implementation
- regression avoidance
- runtime consistency

### Loop E — Adoption Flywheel

**Use when**

- a tool, route, prompt, or pattern has shipped
- the platform needs to learn what should be preferred next time

**Goal**

Turn execution results into ranked adoption signals.

**Primary skills**

- `skill-iterative-loop`
- `skill-status`
- `flow-deliver`
- `skill-verify`

**Operational phases**

1. capture calls, failures, quality, and recency
2. calculate tool/pattern performance signals
3. rerank discovery and reuse candidates
4. surface the best option next time via routing
5. repeat on fixed cadence

**Success condition**

- routing changes based on observed performance, not opinion
- better tools become easier to pick

**Primary KPI contribution**

- adoption rate per tool/pattern
- error rate per tool
- quality score per tool
- time to correct tool

## 5. Loop Selection Rules

Canonical selection order:

1. If `knownCapabilityMatches > 0`, evaluate `Loop B` first.
2. If `coverageScore < 0.40` or `unknownRelationCount` is high, force `Loop A` or `Loop C` before implementation.
3. If `canonicalNodeCount > 0` and the task is standards/policy/template shaped, choose `Loop C`.
4. If confidence and coverage are high and runtime surface exists, compress directly to `Loop D`.
5. After any delivery, feed results into `Loop E`.

Hard rules:

- no `Loop D` when coverage is low and no runtime surface is known
- no new standard when reuse candidate already satisfies the intent
- no completion claim without `skill-verify` evidence
- no graph/material write without read-back verification

## 6. Recommended Skill Sets

### Skill Set 1 — Discovery and Harvest

- `flow-discover`
- `skill-intent-contract`
- `omega-sentinel`
- `skill-verify`

Best for:

- new domains
- phantom harvesting
- low-coverage repos

### Skill Set 2 — Reuse and Choice

- `flow-discover`
- `skill-decision-support`
- `omega-sentinel`
- `skill-verify`

Best for:

- capability matching
- avoiding duplicate tools
- deciding adapt vs build

### Skill Set 3 — Standards and Contracts

- `flow-discover`
- `flow-spec`
- `omega-sentinel`
- `skill-verify`

Best for:

- standardization
- policy convergence
- template/contract generation

### Skill Set 4 — High-Confidence Delivery

- `flow-develop`
- `skill-tdd`
- `omega-sentinel`
- `skill-verify`

Best for:

- known domains
- route hardening
- implementation against existing surfaces

### Skill Set 5 — Adoption Optimization

- `skill-iterative-loop`
- `skill-status`
- `flow-deliver`
- `skill-verify`

Best for:

- ranking loops
- tool adoption
- iterative quality improvement

## 7. KPI Framework

These are the primary intelligence and strategy KPIs.

### Routing Quality

- `tool_selection_accuracy`
- `time_to_correct_tool`
- `reuse_before_build_rate`

### Intelligence Quality

- `coverage_score_by_repo`
- `known_capability_match_rate`
- `pattern_conversion_rate`

### Delivery Quality

- `time_to_verified_change`
- `contract_drift_incidents`
- `verification_pass_rate`

### Adoption Quality

- `tool_adoption_rate`
- `quality_score_per_tool`
- `error_rate_per_tool`
- `last_used_recency`

## 8. Phantom Priorities That Strengthen These Loops

These Phantom integrations provide the highest leverage.

### ACI Paradigm

Strengthens:

- `Loop B`
- `Loop D`
- adoption metrics

Reason:

better tool surfaces increase pick accuracy and reduce failed tool discovery.

### continuedev Hub Pattern

Strengthens:

- `Loop B`
- `Loop E`

Reason:

ranked tools and prompts make discovery evidence-driven rather than name-driven.

### CoALA Memory Taxonomy

Strengthens:

- `Loop A`
- `Loop C`
- `Loop E`

Reason:

tiered memory reduces noise and improves retrieval of relevant prior work.

### OTel `gen_ai.*` SemConv

Strengthens:

- `Loop D`
- `Loop E`

Reason:

runtime traces become comparable across agents, tools, and sessions.

### PROV-O

Strengthens:

- `Loop C`
- `Loop D`
- `Loop E`

Reason:

every artifact and decision can be traced back to source evidence and agent activity.

## 9. Minimal Execution Plan

### Phase 1 — Formalize Loop Selection

- expose Phantom routing result as a callable service
- return recommended loop family and confidence
- attach reuse suggestions and warnings

### Phase 2 — Add KPI Writeback

- capture selection, execution, success, and failure
- persist rankings for tools and patterns

### Phase 3 — Drive Mission Control / Skills Surface

- show ranked skill compositions
- show why a loop was chosen
- show adoption quality over time

## 10. Acceptance Criteria

- the platform can choose one of the five loop families from Phantom evidence
- each chosen loop maps to an explicit skill set
- each loop has measurable KPIs
- reuse decisions are explicit and auditable
- post-delivery telemetry feeds future routing

## 11. Recommendation

Treat `phantom-skill-router` as the canonical strategy primitive for autonomous improvement loops.

Do not add a parallel heuristic routing system.

Instead:

1. formalize the five loop families above
2. wire KPI writeback into adoption telemetry
3. expose ranked loop selection to Mission Control and agent-facing surfaces
4. use ACI, continuedev hub, CoALA, OTel, and PROV-O as force multipliers
