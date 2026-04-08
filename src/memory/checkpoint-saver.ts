/**
 * checkpoint-saver.ts — LangGraph-inspired checkpoint interface (LIN-592 SNOUT-9).
 *
 * 3-method saver pattern (save/load/list) against Redis.
 * NO LangGraph dependency — just the extracted pattern.
 *
 * Used by: state-machine.ts, chain-engine.ts, evolution-loop.ts, or any
 * component that needs resumable state persistence.
 *
 * Design:
 *   - Namespace-isolated: each consumer gets its own key prefix
 *   - TTL-configurable: defaults to 7 days, overridable per save
 *   - Type-safe: generic over checkpoint payload
 *   - Graceful degradation: returns null/empty when Redis is unavailable
 */
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Checkpoint<T = Record<string, unknown>> {
  /** Unique identifier for this checkpoint */
  id: string
  /** Namespace (e.g., 'fsm', 'chain', 'evolution') */
  namespace: string
  /** The checkpointed state payload */
  state: T
  /** Monotonic version for conflict detection */
  version: number
  /** ISO timestamp */
  created_at: string
  /** ISO timestamp of last update */
  updated_at: string
  /** Optional parent checkpoint ID (for branching) */
  parent_id?: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

export interface CheckpointSaver<T = Record<string, unknown>> {
  /** Persist a checkpoint. Returns the saved checkpoint with updated timestamp. */
  save(id: string, state: T, metadata?: Record<string, unknown>): Promise<Checkpoint<T>>
  /** Load a checkpoint by ID. Returns null if not found or Redis unavailable. */
  load(id: string): Promise<Checkpoint<T> | null>
  /** List all checkpoints in this namespace, sorted by updated_at desc. */
  list(limit?: number): Promise<Checkpoint<T>[]>
  /** Delete a checkpoint by ID. */
  delete(id: string): Promise<boolean>
}

// ─── Redis Implementation ───────────────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 86400 * 7 // 7 days

/**
 * Create a checkpoint saver for a given namespace.
 * Each namespace gets isolated Redis keys: `ckpt:{namespace}:{id}`
 */
export function createCheckpointSaver<T = Record<string, unknown>>(
  namespace: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): CheckpointSaver<T> {
  const prefix = `ckpt:${namespace}:`

  return {
    async save(id: string, state: T, metadata?: Record<string, unknown>): Promise<Checkpoint<T>> {
      const redis = getRedis()
      const now = new Date().toISOString()

      // Load existing to increment version
      let version = 1
      let parentId: string | undefined
      if (redis) {
        try {
          const existing = await redis.get(`${prefix}${id}`)
          if (existing) {
            const prev = JSON.parse(existing) as Checkpoint<T>
            version = prev.version + 1
            parentId = prev.parent_id
          }
        } catch { /* first save */ }
      }

      const checkpoint: Checkpoint<T> = {
        id,
        namespace,
        state,
        version,
        created_at: version === 1 ? now : (await this.load(id))?.created_at ?? now,
        updated_at: now,
        parent_id: parentId,
        metadata,
      }

      if (redis) {
        try {
          await redis.set(`${prefix}${id}`, JSON.stringify(checkpoint), 'EX', ttlSeconds)
        } catch (err) {
          logger.warn({ namespace, id, err: String(err) }, 'Checkpoint save failed')
        }
      }

      return checkpoint
    },

    async load(id: string): Promise<Checkpoint<T> | null> {
      const redis = getRedis()
      if (!redis) return null
      try {
        const raw = await redis.get(`${prefix}${id}`)
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    },

    async list(limit = 50): Promise<Checkpoint<T>[]> {
      const redis = getRedis()
      if (!redis) return []
      try {
        const keys = await redis.keys(`${prefix}*`)
        const checkpoints: Checkpoint<T>[] = []
        for (const key of keys.slice(0, limit * 2)) {
          const raw = await redis.get(key)
          if (raw) checkpoints.push(JSON.parse(raw))
        }
        return checkpoints
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .slice(0, limit)
      } catch {
        return []
      }
    },

    async delete(id: string): Promise<boolean> {
      const redis = getRedis()
      if (!redis) return false
      try {
        const result = await redis.del(`${prefix}${id}`)
        return result > 0
      } catch {
        return false
      }
    },
  }
}

// ─── Pre-built savers for known namespaces ─────────────────────────────────

/** Checkpoint saver for FSM plans (state-machine.ts) */
export const fsmSaver = createCheckpointSaver('fsm')

/** Checkpoint saver for chain executions (chain-engine.ts) */
export const chainSaver = createCheckpointSaver('chain', 86400 * 3) // 3 days

/** Checkpoint saver for evolution cycles (evolution-loop.ts) */
export const evolutionSaver = createCheckpointSaver('evolution', 86400 * 14) // 14 days
