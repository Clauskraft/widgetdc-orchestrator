/**
 * phantom-skill-router.ts — Evidence-based skill routing via Phantom BOM
 *
 * Uses Phantom BOM component data to influence skill composition selection.
 * Instead of pure text-heuristics, routing is now evidence-based:
 *
 * - Phantom BOM shows many external sources → weight harvest-to-pattern-library higher
 * - Phantom BOM shows existing canonical nodes → weight research-to-standard higher
 * - Phantom BOM matches task to MCPTool/Pattern/Service → suggest reuse before new design
 * - Phantom BOM shows low coverage → force flow-discover early
 * - Phantom BOM shows high confidence → compress composition, go faster to flow-develop
 *
 * Architecture:
 *   TaskIntent + PhantomEvidence + CapabilityGraph → SkillCompositionPattern
 */
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PhantomEvidence {
  componentCount: number
  externalSourceCount: number
  canonicalNodeCount: number
  knownCapabilityMatches: number
  unknownRelationCount: number
  avgConfidence: number
  hasRuntimeSurface: boolean
  coverageScore: number  // 0-1, how well the repo is covered by known components
}

export interface SkillCompositionWeight {
  pattern: string
  weight: number         // 0-1, adjusted by Phantom evidence
  baseWeight: number     // 0-1, original weight without evidence
  evidenceFactors: string[]
}

export interface EvidenceBasedRouting {
  intent: string
  phantomEvidence: PhantomEvidence
  recommendedPatterns: SkillCompositionWeight[]
  reuseSuggestions: string[]
  warnings: string[]
  confidence: number     // 0-1, overall routing confidence
}

// ─── Skill Composition Patterns (canonical methods) ─────────────────────────

interface PatternDef {
  id: string
  name: string
  description: string
  skills: string[]
  triggers: string[]      // When this pattern should be considered
  baseWeight: number      // Default weight without evidence
}

const SKILL_COMPOSITION_PATTERNS: PatternDef[] = [
  {
    // Loop A — PHANTOM_SKILL_LOOPS spec §4
    id: 'harvest-to-pattern-library',
    name: 'Loop A — Harvest To Pattern Library',
    description: 'Convert external components into reusable internal capability patterns.',
    skills: ['flow-discover', 'skill-intent-contract', 'omega-sentinel', 'skill-verify'],
    triggers: ['external', 'new-repo', 'unknown-components', 'many-sources', 'low-coverage'],
    baseWeight: 0.2,
  },
  {
    // Loop B — PHANTOM_SKILL_LOOPS spec §4
    id: 'reuse-before-design',
    name: 'Loop B — Reuse Before Design',
    description: 'Prevent unnecessary rebuilds — rank reuse candidates before any new design.',
    skills: ['flow-discover', 'skill-decision-support', 'skill-verify', 'omega-sentinel'],
    triggers: ['capability-match', 'existing-tool', 'existing-pattern', 'known-capability'],
    baseWeight: 0.25,
  },
  {
    // Loop C — PHANTOM_SKILL_LOOPS spec §4
    id: 'research-to-standard',
    name: 'Loop C — Research To Standard',
    description: 'Convert scattered evidence into canonical standards, templates, and contracts.',
    skills: ['flow-discover', 'flow-spec', 'omega-sentinel', 'skill-verify'],
    triggers: ['canonical', 'existing-nodes', 'templates', 'policies', 'fragmented-patterns'],
    baseWeight: 0.2,
  },
  {
    // Loop D — PHANTOM_SKILL_LOOPS spec §4
    id: 'standard-to-implementation',
    name: 'Loop D — Standard To Implementation',
    description: 'Ship against known standards with minimal exploratory overhead.',
    skills: ['flow-develop', 'skill-tdd', 'omega-sentinel', 'skill-verify'],
    triggers: ['implementation', 'known-standard', 'runtime-surface', 'high-confidence'],
    baseWeight: 0.2,
  },
  {
    // Loop E — PHANTOM_SKILL_LOOPS spec §4
    id: 'adoption-flywheel',
    name: 'Loop E — Adoption Flywheel',
    description: 'Turn execution results into ranked adoption signals — route better next time.',
    skills: ['skill-iterative-loop', 'skill-status', 'flow-deliver', 'skill-verify'],
    triggers: ['post-delivery', 'adoption', 'ranking', 'telemetry', 'quality-signal'],
    baseWeight: 0.15,
  },
]

// ─── Phantom BOM Evidence Extraction ─────────────────────────────────────────

/**
 * Query Neo4j for Phantom BOM evidence about a repo/domain.
 * Returns structured evidence for skill routing decisions.
 */
export async function extractPhantomEvidence(
  repoOrDomain: string,
): Promise<PhantomEvidence> {
  try {
    // Query component counts
    const componentResult = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `
          MATCH (c:PhantomComponent)
          WHERE c.source_repo CONTAINS $repo OR c.domain CONTAINS $repo
          RETURN
            count(c) AS componentCount,
            count(CASE WHEN c.source_type = 'external' THEN 1 END) AS externalSourceCount,
            count(CASE WHEN c.is_canonical = true THEN 1 END) AS canonicalNodeCount,
            avg(coalesce(c.confidence, 0)) AS avgConfidence
        `,
        params: { repo: repoOrDomain },
      },
      callId: `phantom-evidence-components-${Date.now()}`,
    })

    // Query capability matches
    const matchResult = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `
          MATCH (c:PhantomComponent)-[:MAPS_TO]->(target)
          WHERE c.source_repo CONTAINS $repo OR c.domain CONTAINS $repo
          RETURN count(DISTINCT target) AS knownCapabilityMatches
        `,
        params: { repo: repoOrDomain },
      },
      callId: `phantom-evidence-matches-${Date.now()}`,
    })

    // Query unknown relations
    const unknownResult = await callMcpTool({
      toolName: 'graph.read_cypher',
      args: {
        query: `
          MATCH (c:PhantomComponent)
          WHERE c.source_repo CONTAINS $repo OR c.domain CONTAINS $repo
          OPTIONAL MATCH (c)-[r]->()
          WITH c, count(r) AS relCount
          RETURN
            count(CASE WHEN relCount = 0 THEN 1 END) AS unknownRelationCount,
            avg(coalesce(c.confidence, 0)) AS avgConfidence
        `,
        params: { repo: repoOrDomain },
      },
      callId: `phantom-evidence-unknown-${Date.now()}`,
    })

    // Parse results (handle various response formats)
    const parseCount = (result: unknown, key: string): number => {
      const r = result as Record<string, unknown> | null
      const results = (r?.results as Array<Record<string, unknown>> | null) ?? []
      if (results.length === 0) return 0
      const val = results[0]?.[key]
      if (typeof val === 'object' && val !== null && 'low' in val) {
        return (val as { low: number }).low
      }
      return Number(val) || 0
    }

    const componentCount = parseCount(componentResult, 'componentCount')
    const externalSourceCount = parseCount(componentResult, 'externalSourceCount')
    const canonicalNodeCount = parseCount(componentResult, 'canonicalNodeCount')
    const knownCapabilityMatches = parseCount(matchResult, 'knownCapabilityMatches')
    const unknownRelationCount = parseCount(unknownResult, 'unknownRelationCount')
    const avgConfidence = parseCount(unknownResult, 'avgConfidence') / 100 // Neo4j returns 0-100

    const totalRelations = knownCapabilityMatches + unknownRelationCount
    const coverageScore = totalRelations > 0
      ? knownCapabilityMatches / totalRelations
      : 0

    return {
      componentCount,
      externalSourceCount,
      canonicalNodeCount,
      knownCapabilityMatches,
      unknownRelationCount,
      avgConfidence,
      hasRuntimeSurface: canonicalNodeCount > 0,
      coverageScore,
    }
  } catch (err) {
    logger.warn({ err: String(err), repo: repoOrDomain }, 'Failed to extract Phantom evidence')
    // Return neutral evidence on failure
    return {
      componentCount: 0,
      externalSourceCount: 0,
      canonicalNodeCount: 0,
      knownCapabilityMatches: 0,
      unknownRelationCount: 0,
      avgConfidence: 0.5,
      hasRuntimeSurface: false,
      coverageScore: 0.5,
    }
  }
}

// ─── Evidence-Based Skill Routing ────────────────────────────────────────────

/**
 * Compute skill composition weights based on Phantom BOM evidence.
 *
 * Rules (canonical loop selection per PHANTOM_SKILL_LOOPS spec §5):
 * - Many external sources → boost Loop A (harvest-to-pattern-library)
 * - Existing canonical nodes → boost Loop C (research-to-standard)
 * - Known capability matches → boost Loop B (reuse-before-design)
 * - Low coverage → force Loop A or C before implementation
 * - High confidence + runtime surface → compress to Loop D (standard-to-implementation)
 * - Post-delivery with known capabilities → trigger Loop E (adoption-flywheel)
 */
export function computeEvidenceBasedRouting(
  intent: string,
  evidence: PhantomEvidence,
): EvidenceBasedRouting {
  const patterns: SkillCompositionWeight[] = SKILL_COMPOSITION_PATTERNS.map(p => ({
    pattern: p.id,
    weight: p.baseWeight,
    baseWeight: p.baseWeight,
    evidenceFactors: [],
  }))

  const reuseSuggestions: string[] = []
  const warnings: string[] = []

  // Rule 1: Many external sources → boost harvest-to-pattern-library
  if (evidence.externalSourceCount > 3) {
    const p = patterns.find(p => p.pattern === 'harvest-to-pattern-library')
    if (p) {
      p.weight = Math.min(1, p.weight + 0.3)
      p.evidenceFactors.push(`${evidence.externalSourceCount} external sources detected`)
    }
  }

  // Rule 2: Existing canonical nodes → boost research-to-standard
  if (evidence.canonicalNodeCount > 0) {
    const p = patterns.find(p => p.pattern === 'research-to-standard')
    if (p) {
      p.weight = Math.min(1, p.weight + 0.25)
      p.evidenceFactors.push(`${evidence.canonicalNodeCount} canonical nodes exist`)
    }
    reuseSuggestions.push(`Review ${evidence.canonicalNodeCount} existing canonical nodes before creating new standards`)
  }

  // Rule 3: Known capability matches → boost reuse-before-design
  if (evidence.knownCapabilityMatches > 0) {
    const p = patterns.find(p => p.pattern === 'reuse-before-design')
    if (p) {
      p.weight = Math.min(1, p.weight + 0.3)
      p.evidenceFactors.push(`${evidence.knownCapabilityMatches} capability matches found`)
    }
    reuseSuggestions.push(`${evidence.knownCapabilityMatches} existing capabilities match — consider reuse before new design`)
  }

  // Rule 4: Low coverage → force Loop A (harvest) before implementation (spec §5 rule 2)
  if (evidence.coverageScore < 0.3) {
    const p = patterns.find(p => p.pattern === 'harvest-to-pattern-library')
    if (p) {
      p.weight = Math.min(1, p.weight + 0.4)
      p.evidenceFactors.push(`Low coverage (${(evidence.coverageScore * 100).toFixed(0)}%) — harvest + discovery required`)
    }
    // Also boost Loop C if canonical nodes exist (spec §5 rule 2)
    if (evidence.canonicalNodeCount > 0) {
      const cP = patterns.find(p => p.pattern === 'research-to-standard')
      if (cP) {
        cP.weight = Math.min(1, cP.weight + 0.15)
        cP.evidenceFactors.push('Low coverage but canonical nodes exist — research to standard')
      }
    }
    warnings.push(`Low Phantom BOM coverage (${(evidence.coverageScore * 100).toFixed(0)}%) — start with Loop A or C before implementation`)
  }

  // Rule 5: High confidence + known runtime → compress to Loop D (spec §5 rule 4)
  if (evidence.avgConfidence > 0.8 && evidence.hasRuntimeSurface) {
    const p = patterns.find(p => p.pattern === 'standard-to-implementation')
    if (p) {
      p.weight = Math.min(1, p.weight + 0.35)
      p.evidenceFactors.push(`High confidence (${(evidence.avgConfidence * 100).toFixed(0)}%) + runtime surface known — direct to Loop D`)
    }
    // Reduce harvest weight since domain is well understood
    const harvestP = patterns.find(p => p.pattern === 'harvest-to-pattern-library')
    if (harvestP) {
      harvestP.weight = Math.max(0.05, harvestP.weight - 0.15)
      harvestP.evidenceFactors.push('Domain well-understood — minimal harvesting needed')
    }
  }

  // Rule 6: Many unknown relations → boost Loop A (harvest + discovery)
  if (evidence.unknownRelationCount > 5) {
    const p = patterns.find(p => p.pattern === 'harvest-to-pattern-library')
    if (p) {
      p.weight = Math.min(1, p.weight + 0.2)
      p.evidenceFactors.push(`${evidence.unknownRelationCount} unknown relations need mapping`)
    }
    warnings.push(`${evidence.unknownRelationCount} components have no known relations — map dependencies before implementation`)
  }

  // Rule 7: Any completed delivery → trigger Loop E (adoption flywheel, spec §5 rule 5)
  if (evidence.hasRuntimeSurface && evidence.knownCapabilityMatches > 0) {
    const p = patterns.find(p => p.pattern === 'adoption-flywheel')
    if (p) {
      p.weight = Math.min(1, p.weight + 0.15)
      p.evidenceFactors.push('Runtime surface + known capabilities — feed adoption telemetry')
    }
  }

  // Normalize weights to sum to 1.0
  const totalWeight = patterns.reduce((sum, p) => sum + p.weight, 0)
  if (totalWeight > 0) {
    for (const p of patterns) {
      p.weight = p.weight / totalWeight
    }
  }

  // Sort by weight descending
  patterns.sort((a, b) => b.weight - a.weight)

  // Overall confidence based on evidence quality
  const confidence = (
    evidence.avgConfidence * 0.4 +
    evidence.coverageScore * 0.3 +
    (evidence.knownCapabilityMatches > 0 ? 0.3 : 0)
  )

  return {
    intent,
    phantomEvidence: evidence,
    recommendedPatterns: patterns,
    reuseSuggestions,
    warnings,
    confidence: Math.min(1, Math.max(0, confidence)),
  }
}

/**
 * Full pipeline: extract evidence → compute routing → return recommendation.
 */
export async function routeWithPhantomEvidence(
  intent: string,
  repoOrDomain: string,
): Promise<EvidenceBasedRouting> {
  const evidence = await extractPhantomEvidence(repoOrDomain)
  return computeEvidenceBasedRouting(intent, evidence)
}
