/**
 * slack.ts — Slack webhook integration for agent activity notifications.
 *
 * Posts to a Slack channel via Incoming Webhook when:
 * - An agent registers/deregisters
 * - A tool call completes (success or error)
 * - A chat message is broadcast
 *
 * Set SLACK_WEBHOOK_URL env var to enable.
 */
import { config } from './config.js'
import { logger } from './logger.js'

const webhookUrl = process.env['SLACK_WEBHOOK_URL'] ?? ''

export function isSlackEnabled(): boolean {
  return webhookUrl.length > 0
}

interface SlackBlock {
  type: string
  text?: { type: string; text: string; emoji?: boolean }
  fields?: Array<{ type: string; text: string }>
  elements?: Array<{ type: string; text: string }>
}

async function postToSlack(blocks: SlackBlock[], text: string): Promise<void> {
  if (!isSlackEnabled()) return

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    })

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Slack webhook failed')
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'Slack webhook error')
  }
}

export function notifyAgentRegistered(agentId: string, displayName: string, namespaces: string[]): void {
  postToSlack([
    {
      type: 'header',
      text: { type: 'plain_text', text: `Agent Registered: ${displayName}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Agent ID:*\n\`${agentId}\`` },
        { type: 'mrkdwn', text: `*Tool Namespaces:*\n${namespaces.join(', ')}` },
      ],
    },
  ], `Agent ${displayName} (${agentId}) registered`)
}

export function notifyToolCall(
  agentId: string,
  toolName: string,
  status: string,
  durationMs: number,
  errorMessage?: string | null,
): void {
  const emoji = status === 'success' ? ':white_check_mark:' : ':x:'
  const color = status === 'success' ? '#36a64f' : '#e01e5a'

  const fields: SlackBlock['fields'] = [
    { type: 'mrkdwn', text: `*Agent:*\n\`${agentId}\`` },
    { type: 'mrkdwn', text: `*Tool:*\n\`${toolName}\`` },
    { type: 'mrkdwn', text: `*Status:*\n${emoji} ${status}` },
    { type: 'mrkdwn', text: `*Duration:*\n${durationMs}ms` },
  ]

  if (errorMessage) {
    fields.push({ type: 'mrkdwn', text: `*Error:*\n\`${errorMessage.slice(0, 200)}\`` })
  }

  postToSlack([
    { type: 'section', fields },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Orchestrator: \`${config.orchestratorId}\`` }],
    },
  ], `${emoji} ${agentId} called ${toolName} → ${status} (${durationMs}ms)`)
}

export function notifyChatMessage(from: string, to: string, message: string): void {
  postToSlack([
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${from}* → *${to}*\n${message.slice(0, 500)}`,
      },
    },
  ], `${from} → ${to}: ${message.slice(0, 100)}`)
}
