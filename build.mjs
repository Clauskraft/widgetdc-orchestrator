// build.mjs — esbuild bundler for widgetdc-orchestrator
// Bundles everything into a single dist/index.js (ESM, Node 20 target)
// @widgetdc/contracts is bundled IN (file: dep, not available on Railway)
import * as esbuild from 'esbuild'
import { readFileSync, mkdirSync, copyFileSync, existsSync } from 'fs'

// S2: Verify contracts symlink before build
const contractsDist = './node_modules/@widgetdc/contracts/dist/orchestrator'
if (!existsSync(contractsDist)) {
  console.error('❌ @widgetdc/contracts dist not found at', contractsDist)
  console.error('   Fix: cd ../widgetdc-contracts && npm install && npm run build')
  console.error('   Then: cd ../widgetdc-orchestrator && npm install')
  process.exit(1)
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
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
  define: {
    '__PKG_VERSION__': JSON.stringify(PKG_VERSION),
  },
})

// Copy frontend to dist/public/
mkdirSync('dist/public', { recursive: true })
copyFileSync('frontend/index.html', 'dist/public/index.html')

// Wave 3 (2026-04-05): widgetdc-contracts' LlmMatrix reads llm-matrix.json via
// fs.readFileSync from __dirname. After esbuild bundles the orchestrator, that
// __dirname resolves to dist/, so the JSON must be copied alongside dist/index.js.
// Upstream fix (contracts → JSON import) is queued as Wave 3.1 follow-up.
const matrixJsonSrc = './node_modules/@widgetdc/contracts/dist/llm/llm-matrix.json'
if (existsSync(matrixJsonSrc)) {
  copyFileSync(matrixJsonSrc, 'dist/llm-matrix.json')
  console.log('✓ Copied llm-matrix.json → dist/ (for bundled @widgetdc/contracts LlmMatrix)')
} else {
  console.error('❌ llm-matrix.json not found at', matrixJsonSrc)
  console.error('   Fix: cd ../widgetdc-contracts && npm run build')
  process.exit(1)
}

console.log('✅ Build complete → dist/index.js + dist/public/')
