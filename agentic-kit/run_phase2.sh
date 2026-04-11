#!/bin/bash
# run_phase2.sh — Phase 2: Autonomi & Skalering — Validation Suite
# Run with: bash run_phase2.sh  (Git Bash / WSL / Linux / macOS)
set -e

echo "================================================="
echo "🚀 Phase 2: Autonomi & Skalering — Validation"
echo "================================================="

# Check Neo4j env vars
if [ -z "$NEO4J_URI" ] || [ -z "$NEO4J_USER" ] || [ -z "$NEO4J_PASSWORD" ]; then
    echo "❌ Missing Neo4j credentials. See run_phase1.sh for export instructions."
    exit 1
fi

# Step 1: Recalculate Phantom Clusters
echo ""
echo "📊 Step 1: Running MRP Engine (Cluster Generation)..."
python mrp_engine.py

# Step 2: Test Dynamic Router (EU + reasoning)
echo ""
echo "🔀 Step 2: Testing Dynamic Router (EU + reasoning)..."
python -c "
from router import DynamicRouter
r = DynamicRouter()
res = r.route_request('reasoning', 'EU', max_cost=0.00001)
print('Router output:', res)
r.close()
"

# Step 3: Test Dynamic Router (ANY + math)
echo ""
echo "🔀 Step 2b: Testing Dynamic Router (ANY + math)..."
python -c "
from router import DynamicRouter
r = DynamicRouter()
res = r.route_request('math', 'ANY', max_cost=0.00001)
print('Router output:', res)
r.close()
"

# Step 4: HITL Escalation test (only if LINEAR_API_KEY is set)
echo ""
echo "🎫 Step 3: Testing HITL Escalation..."
python -c "
from linear_hitl import escalate_to_linear
escalate_to_linear(
    'Low Confidence Ingest',
    {'agent_id': 'test-agent-01', 'confidence': 0.62, 'reason': 'Confidence < 0.7 threshold'}
)
"

echo ""
echo "================================================="
echo "✅ Phase 2 Validation Complete!"
echo "👉 Verify in Neo4j Browser:"
echo "   MATCH (c:PhantomCluster) RETURN c.external_id, c.validity_score, c.rule_capability"
echo "   MATCH (a:Agent)-[:PART_OF]->(c:PhantomCluster) RETURN a.agent_id, c.external_id"
echo "================================================="
