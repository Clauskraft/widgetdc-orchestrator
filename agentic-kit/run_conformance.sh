#!/bin/bash
# run_conformance.sh — WidgeTDC Open Spec v0.1 External Conformance Runner
#
# Distribute this file with the widgetdc-spec-v0.1 package to external teams.
# Runs the full C1-C7 conformance test suite against a clean Neo4j instance.
#
# Prerequisites:
#   pip install neo4j pytest
#   export NEO4J_URI="neo4j+s://<your-aura-host>.databases.neo4j.io"
#   export NEO4J_USER="neo4j"
#   export NEO4J_PASSWORD="<your-password>"
#
# Usage:
#   bash run_conformance.sh
#   bash run_conformance.sh --report   # write results/conformance_report.json

set -e

REPORT_DIR="results"
REPORT_FILE="$REPORT_DIR/conformance_report.json"
WRITE_REPORT=false

for arg in "$@"; do
  case $arg in
    --report) WRITE_REPORT=true ;;
  esac
done

echo "=================================================="
echo "  WidgeTDC Open Spec v0.1 — Conformance Runner"
echo "  Spec: https://github.com/Clauskraft/widgetdc-orchestrator/tree/main/widgetdc-spec/v0.1"
echo "=================================================="
echo ""

# Guard: require Neo4j credentials
if [ -z "$NEO4J_URI" ] || [ -z "$NEO4J_PASSWORD" ]; then
  echo "❌ Missing NEO4J_URI or NEO4J_PASSWORD env vars."
  echo "   export NEO4J_URI='neo4j+s://...' NEO4J_USER='neo4j' NEO4J_PASSWORD='...'"
  exit 1
fi

PASS=0
FAIL=0
RESULTS="[]"

run_test() {
  local id="$1"
  local name="$2"
  local module="$3"
  echo -n "  $id — $name ... "
  if python3 -m pytest "tests/$module" -q --tb=short 2>&1; then
    echo "✅ PASS"
    PASS=$((PASS + 1))
    RESULTS=$(python3 -c "
import json, sys
r = json.loads('$RESULTS')
r.append({'id': '$id', 'name': '$name', 'status': 'PASS'})
print(json.dumps(r))
")
  else
    echo "❌ FAIL"
    FAIL=$((FAIL + 1))
    RESULTS=$(python3 -c "
import json, sys
r = json.loads('$RESULTS')
r.append({'id': '$id', 'name': '$name', 'status': 'FAIL'})
print(json.dumps(r))
")
  fi
}

echo "Running C1-C7 Conformance Suite..."
echo ""

run_test "C1" "EvidenceObject Creation (ADR-003)"      "tests/test_c1_evidence_create.py"
run_test "C2" "Hash-Chain Integrity (ADR-003)"          "tests/test_c2_hash_chain.py"
run_test "C3" "HITL Gate Enforcement (ADR-004)"         "tests/test_c3_hitl_gate.py"
run_test "C4" "MRP Cluster Generation (ADR-002)"        "tests/test_c4_mrp_clusters.py"
run_test "C5" "Dynamic Router Validity Gate"            "tests/test_c5_router_validity.py"
run_test "C6" "Idempotency (ADR-002)"                   "tests/test_c6_idempotency.py"
run_test "C7" "Router Fallback Chain"                   "tests/test_c7_fallback.py"

echo ""
echo "=================================================="
echo "  Results: $PASS passed, $FAIL failed of 7 tests"

if [ "$WRITE_REPORT" = true ]; then
  mkdir -p "$REPORT_DIR"
  python3 -c "
import json, datetime
results = $RESULTS
report = {
    'spec_version': 'v0.1',
    'run_date': datetime.datetime.utcnow().isoformat() + 'Z',
    'tests_passed': $PASS,
    'tests_failed': $FAIL,
    'conformant': $FAIL == 0,
    'results': results
}
with open('$REPORT_FILE', 'w') as f:
    json.dump(report, f, indent=2)
print('  Report: $REPORT_FILE')
"
fi

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "  ✅ WidgeTDC Open Spec v0.1 Conformant"
  echo "     Tests passed: C1 C2 C3 C4 C5 C6 C7"
  echo "     Verified: $(date -u +%Y-%m-%d)"
  echo "=================================================="
  exit 0
else
  echo ""
  echo "  ❌ Conformance FAILED — $FAIL test(s) did not pass"
  echo "     See output above for details."
  echo "=================================================="
  exit 1
fi
