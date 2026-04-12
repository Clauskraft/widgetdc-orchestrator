/**
 * value-props-v8-v10.ts — Week 9: OSINT DD + DSPy + Bi-temporal Facts
 *
 * V8: OSINT-backed pre-engagement due diligence
 * V9: MIPROv2-lite prompt A/B testing quality loop
 * V10: Bi-temporal fact graph (Graphiti pattern)
 */
import { getRedis, isRedisEnabled } from '../redis.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import type { AgentRequest, AgentResponse } from '@widgetdc/contracts/agent'
import { agentSuccess, agentFailure } from '../agent/agent-interface.js'

// ─── V8: OSINT Due Diligence ────────────────────────────────────────────────

export interface DueDiligenceReport {
  target: string
  scan_id: string
  generated_at: string
  osint_findings: Array<{ category: string; finding: string; severity: string }>
  mitre_techniques: Array<{ id: string; name: string; relevance: number }>
  risk_score: number           // 0-100
  recommendation: string
}

// MITRE ATLAS for AI systems — top techniques relevant to AI engagement risk
const MITRE_ATLAS_AI_TECHNIQUES = [
  { id: 'AML.TA0001', name: 'ML Model Access', relevance: 0.9 },
  { id: 'AML.TA0002', name: 'ML Attack Development', relevance: 0.95 },
  { id: 'AML.TA0003', name: 'ML Supply Chain', relevance: 0.8 },
  { id: 'AML.TA0004', name: 'Data Poisoning', relevance: 0.85 },
  { id: 'AML.TA0005', name: 'Model Evasion', relevance: 0.8 },
  { id: 'AML.TA0006', name: 'Model Inversion', relevance: 0.75 },
  { id: 'AML.TA0007', name: 'Model Extraction', relevance: 0.7 },
]

/**
 * V8: Run OSINT-backed due diligence on a target company/domain.
 * Combines OSINT scan + MITRE ATLAS AI risk assessment.
 */
export async function runDueDiligence(target: string): Promise<DueDiligenceReport> {
  const findings: DueDiligenceReport['osint_findings'] = []
  let riskScore = 0

  // 1. Check if target domain has CT/DMARC results
  const redis = getRedis()
  if (redis && isRedisEnabled()) {
    try {
      const osintKey = `orchestrator:osint:domains:${target}`
      const osintData = await redis.get(osintKey)
      if (osintData) {
        const parsed = JSON.parse(osintData)
        if (parsed.dmarc && !parsed.dmarc.includes('p=reject')) {
          findings.push({
            category: 'email-security',
            finding: `DMARC policy is not 'reject' for ${target}`,
            severity: 'high',
          })
          riskScore += 20
        }
        if (parsed.ct && parsed.ct.cert_count > 50) {
          findings.push({
            category: 'certificate-transparency',
            finding: `${parsed.ct.cert_count} certificates found — large attack surface`,
            severity: 'medium',
          })
          riskScore += 10
        }
      } else {
        findings.push({
          category: 'osint-coverage',
          finding: `No OSINT data for ${target} — may indicate low digital presence`,
          severity: 'low',
        })
      }
    } catch {
      findings.push({ category: 'osint-error', finding: 'Failed to retrieve OSINT data', severity: 'medium' })
      riskScore += 15
    }
  }

  // 2. MITRE ATLAS AI risk assessment
  const applicableTechniques = MITRE_ATLAS_AI_TECHNIQUES
    .filter(t => {
      // Check if target's industry is relevant to AI attacks
      const aiRelevant = /\b(ai|ml|machine.learning|nlp|computer.vision|chatbot)\b/i.test(target)
      return aiRelevant || t.relevance > 0.85 // High-relevance techniques always apply
    })
    .map(t => ({ ...t }))

  if (applicableTechniques.length > 0) {
    findings.push({
      category: 'ai-risk',
      finding: `${applicableTechniques.length} MITRE ATLAS techniques applicable to target`,
      severity: applicableTechniques.some(t => t.relevance > 0.9) ? 'high' : 'medium',
    })
    riskScore += applicableTechniques.length * 5
  }

  // 3. Overall risk score (cap at 100)
  riskScore = Math.min(100, riskScore)

  const recommendation = riskScore > 60
    ? `HIGH RISK (${riskScore}/100): Recommend enhanced due diligence before engagement`
    : riskScore > 30
      ? `MODERATE RISK (${riskScore}/100): Standard due diligence with AI-specific controls`
      : `LOW RISK (${riskScore}/100): Standard engagement acceptable`

  return {
    target,
    scan_id: `dd-${Date.now().toString(36)}`,
    generated_at: new Date().toISOString(),
    osint_findings: findings,
    mitre_techniques: applicableTechniques,
    risk_score: riskScore,
    recommendation,
  }
}

// ─── V9: MIPROv2-lite Prompt A/B Testing ────────────────────────────────────

/**
 * V9: MIPROv2-lite — DSPy-style prompt optimization through A/B testing.
 *
 * For a given task, tests multiple prompt variants and tracks quality scores.
 * Uses existing prompt-library quality_score + Redis for tracking.
 */

export interface PromptVariant {
  id: string
  prompt: string
  task_type: string
  quality_score: number    // 0-1, measured from outcomes
  usage_count: number
  created_at: string
  is_champion: boolean     // Current best variant
}

export interface ABTestResult {
  test_id: string
  task_type: string
  variants_tested: number
  champion_id: string
  champion_score: number
  improvement_pct: number  // Improvement over previous champion
  recommendation: string
}

const REDIS_AB_PREFIX = 'ab-test:'
const REDIS_AB_INDEX = 'ab-tests:index'

/**
 * Run an A/B test between the current champion prompt and a challenger.
 * Returns updated champion if challenger wins.
 */
export async function runABTest(
  taskType: string,
  challengerPrompt: string,
  challengerScore: number,
): Promise<ABTestResult> {
  const redis = getRedis()
  let champion: PromptVariant | null = null

  // Get current champion
  if (redis && isRedisEnabled()) {
    try {
      const champKey = `${REDIS_AB_PREFIX}${taskType}:champion`
      const raw = await redis.get(champKey)
      if (raw) champion = JSON.parse(raw) as PromptVariant
    } catch { /* no champion yet */ }
  }

  // Determine winner
  let newChampion: PromptVariant
  let improvementPct = 0

  if (!champion || challengerScore > champion.quality_score) {
    // Challenger wins
    improvementPct = champion
      ? Math.round(((challengerScore - champion.quality_score) / champion.quality_score) * 100)
      : 0
    newChampion = {
      id: `variant-${Date.now().toString(36)}`,
      prompt: challengerPrompt,
      task_type: taskType,
      quality_score: challengerScore,
      usage_count: 0,
      created_at: new Date().toISOString(),
      is_champion: true,
    }
  } else {
    // Champion retains
    newChampion = champion
    improvementPct = 0
  }

  // Persist new champion
  if (redis && isRedisEnabled()) {
    try {
      const champKey = `${REDIS_AB_PREFIX}${taskType}:champion`
      await redis.set(champKey, JSON.stringify(newChampion), 'EX', 365 * 24 * 3600)
      await redis.sadd(REDIS_AB_INDEX, taskType)

      // Track test history
      const historyKey = `${REDIS_AB_PREFIX}${taskType}:history`
      await redis.lpush(historyKey, JSON.stringify({
        challenger_score: challengerScore,
        champion_score: champion?.quality_score ?? 0,
        winner: newChampion.id,
        improvement_pct: improvementPct,
        tested_at: new Date().toISOString(),
      }))
      await redis.ltrim(historyKey, 0, 49) // Keep last 50 tests
    } catch (err) {
      logger.warn({ err: String(err) }, 'Failed to persist A/B test results')
    }
  }

  return {
    test_id: `ab-${Date.now().toString(36)}`,
    task_type: taskType,
    variants_tested: 2,
    champion_id: newChampion.id,
    champion_score: newChampion.quality_score,
    improvement_pct: improvementPct,
    recommendation: improvementPct > 0
      ? `New champion selected with ${improvementPct}% improvement`
      : `Current champion retained (score: ${newChampion.quality_score.toFixed(3)})`,
  }
}

/**
 * Get the current champion prompt for a task type.
 */
export async function getChampion(taskType: string): Promise<PromptVariant | null> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return null

  try {
    const champKey = `${REDIS_AB_PREFIX}${taskType}:champion`
    const raw = await redis.get(champKey)
    return raw ? JSON.parse(raw) as PromptVariant : null
  } catch {
    return null
  }
}

/**
 * Get A/B test history for a task type.
 */
export async function getABTestHistory(taskType: string): Promise<Array<Record<string, unknown>>> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return []

  try {
    const historyKey = `${REDIS_AB_PREFIX}${taskType}:history`
    const raw = await redis.lrange(historyKey, 0, -1)
    return raw.map(r => JSON.parse(r) as Record<string, unknown>)
  } catch {
    return []
  }
}

// ─── V10: Bi-temporal Fact Graph ────────────────────────────────────────────

/**
 * V10: Bi-temporal fact graph (Graphiti pattern).
 *
 * Facts have two timelines:
 *   1. asserted_at: When we learned the fact
 *   2. valid_from/valid_to: When the fact was/is/will be true in the real world
 *
 * Supersession chain: when a fact is invalidated, it's linked to its replacement.
 *
 * Uses existing :Fact nodes with added temporal properties.
 */

export interface BiTemporalFact {
  id: string
  subject: string
  predicate: string
  object: string
  asserted_at: string    // When we learned this
  valid_from: string     // When it became true
  valid_to: string | null // When it stopped being true (null = still valid)
  superseded_by: string | null // ID of the fact that replaced this one
  confidence: number
  source: string
}

const REDIS_FACT_PREFIX = 'fact:'
const REDIS_FACT_INDEX = 'facts:index'

/**
 * Assert a new bi-temporal fact.
 * If an existing fact with same (subject, predicate) is still valid,
 * mark it as superseded and link to the new fact.
 */
export async function assertFact(fact: Omit<BiTemporalFact, 'id' | 'asserted_at' | 'superseded_by'>): Promise<BiTemporalFact> {
  const id = `fact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const now = new Date().toISOString()

  const newFact: BiTemporalFact = {
    id,
    asserted_at: now,
    superseded_by: null,
    ...fact,
  }

  const redis = getRedis()
  if (redis && isRedisEnabled()) {
    try {
      // Find existing valid facts with same subject+predicate
      const existingFacts = await findActiveFacts(fact.subject, fact.predicate)

      for (const existing of existingFacts) {
        // Supersede the old fact
        existing.valid_to = now
        existing.superseded_by = id
        await redis.set(`${REDIS_FACT_PREFIX}${existing.id}`, JSON.stringify(existing))
      }

      // Store new fact
      await redis.set(`${REDIS_FACT_PREFIX}${id}`, JSON.stringify(newFact))
      await redis.sadd(REDIS_FACT_INDEX, id)
    } catch (err) {
      logger.warn({ err: String(err) }, 'Failed to persist bi-temporal fact')
    }
  }

  // Also persist to Neo4j
  try {
    const { config } = await import('../config.js')
    await fetch(`${config.backendUrl}/api/mcp/route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.backendApiKey ? { 'Authorization': `Bearer ${config.backendApiKey}` } : {}),
      },
      body: JSON.stringify({
        tool: 'graph.write_cypher',
        payload: {
          query: `MERGE (f:Fact {id: $id})
                  SET f.subject = $subject, f.predicate = $predicate, f.object = $object,
                      f.asserted_at = datetime($asserted_at),
                      f.valid_from = datetime($valid_from),
                      f.valid_to = CASE WHEN $valid_to IS NOT NULL THEN datetime($valid_to) ELSE NULL END,
                      f.superseded_by = $superseded_by,
                      f.confidence = $confidence, f.source = $source`,
          params: {
            id,
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            asserted_at: now,
            valid_from: fact.valid_from,
            valid_to: fact.valid_to,
            superseded_by: null,
            confidence: fact.confidence,
            source: fact.source,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => {})
  } catch {
    // Non-fatal — fact stored in Redis regardless
  }

  return newFact
}

/**
 * Find all currently valid facts for a subject+predicate.
 */
async function findActiveFacts(subject: string, predicate: string): Promise<BiTemporalFact[]> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return []

  try {
    const ids = await redis.smembers(REDIS_FACT_INDEX)
    const facts: BiTemporalFact[] = []

    for (const id of ids.slice(0, 200)) {
      const raw = await redis.get(`${REDIS_FACT_PREFIX}${id}`)
      if (raw) {
        const fact = JSON.parse(raw) as BiTemporalFact
        if (fact.subject === subject && fact.predicate === predicate && fact.valid_to === null) {
          facts.push(fact)
        }
      }
    }

    return facts
  } catch {
    return []
  }
}

/**
 * Query facts with temporal filters.
 */
export async function queryFacts(opts: {
  subject?: string
  predicate?: string
  as_of?: string     // What was true at this point in time?
  limit?: number
}): Promise<BiTemporalFact[]> {
  const redis = getRedis()
  if (!redis || !isRedisEnabled()) return []

  try {
    const ids = await redis.smembers(REDIS_FACT_INDEX)
    const facts: BiTemporalFact[] = []

    for (const id of ids.slice(0, 500)) {
      const raw = await redis.get(`${REDIS_FACT_PREFIX}${id}`)
      if (raw) {
        const fact = JSON.parse(raw) as BiTemporalFact

        // Apply filters
        if (opts.subject && fact.subject !== opts.subject) continue
        if (opts.predicate && fact.predicate !== opts.predicate) continue

        // Temporal filter: fact must be valid at as_of time
        if (opts.as_of) {
          if (fact.valid_from > opts.as_of) continue
          if (fact.valid_to && fact.valid_to < opts.as_of) continue
        }

        facts.push(fact)
      }
    }

    return facts.slice(0, opts.limit ?? 50)
  } catch {
    return []
  }
}

// ─── MCP Tool Handlers ───────────────────────────────────────────────────────

export async function handleDueDiligence(request: AgentRequest): Promise<AgentResponse> {
  try {
    const target = typeof request.context?.target === 'string' ? request.context.target : null
    if (!target) return agentFailure(request, 'No target provided. Include target in context.target')

    const report = await runDueDiligence(target)
    const lines = [
      `# Due Diligence Report: ${report.target}`,
      ``,
      `**Scan ID:** ${report.scan_id}`,
      `**Generated:** ${report.generated_at}`,
      `**Risk Score:** ${report.risk_score}/100`,
      ``,
      `## Recommendation`,
      report.recommendation,
      ``,
    ]

    if (report.osint_findings.length > 0) {
      lines.push(`## OSINT Findings`)
      lines.push(``)
      for (const f of report.osint_findings) {
        lines.push(`- [${f.severity.toUpperCase()}] ${f.category}: ${f.finding}`)
      }
      lines.push(``)
    }

    if (report.mitre_techniques.length > 0) {
      lines.push(`## MITRE ATLAS AI Techniques`)
      lines.push(``)
      for (const t of report.mitre_techniques) {
        lines.push(`- ${t.id}: ${t.name} (relevance: ${(t.relevance * 100).toFixed(0)}%)`)
      }
    }

    return agentSuccess(request, lines.join('\n'), { input: 0, output: lines.length * 10 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}

export async function handlePromptABTest(request: AgentRequest): Promise<AgentResponse> {
  try {
    const taskType = typeof request.context?.task_type === 'string' ? request.context.task_type : null
    const prompt = typeof request.context?.prompt === 'string' ? request.context.prompt : null
    const score = typeof request.context?.score === 'number' ? request.context.score : null

    if (!taskType || !prompt || score === null) {
      return agentFailure(request, 'task_type, prompt, and score required in context')
    }

    const result = await runABTest(taskType, prompt, score)
    return agentSuccess(request, JSON.stringify(result, null, 2), { input: 0, output: 200 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}

export async function handleFactAssertion(request: AgentRequest): Promise<AgentResponse> {
  try {
    const subject = typeof request.context?.subject === 'string' ? request.context.subject : null
    const predicate = typeof request.context?.predicate === 'string' ? request.context.predicate : null
    const object = typeof request.context?.object === 'string' ? request.context.object : null
    const validFrom = typeof request.context?.valid_from === 'string' ? request.context.valid_from : new Date().toISOString()
    const confidence = typeof request.context?.confidence === 'number' ? request.context.confidence : 0.8
    const source = typeof request.context?.source === 'string' ? request.context.source : 'manual'

    if (!subject || !predicate || !object) {
      return agentFailure(request, 'subject, predicate, and object required in context')
    }

    const fact = await assertFact({
      subject, predicate, object,
      valid_from: validFrom,
      valid_to: null,
      confidence, source,
    })

    return agentSuccess(request, JSON.stringify(fact, null, 2), { input: 0, output: 150 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}

export async function handleFactQuery(request: AgentRequest): Promise<AgentResponse> {
  try {
    const subject = typeof request.context?.subject === 'string' ? request.context.subject : undefined
    const predicate = typeof request.context?.predicate === 'string' ? request.context.predicate : undefined
    const asOf = typeof request.context?.as_of === 'string' ? request.context.as_of : undefined
    const limit = typeof request.context?.limit === 'number' ? request.context.limit : 50

    const facts = await queryFacts({ subject, predicate, as_of: asOf, limit })
    return agentSuccess(request, JSON.stringify({ count: facts.length, facts }, null, 2), { input: 0, output: facts.length * 100 })
  } catch (err) {
    return agentFailure(request, err instanceof Error ? err.message : String(err))
  }
}
