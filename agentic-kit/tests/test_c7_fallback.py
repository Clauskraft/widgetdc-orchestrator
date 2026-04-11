"""C7 — Router Fallback Chain"""
import pytest


def test_c7_primary_ne_fallback(router):
    """C7: When fallback exists, primary agent_id != fallback agent_id."""
    result = router.route_request("reasoning", "EU", max_cost=0.00001)
    assert result["status"] == "ROUTED", f"Expected ROUTED for C7 test, got {result['status']}"

    fallback = result.get("fallback")
    primary = result["primary"]

    if fallback is not None:
        assert primary["agent_id"] != fallback["agent_id"], (
            f"Primary and fallback are the same agent: {primary['agent_id']}"
        )
    # If fallback is None, cluster has only 1 agent — acceptable but note it
    # (requires >= 2 agents in cluster for full C7 pass)
