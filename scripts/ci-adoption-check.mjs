#!/usr/bin/env node
/**
 * ci-adoption-check.mjs — CI Adoption Enforcement Script
 *
 * Runs 5 parity/coverage/build checks and exits 0 (all green) or 1 (failures).
 * Usage:
 *   node scripts/ci-adoption-check.mjs
 *   node scripts/ci-adoption-check.mjs --no-build   # skip build step (fast mode)
 *   node scripts/ci-adoption-check.mjs --no-abi     # skip ABI snapshot (no live server needed)
 *
 * Checks:
 *   1. Registry ↔ Executor parity  — every tool name in registry has a case in executor
 *   2. Test coverage                — every tool name appears in test-e2e.mjs
 *   3. Doc coverage                 — every tool name appears in docs/TOOLS.md
 *   4. ABI snapshot                 — test/abi-snapshot.test.mjs exits 0
 *   5. Build verification           — npm run build + node --check dist/index.js
 */

import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const NO_BUILD = args.includes('--no-build')
const NO_ABI = args.includes('--no-abi')

// ─── ANSI colours ──────────────────────────────────────────────────────────
const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

const ok    = (msg) => `${GREEN}✓${RESET} ${msg}`
const fail  = (msg) => `${RED}✗${RESET} ${msg}`
const warn  = (msg) => `${YELLOW}⚠${RESET} ${msg}`
const label = (msg) => `\n${BOLD}${CYAN}${msg}${RESET}`

// ─── Helpers ───────────────────────────────────────────────────────────────

function readFile(rel) {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) throw new Error(`File not found: ${rel}`)
  return readFileSync(abs, 'utf8')
}

function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts })
    return { ok: true, out }
  } catch (e) {
    return { ok: false, out: e.stdout ?? '', err: e.stderr ?? '', code: e.status }
  }
}

// ─── Check results accumulator ─────────────────────────────────────────────

const results = []   // [{ name, passed, details: string[] }]

function addResult(name, passed, details = []) {
  results.push({ name, passed, details })
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 1 — Extract tool names from registry
// ══════════════════════════════════════════════════════════════════════════════

console.log(label('CHECK 1 — Registry ↔ Executor parity'))

let registryTools = []
try {
  const registrySource = readFile('src/tools/tool-registry.ts')

  // Match every `name: 'tool_name'` that is a direct property in a defineTool() call.
  // The pattern targets lines like:   name: 'search_knowledge',
  // We filter out false positives (nested `name:` inside input schemas) by requiring
  // the match is preceded by a defineTool({ block — i.e. tool names are always a
  // top-level string literal on the first few lines of a defineTool block.
  // Strategy: split on defineTool({ and extract the first `name:` from each block.
  const blocks = registrySource.split(/defineTool\s*\(\s*\{/)
  blocks.shift() // first element is everything before the first defineTool call

  registryTools = blocks.map((block) => {
    const m = block.match(/\s*name\s*:\s*['"]([^'"]+)['"]/)
    return m ? m[1] : null
  }).filter(Boolean)

  console.log(`  Found ${registryTools.length} tools in registry`)
  if (process.env.CI_ADOPTION_VERBOSE === '1') {
    console.log(`  ${registryTools.join(', ')}`)
  }
} catch (e) {
  addResult('Registry → Executor parity', false, [`ERROR reading tool-registry.ts: ${e.message}`])
}

// ─── Extract case labels from tool-executor.ts ─────────────────────────────

let executorCases = []
try {
  const executorSource = readFile('src/tools/tool-executor.ts')
  const caseMatches = [...executorSource.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)]
  executorCases = [...new Set(caseMatches.map(m => m[1]))]
  console.log(`  Found ${executorCases.length} case labels in executor`)
} catch (e) {
  addResult('Registry → Executor parity', false, [`ERROR reading tool-executor.ts: ${e.message}`])
}

// ─── Compare ───────────────────────────────────────────────────────────────

if (registryTools.length > 0 && executorCases.length > 0) {
  const missing = registryTools.filter(t => !executorCases.includes(t))
  const extra   = executorCases.filter(t => !registryTools.includes(t))

  const details = []
  if (missing.length > 0) {
    details.push(`${RED}Missing executor cases for:${RESET} ${missing.join(', ')}`)
    missing.forEach(t => console.log(`  ${fail(`No case '${t}' in tool-executor.ts`)}`))
  }
  if (extra.length > 0) {
    // Extra cases are not a hard failure (might be legacy/internal), just warn
    details.push(`${YELLOW}Extra executor cases not in registry (informational):${RESET} ${extra.join(', ')}`)
    extra.forEach(t => console.log(`  ${warn(`Case '${t}' in executor but not in registry`)}`))
  }

  const passed = missing.length === 0
  if (passed) console.log(`  ${ok('All registry tools have executor cases')}`)
  addResult('Registry ↔ Executor parity', passed, details)
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 2 — Test coverage
// ══════════════════════════════════════════════════════════════════════════════

console.log(label('CHECK 2 — Test coverage (test-e2e.mjs)'))

try {
  const testSource = readFile('test-e2e.mjs')
  const untestedTools = registryTools.filter(t => !testSource.includes(t))

  if (untestedTools.length > 0) {
    untestedTools.forEach(t => console.log(`  ${fail(`No test mentioning '${t}' in test-e2e.mjs`)}`))
    addResult('Test coverage', false, [
      `${RED}Untested tools:${RESET} ${untestedTools.join(', ')}`,
    ])
  } else {
    console.log(`  ${ok('All tools appear in at least one test')}`)
    addResult('Test coverage', true)
  }
} catch (e) {
  addResult('Test coverage', false, [`ERROR reading test-e2e.mjs: ${e.message}`])
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 3 — Doc coverage (docs/TOOLS.md)
// ══════════════════════════════════════════════════════════════════════════════

console.log(label('CHECK 3 — Doc coverage (docs/TOOLS.md)'))

try {
  const docsSource = readFile('docs/TOOLS.md')
  const undocumentedTools = registryTools.filter(t => !docsSource.includes(t))

  if (undocumentedTools.length > 0) {
    undocumentedTools.forEach(t => console.log(`  ${fail(`'${t}' not found in docs/TOOLS.md`)}`))
    addResult('Doc coverage', false, [
      `${RED}Undocumented tools:${RESET} ${undocumentedTools.join(', ')}`,
    ])
  } else {
    console.log(`  ${ok('All tools documented in docs/TOOLS.md')}`)
    addResult('Doc coverage', true)
  }
} catch (e) {
  // docs/TOOLS.md not yet generated — soft fail with guidance
  console.log(`  ${warn('docs/TOOLS.md not found — run the doc-generator to create it')}`)
  addResult('Doc coverage', false, [`docs/TOOLS.md missing — generate with: node scripts/generate-tool-docs.mjs`])
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 4 — ABI snapshot
// ══════════════════════════════════════════════════════════════════════════════

console.log(label('CHECK 4 — ABI snapshot (test/abi-snapshot.test.mjs)'))

if (NO_ABI) {
  console.log(`  ${warn('Skipped (--no-abi flag)')}`)
  addResult('ABI snapshot', true, ['Skipped via --no-abi'])
} else if (!existsSync(path.join(ROOT, 'test/abi-snapshot.test.mjs'))) {
  console.log(`  ${warn('test/abi-snapshot.test.mjs not found — skipping')}`)
  addResult('ABI snapshot', true, ['Skipped — test file not found'])
} else {
  const abiResult = run('node test/abi-snapshot.test.mjs')
  if (abiResult.ok) {
    console.log(`  ${ok('ABI snapshot: no breaking changes')}`)
    if (abiResult.out.trim()) {
      abiResult.out.trim().split('\n').forEach(l => console.log(`    ${l}`))
    }
    addResult('ABI snapshot', true)
  } else {
    const lines = (abiResult.out + abiResult.err).trim().split('\n')
    lines.forEach(l => console.log(`  ${RED}  ${l}${RESET}`))
    console.log(`  ${fail('ABI breaking changes detected! Update baseline or fix regressions.')}`)
    console.log(`    To accept intentional changes: ${CYAN}node test/abi-snapshot.test.mjs --update${RESET}`)
    addResult('ABI snapshot', false, ['Breaking ABI changes — see output above', 'Run with --update to accept intentional changes'])
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 5 — Build verification
// ══════════════════════════════════════════════════════════════════════════════

console.log(label('CHECK 5 — Build verification'))

if (NO_BUILD) {
  console.log(`  ${warn('Skipped (--no-build flag)')}`)
  addResult('Build verification', true, ['Skipped via --no-build'])
} else {
  // 5a — npm run build
  console.log('  Running npm run build ...')
  const buildResult = run('npm run build', { timeout: 60000 })
  if (!buildResult.ok) {
    const errLines = (buildResult.out + buildResult.err).trim().split('\n').slice(-20)
    errLines.forEach(l => console.log(`  ${RED}  ${l}${RESET}`))
    console.log(`  ${fail('npm run build failed')}`)
    addResult('Build verification', false, ['npm run build failed — see output above'])
  } else {
    console.log(`  ${ok('npm run build succeeded')}`)

    // 5b — node --check dist/index.js
    const checkResult = run('node --check dist/index.js')
    if (!checkResult.ok) {
      const errLines = (checkResult.out + checkResult.err).trim().split('\n')
      errLines.forEach(l => console.log(`  ${RED}  ${l}${RESET}`))
      console.log(`  ${fail('node --check dist/index.js failed (syntax error in bundle)')}`)
      addResult('Build verification', false, ['dist/index.js has syntax errors'])
    } else {
      console.log(`  ${ok('node --check dist/index.js passed')}`)
      addResult('Build verification', true)
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 6 — Dual-format args compatibility (LIN-750)
// ══════════════════════════════════════════════════════════════════════════════

console.log(label('CHECK 6 — Dual-format args compatibility (LIN-750)'))

if (!existsSync(path.join(ROOT, 'test/dual-format-args.test.mjs'))) {
  console.log(`  ${warn('test/dual-format-args.test.mjs not found — skipping')}`)
  addResult('Dual-format args', true, ['Skipped — test file not found'])
} else {
  const dualResult = run('node test/dual-format-args.test.mjs')
  if (dualResult.ok) {
    const lines = dualResult.out.trim().split('\n').filter(l => l.includes('✅') || l.includes('PASS') || l.includes('format'))
    lines.slice(-3).forEach(l => console.log(`    ${l}`))
    console.log(`  ${ok('Dual-format args compatibility confirmed')}`)
    addResult('Dual-format args', true)
  } else {
    const lines = (dualResult.out + dualResult.err).trim().split('\n')
    lines.forEach(l => console.log(`  ${RED}  ${l}${RESET}`))
    console.log(`  ${fail('Dual-format regression: payload and flat args produce different normalized output!')}`)
    addResult('Dual-format args', false, [
      'call_mcp_tool produces different args for payload vs flat format',
      'Fix: ensure dual-format normalization in executeToolByName case call_mcp_tool',
    ])
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 7 — LLM Matrix drift gate (LIN-625 Wave 5)
// ══════════════════════════════════════════════════════════════════════════════

console.log(label('CHECK 7 — LLM Matrix drift gate (LIN-625)'))

if (!existsSync(path.join(ROOT, 'scripts/check-matrix-drift.mjs'))) {
  console.log(`  ${warn('scripts/check-matrix-drift.mjs not found — skipping')}`)
  addResult('LLM Matrix drift gate', true, ['Skipped — script not present'])
} else if (!existsSync(path.join(ROOT, 'dist/llm-matrix.json'))) {
  // Fresh checkout before first build — defer to build verification which will
  // run the drift check after the copy step.
  console.log(`  ${warn('dist/llm-matrix.json not yet built — deferred to build step')}`)
  addResult('LLM Matrix drift gate', true, ['Skipped — dist/ not yet built'])
} else {
  const driftResult = run('node scripts/check-matrix-drift.mjs')
  if (driftResult.ok) {
    console.log(`  ${ok('No drift between @widgetdc/contracts/llm and bundled dist/llm-matrix.json')}`)
    // Echo the counts line (last non-empty line, stripped of ANSI) for the log
    const lines = driftResult.out.trim().split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
    const countsLine = lines.reverse().find(l => l.startsWith('providers='))
    if (countsLine) console.log(`    ${countsLine}`)
    addResult('LLM Matrix drift gate', true)
  } else {
    const lines = (driftResult.out + driftResult.err).trim().split('\n')
    lines.forEach(l => console.log(`  ${l}`))
    console.log(`  ${fail('Matrix drift detected — bundle diverged from canonical contracts')}`)
    addResult('LLM Matrix drift gate', false, [
      'Bundle diverged from @widgetdc/contracts/llm. Fix: npm run build',
    ])
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECK 8 — ACI compliance (SWE-agent paradigm, Phantom Priority Pick #1)
// ══════════════════════════════════════════════════════════════════════════════

console.log(label('CHECK 8 — ACI compliance (tool surface hygiene)'))

if (!existsSync(path.join(ROOT, 'scripts/check-aci-compliance.mjs'))) {
  console.log(`  ${warn('scripts/check-aci-compliance.mjs not found — skipping')}`)
  addResult('ACI compliance', true, ['Skipped — script not present'])
} else {
  const aciResult = run('node scripts/check-aci-compliance.mjs')
  // Parse summary from output — last line has emoji-less summary
  const summaryLines = (aciResult.out + aciResult.err).trim().split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))
  const hardLine = summaryLines.find(l => /\d+ hard errors/.test(l))
  const warnLine = summaryLines.find(l => /\d+ warnings/.test(l))
  const hardCount = hardLine ? parseInt(hardLine.match(/(\d+) hard errors/)?.[1] ?? '0') : 0
  const warnCount = warnLine ? parseInt(warnLine.match(/(\d+) warnings/)?.[1] ?? '0') : 0

  if (aciResult.ok && hardCount === 0) {
    console.log(`  ${ok('Zero hard ACI errors across all tool definitions')}`)
    if (warnCount > 0) {
      console.log(`  ${warn(`${warnCount} advisory warnings tracked in aci-report.json`)}`)
    }
    addResult('ACI compliance', true, warnCount > 0 ? [`${warnCount} advisory warnings (non-blocking)`] : [])
  } else {
    console.log(`  ${fail(`${hardCount} hard ACI errors — must fix before merge`)}`)
    addResult('ACI compliance', false, [
      `${hardCount} hard errors: missing name / bad snake_case / missing namespace`,
      'Fix: see aci-report.json for details, or run scripts/check-aci-compliance.mjs standalone',
    ])
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY TABLE
// ══════════════════════════════════════════════════════════════════════════════

const W_NAME    = 32
const W_STATUS  = 10
const W_DETAILS = 52

const hr = '─'.repeat(W_NAME + W_STATUS + W_DETAILS + 6)

function pad(s, n) {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '')
  return s + ' '.repeat(Math.max(0, n - plain.length))
}

console.log(`\n${BOLD}${'─'.repeat(hr.length)}${RESET}`)
console.log(`${BOLD}${pad('Check', W_NAME)}  ${pad('Status', W_STATUS)}  Details${RESET}`)
console.log(`${hr}`)

let allPassed = true
for (const r of results) {
  const skipped  = r.details.some(d => d.startsWith('Skipped'))
  const statusTxt = r.passed
    ? (skipped ? `${YELLOW}SKIP${RESET}` : `${GREEN}PASS${RESET}`)
    : `${RED}FAIL${RESET}`

  const firstDetail = r.details[0] ?? ''
  // Strip ANSI for length calculation
  const plainDetail = firstDetail.replace(/\x1b\[[0-9;]*m/g, '')
  const truncated = plainDetail.length > W_DETAILS
    ? firstDetail.slice(0, W_DETAILS + (firstDetail.length - plainDetail.length)) + '…'
    : firstDetail

  console.log(`${pad(r.name, W_NAME)}  ${pad(statusTxt, W_STATUS + 9)}  ${truncated}`)

  // Print additional detail lines indented
  for (const d of r.details.slice(1)) {
    const plain2 = d.replace(/\x1b\[[0-9;]*m/g, '')
    const trunc2 = plain2.length > W_DETAILS
      ? d.slice(0, W_DETAILS + (d.length - plain2.length)) + '…'
      : d
    console.log(`${' '.repeat(W_NAME + W_STATUS + 4)}${trunc2}`)
  }

  if (!r.passed && !skipped) allPassed = false
}

console.log(`${hr}`)

const total   = results.length
const passed  = results.filter(r => r.passed).length
const failed  = results.filter(r => !r.passed).length
const skipped = results.filter(r => r.passed && r.details.some(d => d.startsWith('Skipped'))).length

console.log(
  `\n${BOLD}Result:${RESET} ` +
  `${GREEN}${passed} passed${RESET}` +
  (skipped > 0 ? `, ${YELLOW}${skipped} skipped${RESET}` : '') +
  (failed  > 0 ? `, ${RED}${failed} failed${RESET}` : '') +
  ` of ${total} checks`
)

if (allPassed) {
  console.log(`\n${GREEN}${BOLD}All checks passed.${RESET} Ready to deploy.\n`)
  process.exit(0)
} else {
  console.log(`\n${RED}${BOLD}One or more checks failed.${RESET} Fix issues before merging.\n`)
  process.exit(1)
}
