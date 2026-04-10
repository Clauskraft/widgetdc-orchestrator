/**
 * prometheus-metrics.ts — Prometheus-compatible metrics endpoint
 *
 * Exposes platform health metrics in Prometheus text exposition format
 * so Grafana Cloud can scrape them directly.
 *
 * Endpoints:
 *   GET /metrics — Prometheus metrics (text/plain)
 *   GET /api/grafana/prometheus — Same, API-path alias
 */
import { Router, Request, Response } from 'express'
import { logger } from '../logger.js'

export const prometheusMetricsRouter = Router()

/** In-memory metric samples (last 5 minutes) */
interface MetricSample {
  name: string
  labels: Record<string, string>
  value: number
  timestamp: number
}

const samples: MetricSample[] = []
const MAX_SAMPLES = 1000

function addSample(name: string, labels: Record<string, string>, value: number): void {
  samples.push({ name, labels, value, timestamp: Date.now() })
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
}

/** Collect current platform metrics */
function collectMetrics(health: Record<string, unknown>): MetricSample[] {
  const now = Date.now()
  const current: MetricSample[] = []

  // Health status
  current.push({
    name: 'widgetdc_health_status',
    labels: { service: String(health.service ?? 'orchestrator') },
    value: health.status === 'healthy' ? 1 : 0,
    timestamp: now,
  })

  // Uptime
  current.push({
    name: 'widgetdc_uptime_seconds',
    labels: {},
    value: Number(health.uptime_seconds ?? 0),
    timestamp: now,
  })

  // Agents
  current.push({
    name: 'widgetdc_agents_registered',
    labels: {},
    value: Number(health.agents_registered ?? 0),
    timestamp: now,
  })

  // WebSocket connections
  current.push({
    name: 'widgetdc_ws_connections',
    labels: {},
    value: Number(health.ws_connections ?? 0),
    timestamp: now,
  })

  // Cron jobs
  current.push({
    name: 'widgetdc_cron_jobs',
    labels: {},
    value: Number(health.cron_jobs ?? 0),
    timestamp: now,
  })

  // Chain stats
  current.push({
    name: 'widgetdc_active_chains',
    labels: {},
    value: Number(health.active_chains ?? 0),
    timestamp: now,
  })

  // Write gate
  if (health.write_gate_stats) {
    const wg = health.write_gate_stats as Record<string, number>
    current.push({ name: 'widgetdc_writes_total', labels: {}, value: wg.writes_total ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_writes_passed', labels: {}, value: wg.writes_passed ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_writes_rejected', labels: {}, value: wg.writes_rejected ?? 0, timestamp: now })
  }

  // Circuit breaker
  if (health.backend_circuit_breaker) {
    const cb = health.backend_circuit_breaker as Record<string, number | boolean>
    current.push({ name: 'widgetdc_circuit_breaker_failures', labels: {}, value: Number(cb.failures ?? 0), timestamp: now })
    current.push({ name: 'widgetdc_circuit_breaker_open', labels: {}, value: cb.open ? 1 : 0, timestamp: now })
  }

  // Rate limit
  if (health.rate_limit_backpressure) {
    const rl = health.rate_limit_backpressure as Record<string, number>
    current.push({ name: 'widgetdc_rate_limit_delay_ms', labels: {}, value: rl.current_delay_ms ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_rate_limit_hits', labels: {}, value: rl.hits_in_window ?? 0, timestamp: now })
  }

  // Anomaly watcher
  if (health.anomaly_watcher) {
    const aw = health.anomaly_watcher as Record<string, number>
    current.push({ name: 'widgetdc_anomaly_scans_total', labels: {}, value: aw.totalScans ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_active_anomalies', labels: {}, value: aw.activeAnomalies ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_anomaly_patterns', labels: {}, value: aw.patterns ?? 0, timestamp: now })
  }

  // Pheromone layer
  if (health.pheromone_layer) {
    const pl = health.pheromone_layer as Record<string, number>
    current.push({ name: 'widgetdc_pheromone_total_deposits', labels: {}, value: pl.totalDeposits ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_pheromone_active', labels: {}, value: pl.activePheromones ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_pheromone_decays', labels: {}, value: pl.totalDecays ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_pheromone_amplifications', labels: {}, value: pl.totalAmplifications ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_pheromone_trails', labels: {}, value: pl.trailCount ?? 0, timestamp: now })
  }

  // Peer eval
  if (health.peer_eval) {
    const pe = health.peer_eval as Record<string, number>
    current.push({ name: 'widgetdc_peer_evals_total', labels: {}, value: pe.totalEvals ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_peer_reviews', labels: {}, value: pe.totalPeerReviews ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_best_practices', labels: {}, value: pe.totalBestPracticesShared ?? 0, timestamp: now })
    current.push({ name: 'widgetdc_task_types_tracked', labels: {}, value: pe.taskTypesTracked ?? 0, timestamp: now })
  }

  // RLM availability
  current.push({
    name: 'widgetdc_rlm_available',
    labels: {},
    value: health.rlm_available ? 1 : 0,
    timestamp: now,
  })

  // Redis
  current.push({
    name: 'widgetdc_redis_enabled',
    labels: {},
    value: health.redis_enabled ? 1 : 0,
    timestamp: now,
  })

  return [...samples, ...current]
}

/** Format samples as Prometheus text exposition */
function formatPrometheusText(samples: MetricSample[]): string {
  const lines: string[] = []

  // Group by metric name
  const byName = new Map<string, MetricSample[]>()
  for (const s of samples) {
    if (!byName.has(s.name)) byName.set(s.name, [])
    byName.get(s.name)!.push(s)
  }

  for (const [name, group] of byName) {
    // HELP
    lines.push(`# HELP ${name} WidgeTDC platform metric`)
    lines.push(`# TYPE ${name} gauge`)
    for (const s of group) {
      const labelParts = Object.entries(s.labels).map(([k, v]) => `${k}="${v}"`)
      const labels = labelParts.length > 0 ? `{${labelParts.join(',')}}` : ''
      lines.push(`${name}${labels} ${s.value} ${s.timestamp}`)
    }
  }

  return lines.join('\n') + '\n'
}

/** GET /metrics — Prometheus metrics endpoint */
prometheusMetricsRouter.get('/metrics', async (_req: Request, res: Response) => {
  try {
    // Fetch current health
    const healthUrl = `${process.env.RAILWAY_PRIVATE_DOMAIN || 'localhost'}/health`
    const resp = await fetch(`http://${healthUrl}`)
    const health = await resp.json()

    const currentSamples = collectMetrics(health)
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    res.send(formatPrometheusText(currentSamples))
  } catch (err) {
    logger.error({ err: String(err) }, 'Prometheus metrics collection failed')
    res.status(500).set('Content-Type', 'text/plain').send(`# Error: ${String(err)}\n`)
  }
})

/** GET /api/grafana/prometheus — Alias for Grafana Infinity datasource */
prometheusMetricsRouter.get('/api/grafana/prometheus', async (req: Request, res: Response) => {
  try {
    // Same as /metrics but via /api/ path for Grafana Infinity
    const healthUrl = `${process.env.RAILWAY_PRIVATE_DOMAIN || 'localhost'}/health`
    const resp = await fetch(`http://${healthUrl}`)
    const health = await resp.json()

    const currentSamples = collectMetrics(health)
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    res.send(formatPrometheusText(currentSamples))
  } catch (err) {
    logger.error({ err: String(err) }, 'Grafana Prometheus endpoint failed')
    res.status(500).set('Content-Type', 'text/plain').send(`# Error: ${String(err)}\n`)
  }
})
