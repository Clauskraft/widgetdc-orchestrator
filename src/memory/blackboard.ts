/**
 * blackboard.ts — Shared agent blackboard with TypeBox-validated read/write (LIN-593 SNOUT-10).
 *
 * Pattern: AI blackboard architecture — agents post findings to a shared typed board,
 * other agents read and react. Each slot has a TypeBox schema enforcing the contract.
 *
 * Backed by Redis (with in-memory fallback). Agents can only write to slots they
 * declare, and all writes are validated before persistence.
 *
 * Usage:
 *   const board = createBlackboard('chain-123')
 *   await board.write('observations', { items: [...], confidence: 0.8 }, 'omega-sentinel')
 *   const obs = await board.read('observations')
 */
import { Type, type Static, type TObject } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

// ─── Slot Schemas (TypeBox contracts) ───────────────────────────────────────

/** Observations from analysis/scanning agents */
export const ObservationsSlot = Type.Object({
  items: Type.Array(Type.String()),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  source_agent: Type.String(),
  timestamp: Type.String(),
})

/** Strategic plan from planning agents */
export const PlanSlot = Type.Object({
  goal: Type.String(),
  steps: Type.Array(Type.Object({
    id: Type.String(),
    action: Type.String(),
    tool: Type.Optional(Type.String()),
    status: Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('done'), Type.Literal('failed')]),
  })),
  estimated_impact: Type.Optional(Type.Number()),
  source_agent: Type.String(),
  timestamp: Type.String(),
})

/** Execution results from worker agents */
export const ResultSlot = Type.Object({
  outputs: Type.Array(Type.Unknown()),
  passed: Type.Number(),
  failed: Type.Number(),
  artifacts: Type.Array(Type.String()),
  source_agent: Type.String(),
  timestamp: Type.String(),
})

/** Quality verdict from judge/verifier agents */
export const VerdictSlot = Type.Object({
  passed: Type.Boolean(),
  score: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
  issues: Type.Array(Type.String()),
  recommendation: Type.Union([Type.Literal('approve'), Type.Literal('revise'), Type.Literal('reject')]),
  source_agent: Type.String(),
  timestamp: Type.String(),
})

/** Free-form context accumulator */
export const ContextSlot = Type.Object({
  entries: Type.Array(Type.Object({
    key: Type.String(),
    value: Type.Unknown(),
    agent: Type.String(),
    timestamp: Type.String(),
  })),
})

// ─── Slot Registry ─────────────────────────────────────────────────────────

const SLOT_SCHEMAS: Record<string, TObject> = {
  observations: ObservationsSlot,
  plan: PlanSlot,
  result: ResultSlot,
  verdict: VerdictSlot,
  context: ContextSlot,
}

export type SlotName = keyof typeof SLOT_SCHEMAS
export type SlotData<K extends SlotName> =
  K extends 'observations' ? Static<typeof ObservationsSlot> :
  K extends 'plan' ? Static<typeof PlanSlot> :
  K extends 'result' ? Static<typeof ResultSlot> :
  K extends 'verdict' ? Static<typeof VerdictSlot> :
  K extends 'context' ? Static<typeof ContextSlot> :
  never

// ─── Blackboard Interface ──────────────────────────────────────────────────

export interface Blackboard {
  /** Read a typed slot. Returns null if not written yet. */
  read<K extends SlotName>(slot: K): Promise<SlotData<K> | null>
  /** Write to a typed slot. Validates against TypeBox schema. Throws on invalid. */
  write<K extends SlotName>(slot: K, data: SlotData<K>, agentId: string): Promise<void>
  /** List all slots that have been written to. */
  slots(): Promise<SlotName[]>
  /** Delete a slot. */
  clear(slot: SlotName): Promise<void>
  /** Delete the entire blackboard. */
  destroy(): Promise<void>
}

const TTL_SECONDS = 86400 // 24h — blackboards are ephemeral

/**
 * Create a blackboard scoped to a task/chain execution.
 * @param taskId — unique ID (e.g., chain execution_id)
 */
export function createBlackboard(taskId: string): Blackboard {
  const prefix = `bb:${taskId}:`

  // In-memory fallback when Redis unavailable
  const memStore = new Map<string, string>()

  async function redisGet(key: string): Promise<string | null> {
    const redis = getRedis()
    if (redis) {
      try { return await redis.get(key) } catch { /* fall through */ }
    }
    return memStore.get(key) ?? null
  }

  async function redisSet(key: string, value: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      try { await redis.set(key, value, 'EX', TTL_SECONDS); return } catch { /* fall through */ }
    }
    memStore.set(key, value)
  }

  async function redisDel(key: string): Promise<void> {
    const redis = getRedis()
    if (redis) {
      try { await redis.del(key) } catch { /* fall through */ }
    }
    memStore.delete(key)
  }

  return {
    async read<K extends SlotName>(slot: K): Promise<SlotData<K> | null> {
      const raw = await redisGet(`${prefix}${slot}`)
      if (!raw) return null
      try {
        return JSON.parse(raw) as SlotData<K>
      } catch {
        return null
      }
    },

    async write<K extends SlotName>(slot: K, data: SlotData<K>, agentId: string): Promise<void> {
      const schema = SLOT_SCHEMAS[slot]
      if (!schema) throw new Error(`Unknown blackboard slot: ${slot}`)

      // Validate against TypeBox schema
      if (!Value.Check(schema, data)) {
        const errors = [...Value.Errors(schema, data)]
        const msg = errors.slice(0, 3).map(e => `${e.path}: ${e.message}`).join('; ')
        throw new Error(`Blackboard validation failed for slot '${slot}': ${msg}`)
      }

      await redisSet(`${prefix}${slot}`, JSON.stringify(data))
      logger.debug({ taskId, slot, agent: agentId }, 'Blackboard write')
    },

    async slots(): Promise<SlotName[]> {
      const redis = getRedis()
      if (redis) {
        try {
          const keys = await redis.keys(`${prefix}*`)
          return keys.map(k => k.replace(prefix, '') as SlotName)
        } catch { /* fall through */ }
      }
      return [...memStore.keys()].map(k => k.replace(prefix, '') as SlotName)
    },

    async clear(slot: SlotName): Promise<void> {
      await redisDel(`${prefix}${slot}`)
    },

    async destroy(): Promise<void> {
      const redis = getRedis()
      if (redis) {
        try {
          const keys = await redis.keys(`${prefix}*`)
          if (keys.length > 0) await redis.del(...keys)
          return
        } catch { /* fall through */ }
      }
      for (const key of [...memStore.keys()]) {
        if (key.startsWith(prefix)) memStore.delete(key)
      }
    },
  }
}
