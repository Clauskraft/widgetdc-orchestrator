"""C6 — Idempotency (ADR-002)"""
import pytest


def test_c6_mrp_idempotent(mrp):
    """C6: Running MRP Engine twice produces same cluster count (no duplicates)."""
    count1 = mrp.recalculate_clusters()
    count2 = mrp.recalculate_clusters()
    assert count1 == count2, (
        f"MRP not idempotent: first run={count1} clusters, second run={count2} clusters. "
        "Likely duplicate [:PART_OF] relationships being created."
    )
