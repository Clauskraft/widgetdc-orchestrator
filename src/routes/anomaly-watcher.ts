/**
 * routes/anomaly-watcher.ts — Proactive Anomaly Detection REST API
 *
 * GET  /status     — Current watcher state (scan count, active anomalies, patterns)
 * GET  /anomalies  — Active anomalies (filterable by valence/severity)
 * GET  /patterns   — Learned anomaly patterns with frequency + known fixes
 * POST /scan       — Trigger an on-demand anomaly scan
 */
import { Router, Request, Response } from 'express'
import { runAnomalyScan, getWatcherState, getActiveAnomalies, getAnomalyPatterns } from '../anomaly-watcher.js'
import { logger } from '../logger.js'

export const anomalyWatcherRouter = Router()

/**
 * GET /status — Watcher state overview
 */
anomalyWatcherRouter.get('/status', (_req: Request, res: Response) => {
  const state = getWatcherState()
  res.json({
    success: true,
    data: {
      lastScanAt: state.lastScanAt,
      totalScans: state.totalScans,
      anomaliesDetected: state.anomaliesDetected,
      anomaliesResolved: state.anomaliesResolved,
      activeCount: state.activeAnomalies.length,
      patternCount: state.patterns.length,
      activeByValence: {
        negative: state.activeAnomalies.filter(a => a.valence === 'negative').length,
        positive: state.activeAnomalies.filter(a => a.valence === 'positive').length,
      },
      activeBySeverity: {
        critical: state.activeAnomalies.filter(a => a.severity === 'critical').length,
        warning: state.activeAnomalies.filter(a => a.severity === 'warning').length,
        info: state.activeAnomalies.filter(a => a.severity === 'info').length,
      },
    },
  })
})

/**
 * GET /anomalies — Active anomalies with optional filters
 * Query params: ?valence=positive|negative&severity=critical|warning|info
 */
anomalyWatcherRouter.get('/anomalies', (req: Request, res: Response) => {
  let anomalies = getActiveAnomalies()
  const valence = req.query.valence as string | undefined
  const severity = req.query.severity as string | undefined

  if (valence === 'positive' || valence === 'negative') {
    anomalies = anomalies.filter(a => a.valence === valence)
  }
  if (severity === 'critical' || severity === 'warning' || severity === 'info') {
    anomalies = anomalies.filter(a => a.severity === severity)
  }

  res.json({
    success: true,
    data: anomalies,
    count: anomalies.length,
  })
})

/**
 * GET /patterns — Learned anomaly patterns
 */
anomalyWatcherRouter.get('/patterns', (_req: Request, res: Response) => {
  const patterns = getAnomalyPatterns()
  res.json({
    success: true,
    data: patterns,
    count: patterns.length,
  })
})

/**
 * POST /scan — Trigger on-demand anomaly scan
 */
anomalyWatcherRouter.post('/scan', async (_req: Request, res: Response) => {
  try {
    const result = await runAnomalyScan()
    res.json({
      success: true,
      data: {
        anomalies: result.anomalies.length,
        negative: result.anomalies.filter(a => a.valence === 'negative').length,
        positive: result.anomalies.filter(a => a.valence === 'positive').length,
        critical: result.anomalies.filter(a => a.severity === 'critical').length,
        analysis: result.analysis ? result.analysis.slice(0, 500) : null,
        health: {
          backendReachable: result.health.backendReachable,
          backendLatencyMs: result.health.backendLatencyMs,
          rlmReachable: result.health.rlmReachable,
          redisReachable: result.health.redisReachable,
        },
        patterns: result.patterns.length,
      },
    })
  } catch (err) {
    logger.error({ error: String(err) }, 'On-demand anomaly scan failed')
    res.status(500).json({
      success: false,
      error: {
        code: 'ANOMALY_SCAN_FAILED',
        message: String(err),
        status_code: 500,
      },
    })
  }
})
