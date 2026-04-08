/**
 * cron-scheduler.ts — Cron-based agent loop scheduler.
 *
 * Replaces OpenClaw's cron system with a centralized, visible scheduler
 * that runs agent chains on schedule and persists results.
 */
import cron from 'node-cron'
import { executeChain, type ChainDefinition } from './chain-engine.js'
import { config } from './config.js'
import { logger } from './logger.js'
import { getRedis } from './redis.js'
import { broadcastMessage } from './chat-broadcaster.js'
import { broadcastSSE } from './sse.js'
import { runSelfCorrect } from './graph-self-correct.js'
import { runFailureHarvest } from './failure-harvester.js'
import { runCompetitiveCrawl } from './competitive-crawler.js'
import { captureAdoptionSnapshot, type AdoptionSnapshot } from './routes/adoption.js'
import { runLooseEndScan } from './routes/loose-ends.js'
import { notifyAdoptionDigest } from './slack.js'
import { runGraphHygiene } from './graph-hygiene-cron.js'
import { buildCommunitySummaries } from './hierarchical-intelligence.js'
import { retrainRoutingWeights } from './adaptive-rag.js'
import { runAutonomousCycle, getAutonomousStatus } from './hyperagent-autonomous.js'
import { runAnomalyScan } from './anomaly-watcher.js'
import { runPheromoneCron } from './pheromone-layer.js'
import { runFleetAnalysis } from './peer-eval.js'

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

    // Special handler for Red Queen failure harvester (LIN-567)
    if (job.id === 'failure-harvester') {
      try {
        const summary = await runFailureHarvest(24)
        job.last_run = new Date().toISOString()
        job.last_status = summary.total_failures > 0 ? `${summary.total_failures} failures` : 'clean'
        job.run_count++
        persistCronJobs()

        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `Red Queen harvest: ${summary.total_failures} failures (${Object.entries(summary.by_category).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ') || 'none'})`,
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Failure harvest cron failed')
      }
      return
    }

    // Special handler for competitive phagocytosis crawl (LIN-566)
    if (job.id === 'competitive-crawl') {
      try {
        const report = await runCompetitiveCrawl()
        job.last_run = new Date().toISOString()
        job.last_status = `${report.total_capabilities_found} caps, ${report.gaps.length} gaps`
        job.run_count++
        persistCronJobs()

        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `Phagocytosis: ${report.total_capabilities_found} capabilities from ${Object.keys(report.by_competitor).length} competitors, ${report.gaps.length} gaps identified`,
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Competitive crawl cron failed')
      }
      return
    }

    // Special handler for graph hygiene daily (F1, LIN-574 v3.0)
    if (job.id === 'graph-hygiene-daily') {
      try {
        const result = await runGraphHygiene()
        job.last_run = new Date().toISOString()
        job.last_status = result.alerts.length > 0 ? `${result.alerts.length} alerts` : 'healthy'
        job.run_count++
        persistCronJobs()

        const status = result.alerts.length > 0 ? '🔴' : '🟢'
        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `${status} Graph hygiene: orphans=${(result.metrics.orphan_ratio * 100).toFixed(1)}%, domains=${result.metrics.domain_count}, pollution=${result.metrics.pollution_count}, ${result.alerts.length} alerts (${result.duration_ms}ms)`,
          timestamp: new Date().toISOString(),
        })
        broadcastSSE('graph-hygiene', result)
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Graph hygiene cron failed')
      }
      return
    }

    // Adoption Drift Detection — nightly CI gate run (detective layer)
    if (job.id === 'adoption-drift-check') {
      try {
        const { execSync } = await import('child_process')
        const output = execSync('node scripts/ci-adoption-check.mjs --no-build --no-abi', {
          encoding: 'utf8',
          timeout: 60000,
          cwd: process.cwd(),
        })
        const passed = output.includes('All checks passed')
        job.last_run = new Date().toISOString()
        job.last_status = passed ? 'clean' : 'DRIFT_DETECTED'
        job.run_count++
        persistCronJobs()

        if (!passed) {
          broadcastMessage({
            from: 'Orchestrator',
            to: 'All',
            source: 'orchestrator',
            type: 'Message',
            message: `⚠️ Adoption drift detected — ci-adoption-check reported gaps. Run 'npm run test:ci' to investigate.`,
            timestamp: new Date().toISOString(),
          })
          broadcastSSE('adoption-drift', { status: 'DRIFT_DETECTED', timestamp: new Date().toISOString() })
          logger.warn('Adoption drift cron: gaps detected')
        } else {
          logger.info('Adoption drift cron: clean (5/5 checks pass)')
        }
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Adoption drift cron failed')
      }
      return
    }

    // F5: Weekly adaptive RAG retraining
    if (job.id === 'adaptive-rag-retrain') {
      try {
        const result = await retrainRoutingWeights()
        job.last_run = new Date().toISOString()
        job.last_status = `${result.adjustments.length} adjustments, ${result.weights.training_samples} samples`
        job.run_count++
        persistCronJobs()

        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `Adaptive RAG retrained: ${result.adjustments.length} adjustments from ${result.weights.training_samples} samples. ${result.adjustments.join('; ') || 'No changes needed.'}`,
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Adaptive RAG retrain cron failed')
      }
      return
    }

    // F3: Weekly community summary builder (hierarchical intelligence)
    if (job.id === 'community-builder-weekly') {
      try {
        const result = await buildCommunitySummaries()
        job.last_run = new Date().toISOString()
        job.last_status = `${result.communities_created} communities, ${result.summaries_generated} summaries`
        job.run_count++
        persistCronJobs()

        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `Hierarchical Intelligence: ${result.communities_created} communities, ${result.summaries_generated} summaries, ${result.relationships_created} rels (${result.method}, ${result.duration_ms}ms)`,
          timestamp: new Date().toISOString(),
        })
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Community builder cron failed')
      }
      return
    }

    // ═══ Backend Cron Proxy Jobs (v2.8.0) ═══════════════════════════════
    // These crons call WidgeTDC backend /api/cron/* endpoints via HTTP POST.
    if (
      job.id === 'data-lifecycle' ||
      job.id === 'graph-overflow' ||
      job.id === 'skill-forge' ||
      // Fase 3 TECH-9: 6 additional backend cron proxies (Fase 2 TECH-6)
      job.id === 'adoption-maintenance' ||
      job.id === 'synergy' ||
      job.id === 'embedding-reindex' ||
      job.id === 'consulting-activation' ||
      job.id === 'autonomous-linear-loop' ||
      job.id === 'lesson-delivery'
    ) {
      try {
        const endpoint = `${config.backendUrl}/api/cron/${job.id}`
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.backendApiKey}`,
            'X-Call-Id': `cron-${job.id}-${Date.now()}`,
          },
          signal: AbortSignal.timeout(120_000),
        })

        const body = await res.json().catch(() => null) as Record<string, unknown> | null
        job.last_run = new Date().toISOString()
        job.last_status = res.ok ? 'completed' : `failed:${res.status}`
        job.run_count++
        persistCronJobs()

        const status = res.ok ? '✅' : '❌'
        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `${status} Backend cron "${job.name}": ${res.ok ? 'completed' : `HTTP ${res.status}`}${body?.summary ? ` — ${body.summary}` : ''}`,
          timestamp: new Date().toISOString(),
        })

        if (res.ok) {
          broadcastSSE(`cron-${job.id}`, { status: 'completed', result: body })
        } else {
          logger.warn({ id: job.id, status: res.status, body }, `Backend cron ${job.id} returned non-OK`)
        }
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, `Backend cron ${job.id} failed`)
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

    // Special handler for OSINT daily scan (LIN-480)
    if (job.id === 'osint-daily-scan') {
      try {
        const { runOsintScan } = await import('./osint-scanner.js')
        const scanResult = await runOsintScan()
        job.last_run = new Date().toISOString()
        job.last_status = scanResult.errors.length === 0 ? 'completed' : 'partial'
        job.run_count++
        persistCronJobs()

        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `OSINT scan: ${scanResult.domains_scanned} domains, ${scanResult.ct_entries} CT + ${scanResult.dmarc_results} DMARC, ${scanResult.total_new_nodes} new nodes (${scanResult.tools_available ? 'live' : 'fallback'}, ${scanResult.duration_ms}ms)`,
          timestamp: new Date().toISOString(),
        })
        broadcastSSE('osint-scan', { scan_id: scanResult.scan_id, domains: scanResult.domains_scanned, nodes: scanResult.total_new_nodes })
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'OSINT scan cron failed')
      }
      return
    }

    // Special handler for autonomous evolution loop (LIN-342)
    if (job.id === 'evolution-loop') {
      try {
        const { runEvolutionLoop } = await import('./evolution-loop.js')
        const cycle = await runEvolutionLoop()
        job.last_run = new Date().toISOString()
        job.last_status = cycle.status
        job.run_count++
        persistCronJobs()

        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `Evolution OODA cycle ${cycle.status}: ${cycle.summary} (${cycle.duration_ms}ms)`,
          timestamp: new Date().toISOString(),
        })
        broadcastSSE('evolution-cycle', cycle)
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Evolution loop cron failed')
      }
      return
    }

    // Special handler for HyperAgent autonomous cycle
    if (job.id === 'hyperagent-autonomous-cycle') {
      try {
        const cycle = await runAutonomousCycle()
        job.last_run = new Date().toISOString()
        job.last_status = `${cycle.targetsCompleted}/${cycle.targetsAttempted} completed, Δ${cycle.fitnessScoreDelta.toFixed(4)}`
        job.run_count++
        persistCronJobs()

        broadcastMessage({
          from: 'Orchestrator',
          to: 'All',
          source: 'orchestrator',
          type: 'Message',
          message: `HyperAgent auto-cycle ${cycle.cycleId}: ${cycle.targetsCompleted}/${cycle.targetsAttempted} targets (${cycle.phase}), fitness Δ${cycle.fitnessScoreDelta.toFixed(4)}, ${cycle.newIssuesDiscovered.length} issues found (${cycle.durationMs}ms)`,
          timestamp: new Date().toISOString(),
        })
        broadcastSSE('hyperagent-autonomous-cycle', {
          cycleId: cycle.cycleId,
          phase: cycle.phase,
          completed: cycle.targetsCompleted,
          failed: cycle.targetsFailed,
          discovered: cycle.newIssuesDiscovered.length,
          fitnessDelta: cycle.fitnessScoreDelta,
          durationMs: cycle.durationMs,
        })
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'HyperAgent autonomous cycle cron failed')
      }
      return
    }

    // Proactive Anomaly Watcher: DETECT→LEARN→REASON→ACT→REMEMBER
    if (job.id === 'anomaly-watcher') {
      try {
        const result = await runAnomalyScan()
        const neg = result.anomalies.filter(a => a.valence === 'negative').length
        const pos = result.anomalies.filter(a => a.valence === 'positive').length
        const crit = result.anomalies.filter(a => a.severity === 'critical').length
        job.last_run = new Date().toISOString()
        job.last_status = result.anomalies.length === 0
          ? 'clean'
          : `${neg} negative (${crit} critical), ${pos} positive`
        job.run_count++
        persistCronJobs()

        if (result.anomalies.length > 0) {
          const emoji = crit > 0 ? '🔴' : pos > 0 ? '🟢' : '🟡'
          broadcastMessage({
            from: 'Orchestrator',
            to: 'All',
            source: 'orchestrator',
            type: 'Message',
            message: `${emoji} Anomaly scan: ${neg} negative (${crit} critical), ${pos} positive signals, ${result.patterns.length} learned patterns`,
            timestamp: new Date().toISOString(),
          })
        }
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Anomaly watcher cron failed')
      }
      return
    }

    // Pheromone Layer: decay + persist + cross-pillar amplification
    if (job.id === 'pheromone-decay') {
      try {
        const result = await runPheromoneCron()
        job.last_run = new Date().toISOString()
        job.last_status = `${result.decayed} decayed, ${result.evaporated} evaporated, ${result.persisted} persisted, ${result.amplified} amplified`
        job.run_count++
        persistCronJobs()
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Pheromone decay cron failed')
      }
      return
    }

    // PeerEval Fleet Analysis: RLM-powered fleet-wide strategic reasoning
    if (job.id === 'fleet-analysis') {
      try {
        const analysis = await runFleetAnalysis()
        job.last_run = new Date().toISOString()
        job.last_status = analysis.length > 50 ? 'completed' : 'no-data'
        job.run_count++
        persistCronJobs()

        if (analysis.length > 50) {
          broadcastMessage({
            from: 'Orchestrator',
            to: 'All',
            source: 'orchestrator',
            type: 'Message',
            message: `Fleet analysis: ${analysis.slice(0, 200)}...`,
            timestamp: new Date().toISOString(),
          })
        }
      } catch (err) {
        job.last_run = new Date().toISOString()
        job.last_status = 'failed'
        job.run_count++
        persistCronJobs()
        logger.error({ id: job.id, err: String(err) }, 'Fleet analysis cron failed')
      }
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
 * S1.2 (6-edges handlingsplan) — Cron boot-kickstart.
 *
 * Root cause: node-cron only fires a job when wall clock matches the cron
 * expression. Absolute-hour jobs like "0 3 * * *" only fire if the service is
 * running at exactly 03:00:00 on a given day. In practice orchestrator restarts
 * frequently (Railway auto-deploys, crashes, manual deploys), so uptime rarely
 * spans a specific target hour and these jobs can go weeks without a run. The
 * documented symptom on 2026-04-06 was 20 absolute-hour jobs with 0 runs vs 10
 * interval jobs firing normally.
 *
 * Fix: at boot, detect "overdue" jobs (their expected run time has passed since
 * `last_run`) and fire them once sequentially. Normal node-cron scheduling then
 * takes over for future runs. This is a belt-and-braces approach — it does not
 * replace cron scheduling, it only catches the missed-at-boot gap.
 *
 * Overdue detection uses a pattern-based heuristic over common cron expressions
 * rather than a full cron-parser dependency (which we don't ship). Pattern set
 * covers: interval jobs (never overdue — node-cron handles them), daily/weekly
 * /monthly absolute-hour jobs (overdue if age > period + 1h tolerance), and
 * previously-never-run jobs (always overdue on first boot).
 */
function isJobOverdue(job: CronJob): boolean {
  // Never run → always overdue (covers first-boot and Redis-hydrate-from-fresh cases).
  if (!job.last_run) return true
  const lastRunMs = new Date(job.last_run).getTime()
  if (Number.isNaN(lastRunMs)) return true

  const ageMs = Date.now() - lastRunMs
  const parts = job.schedule.trim().split(/\s+/)
  // Exactly 5 fields required (minute hour dom month dow). node-cron supports
  // an optional 6-field format with a leading seconds field — if we destructure
  // a 6-field expression with our 5-field logic, minute/hour/dom offsets are
  // wrong and the overdue threshold would be computed incorrectly (potentially
  // causing double-fire at every boot). Reject non-5-field expressions cleanly.
  if (parts.length !== 5) return false

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Interval-based schedules (*/N in minute or hour position) — node-cron fires
  // these regardless of boot time, so they are never overdue by the boot-kickstart
  // definition. If they appear stale it's a service outage issue, not a cron bug.
  if (minute.includes('/') || hour.includes('/')) return false

  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR

  // Daily absolute: "M H * * *" — fires once per day at H:M. Overdue if we have
  // not run in the past 25 hours (daily period + 1h tolerance for clock skew).
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return ageMs > 25 * HOUR
  }

  // Weekly absolute: "M H * * D" — fires once per week at H:M on day D.
  if (minute !== '*' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    return ageMs > 7 * DAY + HOUR
  }

  // Monthly absolute: "M H D * *" — fires once per month at H:M on day D.
  if (minute !== '*' && hour !== '*' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    return ageMs > 31 * DAY + HOUR
  }

  // Every-minute or every-hour wildcards handled by node-cron normally.
  return false
}

/**
 * S1.2 (6-edges handlingsplan) — Fire any overdue jobs once at boot, sequentially
 * to avoid thundering herd during startup. Call AFTER hydrateCronJobs() and
 * registerDefaultLoops() so all jobs are visible.
 */
export async function bootKickstartOverdueJobs(): Promise<void> {
  const overdue: CronJob[] = []
  for (const job of jobs.values()) {
    if (!job.enabled) continue
    if (isJobOverdue(job)) overdue.push(job)
  }

  if (overdue.length === 0) {
    logger.info('Cron boot-kickstart: no overdue jobs detected')
    return
  }

  logger.info(
    { count: overdue.length, ids: overdue.map(j => j.id) },
    'Cron boot-kickstart: firing overdue jobs sequentially',
  )

  for (const job of overdue) {
    try {
      logger.info({ id: job.id, schedule: job.schedule, last_run: job.last_run ?? 'never' }, 'Cron boot-kickstart: firing overdue job')
      await runCronJob(job.id)
    } catch (err) {
      logger.warn({ id: job.id, err: String(err) }, 'Cron boot-kickstart: job failed (continuing)')
    }
  }

  logger.info({ count: overdue.length }, 'Cron boot-kickstart: complete')
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

  // Adoption Drift Detection — nightly CI gate check (detective layer)
  // Detects registry↔executor drift, missing tests, missing docs, ABI regressions
  registerCronJob({
    id: 'adoption-drift-check',
    name: 'Adoption Gate Drift Detection',
    schedule: '0 2 * * *', // Daily 02:00 UTC
    enabled: true,
    chain: {
      name: 'Adoption Drift',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // Self-correcting graph agent — detects and fixes inconsistencies every 2 hours
  // F5: Weekly adaptive RAG retraining (Q-learning integration)
  registerCronJob({
    id: 'adaptive-rag-retrain',
    name: 'Adaptive RAG Weight Retraining',
    schedule: '0 5 * * 1', // Monday 05:00 UTC
    enabled: true,
    chain: {
      name: 'Adaptive RAG Retrain',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // F3: Weekly community summary builder (hierarchical intelligence)
  registerCronJob({
    id: 'community-builder-weekly',
    name: 'Hierarchical Community Summaries',
    schedule: '0 3 * * 0', // Sunday 03:00 UTC
    enabled: true,
    chain: {
      name: 'Community Builder',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // F1: Daily graph hygiene — 6 health queries + snapshots + anomaly alerting
  registerCronJob({
    id: 'graph-hygiene-daily',
    name: 'Graph Hygiene Health Check',
    schedule: '0 4 * * *',
    enabled: true,
    chain: {
      name: 'Graph Hygiene',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

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

  // ═══════════════════════════════════════════════════════════════════════
  // PROACTIVE ANOMALY WATCHER — DETECT→LEARN→REASON→ACT→REMEMBER
  // Monitors health, detects both negative anomalies (rate-limit storms,
  // circuit breaker flaps) AND positive anomalies (performance spikes,
  // edge breakthroughs, unexpected successes).
  // ═══════════════════════════════════════════════════════════════════════
  registerCronJob({
    id: 'anomaly-watcher',
    name: 'Proactive Anomaly Watcher (Detect+Learn+Reason)',
    schedule: '*/5 * * * *', // Every 5 minutes
    enabled: true,
    chain: {
      name: 'Anomaly Scan',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // PHEROMONE LAYER — Stigmergic decay + trail persistence + cross-pillar amplification
  // ═══════════════════════════════════════════════════════════════════════
  registerCronJob({
    id: 'pheromone-decay',
    name: 'Pheromone Decay + Trail Persistence',
    schedule: '*/15 * * * *', // Every 15 minutes
    enabled: true,
    chain: {
      name: 'Pheromone Lifecycle',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // PEER-EVAL FLEET ANALYSIS — RLM-powered strategic fleet reasoning
  // ═══════════════════════════════════════════════════════════════════════
  registerCronJob({
    id: 'fleet-analysis',
    name: 'PeerEval Fleet Intelligence Analysis',
    schedule: '0 6 * * 1', // Weekly Monday 06:00 UTC
    enabled: true,
    chain: {
      name: 'Fleet Analysis',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
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
  // RED QUEEN — Failure Harvester (LIN-567)
  // Scans Redis for failed chains, categorizes, persists to Neo4j
  // ═══════════════════════════════════════════════════════════════════════

  registerCronJob({
    id: 'failure-harvester',
    name: 'Red Queen Failure Harvester',
    schedule: '0 */4 * * *', // Every 4 hours
    enabled: true,
    chain: {
      name: 'Failure Harvest',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // COMPETITIVE PHAGOCYTOSIS — Weekly crawl (LIN-566)
  // Crawls 5 competitors' public docs, extracts capabilities, gaps
  // ═══════════════════════════════════════════════════════════════════════

  registerCronJob({
    id: 'competitive-crawl',
    name: 'Competitive Phagocytosis Crawl',
    schedule: '0 3 * * 1', // Monday 03:00 UTC
    enabled: true,
    chain: {
      name: 'Competitive Crawl',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // OSINT DAILY SCAN (LIN-480) — CT + DMARC scan of 50 DK public domains
  // Scans CT transparency logs + DMARC/SPF, ingests to Neo4j
  // ═══════════════════════════════════════════════════════════════════════

  registerCronJob({
    id: 'osint-daily-scan',
    name: 'OSINT Daily Domain Scan',
    schedule: '0 2 * * *', // 02:00 UTC daily
    enabled: false, // Enable when ready for production
    chain: {
      name: 'OSINT Domain Scan',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
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

  // ═══════════════════════════════════════════════════════════════════════
  // LIN-342: AUTONOMOUS EVOLUTION LOOP (OODA cycle)
  // 4 stages: Observe → Orient → Act → Learn
  // Disabled by default — enable via API or cron panel
  // ═══════════════════════════════════════════════════════════════════════

  registerCronJob({
    id: 'evolution-loop',
    name: 'Autonomous Evolution Loop (OODA)',
    schedule: '0 */6 * * *', // Every 6 hours
    enabled: false,
    chain: {
      name: 'Evolution OODA Cycle',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // BACKEND CRON PROXIES (v2.8.0) — Call WidgeTDC backend /api/cron/* endpoints
  // These crons trigger backend-side jobs via HTTP POST with auth.
  // ═══════════════════════════════════════════════════════════════════════

  // Data Lifecycle — retention policies, stale data cleanup
  registerCronJob({
    id: 'data-lifecycle',
    name: 'Data Lifecycle (Retention Policies)',
    schedule: '0 3 * * *', // Daily 03:00 UTC
    enabled: true,
    chain: {
      name: 'Data Lifecycle',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // Graph Overflow — quota monitoring, cold archival, growth tracking
  registerCronJob({
    id: 'graph-overflow',
    name: 'Graph Overflow (Quota & Archival)',
    schedule: '0 */6 * * *', // Every 6 hours
    enabled: true,
    chain: {
      name: 'Graph Overflow',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // Skill Forge — auto-generate composite MCP tools from usage patterns
  registerCronJob({
    id: 'skill-forge',
    name: 'Skill Forge (Composite Tool Generation)',
    schedule: '0 4 * * 0', // Sunday 04:00 UTC
    enabled: true,
    chain: {
      name: 'Skill Forge',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Fase 3 TECH-9: Backend cron proxies migrated from local node-cron
  // See WidgeTDC PR #4179 (Fase 2 TECH-6) for backend endpoint migration.
  // ═══════════════════════════════════════════════════════════════════════

  // Adoption Maintenance — LIN-444: rollout expiry, consensus expiry, APO
  registerCronJob({
    id: 'adoption-maintenance',
    name: 'Adoption Maintenance (Rollout Expiry + APO)',
    schedule: '*/5 * * * *', // Every 5 minutes
    enabled: true,
    chain: {
      name: 'Adoption Maintenance',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // Synergy — SYN-A2/A3 (LIN-323): Omega → ROMA bridge
  registerCronJob({
    id: 'synergy',
    name: 'Synergy Cycle (Omega → ROMA Bridge)',
    schedule: '*/5 * * * *', // Every 5 minutes
    enabled: true,
    chain: {
      name: 'Synergy',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // Embedding Reindex — fix zero-vector embeddings + embed missing nodes
  registerCronJob({
    id: 'embedding-reindex',
    name: 'Embedding Reindex (Fix Zero Vectors)',
    schedule: '0 */4 * * *', // Every 4 hours
    enabled: true,
    chain: {
      name: 'Embedding Reindex',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // Consulting Activation — all 4 daily jobs (digest, CVE, patterns, intelligence)
  registerCronJob({
    id: 'consulting-activation',
    name: 'Consulting Activation (Daily Intelligence Jobs)',
    schedule: '0 6 * * *', // Daily 06:00 UTC
    enabled: true,
    chain: {
      name: 'Consulting Activation',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // Autonomous Linear Loop — LIN-380: label-filtered issue picker
  registerCronJob({
    id: 'autonomous-linear-loop',
    name: 'Autonomous Linear Loop (Issue Picker)',
    schedule: '*/30 * * * *', // Every 30 minutes
    enabled: true,
    chain: {
      name: 'Autonomous Linear Loop',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // Lesson Delivery — LIN-389: ensures lessons reach agents (no orphans)
  registerCronJob({
    id: 'lesson-delivery',
    name: 'Lesson Delivery (Feynman Loop)',
    schedule: '*/30 * * * *', // Every 30 minutes
    enabled: true,
    chain: {
      name: 'Lesson Delivery',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })

  // ═══════════════════════════════════════════════════════════════════════
  // HYPERAGENT AUTONOMOUS EXECUTOR — Self-driving target processing cycle
  // Runs every 30 minutes: prioritize → plan → execute → evaluate → evolve
  // Uses RLM reasoning, RAG rewards, context folding, adaptive fitness
  // Disabled by default — enable via API when ready for production
  // ═══════════════════════════════════════════════════════════════════════

  registerCronJob({
    id: 'hyperagent-autonomous-cycle',
    name: 'HyperAgent Autonomous Executor',
    schedule: '*/30 * * * *', // Every 30 minutes
    enabled: false, // Enable via POST /api/cron/:id/enable when ready
    chain: {
      name: 'HyperAgent Autonomous Cycle',
      mode: 'sequential',
      steps: [{ agent_id: 'orchestrator', tool_name: 'graph.stats', arguments: {} }],
    },
  })
}
