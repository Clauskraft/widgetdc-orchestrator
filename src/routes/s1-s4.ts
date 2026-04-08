import { Router, Request, Response } from 'express'
import { executeChain } from '../chain/chain-engine.js'
import { logger } from '../logger.js'

export const s1s4Router = Router()

/**
 * POST /api/s1-s4/trigger — Trigger the S1-S4 harvesting pipeline for a URL or local path.
 */
s1s4Router.post('/trigger', async (req: Request, res: Response) => {
  const { url, source_type, topic, weights } = req.body

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL or path is required' })
  }

  logger.info({ url, topic }, '🛰️ Triggering S1-S4 Pipeline')

  try {
    const execution = await executeChain({
      name: `S1-S4: ${topic || 'General Intelligence'}`,
      mode: 'sequential',
      steps: [
        {
          agent_id: 'harvester',
          tool_name: 'osint.scrape', // S1: Extract
          arguments: { url, max_lines: 50 },
        },
        {
          agent_id: 'orchestrator',
          cognitive_action: 'analyze', // S2: Map
          prompt: `Transform this raw data into a valid IntelligenceObservation (snake_case).
                   Context: Topic=${topic || 'General'}, Weights=${JSON.stringify(weights || {})}.
                   Data: {{prev}}`,
        },
        {
          agent_id: 'orchestrator',
          tool_name: 'graph.write_cypher', // S3: Sync/Inject
          arguments: {
            query: `
              MERGE (o:IntelligenceObservation {id: apoc.create.uuid()})
              SET o.title = $title,
                  o.source_type = $source_type,
                  o.content_summary = $summary,
                  o.actor_name = $actor,
                  o.url = $url,
                  o.timestamp = datetime(),
                  o.salience_score = $score
              RETURN o.id
            `,
            parameters: {
              url,
              source_type: source_type || 'MEDIA',
              // Note: Parameters will be extracted from step 2 output in real flow
            }
          },
        },
        {
          agent_id: 'sentinel',
          tool_name: 'audit.run', // S4: Sentinel/Verify
          arguments: { target_id: '{{prev}}' },
        }
      ]
    })

    res.json({ success: true, execution_id: execution.execution_id })
  } catch (error) {
    logger.error({ error: String(error) }, 'S1-S4 Trigger failed')
    res.status(500).json({ success: false, error: String(error) })
  }
})
