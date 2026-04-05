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
import { chatLLM, type LLMMessage } from '../llm-proxy.js'
import { ORCHESTRATOR_TOOLS, executeToolCalls, getTokenSavings } from '../tool-executor.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import { v4 as uuid } from 'uuid'

// Wave 3 (2026-04-05): alias→full-model-name mapping resolved via LlmMatrix.
// The Open WebUI UI sends short alias IDs ('claude-sonnet', 'gemini-flash')
// which orchestrator resolves to full matrix model names before dispatching
// to llm-proxy. The alias IDs are a stable UI contract and are defined
// locally; the target full-model names come from the matrix.
const MATRIX_ALIAS_TARGETS: Record<string, string> = {
  'claude-sonnet': 'claude-sonnet-4-20250514',
  'claude-opus': 'claude-sonnet-4-20250514', // opus not in matrix — route to sonnet
  'gemini-flash': 'gemini-2.0-flash',
  'deepseek-chat': 'deepseek-chat',
  'qwen-plus': 'qwen-plus',
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
  { keywords: /\b(health|status|uptime|service|railway|deploy|online)\b/i, tools: ['get_platform_health'] },
  { keywords: /\b(linear|issue|task|sprint|backlog|blocker|LIN-\d+|projekt|project)\b/i, tools: ['linear_issues', 'linear_issue_detail'] },
  { keywords: /\b(søg|search|find|pattern|knowledge|viden|consulting|document|artifact)\b/i, tools: ['search_knowledge', 'search_documents'] },
  { keywords: /\b(analy|strateg|reason|deep|complex|evaluat|plan|why|how does|architect|OODA)\b/i, tools: ['reason_deeply', 'search_knowledge'] },
  { keywords: /\b(graph|cypher|node|relation|neo4j|count|match)\b/i, tools: ['query_graph'] },
  { keywords: /\b(chain|workflow|sequential|parallel|debate|multi.step|pipeline)\b/i, tools: ['run_chain'] },
  { keywords: /\b(verify|check|quality|audit|compliance|valid)\b/i, tools: ['verify_output'] },
  { keywords: /\b(mcp|tool|call|endpoint|api)\b/i, tools: ['call_mcp_tool'] },
  { keywords: /\b(notebook|celle|cells|query.*insight|interactive.*analysis|structured.*analysis)\b/i, tools: ['create_notebook'] },
]

const FALLBACK_TOOLS = ['search_knowledge', 'get_platform_health', 'linear_issues']

function selectToolsForQuery(userMessage: string): typeof ORCHESTRATOR_TOOLS {
  const matched = new Set<string>()

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
}

const ASSISTANTS: AssistantConfig[] = [
  {
    id: 'compliance-auditor',
    displayName: 'Compliance Auditor',
    baseModel: 'claude-sonnet',
    systemPrompt: 'Du er WidgeTDC Compliance Auditor. Du har adgang til 12 regulatoriske frameworks (GDPR, NIS2, DORA, CSRD, AI Act, Pillar Two, CRA, eIDAS2) og 506 GDPR enforcement cases i videngrafen (445K nodes, 3.7M relationer). Brug ALTID search_knowledge og verify_output til at hente reel compliance-data. Citér kilder med [REG-xxxx] format. Anvend EG PMM projektmetode og BPMV procesmodel i dine anbefalinger. 32 consulting domæner er tilgængelige. Svar på dansk med consulting-grade præcision.',
    tools: ['search_knowledge', 'verify_output', 'query_graph'],
    promptSuggestions: ['Kør NIS2 gap-analyse', 'GDPR data mapping', 'DORA compliance status'],
  },
  {
    id: 'graph-analyst',
    displayName: 'Graph Analyst',
    baseModel: 'gemini-flash',
    systemPrompt: 'Du er WidgeTDC Graph Analyst med direkte adgang til Neo4j videngrafen: 445,918 nodes, 3,771,937 relationer, 32 consulting domæner, 270+ frameworks, 288 KPIs, 52,925 McKinsey insights. Brug query_graph til Cypher-forespørgsler og search_knowledge til semantisk søgning. Visualisér resultater som tabeller og lister. Svar på dansk.',
    tools: ['query_graph', 'search_knowledge'],
    promptSuggestions: ['Vis domain-statistik', 'Find orphan nodes', 'Framework-dækning per domæne'],
  },
  {
    id: 'project-manager',
    displayName: 'Project Manager',
    baseModel: 'claude-sonnet',
    systemPrompt: 'Du er WidgeTDC Project Manager. Brug linear_issues til at hente sprint-status, blockers og opgaver fra Linear. Brug search_knowledge til at forstå konteksten. Rapportér med KPIs: velocity, blockers, sprint burn. Anvend EG PMM projektmetode (faser, leverancer, gates) og BPMV procesmodel i projektplanlægning. 38 consulting-processer og 9 consulting-services er tilgængelige i grafen. Svar på dansk med actionable næste-skridt.',
    tools: ['linear_issues', 'linear_issue_detail', 'search_knowledge'],
    promptSuggestions: ['Sprint status', 'Næste prioritet', 'Blocker-rapport'],
  },
  {
    id: 'consulting-partner',
    displayName: 'Consulting Partner',
    baseModel: 'claude-opus',
    systemPrompt: 'Du er WidgeTDC Consulting Partner — strategisk rådgiver med adgang til verdens mest avancerede consulting intelligence platform. 84 frameworks (Balanced Scorecard, BCG Matrix, Porter Five Forces, McKinsey 7S, Design Thinking, EG PMM, BPMV m.fl.), 52,925 McKinsey insights, 1,201 consulting artifacts, 825 KPIs, 506 case studies, 35 consulting skills, 38 processer. Brug reason_deeply for dyb analyse og search_knowledge for grafdata. Leverér consulting-grade output med frameworks, data og handlingsplaner. Svar på dansk.',
    tools: ['reason_deeply', 'search_knowledge', 'query_graph'],
    promptSuggestions: ['Strategisk analyse af [emne]', 'Framework selection', 'Markedsanalyse'],
  },
  {
    id: 'platform-health',
    displayName: 'Platform Health',
    baseModel: 'gemini-flash',
    systemPrompt: 'Du er WidgeTDC Platform Health Monitor. Brug get_platform_health til at tjekke alle services (backend, RLM engine, orchestrator, Neo4j, Redis, Pipelines). Brug call_mcp_tool til avancerede MCP-kald. Rapportér: service health, Neo4j stats (445K nodes), agent fleet (430+ agenter), cron jobs, Redis status. Svar på dansk med real-time data.',
    tools: ['get_platform_health', 'call_mcp_tool', 'query_graph'],
    promptSuggestions: ['Service status', 'Neo4j health', 'Agent fleet oversigt'],
  },
]

const ASSISTANT_MAP = new Map<string, AssistantConfig>(ASSISTANTS.map(a => [a.id, a]))

// ─── Model registry ─────────────────────────────────────────────────────────

interface ModelEntry {
  id: string
  provider: string
  displayName: string
}

const MODELS: ModelEntry[] = [
  { id: 'claude-sonnet', provider: 'claude', displayName: 'Claude Sonnet 4' },
  { id: 'claude-opus', provider: 'claude', displayName: 'Claude Opus 4' },
  { id: 'gemini-flash', provider: 'gemini', displayName: 'Gemini 2.0 Flash' },
  { id: 'deepseek-chat', provider: 'deepseek', displayName: 'DeepSeek Chat' },
  { id: 'qwen-plus', provider: 'qwen', displayName: 'Qwen Plus' },
  { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o' },
  { id: 'groq-llama', provider: 'groq', displayName: 'Groq Llama 3.3 70B' },
  // Consulting Assistants (LIN-524)
  ...ASSISTANTS.map(a => ({ id: a.id, provider: 'widgetdc', displayName: a.displayName })),
]

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

  const models = MODELS.map(m => {
    const assistant = ASSISTANT_MAP.get(m.id)
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
  const assistant = ASSISTANT_MAP.get(model)

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

    // If all rounds used tool_calls and no final content, do one more LLM call
    // WITHOUT tools to force a text response from the collected data
    if (!finalContent && toolRounds > 0) {
      // Add explicit synthesis instruction
      loopMessages.push({
        role: 'user',
        content: 'Baseret på alle tool-resultater ovenfor, generer nu dit fulde svar. Inkludér konkrete data, tal og referencer. Svar på dansk i consulting-kvalitet med overskrifter og struktur.',
      })
      logger.info({ toolRounds, messageCount: loopMessages.length }, 'Forcing text synthesis after tool rounds')
      const summaryResult = await chatLLM({
        provider,
        messages: loopMessages,
        model: providerModel,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 4096,
        // No tools — force text response
      })
      finalContent = summaryResult.content
      logger.info({ contentLength: finalContent?.length ?? 0, hasContent: !!finalContent }, 'Synthesis result')
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
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const chunkSize = 20
      for (let i = 0; i < finalContent.length; i += chunkSize) {
        const chunk = finalContent.slice(i, i + chunkSize)
        res.write(`data: ${JSON.stringify({
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model || 'gemini-flash',
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        })}\n\n`)
      }

      res.write(`data: ${JSON.stringify({
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model || 'gemini-flash',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`)
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
    logger.error({ model, provider, err: String(err) }, 'OpenAI compat error')
    res.status(500).json({
      error: {
        message: String(err),
        type: 'server_error',
        code: 'internal_error',
      },
    })
  }
})
