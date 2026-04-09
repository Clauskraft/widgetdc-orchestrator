/**
 * grafana-proxy.ts — Proxy Grafana Cloud metrics to cc-v4 dashboard
 *
 * Streams metrics from Grafana Cloud Prometheus to the Command Center SPA.
 * Avoids CORS issues by proxying through the orchestrator.
 *
 * Endpoints:
 * GET /api/grafana/query?query=<promql>&range=<hours> — Run PromQL query
 * GET /api/grafana/health — Aggregated platform health from all sources
 * GET /api/grafana/alerts — Recent firing alerts from Grafana
 */
import { Router, Request, Response } from 'express'
import { logger } from '../logger.js'
import { config } from '../config.js'

export const grafanaProxyRouter = Router()

const GRAFANA_URL = 'https://clauskraft.grafana.net'
const GRAFANA_API_KEY = config.grafanaApiKey
const PROM_URL = 'https://prometheus-prod-39-prod-eu-north-0.grafana.net/api/prom'
const GRAFANA_HEADERS = {
  'Authorization': `Bearer ${GRAFANA_API_KEY}`,
  'Content-Type': 'application/json',
}

/**
 * GET /api/grafana/query?query=<promql>&range=<hours>
 *
 * Execute PromQL query against Grafana Cloud Prometheus.
 * Default range: 1h. Returns instant query result.
 */
grafanaProxyRouter.get('/query', async (req: Request, res: Response) => {
  const query = req.query.query as string
  const rangeHours = parseInt(req.query.range as string) || 1

  if (!query) {
    res.status(400).json({ error: 'query parameter required' })
    return
  }

  try {
    const url = `${PROM_URL}/api/v1/query?query=${encodeURIComponent(query)}`
    const resp = await fetch(url, {
      headers: GRAFANA_HEADERS,
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText)
      res.status(resp.status).json({ error: `Grafana query failed: ${text}` })
      return
    }

    const data = await resp.json()
    res.json(data)
  } catch (err) {
    logger.error({ err: String(err), query }, 'Grafana proxy query failed')
    res.status(502).json({ error: `Query failed: ${String(err)}` })
  }
})

/**
 * GET /api/grafana/query_range?query=<promql>&range=<hours>&step=<seconds>
 *
 * Execute PromQL range query against Grafana Cloud Prometheus.
 * Returns time series data for charting.
 */
grafanaProxyRouter.get('/query_range', async (req: Request, res: Response) => {
  const query = req.query.query as string
  const rangeHours = parseInt(req.query.range as string) || 1
  const step = parseInt(req.query.step as string) || 60

  if (!query) {
    res.status(400).json({ error: 'query parameter required' })
    return
  }

  try {
    const end = Math.floor(Date.now() / 1000)
    const start = end - rangeHours * 3600
    const url = `${PROM_URL}/api/v1/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${step}`
    const resp = await fetch(url, {
      headers: GRAFANA_HEADERS,
      signal: AbortSignal.timeout(15000),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText)
      res.status(resp.status).json({ error: `Grafana range query failed: ${text}` })
      return
    }

    const data = await resp.json()
    res.json(data)
  } catch (err) {
    logger.error({ err: String(err), query }, 'Grafana proxy range query failed')
    res.status(502).json({ error: `Range query failed: ${String(err)}` })
  }
})

/**
 * GET /api/grafana/health — Aggregated platform health
 *
 * Combines data from:
 * 1. Backend health endpoint
 * 2. Orchestrator health endpoint
 * 3. Grafana Cloud Prometheus (if configured)
 */
grafanaProxyRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const [backend, orchestrator] = await Promise.allSettled([
      fetch(`${config.backendUrl}/health`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
      fetch(`${config.orchestratorUrl || 'http://localhost:3100'}/health`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
    ])

    res.json({
      backend: backend.status === 'fulfilled' ? backend.value : { status: 'unreachable' },
      orchestrator: orchestrator.status === 'fulfilled' ? orchestrator.value : { status: 'unreachable' },
      timestamp: new Date().toISOString(),
    })
  } catch {
    res.status(500).json({ error: 'Health check failed' })
  }
})

/**
 * GET /api/grafana/alerts — Recent firing alerts from Grafana
 */
grafanaProxyRouter.get('/alerts', async (_req: Request, res: Response) => {
  try {
    // Query Grafana Cloud Alertmanager for active alerts
    const url = `${GRAFANA_URL}/api/prometheus/grafanacloud-clauskraft-prom/api/v1/alerts`
    const resp = await fetch(url, {
      headers: GRAFANA_HEADERS,
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) {
      res.status(resp.status).json({ error: 'Failed to fetch alerts' })
      return
    }

    const data = await resp.json()
    res.json(data)
  } catch (err) {
    logger.error({ err: String(err) }, 'Grafana alerts fetch failed')
    res.status(502).json({ error: `Failed to fetch alerts: ${String(err)}` })
  }
})
