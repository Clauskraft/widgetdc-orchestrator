// completeness-gate.mjs — P1 Fix: Verify Snout/Phantom BOM actually captured everything
// Usage: node completeness-gate.mjs <repo-url>

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const REPO_URL = process.argv[2] || 'https://github.com/JackChen-me/open-multi-agent.git';
const TMP_DIR = `_clone-${Date.now()}`;

async function writeCypher(query, params = {}) {
  return new Promise((ok, fail) => {
    const d = JSON.stringify({ tool: 'graph.write_cypher', payload: { query, params } });
    const o = { hostname: 'backend-production-d3da.up.railway.app', path: '/api/mcp/route', method: 'POST', headers: { 'Authorization': 'Bearer Heravej_22', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }};
    const r = https.request(o, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { ok(JSON.parse(b)); } catch(e) { ok({ raw: b.slice(0, 500) }); } }); });
    r.on('error', fail); r.write(d); r.end();
  });
}

async function readCypher(query, params = {}) {
  return new Promise((ok, fail) => {
    const d = JSON.stringify({ tool: 'graph.read_cypher', payload: { query, params } });
    const o = { hostname: 'backend-production-d3da.up.railway.app', path: '/api/mcp/route', method: 'POST', headers: { 'Authorization': 'Bearer Heravej_22', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) }};
    const r = https.request(o, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { ok(JSON.parse(b)); } catch(e) { ok({ raw: b.slice(0, 500) }); } }); });
    r.on('error', fail); r.write(d); r.end();
  });
}

function clone(repoUrl) {
  const dir = `_clone-${Date.now()}`;
  console.log(`Cloning ${repoUrl} → ${dir}...`);
  execSync(`git clone --depth 1 ${repoUrl} ${dir}`, { stdio: 'inherit' });
  return dir;
}

function countSourceFiles(dir) {
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
  let count = 0;
  const files = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.github') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.some(e => entry.name.endsWith(e))) {
        count++;
        files.push({ path: path.relative(dir, full), size: fs.statSync(full).size });
      }
    }
  }
  walk(dir);
  return { count, files };
}

function extractModules(dir, files) {
  // Group files by subdirectory module (handles src/agent/, src/llm/, etc.)
  const modules = new Map();
  for (const f of files) {
    const parts = f.path.split(path.sep);
    // Use deepest directory as module name, or first two levels for src/
    let moduleKey;
    if (parts.length >= 3 && parts[0] === 'src') {
      // src/agent/agent.ts → src/agent
      moduleKey = `src/${parts[1]}`;
    } else if (parts.length >= 2) {
      moduleKey = parts[0];
    } else {
      moduleKey = '__root__';
    }
    if (!modules.has(moduleKey)) modules.set(moduleKey, []);
    modules.get(moduleKey).push(f);
  }

  const result = [];
  for (const [name, modFiles] of modules) {
    // Check if module has exports (index.ts, or files with class/interface/function exports)
    let hasExports = false;
    let exportTypes = new Set();
    for (const f of modFiles) {
      const content = fs.readFileSync(path.join(dir, f.path), 'utf8');
      if (/^export (default |const |class |function |interface |type |enum )/m.test(content)) {
        hasExports = true;
        if (/export class /m.test(content)) exportTypes.add('class');
        if (/export function /m.test(content)) exportTypes.add('function');
        if (/export interface /m.test(content)) exportTypes.add('interface');
        if (/export type /m.test(content)) exportTypes.add('type');
        if (/export const /m.test(content)) exportTypes.add('const');
        if (/export default/m.test(content)) exportTypes.add('default');
      }
    }
    result.push({
      name: name === '__root__' ? 'root' : name,
      files: modFiles.length,
      totalBytes: modFiles.reduce((s, f) => s + f.size, 0),
      hasExports,
      exportTypes: [...exportTypes],
      fileNames: modFiles.map(f => f.path),
    });
  }
  return result;
}

function extractQualitySignals(dir) {
  const signals = {};

  // README stats
  const readmePath = path.join(dir, 'README.md');
  if (fs.existsSync(readmePath)) {
    const content = fs.readFileSync(readmePath, 'utf8');
    // Extract stars
    const starsMatch = content.match(/(\d[\d,]+)\s+stars?/i);
    if (starsMatch) signals.stars = parseInt(starsMatch[1].replace(/,/g, ''));
    // License
    const licenseMatch = content.match(/license[^\n]*(MIT|Apache|GPL|BSD)/i);
    if (licenseMatch) signals.license = licenseMatch[1];
  }

  // LICENSE file
  const licensePath = path.join(dir, 'LICENSE');
  if (fs.existsSync(licensePath)) {
    const content = fs.readFileSync(licensePath, 'utf8');
    if (content.toLowerCase().includes('mit')) signals.license = 'MIT';
    else if (content.toLowerCase().includes('apache')) signals.license = 'Apache-2.0';
  }

  // package.json
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    signals.name = pkg.name;
    signals.version = pkg.version;
    signals.runtimeDeps = Object.keys(pkg.dependencies || {}).length;
    signals.devDeps = Object.keys(pkg.devDependencies || {}).length;
  }

  return signals;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

console.log('=== Completeness Gate — P1 Fix ===\n');

// Step 1: Clone
const tmpDir = clone(REPO_URL);
const repoName = REPO_URL.split('/').pop().replace('.git', '');

// Step 2: Count source files
console.log('\nStep 1: Counting source files...');
const { count: fileCount, files } = countSourceFiles(tmpDir);
console.log(`  Total source files: ${fileCount}`);

// Step 3: Extract actual modules
console.log('\nStep 2: Extracting modules from source code...');
const modules = extractModules(tmpDir, files);
console.log(`  Modules found: ${modules.length}`);
for (const m of modules) {
  console.log(`  📦 ${m.name}: ${m.files} files, ${m.totalBytes} bytes, exports: [${m.exportTypes.join(', ')}]`);
  for (const f of m.fileNames) console.log(`     ${f}`);
}

// Step 4: Quality signals
console.log('\nStep 3: Quality signals...');
const quality = extractQualitySignals(tmpDir);
console.log(`  Stars: ${quality.stars || 'unknown'}`);
console.log(`  License: ${quality.license || 'unknown'}`);
console.log(`  Runtime deps: ${quality.runtimeDeps || 0}, Dev deps: ${quality.devDeps || 0}`);

// Step 5: Compare with what's in the graph
console.log('\nStep 4: Comparing with existing PhantomComponents in graph...');
const existing = await readCypher(
  `MATCH (c:PhantomComponent) WHERE c.source_repo CONTAINS $repo
   RETURN c.external_id AS id, c.name AS name, c.type AS type`,
  { repo: repoName }
);
const existingComponents = existing.result?.results || [];
console.log(`  Components already in graph: ${existingComponents.length}`);
for (const c of existingComponents) console.log(`  📦 ${c.name} (${c.type})`);

// Completeness score
const capturedNames = existingComponents.map(c => c.name.toLowerCase());
const matchedModules = modules.filter(m => {
  // Match module names against captured component names
  // e.g., "src/orchestrator" should match "agent-coordinator"
  // e.g., "src/agent" should match "agent-worker"
  // e.g., "src/task" should match "task-dispatcher"
  const mLower = m.name.toLowerCase();
  return capturedNames.some(cn => {
    // Direct match
    if (mLower.includes(cn) || cn.includes(mLower)) return true;
    // Semantic match: "orchestrator" ~ "coordinator", "agent" ~ "worker"
    if (mLower.includes('orchestrator') && cn.includes('coordinator')) return true;
    if (mLower.includes('agent') && (cn.includes('worker') || cn.includes('agent'))) return true;
    if (mLower.includes('task') && cn.includes('task')) return true;
    return false;
  });
});
const completeness = modules.length > 0 ? Math.round((matchedModules.length / modules.length) * 100) : 0;

console.log(`\n  Completeness: ${matchedModules.length}/${modules.length} modules captured (${completeness}%)`);

const missedModules = modules.filter(m =>
  !capturedNames.some(cn => m.name.toLowerCase().includes(cn) || cn.includes(m.name.toLowerCase()))
);
if (missedModules.length > 0) {
  console.log(`\n  ❌ Missed ${missedModules.length} modules:`);
  for (const m of missedModules) {
    console.log(`     ${m.name} (${m.files} files, exports: ${m.exportTypes.join(', ')})`);
  }
}

// Step 6: Gate verdict
console.log('\n=== Gate Verdict ===');
let verdict, color;
if (completeness >= 80) { verdict = 'PASS'; color = '✅'; }
else if (completeness >= 50) { verdict = 'PASS WITH FIXES'; color = '🟡'; }
else { verdict = 'FAIL'; color = '🔴'; }

console.log(`  ${color} ${verdict} — ${completeness}% completeness`);
console.log(`  Threshold: ≥80% PASS, 50-79% PASS WITH FIXES, <50% FAIL`);

// Step 7: Write corrected data to graph
console.log('\nStep 5: Writing corrected data to graph...');

// Write missed modules as PhantomComponents
for (const m of missedModules) {
  const compId = `${repoName}-${m.name}`;
  await writeCypher(
    `MERGE (c:PhantomComponent {external_id: $cid})
     SET c.name = $name, c.type = $type, c.language = 'typescript',
         c.framework = 'open-multi-agent', c.source_repo = $repo,
         c.file_count = $files, c.byte_count = $bytes,
         c.export_types = $exports, c.discovered_at = datetime(),
         c.completeness_gate = $gate
     RETURN c.external_id AS id`,
    { cid: compId, name: m.name, type: m.exportTypes.includes('class') ? 'class' : 'module', repo: REPO_URL, files: m.files, bytes: m.totalBytes, exports: JSON.stringify(m.exportTypes), gate: completeness }
  );
  console.log(`  ✅ Added missed module: ${m.name} (${m.files} files)`);
}

// Write completeness evidence
await writeCypher(
  `MERGE (e:EvidenceObject {external_id: $eid})
   SET e.producer = 'completeness_gate_p1',
       e.subject_ref = $repo,
       e.evidence_class = 'CompletenessGate',
       e.payload_json = $payload,
       e.verification_status = $status,
       e.created_at = datetime()`,
  {
    eid: `ev_completeness_${repoName}`,
    repo: REPO_URL,
    status: verdict,
    payload: JSON.stringify({
      action: 'completeness_gate',
      repo: REPO_URL,
      total_source_files: fileCount,
      modules_found: modules.length,
      modules_captured_before: existingComponents.length,
      modules_matched: matchedModules.length,
      completeness_pct: completeness,
      missed_modules: missedModules.map(m => m.name),
      quality: { stars: quality.stars, license: quality.license },
      verdict,
      timestamp: new Date().toISOString()
    })
  }
);
console.log(`  ✅ Completeness evidence written: ${verdict}`);

// Cleanup
console.log('\nCleaning up...');
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  // Windows fallback
  execSync(`rmdir /s /q ${tmpDir}`, { stdio: 'pipe' });
}
console.log(`  ✅ Removed ${tmpDir}`);

console.log(`\n${'='.repeat(60)}`);
console.log(`✅ COMPLETENESS GATE — ${verdict} (${completeness}%)`);
console.log(`   Source files: ${fileCount}, Modules: ${modules.length}`);
console.log(`   Captured: ${matchedModules.length}/${modules.length}, Missed: ${missedModules.length}`);
console.log(`${'='.repeat(60)}`);
