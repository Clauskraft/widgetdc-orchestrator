"""
contract_validator.py — Phase 4: Contractor Model (Formalized Contract Pattern)

Implements the "Contractor" model where agents operate under verifiable contracts
with defined deliverable specs, SLAs, and audit obligations.

Each contract:
  - Has a unique contract_id
  - Defines expected deliverable schema (output spec)
  - Enforces latency and quality SLAs
  - Records every delivery as an EvidenceObject (ADR-003)
  - Marks agent status: CONTRACTED → DELIVERED → VERIFIED | BREACHED

Usage:
  from contract_validator import ContractValidator, Contract
  cv = ContractValidator()
  contract_id = cv.issue_contract(
      requester="mrp_engine",
      contractor_agent_id="qwen-eu-v2.5",
      deliverable_spec={"task": "reasoning", "max_tokens": 2048},
      sla_latency_ms=5000,
      sla_quality_threshold=0.85,
  )
  cv.record_delivery(contract_id, payload={"result": "...", "quality": 0.91}, latency_ms=320)
  status = cv.get_contract_status(contract_id)
  cv.close()
"""

import os
import sys
import json
import hashlib
import datetime
from dataclasses import dataclass, asdict, field
from typing import Any, Optional

from neo4j import GraphDatabase
from fantom_validator import FantomContractValidator


# ── Data Model ────────────────────────────────────────────────────────────────


@dataclass
class Contract:
    contract_id: str
    requester: str
    contractor_agent_id: str
    deliverable_spec: dict
    sla_latency_ms: float
    sla_quality_threshold: float
    status: str = "CONTRACTED"           # CONTRACTED | DELIVERED | VERIFIED | BREACHED
    issued_at: str = field(default_factory=lambda: datetime.datetime.utcnow().isoformat() + "Z")
    delivered_at: Optional[str] = None
    verified_at: Optional[str] = None
    breach_reason: Optional[str] = None
    delivery_latency_ms: Optional[float] = None
    delivery_quality: Optional[float] = None


# ── Validator ─────────────────────────────────────────────────────────────────


class ContractValidator:
    """
    Issues, tracks, and verifies agent contracts.
    All state persisted to Neo4j + ADR-003 EvidenceObjects.
    """

    def __init__(self):
        uri      = os.environ.get("NEO4J_URI",      "bolt://localhost:7687")
        user     = os.environ.get("NEO4J_USER",     "neo4j")
        password = os.environ.get("NEO4J_PASSWORD", "")
        if not password:
            print("❌ NEO4J_PASSWORD not set.")
            sys.exit(1)
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self._evidence = FantomContractValidator(uri, user, password)

    def close(self):
        self.driver.close()
        self._evidence.close()

    # ── Contract ID ──────────────────────────────────────────────────────────

    def _make_contract_id(self, requester: str, contractor: str, spec: dict) -> str:
        raw = f"{requester}:{contractor}:{json.dumps(spec, sort_keys=True)}"
        h = hashlib.sha256(raw.encode()).hexdigest()[:12]
        return f"contract_{h}"

    # ── Issue ─────────────────────────────────────────────────────────────────

    def issue_contract(
        self,
        requester: str,
        contractor_agent_id: str,
        deliverable_spec: dict,
        sla_latency_ms: float = 5000.0,
        sla_quality_threshold: float = 0.80,
    ) -> str:
        """
        Issues a new contract. Returns contract_id.
        Idempotent — re-issuing the same contract returns the existing ID.
        """
        contract_id = self._make_contract_id(requester, contractor_agent_id, deliverable_spec)

        contract = Contract(
            contract_id=contract_id,
            requester=requester,
            contractor_agent_id=contractor_agent_id,
            deliverable_spec=deliverable_spec,
            sla_latency_ms=sla_latency_ms,
            sla_quality_threshold=sla_quality_threshold,
        )

        with self.driver.session() as session:
            session.run("""
                MERGE (c:Contract {contract_id: $contract_id})
                ON CREATE SET
                    c.requester              = $requester,
                    c.contractor_agent_id    = $contractor_agent_id,
                    c.deliverable_spec       = $deliverable_spec,
                    c.sla_latency_ms         = $sla_latency_ms,
                    c.sla_quality_threshold  = $sla_quality_threshold,
                    c.status                 = $status,
                    c.issued_at              = $issued_at
            """,
                contract_id=contract_id,
                requester=requester,
                contractor_agent_id=contractor_agent_id,
                deliverable_spec=json.dumps(deliverable_spec),
                sla_latency_ms=sla_latency_ms,
                sla_quality_threshold=sla_quality_threshold,
                status=contract.status,
                issued_at=contract.issued_at,
            )

            # Link contractor Agent → Contract
            session.run("""
                MATCH (a:Agent {agent_id: $agent_id})
                MATCH (c:Contract {contract_id: $contract_id})
                MERGE (a)-[:CONTRACTED_FOR]->(c)
            """, agent_id=contractor_agent_id, contract_id=contract_id)

        # ADR-003 audit trail
        self._evidence.add_evidence(
            producer="contract_validator",
            subject_ref=contract_id,
            payload={
                "event": "contract_issued",
                "contract_id": contract_id,
                "requester": requester,
                "contractor": contractor_agent_id,
                "sla_latency_ms": sla_latency_ms,
                "sla_quality_threshold": sla_quality_threshold,
            },
        )

        return contract_id

    # ── Record Delivery ───────────────────────────────────────────────────────

    def record_delivery(
        self,
        contract_id: str,
        payload: dict,
        latency_ms: float,
        quality_score: Optional[float] = None,
    ) -> dict:
        """
        Records a delivery against a contract.
        Evaluates SLA compliance and updates contract status.

        Returns: {"contract_id", "status", "sla_met", "breach_reason"}
        """
        now = datetime.datetime.utcnow().isoformat() + "Z"

        # Fetch contract
        with self.driver.session() as session:
            rec = session.run("""
                MATCH (c:Contract {contract_id: $contract_id})
                RETURN c.sla_latency_ms AS sla_lat,
                       c.sla_quality_threshold AS sla_q,
                       c.status AS status
            """, contract_id=contract_id).single()

        if not rec:
            return {"error": f"Contract {contract_id} not found"}

        sla_lat   = rec["sla_lat"]
        sla_q     = rec["sla_q"]
        old_status = rec["status"]

        if old_status in ("BREACHED",):
            return {"contract_id": contract_id, "status": old_status, "note": "already breached"}

        # SLA evaluation
        breach_reason = None
        if latency_ms > sla_lat:
            breach_reason = f"latency {latency_ms:.0f}ms > SLA {sla_lat:.0f}ms"
        elif quality_score is not None and quality_score < sla_q:
            breach_reason = f"quality {quality_score:.3f} < SLA {sla_q:.3f}"

        new_status = "BREACHED" if breach_reason else "DELIVERED"

        with self.driver.session() as session:
            session.run("""
                MATCH (c:Contract {contract_id: $contract_id})
                SET c.status              = $status,
                    c.delivered_at        = $delivered_at,
                    c.delivery_latency_ms = $latency_ms,
                    c.delivery_quality    = $quality_score,
                    c.breach_reason       = $breach_reason
            """,
                contract_id=contract_id,
                status=new_status,
                delivered_at=now,
                latency_ms=latency_ms,
                quality_score=quality_score,
                breach_reason=breach_reason,
            )

        # ADR-003 audit
        self._evidence.add_evidence(
            producer="contract_validator",
            subject_ref=contract_id,
            payload={
                "event": "delivery_recorded",
                "contract_id": contract_id,
                "status": new_status,
                "latency_ms": latency_ms,
                "quality_score": quality_score,
                "breach_reason": breach_reason,
                "payload_keys": list(payload.keys()),
            },
        )

        return {
            "contract_id": contract_id,
            "status": new_status,
            "sla_met": new_status == "DELIVERED",
            "breach_reason": breach_reason,
        }

    # ── Verify ────────────────────────────────────────────────────────────────

    def verify_delivery(self, contract_id: str) -> dict:
        """
        Marks a DELIVERED contract as VERIFIED (human or automated sign-off).
        """
        now = datetime.datetime.utcnow().isoformat() + "Z"

        with self.driver.session() as session:
            rec = session.run("""
                MATCH (c:Contract {contract_id: $contract_id})
                RETURN c.status AS status
            """, contract_id=contract_id).single()

        if not rec:
            return {"error": f"Contract {contract_id} not found"}
        if rec["status"] != "DELIVERED":
            return {"contract_id": contract_id, "error": f"cannot verify — status={rec['status']}"}

        with self.driver.session() as session:
            session.run("""
                MATCH (c:Contract {contract_id: $contract_id})
                SET c.status = 'VERIFIED', c.verified_at = $now
            """, contract_id=contract_id, now=now)

        self._evidence.add_evidence(
            producer="contract_validator",
            subject_ref=contract_id,
            payload={"event": "delivery_verified", "contract_id": contract_id, "verified_at": now},
        )

        return {"contract_id": contract_id, "status": "VERIFIED"}

    # ── Status Query ──────────────────────────────────────────────────────────

    def get_contract_status(self, contract_id: str) -> Optional[dict]:
        with self.driver.session() as session:
            rec = session.run("""
                MATCH (c:Contract {contract_id: $contract_id})
                RETURN c.contract_id        AS contract_id,
                       c.status             AS status,
                       c.contractor_agent_id AS agent,
                       c.sla_latency_ms     AS sla_lat,
                       c.sla_quality_threshold AS sla_q,
                       c.delivery_latency_ms AS del_lat,
                       c.delivery_quality   AS del_q,
                       c.breach_reason      AS breach_reason
            """, contract_id=contract_id).single()
        return dict(rec) if rec else None

    def list_breached_contracts(self, limit: int = 20) -> list[dict]:
        with self.driver.session() as session:
            result = session.run("""
                MATCH (c:Contract {status: 'BREACHED'})
                RETURN c.contract_id AS contract_id,
                       c.contractor_agent_id AS agent,
                       c.breach_reason AS reason,
                       c.delivered_at AS at
                ORDER BY c.delivered_at DESC
                LIMIT $limit
            """, limit=limit)
            return [dict(r) for r in result]


# ── Demo ──────────────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import time

    print("🔏 ContractValidator — Phase 4 Demo")
    cv = ContractValidator()

    try:
        # Issue a contract
        cid = cv.issue_contract(
            requester="demo_requester",
            contractor_agent_id="qwen-eu-v2.5",
            deliverable_spec={"task": "reasoning", "max_tokens": 2048},
            sla_latency_ms=5000,
            sla_quality_threshold=0.85,
        )
        print(f"  ✅ Contract issued: {cid}")

        # Simulate a good delivery
        t0 = time.time()
        time.sleep(0.1)  # simulated agent call
        latency = (time.time() - t0) * 1000

        result = cv.record_delivery(
            cid,
            payload={"response": "Here is the analysis...", "tokens_used": 1240},
            latency_ms=latency,
            quality_score=0.92,
        )
        print(f"  📦 Delivery recorded: status={result['status']} sla_met={result['sla_met']}")

        # Verify
        v = cv.verify_delivery(cid)
        print(f"  ✅ Verified: {v}")

        # Status check
        s = cv.get_contract_status(cid)
        print(f"  📋 Final status: {s['status']} | lat={s['del_lat']:.0f}ms | quality={s['del_q']:.2f}")

        # Simulate a breach
        cid2 = cv.issue_contract(
            requester="demo_requester",
            contractor_agent_id="deepseek-math-v3",
            deliverable_spec={"task": "math", "max_tokens": 512},
            sla_latency_ms=1000,
            sla_quality_threshold=0.80,
        )
        breach = cv.record_delivery(cid2, payload={"result": "slow"}, latency_ms=2500.0, quality_score=0.75)
        print(f"  ⚠️  Breach recorded: {breach}")

    finally:
        cv.close()
