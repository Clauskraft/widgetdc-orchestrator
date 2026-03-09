/**
 * routes/llm.ts — LLM chat proxy endpoints.
 */
import { Router } from 'express'
import { chatLLM, listProviders } from '../llm-proxy.js'
import { broadcastMessage } from '../chat-broadcaster.js'
import { logger } from '../logger.js'

export const llmRouter = Router()

/** List available LLM providers */
llmRouter.get('/providers', (_req, res) => {
  res.json({ success: true, data: { providers: listProviders() } })
})

/** Chat with a specific LLM provider */
llmRouter.post('/chat', async (req, res) => {
  const { provider, prompt, messages, model, temperature, max_tokens, broadcast } = req.body

  if (!provider) {
    res.status(400).json({ success: false, error: { code: 'MISSING_PROVIDER', message: 'provider is required', status_code: 400 } })
    return
  }
  if (!prompt && (!messages || !messages.length)) {
    res.status(400).json({ success: false, error: { code: 'MISSING_PROMPT', message: 'prompt or messages required', status_code: 400 } })
    return
  }

  const llmMessages = messages || [{ role: 'user' as const, content: prompt }]

  try {
    const result = await chatLLM({ provider, messages: llmMessages, model, temperature, max_tokens })

    // Optionally broadcast to chat
    if (broadcast !== false) {
      broadcastMessage({
        from: `${result.provider}/${result.model}`,
        to: 'All' as any,
        source: 'llm' as any,
        type: 'Answer' as any,
        message: result.content,
        timestamp: new Date().toISOString(),
      })
    }

    res.json({ success: true, data: result })
  } catch (err) {
    logger.error({ err: String(err), provider }, 'LLM chat error')
    res.status(502).json({
      success: false,
      error: { code: 'LLM_ERROR', message: String(err instanceof Error ? err.message : err), status_code: 502 },
    })
  }
})
