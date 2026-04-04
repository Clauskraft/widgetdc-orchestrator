// v4.0.5 Ghost-Tier Feature Audit
// Cross-references every /api/* endpoint against TOOL_REGISTRY to find features
// that bypass the adoption gate.
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROUTES_DIR = 'src/routes'
const REGISTRY_FILE = 'src/tool-registry.ts'

// Extract registered tool names
const registrySource = readFileSync(REGISTRY_FILE, 'utf8')
const registeredTools = new Set([...registrySource.matchAll(/name:\s*['"]([a-z_]+)['"]/g)].map(m => m[1]))

// Classification rules — which routers are intentionally NOT in the registry
const INFRA_ROUTERS = new Set([
  'dashboard', 'audit', 'monitor', 'mcp-gateway', 'tool-gateway', 'abi-docs',
  'abi-health', 'abi-versioning', 'openai-compat', 'prompt-generator', 'adoption',
  // chat/agents/cron/chains are meta-orchestration, not user tools
  'chat', 'agents', 'cron',
])

// Routers that SHOULD have tool-registry entries (feature routers)
const FEATURE_ROUTERS = [
  'knowledge', 'artifacts', 'assembly', 'decisions', 'deliverables', 'drill',
  'engagements', 'evolution', 'failures', 'fold', 'governance', 'graph-hygiene',
  'intelligence', 'llm', 'loose-ends', 'memory', 'notebooks', 'openclaw',
  'osint', 's1-s4', 'similarity', 'competitive', 'cognitive', 'tools',
]

// Known mapping: router name → expected tool names in registry
const EXPECTED_TOOLS_BY_ROUTER = {
  'knowledge': ['search_knowledge', 'search_documents'],
  'assembly': ['generate_deliverable'],
  'deliverables': ['generate_deliverable'],
  'similarity': ['precedent_search'],
  'notebooks': ['create_notebook'],
  'governance': ['governance_matrix', 'verify_output'],
  'osint': ['run_osint_scan'],
  'chains': ['run_chain'],
  'evolution': ['run_evolution'],
  'intelligence': ['ingest_document', 'build_communities', 'adaptive_rag_dashboard', 'adaptive_rag_query', 'adaptive_rag_retrain', 'adaptive_rag_reward', 'graph_hygiene_run'],
  'engagements': ['engagement_create', 'engagement_match', 'engagement_plan', 'engagement_outcome', 'engagement_list'],
  'cognitive': ['reason_deeply'],
  'loose-ends': [],  // drill/loose-ends internal — TBD
  'drill': [],
  'artifacts': [],
  'decisions': [],
  'failures': [],
  'fold': [],
  'graph-hygiene': ['graph_hygiene_run'],
  'llm': [],
  'memory': [],
  'competitive': [],
  's1-s4': [],
  'tools': [],  // tools.ts is the tool-registry surface
  'openclaw': [],  // proxy to external service
}

function extractEndpoints(routerFile) {
  const src = readFileSync(routerFile, 'utf8')
  const endpoints = []
  const regex = /(?:^|\s)(\w+Router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*['"]([^'"]*)['"]/gm
  let match
  while ((match = regex.exec(src)) !== null) {
    endpoints.push({ method: match[2].toUpperCase(), path: match[3] })
  }
  return endpoints
}

const audit = {
  total_routers: 0,
  total_endpoints: 0,
  infra_routers: [],
  feature_routers: [],
  ghost_tier: [],
  covered: [],
  total_registry_tools: registeredTools.size,
}

for (const file of readdirSync(ROUTES_DIR)) {
  if (!file.endsWith('.ts')) continue
  const routerName = file.replace('.ts', '')
  const endpoints = extractEndpoints(join(ROUTES_DIR, file))
  audit.total_routers++
  audit.total_endpoints += endpoints.length

  if (INFRA_ROUTERS.has(routerName)) {
    audit.infra_routers.push({ name: routerName, endpoints: endpoints.length })
    continue
  }

  const expected = EXPECTED_TOOLS_BY_ROUTER[routerName] ?? []
  const missing = expected.filter(t => !registeredTools.has(t))
  const present = expected.filter(t => registeredTools.has(t))

  const entry = {
    name: routerName,
    endpoints: endpoints.length,
    expected_tools: expected,
    registered: present,
    missing,
  }

  if (expected.length === 0) {
    audit.ghost_tier.push({ ...entry, reason: 'feature router with NO tool-registry entries at all' })
  } else if (missing.length > 0) {
    audit.ghost_tier.push({ ...entry, reason: `${missing.length} expected tools missing from registry` })
  } else {
    audit.covered.push(entry)
  }
  audit.feature_routers.push(entry)
}

console.log('═══════════════════════════════════════════════════════════════════')
console.log('  v4.0.5 GHOST-TIER FEATURE AUDIT')
console.log('═══════════════════════════════════════════════════════════════════')
console.log()
console.log(`Total routers:       ${audit.total_routers}`)
console.log(`Total endpoints:     ${audit.total_endpoints}`)
console.log(`Registry tools:      ${audit.total_registry_tools}`)
console.log(`Infra (excluded):    ${audit.infra_routers.length} routers`)
console.log(`Feature routers:     ${audit.feature_routers.length}`)
console.log(`  — Covered:         ${audit.covered.length}`)
console.log(`  — Ghost-tier:      ${audit.ghost_tier.length}`)
console.log()

if (audit.ghost_tier.length > 0) {
  console.log('━━━ GHOST-TIER ROUTERS (bypass adoption telemetry) ━━━')
  for (const r of audit.ghost_tier) {
    console.log(`\n❌ ${r.name}`)
    console.log(`   Endpoints: ${r.endpoints}`)
    console.log(`   Reason: ${r.reason}`)
    if (r.expected_tools.length > 0) {
      console.log(`   Expected: [${r.expected_tools.join(', ')}]`)
      console.log(`   Missing:  [${r.missing.join(', ')}]`)
    }
  }
}

console.log('\n━━━ COVERED FEATURE ROUTERS ━━━')
for (const r of audit.covered) {
  console.log(`✓ ${r.name} — ${r.registered.length} tool(s): [${r.registered.join(', ')}]`)
}

console.log('\n━━━ INFRA ROUTERS (intentionally excluded) ━━━')
for (const r of audit.infra_routers) {
  console.log(`  ${r.name} (${r.endpoints} endpoints)`)
}
console.log()
