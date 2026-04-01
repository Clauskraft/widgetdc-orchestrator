/**
 * investigate-chain.ts — G4.11–G4.12: Multi-agent deep investigation chain.
 *
 * Runs a 5-step sequential chain:
 *   1. graph-steward     → Neo4j graph exploration
 *   2. regulatory-nav    → Compliance framework analysis
 *   3. consulting-partner → Strategic recommendations
 *   4. RLM /reason       → Deep reasoning synthesis
 *   5. artifact-assembler → Combine all into WAD artifact
 *
 * The final step creates an AnalysisArtifact via the artifact broker API.
 */
import { executeChain, type ChainDefinition, type ChainExecution } from './chain-engine.js'
import { config } from './config.js'
import { logger } from './logger.js'

// ─── Chain Definition Builder ──────────────────────────────────────────────

/**
 * Build the investigate chain definition for a given topic.
 */
export function buildInvestigateChain(topic: string): ChainDefinition {
  return {
    chain_id: `investigate-${Date.now().toString(36)}`,
    name: `Investigate: ${topic}`,
    description: `Multi-agent deep investigation of "${topic}"`,
    mode: 'sequential',
    steps: [
      // Step 1: Graph exploration
      {
        id: 'graph-explore',
        agent_id: 'graph-steward',
        tool_name: 'graph.read_cypher',
        arguments: {
          query: `MATCH (n) WHERE toLower(n.title) CONTAINS toLower($topic) OR toLower(coalesce(n.name,'')) CONTAINS toLower($topic) OR toLower(coalesce(n.description,'')) CONTAINS toLower($topic) WITH n LIMIT 20 OPTIONAL MATCH (n)-[r]-(m) RETURN labels(n)[0] AS type, coalesce(n.title, n.name, n.id) AS name, collect(DISTINCT {rel: type(r), target: coalesce(m.title, m.name, labels(m)[0])}) AS connections LIMIT 20`,
          params: { topic },
        },
        timeout_ms: 20000,
      },
      // Step 2: Compliance analysis
      {
        id: 'compliance-analysis',
        agent_id: 'regulatory-navigator',
        tool_name: 'srag.query',
        arguments: {
          query: `Compliance and regulatory framework analysis for: ${topic}. Include relevant Danish/EU regulations, governance requirements, and risk considerations. Previous graph findings: {{prev}}`,
        },
        timeout_ms: 30000,
      },
      // Step 3: Strategic recommendations
      {
        id: 'strategic-recommendations',
        agent_id: 'consulting-partner',
        tool_name: 'kg_rag.query',
        arguments: {
          question: `Strategic consulting analysis for: ${topic}. Provide actionable recommendations, patterns, and best practices. Previous compliance findings: {{prev}}`,
          max_evidence: 15,
        },
        timeout_ms: 30000,
      },
      // Step 4: Deep reasoning synthesis
      {
        id: 'deep-reasoning',
        agent_id: 'orchestrator',
        cognitive_action: 'reason',
        prompt: `Synthesize a comprehensive deep analysis of "${topic}" based on all previous findings:\n\n{{prev}}\n\nProvide:\n1. Key findings from graph exploration\n2. Compliance implications\n3. Strategic recommendations\n4. Risk assessment\n5. Suggested next actions`,
        timeout_ms: 45000,
      },
      // Step 5: Artifact assembly — handled post-chain
      // We use a lightweight step that signals assembly
      {
        id: 'signal-assembly',
        agent_id: 'orchestrator',
        tool_name: 'graph.health',
        arguments: {},
        timeout_ms: 10000,
      },
    ],
  }
}

// ─── Artifact Assembler (G4.12) ────────────────────────────────────────────

interface ArtifactBlock {
  type: string
  label?: string
  content: Record<string, unknown>
}

/**
 * Assemble a WAD AnalysisArtifact from investigate chain step outputs.
 */
function assembleArtifactBlocks(
  topic: string,
  execution: ChainExecution,
): ArtifactBlock[] {
  const blocks: ArtifactBlock[] = []
  const results = execution.results

  // Step 1 output → CypherBlock + TextBlock (graph exploration)
  const graphResult = results.find(r => r.step_id === 'graph-explore')
  if (graphResult && graphResult.status === 'success') {
    blocks.push({
      type: 'cypher',
      label: 'Graph Exploration',
      content: {
        query: `MATCH (n) WHERE toLower(n.title) CONTAINS toLower("${topic}") ... (see full chain)`,
      },
    })
    blocks.push({
      type: 'text',
      label: 'Graph Results',
      content: {
        body: typeof graphResult.output === 'string'
          ? graphResult.output
          : JSON.stringify(graphResult.output, null, 2),
      },
    })
  }

  // Step 2 output → TextBlock (compliance analysis)
  const complianceResult = results.find(r => r.step_id === 'compliance-analysis')
  if (complianceResult && complianceResult.status === 'success') {
    blocks.push({
      type: 'text',
      label: 'Compliance & Regulatory Analysis',
      content: {
        body: typeof complianceResult.output === 'string'
          ? complianceResult.output
          : JSON.stringify(complianceResult.output, null, 2),
      },
    })
  }

  // Step 3 output → TextBlock (strategic recommendations)
  const strategyResult = results.find(r => r.step_id === 'strategic-recommendations')
  if (strategyResult && strategyResult.status === 'success') {
    blocks.push({
      type: 'text',
      label: 'Strategic Recommendations',
      content: {
        body: typeof strategyResult.output === 'string'
          ? strategyResult.output
          : JSON.stringify(strategyResult.output, null, 2),
      },
    })
  }

  // Step 4 output → TextBlock (deep reasoning synthesis)
  const reasoningResult = results.find(r => r.step_id === 'deep-reasoning')
  if (reasoningResult && reasoningResult.status === 'success') {
    blocks.push({
      type: 'text',
      label: 'Deep Reasoning Synthesis',
      content: {
        body: typeof reasoningResult.output === 'string'
          ? reasoningResult.output
          : JSON.stringify(reasoningResult.output, null, 2),
      },
    })
  }

  // KPI cards for metrics
  blocks.push({
    type: 'kpi_card',
    label: 'Investigation Metrics',
    content: {
      label: 'Steps Completed',
      value: `${execution.steps_completed}/${execution.steps_total}`,
      trend: execution.status === 'completed' ? 'up' : 'down',
    },
  })

  if (execution.duration_ms) {
    blocks.push({
      type: 'kpi_card',
      content: {
        label: 'Duration',
        value: `${(execution.duration_ms / 1000).toFixed(1)}s`,
      },
    })
  }

  // Deep links
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${config.port}`

  blocks.push({
    type: 'deep_link',
    label: 'Access Links',
    content: {
      label: 'View in Command Center',
      uri: `${baseUrl}/#chains`,
    },
  })

  blocks.push({
    type: 'deep_link',
    content: {
      label: 'Open in Obsidian',
      uri: `obsidian://widgetdc?action=investigate&topic=${encodeURIComponent(topic)}`,
    },
  })

  return blocks
}

/**
 * Create the WAD artifact via internal API call.
 */
async function createArtifact(
  topic: string,
  blocks: ArtifactBlock[],
  execution: ChainExecution,
): Promise<{ artifactId: string; artifactUrl: string } | null> {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${config.port}`

  const apiKey = process.env.ORCHESTRATOR_API_KEY ?? ''

  try {
    const resp = await fetch(`${baseUrl}/api/artifacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        title: `Investigation: ${topic}`,
        source: 'investigate-chain',
        blocks,
        tags: ['investigation', 'multi-agent', topic.toLowerCase().replace(/\s+/g, '-')],
        graph_refs: execution.results
          .filter(r => r.step_id === 'graph-explore' && r.status === 'success')
          .map(r => `neo4j:investigate:${topic}`),
        created_by: 'investigate-chain',
      }),
    })

    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'Failed to create investigation artifact')
      return null
    }

    const data = await resp.json() as { success: boolean; artifact?: { $id: string } }
    if (data.success && data.artifact) {
      const id = data.artifact.$id
      return {
        artifactId: id,
        artifactUrl: `${baseUrl}/api/artifacts/${encodeURIComponent(id)}`,
      }
    }
    return null
  } catch (err) {
    logger.warn({ err: String(err) }, 'Artifact creation failed for investigation')
    return null
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface InvestigateResult {
  execution: ChainExecution
  artifact_id?: string
  artifact_url?: string
  artifact_markdown_url?: string
}

/**
 * Run a full investigate chain for a topic and assemble the WAD artifact.
 */
export async function runInvestigation(topic: string): Promise<InvestigateResult> {
  const chainDef = buildInvestigateChain(topic)

  logger.info({ topic, chain_id: chainDef.chain_id }, 'Starting investigation chain')

  // Execute the chain (steps 1-5)
  const execution = await executeChain(chainDef)

  // Assemble artifact from chain results (G4.12)
  const blocks = assembleArtifactBlocks(topic, execution)
  const artifact = await createArtifact(topic, blocks, execution)

  const result: InvestigateResult = { execution }

  if (artifact) {
    result.artifact_id = artifact.artifactId
    result.artifact_url = artifact.artifactUrl
    result.artifact_markdown_url = `${artifact.artifactUrl}.md`
    logger.info({ artifact_id: artifact.artifactId, topic }, 'Investigation artifact created')
  }

  return result
}
