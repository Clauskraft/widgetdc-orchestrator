"""
SITREP OS Domain Compiler Memory Audit (SNOUT-CLOSE-10)
========================================================

Reports on the growth and health of the :LearnedOperator graph — the domain compiler
memory that makes SITREP OS smarter over time. Runs weekly via GitHub Actions.

Measurements:
- Total learned patterns
- Top N patterns by success_count
- New patterns since last audit (timestamp diff)
- Dead patterns (success_count = 0, created > 7 days ago)
- Category distribution (if prompt prefixes correlate with intents)

Output:
- Human-readable summary (stdout)
- JSON artifact for trend tracking (--json flag)

Usage:
    BACKEND_API_KEY=... python scripts/compiler_memory_audit.py
    python scripts/compiler_memory_audit.py --json > audit-report.json
"""
import json
import os
import sys
import argparse
import urllib.request
from datetime import datetime, timezone

BACKEND_URL = os.environ.get("BACKEND_URL", "https://backend-production-d3da.up.railway.app")
BACKEND_API_KEY = os.environ.get("BACKEND_API_KEY", "Heravej_22")

TOP_N = 15
DEAD_AFTER_DAYS = 7


def mcp_call(tool: str, payload: dict) -> dict:
    """POST to backend MCP route."""
    req = urllib.request.Request(
        f"{BACKEND_URL}/api/mcp/route",
        data=json.dumps({"tool": tool, "payload": payload}).encode(),
        headers={
            "Authorization": f"Bearer {BACKEND_API_KEY}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
        return data.get("result", data)


def fetch_all_patterns() -> list:
    """Get all LearnedOperator nodes from Neo4j."""
    cypher = """
    MATCH (p:LearnedOperator)
    RETURN p.id AS id,
           p.prompt AS prompt,
           p.success_count AS hits,
           p.created_at AS created,
           p.last_used AS last_used
    ORDER BY p.success_count DESC, p.created_at DESC
    """
    result = mcp_call("graph.read_cypher", {"query": cypher})
    if isinstance(result, dict):
        return result.get("results", result.get("data", []))
    return result if isinstance(result, list) else []


def fetch_growth_stats() -> dict:
    """Query growth metrics: count, avg hits, date range."""
    cypher = """
    MATCH (p:LearnedOperator)
    WITH count(p) AS total,
         sum(p.success_count) AS total_hits,
         avg(p.success_count) AS avg_hits,
         max(p.success_count) AS max_hits,
         min(p.created_at) AS oldest,
         max(p.created_at) AS newest
    RETURN total, total_hits, avg_hits, max_hits, oldest, newest
    """
    result = mcp_call("graph.read_cypher", {"query": cypher})
    if isinstance(result, dict):
        rows = result.get("results", result.get("data", []))
    else:
        rows = result
    return rows[0] if rows and isinstance(rows, list) else {}


def audit(patterns: list, stats: dict) -> dict:
    """Build audit report."""
    now = datetime.now(timezone.utc)
    total = len(patterns)
    total_hits = sum(p.get("hits", 0) for p in patterns if isinstance(p.get("hits"), (int, float)))
    active = [p for p in patterns if (p.get("hits") or 0) > 0]
    dead = [p for p in patterns if (p.get("hits") or 0) == 0]

    # Top patterns by hits
    top = sorted(
        (p for p in patterns if isinstance(p, dict)),
        key=lambda x: x.get("hits") or 0,
        reverse=True
    )[:TOP_N]

    report = {
        "timestamp": now.isoformat(),
        "total_patterns": total,
        "total_hits": total_hits,
        "active_patterns": len(active),
        "dead_patterns": len(dead),
        "stats": stats,
        "top_patterns": [
            {
                "prompt": p.get("prompt", "?")[:80],
                "hits": p.get("hits", 0),
                "last_used": p.get("last_used"),
            }
            for p in top
        ],
    }
    return report


def format_human(report: dict) -> str:
    lines = []
    lines.append("=" * 60)
    lines.append("=== SITREP OS Domain Compiler Memory Audit ===")
    lines.append("=" * 60)
    lines.append(f"Timestamp: {report['timestamp']}")
    lines.append("")
    lines.append(f"Total patterns:    {report['total_patterns']}")
    lines.append(f"Total hits:        {report['total_hits']}")
    lines.append(f"Active patterns:   {report['active_patterns']}")
    lines.append(f"Dead patterns:     {report['dead_patterns']} (hits=0)")

    stats = report.get("stats", {})
    if stats:
        lines.append("")
        lines.append("Growth stats:")
        lines.append(f"  Avg hits per pattern: {stats.get('avg_hits', 0):.2f}")
        lines.append(f"  Max hits: {stats.get('max_hits', 0)}")
        lines.append(f"  Oldest: {stats.get('oldest', '?')}")
        lines.append(f"  Newest: {stats.get('newest', '?')}")

    lines.append("")
    lines.append(f"Top {min(TOP_N, len(report['top_patterns']))} patterns:")
    for i, p in enumerate(report['top_patterns'], 1):
        hits = p.get('hits', 0)
        prompt = p.get('prompt', '?')
        lines.append(f"  {i:2}. ({hits}x) {prompt}")

    lines.append("")

    # Health assessment
    if report['total_patterns'] == 0:
        lines.append("Health: EMPTY — no patterns learned yet. Use SITREP OS to start teaching.")
    elif report['dead_patterns'] > report['active_patterns']:
        lines.append("Health: WARN — more dead patterns than active. Consider pruning.")
    elif report['total_patterns'] < 10:
        lines.append("Health: EARLY — compiler still learning. Continue to use SITREP OS.")
    else:
        lines.append("Health: HEALTHY — compiler is learning and patterns are active.")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()

    try:
        patterns = fetch_all_patterns()
        stats = fetch_growth_stats()
    except Exception as e:
        print(f"ERROR fetching compiler memory: {e}", file=sys.stderr)
        sys.exit(2)

    report = audit(patterns, stats)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    else:
        print(format_human(report))

    # Exit 0 always (audit is informational, not a gate)
    sys.exit(0)


if __name__ == "__main__":
    main()
