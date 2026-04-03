/**
 * ABI Snapshot Test — LIN-570
 *
 * Detects breaking changes in the Triple-Protocol ABI by diffing
 * against a saved baseline snapshot. Runs standalone with `node`.
 *
 * Exit codes:
 *   0 = compatible (or first run / --update → snapshot created)
 *   1 = breaking changes detected
 *
 * Usage:
 *   node test/abi-snapshot.test.mjs            # diff against baseline
 *   node test/abi-snapshot.test.mjs --update   # overwrite baseline
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const SNAPSHOT_PATH = path.join(__dirname, 'snapshots', 'abi-snapshot.json')

// Ensure snapshots dir exists
mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true })

// ─── Extract registry via temp file + tsx ───────────────────────────────────
// We can't import dist/index.js directly (it boots Express + Redis).
// Instead, write a temp .ts extractor that imports only tool-registry.ts.

const EXTRACTOR_PATH = path.join(PROJECT_ROOT, '_abi-extract.tmp.ts')
const EXTRACTOR_OUT = path.join(PROJECT_ROOT, '_abi-extract.tmp.json')

const extractorCode = `
import { TOOL_REGISTRY, toOpenAITools, toMCPTools, toOpenAPIPaths } from './src/tool-registry.js'
import { writeFileSync } from 'fs'

const snapshot = {
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
    openai: { count: toOpenAITools().length, tools: toOpenAITools().map(t => t.function.name) },
    mcp: { count: toMCPTools().length, tools: toMCPTools().map(t => t.name) },
    openapi: { count: Object.keys(toOpenAPIPaths()).length, paths: Object.keys(toOpenAPIPaths()) },
  },
  meta: {
    total_tools: TOOL_REGISTRY.length,
    namespaces: [...new Set(TOOL_REGISTRY.map(t => t.namespace))].sort(),
    deprecated_count: TOOL_REGISTRY.filter(t => t.deprecated).length,
    generated_at: new Date().toISOString(),
    abi_version: '1.0',
  },
}

writeFileSync('_abi-extract.tmp.json', JSON.stringify(snapshot, null, 2))
`

// Write extractor, run it, clean up
writeFileSync(EXTRACTOR_PATH, extractorCode)

try {
  execSync('npx tsx _abi-extract.tmp.ts', {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
} catch (err) {
  // Clean up temp files on failure
  try { unlinkSync(EXTRACTOR_PATH) } catch {}
  try { unlinkSync(EXTRACTOR_OUT) } catch {}
  console.error('ERROR: Failed to extract tool registry via tsx.')
  console.error(err.stderr || err.message)
  process.exit(1)
}

// Read extracted JSON
if (!existsSync(EXTRACTOR_OUT)) {
  try { unlinkSync(EXTRACTOR_PATH) } catch {}
  console.error('ERROR: Extractor ran but produced no output JSON.')
  process.exit(1)
}

const current = JSON.parse(readFileSync(EXTRACTOR_OUT, 'utf-8'))

// Clean up temp files
try { unlinkSync(EXTRACTOR_PATH) } catch {}
try { unlinkSync(EXTRACTOR_OUT) } catch {}

// ─── Diff engine ────────────────────────────────────────────────────────────

const updateMode = process.argv.includes('--update')

// First run or --update: save snapshot
if (!existsSync(SNAPSHOT_PATH) || updateMode) {
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2))
  const label = updateMode ? 'Updated' : 'Created'
  console.log(`${label} ABI snapshot: ${current.meta.total_tools} tools, ${current.meta.namespaces.length} namespaces`)
  console.log(`  OpenAI: ${current.protocols.openai.count}, MCP: ${current.protocols.mcp.count}, OpenAPI: ${current.protocols.openapi.count}`)
  console.log(`  Snapshot saved to: ${SNAPSHOT_PATH}`)
  process.exit(0)
}

// Load baseline
const baseline = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'))

const breaking = []
const additive = []
const compatible = []

const baseToolMap = new Map(baseline.tools.map(t => [t.name, t]))
const currToolMap = new Map(current.tools.map(t => [t.name, t]))

// 1. Check for removed tools (BREAKING)
for (const [name] of baseToolMap) {
  if (!currToolMap.has(name)) {
    breaking.push(`REMOVED tool: ${name}`)
  }
}

// 2. Check for new tools (ADDITIVE)
for (const [name] of currToolMap) {
  if (!baseToolMap.has(name)) {
    additive.push(`ADDED tool: ${name}`)
  }
}

// 3. Compare existing tools field-by-field
for (const [name, baseTool] of baseToolMap) {
  const currTool = currToolMap.get(name)
  if (!currTool) continue // already flagged as removed

  const baseSchema = baseTool.inputSchema ?? {}
  const currSchema = currTool.inputSchema ?? {}
  const baseRequired = new Set(baseSchema.required ?? [])
  const currRequired = new Set(currSchema.required ?? [])
  const baseProps = baseSchema.properties ?? {}
  const currProps = currSchema.properties ?? {}

  // Removed required fields (BREAKING)
  for (const field of baseRequired) {
    if (!currRequired.has(field) && !(field in currProps)) {
      breaking.push(`REMOVED required field: ${name}.${field}`)
    }
  }

  // Removed fields entirely (BREAKING)
  for (const field of Object.keys(baseProps)) {
    if (!(field in currProps)) {
      breaking.push(`REMOVED field: ${name}.${field}`)
    }
  }

  // New required fields (BREAKING — existing callers won't send them)
  for (const field of currRequired) {
    if (!baseRequired.has(field) && !(field in baseProps)) {
      breaking.push(`ADDED required field: ${name}.${field} (breaks existing callers)`)
    }
  }

  // Changed field types (BREAKING)
  for (const field of Object.keys(baseProps)) {
    if (!(field in currProps)) continue
    const baseType = baseProps[field]?.type
    const currType = currProps[field]?.type
    if (baseType && currType && baseType !== currType) {
      breaking.push(`CHANGED type: ${name}.${field} (${baseType} -> ${currType})`)
    }
  }

  // New optional fields (ADDITIVE)
  for (const field of Object.keys(currProps)) {
    if (!(field in baseProps)) {
      if (currRequired.has(field)) continue // already flagged above
      additive.push(`ADDED optional field: ${name}.${field}`)
    }
  }

  // Description changes (COMPATIBLE)
  if (baseTool.description !== currTool.description) {
    compatible.push(`UPDATED description: ${name}`)
  }

  // Namespace/category changes (COMPATIBLE)
  if (baseTool.namespace !== currTool.namespace) {
    compatible.push(`CHANGED namespace: ${name} (${baseTool.namespace} -> ${currTool.namespace})`)
  }

  // Timeout changes (COMPATIBLE)
  if (baseTool.timeoutMs !== currTool.timeoutMs) {
    compatible.push(`CHANGED timeout: ${name} (${baseTool.timeoutMs} -> ${currTool.timeoutMs})`)
  }

  // Protocol availability changes
  const baseProtos = new Set(baseTool.availableVia ?? [])
  const currProtos = new Set(currTool.availableVia ?? [])
  for (const p of baseProtos) {
    if (!currProtos.has(p)) {
      breaking.push(`REMOVED protocol: ${name} no longer available via ${p}`)
    }
  }
  for (const p of currProtos) {
    if (!baseProtos.has(p)) {
      additive.push(`ADDED protocol: ${name} now available via ${p}`)
    }
  }

  // Deprecation changes (COMPATIBLE)
  if (!baseTool.deprecated && currTool.deprecated) {
    compatible.push(`DEPRECATED: ${name} (since ${currTool.deprecated.since})`)
  }
  if (baseTool.deprecated && !currTool.deprecated) {
    compatible.push(`UN-DEPRECATED: ${name}`)
  }
}

// ─── Output ─────────────────────────────────────────────────────────────────

const totalChanges = breaking.length + additive.length + compatible.length

if (totalChanges === 0) {
  console.log(`ABI compatible (${current.meta.total_tools} tools, 0 changes)`)
  process.exit(0)
}

if (breaking.length > 0) {
  console.error(`BREAKING CHANGES DETECTED:`)
  for (const b of breaking) console.error(`  - ${b}`)
  if (additive.length > 0) {
    console.log(`\nAdditive changes (${additive.length}):`)
    for (const a of additive) console.log(`  + ${a}`)
  }
  if (compatible.length > 0) {
    console.log(`\nCompatible changes (${compatible.length}):`)
    for (const c of compatible) console.log(`  ~ ${c}`)
  }
  console.error(`\nTotal: ${totalChanges} changes (${breaking.length} breaking, ${additive.length} additive, ${compatible.length} compatible)`)
  console.error(`\nTo accept these changes, run: node test/abi-snapshot.test.mjs --update`)
  process.exit(1)
}

// No breaking changes
console.log(`ABI compatible (${current.meta.total_tools} tools, ${totalChanges} changes: ${additive.length} additive, ${compatible.length} compatible)`)
if (additive.length > 0) {
  for (const a of additive) console.log(`  + ${a}`)
}
if (compatible.length > 0) {
  for (const c of compatible) console.log(`  ~ ${c}`)
}
process.exit(0)
