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

async function postToSlack(payload: SlackPostPayload): Promise<void> {
  if (!isSlackEnabled()) return

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
      logger.warn({ status: res.status }, 'Slack MCP post failed')
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
