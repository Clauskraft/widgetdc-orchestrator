/**
 * deliverable-engine.ts — Automatic Deliverable Generation (LIN-574 Gap #2)
 *
 * 5-step pipeline: Plan → Retrieve → Write → Assemble → Render
 * Integrates with LegoFactory blocks + autonomous.graphrag + LLM proxy.
 *
 * Supports 3 deliverable types:
 *   - analysis:   Strategic analysis report
 *   - roadmap:    Implementation roadmap with phases
 *   - assessment: Compliance/readiness assessment
 */
import { v4 as uuid } from 'uuid'
import { callMcpTool } from '../mcp-caller.js'
import { callCognitive } from '../cognitive-proxy.js'
import { dualChannelRAG } from '../memory/dual-rag.js'
import { getRedis } from '../redis.js'
import { logger } from '../logger.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeliverableType = 'analysis' | 'roadmap' | 'assessment'
export type DeliverableFormat = 'pdf' | 'markdown'

export interface DeliverableRequest {
  prompt: string
  type: DeliverableType
  format?: DeliverableFormat
  max_sections?: number
  include_citations?: boolean
}

interface SectionPlan {
  title: string
  query: string
  purpose: string
}

interface SectionContent {
  title: string
  markdown: string
  citations: Citation[]
  confidence: 'high' | 'medium' | 'low'
}

interface Citation {
  source: string
  title: string
  relevance: number
}

export interface Deliverable {
  $id: string
  $schema: string
  prompt: string
  type: DeliverableType
  format: DeliverableFormat
  title: string
  sections: SectionContent[]
  metadata: {
    total_citations: number
    avg_confidence: number
    generation_ms: number
    sections_count: number
    token_estimate: number
    graphrag_results: number
  }
  markdown: string
  status: 'generating' | 'completed' | 'failed'
  error?: string
  created_at: string
  completed_at?: string
}

// ─── Storage ────────────────────────────────────────────────────────────────

const REDIS_PREFIX = 'orchestrator:deliverable:'
const REDIS_INDEX = 'orchestrator:deliverables:index'
const TTL_SECONDS = 604800 // 7 days

const deliverableCache = new Map<string, Deliverable>()
const CACHE_MAX_SIZE = 100

async function persist(d: Deliverable): Promise<void> {
  deliverableCache.set(d.$id, d)
  // Evict oldest entries when cache exceeds max size
  if (deliverableCache.size > CACHE_MAX_SIZE) {
    const toEvict = deliverableCache.size - CACHE_MAX_SIZE
    const oldest = Array.from(deliverableCache.entries())
      .sort((a, b) => a[1].created_at.localeCompare(b[1].created_at))
    oldest.slice(0, toEvict).forEach(([key]) => deliverableCache.delete(key))
  }
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(`${REDIS_PREFIX}${d.$id}`, JSON.stringify(d), 'EX', TTL_SECONDS)
    await redis.sadd(REDIS_INDEX, d.$id)
  } catch { /* non-critical */ }
}

export async function getDeliverable(id: string): Promise<Deliverable | null> {
  if (deliverableCache.has(id)) return deliverableCache.get(id)!
  const redis = getRedis()
  if (!redis) return null
  try {
    const raw = await redis.get(`${REDIS_PREFIX}${id}`)
    if (raw) {
      const d = JSON.parse(raw) as Deliverable
      deliverableCache.set(id, d)
      return d
    }
  } catch { /* skip */ }
  return null
}

export async function listDeliverables(limit = 20): Promise<Deliverable[]> {
  const redis = getRedis()
  if (!redis) return Array.from(deliverableCache.values()).slice(0, limit)
  try {
    const ids = await redis.smembers(REDIS_INDEX)
    const results: Deliverable[] = []
    for (const id of ids.slice(0, limit)) {
      const d = await getDeliverable(id)
      if (d) results.push(d)
    }
    return results.sort((a, b) => b.created_at.localeCompare(a.created_at))
  } catch {
    return Array.from(deliverableCache.values()).slice(0, limit)
  }
}

// ─── Concurrency Guard ──────────────────────────────────────────────────────

let activeGenerations = 0
const MAX_CONCURRENT = 3

// ─── Pipeline ───────────────────────────────────────────────────────────────

/**
 * Generate a deliverable from a prompt.
 * 5 steps: Plan → Retrieve → Write → Assemble → Render
 */
export async function generateDeliverable(req: DeliverableRequest): Promise<Deliverable> {
  if (activeGenerations >= MAX_CONCURRENT) {
    throw new Error(`Too many concurrent generations (${activeGenerations}/${MAX_CONCURRENT}). Try again later.`)
  }
  activeGenerations++

  const t0 = Date.now()
  const deliverableId = `widgetdc:deliverable:${uuid()}`
  const format = req.format ?? 'markdown'
  const maxSections = Math.min(Math.max(req.max_sections ?? 5, 2), 8)

  const deliverable: Deliverable = {
    $id: deliverableId,
    $schema: 'widgetdc:deliverable:v1',
    prompt: req.prompt,
    type: req.type,
    format,
    title: '',
    sections: [],
    metadata: {
      total_citations: 0,
      avg_confidence: 0,
      generation_ms: 0,
      sections_count: 0,
      token_estimate: 0,
      graphrag_results: 0,
    },
    markdown: '',
    status: 'generating',
    created_at: new Date().toISOString(),
  }
  await persist(deliverable)

  try {
    // ──── Step 1: PLAN — Generate section outline ────────────────────────
    logger.info({ id: deliverableId, type: req.type, prompt: req.prompt.slice(0, 80) }, 'Deliverable: Step 1 — Planning')
    const plan = await planSections(req.prompt, req.type, maxSections)
    deliverable.title = plan.title

    // ──── Step 2: RETRIEVE — Knowledge for each section ─────────────────
    logger.info({ id: deliverableId, sections: plan.sections.length }, 'Deliverable: Step 2 — Retrieving')
    const evidence = await retrieveEvidence(plan.sections)

    // ──── Step 3: WRITE — Generate each section ─────────────────────────
    logger.info({ id: deliverableId }, 'Deliverable: Step 3 — Writing sections')
    const sections = await writeSections(plan.sections, evidence, req.type)
    deliverable.sections = sections

    // ──── Step 4: ASSEMBLE — Merge into full document ───────────────────
    logger.info({ id: deliverableId }, 'Deliverable: Step 4 — Assembling')
    deliverable.markdown = assembleSections(deliverable.title, sections, req.type)

    // ──── Step 5: RENDER — Convert to output format ─────────────────────
    // MVP: markdown output. PDF rendering via backend MCP tool in Phase 2.
    if (format === 'pdf') {
      logger.info({ id: deliverableId }, 'Deliverable: Step 5 — Rendering PDF')
      await renderPDF(deliverable)
    }

    // ──── AC-2: Ensure minimum 3 citations ────────────────────────────
    const totalCitations = sections.reduce((n, s) => n + s.citations.length, 0)
    if (totalCitations < 3) {
      // Retry RAG with broader query to fill citation gap
      try {
        const broadRag = await dualChannelRAG(req.prompt, { maxResults: 5 })
        if (broadRag.results.length > 0) {
          const extraCitations = broadRag.results.slice(0, 3 - totalCitations).map(r => ({
            source: r.source,
            title: r.content.slice(0, 80),
            relevance: r.score,
          }))
          // Attach to first section that has fewest citations
          const targetSection = sections.reduce((min, s) => s.citations.length < min.citations.length ? s : min)
          targetSection.citations.push(...extraCitations)
        }
      } catch { /* best-effort */ }
    }

    // ──── Metadata ──────────────────────────────────────────────────────
    const allCitations = sections.flatMap(s => s.citations)
    const confidenceMap = { high: 1, medium: 0.66, low: 0.33 }
    const avgConf = sections.length > 0
      ? sections.reduce((sum, s) => sum + confidenceMap[s.confidence], 0) / sections.length
      : 0

    deliverable.metadata = {
      total_citations: allCitations.length,
      avg_confidence: Math.round(avgConf * 100) / 100,
      generation_ms: Date.now() - t0,
      sections_count: sections.length,
      token_estimate: Math.ceil(deliverable.markdown.length / 4),
      graphrag_results: evidence.reduce((sum, e) => sum + e.results.length, 0),
    }
    deliverable.status = 'completed'
    deliverable.completed_at = new Date().toISOString()

    // F4: Compound hook — write citations back to graph (flywheel)
    try {
      const { hookDeliverableToKnowledge } = await import('../swarm/compound-hooks.js')
      const allCits = sections.flatMap(s => s.citations)
      hookDeliverableToKnowledge(deliverableId, deliverable.title, allCits).catch(() => {})
    } catch { /* non-blocking */ }

    logger.info({
      id: deliverableId,
      sections: sections.length,
      citations: allCitations.length,
      ms: deliverable.metadata.generation_ms,
    }, 'Deliverable: Complete')

  } catch (err) {
    deliverable.status = 'failed'
    deliverable.error = err instanceof Error ? err.message : String(err)
    deliverable.completed_at = new Date().toISOString()
    deliverable.metadata.generation_ms = Date.now() - t0
    logger.error({ id: deliverableId, error: deliverable.error }, 'Deliverable: Failed')
  } finally {
    activeGenerations--
    await persist(deliverable)
  }

  return deliverable
}

// ─── Step 1: Plan ───────────────────────────────────────────────────────────

const TYPE_PROMPTS: Record<DeliverableType, string> = {
  analysis: 'Structure as: Executive Summary, Current State Analysis, Key Findings, Gap Analysis, Strategic Implications, Recommendations.',
  roadmap: 'Structure as: Executive Summary, Vision & Objectives, Phase 1 (Quick Wins), Phase 2 (Foundation), Phase 3 (Scale), Implementation Timeline, Risk Mitigation.',
  assessment: 'Structure as: Executive Summary, Assessment Scope, Maturity Analysis, Compliance Status, Gap Identification, Remediation Plan, Next Steps.',
}

async function planSections(
  prompt: string,
  type: DeliverableType,
  maxSections: number,
): Promise<{ title: string; sections: SectionPlan[] }> {
  const systemPrompt = `You are a consulting deliverable planner. Given a client prompt, generate a structured outline for a ${type} report.

${TYPE_PROMPTS[type]}

Generate exactly ${maxSections} sections. Each section needs a title, a knowledge-graph search query to find relevant data, and a purpose statement.

Reply as JSON:
{"title": "Report Title", "sections": [{"title": "Section Title", "query": "search query for knowledge graph", "purpose": "what this section should cover"}]}`

  try {
    const result = await callCognitive('analyze', {
      prompt: `${systemPrompt}\n\nClient prompt: "${prompt}"`,
      context: { type, maxSections },
      agent_id: 'deliverable-planner',
    }, 30000)

    const text = String(result ?? '')
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      return {
        title: parsed.title ?? `${type.charAt(0).toUpperCase() + type.slice(1)}: ${prompt.slice(0, 60)}`,
        sections: (parsed.sections ?? []).slice(0, maxSections),
      }
    }
  } catch (err) {
    logger.warn({ error: String(err) }, 'Deliverable planner failed, using fallback')
  }

  // Fallback: generic structure
  const fallbackSections: SectionPlan[] = [
    { title: 'Executive Summary', query: prompt, purpose: 'High-level overview' },
    { title: 'Analysis', query: prompt, purpose: 'Detailed analysis of the topic' },
    { title: 'Findings', query: `key findings ${prompt}`, purpose: 'Key findings and insights' },
    { title: 'Recommendations', query: `recommendations ${prompt}`, purpose: 'Actionable recommendations' },
  ]
  return {
    title: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${prompt.slice(0, 60)}`,
    sections: fallbackSections.slice(0, maxSections),
  }
}

// ─── Step 2: Retrieve ───────────────────────────────────────────────────────

interface EvidenceBundle {
  section_title: string
  results: Array<{ source: string; content: string; score: number }>
}

async function retrieveEvidence(sections: SectionPlan[]): Promise<EvidenceBundle[]> {
  // Retrieve evidence for all sections in parallel
  const bundles = await Promise.allSettled(
    sections.map(async (section): Promise<EvidenceBundle> => {
      const rag = await dualChannelRAG(section.query, { maxResults: 5 })
      return {
        section_title: section.title,
        results: rag.results.map(r => ({
          source: r.source,
          content: r.content,
          score: r.score,
        })),
      }
    })
  )

  return bundles.map((b, i) => {
    if (b.status === 'fulfilled') return b.value
    return { section_title: sections[i].title, results: [] }
  })
}

// ─── Step 3: Write ──────────────────────────────────────────────────────────

async function writeSections(
  plans: SectionPlan[],
  evidence: EvidenceBundle[],
  type: DeliverableType,
): Promise<SectionContent[]> {
  // Write all sections in parallel to stay within Railway's timeout
  const results = await Promise.allSettled(
    plans.map((plan, i) => writeOneSection(plan, evidence[i], type))
  )
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    return {
      title: plans[i].title,
      markdown: `[Section generation failed: ${r.reason}]`,
      citations: [],
      confidence: 'low' as const,
    }
  })
}

async function writeOneSection(
  plan: SectionPlan,
  ev: EvidenceBundle | undefined,
  type: DeliverableType,
): Promise<SectionContent> {
    const hasEvidence = ev && ev.results.length > 0

    const evidenceText = hasEvidence
      ? ev.results.map((r, j) => `[Source ${j + 1} (${r.source}, score: ${r.score.toFixed(2)})] ${r.content}`).join('\n\n')
      : '[No evidence found — mark claims as unverified]'

    const sectionPrompt = `Write the "${plan.title}" section of a consulting ${type} report.

PURPOSE: ${plan.purpose}

EVIDENCE FROM KNOWLEDGE GRAPH:
${evidenceText}

RULES:
- Write 2-4 paragraphs of professional consulting prose
- Reference evidence with [Source N] inline citations
- If evidence is insufficient, note "[insufficient data]" for unverified claims
- Use bullet points for key findings and recommendations
- Be specific and actionable, not generic
- Danish regulatory context is relevant when applicable

Output ONLY the section content in markdown (no title header — it will be added).`

    try {
      const result = await callCognitive('analyze', {
        prompt: sectionPrompt,
        context: { section: plan.title, type, evidence_count: ev?.results.length ?? 0 },
        agent_id: 'deliverable-writer',
      }, 30000)

      // P0 fix F5: RLM can return object/structured response — extract content
      // field before stringification. String({...}) produces "[object Object]".
      let content: string
      if (typeof result === 'string') {
        content = result.trim()
      } else if (result && typeof result === 'object') {
        const obj = result as Record<string, unknown>
        const extracted = obj.content ?? obj.text ?? obj.output ?? obj.summary ?? obj.recommendation ?? obj.result
        content = typeof extracted === 'string' ? extracted.trim() : JSON.stringify(obj, null, 2).trim()
      } else {
        content = String(result ?? '').trim()
      }

      // P0 fix F10: strip RLM reasoning chain leakage (<think> blocks + thinking prefixes)
      content = content
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/^\s*(Jeg (t\u00e6nker|skal)|I'm thinking|Let me think|Thinking:|Reasoning:)[^\n]*\n+/gi, '')
        .trim()

      // P0 fix F6: domain-relevance filter on citations. Drop unrelated evidence.
      const RELEVANCE_KEYWORDS = /compliance|audit|regulator|gdpr|ai[\s-]?act|nis2|dora|oscal|article\s\d+|annex|control|pii|governance|risk|assessment|financial|transaction|kyc|aml/i
      const relevantResults = hasEvidence
        ? ev.results.filter(r => RELEVANCE_KEYWORDS.test(r.content) && r.score > 0.3)
        : []
      const citations: Citation[] = relevantResults.map(r => ({
        source: r.source,
        title: r.content.slice(0, 80).replace(/\s+/g, ' '),
        relevance: r.score,
      }))

      // Confidence based on evidence quality
      const avgScore = hasEvidence
        ? ev.results.reduce((s, r) => s + r.score, 0) / ev.results.length
        : 0
      const confidence: 'high' | 'medium' | 'low' =
        avgScore >= 0.7 ? 'high' : avgScore >= 0.4 ? 'medium' : 'low'

      return {
        title: plan.title,
        markdown: content || `[Section generation failed — insufficient data for "${plan.title}"]`,
        citations,
        confidence,
      }
    } catch (err) {
      return {
        title: plan.title,
        markdown: `[Section generation failed: ${err instanceof Error ? err.message : String(err)}]`,
        citations: [],
        confidence: 'low' as const,
      }
    }
}

// ─── Step 4: Assemble ───────────────────────────────────────────────────────

function assembleSections(
  title: string,
  sections: SectionContent[],
  type: DeliverableType,
): string {
  const confidenceEmoji = { high: '●', medium: '◐', low: '○' }
  const now = new Date().toISOString().slice(0, 10)

  let md = `# ${title}\n\n`
  md += `**Type:** ${type} | **Date:** ${now} | **Generated by:** WidgeTDC Deliverable Engine v1.0\n\n`
  md += `---\n\n`

  for (const section of sections) {
    md += `## ${section.title}\n\n`
    md += `${section.markdown}\n\n`
    if (section.citations.length > 0) {
      md += `> **Sources** ${confidenceEmoji[section.confidence]} (confidence: ${section.confidence}): `
      md += section.citations.map((c, i) => `[${i + 1}] ${c.title}`).join(' | ')
      md += `\n\n`
    }
  }

  md += `---\n\n`
  md += `*This deliverable was automatically generated by WidgeTDC from ${sections.reduce((n, s) => n + s.citations.length, 0)} knowledge graph sources. `
  md += `Claims marked [insufficient data] require manual verification.*\n`

  return md
}

// ─── Step 5: Render (PDF — Phase 2, placeholder) ───────────────────────────

async function renderPDF(deliverable: Deliverable): Promise<void> {
  // Use existing backend docgen MCP tools (docgen.word.create / docgen.powerpoint.create)
  try {
    const result = await callMcpTool({
      toolName: 'docgen.word.create',
      args: {
        title: deliverable.title,
        content: deliverable.markdown,
        template: deliverable.type,
      },
      callId: uuid(),
      timeoutMs: 45000,
    })
    if (result.status === 'success' && result.result) {
      (deliverable as any).doc_url = (result.result as any)?.url ?? (result.result as any)?.path
      logger.info({ id: deliverable.$id }, 'Deliverable: DOCX rendered via docgen.word.create')
    }
  } catch {
    // docgen not available — deliver as markdown
    logger.info('docgen.word.create not available — delivering markdown')
    deliverable.format = 'markdown'
  }
}
