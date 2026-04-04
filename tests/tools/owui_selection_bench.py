"""
Open WebUI Tool Selection Benchmark (SNOUT-CLOSE-02)
=====================================================

Measures gpt-4o's accuracy at selecting the correct tool for 30 representative
prompts across all 14 deployed tools.

Baseline captured before facade work begins. Re-run after docstring strengthening
(SNOUT-CLOSE-05) and after facade rollout (SNOUT-CLOSE-07) to prove improvement.

Usage:
    python tests/tools/owui_selection_bench.py [--model gpt-4o] [--save results.json]

Exit criteria:
- Baseline accuracy recorded in Linear comment
- JSON output for diff-able comparison across runs
"""
import json
import sys
import time
import urllib.request
import urllib.error
import concurrent.futures
from datetime import datetime, timezone

OWUI = "https://open-webui-production-25cb.up.railway.app"
EMAIL = "clauskraft@gmail.com"
PASSWORD = "WidgeTDC-2026!"

# ─────────────────────────────────────────────────────────────
# 30-prompt benchmark matrix
# Each case: user prompt + expected tool ID(s) (first is primary)
# ─────────────────────────────────────────────────────────────
BENCHMARK = [
    # Category: Platform health (SITREP OS activate)
    {"id": 1, "cat": "platform", "prompt": "Show me the current platform health status", "expect": ["widgetdc_stitch_live", "widgetdc_graph_intel"]},
    {"id": 2, "cat": "platform", "prompt": "Er alt online og hvordan ser grafen ud?", "expect": ["widgetdc_stitch_live", "widgetdc_graph_intel"]},
    {"id": 3, "cat": "platform", "prompt": "Give me a SITREP on platform health", "expect": ["widgetdc_stitch_live"]},

    # Category: Compliance (SITREP OS activate)
    {"id": 4, "cat": "compliance", "prompt": "What are the current compliance risks?", "expect": ["widgetdc_stitch_live"]},
    {"id": 5, "cat": "compliance", "prompt": "Vis compliance scores for alle domæner", "expect": ["widgetdc_stitch_live"]},
    {"id": 6, "cat": "compliance", "prompt": "Any NIS2 or GDPR gaps I should know about?", "expect": ["widgetdc_stitch_live", "widgetdc_intelligence_suite"]},

    # Category: Linear/Sprint (SITREP OS activate or linear_intel)
    {"id": 7, "cat": "sprint", "prompt": "Show me urgent Linear blockers", "expect": ["widgetdc_stitch_live", "widgetdc_linear_intel"]},
    {"id": 8, "cat": "sprint", "prompt": "What's the sprint status - what's in progress?", "expect": ["widgetdc_stitch_live", "widgetdc_linear_intel"]},
    {"id": 9, "cat": "sprint", "prompt": "List tickets assigned to me this week", "expect": ["widgetdc_linear_intel", "widgetdc_stitch_live"]},

    # Category: Monday email (SITREP OS monday_email)
    {"id": 10, "cat": "email", "prompt": "Generate a Monday morning status email for the platform team", "expect": ["widgetdc_stitch_live"]},
    {"id": 11, "cat": "email", "prompt": "I need a weekly status email for my manager", "expect": ["widgetdc_stitch_live"]},
    {"id": 12, "cat": "email", "prompt": "Draft my Monday team update", "expect": ["widgetdc_stitch_live"]},

    # Category: Graph queries (graph_intel or graph_navigator)
    {"id": 13, "cat": "graph", "prompt": "Run graph hygiene and show any orphan nodes", "expect": ["widgetdc_graph_intel"]},
    {"id": 14, "cat": "graph", "prompt": "Search knowledge graph for 'compliance patterns'", "expect": ["widgetdc_graph_intel", "widgetdc_graph_navigator"]},
    {"id": 15, "cat": "graph", "prompt": "How many nodes and relationships does Neo4j have?", "expect": ["widgetdc_stitch_live", "widgetdc_graph_intel"]},

    # Category: CVE/Security (SITREP OS activate)
    {"id": 16, "cat": "security", "prompt": "Show me critical CVEs from the last week", "expect": ["widgetdc_stitch_live"]},
    {"id": 17, "cat": "security", "prompt": "Security posture overview", "expect": ["widgetdc_stitch_live"]},

    # Category: Compiler stats (SITREP OS compiler_stats)
    {"id": 18, "cat": "compiler", "prompt": "What patterns has the domain compiler learned?", "expect": ["widgetdc_stitch_live"]},
    {"id": 19, "cat": "compiler", "prompt": "Show compiler memory stats", "expect": ["widgetdc_stitch_live"]},

    # Category: Agents (SITREP OS activate)
    {"id": 20, "cat": "agents", "prompt": "Which agents are currently online?", "expect": ["widgetdc_stitch_live"]},
    {"id": 21, "cat": "agents", "prompt": "List active agents and their roles", "expect": ["widgetdc_stitch_live"]},

    # Category: Obsidian (obsidian_bridge)
    {"id": 22, "cat": "obsidian", "prompt": "Search my Obsidian vault for notes about SNOUT architecture", "expect": ["widgetdc_obsidian_bridge"]},
    {"id": 23, "cat": "obsidian", "prompt": "Write a note to Obsidian with today's decisions", "expect": ["widgetdc_obsidian_bridge"]},
    {"id": 24, "cat": "obsidian", "prompt": "Generate today's daily briefing from Obsidian", "expect": ["widgetdc_obsidian_bridge"]},

    # Category: Mercury fold (mercury_fold)
    {"id": 25, "cat": "fold", "prompt": "Fold this long document to 500 tokens preserving key info", "expect": ["widgetdc_mercury_fold"]},

    # Category: Intelligence Suite (intelligence_suite)
    {"id": 26, "cat": "intel", "prompt": "Give me proactive notifications about recent failures", "expect": ["widgetdc_intelligence_suite", "widgetdc_stitch_live"]},
    {"id": 27, "cat": "intel", "prompt": "Run failure analysis on the last 24 hours", "expect": ["widgetdc_intelligence_suite", "widgetdc_stitch_live"]},

    # Category: MCP tool discovery (mcp_gateway)
    {"id": 28, "cat": "mcp", "prompt": "List all available MCP tools in the backend", "expect": ["widgetdc_mcp_gateway"]},

    # Category: Chitchat (no tool should be called)
    {"id": 29, "cat": "chitchat", "prompt": "What is 2 + 2?", "expect": ["NO_TOOL"]},
    {"id": 30, "cat": "chitchat", "prompt": "Hej, hvem er du?", "expect": ["NO_TOOL"]},
]


def login() -> str:
    """Authenticate and return JWT token."""
    req = urllib.request.Request(
        f"{OWUI}/api/v1/auths/signin",
        data=json.dumps({"email": EMAIL, "password": PASSWORD}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["token"]


def run_prompt(token: str, prompt: str, model: str = "gpt-4o", timeout: int = 90) -> dict:
    """Run a single prompt via Open WebUI chat API with all tools enabled.

    Returns: {tool_calls: list, content: str, latency_s: float, error: str|None}
    """
    # Get tool IDs first
    req = urllib.request.Request(
        f"{OWUI}/api/v1/tools/",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        tools = json.loads(r.read())
        tool_ids = [t["id"] for t in tools]

    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "tool_ids": tool_ids,
        "stream": False
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{OWUI}/api/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
            elapsed = time.time() - start

            # Extract sources (which tools were called)
            choice = data.get("choices", [{}])[0]
            sources = choice.get("sources", []) or data.get("sources", [])
            tool_calls = []
            for src in sources:
                if isinstance(src, dict):
                    meta = src.get("metadata", [])
                    if isinstance(meta, list):
                        for m in meta:
                            if isinstance(m, dict) and m.get("name"):
                                tool_calls.append(m["name"])
                    src_name = src.get("source", {}).get("name") if isinstance(src.get("source"), dict) else None
                    if src_name and src_name not in tool_calls:
                        tool_calls.append(src_name)

            content = choice.get("message", {}).get("content", "") or ""

            # Also check tool_calls field if present
            tc = choice.get("message", {}).get("tool_calls", [])
            for t in tc:
                name = t.get("function", {}).get("name") if isinstance(t, dict) else None
                if name and name not in tool_calls:
                    tool_calls.append(name)

            return {
                "tool_calls": tool_calls,
                "content": content[:300],
                "latency_s": round(elapsed, 2),
                "error": None
            }
    except urllib.error.HTTPError as e:
        return {"tool_calls": [], "content": "", "latency_s": time.time() - start, "error": f"HTTP {e.code}"}
    except Exception as e:
        return {"tool_calls": [], "content": "", "latency_s": time.time() - start, "error": str(e)[:200]}


def classify(result: dict, expected: list[str]) -> str:
    """Classify result as PASS/FAIL/PARTIAL/NO_CALL."""
    called = result.get("tool_calls", [])
    if expected == ["NO_TOOL"]:
        return "PASS" if not called else "FAIL_CALLED"
    if not called:
        return "NO_CALL"
    # Primary match
    if called[0] in expected or any(c in expected for c in called):
        return "PASS"
    return "FAIL_WRONG"


def main():
    print(f"=== Open WebUI Tool Selection Benchmark (SNOUT-CLOSE-02) ===")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print(f"Prompts: {len(BENCHMARK)}")
    print()

    token = login()
    print("[OK] Logged in")
    print()

    results = []
    for case in BENCHMARK:
        print(f"[{case['id']:2}/{len(BENCHMARK)}] ({case['cat']:10}) {case['prompt'][:60]}...")
        sys.stdout.flush()

        r = run_prompt(token, case["prompt"])
        verdict = classify(r, case["expect"])

        result_row = {
            "id": case["id"],
            "cat": case["cat"],
            "prompt": case["prompt"],
            "expected": case["expect"],
            "called": r["tool_calls"],
            "verdict": verdict,
            "latency_s": r["latency_s"],
            "error": r["error"],
            "preview": r["content"][:150]
        }
        results.append(result_row)

        icon = "PASS" if verdict == "PASS" else "FAIL"
        called_str = ", ".join(r["tool_calls"][:2]) if r["tool_calls"] else "(no tool)"
        print(f"      -> {icon} | {r['latency_s']:.1f}s | called: {called_str}")

    # Summary
    print()
    print("=" * 60)
    print("=== SUMMARY ===")
    print("=" * 60)
    verdicts = {}
    cat_results = {}
    total_latency = 0.0
    for r in results:
        v = r["verdict"]
        verdicts[v] = verdicts.get(v, 0) + 1
        cat_results.setdefault(r["cat"], {"pass": 0, "total": 0})
        cat_results[r["cat"]]["total"] += 1
        if v == "PASS":
            cat_results[r["cat"]]["pass"] += 1
        total_latency += r["latency_s"]

    passed = verdicts.get("PASS", 0)
    total = len(results)
    accuracy = passed / total * 100 if total else 0

    print(f"Accuracy: {passed}/{total} ({accuracy:.1f}%)")
    print(f"Verdicts: {dict(sorted(verdicts.items()))}")
    print(f"Avg latency: {total_latency/total:.1f}s")
    print()
    print("Per category:")
    for cat, stats in sorted(cat_results.items()):
        pct = stats["pass"] / stats["total"] * 100 if stats["total"] else 0
        print(f"  {cat:12} {stats['pass']}/{stats['total']} ({pct:.0f}%)")

    # Save results
    output = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "version": "baseline",
        "model": "gpt-4o",
        "total": total,
        "passed": passed,
        "accuracy_pct": round(accuracy, 1),
        "avg_latency_s": round(total_latency / total, 2),
        "verdicts": dict(sorted(verdicts.items())),
        "per_category": cat_results,
        "results": results
    }

    out_path = "C:/Users/claus/AppData/Local/Temp/owui_bench_baseline.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print()
    print(f"Saved: {out_path}")

    return accuracy


if __name__ == "__main__":
    accuracy = main()
    sys.exit(0 if accuracy > 0 else 1)
