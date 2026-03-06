// build.mjs — esbuild bundler for widgetdc-orchestrator
// Bundles everything into a single dist/index.js (ESM, Node 20 target)
// @widgetdc/contracts is bundled IN (file: dep, not available on Railway)
import * as esbuild from 'esbuild'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))

// External = npm deps that Railway installs. Contracts are NOT external (bundled in).
const external = [
  ...Object.keys(pkg.dependencies || {}).filter(d => d !== '@widgetdc/contracts'),
  ...Object.keys(pkg.devDependencies || {}),
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
})

console.log('✅ Build complete → dist/index.js')
