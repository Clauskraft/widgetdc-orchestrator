import { broadcastMessage } from '../chat-broadcaster.js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { listMemories, retrieveMemory, storeMemory, type MemoryEntry } from '../memory/working-memory.js'
import { broadcastSSE } from '../sse.js'

export interface PlanHealthSnapshot {
  phase: string | null
  milestone: string | null
  in_flight_tasks: number
  blocked_tasks: number
  fitness_latest: number | null
  polled_at: string
}

export interface PlanHealthDelta {
  has_changes: boolean
  in_flight_delta: number
  blocked_delta: number
  fitness_delta: number | null
  phase_changed: boolean
  milestone_changed: boolean
}

export interface PlanHealthPollResult {
  snapshot: PlanHealthSnapshot
  delta: PlanHealthDelta
  linear_identifier: string
  digest_body: string
}

export interface PlanHealthDigestResult {
  linear_identifier: string
  digest_body: string
  polls_scanned: number
}

interface BackendMcpResponse<T = unknown> {
  result?: T
  success?: boolean
  error?: string
}

interface PlanHealthCronDeps {
  fetchImpl?: typeof fetch
  retrieveMemoryImpl?: typeof retrieveMemory
  storeMemoryImpl?: typeof storeMemory
  listMemoriesImpl?: typeof listMemories
  broadcastMessageImpl?: typeof broadcastMessage
  broadcastSseImpl?: typeof broadcastSSE
  now?: () => Date
}

const PLAN_HEALTH_LINEAR_CANDIDATES = ['LIN-DIVINE-SYMBIOSIS', 'LIN-928']
const PLAN_HEALTH_TTL_SECONDS = 7 * 86_400

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value && typeof value === 'object' && 'low' in (value as Record<string, unknown>)) {
    const low = Number((value as { low: unknown }).low)
    return Number.isFinite(low) ? low : null
  }
  return null
}

export function normalizePlanHealthResponse(
  payload: Record<string, unknown> | null | undefined,
  nowIso: string,
): PlanHealthSnapshot {
  return {
    phase: typeof payload?.phase === 'string' ? payload.phase : null,
    milestone: typeof payload?.milestone === 'string' ? payload.milestone : null,
    in_flight_tasks: toNumber(payload?.in_flight_tasks) ?? 0,
    blocked_tasks: toNumber(payload?.blocked_tasks) ?? 0,
    fitness_latest: toNumber(payload?.fitness_latest),
    polled_at: nowIso,
  }
}

export function computePlanHealthDelta(
  previous: PlanHealthSnapshot | null,
  next: PlanHealthSnapshot,
): PlanHealthDelta {
  const inFlightDelta = next.in_flight_tasks - (previous?.in_flight_tasks ?? 0)
  const blockedDelta = next.blocked_tasks - (previous?.blocked_tasks ?? 0)
  const fitnessDelta = previous?.fitness_latest != null && next.fitness_latest != null
    ? Number((next.fitness_latest - previous.fitness_latest).toFixed(4))
    : null
  const phaseChanged = (previous?.phase ?? null) !== next.phase
  const milestoneChanged = (previous?.milestone ?? null) !== next.milestone

  return {
    has_changes: !previous
      || inFlightDelta !== 0
      || blockedDelta !== 0
      || fitnessDelta !== null
      || phaseChanged
      || milestoneChanged,
    in_flight_delta: inFlightDelta,
    blocked_delta: blockedDelta,
    fitness_delta: fitnessDelta,
    phase_changed: phaseChanged,
    milestone_changed: milestoneChanged,
  }
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`
  return `${value}`
}

export function formatPlanHealthPollDigest(snapshot: PlanHealthSnapshot, delta: PlanHealthDelta): string {
  const fitnessLine = snapshot.fitness_latest == null
    ? 'n/a'
    : `${snapshot.fitness_latest}${delta.fitness_delta == null ? '' : ` (Δ ${formatDelta(delta.fitness_delta)})`}`

  return [
    `**divine-symbiosis plan-health poll** (${snapshot.polled_at})`,
    '',
    `Phase: \`${snapshot.phase ?? 'unknown'}\``,
    `Milestone: \`${snapshot.milestone ?? 'unknown'}\``,
    `In-flight tasks: **${snapshot.in_flight_tasks}** (Δ ${formatDelta(delta.in_flight_delta)})`,
    `Blocked tasks: **${snapshot.blocked_tasks}** (Δ ${formatDelta(delta.blocked_delta)})`,
    `Fitness latest: **${fitnessLine}**`,
    `Changes detected: **${delta.has_changes ? 'yes' : 'no'}**`,
    '',
    '_Posted automatically by orchestrator cron `plan-health-poll`._',
  ].join('\n')
}

export function formatPlanHealthDailyDigest(polls: PlanHealthSnapshot[]): string {
  const latest = polls[0] ?? null
  const lines = polls.slice(0, 12).map((poll) =>
    `- ${poll.polled_at}: phase=\`${poll.phase ?? 'unknown'}\`, milestone=\`${poll.milestone ?? 'unknown'}\`, in-flight=${poll.in_flight_tasks}, blocked=${poll.blocked_tasks}, fitness=${poll.fitness_latest ?? 'n/a'}`,
  )

  return [
    `**divine-symbiosis plan-health daily digest** (${new Date().toISOString()})`,
    '',
    `Polls scanned: **${polls.length}**`,
    `Latest phase: \`${latest?.phase ?? 'unknown'}\``,
    `Latest milestone: \`${latest?.milestone ?? 'unknown'}\``,
    `Latest in-flight tasks: **${latest?.in_flight_tasks ?? 0}**`,
    `Latest blocked tasks: **${latest?.blocked_tasks ?? 0}**`,
    `Latest fitness: **${latest?.fitness_latest ?? 'n/a'}**`,
    '',
    '### Recent trajectory',
    lines.join('\n') || '_none_',
    '',
    '_Posted automatically by orchestrator cron `plan-health-digest-daily`._',
  ].join('\n')
}

async function callBackendMcp<T>(
  fetchImpl: typeof fetch,
  tool: string,
  payload: Record<string, unknown>,
): Promise<BackendMcpResponse<T>> {
  const res = await fetchImpl(`${config.backendUrl}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.backendApiKey}`,
    },
    body: JSON.stringify({ tool, payload }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(`Backend MCP ${tool}: HTTP ${res.status}`)
  }

  return res.json() as Promise<BackendMcpResponse<T>>
}

async function resolvePlanHealthLinearIdentifier(fetchImpl: typeof fetch): Promise<string> {
  for (const identifier of PLAN_HEALTH_LINEAR_CANDIDATES) {
    try {
      const result = await callBackendMcp(fetchImpl, 'linear.issue_get', { identifier })
      if (result?.success === false || result?.error) continue
      return identifier
    } catch {
      continue
    }
  }
  return 'LIN-928'
}

async function postLinearComment(
  fetchImpl: typeof fetch,
  identifier: string,
  body: string,
): Promise<void> {
  await callBackendMcp(fetchImpl, 'linear.comment_create', { identifier, body })
}

function unwrapSnapshot(entry: MemoryEntry | null): PlanHealthSnapshot | null {
  const value = entry?.value as { snapshot?: PlanHealthSnapshot } | PlanHealthSnapshot | null
  if (!value) return null
  if (typeof value === 'object' && 'snapshot' in value && value.snapshot) return value.snapshot
  if (typeof value === 'object' && 'in_flight_tasks' in value) return value as PlanHealthSnapshot
  return null
}

export async function runPlanHealthPoll(deps: PlanHealthCronDeps = {}): Promise<PlanHealthPollResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const retrieveMemoryImpl = deps.retrieveMemoryImpl ?? retrieveMemory
  const storeMemoryImpl = deps.storeMemoryImpl ?? storeMemory
  const broadcastMessageImpl = deps.broadcastMessageImpl ?? broadcastMessage
  const broadcastSseImpl = deps.broadcastSseImpl ?? broadcastSSE
  const now = deps.now ?? (() => new Date())
  const polledAt = now().toISOString()

  const response = await fetchImpl(`${config.backendUrl}/api/plan/health`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.backendApiKey}`,
      'X-Call-Id': `cron-plan-health-poll-${Date.now()}`,
    },
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    throw new Error(`Plan health endpoint returned HTTP ${response.status}`)
  }

  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  const snapshot = normalizePlanHealthResponse(body, polledAt)
  const previous = unwrapSnapshot(await retrieveMemoryImpl('orch-cron', 'plan:health:last-poll'))
  const delta = computePlanHealthDelta(previous, snapshot)
  const digestBody = formatPlanHealthPollDigest(snapshot, delta)
  const linearIdentifier = await resolvePlanHealthLinearIdentifier(fetchImpl)

  await storeMemoryImpl('orch-cron', 'plan:health:last-poll', { snapshot, delta }, PLAN_HEALTH_TTL_SECONDS)
  await storeMemoryImpl('orch-cron', `plan:health:poll:${polledAt.replace(/[:.]/g, '-')}`, { snapshot, delta }, PLAN_HEALTH_TTL_SECONDS)
  if (delta.has_changes) {
    await storeMemoryImpl('orch-cron', `plan:health:delta:${polledAt.replace(/[:.]/g, '-')}`, { snapshot, delta }, PLAN_HEALTH_TTL_SECONDS)
  }

  await postLinearComment(fetchImpl, linearIdentifier, digestBody)

  broadcastMessageImpl({
    from: 'Orchestrator',
    to: 'All',
    source: 'orchestrator',
    type: 'Message',
    message: `✅ Plan health poll posted to ${linearIdentifier}: phase=${snapshot.phase ?? 'unknown'}, milestone=${snapshot.milestone ?? 'unknown'}, in-flight=${snapshot.in_flight_tasks}, blocked=${snapshot.blocked_tasks}`,
    timestamp: polledAt,
  })
  broadcastSseImpl('cron-plan-health-poll', { snapshot, delta, linear_identifier: linearIdentifier })

  return { snapshot, delta, linear_identifier: linearIdentifier, digest_body: digestBody }
}

export async function runPlanHealthDailyDigest(deps: PlanHealthCronDeps = {}): Promise<PlanHealthDigestResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const listMemoriesImpl = deps.listMemoriesImpl ?? listMemories
  const storeMemoryImpl = deps.storeMemoryImpl ?? storeMemory
  const now = deps.now ?? (() => new Date())
  const windowStart = now().getTime() - 24 * 3_600_000

  const entries = await listMemoriesImpl('orch-cron')
  const polls = entries
    .filter((entry) => entry.key.startsWith('plan:health:poll:') && new Date(entry.created_at).getTime() >= windowStart)
    .map((entry) => unwrapSnapshot(entry))
    .filter((entry): entry is PlanHealthSnapshot => Boolean(entry))
    .sort((a, b) => b.polled_at.localeCompare(a.polled_at))

  const digestBody = formatPlanHealthDailyDigest(polls)
  const linearIdentifier = await resolvePlanHealthLinearIdentifier(fetchImpl)
  await postLinearComment(fetchImpl, linearIdentifier, digestBody)
  await storeMemoryImpl('orch-cron', 'plan:health:digest:last-run', {
    ran_at: now().toISOString(),
    polls_scanned: polls.length,
    latest_phase: polls[0]?.phase ?? null,
    latest_milestone: polls[0]?.milestone ?? null,
  }, PLAN_HEALTH_TTL_SECONDS)

  return { linear_identifier: linearIdentifier, digest_body: digestBody, polls_scanned: polls.length }
}

export function logPlanHealthFailure(scope: 'poll' | 'digest', error: unknown): void {
  logger.error({ scope, err: String(error) }, 'Plan health cron failed')
}
