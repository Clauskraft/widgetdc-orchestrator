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
import { callMcpTool } from '../mcp-caller.js'
import { dualChannelRAG } from '../dual-rag.js'
import { callCognitive, isRlmAvailable } from '../cognitive-proxy.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import { v4 as uuid } from 'uuid'

export const openaiCompatRouter = Router()

// ─── System prompt injection ────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du er strategisk partner for WidgeTDC consulting intelligence platform (v2.4.0).

PLATFORM: 448 MCP tools, 520K Neo4j nodes, 3 Railway services, 10 A2A skills.
MISSION: Drive advancedPct fra 0% til 20%, eliminere human bottleneck, harveste consulting-viden.
KPI: advancedPct (mål 20%), complexity avg (mål 3.0), embedding coverage (mål 100%).

BRUG ALTID avancerede tools for analyse:
- srag.query for semantic search (complexity 3)
- kg_rag.query for multi-hop reasoning (complexity 4)
- autonomous.graphrag for deep synthesis (complexity 8)
- ALDRIG default til simple Cypher for komplekse spørgsmål.

Svar på dansk medmindre brugeren skriver engelsk.
Vær proaktiv — foreslå avancerede tools og intelligence loops.`

// ─── Orchestrated context retrieval ─────────────────────────────────────────

/**
 * Retrieve platform context via dual-RAG + optional RLM reasoning.
 * This is the core orchestration: every chat message goes through
 * the intelligence stack before the LLM sees it.
 */
async function getOrchestratedContext(userMessage: string, requestId: string): Promise<string> {
  const parts: string[] = []

  try {
    // 1. Dual-channel RAG: SRAG vector search + Neo4j graph traversal (parallel)
    const ragResult = await dualChannelRAG(userMessage, { maxResults: 8 })

    if (ragResult.merged_context.length > 0) {
      parts.push(`=== PLATFORM KNOWLEDGE (${ragResult.srag_count} semantic + ${ragResult.cypher_count} graph results, ${ragResult.duration_ms}ms) ===`)
      parts.push(ragResult.merged_context)
    }

    logger.info({ requestId, srag: ragResult.srag_count, cypher: ragResult.cypher_count, ms: ragResult.duration_ms }, 'Dual-RAG retrieval')
  } catch (err) {
    logger.warn({ requestId, err: String(err) }, 'Dual-RAG failed — continuing without context')
  }

  // 2. RLM deep reasoning for complex queries (if available and query seems complex)
  const isComplex = userMessage.length > 100
    || /\b(analy|strateg|compar|evaluat|why|how does|explain|plan|recommend|architect)\b/i.test(userMessage)

  if (isComplex && isRlmAvailable()) {
    try {
      const rlmResult = await callCognitive('reason', {
        prompt: userMessage,
        context: { source: 'open-webui-chat', request_id: requestId },
        agent_id: 'chat-orchestrator',
        depth: 1,
      }, 30000)

      if (rlmResult) {
        const rlmText = typeof rlmResult === 'string' ? rlmResult : JSON.stringify(rlmResult, null, 2)
        if (rlmText.length > 20) {
          parts.push(`=== RLM DEEP REASONING ===`)
          parts.push(rlmText.slice(0, 2000))
        }
      }

      logger.info({ requestId, complex: true }, 'RLM reasoning complete')
    } catch (err) {
      logger.warn({ requestId, err: String(err) }, 'RLM reasoning failed — continuing without')
    }
  }

  // 3. Active Linear context for project-related queries
  if (/\b(linear|task|issue|sprint|backlog|status|next step|blocker|plan)\b/i.test(userMessage)) {
    try {
      const linearResult = await callMcpTool({
        toolName: 'graph.read_cypher',
        args: {
          query: `MATCH (n) WHERE (n:Task OR n:L3Task) AND n.status IN ['In Progress', 'Todo', 'Backlog']
                  RETURN n.title AS title, n.status AS status, coalesce(n.identifier, n.id) AS id
                  ORDER BY n.updatedAt DESC LIMIT 10`,
        },
        callId: uuid(),
        timeoutMs: 10000,
      })

      if (linearResult.status === 'success' && linearResult.result) {
        const rows = Array.isArray(linearResult.result) ? linearResult.result
          : (linearResult.result as any)?.results ?? []
        if (rows.length > 0) {
          parts.push(`=== ACTIVE TASKS (from graph) ===`)
          parts.push(rows.map((r: any) => `- [${r.id ?? '?'}] ${r.title} (${r.status})`).join('\n'))
        }
      }
    } catch (err) {
      logger.warn({ requestId, err: String(err) }, 'Task context failed')
    }
  }

  return parts.join('\n\n')
}

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

// ─── GET /v1/models ─────────────────────────────────────────────────────────

openaiCompatRouter.get('/v1/models', (_req: Request, res: Response) => {
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
  const { model, messages, stream, temperature, max_tokens } = req.body
  const requestId = `chatcmpl-${uuid().substring(0, 12)}`

  // Resolve provider
  const mapping = MODEL_TO_PROVIDER[model] || MODEL_TO_PROVIDER['gemini-flash']
  const provider = mapping.provider
  const providerModel = mapping.model

  // Extract last user message for orchestration
  const userMessages = (messages || []).filter((m: any) => m.role === 'user')
  const lastUserMessage = userMessages.length > 0
    ? userMessages[userMessages.length - 1].content
    : ''

  // ─── ORCHESTRATION: Retrieve platform context before LLM call ──────
  let orchestratedContext = ''
  if (lastUserMessage.length > 2) {
    try {
      orchestratedContext = await getOrchestratedContext(lastUserMessage, requestId)
    } catch (err) {
      logger.warn({ requestId, err: String(err) }, 'Orchestration failed — falling back to plain chat')
    }
  }

  // Build system prompt with orchestrated context
  const enrichedSystemPrompt = orchestratedContext.length > 0
    ? `${SYSTEM_PROMPT}\n\n${orchestratedContext}\n\nBrug ovenstående platformdata til at give et præcist, datadrevet svar. Citér kilder når muligt.`
    : SYSTEM_PROMPT

  // Inject system prompt if not present
  const llmMessages: LLMMessage[] = [...(messages || [])]
  const hasSystem = llmMessages.some(m => m.role === 'system')
  if (!hasSystem) {
    llmMessages.unshift({ role: 'system', content: enrichedSystemPrompt })
  } else {
    // Append orchestrated context to existing system prompt
    if (orchestratedContext.length > 0) {
      const sysIdx = llmMessages.findIndex(m => m.role === 'system')
      if (sysIdx >= 0) {
        llmMessages[sysIdx] = {
          ...llmMessages[sysIdx],
          content: `${llmMessages[sysIdx].content}\n\n${orchestratedContext}`,
        }
      }
    }
  }

  const t0 = Date.now()
  logger.info({ model, provider, stream, messageCount: llmMessages.length, contextLen: orchestratedContext.length }, 'OpenAI compat request (orchestrated)')

  try {
    if (stream) {
      // ─── Streaming SSE response ─────────────────────────────────────
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      // Call LLM (non-streaming internally, stream output chunk-by-chunk)
      const result = await chatLLM({
        provider,
        messages: llmMessages,
        model: providerModel,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 4096,
      })

      // Simulate streaming by chunking the response
      const content = result.content
      const chunkSize = 20 // characters per chunk
      const chunks = []
      for (let i = 0; i < content.length; i += chunkSize) {
        chunks.push(content.slice(i, i + chunkSize))
      }

      for (const chunk of chunks) {
        const event = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model || 'gemini-flash',
          choices: [{
            index: 0,
            delta: { content: chunk },
            finish_reason: null,
          }],
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }

      // Send finish event
      const finishEvent = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model || 'gemini-flash',
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
      }
      res.write(`data: ${JSON.stringify(finishEvent)}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()

      logger.info({ model, provider, duration_ms: Date.now() - t0, tokens: content.length / 4 }, 'OpenAI compat stream complete')

    } else {
      // ─── Non-streaming response ─────────────────────────────────────
      const result = await chatLLM({
        provider,
        messages: llmMessages,
        model: providerModel,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 4096,
      })

      const response = {
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'gemini-flash',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.content },
          finish_reason: 'stop',
        }],
        usage: result.usage || {
          prompt_tokens: Math.ceil(JSON.stringify(llmMessages).length / 4),
          completion_tokens: Math.ceil(result.content.length / 4),
          total_tokens: Math.ceil((JSON.stringify(llmMessages).length + result.content.length) / 4),
        },
      }

      res.json(response)
      logger.info({ model, provider, duration_ms: Date.now() - t0 }, 'OpenAI compat complete')
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
