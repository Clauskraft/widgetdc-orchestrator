/**
 * canvas-builder-tool.test.ts — unit tests for canvas_builder pure helpers.
 *
 * Only pure helpers are tested (buildIntentFromArgs, deriveEmbedUrl,
 * pickTrackFromBrief, synthesizeStubResolution). The HTTP path to
 * /api/mrp/canvas/resolve is covered by test-e2e.mjs test #212.
 *
 * Run: npx tsx src/tools/canvas-builder-tool.test.ts
 */

process.env.BACKEND_API_KEY = process.env.BACKEND_API_KEY || 'test-key'
process.env.ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || 'test-key'
process.env.RLM_API_KEY = process.env.RLM_API_KEY || 'test-key'
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
process.env.PORT = process.env.PORT || '4000'
process.env.NODE_ENV = 'test'

const { __test__ } = await import('./canvas-builder-tool.js')
const { buildIntentFromArgs, deriveEmbedUrl, pickTrackFromBrief, synthesizeStubResolution, VALID_TRACKS } = __test__

let passed = 0
let failed = 0

function assertEq<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) passed++
  else {
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

// ── buildIntentFromArgs ────────────────────────────────────────────────

// 1. Minimum: only brief
{
  const i = buildIntentFromArgs({ brief: '  write me a short doc  ' })
  assertEq(i.user_text, 'write me a short doc', 'brief trimmed into user_text')
  assertEq(i.surface_hint, undefined, 'no surface_hint by default')
}

// 2. Invalid enums dropped silently
{
  const i = buildIntentFromArgs({
    brief: 'x',
    surface_hint: 'bogus',
    prior_track: 'bogus-track',
    compliance_tier: 'ultra-legal',
  })
  assertEq(i.surface_hint, undefined, 'invalid surface_hint dropped')
  assertEq(i.prior_track, undefined, 'invalid prior_track dropped')
  assertEq(i.compliance_tier, undefined, 'invalid compliance_tier dropped')
}

// 3. Valid enums preserved + sequence_step + agent_id
{
  const i = buildIntentFromArgs({
    brief: 'x',
    surface_hint: 'full',
    sequence_step: 3,
    prior_track: 'slide_flow',
    compliance_tier: 'legal',
    host_origin: 'https://open-webui.example',
    agent_id: 'consulting-partner',
  })
  assertEq(i.surface_hint, 'full', 'valid surface_hint preserved')
  assertEq(i.sequence_step, 3, 'integer sequence_step preserved')
  assertEq(i.prior_track, 'slide_flow', 'valid prior_track preserved')
  assertEq(i.compliance_tier, 'legal', 'valid compliance_tier preserved')
  assertEq(i.host_origin, 'https://open-webui.example', 'host_origin preserved')
  assertEq(i.agent_id, 'consulting-partner', 'agent_id preserved')
}

// 4. Non-integer sequence_step dropped
{
  const i = buildIntentFromArgs({ brief: 'x', sequence_step: 2.5 })
  assertEq(i.sequence_step, undefined, 'fractional sequence_step dropped')
}

// 5. Negative sequence_step dropped
{
  const i = buildIntentFromArgs({ brief: 'x', sequence_step: -1 })
  assertEq(i.sequence_step, undefined, 'negative sequence_step dropped')
}

// 6. Empty brief yields empty user_text (executor rejects)
{
  const i = buildIntentFromArgs({ brief: '   ' })
  assertEq(i.user_text, '', 'whitespace-only brief reduces to empty string')
}

// ── deriveEmbedUrl: all 7 tracks ───────────────────────────────────────

{
  const s = '11111111-1111-1111-1111-111111111111'
  const expected: Record<string, string> = {
    textual: 'markdown',
    slide_flow: 'slides',
    diagram: 'drawio',
    architecture: 'canvas',
    graphical: 'canvas',
    code: 'split',
    experiment: 'split',
  }
  for (const track of VALID_TRACKS) {
    const url = deriveEmbedUrl(track, s)
    assertTrue(url.startsWith('https://widgetdc-canvas.up.railway.app/?'), `embed_url starts with canvas base for ${track}`)
    assertTrue(url.includes(`session=${s}`), `embed_url contains session id for ${track}`)
    assertTrue(url.includes(`track=${track}`), `embed_url contains track=${track}`)
    assertTrue(url.includes(`pane=${expected[track]}`), `embed_url contains pane=${expected[track]} for ${track}`)
  }
}

// deriveEmbedUrl escapes session id
{
  const url = deriveEmbedUrl('textual', 'a b/c?d')
  assertTrue(url.includes('session=a%20b%2Fc%3Fd'), 'session id is URL-encoded')
}

// ── pickTrackFromBrief ────────────────────────────────────────────────

assertEq(pickTrackFromBrief('Build me a slide deck for Q1'), 'slide_flow', 'slide deck → slide_flow')
assertEq(pickTrackFromBrief('Draw a sequence diagram'), 'diagram', 'sequence diagram → diagram')
assertEq(pickTrackFromBrief('Design a C4 architecture'), 'architecture', 'C4 → architecture')
assertEq(pickTrackFromBrief('Plot a mind map of features'), 'graphical', 'mind map → graphical')
assertEq(pickTrackFromBrief('Refactor this typescript function'), 'code', 'typescript refactor → code')
assertEq(pickTrackFromBrief('Run an A/B test experiment'), 'experiment', 'A/B test → experiment')
assertEq(pickTrackFromBrief('Write me a one-pager'), 'textual', 'default → textual')
// Sticky prior_track wins over heuristic
assertEq(pickTrackFromBrief('Draw a diagram', 'slide_flow'), 'slide_flow', 'prior_track sticky overrides heuristic')

// ── synthesizeStubResolution ──────────────────────────────────────────

// Covers rationale shape + required fields + UUID format.
{
  const stub = synthesizeStubResolution({ user_text: 'give me a slide deck' }, 'backend_404')
  assertEq(stub.track, 'slide_flow', 'stub picks slide_flow from brief')
  assertEq(stub.initial_pane, 'slides', 'stub pane matches track')
  assertTrue(/^[0-9a-f-]{36}$/.test(stub.canvas_session_id), 'stub session id is UUID-like')
  assertEq(stub.bom_version, '2.0', 'stub bom_version is 2.0')
  assertTrue(stub.rationale[0] === 'stub:backend_404', 'first rationale line is stub:<reason>')
  assertTrue(stub.rationale.some(r => r.startsWith('heuristic_track:')), 'rationale mentions heuristic_track when no prior')
  assertTrue(stub.embed_url.includes(stub.canvas_session_id), 'embed_url references same session id')
  assertTrue(!!Date.parse(stub.resolved_at), 'resolved_at is ISO date-time')
}

// Sticky prior_track produces rationale sticky_prior_track:<track>
{
  const stub = synthesizeStubResolution(
    { user_text: 'anything', prior_track: 'architecture', sequence_step: 5 },
    'upstream_unreachable',
  )
  assertEq(stub.track, 'architecture', 'prior_track wins in stub')
  assertTrue(stub.rationale.includes('sticky_prior_track:architecture'), 'rationale contains sticky_prior_track')
  assertTrue(stub.rationale.includes('sequence_step:5'), 'rationale reports sequence_step=5')
}

// sequence_step=0 surfaces explicitly
{
  const stub = synthesizeStubResolution({ user_text: 'hi' }, 'backend_404')
  assertTrue(stub.rationale.includes('sequence_step:0'), 'sequence_step:0 captured')
}

// Two stubs get distinct session IDs
{
  const a = synthesizeStubResolution({ user_text: 'a' }, 'backend_404')
  const b = synthesizeStubResolution({ user_text: 'a' }, 'backend_404')
  assertTrue(a.canvas_session_id !== b.canvas_session_id, 'stub session IDs are unique per call')
}

// Stub reason is always first rationale entry
{
  const stub = synthesizeStubResolution({ user_text: 'x' }, 'upstream_body_incomplete')
  assertEq(stub.rationale[0], 'stub:upstream_body_incomplete', 'reason-code surfaces as leading rationale')
}

// ── Report ────────────────────────────────────────────────────────────
console.log(`\ncanvas-builder-tool.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
