/**
 * routes/abi-health.ts — ABI Health & Snapshot endpoints (LIN-570).
 *
 * Exposes the Triple-Protocol ABI state for monitoring and CI/CD:
 *
 *   GET  /api/abi/health    — Current ABI state (tool count, protocols, version)
 *   GET  /api/abi/diff      — Compare current registry vs last deployed snapshot
 *   POST /api/abi/snapshot  — Save current state as new baseline
 */
import { Router, Request, Response } from 'express'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  TOOL_REGISTRY,
  toOpenAITools,
  toMCPTools,
  toOpenAPIPaths,
} from '../tool-registry.js'
import { logger } from '../logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const abiHealthRouter = Router()

// Snapshot lives alongside the test snapshots (or at project root in prod)
function getSnapshotPath(): string {
  // Try test/snapshots first (dev), fall back to dist-adjacent
  const testPath = path.resolve(__dirname, '..', '..', 'test', 'snapshots', 'abi-snapshot.json')
  if (existsSync(testPath)) return testPath
  // Fallback: next to dist/
  const distPath = path.resolve(__dirname, '..', 'abi-snapshot.json')
  return existsSync(distPath) ? distPath : testPath
}

/** Build a snapshot from the live registry */
function buildCurrentSnapshot() {
  const openaiTools = toOpenAITools()
  const mcpTools = toMCPTools()
  const openapiPaths = toOpenAPIPaths()

  return {
    tools: TOOL_REGISTRY.map(t => ({
      name: t.name,
      namespace: t.namespace,
      version: t.version,
      description: t.description,
      category: t.category,
      inputSchema: t.inputSchema,
      handler: t.handler,
      backendTool: t.backendTool ?? null,
      timeoutMs: t.timeoutMs,
      authRequired: t.authRequired,
      availableVia: t.availableVia,
      tags: t.tags,
      deprecated: t.deprecated ?? null,
    })),
    protocols: {
      openai: { count: openaiTools.length, tools: openaiTools.map(t => t.function.name) },
      mcp: { count: mcpTools.length, tools: mcpTools.map(t => t.name) },
      openapi: { count: Object.keys(openapiPaths).length, paths: Object.keys(openapiPaths) },
    },
    meta: {
      total_tools: TOOL_REGISTRY.length,
      namespaces: [...new Set(TOOL_REGISTRY.map(t => t.namespace))].sort(),
      deprecated_count: TOOL_REGISTRY.filter(t => t.deprecated).length,
      generated_at: new Date().toISOString(),
      abi_version: '1.0',
    },
  }
}

/** Diff two snapshots and classify changes */
function diffSnapshots(baseline: any, current: any) {
  const breaking: string[] = []
  const additive: string[] = []
  const compatible: string[] = []

  const baseToolMap = new Map(baseline.tools.map((t: any) => [t.name, t]))
  const currToolMap = new Map(current.tools.map((t: any) => [t.name, t]))

  // Removed tools
  for (const [name] of baseToolMap) {
    if (!currToolMap.has(name)) breaking.push(`REMOVED tool: ${name}`)
  }

  // New tools
  for (const [name] of currToolMap) {
    if (!baseToolMap.has(name)) additive.push(`ADDED tool: ${name}`)
  }

  // Per-tool changes
  for (const [name, baseTool] of baseToolMap as Map<string, any>) {
    const currTool = currToolMap.get(name) as any
    if (!currTool) continue

    const baseSchema = baseTool.inputSchema ?? {}
    const currSchema = currTool.inputSchema ?? {}
    const baseRequired = new Set(baseSchema.required ?? [])
    const currRequired = new Set(currSchema.required ?? [])
    const baseProps = baseSchema.properties ?? {}
    const currProps = currSchema.properties ?? {}

    // Removed fields
    for (const field of Object.keys(baseProps)) {
      if (!(field in currProps)) breaking.push(`REMOVED field: ${name}.${field}`)
    }

    // New required fields
    for (const field of currRequired as Set<string>) {
      if (!baseRequired.has(field) && !(field in baseProps)) {
        breaking.push(`ADDED required field: ${name}.${field}`)
      }
    }

    // Changed types
    for (const field of Object.keys(baseProps)) {
      if (!(field in currProps)) continue
      const bt = baseProps[field]?.type
      const ct = currProps[field]?.type
      if (bt && ct && bt !== ct) breaking.push(`CHANGED type: ${name}.${field} (${bt} -> ${ct})`)
    }

    // New optional fields
    for (const field of Object.keys(currProps)) {
      if (!(field in baseProps) && !currRequired.has(field)) {
        additive.push(`ADDED optional field: ${name}.${field}`)
      }
    }

    // Description change
    if (baseTool.description !== currTool.description) {
      compatible.push(`UPDATED description: ${name}`)
    }

    // Protocol changes
    const baseProtos = new Set(baseTool.availableVia ?? [])
    const currProtos = new Set(currTool.availableVia ?? [])
    for (const p of baseProtos as Set<string>) {
      if (!currProtos.has(p)) breaking.push(`REMOVED protocol: ${name} no longer via ${p}`)
    }
    for (const p of currProtos as Set<string>) {
      if (!baseProtos.has(p)) additive.push(`ADDED protocol: ${name} now via ${p}`)
    }
  }

  return { breaking, additive, compatible }
}

// ─── GET /health — Current ABI state ────────────────────────────────────────

abiHealthRouter.get('/health', (_req: Request, res: Response) => {
  const openaiTools = toOpenAITools()
  const mcpTools = toMCPTools()
  const openapiPaths = toOpenAPIPaths()

  const snapshotPath = getSnapshotPath()
  const hasBaseline = existsSync(snapshotPath)

  res.json({
    success: true,
    data: {
      total_tools: TOOL_REGISTRY.length,
      namespaces: [...new Set(TOOL_REGISTRY.map(t => t.namespace))].sort(),
      deprecated: TOOL_REGISTRY.filter(t => t.deprecated).length,
      protocols: {
        openai: openaiTools.length,
        mcp: mcpTools.length,
        openapi: Object.keys(openapiPaths).length,
      },
      has_baseline_snapshot: hasBaseline,
      abi_version: '1.0',
      timestamp: new Date().toISOString(),
    },
  })
})

// ─── GET /diff — Compare current vs baseline ────────────────────────────────

abiHealthRouter.get('/diff', (_req: Request, res: Response) => {
  const snapshotPath = getSnapshotPath()

  if (!existsSync(snapshotPath)) {
    res.status(404).json({
      success: false,
      error: { code: 'NO_BASELINE', message: 'No baseline snapshot found. POST /api/abi/snapshot to create one.', status_code: 404 },
    })
    return
  }

  try {
    const baseline = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
    const current = buildCurrentSnapshot()
    const diff = diffSnapshots(baseline, current)

    const totalChanges = diff.breaking.length + diff.additive.length + diff.compatible.length
    const isCompatible = diff.breaking.length === 0

    res.json({
      success: true,
      data: {
        compatible: isCompatible,
        baseline_tools: baseline.meta.total_tools,
        current_tools: current.meta.total_tools,
        baseline_generated_at: baseline.meta.generated_at,
        changes: {
          total: totalChanges,
          breaking: diff.breaking,
          additive: diff.additive,
          compatible: diff.compatible,
        },
      },
    })
  } catch (err) {
    logger.error({ err: String(err) }, 'ABI diff error')
    res.status(500).json({
      success: false,
      error: { code: 'ABI_DIFF_ERROR', message: String(err), status_code: 500 },
    })
  }
})

// ─── POST /snapshot — Save current as new baseline ──────────────────────────

abiHealthRouter.post('/snapshot', (_req: Request, res: Response) => {
  try {
    const snapshot = buildCurrentSnapshot()
    const snapshotPath = path.resolve(__dirname, '..', '..', 'test', 'snapshots', 'abi-snapshot.json')

    // Ensure directory exists
    const dir = path.dirname(snapshotPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))

    logger.info({
      tools: snapshot.meta.total_tools,
      namespaces: snapshot.meta.namespaces.length,
    }, 'ABI snapshot saved')

    res.json({
      success: true,
      data: {
        message: 'ABI baseline snapshot saved',
        total_tools: snapshot.meta.total_tools,
        namespaces: snapshot.meta.namespaces,
        protocols: snapshot.protocols,
        saved_to: snapshotPath,
        generated_at: snapshot.meta.generated_at,
      },
    })
  } catch (err) {
    logger.error({ err: String(err) }, 'ABI snapshot save error')
    res.status(500).json({
      success: false,
      error: { code: 'ABI_SNAPSHOT_ERROR', message: String(err), status_code: 500 },
    })
  }
})
