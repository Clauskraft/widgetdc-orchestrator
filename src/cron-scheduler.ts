/**
 * cron-scheduler.ts — Cron-based agent loop scheduler.
 *
 * Replaces OpenClaw's cron system with a centralized, visible scheduler
 * that runs agent chains on schedule and persists results.
 */
import cron from 'node-cron'
import { executeChain, type ChainDefinition } from './chain-engine.js'
import { logger } from './logger.js'
import { getRedis } from './redis.js'
import { broadcastMessage } from './chat-broadcaster.js'
import { runSelfCorrect } from './graph-self-correct.js'

interface CronJob {
  id: string
  name: string
  schedule: string
  chain: ChainDefinition
  enabled: boolean
  last_run?: string
  last_status?: string
  run_count: number
}

const jobs = new Map<string, CronJob>()
const cronTasks = new Map<string, cron.ScheduledTask>()

const REDIS_CRON_KEY = 'orchestrator:cron-jobs'

/**
 * Register a cron job that executes an agent chain on schedule.
 */
export function registerCronJob(job: Omit<CronJob, 'run_count'>): void {
  if (!cron.validate(job.schedule)) {
    throw new Error(`Invalid cron schedule: ${job.schedule}`)
  }

  // Stop existing task if re-registering
  const existing = cronTasks.get(job.id)
  if (existing) existing.stop()

  const cronJob: CronJob = { ...job, run_count: 0 }
  jobs.set(job.id, cronJob)

  if (job.enabled) {
    const task = cron.schedule(job.schedule, async () => {
      await runCronJob(job.id)
    })
    cronTasks.set(job.id, task)
  }

  persistCronJobs()
  logger.info({ id: job.id, schedule: job.schedule, enabled: job.enabled }, 'Cron job registered')
}

/**
 * Run a cron job immediately (manual trigger or scheduled).
 */
export async function runCronJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) {
    logger.warn({ id: jobId }, 'Cron job not found')
    return
  }

  logger.info({ id: job.id, name: job.name }, 'Cron job triggered')

  broadcastMessage({
    from: 'Orchestrator',
    to: 'All',
    source: 'orchestrator',
    type: 'Message',
    message: `Cron "${job.name}" triggered (${job.schedule})`,
    timestamp: new Date().toISOString(),
  })

  try {
    // Special handler for self-correcting graph agent
    if (job.id === 'graph-self-correct') {
      const report = await runSelfCorrect()
      job.last_run = new Date().toISOString()
      job.last_status = report.total_fixed > 0 ? 'corrected' : 'clean'
      job.run_count++
      persistCronJobs()

      broadcastMessage({
        from: 'Orchestrator',
        to: 'All',
        source: 'orchestrator',
        type: 'Message',
        message: `Self-correct: found ${report.total_found} issues, fixed ${report.total_fixed} (${report.duration_ms}ms)`,
        timestamp: new Date().toISOString(),
      })
      return
    }

    const result = await executeChain(job.chain)
    job.last_run = new Date().toISOString()
    job.last_status = result.status
    job.run_count++
    persistCronJobs()
  } catch (err) {
    job.last_run = new Date().toISOString()
    job.last_status = 'failed'
    job.run_count++
    persistCronJobs()
    logger.error({ id: job.id, err: String(err) }, 'Cron job failed')
  }
}

/**
 * Enable/disable a cron job.
 */
export function setCronJobEnabled(jobId: string, enabled: boolean): boolean {
  const job = jobs.get(jobId)
  if (!job) return false

  job.enabled = enabled

  const existing = cronTasks.get(jobId)
  if (existing) existing.stop()

  if (enabled) {
    const task = cron.schedule(job.schedule, async () => {
      await runCronJob(jobId)
    })
    cronTasks.set(jobId, task)
  } else {
    cronTasks.delete(jobId)
  }

  persistCronJobs()
  logger.info({ id: jobId, enabled }, 'Cron job toggled')
  return true
}

/**
 * List all registered cron jobs.
 */
export function listCronJobs(): CronJob[] {
  return Array.from(jobs.values())
}

/**
 * Delete a cron job.
 */
export function deleteCronJob(jobId: string): boolean {
  const task = cronTasks.get(jobId)
  if (task) task.stop()
  cronTasks.delete(jobId)
  const deleted = jobs.delete(jobId)
  if (deleted) persistCronJobs()
  return deleted
}

/**
 * Persist cron job configs to Redis.
 */
function persistCronJobs(): void {
  const redis = getRedis()
  if (!redis) return
  const data = Array.from(jobs.values()).map(j => ({
    ...j,
    // Don't persist the chain's runtime state, just config
  }))
  redis.set(REDIS_CRON_KEY, JSON.stringify(data)).catch(() => {})
}

/**
 * Hydrate cron jobs from Redis on startup.
 */
export async function hydrateCronJobs(): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  try {
    const raw = await redis.get(REDIS_CRON_KEY)
    if (!raw) return

    const savedJobs: CronJob[] = JSON.parse(raw)
    for (const job of savedJobs) {
      registerCronJob(job)
    }
    logger.info({ count: savedJobs.length }, 'Hydrated cron jobs from Redis')
  } catch (err) {
    logger.warn({ err: String(err) }, 'Failed to hydrate cron jobs')
  }
}

/**
 * Register default platform health loops.
 */
export function registerDefaultLoops(): void {
  // Health check every 5 minutes
  registerCronJob({
    id: 'health-pulse',
    name: 'Platform Health Pulse',
    schedule: '*/5 * * * *',
    enabled: true,
    chain: {
      name: 'Health Pulse',
      mode: 'parallel',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.stats',
          arguments: {},
        },
      ],
    },
  })

  // Graph consistency check every 30 minutes
  registerCronJob({
    id: 'graph-check',
    name: 'Neo4j Graph Consistency',
    schedule: '*/30 * * * *',
    enabled: false, // disabled by default — enable via API
    chain: {
      name: 'Graph Consistency',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.read_cypher',
          arguments: {
            query: 'MATCH (n) RETURN labels(n) AS label, count(*) AS count ORDER BY count DESC LIMIT 20',
          },
        },
      ],
    },
  })

  // Failure memory digest — surfaces recent failure patterns every 6 hours
  registerCronJob({
    id: 'failure-digest',
    name: 'FailureMemory Digest',
    schedule: '0 */6 * * *',
    enabled: true,
    chain: {
      name: 'Failure Digest',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.read_cypher',
          arguments: {
            query: "MATCH (f:FailureMemory) WHERE f.last_seen > datetime() - duration('PT6H') OR f.created_at > datetime() - duration('PT6H') RETURN f.category AS category, f.pattern AS pattern, f.hit_count AS hits, f.resolution AS resolution ORDER BY f.hit_count DESC LIMIT 10",
          },
        },
      ],
    },
  })

  // Self-correcting graph agent — detects and fixes inconsistencies every 2 hours
  registerCronJob({
    id: 'graph-self-correct',
    name: 'Self-Correcting Graph Agent',
    schedule: '0 */2 * * *',
    enabled: true,
    chain: {
      name: 'Graph Self-Correct',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.read_cypher',
          arguments: {
            query: "MATCH (n) WHERE NOT (n)-[]-() AND NOT n:TDCDocument RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC LIMIT 10",
          },
        },
      ],
    },
  })

  // CIA Guardian Loop — monitors fleet health and triggers autonomous remediation
  registerCronJob({
    id: 'cia-guardian',
    name: 'CIA Guardian (Autonomous Remediation)',
    schedule: '*/10 * * * *',
    enabled: true,
    chain: {
      name: 'CIA Health Scan',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'llm.generate',
          arguments: {
            prompt: "Scan fleet health and identify CRITICAL domains for remediation. Use /api/intelligence/fleet-health."
          },
        },
      ],
    },
  })

  // Dynamic Watchtower — scans all topics defined in :WatchDefinition (Public IT, Vendors, Tenders)
  registerCronJob({
    id: 'dynamic-watchtower',
    name: 'Intelligence Watchtower (Multi-Domain)',
    schedule: '0 */4 * * *', // Every 4 hours
    enabled: true,
    chain: {
      name: 'Dynamic Intelligence Pipeline',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'llm.generate',
          arguments: {
            prompt: "1. Trigger FileSystemHarvester to index local data (D:/Intel, Downloads). 2. Query Neo4j for all :WatchDefinition nodes. 3. For each watch, use osint.search to find signals. 4. Cross-reference new signals with local IntelligenceAssets. 5. Format as IntelligenceObservation and score via /api/intelligence/observation/score."
          },
        },
      ],
    },
  })

  // DEPRECATED (LIN-380): Evolution tracking consolidated into WidgeTDC graphSelfHealingCron R7.
  // Kept as disabled reference; remove after verifying WidgeTDC cron covers same metrics.
  registerCronJob({
    id: 'evolution-tracker',
    name: 'Evolution Event Tracker (DEPRECATED — see LIN-380)',
    schedule: '0 * * * *',
    enabled: false,
    chain: {
      name: 'Evolution Tracker',
      mode: 'parallel',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.read_cypher',
          arguments: {
            query: "MATCH (e:EvolutionEvent) WHERE e.timestamp > datetime() - duration('PT24H') RETURN avg(toFloat(e.pass_rate)) AS avg_pass_rate, count(e) AS events_24h, max(e.timestamp) AS latest",
          },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.read_cypher',
          arguments: {
            query: "MATCH (f:FailureMemory) RETURN count(f) AS total_failures, sum(f.hit_count) AS total_hits",
          },
        },
      ],
    },
  })
}
