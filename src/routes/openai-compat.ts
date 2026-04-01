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
import { ORCHESTRATOR_TOOLS, executeToolCalls } from '../tool-executor.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import { v4 as uuid } from 'uuid'

const MAX_TOOL_ROUNDS = 3

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

function recordMetrics(model: string, toolCalls: string[], toolRounds: number, totalTokens: number) {
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

const SYSTEM_PROMPT = `Du er strategisk partner for WidgeTDC consulting intelligence platform (v1.0.0).

KRITISK REGEL: Du SKAL kalde mindst ét tool FØR du svarer på ethvert spørgsmål.
- Spørgsmål om data/viden → search_knowledge
- Spørgsmål om projekt/status/tasks → linear_issues eller check_tasks
- Spørgsmål om platform/health → get_platform_health
- Komplekse analyser → reason_deeply
- Specifikke graph queries → query_graph
- Multi-step workflows → run_chain
- Kvalitetstjek → verify_output
Du svarer ALDRIG baseret på generel viden alene. Du henter ALTID reel platformdata først.

PLATFORM: 448 MCP tools, 546K Neo4j nodes, 4 Railway services, 11 orchestrator tools.
KPI: advancedPct (mål 20%), complexity avg (mål 3.0), embedding coverage (mål 100%).

Svar på dansk medmindre brugeren skriver engelsk. Vær konkret og datadrevet.`

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

  res.json({
    period: '24h',
    total_requests: totalRequests,
    requests_with_tools: requestsWithTools,
    advanced_pct: parseFloat(advancedPct),
    avg_tool_rounds: parseFloat(avgToolRounds),
    total_tokens: totalTokens,
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

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const result = await chatLLM({
        provider,
        messages: loopMessages,
        model: providerModel,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 4096,
        tools: ORCHESTRATOR_TOOLS,
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

    logger.info({ model, provider, toolRounds, tools: allToolNames, duration_ms: Date.now() - t0 }, 'OpenAI compat complete (orchestrated)')
    recordMetrics(model || 'gemini-flash', allToolNames, toolRounds, totalUsage.total_tokens)

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
