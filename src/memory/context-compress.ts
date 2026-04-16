/**
 * context-compress.ts — Active Context Compression (ACC).
 *
 * Implements Context Folding IN: compresses large context payloads
 * before sending to agents or RLM Engine, preserving semantic density.
 *
 * Strategies:
 *   - fold: Use RLM /cognitive/fold to compress via LLM reasoning
 *   - truncate: Smart truncation keeping first/last + key sentences
 *   - dedupe: Remove duplicate/near-duplicate content blocks
 *   - hybrid: fold + dedupe for maximum compression
 *
 * Also handles Context Folding OUT: expanding compressed outputs
 * back to actionable graph mutations or detailed responses.
 */
import { callCognitive, isRlmAvailable } from '../cognitive-proxy.js'
import { logger } from '../logger.js'

export type CompressionStrategy = 'fold' | 'truncate' | 'dedupe' | 'hybrid'

interface CompressOptions {
  strategy?: CompressionStrategy
  maxTokens?: number
  preserveStructure?: boolean
}

interface CompressResult {
  original_length: number
  compressed_length: number
  compression_ratio: number
  strategy: CompressionStrategy
  content: string
  duration_ms: number
}

const DEFAULT_MAX_TOKENS = 2000
const AVG_CHARS_PER_TOKEN = 4

// ─── Smart Compaction Trigger (topic 10/15) ──────────────────────────────────
// Evaluates whether compression should fire, and which strategy to use.
// Replaces ad-hoc "length > threshold" guards scattered across the codebase.

export interface CompactionDecision {
  /** Should we compress now? */
  compact: boolean
  /** Recommended strategy if compact=true */
  strategy: CompressionStrategy
  /** Estimated token count of the input */
  estimatedTokens: number
  /** 0–1: fraction of content that appears repetitive */
  repetitionRatio: number
  /** Human-readable reason for the decision */
  reason: string
}

/** Signals that push toward more aggressive compression */
interface CompactionHints {
  /** Current chain step depth — deeper = more likely to compact */
  chainDepth?: number
  /** Is RLM available for fold compression? */
  rlmAvailable?: boolean
  /** Max tokens budget for the downstream call */
  maxTokensBudget?: number
}

const COMPACT_SOFT_LIMIT = 1500   // tokens — start considering compaction
const COMPACT_HARD_LIMIT = 3000   // tokens — always compact
const REPETITION_TRIGGER  = 0.30  // 30% repetition → compact regardless of size

/**
 * Estimate repetition ratio: what fraction of 80-char content windows appear
 * more than once? Fast O(n) pass with a rolling hash set.
 */
function estimateRepetition(content: string): number {
  const WINDOW = 80
  if (content.length < WINDOW * 2) return 0

  const seen = new Set<string>()
  let duplicates = 0
  const total = Math.floor(content.length / WINDOW)

  for (let i = 0; i < total; i++) {
    const chunk = content.slice(i * WINDOW, i * WINDOW + WINDOW)
    const key = chunk.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) duplicates++
    else seen.add(key)
  }

  return duplicates / total
}

/**
 * Decide whether to compress a context payload and which strategy to use.
 *
 * Decision logic (in priority order):
 * 1. Above hard limit (3000 tokens) → always compact, use hybrid
 * 2. Repetition >30% → dedupe (even if small)
 * 3. Above soft limit (1500 tokens) + chainDepth >= 3 → fold (deep chains drift)
 * 4. Above soft limit + RLM unavailable → truncate
 * 5. Above soft limit → fold
 * 6. Below soft limit → no compaction
 */
export function shouldCompact(content: string, hints?: CompactionHints): CompactionDecision {
  const estimatedTokens = Math.round(content.length / AVG_CHARS_PER_TOKEN)
  const repetitionRatio = estimateRepetition(content)
  const rlmOk = hints?.rlmAvailable !== false  // default: assume available
  const chainDepth = hints?.chainDepth ?? 0
  const budget = hints?.maxTokensBudget ?? COMPACT_HARD_LIMIT

  // Always compact if over budget
  if (estimatedTokens > budget || estimatedTokens > COMPACT_HARD_LIMIT) {
    return {
      compact: true,
      strategy: 'hybrid',
      estimatedTokens,
      repetitionRatio,
      reason: `Over hard limit (${estimatedTokens} tokens > ${Math.min(budget, COMPACT_HARD_LIMIT)} budget)`,
    }
  }

  // High repetition → dedupe first, regardless of size
  if (repetitionRatio >= REPETITION_TRIGGER) {
    return {
      compact: true,
      strategy: 'dedupe',
      estimatedTokens,
      repetitionRatio,
      reason: `High repetition ratio (${(repetitionRatio * 100).toFixed(0)}% duplicate windows)`,
    }
  }

  if (estimatedTokens > COMPACT_SOFT_LIMIT) {
    if (!rlmOk) {
      return {
        compact: true,
        strategy: 'truncate',
        estimatedTokens,
        repetitionRatio,
        reason: `Over soft limit (${estimatedTokens} tokens), RLM unavailable — using truncate`,
      }
    }
    if (chainDepth >= 3) {
      return {
        compact: true,
        strategy: 'fold',
        estimatedTokens,
        repetitionRatio,
        reason: `Over soft limit at chain depth ${chainDepth} — folding to prevent context drift`,
      }
    }
    return {
      compact: true,
      strategy: 'fold',
      estimatedTokens,
      repetitionRatio,
      reason: `Over soft limit (${estimatedTokens} tokens) — semantic fold recommended`,
    }
  }

  return {
    compact: false,
    strategy: 'truncate',
    estimatedTokens,
    repetitionRatio,
    reason: `Within limits (${estimatedTokens} tokens, ${(repetitionRatio * 100).toFixed(0)}% repetition)`,
  }
}

/**
 * Convenience: evaluate and compress in one call.
 * Returns original content if compaction is not needed.
 */
export async function compactIfNeeded(
  content: string,
  hints?: CompactionHints,
): Promise<{ content: string; compacted: boolean; decision: CompactionDecision }> {
  const decision = shouldCompact(content, hints)
  if (!decision.compact) {
    return { content, compacted: false, decision }
  }
  const result = await compressContext(content, {
    strategy: decision.strategy,
    maxTokens: hints?.maxTokensBudget ?? DEFAULT_MAX_TOKENS,
  })
  return { content: result.content, compacted: true, decision }
}

/**
 * Compress context using the specified strategy.
 */
export async function compressContext(
  content: string,
  options?: CompressOptions,
): Promise<CompressResult> {
  const t0 = Date.now()
  const strategy = options?.strategy ?? 'hybrid'
  const maxChars = (options?.maxTokens ?? DEFAULT_MAX_TOKENS) * AVG_CHARS_PER_TOKEN

  // If content is already short enough, return as-is
  if (content.length <= maxChars) {
    return {
      original_length: content.length,
      compressed_length: content.length,
      compression_ratio: 1,
      strategy,
      content,
      duration_ms: Date.now() - t0,
    }
  }

  let compressed: string

  switch (strategy) {
    case 'fold':
      compressed = await foldCompress(content, maxChars)
      break
    case 'truncate':
      compressed = smartTruncate(content, maxChars)
      break
    case 'dedupe':
      compressed = deduplicateBlocks(content, maxChars)
      break
    case 'hybrid':
      compressed = deduplicateBlocks(content, maxChars * 2)
      if (compressed.length > maxChars) {
        compressed = await foldCompress(compressed, maxChars)
      }
      break
    default:
      compressed = smartTruncate(content, maxChars)
  }

  const result: CompressResult = {
    original_length: content.length,
    compressed_length: compressed.length,
    compression_ratio: compressed.length / content.length,
    strategy,
    content: compressed,
    duration_ms: Date.now() - t0,
  }

  logger.debug({
    strategy,
    original: content.length,
    compressed: compressed.length,
    ratio: result.compression_ratio.toFixed(2),
  }, 'Context compressed')

  return result
}

/**
 * Context Folding IN — use RLM Engine to semantically compress.
 */
async function foldCompress(content: string, maxChars: number): Promise<string> {
  if (!isRlmAvailable()) {
    return smartTruncate(content, maxChars)
  }

  try {
    const result = await callCognitive('fold', {
      prompt: `Compress the following context to approximately ${Math.round(maxChars / AVG_CHARS_PER_TOKEN)} tokens while preserving all key facts, entities, relationships, and actionable information. Remove redundancy but keep semantic density high. Output ONLY the compressed text, no preamble.`,
      context: { content: content.slice(0, 16000) }, // RLM input limit
      agent_id: 'context-compressor',
    }, 30000)

    const compressed = String(result ?? '')
    if (compressed.length > 0 && compressed.length < content.length) {
      return compressed.slice(0, maxChars)
    }
  } catch (err) {
    logger.warn({ err: String(err) }, 'RLM fold failed, falling back to truncation')
  }

  return smartTruncate(content, maxChars)
}

/**
 * Smart truncation — keeps beginning, end, and key sentences.
 */
function smartTruncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content

  const headSize = Math.floor(maxChars * 0.6)
  const tailSize = Math.floor(maxChars * 0.3)
  const separator = '\n\n[...compressed...]\n\n'

  const head = content.slice(0, headSize)
  const tail = content.slice(-tailSize)

  return head + separator + tail
}

/**
 * Remove duplicate or near-duplicate content blocks.
 */
function deduplicateBlocks(content: string, maxChars: number): string {
  const blocks = content.split(/\n{2,}/)
  const seen = new Set<string>()
  const unique: string[] = []

  for (const block of blocks) {
    // Normalize for comparison: lowercase, collapse whitespace
    const normalized = block.toLowerCase().replace(/\s+/g, ' ').trim()
    if (normalized.length < 10) continue // skip tiny blocks

    // Check for near-duplicates (first 100 chars match)
    const key = normalized.slice(0, 100)
    if (seen.has(key)) continue

    seen.add(key)
    unique.push(block.trim())
  }

  const result = unique.join('\n\n')
  return result.length > maxChars ? smartTruncate(result, maxChars) : result
}

/**
 * Context Folding OUT — expand a compressed result into structured actions.
 * Used after chain/debate execution to expand concise outputs.
 */
export async function expandContext(
  compressed: string,
  targetFormat: 'graph_mutations' | 'detailed_response' | 'action_plan',
): Promise<string> {
  if (!isRlmAvailable()) return compressed

  const formatInstructions: Record<string, string> = {
    graph_mutations: 'Expand into specific Neo4j Cypher mutations (CREATE/MERGE/SET statements) that would persist these insights into a knowledge graph.',
    detailed_response: 'Expand into a detailed, well-structured response with sections, examples, and actionable recommendations.',
    action_plan: 'Expand into a concrete action plan with numbered steps, responsible agents, and expected outcomes.',
  }

  try {
    const result = await callCognitive('reason', {
      prompt: `${formatInstructions[targetFormat]}\n\nCompressed context:\n${compressed}`,
      agent_id: 'context-expander',
    }, 30000)

    return String(result ?? compressed)
  } catch {
    return compressed
  }
}
