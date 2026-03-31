/**
 * openai-compat.ts — OpenAI-compatible API endpoints for Open WebUI.
 *
 * LIN-494 + LIN-495: Phase 1+2 of Cloud Chat Platform.
 *
 * Endpoints:
 *   GET  /v1/models              — List available models
 *   POST /v1/chat/completions    — Chat completion (streaming + non-streaming)
 *
 * Flow:
 *   Open WebUI → /v1/chat/completions → inject system prompt → route to LLM
 *   → intercept tool_calls → MCP backend → return to LLM → final response
 */
import { Router, Request, Response } from 'express'
import { chatLLM, type LLMMessage } from '../llm-proxy.js'
import { callMcpTool } from '../mcp-caller.js'
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

  // Inject system prompt if not present
  const llmMessages: LLMMessage[] = [...(messages || [])]
  const hasSystem = llmMessages.some(m => m.role === 'system')
  if (!hasSystem) {
    llmMessages.unshift({ role: 'system', content: SYSTEM_PROMPT })
  }

  const t0 = Date.now()
  logger.info({ model, provider, stream, messageCount: llmMessages.length }, 'OpenAI compat request')

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
