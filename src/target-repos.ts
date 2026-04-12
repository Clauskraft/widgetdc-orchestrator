/**
 * Target repos for WidgeTDC — 25 repos med fantastisk content
 * LIN-764: Fantomstykliste — adoptér bedste kode fra open source
 */

export const TARGET_REPOS = [
  // ─── Code Intelligence & AST (som GitNexus) ─────────────────────────────
  { url: 'https://github.com/tree-sitter/tree-sitter', tags: ['ast', 'parser', 'core'] },
  { url: 'https://github.com/nicknisi/dotfiles', tags: ['config', 'patterns'] },
  { url: 'https://github.com/sourcegraph/sourcegraph', tags: ['code-intel', 'search', 'enterprise'] },

  // ─── Multi-Agent Frameworks (som open-multi-agent) ────────────────────────
  { url: 'https://github.com/crewAIInc/crewAI', tags: ['multi-agent', 'python', 'orchestration'] },
  { url: 'https://github.com/langchain-ai/langgraph', tags: ['graph', 'agents', 'orchestration'] },
  { url: 'https://github.com/openai/openai-agents-python', tags: ['agents', 'openai', 'handoff'] },
  { url: 'https://github.com/microsoft/autogen', tags: ['multi-agent', 'microsoft', 'conversation'] },
  { url: 'https://github.com/anthropics/anthropic-cookbook', tags: ['claude', 'patterns', 'cookbook'] },

  // ─── Knowledge Graph & Neo4j ──────────────────────────────────────────────
  { url: 'https://github.com/neo4j/neo4j', tags: ['graph-db', 'neo4j', 'core'] },
  { url: 'https://github.com/neo4j-labs/graphrag', tags: ['graphrag', 'neo4j', 'knowledge-graph'] },
  { url: 'https://github.com/langchain-ai/langchain', tags: ['langchain', 'rag', 'llm'] },

  // ─── RAG & Retrieval ─────────────────────────────────────────────────────
  { url: 'https://github.com/microsoft/graphrag', tags: ['graphrag', 'microsoft', 'knowledge'] },
  { url: 'https://github.com/qdrant/qdrant', tags: ['vector-db', 'search', 'embeddings'] },
  { url: 'https://github.com/chroma-core/chroma', tags: ['vector-db', 'embeddings', 'ai'] },
  { url: 'https://github.com/weaviate/weaviate', tags: ['vector-db', 'graphql', 'semantic-search'] },

  // ─── DevOps & Infrastructure ─────────────────────────────────────────────
  { url: 'https://github.com/railwayapp/railway', tags: ['deployment', 'railway', 'infra'] },
  { url: 'https://github.com/docker/compose', tags: ['docker', 'compose', 'devops'] },

  // ─── Danish Public Sector Tech ───────────────────────────────────────────
  { url: 'https://github.com/OS2mo/os2mo', tags: ['danish', 'public-sector', 'graphql'] },
  { url: 'https://github.com/magicsig/os2mou-data-import', tags: ['danish', 'data-import'] },
  { url: 'https://github.com/it-kontrakter/it-kontrakter', tags: ['danish', 'contracts'] },

  // ─── TypeScript Tooling ──────────────────────────────────────────────────
  { url: 'https://github.com/microsoft/TypeScript', tags: ['typescript', 'compiler', 'ast'] },
  { url: 'https://github.com/eslint/eslint', tags: ['linting', 'ast', 'typescript'] },

  // ─── Agent Memory & Context ──────────────────────────────────────────────
  { url: 'https://github.com/letsdata-ai/letta', tags: ['agent-memory', 'context', 'llm'] },
  { url: 'https://github.com/microsoft/JARVIS', tags: ['agent', 'microsoft', 'task-planning'] },

  // ─── Graph Visualization ─────────────────────────────────────────────────
  { url: 'https://github.com/gephi/gephi', tags: ['graph-viz', 'network', 'visualization'] },
]
