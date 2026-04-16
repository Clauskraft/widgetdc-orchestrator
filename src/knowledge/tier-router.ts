export type Tier = 'l2' | 'l3' | 'l4'

export const TIER_THRESHOLDS = {
  L4_MIN: 0.85,  // shared skill file — all repos
  L3_MIN: 0.70,  // Neo4j AgentMemory — runtime agents
} as const

export function routeTier(score: number | undefined): Tier {
  if (score === undefined || Number.isNaN(score) || score < TIER_THRESHOLDS.L3_MIN) return 'l2'
  if (score < TIER_THRESHOLDS.L4_MIN) return 'l3'
  return 'l4'
}
