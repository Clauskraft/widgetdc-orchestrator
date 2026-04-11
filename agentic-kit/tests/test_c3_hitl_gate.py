"""C3 — HITL Gate Enforcement (ADR-004)"""
import pytest
from snout_ingestor import SnoutIngestor


@pytest.fixture(scope="module")
def ingestor(neo4j_creds):  # noqa: F811
    uri, user, pw = neo4j_creds
    s = SnoutIngestor(uri, user, pw)
    yield s
    s.close()


def test_c3_hitl_gate_blocks_low_confidence(ingestor, router):
    """C3: Agent with confidence=0.62 must NOT appear in router results after ingest."""
    # Ingest low-confidence agent (HITL threshold = 0.70)
    ingestor.ingest_agent(
        agent_id="test-hitl-c3",
        name="C3 HITL Test Agent",
        capabilities=["reasoning"],
        confidence_score=0.62,
        geo="EU",
    )

    # Router should not route to this agent (hitl_required=True blocks it)
    result = router.route_request("reasoning", "EU", max_cost=1.0)
    if result["status"] == "ROUTED":
        primary_id = result["primary"]["agent_id"]
        fallback_id = result.get("fallback", {}).get("agent_id") if result.get("fallback") else None
        assert primary_id != "test-hitl-c3",  "HITL-blocked agent appeared as primary"
        assert fallback_id != "test-hitl-c3", "HITL-blocked agent appeared as fallback"
    # NO_ROUTE is also acceptable (cluster may have no valid agents)
