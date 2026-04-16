// src/knowledge/adapters/phantom-bom-adapter.ts
//
// Emits PhantomComponent discoveries to the KnowledgeBus after Neo4j MERGE.
// Called from phantom-bom.ts › writeToNeo4j() inside the component loop.
import type { PhantomComponent } from '../../phantom-bom.js'
import { emitKnowledge } from '../index.js'
import { logger } from '../../logger.js'

export interface PhantomDiscovery {
  toolName: string
  toolDescription: string
  repo: string
  discoveredIn: string  // file or context where it was found
  componentType: PhantomComponent['type']
  confidence: number
  capabilities: string[]
  tags: string[]
}

export function emitPhantomDiscovery(discovery: PhantomDiscovery): void {
  const content = `## Phantom Tool Discovery: ${discovery.toolName}

**Tool:** \`${discovery.toolName}\`
**Type:** ${discovery.componentType}
**Description:** ${discovery.toolDescription}
**Discovered in:** ${discovery.discoveredIn}
**Repo:** ${discovery.repo}
**Confidence:** ${discovery.confidence}%

### Capabilities
${discovery.capabilities.length ? discovery.capabilities.map(c => `- ${c}`).join('\n') : '- (none extracted)'}

### Issue
This tool is called in orchestrator code but is NOT registered in the backend MCP catalogue.
It routes via \`callMcpTool\` to the backend bridge and silently fails.

### Fix Pattern
Import and call the local function directly instead of via MCP bridge:
\`\`\`typescript
// WRONG: const result = await callMcpTool({ toolName: '${discovery.toolName}', ... })
// RIGHT: const { localFn } = await import('../path/to/local.js'); await localFn(...)
\`\`\`
`

  emitKnowledge({
    source: 'phantom_bom',
    title: `PhantomBOM: ${discovery.toolName} not in backend catalogue`,
    content,
    summary: `Tool ${discovery.toolName} used via callMcpTool but missing from backend — use local import`,
    score: discovery.confidence !== undefined
      ? Math.min(0.95, discovery.confidence / 100)
      : 0.75,  // default: L3 tier if confidence unknown
    tags: ['phantom-bom', 'tool-routing', discovery.toolName, discovery.repo, ...discovery.tags],
    repo: discovery.repo,
    metadata: discovery as unknown as Record<string, unknown>,
  })

  logger.info({ toolName: discovery.toolName }, 'PhantomBOMAdapter: discovery emitted to KnowledgeBus')
}
