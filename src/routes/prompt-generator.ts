/**
 * routes/prompt-generator.ts — Naturligt sprog → skill + prompt mapping
 *
 * Takes a free-text description and returns the best matching skill
 * with a ready-to-use prompt. No LLM calls — pure keyword matching.
 */
import { Router } from 'express'
import { logger } from '../logger.js'

export const promptGeneratorRouter = Router()

interface SkillMatch {
  skill: string
  prompt: string
  explanation: string
  alternatives: string[]
}

interface IntentRule {
  keywords: string[]
  skill: string
  explanation: string
  alternatives: string[]
  buildPrompt: (description: string) => string
}

const intentRules: IntentRule[] = [
  {
    keywords: ['præsentation', 'presentation', 'slides', 'deck', 'slide'],
    skill: '/octo:deck',
    explanation: 'Brug /octo:deck til at generere slide decks fra et brief.',
    alternatives: ['/octo:docs'],
    buildPrompt: (d) => `/octo:deck brief="${d}" slides=10 audience="stakeholders"`,
  },
  {
    keywords: ['rapport', 'pdf', 'docx', 'dokument', 'document', 'report'],
    skill: '/octo:docs',
    explanation: 'Brug /octo:docs til at generere PDF/DOCX rapporter.',
    alternatives: ['/octo:deck'],
    buildPrompt: (d) => `/octo:docs format=pdf topic="${d}"`,
  },
  {
    keywords: ['prd', 'product requirement', 'kravspec'],
    skill: '/octo:prd',
    explanation: 'Brug /octo:prd til at skrive AI-optimerede Product Requirement Documents.',
    alternatives: ['/octo:spec'],
    buildPrompt: (d) => `/octo:prd "${d}"`,
  },
  {
    keywords: ['spec', 'specifikation', 'specification', 'design doc'],
    skill: '/octo:spec',
    explanation: 'Brug /octo:spec til strukturerede tekniske specifikationer.',
    alternatives: ['/octo:prd'],
    buildPrompt: (d) => `/octo:spec "${d}"`,
  },
  {
    keywords: ['research', 'undersøg', 'undersog', 'analyse', 'analysis', 'deep dive'],
    skill: '/octo:research',
    explanation: 'Brug /octo:research til deep research med multi-source syntese.',
    alternatives: ['/obsidian-research', '/octo:discover'],
    buildPrompt: (d) => `/octo:research "${d}"`,
  },
  {
    keywords: ['osint', 'intelligence', 'konkurrent', 'competitor'],
    skill: '/obsidian-osint',
    explanation: 'Brug /obsidian-osint til OSINT intelligence gathering.',
    alternatives: ['/octo:research'],
    buildPrompt: (d) => `/obsidian-osint target="${d}"`,
  },
  {
    keywords: ['graph', 'neo4j', 'noder', 'nodes', 'relationer', 'topology'],
    skill: '/obsidian-graph',
    explanation: 'Brug /obsidian-graph til Neo4j graph forespørgsler.',
    alternatives: ['/graph-steward'],
    buildPrompt: (d) => `/obsidian-graph "${d}"`,
  },
  {
    keywords: ['brainstorm', 'idé', 'ide', 'ideér', 'kreativ', 'creative'],
    skill: '/octo:brainstorm',
    explanation: 'Brug /octo:brainstorm til kreative sessions med thought partner.',
    alternatives: ['/octo:debate'],
    buildPrompt: (d) => `/octo:brainstorm "${d}"`,
  },
  {
    keywords: ['debug', 'fix', 'bug', 'fejl', 'error', 'traceback', 'crash', 'broken'],
    skill: '/octo:debug',
    explanation: 'Brug /octo:debug til systematisk debugging og problemundersøgelse.',
    alternatives: ['/agent-chain'],
    buildPrompt: (d) => `/octo:debug "${d}"`,
  },
  {
    keywords: ['review', 'pr', 'pull request', 'code review'],
    skill: '/code-review:code-review',
    explanation: 'Brug /code-review:code-review til PR code review med inline kommentarer.',
    alternatives: ['/octo:review', '/octo:staged-review'],
    buildPrompt: (d) => {
      const prMatch = d.match(/#?(\d{2,6})/)
      return prMatch ? `/code-review:code-review ${prMatch[1]}` : `/code-review:code-review "${d}"`
    },
  },
  {
    keywords: ['feature', 'implementer', 'implement', 'byg', 'build', 'tilføj', 'add', 'create'],
    skill: '/agent-chain',
    explanation: 'Brug /agent-chain til at auto-klassificere og orkestrere den rette agent-sekvens.',
    alternatives: ['/octo:factory', '/octo:embrace'],
    buildPrompt: (d) => `/agent-chain ${d}`,
  },
  {
    keywords: ['sikkerhed', 'security', 'audit', 'owasp', 'vulnerability', 'sårbarhed'],
    skill: '/octo:security',
    explanation: 'Brug /octo:security til OWASP compliance og sårbarhedsscanning.',
    alternatives: ['/security-hardener'],
    buildPrompt: (d) => `/octo:security scope="${d}"`,
  },
  {
    keywords: ['deploy', 'deployment', 'release', 'version', 'tag'],
    skill: '/release-manager',
    explanation: 'Brug /release-manager til koordineret release og deploy across repos.',
    alternatives: ['/deploy-guardian'],
    buildPrompt: (d) => `/release-manager ${d}`,
  },
  {
    keywords: ['status', 'sitrep', 'omega', 'health', 'overview', 'overblik'],
    skill: '/omega-sentinel',
    explanation: 'Brug /omega-sentinel til platform-wide SITREP og arkitektur-audit.',
    alternatives: ['/obsidian-status'],
    buildPrompt: (d) => `/omega-sentinel SITREP`,
  },
  {
    keywords: ['test', 'tdd', 'unit test', 'integration test'],
    skill: '/octo:tdd',
    explanation: 'Brug /octo:tdd til test-driven development med red-green-refactor.',
    alternatives: ['/qa-guardian'],
    buildPrompt: (d) => `/octo:tdd "${d}"`,
  },
  {
    keywords: ['compliance', 'gdpr', 'nis2', 'regulering', 'regulation'],
    skill: '/compliance-officer',
    explanation: 'Brug /compliance-officer til GDPR/NIS2 compliance og gap analysis.',
    alternatives: ['/regulatory-navigator'],
    buildPrompt: (d) => `/compliance-officer ${d}`,
  },
  {
    keywords: ['debate', 'diskussion', 'sammenlign', 'compare', 'vs'],
    skill: '/octo:debate',
    explanation: 'Brug /octo:debate til struktureret 4-vejs AI-debat.',
    alternatives: ['/octo:brainstorm'],
    buildPrompt: (d) => `/octo:debate "${d}"`,
  },
  {
    keywords: ['harvest', 'scrape', 'indsaml', 'collect'],
    skill: '/obsidian-harvest',
    explanation: 'Brug /obsidian-harvest til at indsamle data fra web, docs, repos.',
    alternatives: ['/octo:pipeline'],
    buildPrompt: (d) => `/obsidian-harvest url="${d}"`,
  },
  {
    keywords: ['plan', 'strategi', 'strategy', 'roadmap'],
    skill: '/octo:plan',
    explanation: 'Brug /octo:plan til at bygge strategiske eksekveringsplaner.',
    alternatives: ['/octo:embrace', '/project-manager-widgetdc'],
    buildPrompt: (d) => `/octo:plan "${d}"`,
  },
  {
    keywords: ['ui', 'ux', 'design', 'palette', 'typography', 'style guide'],
    skill: '/octo:design-ui-ux',
    explanation: 'Brug /octo:design-ui-ux til UI/UX design systemer.',
    alternatives: ['/octo:extract'],
    buildPrompt: (d) => `/octo:design-ui-ux "${d}"`,
  },
  {
    keywords: ['90-dag', '90-day', '90 dag', 'transformation'],
    skill: '/project-manager-90day',
    explanation: 'Brug /project-manager-90day til 90-dages transformationsplan tracking.',
    alternatives: ['/project-manager-widgetdc'],
    buildPrompt: (d) => `/project-manager-90day ${d}`,
  },
]

function classifyIntent(description: string): SkillMatch {
  const lower = description.toLowerCase()

  let bestMatch: IntentRule | null = null
  let bestScore = 0

  for (const rule of intentRules) {
    let score = 0
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        // Longer keywords get higher weight to prefer specific matches
        score += kw.length
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestMatch = rule
    }
  }

  if (bestMatch) {
    return {
      skill: bestMatch.skill,
      prompt: bestMatch.buildPrompt(description),
      explanation: bestMatch.explanation,
      alternatives: bestMatch.alternatives,
    }
  }

  // Fallback: /octo:octo smart router
  return {
    skill: '/octo:octo',
    prompt: `/octo:octo "${description}"`,
    explanation: 'Ingen specifik skill matchede — /octo:octo router automatisk til den bedste skill.',
    alternatives: ['/agent-chain'],
  }
}

/** POST /api/prompt-generator — classify natural language → skill + prompt */
promptGeneratorRouter.post('/', (req, res) => {
  const { description } = req.body

  if (!description || typeof description !== 'string' || !description.trim()) {
    res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_DESCRIPTION',
        message: 'description (string) is required',
        status_code: 400,
      },
    })
    return
  }

  const trimmed = description.trim()
  logger.info({ description: trimmed }, 'Prompt generator request')

  const result = classifyIntent(trimmed)

  res.json({
    success: true,
    data: result,
  })
})

/** GET /api/prompt-generator/skills — list all known skills */
promptGeneratorRouter.get('/skills', (_req, res) => {
  const skills = intentRules.map(r => ({
    skill: r.skill,
    keywords: r.keywords,
    explanation: r.explanation,
    alternatives: r.alternatives,
  }))

  res.json({
    success: true,
    data: {
      skills,
      total: skills.length,
      fallback: '/octo:octo',
    },
  })
})
