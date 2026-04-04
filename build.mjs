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

console.log('✅ Build complete → dist/index.js + dist/public/')
