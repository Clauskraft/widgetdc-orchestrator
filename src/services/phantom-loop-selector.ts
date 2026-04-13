import {
  routeWithPhantomEvidence,
  type EvidenceBasedRouting,
} from './phantom-skill-router.js'

export type PhantomLoopId =
  | 'harvest_to_pattern_library'
  | 'reuse_before_design'
  | 'research_to_standard'
  | 'standard_to_implementation'
  | 'adoption_flywheel'

export interface PhantomLoopDefinition {
  id: PhantomLoopId
  name: string
  description: string
  skills: string[]
}

export interface PhantomLoopRecommendation {
  intent: string
  repo_or_domain: string
  confidence: number
  recommended_loop: PhantomLoopDefinition
  recommended_pattern: string
  recommended_patterns: EvidenceBasedRouting['recommendedPatterns']
  phantom_evidence: EvidenceBasedRouting['phantomEvidence']
  reuse_suggestions: string[]
  warnings: string[]
  selection_reasons: string[]
}

const LOOP_DEFINITIONS: Record<PhantomLoopId, PhantomLoopDefinition> = {
  harvest_to_pattern_library: {
    id: 'harvest_to_pattern_library',
    name: 'Harvest To Pattern Library',
    description: 'Harvest external components, classify them, and map them to internal capability patterns.',
    skills: ['flow-discover', 'skill-intent-contract', 'omega-sentinel', 'skill-verify'],
  },
  reuse_before_design: {
    id: 'reuse_before_design',
    name: 'Reuse Before Design',
    description: 'Search for reusable tools, patterns, and runtime surfaces before designing something new.',
    skills: ['flow-discover', 'skill-decision-support', 'omega-sentinel', 'skill-verify'],
  },
  research_to_standard: {
    id: 'research_to_standard',
    name: 'Research To Standard',
    description: 'Turn existing evidence and canonical nodes into a standard, contract, or template.',
    skills: ['flow-discover', 'flow-spec', 'omega-sentinel', 'skill-verify'],
  },
  standard_to_implementation: {
    id: 'standard_to_implementation',
    name: 'Standard To Implementation',
    description: 'Implement or extend against a known standard and runtime surface with verification.',
    skills: ['flow-develop', 'skill-tdd', 'omega-sentinel', 'skill-verify'],
  },
  adoption_flywheel: {
    id: 'adoption_flywheel',
    name: 'Adoption Flywheel',
    description: 'Capture execution outcomes, rerank tool choices, and improve adoption over time.',
    skills: ['skill-iterative-loop', 'skill-status', 'flow-deliver', 'skill-verify'],
  },
}

function isStandardsIntent(intent: string): boolean {
  return /\b(standard|contract|schema|template|policy|spec|governance|canonical)\b/i.test(intent)
}

function isAdoptionIntent(intent: string): boolean {
  return /\b(adoption|telemetry|ranking|rank|discoverability|usage|kpi|quality score|error rate|flywheel)\b/i.test(intent)
}

function isImplementationIntent(intent: string): boolean {
  return /\b(implement|build|ship|fix|extend|integrate|frontend|backend|route|api|ui|hardening|deploy)\b/i.test(intent)
}

function mapPatternToLoop(pattern: string): PhantomLoopId {
  switch (pattern) {
    case 'harvest-to-pattern-library':
      return 'harvest_to_pattern_library'
    case 'reuse-before-design':
      return 'reuse_before_design'
    case 'research-to-standard':
      return 'research_to_standard'
    case 'standard-to-implementation':
      return 'standard_to_implementation'
    case 'adoption-flywheel':
      return 'adoption_flywheel'
    default:
      return 'harvest_to_pattern_library'
  }
}

export async function recommendPhantomSkillLoop(
  intent: string,
  repoOrDomain: string,
): Promise<PhantomLoopRecommendation> {
  const routing = await routeWithPhantomEvidence(intent, repoOrDomain)
  const evidence = routing.phantomEvidence
  const topPattern = routing.recommendedPatterns[0]?.pattern ?? 'harvest-to-pattern-library'
  const reasons: string[] = []

  let loopId: PhantomLoopId

  if (isAdoptionIntent(intent)) {
    loopId = 'adoption_flywheel'
    reasons.push('Intent is adoption or telemetry shaped, so ranking and loop optimization should come first.')
  } else if (evidence.knownCapabilityMatches > 0) {
    loopId = 'reuse_before_design'
    reasons.push(`${evidence.knownCapabilityMatches} known capability matches suggest reuse before creating new surfaces.`)
  } else if ((evidence.coverageScore < 0.4 || evidence.unknownRelationCount > 5) && evidence.externalSourceCount > 3) {
    loopId = 'harvest_to_pattern_library'
    reasons.push(`Coverage is low (${(evidence.coverageScore * 100).toFixed(0)}%) and external sources are high, so harvesting should precede implementation.`)
  } else if ((evidence.coverageScore < 0.4 || evidence.unknownRelationCount > 5) && evidence.canonicalNodeCount > 0) {
    loopId = 'research_to_standard'
    reasons.push('Canonical nodes exist but coverage is still weak, so the next step should be standardization rather than direct build.')
  } else if (isStandardsIntent(intent) && evidence.canonicalNodeCount > 0) {
    loopId = 'research_to_standard'
    reasons.push('Intent is standards or contracts shaped and canonical surfaces already exist.')
  } else if (
    evidence.avgConfidence >= 0.75
    && evidence.coverageScore >= 0.6
    && evidence.hasRuntimeSurface
    && isImplementationIntent(intent)
  ) {
    loopId = 'standard_to_implementation'
    reasons.push('Confidence, coverage, and runtime surface are strong enough to compress directly to implementation.')
  } else {
    loopId = mapPatternToLoop(topPattern)
    reasons.push(`Falling back to top Phantom routing pattern: ${topPattern}.`)
  }

  if (routing.warnings.length > 0) {
    reasons.push(...routing.warnings)
  }

  return {
    intent,
    repo_or_domain: repoOrDomain,
    confidence: routing.confidence,
    recommended_loop: LOOP_DEFINITIONS[loopId],
    recommended_pattern: topPattern,
    recommended_patterns: routing.recommendedPatterns,
    phantom_evidence: routing.phantomEvidence,
    reuse_suggestions: routing.reuseSuggestions,
    warnings: routing.warnings,
    selection_reasons: reasons,
  }
}
