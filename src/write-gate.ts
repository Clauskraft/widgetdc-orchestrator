/**
 * write-gate.ts — Write-Path Circuit Breaker (F1, LIN-574 v3.0)
 *
 * Validates ALL graph.write_cypher calls before they reach the backend.
 * Prevents: LLM prompt pollution, domain drift, embedding mismatches, empty nodes.
 *
 * Shared POLLUTION_PATTERNS are exported for reuse in dual-rag.ts.
 */
import { logger } from './logger.js'

// ─── Shared Pollution Patterns (single source of truth) ─────────────────────

export const POLLUTION_PATTERNS = [
  /you are (?:a |an )?(?:helpful |expert |professional )/i,
  /^(?:system|assistant|human):/im,
  /\b(?:claude|chatgpt|gpt-4|openai)\s+(?:is|can|should|will)\b/i,
  /\bdo not (?:hallucinate|make up|fabricate)\b/i,
  /\byour (?:task|role|job|purpose) is to\b/i,
  /\brespond (?:in|with|using) (?:json|markdown|the following)\b/i,
  /\banswer (?:only|strictly|exclusively) (?:in|with|based)\b/i,
  /\b(?:ignore|disregard) (?:previous|all|any) (?:instructions|prompts)\b/i,
  /\byou (?:must|should|will) (?:always|never|only)\b/i,
  /\bas an ai (?:language )?model\b/i,
]

export function isPolluted(text: string): boolean {
  if (!text || text.length < 20) return false
  let matchCount = 0
  for (const pattern of POLLUTION_PATTERNS) {
    if (pattern.test(text)) matchCount++
    if (matchCount >= 2) return true
  }
  return false
}

// ─── Domain Allowlist (15 canonical domains) ────────────────────────────────

export const CANONICAL_DOMAINS = new Set([
  'AI', 'Architecture', 'Cloud', 'Consulting', 'Cybersecurity',
  'Finance', 'HR', 'Learning', 'Marketing', 'Operations',
  'Product Management', 'Public Sector', 'Risk & Compliance',
  'Strategy', 'Technology',
])

// ─── Valid Embedding Dimensions ─────────────────────────────────────────────

const VALID_EMBEDDING_DIMS = new Set([384, 1536])

// ─── Metrics ────────────────────────────────────────────────────────────────

const metrics = {
  writes_total: 0,
  writes_passed: 0,
  writes_rejected: 0,
}

export function getWriteGateStats() {
  return { ...metrics }
}

// ─── Validation Result ──────────────────────────────────────────────────────

interface ValidationResult {
  allowed: boolean
  reason?: string
}

// ─── Main Gate ──────────────────────────────────────────────────────────────

/**
 * Validate a graph.write_cypher call before it reaches the backend.
 * Returns { allowed: true } or { allowed: false, reason: "..." }.
 *
 * Only called for graph.write_cypher — reads are never intercepted.
 */
export function validateBeforeMerge(
  query: string,
  params: Record<string, unknown>,
  force?: boolean,
): ValidationResult {
  metrics.writes_total++

  // B-6: Admin bypass
  if (force) {
    metrics.writes_passed++
    logger.warn('Write-path validation bypassed (force=true)')
    return { allowed: true }
  }

  // F5: Truncated query detection — catch incomplete Cypher sent by LLM-generated queries
  if (query.length > 0) {
    const trimmed = query.trim()
    const truncationSignals = [
      /SET\s+\w+\.\w{1,20}$/i,           // ends mid-property: "SET old.validUnt"
      /WHERE\s+\w+\.\w{0,20}$/i,          // ends mid-condition
      /RETURN\s*$/i,                        // RETURN with nothing after
      /,\s*$/,                              // trailing comma
      // Unclosed string literal: a quote that has NO matching close quote before end-of-query.
      // Uses a simple odd-count heuristic (works for standard Cypher without escaped quotes).
      // Note: /['"][^'"]{0,50}$/ was too broad — it false-positives on closed strings followed
      // by Cypher keywords, e.g. n.agentId = 'knowledge-bus' RETURN n.slug
    ]
    // Separate: odd number of single or double quotes → at least one unclosed string literal
    const singleQuoteCount = (trimmed.match(/'/g) ?? []).length
    const doubleQuoteCount = (trimmed.match(/"/g) ?? []).length
    if (singleQuoteCount % 2 !== 0 || doubleQuoteCount % 2 !== 0) {
      metrics.writes_rejected++
      const reason = `Cypher query has unclosed string literal (single_quotes=${singleQuoteCount} double_quotes=${doubleQuoteCount}): "${trimmed.slice(-40)}"`
      logger.warn({ preview: trimmed.slice(-60) }, `Write REJECTED: ${reason}`)
      return { allowed: false, reason }
    }
    for (const pattern of truncationSignals) {
      if (pattern.test(trimmed)) {
        metrics.writes_rejected++
        const reason = `Cypher query appears truncated (matched: ${pattern.source}): "${trimmed.slice(-40)}"`
        logger.warn({ preview: trimmed.slice(-60) }, `Write REJECTED: ${reason}`)
        return { allowed: false, reason }
      }
    }
  }

  // B-2: Pollution detection — check all string params for LLM prompt content
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 20) {
      if (isPolluted(value)) {
        metrics.writes_rejected++
        const reason = `Content in param "${key}" matches LLM prompt pollution patterns`
        logger.warn({ param: key, preview: value.slice(0, 80) }, `Write REJECTED: ${reason}`)
        return { allowed: false, reason }
      }
    }
  }

  // B-3: Domain allowlist — check if creating/merging a Domain node with non-canonical name
  const domainMatch = query.match(/(?:MERGE|CREATE)\s*\(\w*:Domain\s*\{[^}]*name:\s*\$(\w+)/i)
  if (domainMatch) {
    const paramName = domainMatch[1]
    const domainName = params[paramName]
    if (typeof domainName === 'string' && !CANONICAL_DOMAINS.has(domainName)) {
      metrics.writes_rejected++
      const reason = `Domain '${domainName}' not in canonical allowlist (${CANONICAL_DOMAINS.size} domains)`
      logger.warn({ domain: domainName }, `Write REJECTED: ${reason}`)
      return { allowed: false, reason }
    }
  }

  // B-4: Embedding dimension check — arrays of numbers > 100 length are likely embeddings
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value) && value.length > 100 && typeof value[0] === 'number') {
      if (!VALID_EMBEDDING_DIMS.has(value.length)) {
        metrics.writes_rejected++
        const reason = `Embedding dimension ${value.length} in param "${key}" does not match expected (384 or 1536)`
        logger.warn({ param: key, dim: value.length }, `Write REJECTED: ${reason}`)
        return { allowed: false, reason }
      }
    }
  }

  // B-5: Required fields — new nodes must have title, name, or filename
  const isNodeCreation = /(?:CREATE|MERGE)\s*\([^)]*:[A-Z]\w+/i.test(query)
    && /ON\s+CREATE\s+SET|CREATE\s*\(/i.test(query)
  if (isNodeCreation) {
    const hasIdentifier = Object.entries(params).some(([key, val]) => {
      return (key === 'title' || key === 'name' || key === 'filename')
        && typeof val === 'string' && val.trim().length > 0
    })
    // Also check if the Cypher itself sets title/name inline
    const setsIdentifier = /SET\s+\w+\.(title|name|filename)\s*=/i.test(query)
    if (!hasIdentifier && !setsIdentifier) {
      // Don't reject relationship-only writes or known infrastructure nodes
      const isInfraNode = /:(GraphHealthSnapshot|RLMDecision|RLMTool|RLMPattern)/i.test(query)
      if (!isInfraNode) {
        metrics.writes_rejected++
        const reason = 'New nodes must have a non-empty title, name, or filename'
        logger.warn({ cypher: query.slice(0, 120) }, `Write REJECTED: ${reason}`)
        return { allowed: false, reason }
      }
    }
  }

  metrics.writes_passed++
  return { allowed: true }
}
