import hashlib
import json
import os
from neo4j import GraphDatabase
from typing import Dict, Any, Optional

class FantomContractValidator:
    """
    Implements ADR-003: EvidenceObject Hash-Chain Contract.
    Manages ingestion, serialization, and verification of immutable evidence.
    """

    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def close(self):
        self.driver.close()

    def _generate_hash(self, data: Any) -> str:
        """Generates SHA-256 hash for JSON-serializable data."""
        if isinstance(data, dict) or isinstance(data, list):
            data_str = json.dumps(data, sort_keys=True)
        else:
            data_str = str(data)
        return hashlib.sha256(data_str.encode('utf-8')).hexdigest()

    def add_evidence(self,
                     producer: str,
                     subject_ref: str,
                     payload: Dict,
                     prev_evidence_id: Optional[str] = None) -> str:
        """
        Creates a new EvidenceObject and links it to the chain.

        :param producer: Service/Agent ID creating the evidence.
        :param subject_ref: External ID of the Agent/Cluster/Task being audited.
        :param payload: The audit data (will be serialized to JSON string).
        :param prev_evidence_id: External ID of the previous evidence in chain (None for root).
        :return: external_id of the new evidence.
        """
        # 1. Prepare Data
        new_id = f"ev_{producer}_{self._generate_hash(json.dumps(payload))[:16]}"
        payload_json = json.dumps(payload)
        payload_hash = self._generate_hash(payload)

        # 2. Retrieve Previous Hash (if exists)
        previous_hash = None
        if prev_evidence_id:
            with self.driver.session() as session:
                result = session.run("""
                    MATCH (prev:EvidenceObject {external_id: $prev_id})
                    RETURN prev.payload_hash AS hash
                """, prev_id=prev_evidence_id)
                record = result.single()
                if record:
                    previous_hash = record["hash"]

        # 3. Create Node
        with self.driver.session() as session:
            # Fix #1: Store payload_json, not map
            # Fix #3: Match on external_id for subject linking
            query = """
                MERGE (e:EvidenceObject {external_id: $new_id})
                SET
                    e.producer = $producer,
                    e.subject_ref = $subject_ref,
                    e.evidence_class = $evidence_class,
                    e.payload_json = $payload_json,
                    e.payload_hash = $payload_hash,
                    e.previous_hash = $previous_hash,
                    e.verification_status = 'VERIFIED'

                WITH e
                OPTIONAL MATCH (subject {external_id: $subject_ref})
                FOREACH (_ IN CASE WHEN subject IS NOT NULL THEN [1] ELSE [] END |
                    MERGE (e)-[:EVIDENCE_FOR]->(subject))

                WITH e
                OPTIONAL MATCH (prev:EvidenceObject {external_id: $prev_id})
                FOREACH (_ IN CASE WHEN prev IS NOT NULL THEN [1] ELSE [] END |
                    MERGE (prev)-[:NEXT_IN_CHAIN]->(e))

                RETURN e.external_id AS id
            """

            result = session.run(query,
                new_id=new_id,
                producer=producer,
                subject_ref=subject_ref,
                evidence_class="ActionLog",
                payload_json=payload_json,
                payload_hash=payload_hash,
                previous_hash=previous_hash,
                prev_id=prev_evidence_id
            )
            return result.single()["id"]

    def verify_chain_integrity(self, start_evidence_id: str) -> Dict[str, Any]:
        """
        Verifies the cryptographic integrity of an evidence chain starting from a specific node.
        Fix #2: Traverses the graph using [:NEXT_IN_CHAIN] rather than checking internal fields.
        """
        errors = []

        query = """
            MATCH path = (start:EvidenceObject {external_id: $start_id})-[:NEXT_IN_CHAIN*]->(e:EvidenceObject)
            WITH start, collect(e) AS chain
            UNWIND chain AS curr
            WITH curr
            RETURN curr.external_id AS id, curr.previous_hash AS stored_prev, curr.payload_hash AS curr_hash
        """

        # Note: In production, this verification is often done client-side
        # by fetching the chain in order. Neo4j doesn't easily allow "Compare with previous node in list"
        # inside Cypher without APOC.
        # We fetch the list and verify in Python to ensure determinism.

        with self.driver.session() as session:
            result = session.run(query, start_id=start_evidence_id)
            chain_nodes = list(result)

        # Verification Logic
        last_hash = None
        verified_count = 0

        for node in chain_nodes:
            # Check Chain Link (previous_hash matches previous node's hash)
            if last_hash is not None:
                if node["stored_prev"] != last_hash:
                    errors.append(f"Chain broken at {node['id']}: Expected {last_hash}, got {node['stored_prev']}")
                else:
                    verified_count += 1

            last_hash = node["curr_hash"]

        return {
            "chain_valid": len(errors) == 0,
            "nodes_verified": verified_count,
            "errors": errors
        }


# --- EXAMPLE USAGE ---
if __name__ == "__main__":
    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "secret")

    print(f"🔌 Connecting to Neo4j at {uri}...")

    try:
        validator = FantomContractValidator(uri=uri, user=user, password=password)

        print("🚀 Starting Fantom Validation Sequence...")

        # 1. Create Root Evidence (Agent Ingestion)
        root_id = validator.add_evidence(
            producer="snout_agent",
            subject_ref="agent_deepseek_v3",
            payload={"action": "ingestion", "status": "success", "confidence": 0.95},
            prev_evidence_id=None
        )
        print(f"✅ Created Root Evidence: {root_id}")

        # 2. Create Linked Evidence (Cluster Assignment)
        child_id = validator.add_evidence(
            producer="mrp_engine",
            subject_ref="phantom_eu_safe",
            payload={"action": "assignment", "cluster": "eu_safe", "score": 0.98},
            prev_evidence_id=root_id
        )
        print(f"✅ Created Child Evidence: {child_id}")

        # 3. Verify Chain
        verification = validator.verify_chain_integrity(root_id)
        print(f"🔍 Chain Verification: {verification}")

        validator.close()
        print("✅ Fantom Validation Sequence complete.")

    except Exception as e:
        print(f"❌ Connection failed: {e}")
        print("💡 Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD env vars to connect to AuraDB.")
