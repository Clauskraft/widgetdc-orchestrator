/**
 * produce-tool.test.ts — unit tests for produce_document helpers.
 *
 * Only tests pure helpers (briefToSections, mimeForFormat, sanitizeFilename).
 * The HTTP path to /api/produce is covered by the existing e2e suite
 * (test-e2e.mjs) because it requires a live orchestrator process.
 *
 * Run: npx tsx src/tools/produce-tool.test.ts
 */

// Config is loaded at module level inside produce-tool.ts, so set env before
// importing. Using dynamic import so the set happens first.
process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'
process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-key'
process.env.RLM_API_KEY = process.env.RLM_API_KEY || 'test-key'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
process.env.PORT = process.env.PORT || '4000'
process.env.NODE_ENV = 'test'

const { __test__ } = await import('./produce-tool.js')
const { briefToSections, mimeForFormat, sanitizeFilename } = __test__

let passed = 0
let failed = 0

function assertEq<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
  } else {
    failed++
    console.log(`  FAIL: ${msg}\n    expected: ${e}\n    actual:   ${a}`)
  }
}

function assertTrue(cond: boolean, msg: string) {
  if (cond) passed++
  else {
    failed++
    console.log(`  FAIL: ${msg}`)
  }
}

// ── briefToSections: heading split ─────────────────────────────────────
{
  const brief = `## Intro\nFirst paragraph.\n\n## Conclusion\nFinal paragraph.`
  const sections = briefToSections(brief)
  assertEq(sections.length, 2, 'heading-split returns 2 sections')
  assertEq(sections[0]!.heading, 'Intro', 'first heading is "Intro"')
  assertTrue(sections[0]!.body.includes('First paragraph'), 'first body preserved')
  assertEq(sections[1]!.heading, 'Conclusion', 'second heading is "Conclusion"')
}

// ── briefToSections: paragraph split ───────────────────────────────────
{
  const brief = `Overview of the topic.\n\nSecond paragraph with detail.\n\nThird paragraph summary.`
  const sections = briefToSections(brief)
  assertEq(sections.length, 3, 'paragraph-split returns 3 sections')
  assertTrue(sections[0]!.heading.length > 0, 'first heading derived from body')
  assertEq(sections[1]!.heading, 'Section 2', 'second section labeled Section 2')
}

// ── briefToSections: single section fallback ───────────────────────────
{
  const brief = `Just a single short brief.`
  const sections = briefToSections(brief)
  assertEq(sections.length, 1, 'single-line brief returns 1 section')
  assertEq(sections[0]!.body, brief, 'single section body is the brief')
}

// ── briefToSections: empty/whitespace ─────────────────────────────────
{
  const sections = briefToSections('   \n\n')
  assertEq(sections.length, 1, 'empty brief returns 1 section (Overview)')
  assertEq(sections[0]!.heading, 'Overview', 'empty brief heading is Overview')
}

// ── briefToSections: long heading truncation ──────────────────────────
{
  const longFirst = 'x'.repeat(100)
  const sections = briefToSections(longFirst)
  assertTrue(sections[0]!.heading.endsWith('...'), 'long heading truncated with ellipsis')
  assertTrue(sections[0]!.heading.length <= 80, 'heading length clamped')
}

// ── mimeForFormat ─────────────────────────────────────────────────────
assertEq(
  mimeForFormat('docx'),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'docx mime',
)
assertEq(mimeForFormat('pdf'), 'application/pdf', 'pdf mime')
assertEq(mimeForFormat('html'), 'text/html', 'html mime')
assertEq(mimeForFormat('md'), 'text/markdown', 'md mime')
assertEq(mimeForFormat('unknown'), 'application/octet-stream', 'unknown mime falls back to octet-stream')

// ── sanitizeFilename ───────────────────────────────────────────────────
assertEq(sanitizeFilename('My Report: Q1 2026'), 'My-Report-Q1-2026', 'colon + space sanitized')
assertEq(sanitizeFilename('  simple  '), 'simple', 'whitespace trimmed')
assertEq(sanitizeFilename(''), 'document', 'empty string falls back to "document"')
assertEq(sanitizeFilename('!!!@#$%^&*()'), 'document', 'punctuation-only falls back to "document"')
assertTrue(sanitizeFilename('x'.repeat(200)).length <= 60, 'filename clamped to 60 chars')

// ── Report ─────────────────────────────────────────────────────────────
console.log(`\nproduce-tool.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
