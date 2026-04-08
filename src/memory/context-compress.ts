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
