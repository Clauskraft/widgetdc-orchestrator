# WidgeTDC Orchestrator — Multi-Agent Coordination Layer

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
  routes/
    agents.ts           CRUD + heartbeat
    tools.ts            MCP tool proxy with ACL
    chains.ts           Chain execution + status
    cognitive.ts        RLM cognitive endpoints
    cron.ts             Cron CRUD + trigger
    chat.ts             REST chat + WS stats
    llm.ts              LLM chat + providers
    dashboard.ts        Dashboard data API
    audit.ts            Audit log query
    openclaw.ts         OpenClaw gateway proxy
frontend/
  index.html            Command Center SPA (single file, vanilla JS)
dist/                   Pre-built bundle (committed, Railway runs directly)
test-e2e.mjs            50 comprehensive e2e tests
build.mjs               esbuild bundler
```

## Essential Commands

```bash
npm run build              # esbuild bundle → dist/
node test-e2e.mjs          # 50 e2e tests against production
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
