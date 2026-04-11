"""
router.py — Dynamic Sovereignty-Aware Router (Phase 2)

Selects the optimal PhantomCluster + Agent for a given request,
enforcing validity_score > 0.75 and cost constraints.

Usage:
  from router import DynamicRouter
  r = DynamicRouter()
  result = r.route_request(capability="reasoning", geo="EU", max_cost=0.00001)
  r.close()

Environment variables:
  NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
"""

import os
import sys
from neo4j import GraphDatabase


class DynamicRouter:
    def __init__(self):
        uri      = os.environ.get("NEO4J_URI",      "bolt://localhost:7687")
        user     = os.environ.get("NEO4J_USER",     "neo4j")
        password = os.environ.get("NEO4J_PASSWORD", "")
        if not password:
            print("❌ NEO4J_PASSWORD not set.")
            sys.exit(1)
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def route_request(
        self,
        capability: str,
        geo: str = "ANY",
        max_cost: float = 0.00001,
    ) -> dict:
        """
        Returns optimal agent + cluster + fallback.
        Enforces validity_score > 0.75 and pricing_input_per_1k <= max_cost.

        geo="ANY" bypasses geo filtering.
        """
        with self.driver.session() as session:
            # rule_capability is a scalar string per cluster — use equality, not IN
            geo_clause = "" if geo == "ANY" else "AND c.rule_geo = $geo"

            cypher = f"""
                MATCH (c:PhantomCluster)
                WHERE c.rule_capability = $cap
                  {geo_clause}
                  AND c.validity_score > 0.75
                WITH c
                MATCH (a:Agent)-[:PART_OF]->(c)
                WHERE a.pricing_input_per_1k <= $max_cost
                RETURN a.agent_id        AS agent_id,
                       a.pricing_input_per_1k AS cost,
                       c.external_id     AS cluster_id,
                       c.validity_score  AS cluster_score
                ORDER BY a.pricing_input_per_1k ASC
                LIMIT 3
            """

            result = session.run(cypher, cap=capability, geo=geo, max_cost=max_cost)
            candidates = list(result)

        if not candidates:
            # Try again without validity gate to give a useful diagnostic
            with self.driver.session() as session:
                diag = session.run("""
                    MATCH (c:PhantomCluster)
                    WHERE c.rule_capability = $cap
                    RETURN c.external_id AS cluster_id, c.validity_score AS score
                    LIMIT 5
                """, cap=capability)
                clusters = [dict(r) for r in diag]

            return {
                "status":  "NO_ROUTE",
                "reason":  f"No valid cluster for capability='{capability}' geo='{geo}' max_cost={max_cost}",
                "diagnostic_clusters": clusters,
            }

        primary  = dict(candidates[0])
        fallback = dict(candidates[1]) if len(candidates) > 1 else None

        return {
            "status":          "ROUTED",
            "primary":         primary,
            "fallback":        fallback,
            "constraints_met": {"capability": capability, "geo": geo, "max_cost": max_cost},
        }

    def close(self):
        self.driver.close()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="DynamicRouter — Sovereignty-Aware Agent Router")
    parser.add_argument(
        "--test-route",
        action="store_true",
        help="Test routing for given capability/geo and print result (exit 0 if ROUTED)",
    )
    parser.add_argument(
        "--capability",
        default="reasoning",
        metavar="CAP",
        help="Capability to route for (default: reasoning)",
    )
    parser.add_argument(
        "--geo",
        default="EU",
        metavar="GEO",
        help="Geo constraint: EU, CN, US, ANY (default: EU)",
    )
    parser.add_argument(
        "--max-cost",
        type=float,
        default=0.00001,
        metavar="COST",
        help="Max pricing_input_per_1k (default: 0.00001)",
    )
    args = parser.parse_args()

    # TEE_ENABLED=false → fallback mode (no TEE dependency, standard inference)
    tee_enabled = os.environ.get("TEE_ENABLED", "true").lower() not in ("false", "0", "no")
    if not tee_enabled:
        print("ℹ️  TEE_ENABLED=false — routing in standard (non-TEE) fallback mode")

    router = DynamicRouter()
    try:
        if args.test_route:
            result = router.route_request(args.capability, args.geo, args.max_cost)
            result["tee_mode"] = "TEE_ACTIVE" if tee_enabled else "TEE_DISABLED_FALLBACK"
            print(f"Route test ({args.capability}/{args.geo}): {result}")
            sys.exit(0 if result.get("status") == "ROUTED" else 1)

        # Default: two smoke-test routes
        result = router.route_request("reasoning", "EU", max_cost=0.00001)
        print("Router result (EU/reasoning):", result)

        result2 = router.route_request("math", "ANY", max_cost=0.00001)
        print("Router result (ANY/math):", result2)
    finally:
        router.close()
