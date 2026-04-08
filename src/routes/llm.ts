/**
 * routes/llm.ts — LLM chat proxy endpoints.
 */
import { Router } from 'express'
import { chatLLM, listProviders } from '../llm/llm-proxy.js'
import { broadcastMessage } from '../chat-broadcaster.js'
import { storeMessage, msgId } from '../chat-store.js'
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
        to: 'All',
        source: 'llm',
        type: 'Answer',
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

/** Persistent LLM conversation — stores user msg + LLM reply in chat-store */
llmRouter.post('/conversation', async (req, res) => {
  const { provider, messages, prompt, model, temperature, max_tokens, conversation_id } = req.body

  if (!provider) {
    res.status(400).json({ success: false, error: { code: 'MISSING_PROVIDER', message: 'provider is required', status_code: 400 } })
    return
  }
  if (!prompt && (!messages || !messages.length)) {
    res.status(400).json({ success: false, error: { code: 'MISSING_PROMPT', message: 'prompt or messages required', status_code: 400 } })
    return
  }

  const convId = conversation_id || `llm-${provider}-${Date.now().toString(36)}`
  const llmMessages = messages || [{ role: 'user' as const, content: prompt }]

  // Extract last user message for persistence
  const lastUserMsg = [...llmMessages].reverse().find((m: any) => m.role === 'user')

  try {
    // 1. Persist user's message
    if (lastUserMsg) {
      await storeMessage({
        id: msgId(),
        from: 'command-center',
        to: provider,
        source: 'human',
        type: 'Message',
        message: lastUserMsg.content,
        timestamp: new Date().toISOString(),
        metadata: { conversation_id: convId, provider },
      })
    }

    // 2. Call LLM with full conversation
    const result = await chatLLM({ provider, messages: llmMessages, model, temperature, max_tokens })

    // 3. Persist LLM response
    await storeMessage({
      id: msgId(),
      from: `${result.provider}/${result.model}`,
      to: 'command-center',
      source: 'llm',
      type: 'Answer',
      message: result.content,
      timestamp: new Date().toISOString(),
      metadata: {
        conversation_id: convId,
        provider: result.provider,
        model: result.model,
        duration_ms: result.duration_ms,
        usage: result.usage,
      },
    })

    logger.info({ provider, model: result.model, convId, ms: result.duration_ms }, 'LLM conversation persisted')
    res.json({ success: true, data: { ...result, conversation_id: convId } })
  } catch (err) {
    logger.error({ err: String(err), provider, convId }, 'LLM conversation error')
    res.status(502).json({
      success: false,
      error: { code: 'LLM_ERROR', message: String(err instanceof Error ? err.message : err), status_code: 502 },
    })
  }
})
