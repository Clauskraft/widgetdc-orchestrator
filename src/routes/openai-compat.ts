/**
 * openai-compat.ts — OpenAI-compatible API endpoints for Open WebUI.
 *
 * LIN-494 + LIN-495: Phase 1+2 of Cloud Chat Platform.
 *
 * Endpoints:
 *   GET  /v1/models              — List available models
 *   POST /v1/chat/completions    — Chat completion (streaming + non-streaming)
 *
 * Flow (orchestrated):
 *   Open WebUI → /v1/chat/completions
 *   → dual-rag retrieval (SRAG + Neo4j) for platform context
 *   → cognitive-proxy (RLM) for complex queries (optional)
 *   → inject orchestrated context into system prompt
 *   → route to LLM → final response with REAL platform data
 */
import { Router, Request, Response } from 'express'
import { LlmMatrix } from '@widgetdc/contracts/llm'
import { chatLLM, type LLMMessage } from '../llm/llm-proxy.js'
import { ORCHESTRATOR_TOOLS, executeToolCalls, getTokenSavings } from '../tools/tool-executor.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import { v4 as uuid } from 'uuid'
import { AgentRegistry } from '../agents/agent-registry.js'
import { AGENT_SEEDS } from '../agents/agent-seeds.js'

// Wave 3 (2026-04-05): alias→full-model-name mapping resolved via LlmMatrix.
// The Open WebUI UI sends short alias IDs ('claude-sonnet', 'gemini-flash')
// which orchestrator resolves to full matrix model names before dispatching
// to llm-proxy. The alias IDs are a stable UI contract and are defined
// locally; the target full-model names come from the matrix.
const MATRIX_ALIAS_TARGETS: Record<string, string> = {
  'widgetdc-neural': 'gemini-2.0-flash',
  'claude-sonnet': 'claude-sonnet-4-20250514',
  'claude-opus': 'claude-sonnet-4-20250514', // opus not in matrix — route to sonnet
  'gemini-flash': 'gemini-2.0-flash',
  'deepseek-chat': 'deepseek-chat',
  'qwen-plus': 'qwen3.6-plus',
  'gpt-4o': 'gpt-4o',
}

/**
 * Resolve an Open WebUI alias to a { provider, model } pair by looking up the
 * target model in the canonical matrix. Throws if the alias target is not a
 * known matrix model, which surfaces drift between local aliases and the
 * matrix at request time (Wave 5 CI gate will catch this at build time).
 */
function resolveAlias(alias: string): { provider: string; model: string } {
  const target = MATRIX_ALIAS_TARGETS[alias]
  if (!target) {
    throw new Error(`Unknown model alias '${alias}'. Known: ${Object.keys(MATRIX_ALIAS_TARGETS).join(', ')}`)
  }
  const modelCfg = LlmMatrix.getModel(target)
  // Orchestrator uses the matrix provider id as the llm-proxy provider key.
  return { provider: modelCfg.provider, model: target }
}

const MAX_TOOL_ROUNDS = 2
const MAX_TOOL_ROUNDS_ASSISTANT = 4

// ─── Dynamic tool selection (LIN-498: reduce tokens by sending only relevant tools) ──

interface ToolCategory {
  keywords: RegExp
  tools: string[]
}

const TOOL_CATEGORIES: ToolCategory[] = [
  { keywords: /\b(intent|route|routing|goal|scope|compose|composition)\b/i, tools: ['intent_detect'] },
  { keywords: /\b(health|status|uptime|service|railway|deploy|online)\b/i, tools: ['get_platform_health'] },
  { keywords: /\b(linear|issue|task|sprint|backlog|blocker|LIN-\d+|projekt|project)\b/i, tools: ['linear_issues', 'linear_issue_detail'] },
  { keywords: /\b(søg|search|find|pattern|knowledge|viden|consulting|document|artifact)\b/i, tools: ['search_knowledge', 'search_documents'] },
  { keywords: /\b(governance|policy|approval|audit trail|guardrail)\b/i, tools: ['governance_matrix', 'governance_audit_query', 'governance_policy_decide'] },
  { keywords: /\b(legal|contract|regulatory|compliance)\b/i, tools: ['search_knowledge', 'verify_output', 'governance_matrix'] },
  { keywords: /\b(obsidian|vault|note|notebook|briefing|daily brief)\b/i, tools: ['search_documents', 'create_notebook', 'search_knowledge'] },
  { keywords: /\b(forge|skill.?forge|tool gap|missing tool|tooling gap)\b/i, tools: ['forge_analyze_gaps', 'forge_list', 'forge_tool'] },
  { keywords: /\b(engagement|precedent|client case|statement of work|proposal)\b/i, tools: ['engagement_match', 'engagement_plan', 'engagement_list'] },
  { keywords: /\b(competitive|competitor|market watch|market intel)\b/i, tools: ['competitive_crawl', 'search_knowledge'] },
  { keywords: /\b(openclaw|remote host|gateway host|fleet node|host health)\b/i, tools: ['get_platform_health', 'call_mcp_tool'] },
  { keywords: /\b(analy|strateg|reason|deep|complex|evaluat|plan|why|how does|architect|OODA)\b/i, tools: ['reason_deeply', 'search_knowledge'] },
  { keywords: /\b(fold|folding|compress|compression|summari[sz]e|sammenfat|token budget|context window|long context)\b/i, tools: ['context_fold'] },
  { keywords: /\b(visuali[sz]ation|diagram|illustration|render|renderer|mermaid|chart|canvas|catalog)\b/i, tools: ['intent_detect', 'knowledge_normalize', 'search_knowledge', 'context_fold'] },
  { keywords: /\b(phantom|bom|bill of materials|repo inventory|provider inventory|component inventory|pattern library|autonomous loop)\b/i, tools: ['recommend_skill_loop', 'knowledge_normalize', 'search_knowledge'] },
  { keywords: /\b(graph|cypher|node|relation|neo4j|count|match)\b/i, tools: ['query_graph'] },
  { keywords: /\b(chain|workflow|sequential|parallel|debate|multi.step|pipeline)\b/i, tools: ['run_chain'] },
  { keywords: /\b(verify|check|quality|audit|compliance|valid)\b/i, tools: ['verify_output'] },
  { keywords: /\b(mcp|tool|call|endpoint|api)\b/i, tools: ['call_mcp_tool'] },
  { keywords: /\b(notebook|celle|cells|query.*insight|interactive.*analysis|structured.*analysis)\b/i, tools: ['create_notebook'] },
]

const FALLBACK_TOOLS = ['intent_detect', 'search_knowledge', 'get_platform_health']

function selectToolsForQuery(userMessage: string): typeof ORCHESTRATOR_TOOLS {
  const matched = new Set<string>()
  const normalized = (userMessage || '').trim()

  if (normalized.length >= 12) {
    matched.add('intent_detect')
  }
  if (normalized.length >= 3000) {
    matched.add('context_fold')
  }

  for (const cat of TOOL_CATEGORIES) {
    if (cat.keywords.test(userMessage)) {
      for (const t of cat.tools) matched.add(t)
    }
  }

  // Always include fallback if nothing matched
  if (matched.size === 0) {
    for (const t of FALLBACK_TOOLS) matched.add(t)
  }

  // Cap at 5 tools max
  const selected = [...matched].slice(0, 5)

  return ORCHESTRATOR_TOOLS.filter(t => selected.includes(t.function.name))
}

function isDeterministicHealthQuery(userMessage: string, selectedTools: typeof ORCHESTRATOR_TOOLS): boolean {
  const normalized = (userMessage || '').trim()
  if (!normalized) return false
  const selectedNames = new Set(selectedTools.map(tool => tool.function.name))
  if (!selectedNames.has('get_platform_health')) return false
  const allowedCompanions = new Set(['get_platform_health', 'verify_output', 'intent_detect'])
  if ([...selectedNames].some(name => !allowedCompanions.has(name))) return false
  return /\b(health|status|uptime|service|railway|deploy|online|platform)\b/i.test(normalized)
}

function writeStreamChunk(
  res: Response,
  requestId: string,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): void {
  res.write(`data: ${JSON.stringify({
    id: requestId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`)
}

function initStreamingResponse(res: Response, requestId: string, model: string): ReturnType<typeof setInterval> {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('Content-Encoding', 'identity')
  res.flushHeaders()

  // Emit an immediate content-bearing first chunk so upstream proxies treat this as an active stream.
  // The zero-width space is invisible in the UI but avoids a long idle gap before the first content token.
  writeStreamChunk(res, requestId, model, { role: 'assistant', content: '\u200b' })

  return setInterval(() => {
    res.write(': keepalive\n\n')
  }, 15_000)
}

function buildDeterministicHealthResponse(toolContents: string[], userMessage: string): string {
  const merged = toolContents.filter(Boolean).join('\n')
  const backendLine = merged.split('\n').find(line => line.startsWith('Backend:')) ?? 'Backend: unavailable'
  const rlmLine = merged.split('\n').find(line => line.startsWith('RLM:')) ?? 'RLM: unavailable'
  const orchestratorLine = merged.split('\n').find(line => line.startsWith('Orchestrator:')) ?? 'Orchestrator: unavailable'

  return [
    '# WidgeTDC Platform Health',
    '',
    '## Status',
    '- Scope: live platform health check',
    `- Query: ${userMessage.trim()}`,
    `- Timestamp: ${new Date().toISOString()}`,
    '',
    '## Findings',
    `- ${backendLine}`,
    `- ${rlmLine}`,
    `- ${orchestratorLine}`,
    '',
    '## Assessment',
    '- The response is synthesized directly from live health endpoints, not a second LLM round.',
    '- Backend, RLM, and orchestrator telemetry are included directly from the health tool output above.',
    '- If any line says unavailable, rerun the check or inspect backend/orchestrator pressure before escalating.',
    '',
    '## Next Action',
    '- Escalate only if the health lines degrade or repeated checks show missing graph telemetry.',
  ].join('\n')
}

// ─── Metrics tracking ──────────────────────────────────────────────────────

interface MetricsEntry {
  model: string
  tool_calls: string[]
  tool_rounds: number
  total_tokens: number
  timestamp: number
}

const metricsBuffer: MetricsEntry[] = []
const MAX_METRICS = 1000

function recordMetrics(model: string, toolCalls: string[], toolRounds: number, totalTokens: number, toolsOffered: number) {
  metricsBuffer.push({ model, tool_calls: toolCalls, tool_rounds: toolRounds, total_tokens: totalTokens, timestamp: Date.now() })
  if (metricsBuffer.length > MAX_METRICS) metricsBuffer.splice(0, metricsBuffer.length - MAX_METRICS)
}

export const openaiCompatRouter = Router()

// ─── Rate limiting (in-memory, per-IP) ─────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30 // 30 req/min per IP

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

// ─── API key validation middleware ──────────────────────────────────────────

function validateApiKey(req: Request, res: Response): boolean {
  // Open WebUI sends OPENAI_API_KEY as Bearer token
  const auth = req.headers.authorization
  if (!auth) {
    res.status(401).json({ error: { message: 'Missing Authorization header', type: 'auth_error', code: 'unauthorized' } })
    return false
  }
  const token = auth.replace('Bearer ', '')
  // Accept orchestrator key OR backend key
  const validKeys = [config.orchestratorApiKey, config.backendApiKey].filter(Boolean)
  if (validKeys.length > 0 && !validKeys.includes(token)) {
    res.status(401).json({ error: { message: 'Invalid API key', type: 'auth_error', code: 'unauthorized' } })
    return false
  }
  return true
}

// ─── System prompt injection ────────────────────────────────────────────────

const SYSTEM_PROMPT = `WidgeTDC intelligence platform. ALTID kald mindst ét tool før du svarer. Hent reel data — svar aldrig kun fra generel viden. Svar på dansk. Vær konkret og datadrevet.`

const ASSISTANT_SUFFIX = `\n\nVIGTIGE REGLER:\n1. Kald ALTID mindst ét tool før du svarer. Start med search_knowledge eller query_graph.\n2. Hvis et tool fejler eller returnerer tomt, prøv et andet tool (f.eks. query_graph med Cypher).\n3. Generer ALTID et fyldigt, datadrevet svar baseret på tool-resultater. Aldrig bare "lad mig søge..." — gennemfør analysen.\n4. Inkludér konkrete tal, frameworks og referencer i dit svar.\n5. Svar på dansk i consulting-kvalitet med struktur (overskrifter, lister, tabeller).`

// ─── Consulting Assistant definitions (LIN-524) ────────────────────────────

interface AssistantConfig {
  id: string
  displayName: string
  baseModel: string
  systemPrompt: string
  tools: string[]
  promptSuggestions: string[]
  capabilities?: string[]
}

type AgentRegistryEntry = ReturnType<typeof AgentRegistry.all>[number]
type AgentLike = Pick<AgentRegistryEntry['handshake'], 'agent_id' | 'display_name' | 'status' | 'source' | 'capabilities' | 'allowed_tool_namespaces'>

const STATIC_ASSISTANTS: AssistantConfig[] = [
  {
    id: 'compliance-auditor',
    displayName: 'Compliance Auditor',
    baseModel: 'claude-sonnet',
    systemPrompt: 'Du er WidgeTDC Compliance Auditor. Du har adgang til 12 regulatoriske frameworks (GDPR, NIS2, DORA, CSRD, AI Act, Pillar Two, CRA, eIDAS2) og 506 GDPR enforcement cases i videngrafen (445K nodes, 3.7M relationer). Brug ALTID search_knowledge og verify_output til at hente reel compliance-data. Citér kilder med [REG-xxxx] format. Anvend EG PMM projektmetode og BPMV procesmodel i dine anbefalinger. 32 consulting domæner er tilgængelige. Svar på dansk med consulting-grade præcision.',
    tools: ['search_knowledge', 'verify_output', 'query_graph'],
    promptSuggestions: ['Kør NIS2 gap-analyse', 'GDPR data mapping', 'DORA compliance status'],
    capabilities: ['compliance', 'audit', 'framework_analysis'],
  },
  {
    id: 'graph-analyst',
    displayName: 'Graph Analyst',
    baseModel: 'widgetdc-neural',
    systemPrompt: 'Du er WidgeTDC Graph Analyst med direkte adgang til Neo4j videngrafen: 445,918 nodes, 3,771,937 relationer, 32 consulting domæner, 270+ frameworks, 288 KPIs, 52,925 McKinsey insights. Brug query_graph til Cypher-forespørgsler og search_knowledge til semantisk søgning. Visualisér resultater som tabeller og lister. Svar på dansk.',
    tools: ['intent_detect', 'query_graph', 'search_knowledge', 'knowledge_normalize', 'context_fold'],
    promptSuggestions: ['Vis domain-statistik', 'Find orphan nodes', 'Framework-dækning per domæne'],
    capabilities: ['graph_analysis', 'cypher', 'knowledge_search'],
  },
  {
    id: 'project-manager',
    displayName: 'Project Manager',
    baseModel: 'claude-sonnet',
    systemPrompt: 'Du er WidgeTDC Project Manager. Brug linear_issues til at hente sprint-status, blockers og opgaver fra Linear. Brug search_knowledge til at forstå konteksten. Rapportér med KPIs: velocity, blockers, sprint burn. Anvend EG PMM projektmetode (faser, leverancer, gates) og BPMV procesmodel i projektplanlægning. 38 consulting-processer og 9 consulting-services er tilgængelige i grafen. Svar på dansk med actionable næste-skridt.',
    tools: ['linear_issues', 'linear_issue_detail', 'search_knowledge'],
    promptSuggestions: ['Sprint status', 'Næste prioritet', 'Blocker-rapport'],
    capabilities: ['project_management', 'delivery', 'linear_tracking'],
  },
  {
    id: 'consulting-partner',
    displayName: 'Consulting Partner',
    baseModel: 'claude-opus',
    systemPrompt: 'Du er WidgeTDC Consulting Partner — strategisk rådgiver med adgang til verdens mest avancerede consulting intelligence platform. 84 frameworks (Balanced Scorecard, BCG Matrix, Porter Five Forces, McKinsey 7S, Design Thinking, EG PMM, BPMV m.fl.), 52,925 McKinsey insights, 1,201 consulting artifacts, 825 KPIs, 506 case studies, 35 consulting skills, 38 processer. Brug reason_deeply for dyb analyse og search_knowledge for grafdata. Leverér consulting-grade output med frameworks, data og handlingsplaner. Svar på dansk.',
    tools: ['reason_deeply', 'search_knowledge', 'query_graph'],
    promptSuggestions: ['Strategisk analyse af [emne]', 'Framework selection', 'Markedsanalyse'],
    capabilities: ['strategy', 'reasoning', 'consulting'],
  },
  {
    id: 'platform-health',
    displayName: 'Platform Health',
    baseModel: 'widgetdc-neural',
    systemPrompt: 'Du er WidgeTDC Platform Health Monitor. Brug get_platform_health til at tjekke alle services (backend, RLM engine, orchestrator, Neo4j, Redis, Pipelines). Brug call_mcp_tool til avancerede MCP-kald. Rapportér: service health, Neo4j stats (445K nodes), agent fleet (430+ agenter), cron jobs, Redis status. Svar på dansk med real-time data.',
    tools: ['intent_detect', 'get_platform_health', 'call_mcp_tool', 'reason_deeply', 'context_fold'],
    promptSuggestions: ['Service status', 'Neo4j health', 'Agent fleet oversigt'],
    capabilities: ['observability', 'runtime_health', 'service_status'],
  },
  {
    id: 'governance',
    displayName: 'Governance Controller',
    baseModel: 'claude-sonnet',
    systemPrompt: 'Du er WidgeTDC Governance Controller. Brug governance_matrix, governance_audit_query og governance_policy_decide til at analysere policy, approvals, auditspor og write-gates. Når relevant skal du supplere med verify_output. Svar på dansk med skarp governance-logik og tydelige konsekvenser.',
    tools: ['governance_matrix', 'governance_audit_query', 'governance_policy_decide', 'verify_output'],
    promptSuggestions: ['Vis governance gaps', 'Auditér approvals', 'Tjek policy-konsekvens'],
    capabilities: ['governance', 'policy', 'approval'],
  },
  {
    id: 'openclaw',
    displayName: 'OpenClaw Operations',
    baseModel: 'gemini-flash',
    systemPrompt: 'Du er WidgeTDC OpenClaw Operations. Brug get_platform_health og call_mcp_tool til at inspicere hosts, gateway health, deployment-signal og runtime-respons. Svar på dansk med operationsfokus og konkrete næste skridt.',
    tools: ['get_platform_health', 'call_mcp_tool', 'query_graph'],
    promptSuggestions: ['Host health', 'Gateway status', 'Deployment signal'],
    capabilities: ['operations', 'host_health', 'runtime'],
  },
  {
    id: 'obsidian',
    displayName: 'Obsidian Vault',
    baseModel: 'claude-sonnet',
    systemPrompt: 'Du er WidgeTDC Obsidian Vault Agent. Brug search_documents, search_knowledge og create_notebook til at finde noter, samle viden og strukturere outputs til videre arbejde. Svar på dansk med tydelige referencer og forslag til næste note eller notebook.',
    tools: ['search_documents', 'search_knowledge', 'create_notebook'],
    promptSuggestions: ['Søg i vault', 'Lav notebook', 'Byg briefing'],
    capabilities: ['vault_search', 'knowledge_sync', 'notebooking'],
  },
  {
    id: 'forge',
    displayName: 'Skill Forge',
    baseModel: 'qwen-plus',
    systemPrompt: 'Du er WidgeTDC Skill Forge. Brug forge_analyze_gaps, forge_list og forge_tool til at finde tool-huller, inspicere forged tools og foreslå nye tool-kapabiliteter. Svar på dansk med fokus på runtime-nytte og verificerbarhed.',
    tools: ['forge_analyze_gaps', 'forge_list', 'forge_tool'],
    promptSuggestions: ['Find tool gaps', 'Vis forged tools', 'Foreslå nyt tool'],
    capabilities: ['tool_forging', 'gap_analysis', 'runtime_extension'],
  },
  {
    id: 'engagement',
    displayName: 'Engagement Planner',
    baseModel: 'claude-sonnet',
    systemPrompt: 'Du er WidgeTDC Engagement Planner. Brug engagement_match, engagement_plan og engagement_list til at arbejde med precedenter, scopes og planlægning af consulting engagements. Svar på dansk med høj signalværdi og tydelig handlingsplan.',
    tools: ['engagement_match', 'engagement_plan', 'engagement_list'],
    promptSuggestions: ['Find precedenter', 'Planlæg engagement', 'Vis aktive engagements'],
    capabilities: ['precedent_matching', 'engagement_planning', 'delivery_scoping'],
  },
  {
    id: 'competitive',
    displayName: 'Competitive Intel',
    baseModel: 'deepseek-chat',
    systemPrompt: 'Du er WidgeTDC Competitive Intel. Brug competitive_crawl og search_knowledge til at analysere konkurrenter, capability gaps og markedsbevægelser. Svar på dansk med konkrete observationer og næste handling.',
    tools: ['competitive_crawl', 'search_knowledge', 'query_graph'],
    promptSuggestions: ['Kør competitor scan', 'Find capability gaps', 'Opsummer markedssignal'],
    capabilities: ['competitive_intelligence', 'market_scan', 'gap_analysis'],
  },
]

interface ModelEntry {
  id: string
  provider: string
  displayName: string
  assistant?: AssistantConfig
}

const BASE_MODELS: ModelEntry[] = [
  { id: 'claude-sonnet', provider: 'claude', displayName: 'Claude Sonnet 4' },
  { id: 'claude-opus', provider: 'claude', displayName: 'Claude Opus 4' },
  { id: 'gemini-flash', provider: 'gemini', displayName: 'Gemini 2.0 Flash' },
  { id: 'deepseek-chat', provider: 'deepseek', displayName: 'DeepSeek Chat' },
  { id: 'qwen-plus', provider: 'qwen', displayName: 'Qwen 3.6 Plus' },
  { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o' },
  { id: 'groq-llama', provider: 'groq', displayName: 'Groq Llama 3.3 70B' },
]

const DYNAMIC_AGENT_CACHE_TTL_MS = 60_000
let dynamicAgentCache: { expiresAt: number; fingerprint: string; assistants: AssistantConfig[] } | null = null

function inferBaseModel(agent: AgentLike): string {
  const capabilities = (agent.capabilities ?? []).map(c => c.toLowerCase())
  const namespaces = agent.allowed_tool_namespaces ?? []

  if (capabilities.some(c => /(reason|plan|architecture|compliance|judge|policy|governance|legal)/.test(c))) return 'claude-sonnet'
  if (capabilities.some(c => /(strategy|consult|critique|analysis)/.test(c))) return 'claude-opus'
  if (capabilities.some(c => /(osint|crawl|scrap|intel|competitive)/.test(c))) return 'deepseek-chat'
  if (capabilities.some(c => /(forge|embedding|reinforcement|evolution)/.test(c))) return 'qwen-plus'
  if (capabilities.some(c => /(graph|memory|search|knowledge|notebook|vault)/.test(c))) return 'gemini-flash'
  if (namespaces.some(ns => ['governance', 'legal'].includes(ns))) return 'claude-sonnet'
  if (namespaces.some(ns => ['engagement', 'consulting'].includes(ns))) return 'claude-opus'
  return 'gemini-flash'
}

function inferToolsForAgent(agent: AgentLike): string[] {
  const capabilities = (agent.capabilities ?? []).map(c => c.toLowerCase())
  const namespaces = (agent.allowed_tool_namespaces ?? []).map(ns => ns.toLowerCase())
  const selected = new Set<string>()

  const addTools = (...tools: string[]) => {
    for (const tool of tools) selected.add(tool)
  }

  if (capabilities.some(c => /(governance|policy|approval)/.test(c)) || namespaces.includes('governance')) {
    addTools('governance_matrix', 'governance_audit_query', 'governance_policy_decide', 'verify_output')
  }
  if (capabilities.some(c => /(legal|compliance|retsinformation|tax)/.test(c)) || namespaces.includes('legal')) {
    addTools('search_knowledge', 'verify_output', 'governance_matrix')
  }
  if (capabilities.some(c => /(vault|knowledge|note|briefing|memory)/.test(c)) || namespaces.some(ns => ['knowledge', 'vidensarkiv', 'cma'].includes(ns))) {
    addTools('search_documents', 'search_knowledge', 'create_notebook')
  }
  if (capabilities.some(c => /(forge|gap_analysis|embeddings|reinforcement|evolution)/.test(c)) || namespaces.some(ns => ['prometheus', 'autonomous'].includes(ns))) {
    addTools('forge_analyze_gaps', 'forge_list', 'forge_tool')
  }
  if (capabilities.some(c => /(engagement|precedent|deliverable|client)/.test(c)) || namespaces.includes('engagement')) {
    addTools('engagement_match', 'engagement_plan', 'engagement_list')
  }
  if (capabilities.some(c => /(competitive|osint|threat|crawl)/.test(c)) || namespaces.some(ns => ['trident', 'the_snout', 'osint'].includes(ns))) {
    addTools('competitive_crawl', 'search_knowledge', 'query_graph')
  }
  if (capabilities.some(c => /(graph|cypher|neo4j)/.test(c)) || namespaces.includes('graph')) {
    addTools('query_graph', 'search_knowledge')
  }
  if (capabilities.some(c => /(monitor|health|incident|self_heal|runtime)/.test(c))) {
    addTools('get_platform_health', 'call_mcp_tool')
  }
  if (selected.size === 0) {
    addTools('search_knowledge', 'query_graph', 'get_platform_health')
  }

  const availableTools = new Set(ORCHESTRATOR_TOOLS.map(tool => tool.function.name))
  return [...selected].filter(tool => availableTools.has(tool)).slice(0, 5)
}

function buildDynamicAssistant(agent: AgentLike): AssistantConfig {
  const tools = inferToolsForAgent(agent)
  const capabilities = agent.capabilities ?? []
  const displayName = agent.display_name || agent.agent_id
  const capabilityList = capabilities.length > 0 ? capabilities.join(', ') : 'general orchestration'
  return {
    id: agent.agent_id,
    displayName,
    baseModel: inferBaseModel(agent),
    systemPrompt: `Du er ${displayName}. Dine primære kapabiliteter er ${capabilityList}. Brug altid mindst ét relevant tool før du svarer, og hold dig til verificerbar data fra platformen. Svar på dansk med konkret, operationel præcision.`,
    tools,
    promptSuggestions: capabilities.slice(0, 3).map(cap => `Hjælp med ${cap.replace(/_/g, ' ')}`),
    capabilities,
  }
}

function buildAgentFingerprint(agents: AgentLike[]): string {
  return agents
    .map(agent => [
      agent.agent_id,
      agent.display_name,
      agent.status,
      agent.source,
      (agent.capabilities ?? []).join(','),
      (agent.allowed_tool_namespaces ?? []).join(','),
    ].join('|'))
    .sort()
    .join('||')
}

function loadDynamicAssistants(now = Date.now()): AssistantConfig[] {
  const registryAgents = AgentRegistry.all()
    .map(entry => entry.handshake)
    .filter(agent => agent.status === 'online' && agent.source !== 'librechat' && agent.source !== 'auto-discovered')

  const sourceAgents = new Map<string, AgentLike>()
  for (const agent of AGENT_SEEDS.filter(agent => agent.status === 'online' && agent.source !== 'librechat')) {
    sourceAgents.set(agent.agent_id, agent)
  }
  for (const agent of registryAgents) {
    sourceAgents.set(agent.agent_id, agent)
  }

  const mergedAgents = [...sourceAgents.values()]
  const fingerprint = buildAgentFingerprint(mergedAgents)
  if (dynamicAgentCache && dynamicAgentCache.expiresAt > now && dynamicAgentCache.fingerprint === fingerprint) {
    return dynamicAgentCache.assistants
  }

  const assistants = mergedAgents.map(buildDynamicAssistant)
  dynamicAgentCache = { expiresAt: now + DYNAMIC_AGENT_CACHE_TTL_MS, fingerprint, assistants }
  return assistants
}

function getAssistantMap(now = Date.now()): Map<string, AssistantConfig> {
  const merged = [...STATIC_ASSISTANTS, ...loadDynamicAssistants(now)]
  return new Map(merged.map(assistant => [assistant.id, assistant]))
}

function getModelEntries(now = Date.now()): ModelEntry[] {
  const assistantMap = getAssistantMap(now)
  const assistantEntries: ModelEntry[] = [...assistantMap.values()].map(assistant => ({
    id: assistant.id,
    provider: 'widgetdc',
    displayName: assistant.displayName,
    assistant,
  }))

  const deduped = new Map<string, ModelEntry>()
  for (const model of [...BASE_MODELS, ...assistantEntries]) {
    deduped.set(model.id, model)
  }
  return [...deduped.values()]
}

// Wave 3: alias→{provider, model} map is now derived lazily from the matrix
// via resolveAlias(). This constant is kept for the groq-llama case only,
// since 'llama-3.3-70b-versatile' is not in the matrix (groq is a hosting
// provider, not a model vendor). Everything else flows through resolveAlias().
const MODEL_TO_PROVIDER_FALLBACK: Record<string, { provider: string; model?: string }> = {
  'groq-llama': { provider: 'groq', model: 'llama-3.3-70b-versatile' },
}

function resolveModelToProvider(alias: string): { provider: string; model?: string } | undefined {
  if (MATRIX_ALIAS_TARGETS[alias]) {
    try {
      return resolveAlias(alias)
    } catch {
      return undefined
    }
  }
  return MODEL_TO_PROVIDER_FALLBACK[alias]
}

// ─── GET /v1/metrics — Tool call analytics ─────────────────────────────────

openaiCompatRouter.get('/v1/metrics', (req: Request, res: Response) => {
  if (!validateApiKey(req, res)) return

  const last24h = Date.now() - 86_400_000
  const recent = metricsBuffer.filter(m => m.timestamp > last24h)

  const toolCallCounts: Record<string, number> = {}
  const modelCounts: Record<string, number> = {}
  let totalToolRounds = 0
  let totalTokens = 0

  for (const m of recent) {
    modelCounts[m.model] = (modelCounts[m.model] ?? 0) + 1
    totalToolRounds += m.tool_rounds
    totalTokens += m.total_tokens
    for (const tc of m.tool_calls) {
      toolCallCounts[tc] = (toolCallCounts[tc] ?? 0) + 1
    }
  }

  const totalRequests = recent.length
  const avgToolRounds = totalRequests > 0 ? (totalToolRounds / totalRequests).toFixed(1) : '0'
  const requestsWithTools = recent.filter(m => m.tool_calls.length > 0).length
  const advancedPct = totalRequests > 0 ? ((requestsWithTools / totalRequests) * 100).toFixed(1) : '0'

  const savings = getTokenSavings()
  const avgTokensPerRequest = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0

  res.json({
    period: '24h',
    total_requests: totalRequests,
    requests_with_tools: requestsWithTools,
    advanced_pct: parseFloat(advancedPct),
    avg_tool_rounds: parseFloat(avgToolRounds),
    total_tokens: totalTokens,
    avg_tokens_per_request: avgTokensPerRequest,
    token_savings: {
      total_saved: savings.totalTokensSaved,
      folding_calls: savings.totalFoldingCalls,
      avg_per_fold: savings.avgSavingsPerFold,
    },
    tool_call_counts: toolCallCounts,
    model_counts: modelCounts,
  })
})

// ─── GET /v1/models ─────────────────────────────────────────────────────────

openaiCompatRouter.get('/v1/models', (req: Request, res: Response) => {
  if (!validateApiKey(req, res)) return
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit' } })
    return
  }

  const assistantMap = getAssistantMap()
  const models = getModelEntries().map(m => {
    const assistant = m.assistant ?? assistantMap.get(m.id)
    return {
      id: m.id,
      object: 'model',
      created: 1700000000,
      owned_by: m.provider,
      permission: [],
      root: m.id,
      parent: null,
      ...(assistant ? {
        meta: {
          description: assistant.displayName,
          prompt_suggestions: assistant.promptSuggestions,
          base_model: assistant.baseModel,
          tools: assistant.tools,
          capabilities: assistant.capabilities ?? [],
        },
      } : {}),
    }
  })

  res.json({ object: 'list', data: models })
})

// ─── POST /v1/chat/completions ──────────────────────────────────────────────

openaiCompatRouter.post('/v1/chat/completions', async (req: Request, res: Response) => {
  if (!validateApiKey(req, res)) return

  const clientIp = req.ip || req.socket.remoteAddress || 'unknown'
  if (!checkRateLimit(clientIp)) {
    res.status(429).json({ error: { message: 'Rate limit exceeded (30 req/min)', type: 'rate_limit', code: 'rate_limited' } })
    return
  }

  const { model, messages, stream, temperature, max_tokens } = req.body
  const requestId = `chatcmpl-${uuid().substring(0, 12)}`

  // Check if this is a consulting assistant (LIN-524)
  const assistantMap = getAssistantMap()
  const assistant = assistantMap.get(model)

  // Resolve provider — assistants route through their base model's provider.
  // Wave 3: alias→{provider, model} is matrix-driven via resolveModelToProvider().
  const resolvedModel = assistant ? assistant.baseModel : model
  const mapping = resolveModelToProvider(resolvedModel) ?? resolveModelToProvider('gemini-flash')
  if (!mapping) {
    res.status(500).json({ error: { message: `Unable to resolve any provider for model '${resolvedModel}'`, type: 'server_error' } })
    return
  }
  const provider = mapping.provider
  const providerModel = mapping.model
  const responseModel = model || 'gemini-flash'
  let streamKeepAlive: ReturnType<typeof setInterval> | null = null

  const clearStreamKeepAlive = (): void => {
    if (streamKeepAlive) {
      clearInterval(streamKeepAlive)
      streamKeepAlive = null
    }
  }

  // Inject system prompt — assistants REPLACE the default prompt
  const llmMessages: LLMMessage[] = [...(messages || [])]
  const hasSystem = llmMessages.some(m => m.role === 'system')
  const systemContent = assistant ? assistant.systemPrompt + ASSISTANT_SUFFIX : SYSTEM_PROMPT
  if (!hasSystem) {
    llmMessages.unshift({ role: 'system', content: systemContent })
  } else if (assistant) {
    // Replace existing system prompt with assistant-specific one
    const sysIdx = llmMessages.findIndex(m => m.role === 'system')
    if (sysIdx !== -1) {
      llmMessages[sysIdx] = { role: 'system', content: systemContent }
    }
  }

  const t0 = Date.now()
  logger.info({ model, provider, stream, messageCount: llmMessages.length, ip: clientIp }, 'OpenAI compat request')

  try {
    if (stream) {
      streamKeepAlive = initStreamingResponse(res, requestId, responseModel)
      req.on('close', clearStreamKeepAlive)
    }

    // ─── TOOL-CALL LOOP: LLM may request tools, orchestrator executes ──
    let loopMessages = [...llmMessages]
    let finalContent = ''
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    let toolRounds = 0
    const allToolNames: string[] = []

    // Select tools: assistants use fixed tools, regular models use dynamic selection (LIN-498/LIN-524)
    const userMsg = (messages || []).filter((m: any) => m.role === 'user').pop()?.content || ''
    const selectedTools = assistant
      ? ORCHESTRATOR_TOOLS.filter(t => assistant.tools.includes(t.function.name))
      : selectToolsForQuery(userMsg)
    logger.debug({ selectedTools: selectedTools.map(t => t.function.name), query: userMsg.slice(0, 50), assistant: assistant?.id || null }, 'Tool selection')

    const useDeterministicHealthFastPath = isDeterministicHealthQuery(userMsg, selectedTools)
    if (useDeterministicHealthFastPath) {
      toolRounds = 1
      allToolNames.push('get_platform_health')
      logger.info({ query: userMsg.slice(0, 80) }, 'Using deterministic health fast path')

      const syntheticToolCall = {
        id: `call_health_${Date.now()}`,
        function: {
          name: 'get_platform_health',
          arguments: '{}',
        },
      }

      loopMessages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: syntheticToolCall.id,
          type: 'function',
          function: {
            name: syntheticToolCall.function.name,
            arguments: syntheticToolCall.function.arguments,
          },
        }],
      })

      const toolResults = await executeToolCalls([syntheticToolCall])
      for (const tr of toolResults) {
        loopMessages.push({
          role: 'tool',
          content: tr.content,
          tool_call_id: tr.tool_call_id,
        })
      }

      finalContent = buildDeterministicHealthResponse(
        toolResults.map(tr => tr.content),
        userMsg,
      )
    } else {
      const maxRounds = assistant ? MAX_TOOL_ROUNDS_ASSISTANT : MAX_TOOL_ROUNDS
      for (let round = 0; round <= maxRounds; round++) {
        const result = await chatLLM({
          provider,
          messages: loopMessages,
          model: providerModel,
          temperature: temperature ?? 0.7,
          max_tokens: max_tokens ?? 4096,
          tools: selectedTools,
        })

        // Accumulate usage
        if (result.usage) {
          totalUsage.prompt_tokens += result.usage.prompt_tokens
          totalUsage.completion_tokens += result.usage.completion_tokens
          totalUsage.total_tokens += result.usage.total_tokens
        }

        // Capture any partial text content alongside tool calls
        if (result.content && result.content.length > 0) {
          finalContent = result.content
        }

        // Check if LLM wants to call tools
        if (result.tool_calls && result.tool_calls.length > 0 && round < maxRounds) {
          toolRounds++
          const toolNames = result.tool_calls.map(tc => tc.function.name)
          allToolNames.push(...toolNames)
          logger.info({ round, tools: toolNames, partialContent: (result.content || '').length }, 'Tool calls requested')

          // Add assistant message with tool_calls
          loopMessages.push({
            role: 'assistant',
            content: result.content || '',
            tool_calls: result.tool_calls,
          })

          // Execute all tool calls in parallel
          const toolResults = await executeToolCalls(result.tool_calls)

          // Add tool results as messages
          for (const tr of toolResults) {
            loopMessages.push({
              role: 'tool',
              content: tr.content,
              tool_call_id: tr.tool_call_id,
            })
          }

          // Continue loop — LLM will see tool results and respond
          continue
        }

        // No tool calls — this is the final response
        finalContent = result.content
        break
      }
    }

    // If all rounds used tool_calls and no final content, do one more LLM call
    // WITHOUT tools to force a text response from the collected data
    if (!finalContent && toolRounds > 0) {
      // P0 FIX: Sanitize tool results — strip [object Object] and JSON noise
      const sanitizedMessages = loopMessages.map(m => {
        if (m.role === 'tool' && typeof m.content === 'string') {
          let clean = m.content.replace(/\[object Object\]/g, '[structured data]')
          // Strip excessive JSON blocks from tool results
          clean = clean.replace(/```json[\s\S]*?```/g, '[JSON data omitted]')
          return { ...m, content: clean }
        }
        return m
      })

      // P0 FIX: Structured synthesis prompt — enforce compliance-grade output
      const assistant = assistantMap.get(model)
      const domainContext = assistant ? `You are ${assistant.displayName}. ` : ''
      const isCompliance = model === 'compliance-auditor'

      const synthesisPrompt = isCompliance
        ? `${domainContext}Based on all tool results above, generate a COMPLIANCE AUDIT REPORT in the following structure:

# [Framework Name] Compliance Audit

## Executive Summary
- Overall compliance status (Compliant / Partial / Non-compliant)
- Risk score (0-100)
- Key findings (max 5 bullet points)

## Gap Analysis
For each gap found:
- **Article/Requirement**: [reference]
- **Status**: [Compliant/Partial/Non-compliant]
- **Evidence**: [specific finding from tool results]
- **Recommendation**: [actionable remediation]

## Deadlines & Priority
- Critical items (must fix immediately)
- High priority (fix within 30 days)
- Medium priority (fix within 90 days)

## Conclusion
Brief summary with next steps.

RULES:
- Use ONLY data from the tool results above — do NOT hallucinate
- Cite specific sources as [Source: tool-name]
- Do NOT include raw JSON, reasoning paths, or internal tool output
- Reply in Danish with consulting-grade precision
- If tool results contain "[structured data]" or "[JSON data omitted]", summarize what you know from the rest`
        : `${domainContext}Baseret på alle tool-resultater ovenfor, generer nu dit fulde svar. Inkludér konkrete data, tal og referencer. Svar på dansk i consulting-kvalitet med overskrifter og struktur. Do NOT include raw JSON or internal reasoning — only the final structured answer.`

      sanitizedMessages.push({
        role: 'user',
        content: synthesisPrompt,
      })
      logger.info({ toolRounds, messageCount: sanitizedMessages.length }, 'Forcing structured synthesis after tool rounds')
      const summaryResult = await chatLLM({
        provider,
        messages: sanitizedMessages,
        model: providerModel,
        temperature: temperature ?? 0.3, // Lower temp for structured output
        max_tokens: max_tokens ?? 4096,
        // No tools — force text response
      })

      // P0 FIX: Strip raw reasoning from output
      let cleanedOutput = summaryResult.content || ''
      // Remove thinking/reasoning blocks
      cleanedOutput = cleanedOutput.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
      cleanedOutput = cleanedOutput.replace(/##?\s*(?:Reasoning|Thought Process|Thinking|Analysis|Step[- ]by[- ]Step)[\s\S]*?(?=##|$)/gi, '').trim()
      // Remove residual [object Object]
      cleanedOutput = cleanedOutput.replace(/\[object Object\]/g, '')

      finalContent = cleanedOutput
      logger.info({ contentLength: finalContent?.length ?? 0, hasContent: !!finalContent, cleaned: cleanedOutput.length < (summaryResult.content?.length ?? 0) }, 'Structured synthesis complete')
      if (summaryResult.usage) {
        totalUsage.prompt_tokens += summaryResult.usage.prompt_tokens
        totalUsage.completion_tokens += summaryResult.usage.completion_tokens
        totalUsage.total_tokens += summaryResult.usage.total_tokens
      }
    }

    logger.info({ model, provider, toolRounds, tools: allToolNames, toolsOffered: selectedTools.length, duration_ms: Date.now() - t0 }, 'OpenAI compat complete (orchestrated)')
    recordMetrics(model || 'gemini-flash', allToolNames, toolRounds, totalUsage.total_tokens, selectedTools.length)

    // ─── Return response (streaming or non-streaming) ─────────────────
    if (stream) {
      clearStreamKeepAlive()
      const chunkSize = 120
      for (let i = 0; i < finalContent.length; i += chunkSize) {
        const chunk = finalContent.slice(i, i + chunkSize)
        writeStreamChunk(res, requestId, responseModel, { content: chunk })
      }

      writeStreamChunk(res, requestId, responseModel, {}, 'stop')
      res.write('data: [DONE]\n\n')
      res.end()
    } else {
      res.json({
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'gemini-flash',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: finalContent },
          finish_reason: 'stop',
        }],
        usage: totalUsage,
      })
    }

  } catch (err) {
    clearStreamKeepAlive()
    logger.error({ model, provider, err: String(err) }, 'OpenAI compat error')
    if (stream && res.headersSent) {
      writeStreamChunk(res, requestId, responseModel, {}, 'stop')
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.status(500).json({
      error: {
        message: String(err),
        type: 'server_error',
        code: 'internal_error',
      },
    })
  }
})
