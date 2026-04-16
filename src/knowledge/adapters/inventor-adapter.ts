// src/knowledge/adapters/inventor-adapter.ts
//
// Emits the best InventorNode to the KnowledgeBus when an experiment completes.
// Called from inventor-loop.ts › runInventor() in the finally block.
import type { InventorNode } from '../../intelligence/inventor-types.js'
import { emitKnowledge } from '../index.js'

export function emitInventorResult(
  experimentName: string,
  bestNode: InventorNode,
  totalSteps: number,
): void {
  if (!bestNode.artifact || bestNode.score < 0.5) return  // skip low-quality results

  emitKnowledge({
    source: 'inventor',
    title: `Inventor: ${experimentName}`,
    content: typeof bestNode.artifact === 'string'
      ? bestNode.artifact
      : JSON.stringify(bestNode.artifact, null, 2),
    summary: `Evolved protocol from ${experimentName} (${totalSteps} steps, score ${bestNode.score.toFixed(2)})`,
    score: bestNode.score,
    tags: ['inventor', 'evolved', experimentName],
    repo: 'widgetdc-orchestrator',
    metadata: {
      experimentName,
      nodeId: bestNode.id,
      totalSteps,
      metrics: bestNode.metrics,
      analysis: bestNode.analysis,
    },
  })
}
