import { Router, Request } from 'express'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { AgentRegistry } from '../agents/agent-registry.js'
import { listProviders } from '../llm/llm-proxy.js'
import { listExecutions } from '../chain/chain-engine.js'
import { listCronJobs } from '../cron-scheduler.js'
import { getConnectionStats } from '../chat-broadcaster.js'
import { getSSEClientCount } from '../sse.js'
import { isRlmAvailable } from '../cognitive-proxy.js'
import { isOpenClawHealthy } from './openclaw.js'
import { getBackendCircuitState, getRateLimitState } from '../mcp-caller.js'
import { getWatcherState } from '../swarm/anomaly-watcher.js'
import { getPheromoneState, runPheromoneCron } from '../swarm/pheromone-layer.js'
import { getPeerEvalState } from '../swarm/peer-eval.js'
import { getWriteGateStats } from '../write-gate.js'
import { toMCPTools } from '../tools/tool-registry.js'
import { runFullHarvest } from '../flywheel/harvest-pipeline.js'
import { runWeeklySync } from '../flywheel/flywheel-coordinator.js'
import { runWeeklyConsolidation } from '../llm/consolidation-engine.js'

export const cockpitRouter = Router()

type CockpitCommandId =
  | 'mcp.initialize'
  | 'mcp.list_tools'
  | 'providers.list'
  | 'harvest.full'
  | 'harvest.guard'
  | 'flywheel.sync'
  | 'flywheel.consolidation'
  | 'pheromone.decay'

function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`
}

function normalizeToolCount(payload: any): number {
  if (Array.isArray(payload)) return payload.length
  if (Array.isArray(payload?.tools)) return payload.tools.length
  if (Array.isArray(payload?.data?.tools)) return payload.data.tools.length
  if (Array.isArray(payload?.result?.tools)) return payload.result.tools.length
  if (Array.isArray(payload?.result)) return payload.result.length
  return 0
}

async function fetchBackendTools(): Promise<{ ok: boolean; toolCount: number; error?: string }> {
  try {
    const res = await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.backendApiKey}`,
      },
      body: JSON.stringify({ tool: 'list_tools', payload: {} }),
      signal: AbortSignal.timeout(15000),
    })

    const body = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, toolCount: 0, error: `HTTP ${res.status}` }
    }

    const toolCount = normalizeToolCount(body)
    return { ok: true, toolCount }
  } catch (error) {
    return {
      ok: false,
      toolCount: 0,
      error: error instanceof Error ? error.message : 'Unknown backend MCP error',
    }
  }
}

async function fetchOrchestratorMcp(req: Request, method: 'initialize' | 'tools/list') {
  const url = new URL('/mcp', requestOrigin(req))
  if (config.orchestratorApiKey) {
    url.searchParams.set('api_key', config.orchestratorApiKey)
  }

  const body = method === 'initialize'
    ? {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'cockpit-probe', version: '1.0.0' },
        },
      }
    : {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { cursor: 'include_backend' },
      }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })

  const payload = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, payload }
}

async function probeMcp(req: Request) {
  const [initializeProbe, toolsProbe, backendProbe] = await Promise.all([
    fetchOrchestratorMcp(req, 'initialize'),
    fetchOrchestratorMcp(req, 'tools/list'),
    fetchBackendTools(),
  ])

  return {
    orchestrator: {
      healthy: initializeProbe.ok,
      status_code: initializeProbe.status,
      protocol_version: initializeProbe.payload?.result?.protocolVersion ?? null,
      server_name: initializeProbe.payload?.result?.serverInfo?.name ?? 'widgetdc-orchestrator',
      server_version: initializeProbe.payload?.result?.serverInfo?.version ?? null,
      tool_count: normalizeToolCount(toolsProbe.payload?.result),
      raw: initializeProbe.payload,
    },
    backend: {
      healthy: backendProbe.ok,
      tool_count: backendProbe.toolCount,
      error: backendProbe.error ?? null,
    },
    checked_at: new Date().toISOString(),
  }
}

function summarizeCommand(command: CockpitCommandId, result: any): string {
  switch (command) {
    case 'mcp.initialize':
      return result.orchestrator.healthy
        ? `MCP initialized. Protocol ${result.orchestrator.protocol_version}; ${result.orchestrator.tool_count} tools visible.`
        : 'MCP initialize failed.'
    case 'mcp.list_tools':
      return `Orchestrator sees ${result.orchestrator.tool_count} tools and backend sees ${result.backend.tool_count}.`
    case 'providers.list':
      return `${result.providers.filter((provider: { available: boolean }) => provider.available).length} providers available.`
    case 'harvest.full':
      return `Full harvest completed across ${Object.keys(result.results ?? {}).length} domains.`
    case 'harvest.guard':
      return [
        `Harvest guard executed.`,
        `domains=${result.metrics?.domains_harvested ?? 0}`,
        `providers=${result.metrics?.providers_available ?? 0}/${result.metrics?.providers_total ?? 0}`,
        `score=${result.metrics?.compound_health_score ?? 'n/a'}`,
      ].join(' ')
    case 'flywheel.sync':
      return `Flywheel sync completed with compound score ${result.report?.compound_health_score ?? 'n/a'}.`
    case 'flywheel.consolidation':
      return `Consolidation scan completed with ${result.report?.items?.length ?? 0} findings.`
    case 'pheromone.decay':
      return `Pheromone decay completed with ${result.data?.decayed ?? result.decayed ?? 0} decays.`
    default:
      return `${command} completed`
  }
}

cockpitRouter.get('/overview', async (req, res) => {
  try {
    const [mcp, providers] = await Promise.all([
      probeMcp(req),
      Promise.resolve(listProviders()),
    ])

    const agents = AgentRegistry.all()
    const executions = listExecutions()
    const cronJobs = listCronJobs()
    const ws = getConnectionStats()
    const watcher = getWatcherState()
    const pheromone = getPheromoneState()
    const peerEval = getPeerEvalState()
    const writeGate = getWriteGateStats()

    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        services: {
          rlm_available: isRlmAvailable(),
          openclaw_healthy: isOpenClawHealthy(),
          backend_circuit_breaker: getBackendCircuitState(),
          rate_limit_backpressure: getRateLimitState(),
        },
        mcp,
        providers,
        agents: {
          total: agents.length,
          active: agents.filter((agent) => ['online', 'idle', 'busy'].includes(agent.handshake.status)).length,
        },
        chains: {
          total: executions.length,
          running: executions.filter((execution) => execution.status === 'running').length,
        },
        cron: {
          total: cronJobs.length,
          enabled: cronJobs.filter((job) => job.enabled).length,
        },
        connections: {
          ws_total: ws.total,
          sse_total: getSSEClientCount(),
        },
        signals: {
          anomaly_active: watcher.activeAnomalies,
          anomaly_scans: watcher.totalScans,
          pheromone_active: pheromone.activePheromones,
          pheromone_deposits: pheromone.totalDeposits,
          peer_evals: peerEval.totalEvals,
          write_rejections: writeGate.writesRejected,
        },
      },
    })
  } catch (error) {
    logger.error({ err: String(error) }, 'Cockpit overview failed')
    res.status(500).json({ success: false, error: String(error) })
  }
})

cockpitRouter.post('/mcp/initialize', async (req, res) => {
  try {
    const result = await probeMcp(req)
    res.json({ success: true, data: result })
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) })
  }
})

cockpitRouter.get('/providers', (_req, res) => {
  res.json({ success: true, data: { providers: listProviders() } })
})

cockpitRouter.post('/commands/execute', async (req, res) => {
  const command = req.body?.command as CockpitCommandId | undefined
  if (!command) {
    res.status(400).json({ success: false, error: 'command is required' })
    return
  }

  try {
    let result: unknown
    switch (command) {
      case 'mcp.initialize':
      case 'mcp.list_tools':
        result = await probeMcp(req)
        break
      case 'providers.list':
        result = { providers: listProviders() }
        break
      case 'harvest.full':
        result = { results: await runFullHarvest() }
        break
      case 'harvest.guard': {
        const [mcp, providers] = await Promise.all([
          probeMcp(req),
          Promise.resolve(listProviders()),
        ])
        const harvestResults = await runFullHarvest()
        const syncReport = await runWeeklySync()
        const watcher = getWatcherState()
        const writeGate = getWriteGateStats()
        const providerAvailable = providers.filter((provider) => provider.available).length
        result = {
          gates: {
            mcp_orchestrator: mcp.orchestrator.healthy,
            mcp_backend: mcp.backend.healthy,
            provider_available: providerAvailable > 0,
            harvest_executed: Object.keys(harvestResults ?? {}).length > 0,
            sync_executed: typeof syncReport?.compound_health_score === 'number',
          },
          metrics: {
            domains_harvested: Object.keys(harvestResults ?? {}).length,
            providers_available: providerAvailable,
            providers_total: providers.length,
            compound_health_score: syncReport?.compound_health_score ?? null,
            anomaly_active: watcher.activeAnomalies,
            write_rejections: writeGate.writesRejected,
          },
          harvest: harvestResults,
          sync: syncReport,
          mcp,
        }
        break
      }
      case 'flywheel.sync':
        result = { report: await runWeeklySync() }
        break
      case 'flywheel.consolidation':
        result = { report: await runWeeklyConsolidation() }
        break
      case 'pheromone.decay':
        result = { data: await runPheromoneCron() }
        break
      default:
        res.status(404).json({ success: false, error: `Unknown command: ${command}` })
        return
    }

    res.json({
      success: true,
      data: {
        command,
        summary: summarizeCommand(command, result),
        result,
      },
    })
  } catch (error) {
    logger.error({ command, err: String(error) }, 'Cockpit command failed')
    res.status(500).json({ success: false, error: String(error) })
  }
})
