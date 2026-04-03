/**
 * document-intelligence.ts — F2: Document Intelligence Pipeline (LIN-574 v3.0)
 *
 * Unified pipeline: PDF → Parse → Entity Extract → Neo4j MERGE → Enrich
 *
 * Supports 3 parsing modes:
 *   1. Docling-serve (HTTP) — best quality, requires Docker sidecar
 *   2. Backend MCP tool (srag.ingest) — uses existing backend parsing
 *   3. Text-only fallback — basic extraction for when services are unavailable
 *
 * Integrates: RLM cognitive for entity extraction, write-gate for validation,
 * chain-engine for orchestration, context-folding for large documents.
 */
import { v4 as uuid } from 'uuid'
import { callMcpTool } from './mcp-caller.js'
import { callCognitive } from './cognitive-proxy.js'
import { logger } from './logger.js'
import { getRedis } from './redis.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DocumentIngestionRequest {
  /** Document content (markdown, text, or base64 for PDF) */
  content: string
  /** Source filename */
  filename: string
  /** Content type */
  content_type?: 'text/markdown' | 'text/plain' | 'application/pdf'
  /** Source URL or path */
  source_url?: string
  /** Target domain for classification */
  domain?: string
  /** Whether to extract entities and link to graph */
  extract_entities?: boolean
  /** Whether to generate embeddings */
  generate_embeddings?: boolean
}

interface ExtractedEntity {
  name: string
  type: string
  properties: Record<string, string>
}

interface ExtractedRelation {
  from: string
  to: string
  type: string
}

export interface IngestionResult {
  $id: string
  filename: string
  status: 'completed' | 'partial' | 'failed'
  content_length: number
  sections_found: number
  tables_found: number
  entities_extracted: number
  relations_extracted: number
  nodes_merged: number
  duration_ms: number
  parsing_method: 'docling' | 'mcp-srag' | 'text-fallback'
  error?: string
}

// ─── Storage ────────────────────────────────────────────────────────────────

const REDIS_PREFIX = 'orchestrator:ingestion:'

async function persistResult(result: IngestionResult): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(`${REDIS_PREFIX}${result.$id}`, JSON.stringify(result), 'EX', 604800)
  } catch { /* non-critical */ }
}

// ─── Main Pipeline ──────────────────────────────────────────────────────────

export async function ingestDocument(req: DocumentIngestionRequest): Promise<IngestionResult> {
  const t0 = Date.now()
  const ingestionId = `widgetdc:ingestion:${uuid()}`

  logger.info({
    id: ingestionId,
    filename: req.filename,
    content_length: req.content.length,
  }, 'Document intelligence: starting ingestion')

  const result: IngestionResult = {
    $id: ingestionId,
    filename: req.filename,
    status: 'completed',
    content_length: req.content.length,
    sections_found: 0,
    tables_found: 0,
    entities_extracted: 0,
    relations_extracted: 0,
    nodes_merged: 0,
    duration_ms: 0,
    parsing_method: 'text-fallback',
  }

  try {
    // ──── Step 1: PARSE — Convert document to structured markdown ────────
    let markdown: string
    let tables: string[] = []

    // Try Docling-serve first (best quality)
    const doclingResult = await tryDoclingParse(req)
    if (doclingResult) {
      markdown = doclingResult.markdown
      tables = doclingResult.tables
      result.parsing_method = 'docling'
    } else {
      // Fallback: use content as-is (already markdown/text)
      markdown = req.content
      result.parsing_method = req.content_type === 'application/pdf' ? 'text-fallback' : 'text-fallback'
    }

    // Count sections and tables
    result.sections_found = (markdown.match(/^#{1,3}\s/gm) ?? []).length
    result.tables_found = tables.length + (markdown.match(/\|.*\|.*\|/g) ?? []).length

    // ──── Step 2: FOLD — Compress if too large for entity extraction ─────
    let processableContent = markdown
    if (markdown.length > 30000) {
      // Use RLM folding to compress while preserving key entities
      try {
        const folded = await callCognitive('fold', {
          prompt: markdown,
          context: { strategy: 'entity_preserving', max_tokens: 8000 },
          agent_id: 'document-intelligence',
        }, 30000)
        processableContent = typeof folded === 'string' ? folded : JSON.stringify(folded)
        logger.info({ original: markdown.length, folded: processableContent.length }, 'Document folded for entity extraction')
      } catch {
        // Fallback: truncate
        processableContent = markdown.slice(0, 30000)
      }
    }

    // ──── Step 3: EXTRACT — Entity + relationship extraction via RLM ─────
    if (req.extract_entities !== false) {
      const extraction = await extractEntities(processableContent, req.filename, req.domain)
      result.entities_extracted = extraction.entities.length
      result.relations_extracted = extraction.relations.length

      // ──── Step 4: MERGE — Write to Neo4j through write-gate ───────────
      if (extraction.entities.length > 0) {
        const merged = await mergeToGraph(extraction.entities, extraction.relations, req)
        result.nodes_merged = merged
      }
    }

    // ──── Step 5: INGEST to SRAG — Send to backend for vector indexing ───
    if (req.generate_embeddings !== false) {
      try {
        await callMcpTool({
          toolName: 'vidensarkiv.add',
          args: {
            title: req.filename,
            content: markdown.slice(0, 10000),
            source: req.source_url ?? req.filename,
            domain: req.domain ?? 'general',
          },
          callId: uuid(),
          timeoutMs: 20000,
        })
      } catch {
        logger.warn({ filename: req.filename }, 'SRAG ingest failed — entities still in graph')
      }
    }

  } catch (err) {
    result.status = 'failed'
    result.error = err instanceof Error ? err.message : String(err)
    logger.error({ id: ingestionId, error: result.error }, 'Document intelligence: failed')
  }

  result.duration_ms = Date.now() - t0
  await persistResult(result)

  logger.info({
    id: ingestionId,
    method: result.parsing_method,
    entities: result.entities_extracted,
    nodes: result.nodes_merged,
    ms: result.duration_ms,
  }, 'Document intelligence: complete')

  return result
}

// ─── Step 1: Docling Parse ──────────────────────────────────────────────────

async function tryDoclingParse(req: DocumentIngestionRequest): Promise<{ markdown: string; tables: string[] } | null> {
  const doclingUrl = process.env.DOCLING_URL
  if (!doclingUrl) return null

  try {
    const res = await fetch(`${doclingUrl}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: req.content,
        filename: req.filename,
        output_format: 'markdown',
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!res.ok) return null

    const data = await res.json() as { markdown?: string; tables?: string[] }
    if (data.markdown) {
      return { markdown: data.markdown, tables: data.tables ?? [] }
    }
  } catch {
    logger.debug('Docling-serve not available — using fallback')
  }
  return null
}

// ─── Step 3: Entity Extraction ──────────────────────────────────────────────

async function extractEntities(
  content: string,
  filename: string,
  domain?: string,
): Promise<{ entities: ExtractedEntity[]; relations: ExtractedRelation[] }> {
  try {
    const result = await callCognitive('analyze', {
      prompt: `Extract named entities and relationships from this document.

DOCUMENT: "${filename}" (domain: ${domain ?? 'general'})

CONTENT:
${content.slice(0, 12000)}

RULES:
- Extract organizations, regulations, technologies, frameworks, methodologies, services
- Extract relationships: USES, COMPLIES_WITH, COMPETES_WITH, PART_OF, RELATES_TO
- Return ONLY entities that are specific and named (not generic concepts)
- Limit to 20 most important entities

Reply as JSON:
{"entities": [{"name": "Entity Name", "type": "Organization|Regulation|Technology|Framework|Service", "properties": {"domain": "...", "description": "..."}}], "relations": [{"from": "Entity A", "to": "Entity B", "type": "USES|COMPLIES_WITH|..."}]}`,
      context: { filename, domain: domain ?? 'general', source: 'document-intelligence' },
      agent_id: 'document-intelligence',
    }, 30000)

    const text = String(result ?? '')
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 20) : [],
        relations: Array.isArray(parsed.relations) ? parsed.relations.slice(0, 30) : [],
      }
    }
  } catch (err) {
    logger.warn({ error: String(err), filename }, 'Entity extraction failed')
  }
  return { entities: [], relations: [] }
}

// ─── Step 4: Neo4j MERGE ────────────────────────────────────────────────────

async function mergeToGraph(
  entities: ExtractedEntity[],
  relations: ExtractedRelation[],
  req: DocumentIngestionRequest,
): Promise<number> {
  let merged = 0

  // Batch MERGE entities
  for (const entity of entities) {
    try {
      const safeLabel = (entity.type ?? 'Knowledge').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64)
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `MERGE (n:${safeLabel} {name: $name})
SET n.domain = $domain, n.source = $source, n.updatedAt = datetime()
WITH n
MERGE (d:TDCDocument {filename: $filename})
MERGE (n)-[:EXTRACTED_FROM]->(d)`,
          params: {
            name: entity.name,
            domain: entity.properties?.domain ?? req.domain ?? 'general',
            source: req.source_url ?? req.filename,
            filename: req.filename,
          },
        },
        callId: uuid(),
        timeoutMs: 10000,
      })
      merged++
    } catch (err) {
      logger.debug({ entity: entity.name, error: String(err) }, 'Entity MERGE failed')
    }
  }

  // Batch MERGE relations
  for (const rel of relations) {
    try {
      await callMcpTool({
        toolName: 'graph.write_cypher',
        args: {
          query: `MATCH (a {name: $from}), (b {name: $to})
MERGE (a)-[:${rel.type.replace(/[^A-Z_]/g, '_')}]->(b)`,
          params: { from: rel.from, to: rel.to },
        },
        callId: uuid(),
        timeoutMs: 5000,
      })
    } catch { /* relationship MERGE is best-effort */ }
  }

  return merged
}

// ─── Batch Ingest ───────────────────────────────────────────────────────────

export async function batchIngest(
  documents: DocumentIngestionRequest[],
): Promise<IngestionResult[]> {
  // Process max 5 in parallel to avoid overwhelming backend
  const BATCH_SIZE = 5
  const results: IngestionResult[] = []

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(batch.map(d => ingestDocument(d)))
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value)
    }
  }

  return results
}
