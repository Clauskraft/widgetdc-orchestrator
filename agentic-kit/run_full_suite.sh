#!/bin/bash
# run_full_suite.sh — WidgeTDC Full Validation Suite (Phase 1 + Phase 2)
# Run with: bash run_full_suite.sh
set -e

echo "🔹 Running Phase 1 Foundation..."
bash run_phase1.sh

echo ""
echo "🔹 Running Phase 2 Autonomi..."
bash run_phase2.sh

echo ""
echo "🎉 Full Suite Complete. System Autonomous."
