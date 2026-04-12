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

## 9. Mission Control — cc-v4 as operator cockpit for all agents (Week 13-14)

**Premise:** When the frontend is "live", Claus (and designated operators) must be
able to steer the entire multi-agent platform from cc-v4 — including the work
done in CLI sessions (Claude Code, Qwen CLI, Gemini Agent) that currently only
surface as Neo4j Episodes after the fact.

The frontend becomes the **single pane of glass** across backend agents, CLI
sessions, research missions, and QA loops.

### 9.1 Operator capabilities exposed in UI

| # | Operator action | Underlying mechanism | Route |
|---|-----------------|----------------------|-------|
| **O1** | See every agent online + current claim | `:Agent` + `:AgentMemory {type:'claim'}` via SSE | `/mission/fleet` |
| **O2** | Dispatch `AgentRequest` to any agent | `IAgent.process()` + A2A broadcast | `/mission/dispatch` |
| **O3** | Attach to live CLI session (Claude/Qwen/Gemini) | Session heartbeat + SSE token-stream | `/mission/session/[id]` |
| **O4** | Stream A2A bus in realtime | SSE from `/api/events?topics=a2a,agent,broadcast` | `/mission/a2a-bus` |
| **O5** | Browse every `:Episode` (QA, build, research) | `graph.read_cypher` paginated | `/mission/episodes` |
| **O6** | Create + monitor `:AgentHandoff` | Handoff creation API + DISCOVERED_BY tracking | `/mission/handoffs` |
| **O7** | Launch + monitor `:ResearchMission` | RM creation + candidate stream | `/mission/research` |
| **O8** | Approve/reject Qwen deliverables (QA loop) | Writes QA Episode + upgrades/blocks | `/mission/qa-queue` |
| **O9** | Linear + GitHub integration | Existing `linear.*` + `gh` MCP wrappers | `/mission/backlog` |
| **O10** | Cost + budget control per agent/session | `runtime_summary` + budget alerts | `/mission/budget` |

### 9.2 New backend surface needed (add to Week 13)

The CLI-session control capability needs a small backend extension — 3 new MCP
tools + 1 Redis stream:

1. **`session.register`** — CLI sessions (Claude Code, Qwen, Gemini) register on
   startup: `{ session_id, agent_id, tool, capabilities, operator, pid }`. TTL 1h
   with heartbeat extension. Stored as `:AgentSession` node + Redis hash.
2. **`session.heartbeat`** — updates `last_seen`, current task, token usage. SSE
   fan-out to UI subscribers.
3. **`session.command`** — operator → UI → backend → target session. Uses
   existing A2A broadcast with `thread_id` routing; session polls for commands
   or receives via its own SSE connection.
4. **Redis stream `operator:sessions`** — hot stream of session events for the UI.

Session-side glue (tiny — add to each CLI agent's boot sequence):

```bash
# Claude Code hook (.claude/hooks/session-start.sh):
curl -s -H "Authorization: Bearer $OMEGA_KEY" -H "Content-Type: application/json" \
  -d "{\"tool\":\"session.register\",\"payload\":{\"session_id\":\"$SESSION_ID\",\"agent_id\":\"claude-code\",\"tool\":\"cli\",\"capabilities\":[\"code\",\"qa\",\"orchestration\"]}}" \
  $BACKEND/api/mcp/route

# Heartbeat cron (every 30s while active):
curl -s -H "Authorization: Bearer $OMEGA_KEY" -H "Content-Type: application/json" \
  -d "{\"tool\":\"session.heartbeat\",\"payload\":{\"session_id\":\"$SESSION_ID\",\"current_task\":\"...\",\"tokens_used_total\":1234}}" \
  $BACKEND/api/mcp/route
```

Same three-line pattern for Qwen CLI and Gemini Agent — minor per-tool
wrapper, no heavy integration.

### 9.3 UI components for Mission Control

Extensions to the shared primitives (§3):

- **`<AgentRosterPanel />`** — live grid of all `:Agent`s, status lights, current
  claim preview. Click → session view.
- **`<SessionStream />`** — tails a single session's heartbeat stream, shows
  task, tokens, last action, projected cost.
- **`<A2AStreamViewer />`** — filterable SSE from A2A bus. Replay last 1h.
- **`<DispatchDialog />`** — builds `AgentRequest` via form: agent picker,
  capability filter, context YAML editor, priority slider. Submit → SSE streams
  result.
- **`<HandoffComposer />`** — creates `:AgentHandoff` with target agent +
  phase + content (reuses the Phantom handoff pattern we already use).
- **`<QAQueue />`** — every QA Episode with outcome=CONDITIONAL or PENDING,
  approve/reject/escalate buttons.
- **`<CostBudgetMeter />`** — per-agent spend vs. budget, alert at 80% / 100%.

### 9.4 Delivery — Week 13-14 execution plan

**Week 13 — Session control + A2A stream (backend + 3 routes)**

Deliverables:
1. Backend: `src/routes/session.ts` — new MCP tools `session.register`,
   `session.heartbeat`, `session.command`
2. Backend: `src/events.ts` extension — `operator:sessions` Redis stream
   + SSE topic
3. Cypher migration: `:AgentSession {session_id, agent_id, operator, pid,
   started_at, last_seen, current_task}`
4. Frontend: `cc-v4/src/features/mission-control/` — `/mission/fleet`,
   `/mission/session/[id]`, `/mission/a2a-bus`
5. CLI session registration hooks for all three (Claude Code, Qwen, Gemini)
6. Runbook §16 — session-register protocol + troubleshooting

Exit gates:
- [ ] 3 MCP tools live + deploy verified
- [ ] Claude Code CLI auto-registers on start, sends heartbeat every 30s
- [ ] Qwen CLI + Gemini Agent register via same pattern
- [ ] `/mission/fleet` shows all active sessions with <5s lag
- [ ] `/mission/a2a-bus` streams realtime, pause/resume works
- [ ] SSE reconnect on network drop
- [ ] Runbook §16

**Week 14 — Dispatch + Handoff + QA + Budget (4 routes)**

Deliverables:
1. Frontend: `/mission/dispatch` — any-agent dispatch with context editor
2. Frontend: `/mission/handoffs` — handoff composer + timeline
3. Frontend: `/mission/qa-queue` — open QA Episodes approve/reject flow
4. Frontend: `/mission/budget` — cost meter + 80%/100% threshold alerts
5. Frontend: `/mission/episodes` — searchable Episode browser with lesson extraction
6. Frontend: `/mission/research` — ResearchMission console with candidate stream
7. Feature flag: `VITE_FEATURE_MISSION_CONTROL=1` (roles: operator, owner)
8. Runbook §17 — operator playbook (one-page cheat sheet)

Exit gates:
- [ ] Operator can dispatch to any registered agent from UI, receive result
- [ ] Handoff creation produces `:AgentHandoff` node with proper edges
- [ ] QA approval writes Episode update, rejection writes FailureMemory
- [ ] Budget alerts fire at correct thresholds (Slack + UI toast)
- [ ] Episode search supports full-text + tag filter
- [ ] ResearchMission launch → candidate injection stream visible
- [ ] Playwright E2E: dispatch → session response → QA sign-off loop
- [ ] Accessibility + i18n maintained
- [ ] Runbook §17

### 9.5 Authorization model

Not every operator should dispatch to every agent. Simple RBAC via existing
session auth:

| Role | Can | Cannot |
|------|-----|--------|
| `owner` (Claus) | Everything | — |
| `operator` | Dispatch, QA approve, session attach | Change budget caps, kill sessions |
| `viewer` | Read-only mission control | Any write |

Implemented via `useSessionStore.role` + route guards. Audit all dispatch
actions to `:OperatorAction` nodes for traceability.

### 9.6 Constraints for Mission Control

- **Read-first UI**: every destructive action (kill session, reject QA,
  revoke claim) requires confirmation modal
- **Zero hidden state**: UI must reflect Neo4j + Redis truth, never cache
  more than 30s
- **Session transparency**: operator always sees which CLI + model a given
  agent is running (Claude Opus, Qwen Coder, Gemini Pro)
- **Graceful degradation**: if SSE drops, UI shows "stale" indicator and
  falls back to 30s polling
- **Immutable audit trail**: `:OperatorAction` nodes never DELETE, only
  supersede (aligns with V10 bi-temporal pattern)

### 9.7 Risk register — Mission Control

| Risk | Mitigation |
|------|-----------|
| CLI session registration fails silently | Hook must `exit 1` if register fails; CI gate verifies hook exists |
| Operator accidentally broadcasts to 60 agents | Dispatch dialog requires target selection; "broadcast to all" is a separate audited action |
| Budget alert fatigue | Per-agent thresholds + quiet-hours + alert dedup (max 1 per hour) |
| A2A stream volume overwhelms browser | Server-side filter; client paginates, max 500 msgs in DOM |
| Session heartbeat thrashes Redis | Use Redis TTL + `hset` (single op), not stream-per-heartbeat |

---

## 10. Success metrics after Week 12 (foundation) + Week 14 (Mission Control)

| Metric | Target |
|--------|--------|
| All 10 V-props reachable in UI | ✅ (Week 12) |
| TypeScript strict, 0 `any` in new code | ✅ |
| Vitest coverage on new modules | ≥80% |
| Lighthouse Performance / A11y | ≥85 / ≥95 |
| Mean time to first value on V1 (cold) | <15 s |
| Cost visibility latency | <5 s drift vs server |
| New runtime dependencies added | ≤3 |
| **Mission Control (Week 14):** all 3 CLI tools auto-register | ✅ |
| Live agent roster lag (fleet view) | <5 s |
| Operator can dispatch → receive result in UI | ✅ |
| QA approval loop (UI → Episode write) | ≤3 clicks |
| SSE reconnect recovery | <5 s |
| Audit trail completeness (every dispatch → OperatorAction) | 100% |

---

## 11. Handoff + QA (same protocol as backend)

1. Qwen builds — deliverable table + constraints + Neo4j Episode
2. Claude QAs — type safety + live probe + Playwright test run + accessibility audit
3. P0/P1 fix same session
4. Deploy verify — Vercel preview URL + Lighthouse run
5. Runbook section committed with PR

Episode ID convention: `phantom-qa-fe-w{N}-2026-04-XX-claude`.
