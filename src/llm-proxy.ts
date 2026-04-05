/**
 * llm-proxy.ts — Direct LLM chat proxy to multiple providers.
 *
 * Wave 3 (2026-04-05): provider base URLs and default models are now resolved
 * through the canonical @widgetdc/contracts/llm LlmMatrix instead of being
 * hardcoded. The matrix is the single source of truth for task→model routing.
 * Local `type` field still discriminates dispatch (openai-compat / gemini /
 * anthropic) since each non-OpenAI-compatible provider needs a bespoke
 * request shape.
 *
 * Supports any provider declared in the matrix whose auth env var is set.
 */
import { LlmMatrix, type ProviderId } from '@widgetdc/contracts/llm'
import { config } from './config.js'
import { logger } from './logger.js'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

export interface LLMRequest {
  provider: string
  messages: LLMMessage[]
  model?: string
  temperature?: number
  max_tokens?: number
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
}

export interface LLMResponse {
  provider: string
  model: string
  content: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  duration_ms: number
  /** v4.1.1: set when the original provider failed and a fallback was used. */
  fallback_provider?: string
  /** v4.1.1: human-readable reason the fallback was triggered. */
  fallback_reason?: string
}

interface ProviderConfig {
  name: string
  baseUrl: string
  apiKey: string
  defaultModel: string
  type: 'openai-compat' | 'gemini' | 'anthropic'
}

/** Display names for each matrix provider id. */
const PROVIDER_DISPLAY_NAMES: Record<ProviderId, string> = {
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  openai: 'OpenAI',
  groq: 'Groq',
  gemini: 'Gemini',
  anthropic: 'Claude',
  inception: 'Mercury',
  local: 'Local',
}

/** Dispatch-type discriminator derived from matrix metadata + known SDK quirks. */
function dispatchTypeFor(providerId: ProviderId, openaiCompatible: boolean): ProviderConfig['type'] {
  if (openaiCompatible) return 'openai-compat'
  if (providerId === 'gemini') return 'gemini'
  if (providerId === 'anthropic') return 'anthropic'
  return 'openai-compat' // defensive default — unknown non-compat providers are skipped upstream
}

/**
 * First model in the matrix whose provider matches. Used as the per-provider
 * default model when a caller omits `req.model`. Falls back to the first entry
 * in the `chat_standard` task chain if no direct match exists.
 */
function firstModelForProvider(providerId: ProviderId): string | null {
  for (const modelName of LlmMatrix.listModels()) {
    const model = LlmMatrix.getModel(modelName)
    if (model.provider === providerId) return modelName
  }
  return null
}

function getProviders(): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {}

  // Map matrix provider id → orchestrator config apiKey field.
  // We keep this explicit (not env-var lookup) because orchestrator's config
  // layer already validates + normalizes the keys and we want to honor its
  // empty-string defaults (= unconfigured).
  const keyLookup: Partial<Record<ProviderId, string>> = {
    deepseek: config.deepseekApiKey,
    qwen: config.dashscopeApiKey,
    openai: config.openaiApiKey,
    groq: config.groqApiKey,
    gemini: config.geminiApiKey,
    anthropic: config.anthropicApiKey,
  }

  for (const providerId of LlmMatrix.listProviders()) {
    const apiKey = keyLookup[providerId]
    if (!apiKey) continue // no key configured in orchestrator → provider disabled

    const providerCfg = LlmMatrix.getProvider(providerId)
    const defaultModel = firstModelForProvider(providerId)
    if (!defaultModel) {
      logger.warn({ providerId }, '[llm-proxy] matrix has no model for provider — skipping')
      continue
    }

    const cfg: ProviderConfig = {
      name: PROVIDER_DISPLAY_NAMES[providerId] ?? providerId,
      baseUrl: providerCfg.base_url,
      apiKey,
      defaultModel,
      type: dispatchTypeFor(providerId, providerCfg.openai_compatible),
    }
    providers[providerId] = cfg

    // Legacy aliases preserved for backwards-compat with callers using the
    // human-friendly names instead of the canonical matrix provider id.
    if (providerId === 'openai') providers.chatgpt = cfg
    if (providerId === 'anthropic') providers.claude = cfg
  }

  return providers
}

async function callOpenAICompat(provider: ProviderConfig, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now()
  const model = req.model || provider.defaultModel

  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.max_tokens ?? 2048,
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
  }

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`${provider.name} error: ${err}`)
  }

  const data = await res.json() as any
  const message = data.choices?.[0]?.message
  return {
    provider: req.provider,
    model: data.model || model,
    content: message?.content || '',
    tool_calls: message?.tool_calls,
    usage: data.usage,
    duration_ms: Date.now() - start,
  }
}

async function callGemini(provider: ProviderConfig, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now()
  const model = req.model || provider.defaultModel

  // Convert messages to Gemini format
  const contents = req.messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const systemInstruction = req.messages.find(m => m.role === 'system')

  // Convert OpenAI tools format to Gemini format
  const geminiTools = req.tools && req.tools.length > 0 ? [{
    functionDeclarations: req.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
  }] : undefined

  const res = await fetch(
    `${provider.baseUrl}/models/${model}:generateContent?key=${provider.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {}),
        ...(geminiTools ? { tools: geminiTools } : {}),
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.max_tokens ?? 2048,
        },
      }),
      signal: AbortSignal.timeout(60000),
    },
  )

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Gemini error: ${err}`)
  }

  const data = await res.json() as any
  const parts = data.candidates?.[0]?.content?.parts || []
  const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text)
  const functionCalls = parts.filter((p: any) => p.functionCall)

  // Convert Gemini function calls to OpenAI tool_calls format
  const tool_calls = functionCalls.length > 0 ? functionCalls.map((fc: any, i: number) => ({
    id: `call_gemini_${i}_${Date.now()}`,
    type: 'function' as const,
    function: {
      name: fc.functionCall.name,
      arguments: JSON.stringify(fc.functionCall.args || {}),
    },
  })) : undefined

  return {
    provider: 'gemini',
    model,
    content: textParts.join('') || '',
    tool_calls,
    usage: data.usageMetadata ? {
      prompt_tokens: data.usageMetadata.promptTokenCount || 0,
      completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
      total_tokens: data.usageMetadata.totalTokenCount || 0,
    } : undefined,
    duration_ms: Date.now() - start,
  }
}

async function callAnthropic(provider: ProviderConfig, req: LLMRequest): Promise<LLMResponse> {
  const start = Date.now()
  const model = req.model || provider.defaultModel

  const systemMsg = req.messages.find(m => m.role === 'system')
  const nonSystem = req.messages.filter(m => m.role !== 'system')

  // Convert OpenAI tools format to Anthropic format
  const anthropicTools = req.tools?.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }))

  // Convert messages: handle tool_calls and tool results
  const anthropicMessages = nonSystem.map(m => {
    if (m.role === 'assistant' && m.tool_calls) {
      // Assistant message with tool_calls → Anthropic content blocks
      const content: any[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
        })
      }
      return { role: 'assistant', content }
    }
    if (m.role === 'tool' && m.tool_call_id) {
      // Tool result → Anthropic tool_result block
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.tool_call_id,
          content: m.content,
        }],
      }
    }
    return { role: m.role === 'tool' ? 'user' : m.role, content: m.content }
  })

  const body: Record<string, unknown> = {
    model,
    max_tokens: req.max_tokens ?? 2048,
    ...(systemMsg ? { system: systemMsg.content } : {}),
    messages: anthropicMessages,
  }
  if (anthropicTools && anthropicTools.length > 0) {
    body.tools = anthropicTools
  }

  const res = await fetch(`${provider.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Claude error: ${err}`)
  }

  const data = await res.json() as any
  const contentBlocks = data.content || []
  const textBlocks = contentBlocks.filter((b: any) => b.type === 'text')
  const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use')

  // Convert Anthropic tool_use blocks to OpenAI tool_calls format
  const tool_calls = toolUseBlocks.length > 0 ? toolUseBlocks.map((tu: any) => ({
    id: tu.id,
    type: 'function' as const,
    function: {
      name: tu.name,
      arguments: JSON.stringify(tu.input || {}),
    },
  })) : undefined

  return {
    provider: 'claude',
    model: data.model || model,
    content: textBlocks.map((b: any) => b.text).join('') || '',
    tool_calls,
    usage: data.usage ? {
      prompt_tokens: data.usage.input_tokens || 0,
      completion_tokens: data.usage.output_tokens || 0,
      total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
    } : undefined,
    duration_ms: Date.now() - start,
  }
}

/**
 * v4.1.1 — OpenRouter Claude dispatch (fallback path for Anthropic direct).
 *
 * OpenRouter exposes an OpenAI-compatible endpoint at openrouter.ai/api/v1 and
 * routes `anthropic/*` model slugs to real Anthropic models using OpenRouter's
 * own prepaid balance (separate from Anthropic direct billing). This lets us
 * keep serving genuine Claude responses when the user's Anthropic key is out
 * of credits or rate-limited.
 */
async function callOpenRouterClaude(req: LLMRequest): Promise<LLMResponse> {
  if (!config.openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY not configured')
  }
  const start = Date.now()

  // Map canonical matrix model names → OpenRouter model slugs.
  const canonical = req.model || 'claude-sonnet-4-20250514'
  const slugMap: Record<string, string> = {
    'claude-sonnet-4-20250514': 'anthropic/claude-sonnet-4',
    'claude-opus-4-20250514': 'anthropic/claude-opus-4',
    'claude-3-5-sonnet-20241022': 'anthropic/claude-3.5-sonnet',
    'claude-3-5-haiku-20241022': 'anthropic/claude-3.5-haiku',
  }
  const orModel = slugMap[canonical] || `anthropic/${canonical}`

  const body: Record<string, unknown> = {
    model: orModel,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.max_tokens ?? 2048,
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      // OpenRouter recommends identifying the app for usage analytics + ranking.
      'HTTP-Referer': 'https://orchestrator-production-c27e.up.railway.app',
      'X-Title': 'WidgeTDC Orchestrator',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`OpenRouter error: ${err}`)
  }

  const data = await res.json() as any
  const message = data.choices?.[0]?.message
  return {
    provider: 'openrouter',
    model: data.model || orModel,
    content: message?.content || '',
    tool_calls: message?.tool_calls,
    usage: data.usage,
    duration_ms: Date.now() - start,
  }
}

/**
 * v4.1.1 — Is this error from Anthropic a billing/credit/quota issue that
 * warrants falling back to an alternative provider? We keep the detector
 * conservative: 402, "credit balance", "insufficient", "quota", "billing".
 * Other errors (network, 5xx, auth) propagate unchanged so operators see the
 * real failure mode instead of a silent degraded response.
 */
function isAnthropicBillingError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase()
  return /credit\s*balance|insufficient|quota\s*exceeded|billing|payment|402\b/.test(msg)
}

/**
 * v4.1.1 — Execute the configured Anthropic fallback chain when the direct
 * dispatch fails with a billing error. Returns the first successful fallback
 * response annotated with `fallback_provider` + `fallback_reason`. Throws an
 * aggregated error if every fallback in the chain also fails.
 */
async function callAnthropicFallback(req: LLMRequest, reason: string): Promise<LLMResponse> {
  const chain = config.anthropicFallbackChain
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

  const attemptErrors: string[] = []

  for (const fallback of chain) {
    try {
      if (fallback === 'openrouter') {
        if (!config.openrouterApiKey) {
          attemptErrors.push('openrouter: no API key configured')
          continue
        }
        logger.warn({ reason }, '[llm-proxy] Anthropic billing failure → fallback to openrouter/claude')
        const res = await callOpenRouterClaude(req)
        return { ...res, fallback_provider: 'openrouter', fallback_reason: reason }
      }

      if (fallback === 'deepseek') {
        const providers = getProviders()
        const deepseek = providers.deepseek
        if (!deepseek) {
          attemptErrors.push('deepseek: not configured')
          continue
        }
        logger.warn({ reason }, '[llm-proxy] Anthropic billing failure → fallback to deepseek (last resort, UX-degraded)')
        const res = await callOpenAICompat(deepseek, {
          ...req,
          provider: 'deepseek',
          model: deepseek.defaultModel,
        })
        return { ...res, fallback_provider: 'deepseek', fallback_reason: reason }
      }

      attemptErrors.push(`${fallback}: unknown fallback target`)
    } catch (err) {
      attemptErrors.push(`${fallback}: ${String((err as any)?.message ?? err)}`)
    }
  }

  throw new Error(
    `Anthropic dispatch failed and all fallbacks exhausted. ` +
    `Original: ${reason}. Fallback attempts: ${attemptErrors.join(' | ')}`,
  )
}

export async function chatLLM(req: LLMRequest): Promise<LLMResponse> {
  const providers = getProviders()
  const provider = providers[req.provider.toLowerCase()]

  if (!provider) {
    const available = Object.keys(providers)
    throw new Error(`Unknown provider '${req.provider}'. Available: ${available.join(', ')}`)
  }

  logger.info({ provider: req.provider, model: req.model, messages: req.messages.length }, 'LLM proxy call')

  switch (provider.type) {
    case 'openai-compat': return callOpenAICompat(provider, req)
    case 'gemini': return callGemini(provider, req)
    case 'anthropic': {
      // v4.1.1: Anthropic direct is primary. On billing/credit/quota errors
      // only, cascade through OPENROUTER → DEEPSEEK fallback chain. All other
      // errors (network, 5xx, auth, schema) propagate unchanged.
      try {
        return await callAnthropic(provider, req)
      } catch (err) {
        if (!isAnthropicBillingError(err)) throw err
        const reason = String((err as any)?.message ?? err)
        return callAnthropicFallback(req, reason)
      }
    }
    default: throw new Error(`Unsupported provider type: ${provider.type}`)
  }
}

export function listProviders(): Array<{ id: string; name: string; model: string; available: boolean }> {
  const configured = getProviders()
  // Wave 3: catalog is now matrix-driven. Advertise every provider declared in
  // the canonical matrix, marking each as available=true only when its API key
  // is configured in orchestrator env.
  return LlmMatrix.listProviders().map(providerId => {
    const displayName = PROVIDER_DISPLAY_NAMES[providerId] ?? providerId
    const defaultModel = firstModelForProvider(providerId) ?? providerId
    return {
      id: providerId,
      name: displayName,
      model: defaultModel,
      available: !!configured[providerId],
    }
  })
}
