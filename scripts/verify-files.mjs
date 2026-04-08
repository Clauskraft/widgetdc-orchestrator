/**
 * verify-files.mjs — Post-edit integrity guard for high-risk large source files.
 * Checks that critical files meet minimum line counts and have their required exports.
 * Run: node scripts/verify-files.mjs
 * Used by: pre-commit hook, manual CI, post-edit verification.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const GUARDS = [
  {
    file: 'src/intelligence/inventor-loop.ts',
    minLines: 780,
    requiredExports: [
      'export async function runInventor',
      'export function getInventorStatus',
      'export function getInventorNodes',
      'export function getInventorNode',
      'export function getBestNode',
      'export function stopInventor',
      'export async function getExperimentHistory',
    ],
  },
  {
    file: 'src/benchmark-runner.ts',
    minLines: 570,
    requiredExports: [
      'export async function loadBenchmarkRuns',
      'export async function startBenchmarkRun',
      'export async function startAblationStudy',
      'export function listBenchmarkRuns',
      'export function getBenchmarkRun',
      'export function getBenchmarkTask',
      'export function computeAblationReport',
    ],
  },
  {
    file: 'src/index.ts',
    minLines: 450,
    requiredExports: [
      'process.exit(1)',
      'SIGTERM',
    ],
  },
]

let failed = 0
for (const guard of GUARDS) {
  const path = resolve(ROOT, guard.file)
  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch (e) {
    console.error(`  ✗ MISSING: ${guard.file}`)
    failed++
    continue
  }
  const lines = content.split('\n').length
  if (lines < guard.minLines) {
    console.error(`  ✗ TRUNCATED: ${guard.file} — ${lines} lines (expected ≥${guard.minLines})`)
    failed++
    continue
  }
  const missing = guard.requiredExports.filter(exp => !content.includes(exp))
  if (missing.length > 0) {
    console.error(`  ✗ MISSING EXPORTS in ${guard.file}:`)
    missing.forEach(m => console.error(`      "${m}"`))
    failed++
    continue
  }
  console.log(`  ✓ ${guard.file} (${lines} lines, all exports present)`)
}

if (failed > 0) {
  console.error(`\n✗ ${failed} file(s) failed integrity check — DO NOT DEPLOY`)
  process.exit(1)
} else {
  console.log(`\n✓ All critical files passed integrity check`)
}
