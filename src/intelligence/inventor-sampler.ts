/**
 * inventor-sampler.ts — Sampling algorithms for Orchestrator_Inventor
 *
 * Ports ASI-Evolve's UCB1 + Greedy + Random + Island (MAP-Elites) sampling
 * to TypeScript. Uses the same mathematical foundations.
 *
 * These samplers select parent nodes from the trial database for the
 * Researcher agent to use as starting points for new variations.
 */
import type { InventorNode, SamplingAlgorithm } from './inventor-types.js'
import { logger } from '../logger.js'

// ─── Base Sampler Interface ──────────────────────────────────────────────────

export interface Sampler {
  algorithm: SamplingAlgorithm
  sample(nodes: InventorNode[], n: number): InventorNode[]
  onNodeAdded(node: InventorNode): void
  getState(): Record<string, unknown>
  loadState(state: Record<string, unknown>): void
  setPheromoneSignals?(signals: Map<string, number>): void
}

// ─── UCB1 Sampler ────────────────────────────────────────────────────────────
// UCB1 = normalized_score + c * sqrt(ln(N) / n_i)
// Balances exploitation (high-score nodes) with exploration (unvisited nodes)

export class UCB1Sampler implements Sampler {
  algorithm: SamplingAlgorithm = 'ucb1'
  private c: number
  private totalVisits = 0
  private pheromoneBias: Map<string, number> = new Map()
  private alpha = 0.3 // pheromone influence weight

  constructor(c = 1.414) {
    this.c = c
  }

  setPheromoneSignals(signals: Map<string, number>): void {
    this.pheromoneBias = signals
  }

  sample(nodes: InventorNode[], n: number): InventorNode[] {
    if (nodes.length === 0) return []
    if (nodes.length <= n) return [...nodes]

    const minScore = Math.min(...nodes.map(nd => nd.score))
    const maxScore = Math.max(...nodes.map(nd => nd.score))
    const scoreRange = maxScore - minScore || 1

    // Calculate UCB1 value for each node, with optional pheromone bias
    const scored = nodes.map(node => {
      const normalizedScore = (node.score - minScore) / scoreRange
      const exploration = node.visitCount === 0
        ? Infinity
        : this.c * Math.sqrt(Math.log(Math.max(this.totalVisits, 1)) / node.visitCount)
      const pheromoneBoost = this.pheromoneBias.get(node.id) ?? 0
      return { node, ucb1: normalizedScore + exploration + this.alpha * pheromoneBoost }
    })

    // Sort by UCB1 descending, take top-n
    scored.sort((a, b) => b.ucb1 - a.ucb1)
    const selected = scored.slice(0, n).map(s => s.node)

    // Increment visit counts
    for (const node of selected) {
      node.visitCount++
      this.totalVisits++
    }

    return selected
  }

  onNodeAdded(_node: InventorNode): void {
    // UCB1 doesn't need special handling for new nodes
  }

  getState(): Record<string, unknown> {
    return { totalVisits: this.totalVisits, c: this.c }
  }

  loadState(state: Record<string, unknown>): void {
    this.totalVisits = (state.totalVisits as number) || 0
    this.c = (state.c as number) || 1.414
  }
}

// ─── Greedy Sampler ──────────────────────────────────────────────────────────
// Always picks the top-scoring nodes. Pure exploitation.

export class GreedySampler implements Sampler {
  algorithm: SamplingAlgorithm = 'greedy'

  sample(nodes: InventorNode[], n: number): InventorNode[] {
    if (nodes.length === 0) return []
    const sorted = [...nodes].sort((a, b) => b.score - a.score)
    return sorted.slice(0, n)
  }

  onNodeAdded(_node: InventorNode): void {}
  getState(): Record<string, unknown> { return {} }
  loadState(_state: Record<string, unknown>): void {}
}

// ─── Random Sampler ──────────────────────────────────────────────────────────
// Uniform random selection. Baseline diversity.

export class RandomSampler implements Sampler {
  algorithm: SamplingAlgorithm = 'random'

  sample(nodes: InventorNode[], n: number): InventorNode[] {
    if (nodes.length === 0) return []
    const shuffled = [...nodes].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, n)
  }

  onNodeAdded(_node: InventorNode): void {}
  getState(): Record<string, unknown> { return {} }
  loadState(_state: Record<string, unknown>): void {}
}

// ─── Island (MAP-Elites) Sampler ─────────────────────────────────────────────
// Multi-population with migration. Each island evolves independently.
// Periodically migrates top performers between neighboring islands.

export class IslandSampler implements Sampler {
  algorithm: SamplingAlgorithm = 'island'
  private islands: Map<number, Set<string>> = new Map()
  private islandCount: number
  private migrationInterval: number
  private migrationRate: number
  private currentIsland = 0
  private generationCount = 0
  private lastMigration = 0

  constructor(config: { count: number; migrationInterval: number; migrationRate: number }) {
    this.islandCount = config.count
    this.migrationInterval = config.migrationInterval
    this.migrationRate = config.migrationRate

    // Initialize empty islands
    for (let i = 0; i < this.islandCount; i++) {
      this.islands.set(i, new Set())
    }
  }

  sample(nodes: InventorNode[], n: number): InventorNode[] {
    if (nodes.length === 0) return []

    this.generationCount++

    // Check if migration is due
    if (this.generationCount - this.lastMigration >= this.migrationInterval) {
      this.migrate(nodes)
      this.lastMigration = this.generationCount
    }

    // Sample from current island, rotating through islands
    const islandNodeIds = this.islands.get(this.currentIsland) ?? new Set()
    const islandNodes = nodes.filter(nd => islandNodeIds.has(nd.id))

    // Rotate to next island for next sample call
    this.currentIsland = (this.currentIsland + 1) % this.islandCount

    if (islandNodes.length === 0) {
      // Fallback: sample from all nodes if island is empty
      const sorted = [...nodes].sort((a, b) => b.score - a.score)
      return sorted.slice(0, n)
    }

    // Mix exploration (random) and exploitation (top-score)
    const explorationCount = Math.max(1, Math.floor(n * 0.3))
    const exploitationCount = n - explorationCount

    const sorted = [...islandNodes].sort((a, b) => b.score - a.score)
    const exploited = sorted.slice(0, exploitationCount)

    const remaining = islandNodes.filter(nd => !exploited.includes(nd))
    const shuffled = remaining.sort(() => Math.random() - 0.5)
    const explored = shuffled.slice(0, explorationCount)

    return [...exploited, ...explored]
  }

  onNodeAdded(node: InventorNode): void {
    // Assign to parent's island, or current island if no parent
    const targetIsland = node.island >= 0 ? node.island : this.currentIsland
    const island = this.islands.get(targetIsland % this.islandCount)
    if (island) island.add(node.id)
    node.island = targetIsland % this.islandCount
  }

  private migrate(allNodes: InventorNode[]): void {
    const nodeMap = new Map(allNodes.map(n => [n.id, n]))

    for (let i = 0; i < this.islandCount; i++) {
      const islandIds = this.islands.get(i) ?? new Set()
      const islandNodes = [...islandIds]
        .map(id => nodeMap.get(id))
        .filter((n): n is InventorNode => n !== undefined)
        .sort((a, b) => b.score - a.score)

      const migrantCount = Math.max(1, Math.floor(islandNodes.length * this.migrationRate))
      const migrants = islandNodes.slice(0, migrantCount)

      // Send to neighboring islands (circular topology)
      const leftNeighbor = (i - 1 + this.islandCount) % this.islandCount
      const rightNeighbor = (i + 1) % this.islandCount

      for (const migrant of migrants) {
        const targetIsland = Math.random() < 0.5 ? leftNeighbor : rightNeighbor
        const target = this.islands.get(targetIsland)
        if (target && !target.has(migrant.id)) {
          target.add(migrant.id)
        }
      }
    }

    logger.debug({ generation: this.generationCount }, 'Inventor: island migration completed')
  }

  getState(): Record<string, unknown> {
    const islands: Record<number, string[]> = {}
    this.islands.forEach((ids, idx) => { islands[idx] = [...ids] })
    return {
      islands,
      currentIsland: this.currentIsland,
      generationCount: this.generationCount,
      lastMigration: this.lastMigration,
    }
  }

  loadState(state: Record<string, unknown>): void {
    const islands = state.islands as Record<number, string[]> | undefined
    if (islands) {
      this.islands.clear()
      for (const [idx, ids] of Object.entries(islands)) {
        this.islands.set(Number(idx), new Set(ids))
      }
    }
    this.currentIsland = (state.currentIsland as number) || 0
    this.generationCount = (state.generationCount as number) || 0
    this.lastMigration = (state.lastMigration as number) || 0
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSampler(config: {
  algorithm: SamplingAlgorithm
  ucb1C?: number
  islands?: { count: number; migrationInterval: number; migrationRate: number }
}): Sampler {
  switch (config.algorithm) {
    case 'ucb1': return new UCB1Sampler(config.ucb1C ?? 1.414)
    case 'greedy': return new GreedySampler()
    case 'random': return new RandomSampler()
    case 'island': return new IslandSampler(config.islands ?? { count: 5, migrationInterval: 10, migrationRate: 0.1 })
    default: return new UCB1Sampler()
  }
}
