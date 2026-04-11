"""
phase15_validation.py — Phase 1.5 Foundation Truth Validation Harness

Deterministic Cypher-based validation suite that runs 15 checks against the
live Neo4j AuraDB instance and produces a PASS/FAIL report with a gate
decision (GO / GO_WITH_FIXES / NO_GO).

Owned by: claude-spor (Control & Gate)
Consumed by: coord-claude-qwen-linear-backlog-2026-04-11
Upstream dependency: Qwen-spor steps pre-0 → 3 (schema deploy → Fantom seeds
                     → materialization → Snout draft generation)

Usage:
  # Full report (after all Qwen steps complete)
  python phase15_validation.py

  # Subset mode — only run specific check groups as Qwen ships each step
  python phase15_validation.py --subset schema       # after pre-step 0
  python phase15_validation.py --subset phantoms     # after step 1
  python phase15_validation.py --subset routing      # after step 2
  python phase15_validation.py --subset evidence     # after step 3

  # Output only (no exit on failure) — useful in interactive sessions
  python phase15_validation.py --no-exit

Environment variables:
  NEO4J_URI      = neo4j+s://<host>.databases.neo4j.io
  NEO4J_USER     = neo4j
  NEO4J_PASSWORD = <password>

Exit codes:
  0 = GO              (all 15 checks PASS)
  1 = GO_WITH_FIXES   (non-critical failures; proceed with remediation plan)
  2 = NO_GO           (any critical check [C1.1, C1.2, C4.3, C6.2] FAIL)

Report output:
  results/phase15_report_{ISO8601}.json
  results/phase15_report_{ISO8601}.md
"""

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from neo4j import GraphDatabase


# ── Config ────────────────────────────────────────────────────────────────────

REQUIRED_CONSTRAINTS = {
    "agent_ext_id_unique",
    "evidence_ext_id_unique",
    "cluster_ext_id_unique",
}

REQUIRED_INDEXES = {
    "agent_capability_idx",
    "evidence_verification_idx",
    "evidence_hash_idx",
}

CRITICAL_CHECK_IDS = {"C1.1", "C1.2", "C4.3", "C6.2"}

AGENTIC_KIT_DIR = Path(__file__).resolve().parent
RESULTS_DIR = AGENTIC_KIT_DIR / "results"


# ── Check Result Dataclass ────────────────────────────────────────────────────


@dataclass
class CheckResult:
    id: str
    name: str
    group: str
    status: str  # "PASS" | "FAIL" | "SKIP" | "ERROR"
    critical: bool
    details: str = ""
    observed: dict = field(default_factory=dict)
    error: Optional[str] = None


# ── Check Runner ──────────────────────────────────────────────────────────────


class Phase15Validator:
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.neo4j_uri = uri
        self.results: list[CheckResult] = []

    def close(self):
        self.driver.close()

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _query_scalar(self, cypher: str, **params) -> any:
        with self.driver.session() as session:
            record = session.run(cypher, **params).single()
            if record is None:
                return None
            return record[0]

    def _query_all(self, cypher: str, **params) -> list[dict]:
        with self.driver.session() as session:
            return [dict(r) for r in session.run(cypher, **params)]

    def _record(self, check: CheckResult):
        self.results.append(check)
        sym = {"PASS": "✅", "FAIL": "❌", "SKIP": "⏭️", "ERROR": "⚠️"}[check.status]
        crit = " [CRITICAL]" if check.critical else ""
        print(f"{sym} {check.id} {check.name}{crit}: {check.status} — {check.details}")

    def _run_safe(self, check_id: str, name: str, group: str, critical: bool, fn: Callable):
        """Run a check function, trapping exceptions as ERROR status."""
        try:
            fn(check_id, name, group, critical)
        except Exception as e:
            self._record(CheckResult(
                id=check_id, name=name, group=group,
                status="ERROR", critical=critical,
                details=f"exception: {type(e).__name__}",
                error=str(e),
            ))

    # ── C1: Schema ───────────────────────────────────────────────────────────

    def check_c1_1_constraints(self, cid: str, name: str, group: str, critical: bool):
        rows = self._query_all("SHOW CONSTRAINTS")
        found = {r.get("name") for r in rows}
        missing = REQUIRED_CONSTRAINTS - found
        status = "PASS" if not missing else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{len(REQUIRED_CONSTRAINTS - missing)}/{len(REQUIRED_CONSTRAINTS)} required constraints present",
            observed={"found": sorted(found & REQUIRED_CONSTRAINTS), "missing": sorted(missing)},
        ))

    def check_c1_2_indexes(self, cid: str, name: str, group: str, critical: bool):
        rows = self._query_all("SHOW INDEXES")
        found = {r.get("name") for r in rows}
        missing = REQUIRED_INDEXES - found
        status = "PASS" if not missing else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{len(REQUIRED_INDEXES - missing)}/{len(REQUIRED_INDEXES)} required indexes present",
            observed={"found": sorted(found & REQUIRED_INDEXES), "missing": sorted(missing)},
        ))

    # ── C2: Agent Nodes ──────────────────────────────────────────────────────

    def check_c2_1_sovereignty(self, cid: str, name: str, group: str, critical: bool):
        null_count = self._query_scalar("""
            MATCH (a:Agent)
            WHERE a.sov_data_residency IS NULL
            RETURN count(a)
        """)
        total = self._query_scalar("MATCH (a:Agent) RETURN count(a)")
        status = "PASS" if (null_count or 0) == 0 and (total or 0) > 0 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{total} agents, {null_count} missing sov_data_residency",
            observed={"total_agents": total, "missing_sovereignty": null_count},
        ))

    def check_c2_2_external_id(self, cid: str, name: str, group: str, critical: bool):
        null_count = self._query_scalar("""
            MATCH (a:Agent)
            WHERE a.external_id IS NULL
            RETURN count(a)
        """)
        total = self._query_scalar("MATCH (a:Agent) RETURN count(a)")
        status = "PASS" if (null_count or 0) == 0 and (total or 0) > 0 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{total} agents, {null_count} missing external_id",
            observed={"total_agents": total, "missing_external_id": null_count},
        ))

    # ── C3: Phantom Clusters ─────────────────────────────────────────────────

    def check_c3_1_phantom_count(self, cid: str, name: str, group: str, critical: bool):
        count = self._query_scalar("MATCH (c:PhantomCluster) RETURN count(c)") or 0
        status = "PASS" if count >= 3 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{count} PhantomCluster nodes (min 3 required for reference fantoms)",
            observed={"phantom_cluster_count": count},
        ))

    def check_c3_2_validity_populated(self, cid: str, name: str, group: str, critical: bool):
        null_count = self._query_scalar("""
            MATCH (c:PhantomCluster)
            WHERE c.validity_score IS NULL
            RETURN count(c)
        """) or 0
        total = self._query_scalar("MATCH (c:PhantomCluster) RETURN count(c)") or 0
        status = "PASS" if null_count == 0 and total >= 3 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{total} clusters, {null_count} missing validity_score",
            observed={"total_clusters": total, "missing_validity": null_count},
        ))

    def check_c3_3_cluster_type(self, cid: str, name: str, group: str, critical: bool):
        total = self._query_scalar("MATCH (c:PhantomCluster) RETURN count(c)") or 0
        typed = self._query_scalar("""
            MATCH (c:PhantomCluster {type: 'Fantom_Assembly'})
            RETURN count(c)
        """) or 0
        status = "PASS" if total > 0 and typed == total else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{typed}/{total} clusters have type='Fantom_Assembly'",
            observed={"total_clusters": total, "typed_clusters": typed},
        ))

    # ── C4: Evidence Chain ───────────────────────────────────────────────────

    def check_c4_1_payload_hash(self, cid: str, name: str, group: str, critical: bool):
        null_count = self._query_scalar("""
            MATCH (e:EvidenceObject)
            WHERE e.payload_hash IS NULL
            RETURN count(e)
        """) or 0
        total = self._query_scalar("MATCH (e:EvidenceObject) RETURN count(e)") or 0
        status = "PASS" if null_count == 0 and total > 0 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{total} evidence objects, {null_count} missing payload_hash",
            observed={"total_evidence": total, "missing_hash": null_count},
        ))

    def check_c4_2_next_in_chain(self, cid: str, name: str, group: str, critical: bool):
        count = self._query_scalar("MATCH ()-[r:NEXT_IN_CHAIN]->() RETURN count(r)") or 0
        status = "PASS" if count >= 1 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{count} NEXT_IN_CHAIN relationships",
            observed={"chain_relation_count": count},
        ))

    def check_c4_3_chain_integrity(self, cid: str, name: str, group: str, critical: bool):
        """
        Verify hash chain integrity. For each root (no incoming NEXT_IN_CHAIN),
        walk forward and check every node's previous_hash matches the predecessor's
        payload_hash.
        """
        roots = self._query_all("""
            MATCH (e:EvidenceObject)
            WHERE NOT ( ()-[:NEXT_IN_CHAIN]->(e) )
            RETURN e.external_id AS id, e.payload_hash AS hash
        """)
        if not roots:
            self._record(CheckResult(
                id=cid, name=name, group=group, status="FAIL", critical=critical,
                details="no evidence chain roots found",
                observed={"roots": 0},
            ))
            return

        broken_chains: list[dict] = []
        total_links_checked = 0

        for root in roots:
            walk = self._query_all("""
                MATCH path = (root:EvidenceObject {external_id: $root_id})-[:NEXT_IN_CHAIN*0..]->(e:EvidenceObject)
                WITH e, length(path) AS depth
                ORDER BY depth
                RETURN e.external_id AS id, e.payload_hash AS payload_hash,
                       e.previous_hash AS previous_hash, depth
            """, root_id=root["id"])

            prev_hash = None
            for node in walk:
                if node["depth"] == 0:
                    if node["previous_hash"] is not None:
                        broken_chains.append({
                            "root": root["id"],
                            "node": node["id"],
                            "reason": "root has non-null previous_hash",
                        })
                else:
                    total_links_checked += 1
                    if node["previous_hash"] != prev_hash:
                        broken_chains.append({
                            "root": root["id"],
                            "node": node["id"],
                            "expected": prev_hash,
                            "actual": node["previous_hash"],
                        })
                prev_hash = node["payload_hash"]

        status = "PASS" if not broken_chains and total_links_checked >= 1 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{len(roots)} roots, {total_links_checked} links checked, {len(broken_chains)} broken",
            observed={
                "roots": len(roots),
                "links_checked": total_links_checked,
                "broken_chains": broken_chains[:10],  # truncate
            },
        ))

    def check_c4_4_evidence_for(self, cid: str, name: str, group: str, critical: bool):
        count = self._query_scalar("MATCH ()-[r:EVIDENCE_FOR]->() RETURN count(r)") or 0
        status = "PASS" if count >= 1 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{count} EVIDENCE_FOR relationships",
            observed={"evidence_for_count": count},
        ))

    # ── C5: Code Hygiene (filesystem checks, no Neo4j) ───────────────────────

    def check_c5_1_no_id_usage(self, cid: str, name: str, group: str, critical: bool):
        """Grep for `id(` in app code (not matching `external_id`)."""
        pattern = re.compile(r"(?<!external_)id\(\s*[a-zA-Z_]")
        hits: list[str] = []
        for py_file in AGENTIC_KIT_DIR.glob("*.py"):
            try:
                content = py_file.read_text(encoding="utf-8", errors="replace")
                for i, line in enumerate(content.splitlines(), 1):
                    if pattern.search(line) and not line.strip().startswith("#"):
                        # Skip false positives: builtin id() function on objects
                        if "id(self" in line or "id(obj" in line or "MATCH" in line.upper() or "CYPHER" in line.upper():
                            continue
                        hits.append(f"{py_file.name}:{i}")
            except Exception:
                continue

        status = "PASS" if not hits else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{len(hits)} occurrences of id() usage (should be 0)",
            observed={"hits": hits[:20]},
        ))

    def check_c5_2_no_hardcoded_creds(self, cid: str, name: str, group: str, critical: bool):
        """Grep for hardcoded Neo4j passwords."""
        suspicious = re.compile(r'(?:NEO4J_PASSWORD|password)\s*=\s*["\'](?!["\']|\$|\{|<)[^"\']{4,}["\']', re.IGNORECASE)
        hits: list[str] = []
        for py_file in AGENTIC_KIT_DIR.glob("*.py"):
            try:
                content = py_file.read_text(encoding="utf-8", errors="replace")
                for i, line in enumerate(content.splitlines(), 1):
                    if suspicious.search(line) and "os.environ" not in line and "getenv" not in line:
                        hits.append(f"{py_file.name}:{i}")
            except Exception:
                continue

        status = "PASS" if not hits else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{len(hits)} suspicious hardcoded credentials (should be 0)",
            observed={"hits": hits[:20]},
        ))

    # ── C6: Runtime ──────────────────────────────────────────────────────────

    def check_c6_1_agent_cluster_links(self, cid: str, name: str, group: str, critical: bool):
        count = self._query_scalar("""
            MATCH (a:Agent)-[:PART_OF]->(c:PhantomCluster)
            RETURN count(*)
        """) or 0
        status = "PASS" if count >= 3 else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"{count} Agent-[:PART_OF]->PhantomCluster links (min 3)",
            observed={"link_count": count},
        ))

    def check_c6_2_router_smoke(self, cid: str, name: str, group: str, critical: bool):
        """
        Invoke DynamicRouter.route_request(reasoning, EU) and expect ROUTED.
        Import locally to avoid hard dependency if router.py is being rewritten.
        """
        try:
            from router import DynamicRouter  # type: ignore
        except ImportError as e:
            self._record(CheckResult(
                id=cid, name=name, group=group, status="ERROR", critical=critical,
                details="router.py not importable",
                error=str(e),
            ))
            return

        router = DynamicRouter()
        try:
            result = router.route_request("reasoning", "EU", max_cost=0.00001)
        finally:
            router.close()

        routed = result.get("status") == "ROUTED"
        status = "PASS" if routed else "FAIL"
        self._record(CheckResult(
            id=cid, name=name, group=group, status=status, critical=critical,
            details=f"route_request(reasoning, EU) → {result.get('status')}",
            observed={
                "router_status": result.get("status"),
                "primary": result.get("primary"),
                "reason": result.get("reason"),
            },
        ))

    # ── Check Registry ────────────────────────────────────────────────────────

    def all_checks(self) -> list[tuple]:
        """Return (id, name, group, critical, fn) tuples for all 15 checks."""
        return [
            ("C1.1", "Schema constraints",                    "schema",   True,  self.check_c1_1_constraints),
            ("C1.2", "Schema indexes",                        "schema",   True,  self.check_c1_2_indexes),
            ("C2.1", "Agent sovereignty populated",           "agents",   False, self.check_c2_1_sovereignty),
            ("C2.2", "Agent external_id populated",           "agents",   False, self.check_c2_2_external_id),
            ("C3.1", "PhantomCluster count ≥ 3",              "phantoms", False, self.check_c3_1_phantom_count),
            ("C3.2", "PhantomCluster validity_score set",     "phantoms", False, self.check_c3_2_validity_populated),
            ("C3.3", "PhantomCluster type = Fantom_Assembly", "phantoms", False, self.check_c3_3_cluster_type),
            ("C4.1", "EvidenceObject payload_hash set",       "evidence", False, self.check_c4_1_payload_hash),
            ("C4.2", "NEXT_IN_CHAIN relation exists",         "evidence", False, self.check_c4_2_next_in_chain),
            ("C4.3", "Hash chain integrity",                  "evidence", True,  self.check_c4_3_chain_integrity),
            ("C4.4", "EVIDENCE_FOR relation exists",          "evidence", False, self.check_c4_4_evidence_for),
            ("C5.1", "No id() usage in app code",             "hygiene",  False, self.check_c5_1_no_id_usage),
            ("C5.2", "No hardcoded Neo4j credentials",        "hygiene",  False, self.check_c5_2_no_hardcoded_creds),
            ("C6.1", "Agent → PhantomCluster links",          "routing",  False, self.check_c6_1_agent_cluster_links),
            ("C6.2", "Router EU reasoning smoke test",        "routing",  True,  self.check_c6_2_router_smoke),
        ]

    def run(self, subset: Optional[str] = None):
        """Run all checks, or a subset group."""
        checks = self.all_checks()
        if subset:
            if subset == "schema":
                groups = {"schema", "hygiene"}
            elif subset == "phantoms":
                groups = {"phantoms"}
            elif subset == "routing":
                groups = {"routing"}
            elif subset == "evidence":
                groups = {"evidence"}
            elif subset == "agents":
                groups = {"agents"}
            else:
                raise ValueError(f"Unknown subset: {subset}")
            checks = [c for c in checks if c[2] in groups]
            print(f"🔍 Subset mode: {subset} → {len(checks)} checks\n")

        print(f"=== Phase 1.5 Validation — {len(checks)} checks ===\n")
        for cid, cname, grp, crit, fn in checks:
            self._run_safe(cid, cname, grp, crit, fn)

        print()


# ── Report Generation ─────────────────────────────────────────────────────────


def make_gate_decision(results: list[CheckResult]) -> tuple[str, int]:
    """
    Decide gate status based on check results.

    Returns: (decision, exit_code)
      - "GO" / 0             : all PASS
      - "GO_WITH_FIXES" / 1  : some FAIL but none critical
      - "NO_GO" / 2          : any critical check FAIL or ERROR
    """
    critical_failures = [
        r for r in results
        if r.critical and r.status in ("FAIL", "ERROR")
    ]
    non_critical_failures = [
        r for r in results
        if not r.critical and r.status in ("FAIL", "ERROR")
    ]

    if critical_failures:
        return "NO_GO", 2
    if non_critical_failures:
        return "GO_WITH_FIXES", 1
    return "GO", 0


def generate_json_report(
    results: list[CheckResult],
    decision: str,
    subset: Optional[str],
    neo4j_uri: str,
) -> dict:
    return {
        "$id": "phase15-validation-report",
        "$schema": "https://widgetdc.io/schemas/phase15-report/v1",
        "phase": "1.5",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "subset": subset or "full",
        "neo4j_uri_masked": _mask_uri(neo4j_uri),
        "overall_status": "PASS" if decision == "GO" else "FAIL",
        "gate_decision": decision,
        "total_checks": len(results),
        "pass_count": sum(1 for r in results if r.status == "PASS"),
        "fail_count": sum(1 for r in results if r.status == "FAIL"),
        "skip_count": sum(1 for r in results if r.status == "SKIP"),
        "error_count": sum(1 for r in results if r.status == "ERROR"),
        "critical_failures": [
            asdict(r) for r in results if r.critical and r.status in ("FAIL", "ERROR")
        ],
        "checks": [asdict(r) for r in results],
    }


def generate_markdown_report(report: dict) -> str:
    decision = report["gate_decision"]
    emoji = {"GO": "🟢", "GO_WITH_FIXES": "🟡", "NO_GO": "🔴"}[decision]

    lines = [
        f"# Phase 1.5 Validation Report",
        "",
        f"**Gate Decision:** {emoji} **{decision}**",
        f"**Timestamp:** {report['timestamp']}",
        f"**Subset:** {report['subset']}",
        f"**Neo4j:** `{report['neo4j_uri_masked']}`",
        "",
        "## Summary",
        "",
        f"| Metric | Count |",
        f"|--------|-------|",
        f"| Total checks | {report['total_checks']} |",
        f"| PASS | {report['pass_count']} |",
        f"| FAIL | {report['fail_count']} |",
        f"| ERROR | {report['error_count']} |",
        f"| SKIP | {report['skip_count']} |",
        "",
        "## Check Results",
        "",
        "| ID | Name | Group | Critical | Status | Details |",
        "|----|------|-------|----------|--------|---------|",
    ]

    for c in report["checks"]:
        sym = {"PASS": "✅", "FAIL": "❌", "SKIP": "⏭️", "ERROR": "⚠️"}[c["status"]]
        crit = "🔒" if c["critical"] else ""
        lines.append(
            f"| {c['id']} | {c['name']} | {c['group']} | {crit} | {sym} {c['status']} | {c['details']} |"
        )

    if report["critical_failures"]:
        lines += ["", "## 🔴 Critical Failures", ""]
        for cf in report["critical_failures"]:
            lines.append(f"- **{cf['id']} {cf['name']}**: {cf['details']}")
            if cf.get("error"):
                lines.append(f"  - error: `{cf['error']}`")

    lines += [
        "",
        "## Gate Decision Logic",
        "",
        "- **GO** (exit 0): all 15 checks PASS",
        "- **GO_WITH_FIXES** (exit 1): non-critical failures only; proceed with remediation",
        "- **NO_GO** (exit 2): any critical check [C1.1, C1.2, C4.3, C6.2] FAIL or ERROR",
        "",
    ]

    return "\n".join(lines)


def _mask_uri(uri: str) -> str:
    """Redact credentials in URI for audit logs."""
    return re.sub(r"://[^@]*@", "://***:***@", uri)


def write_reports(report: dict, md: str) -> tuple[Path, Path]:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = report["timestamp"].replace(":", "-").replace("+00:00", "Z")
    json_path = RESULTS_DIR / f"phase15_report_{ts}.json"
    md_path = RESULTS_DIR / f"phase15_report_{ts}.md"
    json_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    md_path.write_text(md, encoding="utf-8")
    return json_path, md_path


# ── Main ──────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 1.5 Foundation Truth Validation")
    parser.add_argument(
        "--subset",
        choices=["schema", "agents", "phantoms", "evidence", "hygiene", "routing"],
        help="Run only checks for a specific group (default: all)",
    )
    parser.add_argument(
        "--no-exit",
        action="store_true",
        help="Do not exit with non-zero code on failure (useful for interactive runs)",
    )
    args = parser.parse_args()

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "")

    if not password:
        print("❌ NEO4J_PASSWORD not set. Export it first:", file=sys.stderr)
        print("   export NEO4J_PASSWORD='<your-password>'", file=sys.stderr)
        return 2

    validator = Phase15Validator(uri, user, password)
    try:
        validator.run(subset=args.subset)
    finally:
        validator.close()

    decision, exit_code = make_gate_decision(validator.results)
    report = generate_json_report(validator.results, decision, args.subset, uri)
    md = generate_markdown_report(report)

    json_path, md_path = write_reports(report, md)

    print(f"=== Gate Decision: {decision} ===")
    print(f"   Report (JSON): {json_path}")
    print(f"   Report (MD):   {md_path}")

    if args.no_exit:
        return 0
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
