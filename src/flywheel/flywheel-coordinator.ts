/**
 * flywheel-coordinator.ts — WidgeTDC Value Flywheel Weekly Orchestrator
 *
 * Aggregates the 5 flywheel pillars into a compound health metric,
 * identifies the top optimisation opportunities, and surfaces
 * actionable Linear issues.
 *
 * Pillars:
 *   1. Cost Efficiency   → CostOptimizer profiles
 *   2. Fleet Intelligence → PeerEval fleet learnings
 *   3. Adoption          → AdoptionTelemetry tool usage
 *   4. Pheromone Signal  → Active/deposit/amplification counts
 *   5. Platform Health   → Service health (uptime, circuit breakers)
 *
 * Called by: cron-scheduler.ts (weekly Monday 08:00)
 * Dashboard: cc-v4 /flywheel route reads /api/flywheel/metrics
 */

import { logger } from '../logger.js'
import { getRedis } from '../redis.js'
import { getCostSummary, getAllCostProfiles } from './cost-optimizer.js'
import { getAllFleetLearnings, getPeerEvalState } from '../swarm/peer-eval.js'
import { computeTelemetry } from './adoption-telemetry.js'

export interface PillarScore {
  name: string
  score: number        // 0–1
  trend: 'up' | 'flat' | 'down'
  headline: string
  details: string[]
}

export interface FlywheelReport {
  generatedAt: string
  compoundScore: number        // geometric mean of 5 pillars
  pillars: PillarScore[]
  nextOptimizations: Array<{ title: string; pillar: string; impact: number; action: string }>
  weeklyDelta: number          // change vs last week (0 if first run)
}

// ─── Last report: persisted to Redis for cross-deploy delta calculation ──────
const FLYWHEEL_REDIS_KEY = 'flywheel:last-report'
let lastReport: FlywheelReport | null = null

async function loadLastReport(): Promise<void> {
  const redis = getRedis()
  if (!redis || lastReport) return
  try {
    const raw = await redis.get(FLYWHEEL_REDIS_KEY)
    if (raw) lastReport = JSON.parse(raw) as FlywheelReport
  } catch { /* */ }
}

async function saveLastReport(report: FlywheelReport): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(FLYWHEEL_REDIS_KEY, JSON.stringify(report), 'EX', 691200) // 8 days TTL
  } catch { /* */ }
}

export async function runWeeklySync(): Promise<FlywheelReport> {
  logger.info('[Flywheel] Starting weekly sync')
  await loadLastReport()
  const pillars: PillarScore[] = await Promise.all([
    scoreCostEfficiency(),
    scoreFleetIntelligence(),
    scoreAdoption(),
    scorePheromone(),
    scorePlatformHealth(),
  ])

  // Compound: geometric mean (all pillars must be healthy for high score)
  const compound = Math.pow(
    pillars.reduce((product, p) => product * Math.max(0.01, p.score), 1),
    1 / pillars.length,
  )

  const optimizations = identifyOptimizations(pillars)
  const delta = lastReport ? compound - lastReport.compoundScore : 0

  const report: FlywheelReport = {
    generatedAt: new Date().toISOString(),
    compoundScore: parseFloat(compound.toFixed(4)),
    pillars,
    nextOptimizations: optimizations.slice(0, 5),
    weeklyDelta: parseFloat(delta.toFixed(4)),
  }

  lastReport = report
  await saveLastReport(report)
  logger.info({ compound: report.compoundScore, delta: report.weeklyDelta }, '[Flywheel] Weekly sync complete')
  return report
}

export function getLastReport(): FlywheelReport | null {
  return lastReport
}

export async function getFlywheelMetrics(): Promise<{
  available: boolean
  report: FlywheelReport | null
  pillars?: PillarScore[]
}> {
  if (!lastReport) {
    // Generate on-demand if never run
    try {
      const report = await runWeeklySync()
      return { available: true, report, pillars: report.pillars }
    } catch {
      return { available: false, report: null }
    }
  }
  return { available: true, report: lastReport, pillars: lastReport.pillars }
}

// ─── Pillar scorers ───────────────────────────────────────────────────────────

async function scoreCostEfficiency(): Promise<PillarScore> {
  try {
    const summary = getCostSummary()
    const profiles = getAllCostProfiles()
    const degradedPct = summary.totalProfiles > 0
      ? summary.degradedAgents.length / summary.totalProfiles
      : 0
    const avgQuality = profiles.length > 0
      ? profiles.reduce((s, p) => s + p.avgQualityScore, 0) / profiles.length
      : 0.5
    // Score: high efficiency + low degradation + reasonable cost
    const score = Math.max(0, Math.min(1,
      avgQuality * 0.5 +
      (1 - degradedPct) * 0.3 +
      (summary.avgPlatformCostPerTask < 0.05 ? 0.2 : summary.avgPlatformCostPerTask < 0.1 ? 0.1 : 0),
    ))
    return {
      name: 'Cost Efficiency',
      score: parseFloat(score.toFixed(3)),
      trend: 'flat',
      headline: `${summary.totalProfiles} agent×task profiles · avg quality ${(avgQuality * 100).toFixed(0)}%`,
      details: [
        `${summary.degradedAgents.length} degraded agents`,
        `${summary.taskTypesCovered} task types covered`,
        `Avg cost/task: $${summary.avgPlatformCostPerTask.toFixed(4)}`,
        ...(summary.topEfficient.slice(0, 2).map(p => `Top: ${p.agentId}/${p.taskType} efficiency=${p.efficiencyRatio.toFixed(2)}`)),
      ],
    }
  } catch (err) {
    logger.warn({ err }, '[Flywheel] scoreCostEfficiency failed')
    return fallbackPillar('Cost Efficiency')
  }
}

async function scoreFleetIntelligence(): Promise<PillarScore> {
  try {
    const learnings = getAllFleetLearnings()
    const state = getPeerEvalState()
    const reliableLearnings = learnings.filter(l => l.totalEvals >= 5 && l.avgScore >= 0.6)
    const avgScore = learnings.length > 0
      ? learnings.reduce((s, l) => s + l.avgScore, 0) / learnings.length
      : 0.5
    const bpCount = learnings.reduce((s, l) => s + (l.bestPractices?.length ?? 0), 0)
    const score = Math.min(1,
      (state.totalEvals > 0 ? Math.min(0.4, state.totalEvals / 1000) : 0) +
      avgScore * 0.4 +
      (bpCount > 0 ? Math.min(0.2, bpCount / 50) : 0),
    )
    return {
      name: 'Fleet Intelligence',
      score: parseFloat(score.toFixed(3)),
      trend: state.totalEvals > 100 ? 'up' : 'flat',
      headline: `${state.totalEvals} evals · ${learnings.length} task types · ${bpCount} best practices`,
      details: [
        `${reliableLearnings.length} reliable routes (≥5 evals, ≥0.6 quality)`,
        `Avg fleet quality: ${(avgScore * 100).toFixed(0)}%`,
        `Task types tracked: ${state.taskTypesTracked}`,
      ],
    }
  } catch (err) {
    logger.warn({ err }, '[Flywheel] scoreFleetIntelligence failed')
    return fallbackPillar('Fleet Intelligence')
  }
}

async function scoreAdoption(): Promise<PillarScore> {
  try {
    const telemetry = await computeTelemetry()
    const totalCalls = telemetry.tools.reduce((s, t) => s + t.lifetime_calls, 0)
    const uniqueTools = telemetry.tools_called_this_week
    const advancedPct = (telemetry.kpis.advanced_utilisation_pct ?? 0) / 100
    // Score: broad tool usage + advanced usage
    const score = Math.min(1,
      (uniqueTools > 0 ? Math.min(0.4, uniqueTools / 20) : 0) +
      advancedPct * 0.3 +
      (totalCalls > 100 ? 0.3 : totalCalls / 100 * 0.3),
    )
    return {
      name: 'Adoption',
      score: parseFloat(score.toFixed(3)),
      trend: totalCalls > 0 ? 'up' : 'flat',
      headline: `${totalCalls} calls · ${uniqueTools} tools active this week · ${(advancedPct * 100).toFixed(0)}% advanced`,
      details: [
        `Total lifetime calls: ${totalCalls}`,
        `Tools active this week: ${uniqueTools} / ${telemetry.total_tools}`,
        `Advanced tool usage: ${(advancedPct * 100).toFixed(0)}%`,
        `Utilisation rate: ${telemetry.kpis.utilisation_rate_pct.toFixed(0)}%`,
      ],
    }
  } catch (err) {
    logger.warn({ err }, '[Flywheel] scoreAdoption failed')
    return fallbackPillar('Adoption')
  }
}

async function scorePheromone(): Promise<PillarScore> {
  // Pheromone data is in the health endpoint — use dynamic import to avoid circular
  try {
    const { getPheromoneStats } = await import('../swarm/pheromone-layer.js')
    const stats = getPheromoneStats()
    const active = stats?.activePheromones ?? 0
    const deposits = stats?.totalDeposits ?? 0
    const amplifications = stats?.totalAmplifications ?? 0
    const score = Math.min(1,
      (active > 0 ? Math.min(0.4, active / 200) : 0) +
      (deposits > 0 ? Math.min(0.3, deposits / 1000) : 0) +
      (amplifications > 0 ? Math.min(0.3, amplifications / 200) : 0),
    )
    return {
      name: 'Pheromone Signal',
      score: parseFloat(score.toFixed(3)),
      trend: active > 50 ? 'up' : 'flat',
      headline: `${active} active · ${deposits} deposits · ${amplifications} amplifications`,
      details: [
        `Active pheromones: ${active}`,
        `Total deposits: ${deposits}`,
        `Cross-pillar amplifications: ${amplifications}`,
        `Decay cycles: ${stats?.totalDecays ?? 0}`,
      ],
    }
  } catch (err) {
    logger.warn({ err }, '[Flywheel] scorePheromone failed')
    return fallbackPillar('Pheromone Signal')
  }
}

async function scorePlatformHealth(): Promise<PillarScore> {
  try {
    const { getCircuitBreakerStats } = await import('../mcp-caller.js')
    const cb = getCircuitBreakerStats?.() ?? null
    const circuitOpen = cb?.open === true
    const failures = cb?.failures ?? 0
    // Simple health: no open circuit + low failures
    const score = circuitOpen ? 0.2 : Math.max(0, 1 - failures * 0.05)
    return {
      name: 'Platform Health',
      score: parseFloat(Math.min(1, score).toFixed(3)),
      trend: circuitOpen ? 'down' : failures > 0 ? 'flat' : 'up',
      headline: circuitOpen ? '⚠ Circuit breaker OPEN' : `${failures} backend failures`,
      details: [
        `Circuit breaker: ${circuitOpen ? 'OPEN' : 'closed'}`,
        `Recent failures: ${failures}`,
      ],
    }
  } catch {
    return { name: 'Platform Health', score: 0.7, trend: 'flat', headline: 'Health data unavailable', details: [] }
  }
}

// ─── Optimization identifier ──────────────────────────────────────────────────

function identifyOptimizations(pillars: PillarScore[]): FlywheelReport['nextOptimizations'] {
  const opts: FlywheelReport['nextOptimizations'] = []
  for (const p of pillars) {
    if (p.score < 0.4) {
      opts.push({
        title: `Improve ${p.name} (score ${(p.score * 100).toFixed(0)}%)`,
        pillar: p.name,
        impact: 1 - p.score,
        action: getActionForPillar(p.name, p),
      })
    } else if (p.score < 0.7) {
      opts.push({
        title: `Grow ${p.name} (${(p.score * 100).toFixed(0)}% → 70%+)`,
        pillar: p.name,
        impact: (0.7 - p.score) * 0.5,
        action: getActionForPillar(p.name, p),
      })
    }
  }
  return opts.sort((a, b) => b.impact - a.impact)
}

function getActionForPillar(name: string, p: PillarScore): string {
  switch (name) {
    case 'Cost Efficiency': return p.details[0]?.includes('degraded') ? 'Investigate degraded agents, check error logs' : 'Add cost tracking to more chain steps'
    case 'Fleet Intelligence': return 'Run more chain executions to accumulate peer-eval data'
    case 'Adoption': return 'Enable advanced tools (reason_deeply, kg_rag, inventor_run) in more chains'
    case 'Pheromone Signal': return 'Deposit attraction pheromones on high-value task types'
    case 'Platform Health': return 'Check /health endpoint and error logs'
    default: return 'Review telemetry data'
  }
}

function fallbackPillar(name: string): PillarScore {
  return { name, score: 0.5, trend: 'flat', headline: 'Data unavailable', details: [] }
}
