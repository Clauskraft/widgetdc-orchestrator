/**
 * neo4j-direct.ts — Direct Neo4j AuraDB write, bypassing config.backendUrl.
 *
 * graph.write_cypher was routing through ${config.backendUrl}/api/mcp/route.
 * If BACKEND_URL is misconfigured on Railway (e.g. pointing at the orchestrator
 * itself), Express returns "Cannot POST /api/mcp/route" — a 404 that the
 * Inventor's try/catch swallows silently.
 *
 * This module provides a LOCAL execution path:
 *   1. Direct neo4j-driver connection using NEO4J_URI/USER/PASSWORD from config
 *   2. HTTP fallback to the production backend URL (hardcoded, not BACKEND_URL)
 */
import { config } from './config.js'
import { logger } from './logger.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _driver: any = null
let _initDone = false
let _initError: string | null = null

async function initDriver(): Promise<void> {
  if (_initDone) return
  _initDone = true

  if (!config.neo4jUri || !config.neo4jPassword) {
    _initError = 'NEO4J_URI or NEO4J_PASSWORD not set — will use HTTP fallback'
    logger.debug('neo4j-direct: NEO4J_URI not configured')
    return
  }

  try {
    // Dynamic import: avoids startup crash if neo4j-driver not yet installed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('neo4j-driver') as any
    const neo4j = mod.default ?? mod
    _driver = neo4j.driver(
      config.neo4jUri,
      neo4j.auth.basic(config.neo4jUser, config.neo4jPassword),
      { maxConnectionPoolSize: 5, connectionAcquisitionTimeout: 10_000 },
    )
    await _driver.verifyConnectivity()
    const uriHost = config.neo4jUri.split('@').pop() ?? config.neo4jUri
    logger.info({ neo4j_host: uriHost }, 'neo4j-direct: driver ready')
  } catch (err) {
    _initError = String(err)
    _driver = null
    logger.warn({ error: _initError }, 'neo4j-direct: driver init failed — HTTP fallback active')
  }
}

// Warm the connection at module load if URI is configured
if (config.neo4jUri) {
  initDriver().catch(() => { /* logged inside */ })
}

/**
 * Execute a MERGE-based Cypher write directly against AuraDB.
 * Falls back to HTTP POST against the production backend URL if driver is unavailable.
 */
export async function neo4jDirectWrite(
  query: string,
  params: Record<string, unknown> = {},
): Promise<string> {
  await initDriver()

  // Path 1: Direct neo4j-driver
  if (_driver) {
    const session = _driver.session({ defaultAccessMode: 'WRITE' })
    try {
      const result = await session.run(query, params)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = result.summary.counters.updates() as any
      return JSON.stringify({
        nodesCreated: c.nodesCreated ?? 0,
        propertiesSet: c.propertiesSet ?? 0,
        relationshipsCreated: c.relationshipsCreated ?? 0,
      })
    } finally {
      await session.close()
    }
  }

  // Path 2: HTTP to production backend URL — NOT config.backendUrl (may be misconfigured)
  const BACKEND = 'https://backend-production-d3da.up.railway.app'
  const resp = await fetch(`${BACKEND}/api/mcp/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.backendApiKey}`,
    },
    body: JSON.stringify({ tool: 'graph.write_cypher', payload: { query, params } }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(
      `graph.write_cypher HTTP fallback: ${resp.status} from backend — ${text.slice(0, 200)}`,
    )
  }

  const data = await resp.json() as Record<string, unknown>
  return JSON.stringify(data.result ?? data).slice(0, 800)
}
