# WidgeTDC Agent Manual — Promptgenerator

> Beskriv hvad du vil -- fa den rigtige skill + prompt.
> Platform v2.4.0 | 448 MCP tools | 16 lib modules | 10 A2A skills | 6 crons

---

## Hurtigstart

1. **Beskriv dit behov** i naturligt sprog (dansk eller engelsk)
2. **System foreslaar** den rigtige skill + genererer en klar prompt
3. **Kopier og koer** i Claude Code, Open WebUI, eller Obsidian

Du kan ogsaa bruge Prompt Generator API direkte:

```bash
curl -X POST https://orchestrator-production-c27e.up.railway.app/api/prompt-generator \
  -H "Content-Type: application/json" \
  -d '{"description": "Lav en praesentation om Q1 resultater"}'
```

Svar:
```json
{
  "skill": "/octo:deck",
  "prompt": "/octo:deck brief=\"Q1 resultater\" slides=10 audience=\"board\"",
  "explanation": "Brug /octo:deck til at generere slide decks fra et brief."
}
```

---

## Skill Catalog (grupperet efter domaene)

### Praesentationer & Dokumenter

| Behov | Skill | Eksempel-prompt |
|-------|-------|-----------------|
| Slide deck | `/octo:deck` | `/octo:deck brief="Q1 platform status" slides=10` |
| PDF/DOCX rapport | `/octo:docs` | `/octo:docs format=pdf topic="NIS2 compliance audit"` |
| PRD (Product Requirement Doc) | `/octo:prd` | `/octo:prd "Add rate limiting to webhook endpoint"` |
| Spec (teknisk specifikation) | `/octo:spec` | `/octo:spec "Temporal memory v2 design"` |
| PRD scoring | `/octo:prd-score` | `/octo:prd-score path="docs/my-prd.md"` |

### Research & Analyse

| Behov | Skill | Eksempel-prompt |
|-------|-------|-----------------|
| Deep research | `/octo:research` | `/octo:research "RAG evaluation frameworks 2025"` |
| OSINT intelligence | `/obsidian-osint` | `/obsidian-osint target="CompetitorCo"` |
| Graph foresoergsel | `/obsidian-graph` | `/obsidian-graph "vis alle orphan nodes"` |
| Brainstorm | `/octo:brainstorm` | `/octo:brainstorm "How to reduce LLM costs 50%"` |
| Discovery (Double Diamond) | `/octo:discover` | `/octo:discover "user onboarding friction points"` |
| Definition phase | `/octo:define` | `/octo:define "scope the authentication redesign"` |
| Content pipeline | `/octo:pipeline` | `/octo:pipeline url="https://example.com/article"` |
| AI Debate | `/octo:debate` | `/octo:debate "monolith vs microservices for our scale"` |

### Kode & Udvikling

| Behov | Skill | Eksempel-prompt |
|-------|-------|-----------------|
| Feature dev (auto-routing) | `/agent-chain` | `/agent-chain Add rate limiting to /api/ask` |
| Debug | `/octo:debug` | `/octo:debug "TypeError in cortex_reasoning.py line 234"` |
| Code review | `/octo:review` | `/octo:review PR #4100` |
| Code review (CC) | `/code-review:code-review` | `/code-review:code-review 4100` |
| TDD | `/octo:tdd` | `/octo:tdd "implement claim TTL in Redis"` |
| Security audit | `/octo:security` | `/octo:security scope=WidgeTDC` |
| Staged review | `/octo:staged-review` | `/octo:staged-review spec="docs/spec.md"` |
| Design extraction | `/octo:extract` | `/octo:extract repo="widgetdc-consulting-frontend"` |
| UI/UX design | `/octo:design-ui-ux` | `/octo:design-ui-ux "dashboard redesign palette"` |
| Factory mode (autonom) | `/octo:factory` | `/octo:factory spec="docs/rate-limiter-spec.md"` |
| Parallel execution | `/octo:parallel` | `/octo:parallel "lint all 6 repos"` |

### Platform Management

| Behov | Skill | Eksempel-prompt |
|-------|-------|-----------------|
| Release | `/release-manager` | `/release-manager tag v2.6.0 across all repos` |
| Deploy verify | `/deploy-guardian` | `/deploy-guardian verify RLM after push` |
| 90-day PM | `/project-manager-90day` | `/project-manager-90day hydrer status` |
| Project Manager | `/project-manager-widgetdc` | `/project-manager-widgetdc status` |
| Omega audit | `/omega-sentinel` | `/omega-sentinel SITREP` |
| Performance monitor | `/performance-monitor` | `/performance-monitor check response times` |
| Database guardian | `/database-guardian` | `/database-guardian check migration safety` |
| QA guardian | `/qa-guardian` | `/qa-guardian run regression suite` |
| Compliance officer | `/compliance-officer` | `/compliance-officer NIS2 gap analysis` |
| Loop orchestrator | `/loop-orchestrator` | `/loop-orchestrator schedule nightly harvest` |

### Arkitektur & Governance

| Behov | Skill | Eksempel-prompt |
|-------|-------|-----------------|
| Master Architect | `/master-architect-widgetdc` | `/master-architect-widgetdc review system topology` |
| Graph Steward | `/graph-steward` | `/graph-steward validate Neo4j schema` |
| Frontend Sentinel | `/frontend-sentinel` | `/frontend-sentinel audit consulting SPA` |
| Dream Weaver | `/dream-weaver` | `/dream-weaver explore autonomous agent patterns` |
| Regulatory Navigator | `/regulatory-navigator` | `/regulatory-navigator NIS2 requirements mapping` |
| Security Hardener | `/security-hardener` | `/security-hardener OWASP scan all endpoints` |
| CORTEX Vault | `/vault-cortex` | `/vault-cortex hydrate status` |

### Obsidian Integration

| Behov | Skill | Eksempel-prompt |
|-------|-------|-----------------|
| Status tjek | `/obsidian-status` | `/obsidian-status` |
| Build pipeline | `/obsidian-build` | `/obsidian-build "NIS2 gap analysis rapport"` |
| Harvest data | `/obsidian-harvest` | `/obsidian-harvest url="https://example.com/report"` |
| Research | `/obsidian-research` | `/obsidian-research "RAG quality metrics"` |

### Adoption & Consulting

| Behov | Skill | Eksempel-prompt |
|-------|-------|-----------------|
| Solution Architect | `/adoption-solution-architect` | `/adoption-solution-architect design onboarding flow` |
| Adoption PM | `/adoption-project-manager` | `/adoption-project-manager track rollout KPIs` |
| Consulting Partner | `/consulting-partner` | `/consulting-partner prepare client deliverable` |

### Meta & Workflow

| Behov | Skill | Eksempel-prompt |
|-------|-------|-----------------|
| Smart router (auto) | `/octo:octo` | `/octo:octo "I need to fix a bug and deploy"` |
| Plan builder | `/octo:plan` | `/octo:plan "migrate from REST to GraphQL"` |
| Full workflow | `/octo:embrace` | `/octo:embrace "redesign the auth system"` |
| Quick execution | `/octo:quick` | `/octo:quick "add CORS header to /health"` |
| Loop execution | `/octo:loop` | `/octo:loop "optimize bundle size until <500kb"` |
| Multi-provider | `/octo:multi` | `/octo:multi "compare 3 caching strategies"` |
| Meta-prompt | `/octo:meta-prompt` | `/octo:meta-prompt "generate optimal prompt for code review"` |
| Resume agent | `/octo:resume` | `/octo:resume id="abc123"` |
| GitHub sentinel | `/octo:sentinel` | `/octo:sentinel` |
| OpenClaw admin | `/octo:claw` | `/octo:claw status` |
| Environment check | `/octo:doctor` | `/octo:doctor` |
| Scheduler | `/octo:scheduler` | `/octo:scheduler status` |
| Schedule jobs | `/octo:schedule` | `/octo:schedule add` |
| Oracle protocol | `/oracle-protocol` | `/oracle-protocol OODA-loop on deployment risk` |

---

## Prompt Generator — Naturligt Sprog til Skill

### Saadan bruger du det

1. Beskriv hvad du vil i naturligt sprog
2. Systemet foreslaar den rigtige skill + genererer prompt
3. Kopier og koer

### Eksempler

| Du siger... | System foreslaar |
|-------------|------------------|
| "Lav en praesentation om Q1 resultater" | `/octo:deck brief="Q1 resultater" slides=10 audience="board"` |
| "Undersoeg hvad der sker med RAG kvaliteten" | `/octo:research "RAG quality metrics and evaluation"` |
| "Fix den bug i health endpointet" | `/octo:debug "health endpoint issue" repo=widgetdc-rlm-engine` |
| "Review PR 4100" | `/code-review:code-review 4100` |
| "Byg en ny feature: rate limiting" | `/agent-chain implement rate limiting on /api/ask` |
| "Koer sikkerhedsaudit" | `/octo:security scope=all-repos` |
| "Hvad er status paa 90-dages planen?" | `/project-manager-90day hydrer status` |
| "Lav en compliance rapport som PDF" | `/octo:docs format=pdf topic="NIS2 compliance"` |
| "Brainstorm ideer til cost reduction" | `/octo:brainstorm "How to reduce LLM costs 50%"` |
| "Vis mig graph topologien" | `/obsidian-graph "show full topology"` |
| "Deploy og verificer RLM" | `/deploy-guardian verify RLM after push` |
| "Skriv en PRD for webhook rate limiting" | `/octo:prd "Add rate limiting to webhook endpoint"` |
| "Test-driven development af claim TTL" | `/octo:tdd "implement claim TTL in Redis"` |
| "Koer OSINT paa CompetitorCo" | `/obsidian-osint target="CompetitorCo"` |
| "Hvad er NIS2 kravene?" | `/compliance-officer NIS2 gap analysis` |
| "Check platform status" | `/obsidian-status` |

---

## Open WebUI Integration

Disse skills kan kaldes direkte fra Open WebUI via orchestrator proxy:

```bash
POST https://orchestrator-production-c27e.up.railway.app/api/llm/chat
{
  "message": "/octo:deck brief='Q1 status' slides=10",
  "agent_id": "command-center",
  "provider": "deepseek"
}
```

Eller via OpenAI-kompatibel endpoint:

```bash
POST https://orchestrator-production-c27e.up.railway.app/v1/chat/completions
{
  "model": "deepseek",
  "messages": [{"role": "user", "content": "/octo:research 'RAG frameworks'"}]
}
```

---

## Obsidian Integration

I Obsidian CLAUDE.md kan skills bruges direkte:

- Alle `/obsidian-*` skills er native (status, build, harvest, research, graph, osint)
- Andre skills via orchestrator proxy:

```bash
POST https://orchestrator-production-c27e.up.railway.app/tools/call
{
  "tool": "skill.invoke",
  "payload": {
    "skill": "octo:deck",
    "args": "brief='Q1 status' slides=10"
  }
}
```

---

## Prompt Generator API

Endpoint: `POST /api/prompt-generator`

Ingen auth krævet — det er et utility endpoint.

### Request

```json
{
  "description": "Lav en praesentation om Q1 resultater"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "skill": "/octo:deck",
    "prompt": "/octo:deck brief=\"Q1 resultater\" slides=10 audience=\"stakeholders\"",
    "explanation": "Brug /octo:deck til at generere slide decks fra et brief.",
    "alternatives": ["/octo:docs"]
  }
}
```

### Programmatic Usage

```typescript
const res = await fetch('https://orchestrator-production-c27e.up.railway.app/api/prompt-generator', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ description: 'Fix the bug in auth middleware' }),
})
const { data } = await res.json()
// data.skill = "/octo:debug"
// data.prompt = "/octo:debug \"bug in auth middleware\""
```

---

## Agent Fleet Oversigt

| Agent | Rolle | Repo-scope |
|-------|-------|------------|
| omega-sentinel | Arkitektur-guardian, SITREP | Alle repos |
| consulting-partner | Klient-leverancer | consulting-frontend |
| regulatory-navigator | Compliance & NIS2 | Alle repos |
| loop-orchestrator | Chain/cron orchestrering | orchestrator |
| graph-steward | Neo4j schema & data | backend, rlm-engine |
| dream-weaver | Autonom agent-patterns | Alle repos |
| frontend-sentinel | SPA audit & kvalitet | consulting-frontend, orchestrator |
| compliance-officer | GDPR/NIS2 enforcement | Alle repos |
| master-architect | System-topologi | Alle repos |
| project-manager | PM + Linear sync | Alle repos |

---

## Tips & Best Practices

1. **Start bredt, zoem ind**: Brug `/octo:octo` hvis du er i tvivl — den router automatisk
2. **Kombiner skills**: `/agent-chain` kan sekvensere flere skills automatisk
3. **Brug factory mode** til fuld autonomi: `/octo:factory spec="..."` koerer fra spec til faerdig kode
4. **Check status foerst**: `/obsidian-status` giver overblik over hvad der er tilgaengeligt
5. **Debate for beslutninger**: `/octo:debate` saetter 4 AI'er op mod hinanden
6. **Plan foer execution**: `/octo:plan` laver planen, `/octo:embrace` eksekverer den
