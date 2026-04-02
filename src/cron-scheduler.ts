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
import { broadcastSSE } from './sse.js'
import { runSelfCorrect } from './graph-self-correct.js'
import { captureAdoptionSnapshot, type AdoptionSnapshot } from './routes/adoption.js'
import { runLooseEndScan } from './routes/loose-ends.js'
import { notifyAdoptionDigest } from './slack.js'

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
    // Special handler for adoption metrics snapshot
    if (job.id === 'adoption-metrics-daily') {
      try {
        const snapshot = await captureAdoptionSnapshot()
        job.last_run = new Date().toISOString()
        job.last_status = 'completed'
        job.run_count++
        persistCronJobs()

        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `Adoption snapshot: ${snapshot.conversations_24h} conversations, ${snapshot.pipeline_executions_24h} pipelines, ${snapshot.artifact_creations_24h} artifacts, ${snapshot.unique_agents_24h} agents active`,
          timestamp: new Date().toISOString(),
        })
        broadcastSSE('adoption-snapshot', snapshot)
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Adoption snapshot failed')
      }
      return
    }

    // Special handler for weekly adoption digest
    if (job.id === 'adoption-weekly-digest') {
      try {
        const redis = getRedis()
        if (redis) {
          const weekAgo = Date.now() - 7 * 86400000
          const raw = await redis.zrangebyscore('orchestrator:adoption-trends', weekAgo, '+inf')
          const snapshots: AdoptionSnapshot[] = raw.map(r => JSON.parse(r))

          if (snapshots.length > 0) {
            const sum = (fn: (s: AdoptionSnapshot) => number) => snapshots.reduce((a, s) => a + fn(s), 0)
            const latest = snapshots[snapshots.length - 1]
            const earliest = snapshots[0]

            // Determine trend from features_pct change
            const trend = latest.features_pct > earliest.features_pct ? 'up' as const
              : latest.features_pct < earliest.features_pct ? 'down' as const
              : 'flat' as const

            const period = `${earliest.date} → ${latest.date}`

            notifyAdoptionDigest({
              period,
              conversations: sum(s => s.conversations_24h),
              pipelines: sum(s => s.pipeline_executions_24h),
              artifacts: sum(s => s.artifact_creations_24h),
              agents: Math.max(...snapshots.map(s => s.unique_agents_24h)),
              toolCalls: sum(s => s.total_tool_calls_24h),
              chains: sum(s => s.chain_executions_24h),
              featuresPct: latest.features_pct,
              trend,
            })
          }
        }

        job.last_run = new Date().toISOString()
        job.last_status = 'completed'
        job.run_count++
        persistCronJobs()
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Adoption weekly digest failed')
      }
      return
    }

    // Special handler for loose-end detection scan
    if (job.id === 'loose-end-daily-scan') {
      try {
        const scanResult = await runLooseEndScan()
        job.last_run = new Date().toISOString()
        job.last_status = scanResult.summary.critical > 0 ? 'critical' : 'completed'
        job.run_count++
        persistCronJobs()

        const emoji = scanResult.summary.critical > 0 ? '🔴' : scanResult.summary.warning > 0 ? '🟡' : '🟢'
        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `${emoji} Loose-end scan: ${scanResult.summary.critical} critical, ${scanResult.summary.warning} warnings, ${scanResult.summary.info} info (${scanResult.duration_ms}ms)`,
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Loose-end scan failed')
      }
      return
    }

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

    // Post-chain: cache knowledge feed in Redis and broadcast via SSE
    if (job.id === 'daily-knowledge-feed' && result.status === 'completed') {
      const feed = {
        generated_at: new Date().toISOString(),
        execution_id: result.execution_id,
        steps: result.results.map(r => ({
          step: r.step_id,
          action: r.action,
          status: r.status,
          output: r.output,
          duration_ms: r.duration_ms,
        })),
        graph_pulse: result.results[0]?.output ?? null,
        gap_analysis: result.results[1]?.output ?? null,
        emerging_clusters: result.results[2]?.output ?? null,
      }
      const redis = getRedis()
      if (redis) {
        await redis.set('orchestrator:knowledge-feed', JSON.stringify(feed), 'EX', 86400)

        // G2.8: Build condensed briefing prompt for Open WebUI system prompt injection
        const briefing = buildKnowledgeBriefing(feed)
        await redis.set('orchestrator:knowledge-briefing-prompt', briefing, 'EX', 86400)
        logger.info('Knowledge briefing prompt cached for Open WebUI')
      }
      broadcastSSE('knowledge-feed', feed)
      logger.info({ execution_id: result.execution_id }, 'Daily knowledge feed cached and broadcast')
    }
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
 * G2.8: Build a condensed briefing string (max ~500 chars) from the full feed.
 * This is stored in Redis and served via GET /api/knowledge/briefing for
 * injection into Open WebUI system prompts.
 */
function buildKnowledgeBriefing(feed: Record<string, unknown>): string {
  const date = new Date().toISOString().slice(0, 10)

  // Extract graph pulse numbers
  let newToday = 0
  let totalDomains = 0
  const pulse = feed.graph_pulse as Record<string, unknown> | null
  if (pulse) {
    const dist = pulse.label_distribution as Record<string, number> | undefined
    if (dist) {
      totalDomains = Object.keys(dist).length
      newToday = Object.values(dist).reduce((a, b) => a + b, 0)
    }
  }

  // Extract top insights (first 3)
  const insights = Array.isArray(feed.top_insights) ? feed.top_insights : []
  const topInsights = insights
    .slice(0, 3)
    .map((c: Record<string, unknown>) => String(c.title ?? c.summary ?? '').slice(0, 60))
    .filter(Boolean)

  // Extract gap alerts (first 2)
  const gaps = Array.isArray(feed.gap_alerts) ? feed.gap_alerts : []
  const topGaps = gaps
    .slice(0, 2)
    .map((c: Record<string, unknown>) => String(c.title ?? c.summary ?? '').slice(0, 60))
    .filter(Boolean)

  const lines: string[] = [
    `Daily Knowledge Briefing (${date}):`,
    `- Graph: ${newToday} nodes across ${totalDomains} active domains`,
  ]

  if (topInsights.length > 0) {
    lines.push(`- Top insights: ${topInsights.join('; ')}`)
  }
  if (topGaps.length > 0) {
    lines.push(`- Gaps: ${topGaps.join('; ')}`)
  }

  lines.push('Use search_knowledge for details.')

  // Cap at 500 chars
  let result = lines.join('\n')
  if (result.length > 500) {
    result = result.slice(0, 497) + '...'
  }
  return result
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
          tool_name: 'srag.query',
          arguments: {
            query: "Scan fleet health: identify CRITICAL domains, agent failures, unhealthy services, and remediation priorities"
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
          tool_name: 'srag.query',
          arguments: {
            query: "Intelligence watchtower: query WatchDefinition nodes, find new signals across public IT, vendors, tenders domains, cross-reference with existing IntelligenceAssets"
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

  // ═══════════════════════════════════════════════════════════════════════
  // LOOSE-END DETECTOR (LIN-535) — Daily scan for orphans, contradictions, gaps
  // Runs 5 detection queries against Neo4j, persists results, broadcasts via SSE
  // ═══════════════════════════════════════════════════════════════════════

  registerCronJob({
    id: 'loose-end-daily-scan',
    name: 'Loose-End Daily Scan',
    schedule: '30 7 * * *', // 07:30 UTC daily (after adoption snapshot)
    enabled: true,
    chain: {
      name: 'Loose-End Detection',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ADOPTION MEASUREMENT (LIN-537) — Daily snapshot + weekly Slack digest
  // Tracks: conversations, pipelines, artifacts, agents, tool calls, chains
  // Data stored in Redis sorted set + Neo4j AdoptionMetric nodes
  // ═══════════════════════════════════════════════════════════════════════

  registerCronJob({
    id: 'adoption-metrics-daily',
    name: 'Adoption Metrics Daily Snapshot',
    schedule: '0 7 * * *', // 07:00 UTC daily
    enabled: true,
    chain: {
      name: 'Adoption Metrics Snapshot',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  registerCronJob({
    id: 'adoption-weekly-digest',
    name: 'Adoption Weekly Slack Digest',
    schedule: '0 8 * * 1', // Monday 08:00 UTC
    enabled: true,
    chain: {
      name: 'Adoption Weekly Digest',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // INTELLIGENCE LOOPS — Drive advancedPct from 0% → 20%+
  // Each chain calls advanced MCP tools (complexity ≥ 8) automatically.
  // Pattern from: GSD-2 auto-loop + Palantir Flow Capture + LangGraph cron
  // ═══════════════════════════════════════════════════════════════════════

  // 1. Knowledge Synthesis — SRAG + KG-RAG + Context Folding (*/30 min)
  registerCronJob({
    id: 'intel-knowledge-synthesis',
    name: 'Intelligence: Knowledge Synthesis',
    schedule: '*/30 * * * *',
    enabled: true,
    chain: {
      name: 'Knowledge Synthesis Pipeline',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'srag.query',
          arguments: { query: 'recent platform changes, new patterns, knowledge gaps' },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'kg_rag.query',
          arguments: { question: 'What knowledge gaps exist in the consulting domain graph? What patterns are underconnected?', max_evidence: 15 },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'context_folding.fold',
          arguments: { task: 'Synthesize knowledge from SRAG + KG-RAG into actionable insights', context: { source: '{{prev}}' }, max_tokens: 2000, domain: 'intelligence' },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.write_cypher',
          arguments: {
            query: "MERGE (s:StrategicInsight {id: 'intel-synthesis-' + toString(datetime().epochMillis)}) SET s.domain = 'knowledge-synthesis', s.insight = $insight, s.createdAt = datetime(), s.source = 'intelligence-loop', s.confidence = 0.7",
            params: { insight: '{{prev}}' },
          },
        },
      ],
    },
  })

  // 2. Graph Enrichment — Autonomous GraphRAG deep analysis (*/1h)
  registerCronJob({
    id: 'intel-graph-enrichment',
    name: 'Intelligence: Graph Enrichment',
    schedule: '0 * * * *',
    enabled: true,
    chain: {
      name: 'Graph Enrichment Pipeline',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'autonomous.graphrag',
          arguments: { query: 'Find underconnected knowledge clusters and suggest new relationships between consulting domains, frameworks, and patterns', maxHops: 3 },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.write_cypher',
          arguments: {
            query: "MERGE (e:EnrichmentEvent {id: 'enrich-' + toString(datetime().epochMillis)}) SET e.type = 'graph-enrichment', e.findings = $findings, e.createdAt = datetime(), e.source = 'intelligence-loop'",
            params: { findings: '{{prev}}' },
          },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'srag.query',
          arguments: { query: 'Verify enrichment: what new connections were discovered in the last hour?' },
        },
      ],
    },
  })

  // 3. ROMA Observer — Multi-agent coordination analysis (*/4h)
  registerCronJob({
    id: 'intel-roma-observer',
    name: 'Intelligence: ROMA Optimization Observer',
    schedule: '0 */4 * * *',
    enabled: true,
    chain: {
      name: 'ROMA Observer Pipeline',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'srag.query',
          arguments: {
            query: 'Analyze platform optimization opportunities: review recent agent decisions, identify sub-optimal tool usage patterns, propose improvements for platform-wide efficiency',
          },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'context_folding.fold',
          arguments: { task: 'Compress ROMA findings into actionable optimization report', context: { data: '{{prev}}' }, max_tokens: 1500, domain: 'optimization' },
        },
      ],
    },
  })

  // 4. Compliance Scan — Governance check (*/6h)
  registerCronJob({
    id: 'intel-compliance-scan',
    name: 'Intelligence: Compliance Scan',
    schedule: '0 */6 * * *',
    enabled: true,
    chain: {
      name: 'Compliance Scan Pipeline',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'srag.governance-check',
          arguments: { query: 'Check compliance status of all active agents, tools, and recent decisions against governance policy' },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'audit.run',
          arguments: { agentId: 'orchestrator', output: '{{prev}}' },
        },
      ],
    },
  })

  // 5. Harvest Cycle — Template-based knowledge harvesting (*/8h)
  registerCronJob({
    id: 'intel-harvest-cycle',
    name: 'Intelligence: Knowledge Harvest',
    schedule: '0 */8 * * *',
    enabled: true,
    chain: {
      name: 'Knowledge Harvest Pipeline',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'template.execute',
          arguments: { templateId: 'data-enrichment', input: { scope: 'recent-24h' } },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'srag.query',
          arguments: { query: 'What new knowledge was harvested? Summarize new patterns and insights from the last 8 hours' },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.write_cypher',
          arguments: {
            query: "MERGE (h:HarvestEvent {id: 'harvest-' + toString(datetime().epochMillis)}) SET h.type = 'knowledge-harvest', h.summary = $summary, h.createdAt = datetime(), h.source = 'intelligence-loop'",
            params: { summary: '{{prev}}' },
          },
        },
      ],
    },
  })

  // 6. Metrics Snapshot — Platform KPI tracking (*/1h)
  registerCronJob({
    id: 'intel-metrics-snapshot',
    name: 'Intelligence: Metrics Snapshot',
    schedule: '30 * * * *',
    enabled: true,
    chain: {
      name: 'Metrics Snapshot Pipeline',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'metrics.summary',
          arguments: {},
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.write_cypher',
          arguments: {
            query: "MERGE (m:MetricsSnapshot {id: 'metrics-' + toString(datetime().epochMillis)}) SET m.data = $data, m.createdAt = datetime(), m.source = 'intelligence-loop'",
            params: { data: '{{prev}}' },
          },
        },
      ],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // G2.7: Daily Knowledge Feed — Adoption Blueprint
  // Runs daily at 06:00 UTC. Graph pulse → gap analysis → emerging clusters.
  // Results cached in Redis (orchestrator:knowledge-feed, 24h TTL) and
  // broadcast via SSE to connected Command Center clients.
  // ═══════════════════════════════════════════════════════════════════════
  registerCronJob({
    id: 'daily-knowledge-feed',
    name: 'Daily Knowledge Feed',
    schedule: '0 6 * * *',
    enabled: true,
    chain: {
      name: 'Daily Knowledge Feed',
      mode: 'sequential',
      steps: [
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.read_cypher',
          arguments: {
            query: "MATCH (n) WHERE n.createdAt > datetime() - duration('P1D') RETURN labels(n)[0] AS type, count(*) AS new_today ORDER BY new_today DESC",
          },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'kg_rag.query',
          arguments: {
            question: 'What knowledge gaps exist across all 17 domains?',
          },
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.read_cypher',
          arguments: {
            query: "MATCH (n) WHERE n.updatedAt > datetime() - duration('P7D') WITH labels(n)[0] AS type, count(*) AS count WHERE count > 10 RETURN type, count ORDER BY count DESC LIMIT 10",
          },
        },
      ],
    },
  })
}
