// build.mjs — esbuild bundler for widgetdc-orchestrator
// Bundles everything into a single dist/index.js (ESM, Node 20 target)
// @widgetdc/contracts is bundled IN (file: dep, not available on Railway)
import * as esbuild from 'esbuild'
import { readFileSync, mkdirSync, copyFileSync, cpSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'

// Guard: NODE_ENV=production causes npm to skip devDependencies (esbuild, typebox, etc.)
// This silently breaks the build. Force NODE_ENV=development for build context.
if (process.env.NODE_ENV === 'production') {
  console.warn('⚠️  NODE_ENV=production detected — overriding to development for build')
  process.env.NODE_ENV = 'development'
}

// S2: Verify contracts symlink before build
// Fall back to the stable .contracts-* symlink if the primary link is broken (Windows host FS quirk)
import { readdirSync } from 'fs'
import { join } from 'path'
let contractsDist = './node_modules/@widgetdc/contracts/dist/orchestrator'
if (!existsSync(contractsDist)) {
  // Look for any .contracts-* symlink that has the dist
  const widgetdcDir = './node_modules/@widgetdc'
  try {
    const entries = readdirSync(widgetdcDir)
    const alt = entries.find(e => e.startsWith('.contracts-') && existsSync(join(widgetdcDir, e, 'dist/orchestrator')))
    if (alt) {
      contractsDist = join(widgetdcDir, alt, 'dist/orchestrator')
      console.log(`ℹ️  Using contracts alt symlink: ${contractsDist}`)
    } else {
      console.error('❌ @widgetdc/contracts dist not found at', contractsDist)
      console.error('   Fix: cd ../widgetdc-contracts && npm install && npm run build')
      console.error('   Then: cd ../widgetdc-orchestrator && npm install')
      process.exit(1)
    }
  } catch {
    console.error('❌ @widgetdc/contracts dist not found at', contractsDist)
    process.exit(1)
  }
}

// Bulletproof W3: Build-time tool registry ↔ executor parity check
// Fail fast if new tools added to registry without matching executor case.
const registrySource = readFileSync('./src/tool-registry.ts', 'utf8')
const executorSource = readFileSync('./src/tool-executor.ts', 'utf8')

// Extract tool names from defineTool({ name: 'x', ... }) blocks
const registryNames = new Set()
const toolBlocks = registrySource.split('defineTool({').slice(1)
for (const block of toolBlocks) {
  const m = block.match(/^\s*name:\s*['"]([a-z_]+)['"]/)
  if (m) registryNames.add(m[1])
}

// Extract case labels from tool-executor (case 'x':)
const executorNames = new Set()
const caseMatches = executorSource.matchAll(/^\s*case\s+['"]([a-z_]+)['"]\s*:/gm)
for (const m of caseMatches) executorNames.add(m[1])

const missingExecutor = [...registryNames].filter(n => !executorNames.has(n))
if (missingExecutor.length > 0) {
  console.error('❌ Build-time parity check FAILED')
  console.error('   Registry has', registryNames.size, 'tools, executor has', executorNames.size, 'cases')
  console.error('   Missing executor cases for:', missingExecutor.join(', '))
  console.error('   Fix: add case handlers in src/tool-executor.ts')
  process.exit(1)
}
console.log(`✓ Build parity: ${registryNames.size} tools ↔ ${executorNames.size} executor cases`)

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
const PKG_VERSION = pkg.version

// External = npm deps that Railway installs via npm ci.
// Contracts + TypeBox are bundled IN (devDeps, not available at Railway runtime).
const BUNDLE_IN = new Set(['@widgetdc/contracts', '@sinclair/typebox'])

const external = [
  ...Object.keys(pkg.dependencies || {}).filter(d => !BUNDLE_IN.has(d)),
  ...Object.keys(pkg.devDependencies || {}).filter(d => !BUNDLE_IN.has(d)),
  'node:*',
]

// Resolve the working contracts dist path for esbuild alias (broken symlink workaround).
// Alias maps @widgetdc/contracts → <altPath>/dist so sub-path imports like
// @widgetdc/contracts/llm resolve to <altPath>/dist/llm correctly.
const contractsAbsPath = new URL(contractsDist.replace('/orchestrator', ''), import.meta.url).pathname

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  external,
  sourcemap: false,
  minify: false,
  alias: { '@widgetdc/contracts': contractsAbsPath },
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
  define: {
    '__PKG_VERSION__': JSON.stringify(PKG_VERSION),
  },
})

// Copy frontend to dist/public/
// CC v4: React SPA built with Vite (frontend-v4/ contains pre-built output)
// Fallback: legacy single-file frontend/index.html
mkdirSync('dist/public', { recursive: true })
if (existsSync('frontend-v4/index.html')) {
  // Recursively copy Vite build output (index.html + assets/ + images/)
  cpSync('frontend-v4', 'dist/public', { recursive: true })
  console.log('✓ Copied CC v4 (React SPA) → dist/public/')
} else {
  // Legacy fallback
  copyFileSync('frontend/index.html', 'dist/public/index.html')
  console.log('✓ Copied legacy frontend/index.html → dist/public/')
}
// Inventor dashboard (ASI-Evolve evolution engine UI)
if (existsSync('frontend/inventor-dashboard.html')) {
  copyFileSync('frontend/inventor-dashboard.html', 'dist/public/inventor-dashboard.html')
  console.log('✓ Copied inventor-dashboard.html → dist/public/')
}

// Wave 3 (2026-04-05): widgetdc-contracts' LlmMatrix reads llm-matrix.json via
// fs.readFileSync from __dirname. After esbuild bundles the orchestrator, that
// __dirname resolves to dist/, so the JSON must be copied alongside dist/index.js.
// Upstream fix (contracts → JSON import) is queued as Wave 3.1 follow-up.
// Use the resolved contracts dist path (handles broken symlink on Windows-hosted FS)
const matrixJsonSrc = existsSync('./node_modules/@widgetdc/contracts/dist/llm/llm-matrix.json')
  ? './node_modules/@widgetdc/contracts/dist/llm/llm-matrix.json'
  : `${contractsAbsPath}/llm/llm-matrix.json`
if (existsSync(matrixJsonSrc)) {
  copyFileSync(matrixJsonSrc, 'dist/llm-matrix.json')
  console.log('✓ Copied llm-matrix.json → dist/ (for bundled @widgetdc/contracts LlmMatrix)')
} else {
  console.error('❌ llm-matrix.json not found at', matrixJsonSrc)
  console.error('   Fix: cd ../widgetdc-contracts && npm run build')
  process.exit(1)
}

// LIN-625 Wave 5 — CI drift gate. The copy we just made should be content-identical
// to upstream. This check proves it and catches the reverse direction too: a dev
// hand-editing dist/llm-matrix.json would get flagged on the next build. Content
// comparison normalizes whitespace/line-endings so cross-platform builds aren't
// falsely flagged by Windows CRLF or git autocrlf.
const driftCheck = spawnSync('node', ['scripts/check-matrix-drift.mjs'], { stdio: 'inherit' })
if (driftCheck.status !== 0) {
  console.error('❌ LIN-625 matrix drift gate FAILED — bundle diverged from canonical @widgetdc/contracts/llm')
  console.error('   See drift report above. This is a hard build failure to prevent shipping stale bundles.')
  process.exit(1)
}

console.log('✅ Build complete → dist/index.js + dist/public/')
