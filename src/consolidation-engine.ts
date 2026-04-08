/**
 * consolidation-engine.ts — Platform consolidation scanner
 *
 * Identifies candidates for deprecation or archival based on:
 *   1. Tool/agent routes with zero usage in 30+ days (stale)
 *   2. Task types with dominant routing (one agent >90%) → can retire alternatives
 *   3. Cost profiles where degraded agents have no recovering trend
 *
 * Never auto-deletes anything. Returns a report consumed by:
 *   - cron-scheduler.ts (Sunday 06:00) → creates Linear issues for human review
 *   - /api/flywheel/consolidation endpoint (read-only)
 *
 * All actions are flagging only — human confirmation required.
 */

import { logger } from './logger.js'
import { getAllCostProfiles, CostProfile } from './cost-optimizer.js'
import { getAllFleetLearnings } from './peer-eval.js'
import { computeTelemetry } from './adoption-telemetry.js'

export interface ConsolidationCandidate {
  id: string
  category: 'stale-tool' | 'dominant-route' | 'degraded-agent'
  agentId?: string
  taskType?: string
  toolName?: string
  reason: string
  evidence: string[]
  riskLevel: 'low' | 'medium' | 'high'
  suggestedAction: string
}

export interface ConsolidationReport {
  generatedAt: string
  candidates: ConsolidationCandidate[]
  autoExecuted: number   // always 0 — we never auto-delete
  manualReview: number
  summary: string
}

// ─── Last report cache ────────────────────────────────────────────────────────
let lastReport: ConsolidationReport | null = null

export async function runWeeklyConsolidation(): Promise<ConsolidationReport> {
  logger.info('[Consolidation] Starting weekly scan')
  const candidates: ConsolidationCandidate[] = []

  await scanDegradedAgents(candidates)
  await scanDominantRoutes(candidates)
  await scanStaleTools(candidates)

  const report: ConsolidationReport = {
    generatedAt: new Date().toISOString(),
    candidates,
    autoExecuted: 0,
    manualReview: candidates.length,
    summary: `${candidates.length} consolidation candidates found — all require human review`,
  }

  lastReport = report
  logger.info({ candidates: candidates.length }, '[Consolidation] Weekly scan complete')
  return report
}

export function getLastReport(): ConsolidationReport | null {
  return lastReport
}

// ─── Scanners ─────────────────────────────────────────────────────────────────

async function scanDegradedAgents(candidates: ConsolidationCandidate[]): Promise<void> {
  try {
    const profiles = getAllCostProfiles()
    const degraded = profiles.filter(p => p.degraded && p.totalTasks >= 10)
    for (const p of degraded) {
      const recent = p.recentScores.slice(-5)
      const recentAvg = recent.reduce((s, v) => s + v, 0) / Math.max(1, recent.length)
      candidates.push({
        id: `degraded:${p.agentId}:${p.taskType}`,
        category: 'degraded-agent',
        agentId: p.agentId,
        taskType: p.taskType,
        reason: `Agent "${p.agentId}" has quality degradation on task type "${p.taskType}"`,
        evidence: [
          `Last ${recent.length} scores avg: ${(recentAvg * 100).toFixed(0)}% (below 40%)`,
          `Total tasks evaluated: ${p.totalTasks}`,
          `Efficiency ratio: ${p.efficiencyRatio.toFixed(3)}`,
        ],
        riskLevel: recentAvg < 0.2 ? 'high' : 'medium',
        suggestedAction: `Investigate agent config for "${p.agentId}" on "${p.taskType}" tasks. Consider routing to a different agent temporarily.`,
      })
    }
  } catch (err) {
    logger.warn({ err }, '[Consolidation] scanDegradedAgents failed')
  }
}

async function scanDominantRoutes(candidates: ConsolidationCandidate[]): Promise<void> {
  try {
    const learnings = getAllFleetLearnings()
    for (const l of learnings) {
      // If best agent has very high quality AND total evals are substantial, alternatives are waste
      if (l.totalEvals >= 20 && l.bestScore >= 0.85 && l.bestAgent) {
        const profiles = getAllCostProfiles().filter(p => p.taskType === l.taskType)
        const nonBest = profiles.filter(p => p.agentId !== l.bestAgent)
        for (const p of nonBest) {
          if (p.totalTasks >= 5 && p.avgQualityScore < l.bestScore - 0.2) {
            candidates.push({
              id: `dominant:${l.taskType}:${p.agentId}`,
              category: 'dominant-route',
              agentId: p.agentId,
              taskType: l.taskType,
              reason: `"${l.bestAgent}" dominates "${l.taskType}" task type — "${p.agentId}" is underperforming`,
              evidence: [
                `Best agent: ${l.bestAgent} score=${l.bestScore.toFixed(2)}`,
                `This agent: ${p.agentId} score=${p.avgQualityScore.toFixed(2)} (Δ=${(l.bestScore - p.avgQualityScore).toFixed(2)})`,
                `Fleet evals: ${l.totalEvals}`,
              ],
              riskLevel: 'low',
              suggestedAction: `Consider updating chain routing for "${l.taskType}" to default to "${l.bestAgent}".`,
            })
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, '[Consolidation] scanDominantRoutes failed')
  }
}

async function scanStaleTools(candidates: ConsolidationCandidate[]): Promise<void> {
  try {
    const summary = await computeTelemetry()
    const stale = summary.stale_tools ?? []
    for (const toolName of stale.slice(0, 10)) {
      candidates.push({
        id: `stale:${toolName}`,
        category: 'stale-tool',
        toolName,
        reason: `Tool "${toolName}" has not been called in 30+ days`,
        evidence: ['0 calls in last 30-day window', 'Detected by adoption-telemetry stale scan'],
        riskLevel: 'low',
        suggestedAction: `Verify if "${toolName}" is still needed. If unused for 60+ days, consider removing from tool registry.`,
      })
    }
  } catch (err) {
    logger.warn({ err }, '[Consolidation] scanStaleTools failed')
  }
}
