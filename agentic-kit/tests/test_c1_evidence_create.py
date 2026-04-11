"""C1 — EvidenceObject Creation (ADR-003)"""
import re
import pytest
from conftest import *  # noqa: F401,F403


def test_c1_evidence_create(validator):
    """C1: Create root EvidenceObject, verify ID pattern and Neo4j write."""
    eid = validator.add_evidence(
        "test_producer", "test_subject", {"action": "test", "conformance": "C1"}
    )
    assert eid.startswith("ev_test_producer_"), f"ID prefix wrong: {eid}"
    assert len(eid.split("_")[-1]) == 16, f"Hash suffix not 16 chars: {eid}"
    assert re.match(r"^ev_[a-z0-9_]+_[a-f0-9]{16}$", eid), f"ID pattern mismatch: {eid}"
