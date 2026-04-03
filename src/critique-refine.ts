/**
 * critique-refine.ts — Constitutional AI-inspired generate→critique→revise middleware (LIN-591 SNOUT-8).
 *
 * Pattern: HuggingFace Constitutional AI
 * 1. Generate initial response
 * 2. Critique against principles
 * 3. Revise based on critique
 *
 * Uses chatLLM from llm-proxy.ts. Provider-agnostic.
 */
import { chatLLM, type LLMMessage } from './llm-proxy.js'
import { logger } from './logger.js'

export interface CritiqueResult {
  original: string
  critique: string
  revised: string
  provider: string
  rounds: number
  duration_ms: number
}

const DEFAULT_PRINCIPLES = [
  'Accuracy: Are all claims factually correct and verifiable?',
  'Completeness: Does the response address all aspects of the query?',
  'Clarity: Is the response clear, well-structured, and free of jargon?',
  'Safety: Does the response avoid harmful, biased, or misleading content?',
  'Relevance: Does the response stay focused on the query without tangents?',
]

/**
 * Run the generate→critique→revise pipeline.
 * @param query - Original user query
 * @param provider - LLM provider to use (default: deepseek)
 * @param principles - Custom critique principles (default: 5 standard)
 * @param maxRounds - Max refine rounds (default: 1)
 */
export async function critiqueRefine(
  query: string,
  provider = 'deepseek',
  principles?: string[],
  maxRounds = 1,
): Promise<CritiqueResult> {
  const t0 = Date.now()
  const dims = principles ?? DEFAULT_PRINCIPLES

  // Step 1: Generate
  const genMessages: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful, accurate assistant. Respond thoroughly.' },
    { role: 'user', content: query },
  ]
  const genResponse = await chatLLM({ provider, messages: genMessages, temperature: 0.7 })
  let current = genResponse.content

  let critique = ''
  for (let round = 0; round < maxRounds; round++) {
    // Step 2: Critique
    const critiqueMessages: LLMMessage[] = [
      { role: 'system', content: `You are a strict quality reviewer. Evaluate the response against these principles:\n${dims.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nList specific issues found. If no issues, say "No issues found."` },
      { role: 'user', content: `Query: ${query}\n\nResponse to review:\n${current}` },
    ]
    const critiqueResponse = await chatLLM({ provider, messages: critiqueMessages, temperature: 0.3 })
    critique = critiqueResponse.content

    if (critique.toLowerCase().includes('no issues found')) break

    // Step 3: Revise
    const reviseMessages: LLMMessage[] = [
      { role: 'system', content: 'You are revising a response based on critique feedback. Keep what was good, fix what was flagged. Return only the improved response.' },
      { role: 'user', content: `Original query: ${query}\n\nCurrent response:\n${current}\n\nCritique:\n${critique}\n\nRevised response:` },
    ]
    const reviseResponse = await chatLLM({ provider, messages: reviseMessages, temperature: 0.5 })
    current = reviseResponse.content
  }

  const result: CritiqueResult = {
    original: genResponse.content,
    critique,
    revised: current,
    provider,
    rounds: maxRounds,
    duration_ms: Date.now() - t0,
  }

  logger.info({ provider, rounds: maxRounds, ms: result.duration_ms }, 'Critique-refine complete')
  return result
}
