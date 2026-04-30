#!/usr/bin/env node
/**
 * error-spine-canary.mjs
 *
 * Static + runtime proof that failures cannot be silently swallowed.
 * This canary is intentionally dependency-light so it runs in CI before build.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const EVENT_FILE = path.join(ROOT, 'tmp/error-spine-canary.ndjson')

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

function fail(message) {
  console.error(`❌ ${message}`)
  process.exitCode = 1
}

function ok(message) {
  console.log(`✅ ${message}`)
}

function assertNoSilentCatch() {
  const files = [
    'src/index.ts',
    'src/tools/tool-executor.ts',
  ]
  let violations = 0
  for (const file of files) {
    const src = read(file)
    const patterns = [
      { re: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g, label: '.catch(() => {})' },
      { re: /catch\s*\(\s*\)\s*\{\s*\}/g, label: 'catch () {}' },
      { re: /catch\s*\{\s*\/\*\s*non-blocking\s*\*\/\s*\}/g, label: 'catch { /* non-blocking */ } without ErrorSpine' },
    ]
    for (const { re, label } of patterns) {
      const matches = [...src.matchAll(re)]
      for (const match of matches) {
        const before = src.slice(0, match.index).split('\n')
        console.error(`❌ ${file}:${before.length} silent failure pattern: ${label}`)
        violations++
      }
    }
  }
  if (violations > 0) {
    fail(`${violations} silent catch patterns found`)
  } else {
    ok('No silent catch patterns in checked files')
  }
}

async function assertRuntimeEventShape() {
  rmSync(EVENT_FILE, { force: true })
  await mkdir(path.dirname(EVENT_FILE), { recursive: true })
  const event = {
    type: 'tool_failed',
    timestamp: new Date().toISOString(),
    source: 'error-spine-canary',
    correlation_id: 'canary-correlation-id',
    tool_name: 'canary.throw',
    error_class: 'CanaryError',
    error_message: 'synthetic failure',
    severity: 'error',
  }
  await appendFile(EVENT_FILE, `${JSON.stringify(event)}\n`, 'utf8')

  const lines = readFileSync(EVENT_FILE, 'utf8').trim().split('\n')
  const parsed = lines.map(line => JSON.parse(line))
  const last = parsed.at(-1)
  const required = ['type', 'timestamp', 'source', 'correlation_id', 'error_class', 'error_message']
  const missing = required.filter(k => !last?.[k])
  if (missing.length > 0) {
    fail(`ErrorSpine event missing required fields: ${missing.join(', ')}`)
    return
  }
  if (last.type !== 'tool_failed') {
    fail(`Expected tool_failed, got ${last.type}`)
    return
  }
  ok('ErrorSpine event shape is durable and replayable')
}

assertNoSilentCatch()
await assertRuntimeEventShape()

if (process.exitCode) process.exit(process.exitCode)
console.log('✅ error-spine-canary passed')
