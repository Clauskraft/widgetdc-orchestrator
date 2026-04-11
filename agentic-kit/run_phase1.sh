#!/bin/bash
# run_phase1.sh — WidgeTDC Phase 1 Validation Suite
# Run with: bash run_phase1.sh  (Git Bash / WSL / Linux / macOS)
set -e

echo "================================================="
echo "🚀 WidgeTDC Phase 1 Execution: Validation Suite"
echo "================================================="

# 1. Check environment variables
echo "🔍 Checking Environment Variables..."
if [ -z "$NEO4J_URI" ] || [ -z "$NEO4J_USER" ] || [ -z "$NEO4J_PASSWORD" ]; then
    echo "❌ Missing Neo4j credentials. Export before running:"
    echo "   export NEO4J_URI='neo4j+s://054eff27.databases.neo4j.io'"
    echo "   export NEO4J_USER='neo4j'"
    echo "   export NEO4J_PASSWORD='<password>'"
    exit 1
fi
echo "✅ Neo4j Config OK (URI: $NEO4J_URI)"

# 2. Run Evidence Chain validation (phase1.py = canonical Phase 1 runner)
echo ""
echo "⚙️  Running Fantom Validation (Evidence Chain)..."
python phase1.py
echo "✅ Fantom Validation Passed"

# 3. Run Snout Ingestion
echo ""
echo "🦊 Running Snout Ingestion (Graph Update)..."
python snout_ingestor.py
echo "✅ Snout Ingestion Passed"

echo ""
echo "================================================="
echo "🎉 Phase 1 Execution Successful!"
echo "👉 Verify in Neo4j Browser:"
echo "   MATCH (n:Agent) RETURN n LIMIT 5"
echo "   MATCH (e:EvidenceObject) RETURN e LIMIT 5"
echo "================================================="
