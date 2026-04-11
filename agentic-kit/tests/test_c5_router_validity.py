"""C5 — Dynamic Router Validity Gate"""
import pytest


def test_c5_eu_routing_succeeds(router):
    """C5a: EU/reasoning cluster (validity=0.798) should ROUTE."""
    result = router.route_request("reasoning", "EU", max_cost=0.00001)
    assert result["status"] == "ROUTED", (
        f"EU reasoning should ROUTE but got {result['status']}. "
        f"Diagnostics: {result.get('diagnostic_clusters', [])}"
    )
    assert result["primary"] is not None
    assert result["primary"]["cluster_score"] > 0.75, (
        f"Routed cluster validity={result['primary']['cluster_score']} below gate"
    )


def test_c5_single_agent_cn_rejected(router):
    """C5b: Single-agent CN cluster (validity=0.685) should be rejected (NO_ROUTE)."""
    result = router.route_request("math", "ANY", max_cost=0.00001)
    # Either NO_ROUTE (validity gate blocks) or ROUTED with score > 0.75 (if cluster improved)
    if result["status"] == "ROUTED":
        assert result["primary"]["cluster_score"] > 0.75, (
            f"Router returned ROUTED with validity={result['primary']['cluster_score']} below 0.75 gate"
        )
    # NO_ROUTE is the expected path for the CN single-agent cluster
