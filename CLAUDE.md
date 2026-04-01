# WidgeTDC Orchestrator — Project Cockpit

Central autonomous intelligence platform for WidgeTDC. Single cockpit for all 6 repos.

## Shared Skills (centralt vedligeholdt i WidgeTDC)

Skills vedligeholdes centralt i WidgeTDC repo og deles via filsystem:
- Fuld kapabilitetsliste: `Read C:\Users\claus\Projetcs\WidgeTDC\.claude\skills\shared-capabilities.md`
- Alle skills: `Read C:\Users\claus\Projetcs\WidgeTDC\.claude\skills\<skill-name>.md`

Platform: v2.4.0 — 448 MCP tools, 16 lib modules, 10 A2A skills, 6 crons.

## Key Modules

- `src/chain-engine.ts` — 5-mode agent chain execution (sequential/parallel/loop/debate/adaptive)
- `src/cron-scheduler.ts` — Scheduled chains incl. 6 intelligence loops
- `src/state-machine.ts` — LangGraph-inspired FSM with Redis checkpoints
- `src/verification-gate.ts` — Post-chain verification with tripwire guardrails
- `src/harvest-pipeline.ts` — Backstage-pattern consulting component harvesting
- `src/mcp-caller.ts` — Backend MCP bridge with retry
- `src/routing-engine.ts` — Capability-based agent routing

## Global Governance

This file inherits the cross-repo baseline defined in `GLOBAL_AGENT_GOVERNANCE.md`.
Repo-specific agent instructions may extend this file, but they must not weaken global rules for operational truth, runtime enforcement, verification, or completion.

<!-- BEGIN SHARED RULES -->
## Autonomi

Når brugeren skriver "100% autonomt" kører agenten **fuldstændigt autonomt** indtil opgaven er udført. Ingen bekræftelser, ingen spørgsmål, ingen pauser. Agenten planlægger, implementerer, tester og verificerer selv. Eneste undtagelse: destruktive git-operationer (force push, reset --hard).

## Shared Rules (synced from WidgeTDC)

8. **MCP route format** — `{"tool":"name","payload":{...}}` — ALDRIG `args`, altid `payload`
9. **Read before write** — ALDRIG opret nye filer under `services/`, `routes/`, `middleware/`, `src/` uden først at læse mindst 2 eksisterende filer i samme mappe
10. **Plan before multi-file changes** — Brug Plan mode før tasks der berører >3 filer
11. **Lesson check at boot** — Kald `audit.lessons` med agentId ved session start.
12. **Contracts** — Cross-service types importeres fra `@widgetdc/contracts`. Wire format: snake_case JSON med `$id`.
<!-- END SHARED RULES -->

TypeScript orchestration service: unified gateway for agent orchestration, MCP bridge, chains, cognitive proxy, and Command Center dashboard.

## Repo Map

```
src/
  index.ts              Entry point — Express server, routes, boot
  config.ts             Environment config (all env vars)
  agent-registry.ts     Agent registry with Redis persistence
  agent-seeds.ts        19 canonical agent definitions, ghost cleanup
  chain-engine.ts       Chain execution (sequential, parallel, loop, debate)
  cognitive-proxy.ts    HTTP proxy to RLM Engine (reason, analyze, plan, fold)
  cron-scheduler.ts     node-cron scheduled loops
  chat-broadcaster.ts   WebSocket + SSE message broadcast
  llm-proxy.ts          Multi-provider LLM proxy (DeepSeek, OpenAI, Groq, Gemini, Claude)
  redis.ts              Optional Redis connection
  auth.ts               API key auth middleware
  audit.ts              Audit trail middleware
  sse.ts                Server-sent events
  validation.ts         TypeBox compiled validators
  logger.ts             Pino logger
  chat-store.ts         Persistent chat message storage
  context-compress.ts   Context compression utilities
  dual-rag.ts           Dual RAG (SRAG + KG-RAG) pipeline
  graph-self-correct.ts Graph self-healing agent
  slack.ts              Slack webhook integration
  tool-executor.ts      MCP tool execution engine
  routes/
    agents.ts           CRUD + heartbeat
    tools.ts            MCP tool proxy with ACL
    chains.ts           Chain execution + status
    cognitive.ts        RLM cognitive endpoints
    cron.ts             Cron CRUD + trigger
    chat.ts             REST chat + WS stats
    llm.ts              LLM chat + providers
    dashboard.ts        Dashboard data API (Redis-cached, 15s TTL)
    audit.ts            Audit log query
    openclaw.ts         OpenClaw gateway proxy
    knowledge.ts        Knowledge graph endpoints
    monitor.ts          Platform monitoring endpoints
    openai-compat.ts    OpenAI-compatible /v1 API
    s1-s4.ts            S1-S4 research pipeline endpoints
frontend/
  index.html            Command Center SPA (single file, vanilla JS)
dist/                   Pre-built bundle (committed, Railway runs directly)
test-e2e.mjs            72 comprehensive e2e tests
build.mjs               esbuild bundler
```

## Essential Commands

```bash
npm run build              # esbuild bundle → dist/
node test-e2e.mjs          # 72 e2e tests against production
railway up -s orchestrator # Deploy to Railway
```

## Rules (Ufravigelige)

1. ESM only — import/export, never require()
2. TypeScript strict mode
3. Auth: Authorization Bearer on all backend/RLM calls
4. dist/ is committed — Railway runs `node dist/index.js` directly
5. Frontend is vanilla JS in a single HTML file — NO TypeScript syntax (as/interface)
6. Always `node --check` extracted JS before deploy
7. Conventional commits (feat:, fix:, docs:, refactor:)
8. **MCP route format** — `{"tool":"name","payload":{...}}` — ALDRIG `args`, altid `payload`
9. **Read before write** — ALDRIG opret nye filer under `src/`, `routes/` uden først at læse mindst 2 eksisterende filer i samme mappe
10. **Plan before multi-file changes** — Brug Plan mode før tasks der berører >3 filer

## Danger Zones

- Never use TypeScript syntax (`as number`, `interface`) in frontend JS — crashes browsers
- Never call backend without Authorization header
- Never bypass rate limiting on MCP tool calls
- Agent coordination must handle timeouts gracefully

## Key Integrations

- Backend MCP: https://backend-production-d3da.up.railway.app/api/mcp/route
- RLM Engine: https://rlm-engine-production.up.railway.app
- Redis: Railway Redis in widgetdc-prod project

## Cross-Repo

Part of WidgeTDC platform (Clauskraft/).
Contracts: widgetdc-contracts (snake_case JSON, $id required).
Production: https://orchestrator-production-c27e.up.railway.app
