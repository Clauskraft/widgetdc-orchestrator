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
    case 'anthropic': return callAnthropic(provider, req)
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
