"""
compliance_audit.py — GDPR Art.44 Data Residency Enforcement + Audit Trail

Enforces that all data processing happens within EU-approved zones.
Violations are logged to Neo4j (EvidenceObject chain) and escalated
via the Linear HITL mechanism.

Complies with:
  - GDPR Art.44: Transfers to third countries
  - GDPR Art.30: Records of processing activities
  - ADR-003: EvidenceObject audit chain

Usage:
  from compliance_audit import ResidencyEnforcer

  enforcer = ResidencyEnforcer()
  enforcer.enforce(action="vendor_scrape", data_class="PII")
  enforcer.close()
"""

import os
import sys
import json
import datetime
import logging
from typing import Optional

from neo4j import GraphDatabase
from fantom_validator import FantomContractValidator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── Config ────────────────────────────────────────────────────────────────────

ALLOWED_REGIONS = ["europe-west1", "europe-west4", "europe-north1", "europe-west3"]
GDPR_VIOLATION_LABEL = "GDPR_ART44_VIOLATION"


# ── Audit helpers ─────────────────────────────────────────────────────────────


def _neo4j_creds() -> tuple[str, str, str]:
    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    pw = os.environ.get("NEO4J_PASSWORD", "")
    if not pw:
        logging.error("NEO4J_PASSWORD not set — compliance audit cannot persist")
        sys.exit(1)
    return uri, user, pw


# ── Main Class ────────────────────────────────────────────────────────────────


class ResidencyEnforcer:
    """
    GDPR Art.44 Data Residency Gate.

    Checks GCP_REGION against EU allowlist before any data processing.
    Violations are written to Neo4j + escalated to Linear HITL.
    """

    def __init__(self):
        uri, user, pw = _neo4j_creds()
        self.driver = GraphDatabase.driver(uri, auth=(user, pw))
        self.evidence = FantomContractValidator(uri, user, pw)
        self.current_region = os.environ.get("GCP_REGION", "unknown")

    def close(self):
        self.driver.close()
        self.evidence.close()

    # ── Core enforcement ──────────────────────────────────────────────────────

    def enforce(self, action: str, data_class: str = "GENERAL") -> bool:
        """
        Verify current GCP_REGION is EU-allowed before proceeding.

        Args:
            action:     Description of the operation being attempted
            data_class: Classification of data (PII, CONFIDENTIAL, GENERAL)

        Returns:
            True if compliant. Raises SecurityError on violation.
        """
        if self.current_region in ALLOWED_REGIONS:
            self._record_compliant_processing(action, data_class)
            return True

        # Violation path
        violation_msg = (
            f"GDPR Art.44 Violation: action='{action}' data_class='{data_class}' "
            f"in non-EU region '{self.current_region}'. "
            f"Allowed: {ALLOWED_REGIONS}"
        )
        logging.error(f"🚨 {violation_msg}")
        self._log_violation(action, data_class, violation_msg)
        raise SecurityError(violation_msg)

    # ── GDPR Art.30: Records of processing ───────────────────────────────────

    def _record_compliant_processing(self, action: str, data_class: str) -> None:
        """Write Art.30 processing record to Neo4j via ADR-003 EvidenceObject."""
        payload = {
            "event": "compliant_processing",
            "action": action,
            "data_class": data_class,
            "region": self.current_region,
            "gdpr_basis": "Art.44 — EU residency confirmed",
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        }
        eid = self.evidence.add_evidence(
            producer="compliance_audit",
            subject_ref=f"processing_{action}",
            payload=payload,
        )
        logging.info(f"✅ GDPR Art.30 record: {eid} (region={self.current_region})")

    # ── Violation logging ─────────────────────────────────────────────────────

    def _log_violation(self, action: str, data_class: str, message: str) -> None:
        """
        Record violation in Neo4j + escalate to Linear HITL.
        """
        now = datetime.datetime.utcnow().isoformat() + "Z"
        violation_id = f"gdpr_v_{abs(hash(message + now)) % 10**12}"

        # Write Neo4j ViolationRecord
        with self.driver.session() as session:
            session.run("""
                MERGE (v:ViolationRecord {violation_id: $vid})
                SET v.label        = $label,
                    v.action       = $action,
                    v.data_class   = $data_class,
                    v.region       = $region,
                    v.message      = $message,
                    v.status       = 'OPEN',
                    v.created_at   = $now
            """,
                vid=violation_id,
                label=GDPR_VIOLATION_LABEL,
                action=action,
                data_class=data_class,
                region=self.current_region,
                message=message,
                now=now,
            )

        # ADR-003 evidence trail
        self.evidence.add_evidence(
            producer="compliance_audit",
            subject_ref=violation_id,
            payload={
                "event": "gdpr_violation",
                "violation_id": violation_id,
                "label": GDPR_VIOLATION_LABEL,
                "action": action,
                "data_class": data_class,
                "region": self.current_region,
                "message": message,
            },
        )

        # Linear HITL escalation (best-effort — no-op if LINEAR_API_KEY absent)
        self._escalate_to_linear(violation_id, message)

    def _escalate_to_linear(self, violation_id: str, message: str) -> None:
        """Create Linear HITL issue for GDPR violation."""
        from linear_hitl import escalate_to_linear
        try:
            escalate_to_linear(
                title=f"[GDPR-ART44] Region violation: {self.current_region}",
                context={
                    "violation_id": violation_id,
                    "message": message,
                    "severity": "CRITICAL",
                    "regulation": "GDPR Art.44",
                },
            )
            logging.warning(f"⚠️  GDPR violation escalated to Linear: {violation_id}")
        except Exception as e:
            logging.warning(f"Linear escalation skipped: {e}")

    # ── Reporting ─────────────────────────────────────────────────────────────

    def open_violations(self) -> list[dict]:
        """List all open GDPR violations from Neo4j."""
        with self.driver.session() as session:
            result = session.run("""
                MATCH (v:ViolationRecord {status: 'OPEN', label: $label})
                RETURN v.violation_id  AS id,
                       v.action        AS action,
                       v.data_class    AS data_class,
                       v.region        AS region,
                       v.created_at    AS created_at
                ORDER BY v.created_at DESC
            """, label=GDPR_VIOLATION_LABEL)
            return [dict(r) for r in result]


class SecurityError(Exception):
    """Raised when a GDPR Art.44 data residency constraint is violated."""


# ── Demo ──────────────────────────────────────────────────────────────────────


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Compliance Audit — GDPR Art.44 Enforcement")
    parser.add_argument(
        "--test-geo-residency",
        action="store_true",
        help="Gate-check: verify current region against EU allowlist and exit 0/1",
    )
    parser.add_argument(
        "--region",
        default=None,
        metavar="REGION",
        help="Override GCP_REGION for test (e.g. europe-west4)",
    )
    args = parser.parse_args()

    if args.test_geo_residency:
        # Gate test: does not require Neo4j — pure region check
        test_region = args.region or os.environ.get("GCP_REGION", "unknown")
        compliant = test_region in ALLOWED_REGIONS
        status = "PASS" if compliant else "FAIL"
        print(f"🔒 GDPR Art.44 geo-residency check")
        print(f"   Region:  {test_region}")
        print(f"   Allowed: {ALLOWED_REGIONS}")
        print(f"   Result:  {status}")
        if compliant:
            print(f"✅ Compliant — {test_region} is an EU-approved zone")
            sys.exit(0)
        else:
            print(f"❌ VIOLATION — {test_region} is outside EU allowlist")
            sys.exit(1)

    print("🔒 Compliance Audit — GDPR Art.44 Demo")
    if args.region:
        os.environ["GCP_REGION"] = args.region

    enforcer = ResidencyEnforcer()
    try:
        region = os.environ.get("GCP_REGION", "NOT_SET")
        print(f"   Current region: {region}")
        print(f"   Allowed: {ALLOWED_REGIONS}")

        if region in ALLOWED_REGIONS or region == "NOT_SET":
            # Simulate EU-compliant processing (set to EU for demo)
            os.environ["GCP_REGION"] = "europe-west4"
            enforcer.current_region = "europe-west4"
            enforcer.enforce("vendor_scrape", "PII")
            print("   ✅ Compliant processing recorded")
        else:
            print(f"   ❌ Would raise SecurityError for region={region}")

        violations = enforcer.open_violations()
        print(f"   Open violations: {len(violations)}")
    finally:
        enforcer.close()
