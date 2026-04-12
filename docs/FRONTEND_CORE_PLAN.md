# Frontend Core Plan — cc-v4 UI for V1–V10 Value-Props

**Date:** 2026-04-13
**Target repo:** `widgetdc-orchestrator/cc-v4/`
**Stack:** React 19 + Vite 5 + TanStack Router + Zustand + MSW
**Principle:** The core logic lives in the orchestrator backend. Frontend is a thin, typed, accessible shell that exposes V1–V10 to human operators and clients.

---

## 0. Why this plan exists

v4.0 delivers 10 value-props as MCP tools (+ sub-tools). Without a usable UI, they stay agent-only. This plan wires cc-v4 to the canonical `AgentRequest` / `AgentResponse` contract and surfaces each value-prop as a first-class user journey.

**Non-goal:** rewriting cc-v4. All views plug into existing TanStack Router tree under `_authenticated` with Zustand stores + MSW handlers in dev.

---

## 1. Contract-first frontend architecture

### 1.1 Shared types from `@widgetdc/contracts`

Every fetch from cc-v4 to orchestrator uses canonical types:

```ts
import type {
  AgentRequest, AgentResponse, AgentConflict,
  CapabilityMatrix, TokenUsage,
} from '@widgetdc/contracts/agent'
```

No ad-hoc JSON shapes. Every response typed end-to-end.

### 1.2 API client facade

`cc-v4/src/lib/agent-client.ts` (new) — one dispatch function:

```ts
export async function dispatch<T = unknown>(
  opts: { agent_id: string; task: string; capabilities?: string[]; context?: Record<string, unknown>; priority?: AgentPriority }
): Promise<AgentResponse & { parsed?: T }>
```

Wraps existing `api-client.ts` (already tested in Week 5). Parses `response.output` as JSON when tool returns structured data, exposes via `parsed`. Logs token/cost to Zustand `useTelemetryStore` for client-side cost display.

### 1.3 Zustand stores (new)

- `useSessionStore` — current user, engagement_id, active client
- `useTelemetryStore` — rolling token/cost totals this session (reads `runtime_summary` every 30 s)
- `useJobStore` — async jobs in-flight (V4 deliverable draft can take 3 min — show progress)

All stores typed via contract, persisted to `localStorage` for session continuity.

---

## 2. One route per Value-Prop

Under `cc-v4/src/routes/_authenticated/`:

| Route | Value-Prop | Primary tool | UI pattern |
|-------|-----------|--------------|-----------|
| `/compliance/audit` | V1 AI-Act gap | `compliance_audit_gap` | Upload JSON → streaming gap list + severity badges |
| `/review/new` | V2 PR review | `pr_review_parallel` | Paste diff URL → 3-verdict diff viewer |
| `/engagements/[id]/costs` | V3 cost rollup | `engagement_cost_report` | Bar chart by agent + token breakdown |
| `/deliverable/draft` | V4 deck factory | `deliverable_draft` | PDF drop → stage progress → deck preview |
| `/fleet/drift` | V5 drift detection | `agent_drift_report` | Heatmap + Linear issue quick-links |
| `/skills` | V6 corpus browser | `prompts.search` | Category filter + quality-score sort |
| `/search` | V7 RAG router | `rag_route` | Unified search box with strategy indicator |
| `/dd/scan/new` | V8 OSINT DD | `compliance.pre_engagement` | Target whitelist + scope confirm → memo |
| `/skills/[id]/tune` | V9 prompt A/B | `prompt.quality_loop` | A/B test harness UI |
| `/facts/timeline` | V10 bitemporal | Cypher-graph-view | Timeline scrubber over `:Fact` supersession chain |

Each route ships as a self-contained feature module in `cc-v4/src/features/<slug>/`.

---

## 3. Shared UI primitives (build once, reuse 10×)

### 3.1 `<AgentResponseCard />`
Renders any `AgentResponse`: status pill (success/partial/failed/conflict), output preview, token usage, cost, conflicts list. Reused on every route.

### 3.2 `<JobProgress />`
Long-running `deliverable_draft` / `compliance_audit_gap` show SSE progress via existing `/api/events` endpoint. Cancellable.

### 3.3 `<CostBadge />`
Always-visible session token/cost total in header. Pulls from `useTelemetryStore`. Click → opens `/engagements/[id]/costs`.

### 3.4 `<ConflictResolver />`
When `AgentResponse.status === 'conflict'`, render advisory panel with `other_agent_id` + similarity + suggestion. User clicks "collaborate" → A2A broadcast.

### 3.5 `<CitationList />`
For V1/V4/V8 — every claim in output has `[Source: CODE-ID]` marker → renders as linked footnote, fetched from Phantom BOM via `srag.query`.

### 3.6 `<StrategyIndicator />`
For V7 `rag_route` — shows which strategy was used (simple / multi-hop / PPR / community). Debug aid + pricing transparency.

---

## 4. Execution Plan — Frontend Weeks 10-12

Same QA cadence as backend weeks. Qwen builds routes, Claude QAs each route end-to-end.

### Week 10 — Foundation + 3 direct routes (V1, V3, V5)

**Deliverables:**
1. `cc-v4/src/lib/agent-client.ts` — typed dispatch facade
2. `cc-v4/src/stores/session.ts`, `telemetry.ts`, `jobs.ts`
3. `cc-v4/src/components/shared/` — `AgentResponseCard`, `JobProgress`, `CostBadge`
4. Routes: `/compliance/audit`, `/engagements/[id]/costs`, `/fleet/drift`
5. MSW handlers for all 3 routes
6. Component tests via vitest (already wired in Week 5) — ≥1 per feature module

**Exit gates:**
- [ ] Contract types flow end-to-end (no `any` in new code)
- [ ] 3 routes render live data from production orchestrator
- [ ] `<CostBadge />` visible on all authenticated pages
- [ ] MSW-mocked `AgentResponse` drives dev mode (no backend dep)
- [ ] Vitest passes + TypeScript strict mode clean
- [ ] Accessibility: keyboard-navigable, ARIA labels on badges
- [ ] Runbook §13: frontend troubleshooting

### Week 11 — Deliverable Factory + PR Review (V2, V4)

**Deliverables:**
1. `/review/new` — diff input (URL / paste / GitHub webhook), 3-verdict split-view
2. `/deliverable/draft` — PDF drop + stage timeline (ingest → retrieve → reason → render)
3. `<CitationList />` component + footnote renderer
4. `<ConflictResolver />` component
5. SSE integration for long-running jobs
6. Feature flags: `deliverable_draft` behind `VITE_FEATURE_DELIVERABLE=1` (staged rollout)

**Exit gates:**
- [ ] V2 demo: paste GitHub PR URL → merged review in UI <90 s
- [ ] V4 demo: 2-page PDF → preview deck with 10+ citations
- [ ] Progress events arrive via SSE, cancel button works
- [ ] Feature flag gating tested in both states
- [ ] Cost display correct (validates `runtime_summary` parity)
- [ ] Runbook §14

### Week 12 — Skills + Search + Bitemporal (V6, V7, V8, V9, V10)

**Deliverables:**
1. `/skills` + `/skills/[id]/tune` — prompt browser + A/B harness
2. `/search` — unified RAG with `<StrategyIndicator />`
3. `/dd/scan/new` — OSINT workflow with scope-consent modal
4. `/facts/timeline` — interactive bitemporal fact scrubber using existing graph visualization
5. Theme + branding pass (consulting-ready screenshots)
6. End-to-end Playwright tests for 3 critical paths (V1, V4, V7)

**Exit gates:**
- [ ] All 10 routes shipped, all pass vitest + Playwright E2E
- [ ] Lighthouse: Performance ≥85, Accessibility ≥95, Best Practices ≥90
- [ ] Theme consistent (Mercury invisible router + Canvas 5X aesthetic)
- [ ] `VITE_API_URL` points to prod by default, staging via flag
- [ ] Runbook §15 — full frontend user-journey reference

---

## 5. Frontend constraints (non-negotiable)

- **No duplicate types** — everything from `@widgetdc/contracts`
- **No raw `fetch()`** — only via `agent-client.ts` facade (so telemetry + typing applies)
- **No secrets in client** — API key lives in Vite env only; production uses session auth
- **ESM + React 19** — no class components, only hooks
- **Strict TS mode** — `any` banned except at MSW boundary
- **Snake_case in API payloads, camelCase in UI state** — translate at the client facade, nowhere else
- **Error boundary on every route** — `<ErrorBoundary>` from Week 5 wraps each feature module
- **No new runtime deps** without justification — cc-v4 bloat is a P2 finding at QA

---

## 6. API surface cc-v4 consumes

All via single `dispatch()` facade:

| User action | `AgentRequest.context` | Underlying tool |
|-------------|------------------------|-----------------|
| Run compliance audit | `{ tool_name: 'compliance_audit_gap', tool_args: {...} }` | V1 |
| Review PR | `{ tool_name: 'pr_review_parallel', tool_args: { diff_url } }` | V2 |
| Cost report | `{ tool_name: 'engagement_cost_report', tool_args: { engagement_id } }` | V3 |
| Draft deliverable | `{ tool_name: 'deliverable_draft', tool_args: { pdf_base64 } }` | V4 |
| Drift report | `{ tool_name: 'agent_drift_report', tool_args: { window_days } }` | V5 |
| Browse prompts | `{ tool_name: 'prompt_search', tool_args: { category } }` | V6 |
| Unified search | `{ tool_name: 'rag_route', tool_args: { query } }` | V7 |
| Due-diligence scan | `{ tool_name: 'compliance_pre_engagement', tool_args: { target } }` | V8 |
| Tune prompt | `{ tool_name: 'prompt_quality_loop', tool_args: { prompt_id } }` | V9 |
| Fact timeline | `{ tool_name: 'graph.read_cypher', tool_args: { query: '<bitemporal>' } }` | V10 |

Zero direct MCP calls — every flow is `AgentRequest → IAgent.process() → AgentResponse`.

---

## 7. Accessibility + i18n

- **i18n:** Danish + English toggle via context. Strings in `cc-v4/src/i18n/{da,en}.json`. No hardcoded user-facing copy.
- **A11y:** WCAG 2.1 AA. Keyboard reachable, ARIA labels, color-contrast verified.
- **Responsive:** Desktop primary (consulting context), tablet + mobile read-only support.

---

## 8. Risk register

| Risk | Mitigation |
|------|-----------|
| V4 / V8 long jobs time out in Vite HMR | SSE + backgrounded via service worker; show `<JobProgress>` |
| `runtime_summary` polling load on Redis | 30 s cadence, scoped to active engagement |
| TanStack Router DX regression at 10+ new routes | Generated routeTree stays small; use route groups |
| Playwright flaky on V7 strategy timing | Mock `rag_route` in E2E; unit-test strategy selection separately |
| Client-side cost display lag behind server | Accept 5s drift; label as "indicative" |

---

## 9. Success metrics after Week 12

| Metric | Target |
|--------|--------|
| All 10 V-props reachable in UI | ✅ |
| TypeScript strict, 0 `any` in new code | ✅ |
| Vitest coverage on new modules | ≥80% |
| Lighthouse Performance / A11y | ≥85 / ≥95 |
| Mean time to first value on V1 (cold) | <15 s |
| Cost visibility latency | <5 s drift vs server |
| New runtime dependencies added | ≤3 |

---

## 10. Handoff + QA (same protocol as backend)

1. Qwen builds — deliverable table + constraints + Neo4j Episode
2. Claude QAs — type safety + live probe + Playwright test run + accessibility audit
3. P0/P1 fix same session
4. Deploy verify — Vercel preview URL + Lighthouse run
5. Runbook section committed with PR

Episode ID convention: `phantom-qa-fe-w{N}-2026-04-XX-claude`.
