/**
 * inventor-types.ts — Types for Orchestrator_Inventor (ASI-Evolve variant)
 *
 * Implements the data structures for the closed-loop evolution engine:
 *   Node → Trial → Result → Insight → (repeat)
 *
 * Runs alongside the existing Orchestrator without replacing it.
 * Uses a separate Redis keyspace (inventor:*) and separate Neo4j labels.
 */

// ─── Trial Node (equivalent to ASI-Evolve's Experiment Node) ─────────────────

export interface InventorNode {
  id: string
  /** Parent node ID (null for seed/initial nodes) */
  parentId: string | null
  /** The generated code/config/artifact being evolved */
  artifact: string
  /** Problem description this trial addresses */
  taskDescription: string
  /** Score from evaluator (higher = better) */
  score: number
  /** Structured metrics from engineer execution */
  metrics: Record<string, number>
  /** Analyzer-generated insight explaining why this succeeded/failed */
  analysis: string
  /** Researcher's motivation for proposing this variant */
  motivation: string
  /** Which island (for MAP-Elites), -1 for UCB1 mode */
  island: number
  /** Number of times sampled as parent (for UCB1) */
  visitCount: number
  /** Embedding vector (optional, for similarity search) */
  embedding?: number[]
  /** Chain mode used for execution */
  chainMode: string
  /** Timestamp */
  createdAt: string
  /** Status */
  status: 'pending' | 'running' | 'completed' | 'failed'
}

// ─── Cognition Item (prior knowledge injected before evolution) ───────────────

export interface CognitionItem {
  id: string
  title: string
  content: string
  domain: string[]
  source: string
  /** Similarity score from retrieval */
  score?: number
}

// ─── Trial Result (output from Engineer agent) ───────────────────────────────

export interface TrialResult {
  nodeId: string
  success: boolean
  score: number
  metrics: Record<string, number>
  /** Raw output from execution */
  output: string
  /** Error if failed */
  error?: string
  /** Duration in ms */
  durationMs: number
  /** LLM tokens used */
  tokensUsed: number
}

// ─── Evolution Config ────────────────────────────────────────────────────────

export type SamplingAlgorithm = 'ucb1' | 'greedy' | 'random' | 'island'

export interface InventorConfig {
  /** Experiment name (used for Redis/Neo4j namespacing) */
  experimentName: string
  /** Problem description */
  taskDescription: string
  /** Initial program/artifact to seed the evolution */
  initialArtifact?: string
  /** Sampling strategy */
  sampling: {
    algorithm: SamplingAlgorithm
    /** Number of parent nodes to sample per step */
    sampleN: number
    /** UCB1 exploration coefficient (default 1.414) */
    ucb1C?: number
    /** Island config */
    islands?: {
      count: number
      migrationInterval: number
      migrationRate: number
    }
  }
  /** Cognition store retrieval settings */
  cognition: {
    topK: number
    threshold: number
  }
  /** Pipeline settings */
  pipeline: {
    maxSteps: number
    /** Max artifact length in characters */
    maxArtifactLength: number
    /** Engineer timeout in ms */
    engineerTimeoutMs: number
    /** Parallel workers (1 = sequential) */
    numWorkers: number
  }
  /** Evaluation script/command (optional) */
  evalScript?: string
  /** LLM model to use for agents */
  model?: string
  /** Chain mode for engineer execution */
  chainMode?: string
}

// ─── Inventor Status (runtime state) ─────────────────────────────────────────

export interface InventorStatus {
  isRunning: boolean
  experimentName: string
  currentStep: number
  totalSteps: number
  nodesCreated: number
  bestScore: number
  bestNodeId: string | null
  samplingAlgorithm: SamplingAlgorithm
  startedAt: string | null
  lastStepAt: string | null
  /** Error from last step, if any */
  lastError: string | null
}

// ─── Inventor Run Request ────────────────────────────────────────────────────

export interface InventorRunRequest {
  config: InventorConfig
  /** Resume from existing experiment (skip seed) */
  resume?: boolean
}

export interface InventorStepResult {
  stepNumber: number
  nodeId: string
  parentId: string | null
  score: number
  bestScore: number
  analysis: string
  durationMs: number
}
