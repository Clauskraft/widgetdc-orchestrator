/**
 * l4-writer.ts — L4 Neo4j skill-candidate writer for the Knowledge Normalization Bus.
 *
 * Persists KnowledgeEvents as :KnowledgeCandidate nodes in Neo4j (tier=L4).
 * L4 = skill promotion threshold (score >= 0.85) — nodes written here are
 * pending local sync to skill files via the skill_corpus_sync pipeline.
 *
 * Oracle Protocol governance fields required on all graph writes:
 *   destructiveHint, contains_pii, confidence_score, agentId
 */
import { v4 as uuid } from 'uuid'
import { callMcpTool } from '../mcp-caller.js'
import { logger } from '../logger.js'
import type { KnowledgeEvent } from './knowledge-bus.js'

export async function writeL4(event: KnowledgeEvent): Promise<void> {
  try {
    const slug = event.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    await callMcpTool({
      toolName: 'graph.write_cypher',
      args: {
        query: `MERGE (n:KnowledgeCandidate {event_id: $event_id})
SET n.source = $source,
    n.title = $title,
    n.slug = $slug,
    n.summary = $summary,
    n.content = $content,
    n.score = $score,
    n.tags = $tags,
    n.repo = $repo,
    n.tier = 'L4',
    n.synced_to_skill = false,
    n.created_at = $created_at,
    n.destructiveHint = false,
    n.contains_pii = false,
    n.confidence_score = $score,
    n.agentId = 'knowledge-bus'
RETURN n.slug`,
        params: {
          event_id: event.event_id,
          source: event.source,
          title: event.title,
          slug,
          summary: event.summary,
          content: event.content.slice(0, 8000),
          score: event.score ?? 0,
          tags: event.tags.join(','),
          repo: event.repo,
          created_at: event.created_at,
        },
        intent: `Promote L4 skill candidate from ${event.source}: ${event.title}`,
        evidence: `PRISM score ${event.score} >= 0.85 threshold, source ${event.source}`,
      },
      callId: uuid(),
    })
    logger.info(
      { event_id: event.event_id, slug, title: event.title },
      'KnowledgeBus L4: candidate written to Neo4j — pending local sync',
    )
  } catch (err) {
    logger.error({ err: String(err), event_id: event.event_id }, 'KnowledgeBus L4: write failed')
  }
}
