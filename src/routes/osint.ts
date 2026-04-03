/**
 * routes/osint.ts — OSINT scanning pipeline endpoints (LIN-480).
 *
 *   POST /api/osint/scan     — Trigger full OSINT scan (optional domain override)
 *   GET  /api/osint/status   — Latest scan results + domain coverage
 *   GET  /api/osint/domains  — Return canonical DK public domain list
 */
import { Router, Request, Response } from 'express'
import { runOsintScan, getOsintStatus, DK_PUBLIC_DOMAINS } from '../osint-scanner.js'
import { logger } from '../logger.js'

export const osintRouter = Router()

/**
 * POST /api/osint/scan — Trigger an OSINT scan.
 * Body (optional): { domains?: string[], scan_type?: 'full' | 'ct_only' | 'dmarc_only' }
 */
osintRouter.post('/scan', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      domains?: string[]
      scan_type?: 'full' | 'ct_only' | 'dmarc_only'
    }

    // Validate scan_type
    const validTypes = ['full', 'ct_only', 'dmarc_only']
    if (body.scan_type && !validTypes.includes(body.scan_type)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid scan_type. Valid: ${validTypes.join(', ')}`,
          status_code: 400,
        },
      })
      return
    }

    // Validate domains array if provided
    if (body.domains && (!Array.isArray(body.domains) || body.domains.length === 0)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'domains must be a non-empty array of strings',
          status_code: 400,
        },
      })
      return
    }

    logger.info({
      domains: body.domains?.length ?? DK_PUBLIC_DOMAINS.length,
      scan_type: body.scan_type ?? 'full',
    }, 'OSINT scan triggered via API')

    // Fire-and-return pattern: start scan async, return 202 immediately
    // Clients poll GET /api/osint/status for results
    const scanPromise = runOsintScan({
      domains: body.domains,
      scan_type: body.scan_type,
    })

    // Wait up to 5s — if scan completes fast, return full result
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
    const result = await Promise.race([scanPromise, timeout])

    if (result) {
      res.json({
        success: true,
        data: {
          scan_id: result.scan_id,
          duration_ms: result.duration_ms,
          scan_type: result.scan_type,
          domains_scanned: result.domains_scanned,
          ct_entries: result.ct_entries,
          dmarc_results: result.dmarc_results,
          total_new_nodes: result.total_new_nodes,
          tools_available: result.tools_available,
          error_count: result.errors.length,
          errors: result.errors.slice(0, 20),
        },
      })
    } else {
      // Scan still running — return 202 and let it complete in background
      scanPromise.catch(err => logger.error({ err: String(err) }, 'Background OSINT scan failed'))
      res.status(202).json({
        success: true,
        message: 'OSINT scan started. Poll GET /api/osint/status for results.',
        status: 'running',
      })
    }
  } catch (err) {
    logger.error({ err: String(err) }, 'OSINT scan endpoint failed')
    res.status(500).json({
      success: false,
      error: {
        code: 'SCAN_ERROR',
        message: 'OSINT scan failed. Check server logs.',
        status_code: 500,
      },
    })
  }
})

/**
 * GET /api/osint/status — Latest scan results + domain coverage stats.
 */
osintRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const latest = await getOsintStatus()

    if (!latest) {
      res.json({
        success: true,
        data: {
          status: 'no_scans',
          message: 'No OSINT scans have been run yet. POST /api/osint/scan to trigger one.',
          total_domains: DK_PUBLIC_DOMAINS.length,
        },
      })
      return
    }

    res.json({
      success: true,
      data: {
        scan_id: latest.scan_id,
        completed_at: latest.completed_at,
        duration_ms: latest.duration_ms,
        scan_type: latest.scan_type,
        domains_scanned: latest.domains_scanned,
        ct_entries: latest.ct_entries,
        dmarc_results: latest.dmarc_results,
        total_new_nodes: latest.total_new_nodes,
        tools_available: latest.tools_available,
        error_count: latest.errors.length,
        coverage: {
          total_domains: DK_PUBLIC_DOMAINS.length,
          scanned: latest.domains_scanned,
          ct_live: latest.ct_results.filter(c => c.source === 'live').length,
          ct_fallback: latest.ct_results.filter(c => c.source === 'fallback').length,
          dmarc_live: latest.dmarc_results_list.filter(d => d.source === 'live').length,
          dmarc_fallback: latest.dmarc_results_list.filter(d => d.source === 'fallback').length,
        },
      },
    })
  } catch (err) {
    logger.error({ err: String(err) }, 'OSINT status endpoint failed')
    res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_ERROR',
        message: 'Failed to read OSINT status.',
        status_code: 500,
      },
    })
  }
})

/**
 * GET /api/osint/domains — Return the canonical DK public domain list.
 */
osintRouter.get('/domains', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      count: DK_PUBLIC_DOMAINS.length,
      domains: [...DK_PUBLIC_DOMAINS],
    },
  })
})
