/**
 * llm-proxy.ts — Direct LLM chat proxy to multiple providers.
 *
 * Supports: DeepSeek, Qwen (DashScope), Gemini, OpenAI, Groq, Anthropic
 * All use OpenAI-compatible chat completions API except Gemini and Anthropic.
 */
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

function getProviders(): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {}

  if (config.deepseekApiKey) {
    providers.deepseek = {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: config.deepseekApiKey,
      defaultModel: 'deepseek-chat',
      type: 'openai-compat',
    }
  }
  if (config.dashscopeApiKey) {
    providers.qwen = {
      name: 'Qwen',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      apiKey: config.dashscopeApiKey,
      defaultModel: 'qwen-plus',
      type: 'openai-compat',
    }
  }
  if (config.openaiApiKey) {
    providers.openai = {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: config.openaiApiKey,
      defaultModel: 'gpt-4o-mini',
      type: 'openai-compat',
    }
    providers.chatgpt = providers.openai // alias
  }
  if (config.groqApiKey) {
    providers.groq = {
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: config.groqApiKey,
      defaultModel: 'llama-3.3-70b-versatile',
      type: 'openai-compat',
    }
  }
  if (config.geminiApiKey) {
    providers.gemini = {
      name: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: config.geminiApiKey,
      defaultModel: 'gemini-2.0-flash',
      type: 'gemini',
    }
  }
  if (config.anthropicApiKey) {
    providers.claude = {
      name: 'Claude',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: config.anthropicApiKey,
      defaultModel: 'claude-sonnet-4-20250514',
      type: 'anthropic',
    }
    providers.anthropic = providers.claude // alias
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
  const providers = getProviders()
  const all = [
    { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-chat' },
    { id: 'qwen', name: 'Qwen', model: 'qwen-plus' },
    { id: 'gemini', name: 'Gemini', model: 'gemini-2.0-flash' },
    { id: 'openai', name: 'OpenAI/ChatGPT', model: 'gpt-4o-mini' },
    { id: 'groq', name: 'Groq', model: 'llama-3.3-70b-versatile' },
    { id: 'claude', name: 'Claude', model: 'claude-sonnet-4-20250514' },
  ]
  return all.map(p => ({ ...p, available: !!providers[p.id] }))
}
