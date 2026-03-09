/**
 * config.ts — Centralised configuration from environment variables.
 * All secrets live here. Never imported by contracts or domain code.
 */
import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

export const config = {
  port: parseInt(optional('PORT', '4000'), 10),
  nodeEnv: optional('NODE_ENV', 'production'),

  // WidgeTDC Backend (Railway monolith)
  backendUrl: optional('BACKEND_URL', 'https://backend-production-d3da.up.railway.app'),
  backendApiKey: required('BACKEND_API_KEY'),

  // LLM providers (for direct LLM chat proxy)
  deepseekApiKey: optional('DEEPSEEK_API_KEY', ''),
  dashscopeApiKey: optional('DASHSCOPE_API_KEY', ''),  // Qwen
  geminiApiKey: optional('GEMINI_API_KEY', ''),
  openaiApiKey: optional('OPENAI_API_KEY', ''),
  anthropicApiKey: optional('ANTHROPIC_API_KEY', ''),
  groqApiKey: optional('GROQ_API_KEY', ''),

  // RLM Engine (optional — cognitive reasoning proxy)
  rlmUrl: optional('RLM_URL', 'https://rlm-engine-production.up.railway.app'),

  // Redis (optional — for agent registry persistence across restarts)
  redisUrl: optional('REDIS_URL', ''),

  // Orchestrator API key (required for /agents/register and /tools/call)
  orchestratorApiKey: optional('ORCHESTRATOR_API_KEY', ''),

  // OpenClaw gateway (optional — for terminal/agent spawning)
  openclawUrl: optional('OPENCLAW_URL', ''),
  openclawToken: optional('OPENCLAW_GATEWAY_TOKEN', ''),

  // Orchestrator identity
  orchestratorId: optional('ORCHESTRATOR_ID', 'widgetdc-orchestrator-v1'),

  // WebSocket heartbeat interval (ms)
  wsHeartbeatMs: parseInt(optional('WS_HEARTBEAT_MS', '30000'), 10),

  // MCP tool call timeout (ms)
  mcpTimeoutMs: parseInt(optional('MCP_TIMEOUT_MS', '60000'), 10),

  // Rate limiting: max concurrent tool calls per agent
  maxConcurrentPerAgent: parseInt(optional('MAX_CONCURRENT_PER_AGENT', '5'), 10),
  agentOpenAccess: optional('AGENT_OPEN_ACCESS', 'true') === 'true',
} as const
