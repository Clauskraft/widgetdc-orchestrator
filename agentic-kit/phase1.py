"""
phase1.py — WidgeTDC Phase 1: ADR-003 Hash-Chain Validation Runner

Implements the canonical Phase 1 execution sequence:
  1. Connect to Neo4j AuraDB
  2. Create Root Evidence (Snout agent ingestion)
  3. Create Child Evidence (MRP cluster assignment)
  4. Verify hash-chain integrity

Environment variables required:
  NEO4J_URI      = neo4j+s://<your-aura-host>.databases.neo4j.io
  NEO4J_USER     = neo4j
  NEO4J_PASSWORD = <your-password>

Run:
  python phase1.py
"""

import os
import sys
from fantom_validator import FantomContractValidator


def run_phase1() -> bool:
    """
    Phase 1 Execution: Neo4j Connection & Evidence Chain Test.
    Returns True if all steps pass, False otherwise.
    """
    print("🚀 Starting WidgeTDC Phase 1 Execution...")

    neo4j_uri      = os.environ.get("NEO4J_URI",      "bolt://localhost:7687")
    neo4j_user     = os.environ.get("NEO4J_USER",     "neo4j")
    neo4j_password = os.environ.get("NEO4J_PASSWORD", "")

    if not neo4j_password:
        print("❌ NEO4J_PASSWORD not set. Export it first:")
        print("   export NEO4J_PASSWORD='<your-password>'")
        sys.exit(1)

    print(f"✅ Connecting to Neo4j at {neo4j_uri}...")

    try:
        validator = FantomContractValidator(neo4j_uri, neo4j_user, neo4j_password)
    except Exception as e:
        print(f"❌ Failed to connect to Neo4j: {e}")
        sys.exit(1)

    success = False
    try:
        # Step 1: Root Evidence (Agent Ingestion)
        print("📝 Step 1: Creating Root Evidence (Agent Ingestion)...")
        root_id = validator.add_evidence(
            producer="snout_agent",
            subject_ref="agent_deepseek_v3",
            payload={"action": "ingestion", "status": "success", "confidence": 0.95},
            prev_evidence_id=None,
        )
        print(f"   ✅ Root Evidence Created: {root_id}")

        # Step 2: Child Evidence (Cluster Assignment)
        print("📝 Step 2: Creating Child Evidence (Cluster Assignment)...")
        child_id = validator.add_evidence(
            producer="mrp_engine",
            subject_ref="phantom_eu_safe",
            payload={"action": "assignment", "cluster": "eu_safe", "score": 0.98},
            prev_evidence_id=root_id,
        )
        print(f"   ✅ Child Evidence Created: {child_id}")

        # Step 3: Hash-Chain Integrity Verification
        print("🔍 Step 3: Verifying Hash-Chain Integrity...")
        verification = validator.verify_chain_integrity(root_id)

        if verification["chain_valid"]:
            print(f"   ✅ VERIFICATION PASSED: {verification['nodes_verified']} node(s) linked correctly.")
            success = True
        else:
            print(f"   ❌ VERIFICATION FAILED:")
            for err in verification["errors"]:
                print(f"      • {err}")

    except Exception as e:
        print(f"❌ Runtime Error: {e}")
    finally:
        validator.close()
        print("\n🏁 Phase 1 Execution Complete.")

    return success


if __name__ == "__main__":
    ok = run_phase1()
    sys.exit(0 if ok else 1)
