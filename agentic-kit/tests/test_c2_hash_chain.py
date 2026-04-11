"""C2 — Hash-Chain Integrity (ADR-003)"""
import pytest
from conftest import *  # noqa: F401,F403


def test_c2_hash_chain_integrity(validator):
    """C2: 3-node chain — chain_valid=True, nodes_verified >= 1."""
    root_id  = validator.add_evidence("p", "s", {"seq": 1, "conformance": "C2"})
    child_id = validator.add_evidence("p", "s", {"seq": 2, "conformance": "C2"}, prev_evidence_id=root_id)
    _        = validator.add_evidence("p", "s", {"seq": 3, "conformance": "C2"}, prev_evidence_id=child_id)

    result = validator.verify_chain_integrity(root_id)
    assert result["chain_valid"] is True,       f"chain_valid=False: {result['errors']}"
    assert result["nodes_verified"] >= 1,       f"nodes_verified={result['nodes_verified']}"
    assert result["errors"] == [],              f"unexpected errors: {result['errors']}"
