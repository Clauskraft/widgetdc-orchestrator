/**
 * intent-router.ts — Orchestrator-side intent detection using @widgetdc/intent patterns
 *
 * Bridges the shared intent detection system from packages/intent/src/index.ts
 * with orchestrator routing, fleet learning, and pheromone signals.
 *
 * Architecture:
 *   Input → detectIntent() → SkillCompositionPlan → Pheromone routing → Execute
 */

// ─── Types (mirrored from packages/intent/src/index.ts) ──────────────────────

export type OutputType =
  | 'report' | 'deck' | 'spreadsheet' | 'diagram' | 'process'
  | 'dev-spec' | 'security-scan' | 'audit' | 'conversation'

export type SkillCompositionPhase =
  | 'discover' | 'define' | 'design' | 'develop' | 'deliver' | 'verify'

export type SkillTaskClass =
  | 'research' | 'standardize' | 'architect' | 'implement'
  | 'validate' | 'harvest' | 'visualize'

export interface SkillCompositionStep {
  skill: string
  phase: SkillCompositionPhase
  purpose: string
  required: boolean
}

export interface SkillCompositionPattern {
  id: string
  name: string
  taskClass: SkillTaskClass
  description: string
  triggers: string[]
  defaultSkills: string[]
  steps: SkillCompositionStep[]
}

export interface SkillCompositionPlan {
  patternId: string
  patternName: string
  taskClass: SkillTaskClass
  rationale: string
  skills: string[]
  steps: SkillCompositionStep[]
}

export interface IntentMapping {
  outputType: OutputType
  keywords: string[]
  skills: string[]
}

export interface IntentResult {
  matched: boolean
  outputType: OutputType
  confidence: number
  matchedKeywords: string[]
  suggestedSkills: string[]
  composition: SkillCompositionPlan | null
}

// ─── Canonical Patterns (from packages/intent/src/index.ts) ──────────────────

const COMPOSITION_PATTERNS: SkillCompositionPattern[] = [
  {
    id: 'research-to-standard',
    name: 'Research To Standard',
    taskClass: 'standardize',
    description: 'Default method for tasks that define standards, taxonomies, policies, or canonical methods.',
    triggers: ['standard', 'standardize', 'taxonomy', 'canonical', 'policy', 'governance', 'framework', 'visualization'],
    defaultSkills: ['skill-intent-contract', 'flow-discover', 'flow-define', 'octopus-architecture', 'flow-spec', 'flow-deliver', 'skill-verify'],
    steps: [
      { skill: 'skill-intent-contract', phase: 'define', purpose: 'Lock the intent, success criteria, and boundaries.', required: true },
      { skill: 'flow-discover', phase: 'discover', purpose: 'Harvest sources and gather reference patterns.', required: true },
      { skill: 'flow-define', phase: 'define', purpose: 'Define the canonical method, taxonomy, and constraints.', required: true },
      { skill: 'octopus-architecture', phase: 'design', purpose: 'Design the architecture and operating model.', required: true },
      { skill: 'flow-spec', phase: 'define', purpose: 'Convert the standard into a buildable specification.', required: true },
      { skill: 'flow-deliver', phase: 'deliver', purpose: 'Run structured validation and review.', required: true },
      { skill: 'skill-verify', phase: 'verify', purpose: 'Verify evidence and completion.', required: true },
    ],
  },
  {
    id: 'harvest-to-pattern-library',
    name: 'Harvest To Pattern Library',
    taskClass: 'harvest',
    description: 'Default method for premium-source or corpus harvesting into reusable patterns.',
    triggers: ['harvest', 'source pack', 'pattern library', 'corpus', 'extract', 'scribd', 'babok', 'benchmark'],
    defaultSkills: ['skill-intent-contract', 'flow-discover', 'skill-content-pipeline', 'flow-define', 'flow-deliver', 'skill-verify'],
    steps: [
      { skill: 'skill-intent-contract', phase: 'define', purpose: 'Set extraction targets and limits.', required: true },
      { skill: 'flow-discover', phase: 'discover', purpose: 'Locate and qualify source material.', required: true },
      { skill: 'skill-content-pipeline', phase: 'discover', purpose: 'Normalize source content into structured pattern candidates.', required: true },
      { skill: 'flow-define', phase: 'define', purpose: 'Map harvested units to canonical families.', required: true },
      { skill: 'flow-deliver', phase: 'deliver', purpose: 'Validate quality and completeness.', required: true },
      { skill: 'skill-verify', phase: 'verify', purpose: 'Verify provenance and harvested outputs.', required: true },
    ],
  },
  {
    id: 'standard-to-implementation',
    name: 'Standard To Implementation',
    taskClass: 'implement',
    description: 'Default method for implementing an already-defined standard into runtime behavior.',
    triggers: ['implement', 'build', 'wire', 'integrate', 'default method', 'all agents', 'runtime'],
    defaultSkills: ['skill-intent-contract', 'flow-define', 'octopus-architecture', 'flow-develop', 'flow-deliver', 'skill-verify'],
    steps: [
      { skill: 'skill-intent-contract', phase: 'define', purpose: 'Confirm what must be implemented and protected.', required: true },
      { skill: 'flow-define', phase: 'define', purpose: 'Lock requirements and interfaces.', required: true },
      { skill: 'octopus-architecture', phase: 'design', purpose: 'Design the integration and composition model.', required: true },
      { skill: 'flow-develop', phase: 'develop', purpose: 'Implement the default method.', required: true },
      { skill: 'flow-deliver', phase: 'deliver', purpose: 'Validate implementation quality.', required: true },
      { skill: 'skill-verify', phase: 'verify', purpose: 'Verify the runtime effect.', required: true },
    ],
  },
  {
    id: 'ci-triage',
    name: 'CI Triage',
    taskClass: 'validate',
    description: 'Default method for CI failures, broken checks, and failing contracts.',
    triggers: ['ci', 'check', 'test fail', 'build fail', 'contract', 'pipeline', 'broken pr'],
    defaultSkills: ['skill-intent-contract', 'skill-debug', 'flow-develop', 'flow-deliver', 'skill-verify'],
    steps: [
      { skill: 'skill-intent-contract', phase: 'define', purpose: 'Lock the failing gate, expected behavior, and acceptance check.', required: true },
      { skill: 'skill-debug', phase: 'discover', purpose: 'Diagnose the failure from logs, checks, and changed files.', required: true },
      { skill: 'flow-develop', phase: 'develop', purpose: 'Implement the concrete fix instead of restarting discovery.', required: true },
      { skill: 'flow-deliver', phase: 'deliver', purpose: 'Re-run the failing quality gates and validate the outcome.', required: true },
      { skill: 'skill-verify', phase: 'verify', purpose: 'Verify the failing CI path is genuinely cleared.', required: true },
    ],
  },
  {
    id: 'review-resolution',
    name: 'Review Resolution',
    taskClass: 'validate',
    description: 'Default method for unresolved review threads, bot findings, drift comments.',
    triggers: ['review', 'copilot', 'bugbot', 'thread', 'blocked pr', 'merge blocked', 'comment drift'],
    defaultSkills: ['skill-intent-contract', 'skill-code-review', 'flow-develop', 'flow-deliver', 'skill-verify'],
    steps: [
      { skill: 'skill-intent-contract', phase: 'define', purpose: 'Clarify which review findings are real blockers versus stale noise.', required: true },
      { skill: 'skill-code-review', phase: 'discover', purpose: 'Read review findings, changed files, and affected contracts.', required: true },
      { skill: 'flow-develop', phase: 'develop', purpose: 'Resolve the real findings with minimal, targeted changes.', required: true },
      { skill: 'flow-deliver', phase: 'deliver', purpose: 'Validate that review blockers are cleared.', required: true },
      { skill: 'skill-verify', phase: 'verify', purpose: 'Verify merge readiness against the original blockers.', required: true },
    ],
  },
  {
    id: 'self-healing-recovery',
    name: 'Self-Healing Recovery',
    taskClass: 'validate',
    description: 'Default method for deploy mismatches, runtime regressions, and incidents.',
    triggers: ['deploy', 'runtime', 'incident', 'health', 'self-heal', 'mismatch', 'production'],
    defaultSkills: ['skill-intent-contract', 'omega-sentinel', 'skill-debug', 'flow-develop', 'flow-deliver', 'skill-verify'],
    steps: [
      { skill: 'skill-intent-contract', phase: 'define', purpose: 'Lock the broken runtime path, environment, and expected steady state.', required: true },
      { skill: 'omega-sentinel', phase: 'discover', purpose: 'Read production/runtime evidence, contracts, and deployment drift signals.', required: true },
      { skill: 'skill-debug', phase: 'discover', purpose: 'Diagnose the concrete failure without rediscovering the entire system.', required: true },
      { skill: 'flow-develop', phase: 'develop', purpose: 'Implement the narrow recovery or hardening fix.', required: true },
      { skill: 'flow-deliver', phase: 'deliver', purpose: 'Validate runtime recovery end-to-end.', required: true },
      { skill: 'skill-verify', phase: 'verify', purpose: 'Verify production no longer exhibits the mismatch or regression.', required: true },
    ],
  },
  {
    id: 'visualization-system-loop',
    name: 'Visualization System Loop',
    taskClass: 'visualize',
    description: 'Default method for canonical visualization work.',
    triggers: ['visualization', 'diagram', 'template', 'pattern', 'renderer', 'visual standard', 'benchmark', 'bindings'],
    defaultSkills: ['skill-intent-contract', 'flow-discover', 'flow-define', 'octopus-architecture', 'flow-develop', 'flow-deliver', 'skill-verify'],
    steps: [
      { skill: 'skill-intent-contract', phase: 'define', purpose: 'Lock audience, explanation goal, and canonical visualization constraints.', required: true },
      { skill: 'flow-discover', phase: 'discover', purpose: 'Harvest visualization references, patterns, and existing graph evidence.', required: true },
      { skill: 'flow-define', phase: 'define', purpose: 'Define the canonical visualization family, template, and trigger rules.', required: true },
      { skill: 'octopus-architecture', phase: 'design', purpose: 'Design graph bindings, routing inputs, and improvement loops.', required: true },
      { skill: 'flow-develop', phase: 'develop', purpose: 'Implement catalog, routing, bindings, and benchmark gates.', required: true },
      { skill: 'flow-deliver', phase: 'deliver', purpose: 'Validate benchmark stability and harvest quality.', required: true },
      { skill: 'skill-verify', phase: 'verify', purpose: 'Verify the visualization system improved or stayed neutral.', required: true },
    ],
  },
]

// ─── Intent Mappings (from packages/intent/src/index.ts) ─────────────────────

const INTENT_MAPPINGS: IntentMapping[] = [
  { outputType: 'report', keywords: ['rapport', 'report', 'analyse', 'analysis', 'research', 'undersøgelse'], skills: ['skill-knowledge-work'] },
  { outputType: 'deck', keywords: ['deck', 'slides', 'præsentation', 'presentation', 'pitch'], skills: ['skill-deck'] },
  { outputType: 'spreadsheet', keywords: ['budget', 'spreadsheet', 'regneark', 'roi', 'npv', 'cash flow', 'finans', 'økonomi'], skills: ['skill-cost-projections'] },
  { outputType: 'diagram', keywords: ['diagram', 'arkitektur', 'architecture', 'flow', 'flowchart', 'mermaid'], skills: ['octopus-architecture'] },
  { outputType: 'process', keywords: ['process', 'workflow', 'pipeline', 'devops', 'ci/cd'], skills: ['flow-develop'] },
  { outputType: 'dev-spec', keywords: ['spec', 'prd', 'requirements', 'krav', 'user story', 'epic'], skills: ['skill-prd'] },
  { outputType: 'security-scan', keywords: ['security', 'sikkerhed', 'pentest', 'vulnerability', 'cve', 'sårbarhed'], skills: ['skill-security-framing', 'skill-audit'] },
  { outputType: 'audit', keywords: ['audit', 'compliance', 'governance', 'risk', 'risiko'], skills: ['skill-audit'] },
]

// ─── Core Detection ──────────────────────────────────────────────────────────

export function detectIntent(input: string): IntentResult {
  const normalised = input.toLowerCase().trim()

  for (const mapping of INTENT_MAPPINGS) {
    const matched = mapping.keywords.filter(kw => normalised.includes(kw.toLowerCase()))
    if (matched.length > 0) {
      return {
        matched: true,
        outputType: mapping.outputType,
        confidence: Math.min(1.0, matched.length * 0.4),
        matchedKeywords: matched,
        suggestedSkills: mapping.skills,
        composition: buildSkillCompositionPlan(input, mapping.skills),
      }
    }
  }

  return {
    matched: false,
    outputType: 'conversation',
    confidence: 0,
    matchedKeywords: [],
    suggestedSkills: [],
    composition: buildSkillCompositionPlan(input, []),
  }
}

export function buildSkillCompositionPlan(input: string, fallbackSkills: string[] = []): SkillCompositionPlan {
  const normalised = input.toLowerCase().trim()
  const scoredPatterns = COMPOSITION_PATTERNS.map(pattern => ({
    pattern,
    score: pattern.triggers.reduce((sum, trigger) => sum + (normalised.includes(trigger) ? 1 : 0), 0),
  }))
  const best = scoredPatterns.sort((a, b) => b.score - a.score)[0]?.pattern
    ?? COMPOSITION_PATTERNS[0]

  const skills = best.defaultSkills.length > 0 ? best.defaultSkills : fallbackSkills
  const triggered = best.triggers.filter(t => normalised.includes(t))
  const rationale = triggered.length > 0
    ? `Selected pattern "${best.name}" because the task signals: ${triggered.join(', ')}.`
    : `Selected pattern "${best.name}" as default canonical workflow.`

  return {
    patternId: best.id,
    patternName: best.name,
    taskClass: best.taskClass,
    rationale,
    skills,
    steps: best.steps,
  }
}

export function getSkillCompositionPatterns(): SkillCompositionPattern[] {
  return [...COMPOSITION_PATTERNS]
}
