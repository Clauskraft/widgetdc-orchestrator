# CC v4 Continuation Prompt

Copy-paste this into a new Cowork chat to resume where we left off.

---

## Context

I'm rebuilding the WidgeTDC Command Center (CC v4) — replacing the old vanilla JS single-file frontend with a production-grade React SPA based on **shadcn-admin** (11.7K stars, MIT).

### What's done (committed as `d6a3ff8` on main, pushed to GitHub)

**Stack:** React 19 + TypeScript + Vite + TailwindCSS 4 + shadcn/ui + TanStack Router + TanStack Query + Zustand + Recharts + Lucide icons

**Built and committed:**
- `frontend-v4/` — Pre-built Vite output (index.html + 104 JS chunks + CSS + images)
- `dist/public/` — Same output, ready for Railway serving
- `build.mjs` — Updated to copy `frontend-v4/` → `dist/public/` (falls back to legacy `frontend/index.html`)
- `src/index.ts` — SPA catch-all routing (`app.get('*', ...)` serves index.html for all non-API routes)

**CC v4 source code** lives in the Cowork sandbox at `cc-v4/` (NOT yet committed to repo — see LIN-651). Key files:
- `cc-v4/src/components/layout/data/sidebar-data.ts` — 6 sidebar groups, 17 panels with lucide icons
- `cc-v4/src/lib/api-client.ts` — Axios with Bearer token from Zustand auth store
- `cc-v4/src/stores/auth-store.ts` — API key auth (cookie-persisted, validates against `/api/dashboard`)
- `cc-v4/src/features/dashboard/index.tsx` — KPI cards (Agents, Chains, Tools, Cron) from live API
- `cc-v4/src/features/{agents,chains,cron,chat,omega,knowledge,cognitive,pheromone,fleet-learning,inventor,anomaly,audit,cost,adoption,openclaw,obsidian}/index.tsx` — 17 panel components, all with real API calls + loading/error states
- `cc-v4/src/features/auth/sign-in/components/user-auth-form.tsx` — API key input form

**Sidebar groups:**
1. Operations: Dashboard, Agents, Chains, Cron
2. Intelligence: Chat, Omega SITREP, Knowledge, Cognitive
3. Platform: Pheromone, Fleet Learning, Inventor, Anomaly
4. Analytics: Audit Log, Cost Intel, Adoption
5. Integrations: OpenClaw, Obsidian Vault
6. System: Settings (5 sub-pages), Help Center

### What's NOT done (all tracked in Linear)

| Issue | Priority | Description |
|-------|----------|-------------|
| **LIN-650** | P0/Urgent | Commit rebuilt `dist/index.js` and redeploy. Pre-push hook rebuilt it but the result wasn't committed. Production still serves old v3.1. |
| **LIN-651** | P0/Urgent | Copy `cc-v4/` source to Windows/repo. Source code only exists in Cowork sandbox. |
| **LIN-657** | P1/High | Auth guard — `_authenticated/route.tsx` doesn't check auth state yet. Anyone can access panels without API key. |
| **LIN-655** | P1/High | Branding — page title still says "Shadcn Admin", favicon is generic. |
| **LIN-652** | P1/High | Wire Obsidian panel to MCP tools (`mcp__obsidian-vault__*`). Currently placeholder. |
| **LIN-653** | P2/Medium | Add Recharts charts to Dashboard, Cost Intel, Adoption panels. |
| **LIN-654** | P2/Medium | Enrich all 17 panels with TanStack Tables, drill-downs, real-time WebSocket updates. |
| **LIN-656** | P2/Medium | Check `unified-cockpit-v1` inventor experiment results (UCB1, 20 steps). |

### Architecture notes

- **Orchestrator** serves static files from `dist/public/` via `express.static`
- **SPA catch-all** at end of routes: `app.get('*', ...)` returns `index.html` for non-API paths
- **Railway** runs `node dist/index.js` directly — NO build step on deploy. Must rebuild locally and commit `dist/`.
- **API routes** all under `/api/*`, `/agents`, `/tools`, `/chat`, `/chains`, `/cognitive`, `/cron`, `/health`, `/ws`, `/sse`, `/monitor`, `/mcp`
- **Auth** — all backend routes require `Authorization: Bearer <API_KEY>` header
- **Production URL** — https://orchestrator-production-c27e.up.railway.app

### Pre-existing HyperAgent + Inventor issues (also open)

| Issue | Priority | Description |
|-------|----------|-------------|
| **LIN-626** | P1/High | HyperAgent Layer: Plan-Based Execution on top of Chain Engine (goal→plan→approve→execute→evaluate lifecycle) |
| **LIN-627** | P1/High | HyperAgent: Persistent Approval Gate with Redis + Webhook |
| **LIN-628** | P1/High | HyperAgent: KPI Persistence & Cross-Service Trace Unification (Neo4j AgentMemory nodes) |
| **LIN-634** | P1/High | DriftGate governance nodes empty in Neo4j — sync HyperAgent POLICY_PROFILES to graph |
| **LIN-430** | P1/High | GATE-FINAL: 90-Day KPI Evaluation (20% advanced utilization target) |
| **LIN-66** | Backlog | RLM Sequential Thinking live-test and comparison |
| **LIN-138** | Backlog | Snout-Bandit v2 — Delta-First Pattern Harvester |

### Immediate action

**Phase 1 (deploy CC v4):**
1. **LIN-650** — Commit rebuilt dist + redeploy (P0, 5 min)
2. **LIN-651** — Save cc-v4 source to repo (P0, 10 min)
3. **LIN-657** — Auth guard (P1)
4. **LIN-655** — WidgeTDC branding (P1)

**Phase 2 (enrich CC v4):**
5. **LIN-652** — Obsidian Vault MCP integration
6. **LIN-653** — Recharts visualizations
7. **LIN-654** — Panel enrichment (tables, drill-downs, WebSocket)

**Phase 3 (HyperAgent + platform):**
8. **LIN-626** — HyperAgent plan-based execution
9. **LIN-627** — Approval gate
10. **LIN-628** — KPI persistence
11. **LIN-634** — DriftGate governance nodes

Run `100% autonomt` to execute without confirmations.
