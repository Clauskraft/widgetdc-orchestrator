"""
mrp_engine.py — MRP (Minimum Redundancy Placement) Engine (Phase 2)

Groups agents by capability × geo, calculates validity scores, and
materialises PhantomCluster nodes in Neo4j.

Validity score formula:
  0.4 × avg_confidence
+ 0.3 × min(agent_count / 4, 1.0)   ← redundancy factor
+ 0.2 × avg_uptime                   ← stability (defaults 0.8 if not set)
+ 0.1 × compliance_weight            ← 1.0 for EU, 0.7 otherwise

Environment variables:
  NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
"""

import os
import sys
from neo4j import GraphDatabase


class MRPEngine:
    def __init__(self):
        uri      = os.environ.get("NEO4J_URI",      "bolt://localhost:7687")
        user     = os.environ.get("NEO4J_USER",     "neo4j")
        password = os.environ.get("NEO4J_PASSWORD", "")
        if not password:
            print("❌ NEO4J_PASSWORD not set.")
            sys.exit(1)
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def recalculate_clusters(self) -> int:
        """
        Scans agents, groups by (capability, geo), calculates validity scores,
        and creates/updates PhantomCluster nodes.

        Returns the number of clusters created or updated.
        """
        with self.driver.session() as session:
            # UNWIND capabilities first so we can group by (cap, geo) cleanly.
            # avg() and collect() run in the same aggregation step — no scope issue.
            result = session.run("""
                MATCH (a:Agent)
                UNWIND a.capabilities AS cap
                WITH cap,
                     a.sov_data_residency               AS geo,
                     collect(a.agent_id)                AS agent_ids,
                     count(a)                           AS agent_count,
                     avg(a.confidence_score)            AS avg_conf,
                     avg(coalesce(a.uptime_30d, 0.8))   AS avg_uptime
                WHERE agent_count >= 1
                RETURN cap, geo, agent_ids, agent_count, avg_conf, avg_uptime
            """)

            cluster_count = 0
            for record in result:
                cap         = record["cap"]
                geo         = record["geo"]
                agent_ids   = record["agent_ids"]
                agent_count = record["agent_count"]
                avg_conf    = record["avg_conf"] or 0.5
                avg_uptime  = record["avg_uptime"] or 0.8

                # Validity score (0 – 1)
                min_agents_factor  = min(agent_count / 4.0, 1.0)
                compliance_weight  = 1.0 if geo == "EU" else 0.7
                validity = round(
                    avg_conf        * 0.4 +
                    min_agents_factor * 0.3 +
                    avg_uptime      * 0.2 +
                    compliance_weight * 0.1,
                    3,
                )

                cluster_id = f"Cluster_{geo}_{cap.replace(' ', '_')}"

                # MERGE cluster and link agents (agent_id is our key, not external_id)
                session.run("""
                    MERGE (c:PhantomCluster {external_id: $cluster_id})
                    SET c.name               = $cluster_id,
                        c.validity_score     = $validity,
                        c.rule_capability    = $cap,
                        c.rule_geo           = $geo,
                        c.agent_count        = $agent_count,
                        c.last_recalculated  = datetime()
                    WITH c
                    UNWIND $agent_ids AS aid
                    MATCH (a:Agent {agent_id: aid})
                    MERGE (a)-[r:PART_OF]->(c)
                    ON CREATE SET r.joined_at = datetime()
                """, cluster_id=cluster_id, validity=validity, cap=cap,
                    geo=geo, agent_count=agent_count, agent_ids=agent_ids)

                cluster_count += 1
                print(f"   📊 {cluster_id}: validity={validity:.3f} agents={agent_count}")

        print(f"✅ MRP Engine: {cluster_count} cluster(s) recalculated.")
        return cluster_count

    def close(self):
        self.driver.close()


if __name__ == "__main__":
    engine = MRPEngine()
    try:
        engine.recalculate_clusters()
    finally:
        engine.close()
