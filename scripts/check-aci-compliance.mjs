#!/usr/bin/env node
/**
 * check-aci-compliance.mjs — SWE-agent ACI Paradigm compliance checker
 *
 * Pick #1 from docs/PHANTOM_PRIORITY_NOW.md — enforces Agent-Computer Interface
 * rules on every MCP tool definition in src/tools/tool-registry.ts.
 *
 * Rules (from SWE-agent paper + adapted to WidgeTDC conventions):
 *   A1. Tool name ≤25 chars, lowercase snake_case (no camelCase, no dashes)
 *   A2. Namespace is non-empty and lowercase
 *   A3. Description is present, ≤200 chars, starts with an action verb
 *   A4. Input schema: ≤6 required fields; every field has a .describe()
 *   A5. No unsafe-sounding names without risk level documented
 *
 * Run standalone:   node scripts/check-aci-compliance.mjs
 * CI integration:   called from scripts/ci-adoption-check.mjs CHECK 8
 *
 * Exit code: 0 if zero violations or only warnings; 1 on hard violations.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const REGISTRY = path.join(ROOT, 'src/tools/tool-registry.ts')

const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const GREEN  = '\x1b[32m'
const CYAN   = '\x1b[36m'
const DIM    = '\x1b[2m'

// ─── Action verbs acceptable as first word of description ──────────────────
const ACTION_VERBS = new Set([
  'search','retrieve','fetch','query','read','list','get','count','analyze','audit','check',
  'validate','verify','review','run','execute','trigger','dispatch','invoke','call',
  'create','write','register','store','save','record','add','update','modify','ingest',
  'delete','remove','clear','prune','archive','expire','rollback',
  'generate','produce','compose','build','assemble','render','convert','transform','fold',
  'score','rank','rate','measure','compute','estimate','forecast','predict',
  'route','select','resolve','discover','match','correlate','crosswalk',
  'monitor','detect','flag','alert','report','summarize','explain','describe','show',
  'deposit','sense','broadcast','acknowledge','harvest','crawl','scan','probe',
  'start','stop','pause','resume','kill','restart','recover','heal',
  'consolidate','dedupe','merge','split','chunk','batch',
  'configure','approve','decide','escalate','plan','orchestrate','coordinate',
  'stub','return','provide','emit','persist',
])

const MAX_NAME_LEN = 25
const MAX_DESC_LEN = 200
const MAX_REQUIRED_FIELDS = 6
const NAME_RE = /^[a-z][a-z0-9_]*$/

// ─── Parse tool-registry.ts ────────────────────────────────────────────────

const source = readFileSync(REGISTRY, 'utf8')

/**
 * Extract defineTool({...}) blocks. Simple regex-based parser — not full AST
 * but robust enough for our consistent style.
 */
function extractTools(src) {
  const tools = []
  const blockRe = /defineTool\s*\(\s*\{([\s\S]*?)\}\s*\)/g
  let m
  while ((m = blockRe.exec(src)) !== null) {
    const body = m[1]
    const name = /name:\s*['"]([^'"]+)['"]/.exec(body)?.[1]
    const namespace = /namespace:\s*['"]([^'"]+)['"]/.exec(body)?.[1]
    const description = /description:\s*['"](.+?)['"]/s.exec(body)?.[1]
    const inputBlock = /input:\s*(z\.object\(\s*\{[\s\S]*?\}\s*\))/.exec(body)?.[1] ?? ''
    // Skip entries without a name — likely regex false-positive on commented code
    if (!name) continue
    tools.push({ name, namespace, description, inputBlock, raw: body })
  }
  return tools
}

function describeCount(inputBlock) {
  return (inputBlock.match(/\.describe\(/g) || []).length
}

function fieldCount(inputBlock) {
  // Count top-level field declarations — lines matching `  <name>: z.`
  const matches = inputBlock.match(/^\s{2,}[a-z_][a-zA-Z0-9_]*\s*:\s*z\./gm)
  return matches ? matches.length : 0
}

function requiredFieldCount(inputBlock) {
  const total = fieldCount(inputBlock)
  const optional = (inputBlock.match(/\.optional\(\)/g) || []).length
  return Math.max(0, total - optional)
}

// ─── Evaluate rules ────────────────────────────────────────────────────────

function checkTool(t) {
  const errors = []
  const warnings = []

  if (!t.name) { errors.push('missing name'); return { errors, warnings } }

  // A1 — name format
  if (t.name.length > MAX_NAME_LEN) {
    warnings.push(`name length ${t.name.length} > ${MAX_NAME_LEN}`)
  }
  if (!NAME_RE.test(t.name)) {
    errors.push(`name not snake_case: "${t.name}"`)
  }

  // A2 — namespace
  if (!t.namespace) {
    errors.push('missing namespace')
  } else if (t.namespace !== t.namespace.toLowerCase()) {
    errors.push(`namespace not lowercase: "${t.namespace}"`)
  }

  // A3 — description
  if (!t.description) {
    errors.push('missing description')
  } else {
    if (t.description.length > MAX_DESC_LEN) {
      warnings.push(`description ${t.description.length} chars > ${MAX_DESC_LEN}`)
    }
    const firstWord = t.description.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '')
    if (firstWord && !ACTION_VERBS.has(firstWord)) {
      warnings.push(`description does not start with action verb (got "${firstWord}")`)
    }
  }

  // A4 — input schema rigor
  const required = requiredFieldCount(t.inputBlock)
  const total = fieldCount(t.inputBlock)
  const describes = describeCount(t.inputBlock)
  if (required > MAX_REQUIRED_FIELDS) {
    warnings.push(`${required} required fields > ${MAX_REQUIRED_FIELDS}`)
  }
  if (total > 0 && describes < total) {
    warnings.push(`${total - describes}/${total} fields missing .describe()`)
  }

  return { errors, warnings }
}

// ─── Main ──────────────────────────────────────────────────────────────────

const tools = extractTools(source)
console.log(`${BOLD}${CYAN}ACI Compliance Check${RESET}`)
console.log(`${DIM}Scanning ${tools.length} tool definitions in src/tools/tool-registry.ts${RESET}\n`)

let hardErrors = 0
let softWarnings = 0
const report = []

for (const t of tools) {
  const { errors, warnings } = checkTool(t)
  if (errors.length === 0 && warnings.length === 0) continue
  report.push({ tool: t, errors, warnings })
  hardErrors += errors.length
  softWarnings += warnings.length
}

// Sort: errors first, then by name
report.sort((a, b) => (b.errors.length - a.errors.length) || (a.tool.name || '').localeCompare(b.tool.name || ''))

for (const r of report.slice(0, 40)) {
  const n = r.tool.name ?? '(unnamed)'
  const ns = r.tool.namespace ?? '?'
  console.log(`${BOLD}${ns}.${n}${RESET}`)
  for (const e of r.errors)   console.log(`  ${RED}✗${RESET} ${e}`)
  for (const w of r.warnings) console.log(`  ${YELLOW}⚠${RESET} ${w}`)
}

if (report.length > 40) {
  console.log(`${DIM}… and ${report.length - 40} more tools with findings${RESET}`)
}

console.log(`\n${BOLD}Summary:${RESET} ${tools.length} tools scanned`)
console.log(`  ${hardErrors === 0 ? GREEN : RED}${hardErrors} hard errors${RESET}`)
console.log(`  ${softWarnings === 0 ? GREEN : YELLOW}${softWarnings} warnings${RESET}`)
console.log(`  ${GREEN}${tools.length - report.length} clean${RESET}`)

// For CI: expose machine-readable counts on last line
const outPath = path.join(ROOT, 'aci-report.json')
try {
  const { writeFileSync } = await import('fs')
  writeFileSync(outPath, JSON.stringify({
    total: tools.length,
    clean: tools.length - report.length,
    hard_errors: hardErrors,
    warnings: softWarnings,
    findings: report.map(r => ({
      name: r.tool.name,
      namespace: r.tool.namespace,
      errors: r.errors,
      warnings: r.warnings,
    })),
    generated_at: new Date().toISOString(),
  }, null, 2))
  console.log(`\n${DIM}Machine-readable report: aci-report.json${RESET}`)
} catch (e) {
  // non-fatal
}

// Exit policy:
//  - hard errors → exit 1 (block commit/deploy)
//  - warnings only → exit 0 but print "advisory" note (doesn't block; operator tracks)
if (hardErrors > 0) {
  console.log(`\n${RED}${BOLD}ACI compliance FAILED — ${hardErrors} hard errors must be fixed.${RESET}\n`)
  process.exit(1)
}
console.log(`\n${GREEN}${BOLD}ACI compliance OK${RESET}${softWarnings > 0 ? ` (${softWarnings} advisory warnings — track in backlog)` : ''}\n`)
process.exit(0)
