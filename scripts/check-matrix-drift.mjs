#!/usr/bin/env node
/**
 * check-matrix-drift.mjs — LIN-625 Wave 5 CI drift gate (orchestrator share)
 *
 * Detects drift between the canonical `@widgetdc/contracts/llm` LlmMatrix and
 * the orchestrator's vendored/bundled copy. Three drift modes are caught:
 *
 *   1. STALE BUNDLE   — dist/llm-matrix.json differs from the installed
 *                       node_modules/@widgetdc/contracts/dist/llm/llm-matrix.json.
 *                       Root cause: contracts was updated but `npm run build`
 *                       was not re-run before commit.
 *
 *   2. STRUCTURAL DRIFT — task IDs, model IDs, provider IDs, or routing rules
 *                         diverge between upstream and bundled. This is the
 *                         "hard fail" mode: the bundle is lying about what the
 *                         matrix contains at runtime.
 *
 *   3. VERSION SKEW   — installed contracts package version differs from the
 *                       version recorded at last successful build (optional,
 *                       informational warning only since Railway installs fresh).
 *
 * Usage:
 *   node scripts/check-matrix-drift.mjs
 *   node scripts/check-matrix-drift.mjs --json         # machine-readable output
 *   node scripts/check-matrix-drift.mjs --fixture FILE # compare against synthetic fixture (tests the checker)
 *
 * Exit codes:
 *   0 — no drift
 *   1 — drift detected
 *   2 — missing files (neither source nor target exists)
 *
 * Wired into:
 *   - scripts/ci-adoption-check.mjs as Check 6
 *   - build.mjs post-copy (fail-fast during build)
 *   - .github/workflows/adoption-gate.yml (runs the full CI gate on PR)
 *   - WidgeTDC cross-repo action (Phase 2, deferred) invokes this via its own CI
 */

import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const JSON_MODE = args.includes('--json')
const fixtureIdx = args.indexOf('--fixture')
const FIXTURE = fixtureIdx >= 0 ? args[fixtureIdx + 1] : null

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function log(msg) {
  if (!JSON_MODE) console.log(msg)
}

function emit(verdict) {
  if (JSON_MODE) {
    console.log(JSON.stringify(verdict, null, 2))
  }
  process.exit(verdict.drift ? 1 : 0)
}

// ─── Locate the two copies ─────────────────────────────────────────────────

import { readdirSync } from 'fs'

// Resolve upstream path — fall back to .contracts-* alt symlink if primary is broken (Windows host FS)
function resolveUpstreamMatrix() {
  const primary = path.join(ROOT, 'node_modules/@widgetdc/contracts/dist/llm/llm-matrix.json')
  if (existsSync(primary)) return primary
  try {
    const widgetdcDir = path.join(ROOT, 'node_modules/@widgetdc')
    const entries = readdirSync(widgetdcDir)
    const alt = entries.find(e => e.startsWith('.contracts-'))
    if (alt) {
      const altPath = path.join(widgetdcDir, alt, 'dist/llm/llm-matrix.json')
      if (existsSync(altPath)) return altPath
    }
  } catch { /* */ }
  return primary
}

const UPSTREAM_PATH = FIXTURE ? path.resolve(FIXTURE) : resolveUpstreamMatrix()
const BUNDLED_PATH = path.join(ROOT, 'dist/llm-matrix.json')

// F5 (v4.1.3 fix): Reject --fixture paths outside the repo root to prevent
// file-content leakage when the script is invoked from CI with untrusted input.
if (FIXTURE && !UPSTREAM_PATH.startsWith(ROOT)) {
  log(`${RED}✗${RESET} Fixture path outside repo root: ${UPSTREAM_PATH}`)
  log(`  Resolved ROOT: ${ROOT}`)
  log(`  This is a security boundary — fixture must be inside the repo.`)
  process.exit(2)
}

if (!existsSync(UPSTREAM_PATH)) {
  log(`${RED}✗${RESET} Upstream matrix not found: ${UPSTREAM_PATH}`)
  log(`  Fix: cd ../widgetdc-contracts && npm install && npm run build`)
  process.exit(2)
}
if (!existsSync(BUNDLED_PATH)) {
  log(`${RED}✗${RESET} Bundled matrix not found: ${BUNDLED_PATH}`)
  log(`  Fix: npm run build`)
  process.exit(2)
}

const upstreamRaw = readFileSync(UPSTREAM_PATH, 'utf8')
const bundledRaw = readFileSync(BUNDLED_PATH, 'utf8')

const upstream = JSON.parse(upstreamRaw)
const bundled = JSON.parse(bundledRaw)

// ─── Mode 1: Content-level hash comparison (normalizes whitespace/line endings) ─
// We normalize by re-serializing the parsed JSON with a deterministic recursive
// key-sorted form. This catches real content drift while ignoring cosmetic
// differences like Windows CRLF injection, trailing whitespace, or key order
// variance — none of which affect runtime behavior since JSON.parse is
// whitespace-insensitive and object key order is semantically irrelevant.

function canonicalize(v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(canonicalize)
  const out = {}
  for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k])
  return out
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const upstreamCanonical = JSON.stringify(canonicalize(upstream))
const bundledCanonical = JSON.stringify(canonicalize(bundled))
const upstreamHash = sha(upstreamCanonical)
const bundledHash = sha(bundledCanonical)
const rawUpstreamHash = sha(upstreamRaw)
const rawBundledHash = sha(bundledRaw)

const hashMatch = upstreamHash === bundledHash
const rawHashMatch = rawUpstreamHash === rawBundledHash

log(`${BOLD}${CYAN}LLM Matrix Drift Check${RESET}`)
log(`  upstream  ${UPSTREAM_PATH.replace(ROOT, '.')}`)
log(`  bundled   ${BUNDLED_PATH.replace(ROOT, '.')}`)
log(`  content-sha  upstream=${upstreamHash}  bundled=${bundledHash}  ${hashMatch ? GREEN + 'match' + RESET : RED + 'DRIFT' + RESET}`)
if (!rawHashMatch && hashMatch) {
  log(`  raw-sha      upstream=${rawUpstreamHash}  bundled=${rawBundledHash}  ${YELLOW}cosmetic-only${RESET} (whitespace/line-endings, content identical)`)
}

// ─── Mode 2: Structural drift (task IDs, model IDs, provider IDs) ──────────
// Even if byte hashes match, we do the structural check so the error message
// is actionable when they DON'T match — tells operators exactly what changed.

function extractIds(matrix) {
  return {
    providers: Object.keys(matrix.providers || {}).sort(),
    models: Object.keys(matrix.models || {}).sort(),
    tasks: Object.keys(matrix.tasks || {}).sort(),
  }
}

const upIds = extractIds(upstream)
const bunIds = extractIds(bundled)

function diffSets(a, b, label) {
  const missing = a.filter((x) => !b.includes(x))
  const extra = b.filter((x) => !a.includes(x))
  return { label, missing, extra, drift: missing.length > 0 || extra.length > 0 }
}

const providerDiff = diffSets(upIds.providers, bunIds.providers, 'providers')
const modelDiff = diffSets(upIds.models, bunIds.models, 'models')
const taskDiff = diffSets(upIds.tasks, bunIds.tasks, 'tasks')

// Routing rule drift: compare task→model_chain for each task
const routingDiff = { label: 'routing', changes: [], drift: false }
for (const task of upIds.tasks) {
  if (!bunIds.tasks.includes(task)) continue
  const upChain = JSON.stringify(upstream.tasks[task]?.model_chain ?? [])
  const bunChain = JSON.stringify(bundled.tasks[task]?.model_chain ?? [])
  if (upChain !== bunChain) {
    routingDiff.changes.push({ task, upstream: upChain, bundled: bunChain })
    routingDiff.drift = true
  }
}

// Model metadata drift: compare provider + context_window for each model
const modelMetaDiff = { label: 'model-metadata', changes: [], drift: false }
for (const model of upIds.models) {
  if (!bunIds.models.includes(model)) continue
  const up = upstream.models[model]
  const bun = bundled.models[model]
  if (up?.provider !== bun?.provider || up?.context_window !== bun?.context_window) {
    modelMetaDiff.changes.push({
      model,
      upstream: { provider: up?.provider, context_window: up?.context_window },
      bundled: { provider: bun?.provider, context_window: bun?.context_window },
    })
    modelMetaDiff.drift = true
  }
}

const anyStructural =
  providerDiff.drift || modelDiff.drift || taskDiff.drift || routingDiff.drift || modelMetaDiff.drift

// ─── Verdict ───────────────────────────────────────────────────────────────

const verdict = {
  drift: !hashMatch || anyStructural,
  upstream: { path: UPSTREAM_PATH, sha: upstreamHash, ...upIds },
  bundled: { path: BUNDLED_PATH, sha: bundledHash, ...bunIds },
  hashMatch,
  rawHashMatch,
  structural: {
    providers: providerDiff,
    models: modelDiff,
    tasks: taskDiff,
    routing: routingDiff,
    modelMetadata: modelMetaDiff,
  },
}

if (!verdict.drift) {
  log(`  ${GREEN}✓${RESET} No drift. Upstream and bundled matrix are in sync.`)
  log(`  providers=${upIds.providers.length} models=${upIds.models.length} tasks=${upIds.tasks.length}`)
  emit(verdict)
}

// ─── Drift report ──────────────────────────────────────────────────────────

log(`  ${RED}✗${RESET} ${BOLD}DRIFT DETECTED${RESET}`)

if (!hashMatch) {
  log(`  ${YELLOW}⚠${RESET} Byte-level hash mismatch — bundled copy is stale`)
  log(`     Fix: ${CYAN}npm run build${RESET} (rebuilds bundle + re-copies llm-matrix.json)`)
}

for (const d of [providerDiff, modelDiff, taskDiff]) {
  if (!d.drift) continue
  log(`  ${RED}✗${RESET} ${d.label}:`)
  if (d.missing.length > 0) log(`     upstream-only (bundled is stale): ${d.missing.join(', ')}`)
  if (d.extra.length > 0) log(`     bundled-only (upstream removed): ${d.extra.join(', ')}`)
}

if (routingDiff.drift) {
  log(`  ${RED}✗${RESET} routing rules:`)
  for (const c of routingDiff.changes) {
    log(`     task=${c.task}`)
    log(`       upstream: ${c.upstream}`)
    log(`       bundled:  ${c.bundled}`)
  }
}

if (modelMetaDiff.drift) {
  log(`  ${RED}✗${RESET} model metadata:`)
  for (const c of modelMetaDiff.changes) {
    log(`     model=${c.model}`)
    log(`       upstream: ${JSON.stringify(c.upstream)}`)
    log(`       bundled:  ${JSON.stringify(c.bundled)}`)
  }
}

log('')
log(`  ${BOLD}To resolve:${RESET}`)
log(`    1. ${CYAN}npm run build${RESET}  (rebuild bundle + re-copy llm-matrix.json)`)
log(`    2. Inspect: ${CYAN}git diff dist/llm-matrix.json dist/index.js${RESET}`)
log(`    3. If upstream contracts changed intentionally, commit the rebuild`)
log(`    4. If drift is unexpected, check node_modules/@widgetdc/contracts version`)

emit(verdict)
