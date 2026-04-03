/**
 * slack.ts — Slack notifications via MCP backend route.
 *
 * Posts to a Slack channel via the backend MCP tool `slack.channel.post` when:
 * - An agent registers/deregisters
 * - A tool call completes (success or error)
 * - A chat message is broadcast
 *
 * Requires BACKEND_URL and BACKEND_API_KEY (or API_KEY) env vars.
 */
import { config } from './config.js'
import { logger } from './logger.js'

export function isSlackEnabled(): boolean {
  return Boolean(config.backendUrl) && Boolean(config.backendApiKey)
}

interface SlackPostPayload {
  text: string
  level: 'info' | 'warn' | 'error'
  title?: string
  source: string
  channel: string
}

// F3: Track whether slack.channel.post is available on the backend.
// After first TOOL_NOT_FOUND, suppress further attempts until next restart
// to avoid log noise from repeated calls to a missing tool.
let _slackToolAvailable = true

async function postToSlack(payload: SlackPostPayload): Promise<void> {
  if (!isSlackEnabled() || !_slackToolAvailable) return

  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({
        tool: 'slack.channel.post',
        payload,
      }),
    })

    if (!res.ok) {
      if (res.status === 404) {
        _slackToolAvailable = false
        logger.warn('slack.channel.post not found on backend — Slack notifications disabled until restart. Register slack as a deferred namespace on the backend to fix.')
      } else {
        logger.warn({ status: res.status }, 'Slack MCP post failed')
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Slack MCP post error')
  }
}

export function notifyAgentRegistered(agentId: string, displayName: string, namespaces: string[]): void {
  postToSlack({
    text: `Agent *${displayName}* (\`${agentId}\`) registered\nNamespaces: ${namespaces.join(', ')}`,
    level: 'info',
    title: `Agent Registered: ${displayName}`,
    source: 'orchestrator',
    channel: '#ops-alerts',
  })
}

export function notifyToolCall(
  agentId: string,
  toolName: string,
  status: string,
  durationMs: number,
  errorMessage?: string | null,
): void {
  const emoji = status === 'success' ? ':white_check_mark:' : ':x:'
  const level = status === 'success' ? 'info' as const : 'error' as const
  const errorLine = errorMessage ? `\nError: \`${errorMessage.slice(0, 200)}\`` : ''

  postToSlack({
    text: `${emoji} \`${agentId}\` called \`${toolName}\` → *${status}* (${durationMs}ms)${errorLine}\nOrchestrator: \`${config.orchestratorId}\``,
    level,
    title: `Tool Call: ${toolName} → ${status}`,
    source: 'orchestrator',
    channel: '#ops-alerts',
  })
}

export function notifyChatMessage(from: string, to: string, message: string): void {
  postToSlack({
    text: `*${from}* → *${to}*\n${message.slice(0, 500)}`,
    level: 'info',
    title: `Chat: ${from} → ${to}`,
    source: 'orchestrator',
    channel: '#ops-alerts',
  })
}

export function notifyAdoptionDigest(digest: {
  period: string
  conversations: number
  pipelines: number
  artifacts: number
  agents: number
  toolCalls: number
  chains: number
  featuresPct: number
  trend: 'up' | 'down' | 'flat'
}): void {
  const trendEmoji = digest.trend === 'up' ? ':chart_with_upwards_trend:' : digest.trend === 'down' ? ':chart_with_downwards_trend:' : ':bar_chart:'

  postToSlack({
    text: [
      `${trendEmoji} *Weekly Adoption Report* (${digest.period})`,
      '',
      `*Conversations:* ${digest.conversations} | *Pipelines:* ${digest.pipelines} | *Artifacts:* ${digest.artifacts}`,
      `*Active Agents:* ${digest.agents} | *Tool Calls:* ${digest.toolCalls} | *Chains:* ${digest.chains}`,
      `*Feature Adoption:* ${digest.featuresPct}%`,
      '',
      `Trend: ${digest.trend === 'up' ? 'Growing' : digest.trend === 'down' ? 'Declining' : 'Stable'}`,
    ].join('\n'),
    level: 'info',
    title: `Weekly Adoption Digest — ${digest.period}`,
    source: 'orchestrator',
    channel: '#ops-status',
  })
}
