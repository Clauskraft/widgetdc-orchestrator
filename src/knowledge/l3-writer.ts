/**
 * l3-writer.ts — L3 Neo4j writer for the Knowledge Normalization Bus.
 *
 * Persists KnowledgeEvents as :KnowledgeCandidate nodes in Neo4j (tier=L3).
 * L3 = runtime agent access — scored above the L2 staging threshold but
 * below the L4 skill-promotion threshold.
 *
 * Oracle Protocol governance fields required on all graph writes:
 *   destructiveHint, contains_pii, confidence_score, agentId
 */
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'
import type { KnowledgeEvent } from './knowledge-bus.js'

export async function writeL3(event: KnowledgeEvent): Promise<void> {
  try {
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (n:KnowledgeCandidate {event_id: $event_id})
SET n.source = $source,
    n.title = $title,
    n.summary = $summary,
    n.content = $content,
    n.score = $score,
    n.tags = $tags,
    n.repo = $repo,
    n.tier = 'L3',
    n.created_at = $created_at,
    n.destructiveHint = false,
    n.contains_pii = false,
    n.confidence_score = $score,
    n.agentId = 'knowledge-bus'
RETURN n.event_id`,
        params: {
          event_id: event.event_id,
          source: event.source,
          title: event.title,
          summary: event.summary,
          content: event.content.slice(0, 4000),
          score: event.score ?? 0,
          tags: event.tags.join(','),
          repo: event.repo,
          created_at: event.created_at,
        },
        intent: `Persist L3 knowledge candidate from ${event.source}: ${event.title}`,
        evidence: `PRISM score ${event.score}, source ${event.source}, repo ${event.repo}`,
      },
      callId: `knowledge-l3-${event.event_id}`,
    })
    logger.info({ event_id: event.event_id, title: event.title }, 'KnowledgeBus L3: written to Neo4j')
  } catch (err) {
    logger.error({ err: String(err), event_id: event.event_id }, 'KnowledgeBus L3: write failed')
  }
}
