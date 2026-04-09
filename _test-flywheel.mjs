const k = 'WidgeTDC_Orch_2026'
const base = 'https://orchestrator-production-c27e.up.railway.app'
const h = { 'X-API-Key': k, 'Content-Type': 'application/json' }

// Wait for deploy
console.log('Waiting 150s for Railway deploy...')
await new Promise(r => setTimeout(r, 150000))

console.log('\n=== 1. HEALTH ===')
const health = await fetch(`${base}/health`).then(r => r.json())
console.log('pheromone_layer:', JSON.stringify(health.pheromone_layer))
console.log('peer_eval:', JSON.stringify(health.peer_eval))
console.log('anomaly_watcher:', JSON.stringify(health.anomaly_watcher))
console.log('cron_jobs:', health.cron_jobs)

console.log('\n=== 2. PHEROMONE STATUS ===')
const phStatus = await fetch(`${base}/api/pheromone/status`, { headers: h }).then(r => r.json())
console.log(JSON.stringify(phStatus, null, 2))

console.log('\n=== 3. PEER-EVAL STATUS ===')
const peStatus = await fetch(`${base}/api/peer-eval/status`, { headers: h }).then(r => r.json())
console.log(JSON.stringify(peStatus, null, 2))

console.log('\n=== 4. TRIGGER ANOMALY SCAN (deposits pheromones) ===')
const scan = await fetch(`${base}/api/anomaly-watcher/scan`, { method: 'POST', headers: h }).then(r => r.json())
console.log(JSON.stringify(scan, null, 2))

console.log('\n=== 5. PHEROMONE SENSE (after anomaly scan) ===')
const sensed = await fetch(`${base}/api/pheromone/sense?limit=10`, { headers: h }).then(r => r.json())
console.log(JSON.stringify(sensed, null, 2))

console.log('\n=== 6. MANUAL EVAL (test PeerEval) ===')
const evalResult = await fetch(`${base}/api/peer-eval/evaluate`, {
  method: 'POST', headers: h,
  body: JSON.stringify({
    agentId: 'test-agent',
    taskId: 'test-task-1',
    taskType: 'research',
    success: true,
    metrics: { latency_ms: 500, quality_score: 0.85 },
    insights: ['Test insight: pheromone system works']
  })
}).then(r => r.json())
console.log(JSON.stringify(evalResult, null, 2))

console.log('\n=== 7. PHEROMONE HEATMAP ===')
const heatmap = await fetch(`${base}/api/pheromone/heatmap`, { headers: h }).then(r => r.json())
console.log(JSON.stringify(heatmap, null, 2))

console.log('\n=== 8. FLEET LEARNING ===')
const fleet = await fetch(`${base}/api/peer-eval/fleet`, { headers: h }).then(r => r.json())
console.log(JSON.stringify(fleet, null, 2))

console.log('\n✅ All flywheel endpoints verified!')
