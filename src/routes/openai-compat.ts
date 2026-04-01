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
import { chatLLM, type LLMMessage } from '../llm-proxy.js'
import { ORCHESTRATOR_TOOLS, executeToolCalls, getTokenSavings } from '../tool-executor.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import { v4 as uuid } from 'uuid'

const MAX_TOOL_ROUNDS = 2

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
]

const MODEL_TO_PROVIDER: Record<string, { provider: string; model?: string }> = {
  'claude-sonnet': { provider: 'claude', model: 'claude-sonnet-4-20250514' },
  'claude-opus': { provider: 'claude', model: 'claude-opus-4-20250514' },
  'gemini-flash': { provider: 'gemini', model: 'gemini-2.0-flash' },
  'deepseek-chat': { provider: 'deepseek', model: 'deepseek-chat' },
  'qwen-plus': { provider: 'qwen', model: 'qwen-plus' },
  'gpt-4o': { provider: 'openai', model: 'gpt-4o' },
  'groq-llama': { provider: 'groq', model: 'llama-3.3-70b-versatile' },
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

  const models = MODELS.map(m => ({
    id: m.id,
    object: 'model',
    created: 1700000000,
    owned_by: m.provider,
    permission: [],
    root: m.id,
    parent: null,
  }))

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

  // Resolve provider
  const mapping = MODEL_TO_PROVIDER[model] || MODEL_TO_PROVIDER['gemini-flash']
  const provider = mapping.provider
  const providerModel = mapping.model

  // Inject system prompt if not present
  const llmMessages: LLMMessage[] = [...(messages || [])]
  const hasSystem = llmMessages.some(m => m.role === 'system')
  if (!hasSystem) {
    llmMessages.unshift({ role: 'system', content: SYSTEM_PROMPT })
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

    // Select only relevant tools based on user query (LIN-498)
    const userMsg = (messages || []).filter((m: any) => m.role === 'user').pop()?.content || ''
    const selectedTools = selectToolsForQuery(userMsg)
    logger.debug({ selectedTools: selectedTools.map(t => t.function.name), query: userMsg.slice(0, 50) }, 'Dynamic tool selection')

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
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

      // Check if LLM wants to call tools
      if (result.tool_calls && result.tool_calls.length > 0 && round < MAX_TOOL_ROUNDS) {
        toolRounds++
        const toolNames = result.tool_calls.map(tc => tc.function.name)
        allToolNames.push(...toolNames)
        logger.info({ round, tools: toolNames }, 'Tool calls requested')

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
      const summaryResult = await chatLLM({
        provider,
        messages: loopMessages,
        model: providerModel,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 4096,
        // No tools — force text response
      })
      finalContent = summaryResult.content
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
