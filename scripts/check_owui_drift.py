"""
Open WebUI Tool Drift Checker (SNOUT-CLOSE-09)
==============================================

Compares widgetdc-orchestrator/owui-tools/*.json against Open WebUI production API state.
Detects:
  - Tools deployed in Open WebUI but NOT in git (untracked drift)
  - Tools in git but NOT deployed (missing deployment)
  - Tools where git content differs from deployed content (content drift)

Runs nightly via GitHub Actions (.github/workflows/owui-drift-check.yml).
Exits 0 on no drift, 1 on drift detected (fails CI/sends Slack alert).

Usage:
    OWUI_URL=https://... OWUI_TOKEN=... python scripts/check_owui_drift.py
    python scripts/check_owui_drift.py --json  # machine-readable output
"""
import json
import os
import sys
import argparse
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
from owui_sync_lib import (
    DEFERRED_PIPELINES,
    TOOL_FIELDS,
    api_request,
    build_pipeline_tool_definition,
    diff_fields,
    is_subset_match,
    load_json_tool_definition,
    normalize_definition,
)

OWUI_URL = os.environ.get("OWUI_URL", "https://open-webui-production-25cb.up.railway.app")
OWUI_EMAIL = os.environ.get("OWUI_EMAIL", "clauskraft@gmail.com")
OWUI_PASSWORD = os.environ.get("OWUI_PASSWORD", "")
OWUI_TOKEN = os.environ.get("OWUI_TOKEN", "")
OWUI_TOOLS_DIR = Path(__file__).parent.parent / "owui-tools"
OWUI_PIPELINES_DIR = Path(__file__).parent.parent / "pipelines"

# Tools that should be excluded from drift check (known experimental/prototype)
IGNORE_PREFIXES = ("exp_", "test_", "draft_")

def login() -> str:
    """Authenticate and return JWT token. Prefers OWUI_TOKEN env var."""
    if OWUI_TOKEN:
        return OWUI_TOKEN
    if not OWUI_PASSWORD:
        raise RuntimeError("OWUI_PASSWORD or OWUI_TOKEN env var required")
    req = urllib.request.Request(
        f"{OWUI_URL}/api/v1/auths/signin",
        data=json.dumps({"email": OWUI_EMAIL, "password": OWUI_PASSWORD}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())["token"]


def get_deployed_tools(token: str) -> dict:
    """Fetch all tools currently deployed in Open WebUI. Returns {id: tool_dict}."""
    req = urllib.request.Request(
        f"{OWUI_URL}/api/v1/tools/",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        tools = json.loads(r.read())
    return {t["id"]: t for t in tools}


def get_tool_detail(token: str, tool_id: str) -> dict:
    """Fetch full tool content from Open WebUI."""
    req = urllib.request.Request(
        f"{OWUI_URL}/api/v1/tools/id/{tool_id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def load_git_tools() -> dict:
    """Load all git-tracked tool sources. Returns {id: {file, data?}}.

    Scans both:
      - owui-tools/*.json (tool definitions)
      - pipelines/widgetdc_*.py (pipeline implementations, mapped via PIPELINE_TO_TOOL_ID)
    """
    tools = {}

    # owui-tools/*.json
    if OWUI_TOOLS_DIR.exists():
        for f in sorted(OWUI_TOOLS_DIR.glob("*.json")):
            try:
                data = load_json_tool_definition(f)
                tool_id = data["id"]
                if tool_id:
                    tools[tool_id] = {"file": f"owui-tools/{f.name}", "data": data, "source": "json"}
            except Exception as e:
                print(f"WARN: could not parse {f.name}: {e}", file=sys.stderr)

    # pipelines/widgetdc_*.py
    if OWUI_PIPELINES_DIR.exists():
        for f in sorted(OWUI_PIPELINES_DIR.glob("widgetdc_*.py")):
            try:
                data = build_pipeline_tool_definition(f)
            except Exception as e:
                print(f"WARN: could not parse {f.name}: {e}", file=sys.stderr)
                continue
            tool_id = data["id"]
            if tool_id not in tools:
                tools[tool_id] = {"file": f"pipelines/{f.name}", "data": data, "source": "pipeline"}

    return tools


def find_content_drift(token: str, deployed: dict, git_tracked: dict) -> list[str]:
    drift: list[str] = []
    shared_ids = sorted(set(deployed.keys()) & set(git_tracked.keys()))
    for tool_id in shared_ids:
        expected_data = git_tracked[tool_id].get("data")
        if not isinstance(expected_data, dict):
            continue

        actual_payload = deployed.get(tool_id)
        actual = normalize_definition(actual_payload, TOOL_FIELDS)

        # The list endpoint may not include full content. Fetch detail when needed.
        if not is_subset_match(expected_data.get("content"), actual.get("content")):
            status, detail = api_request(token, "GET", f"/api/v1/tools/id/{tool_id}")
            if status != 200:
                drift.append(tool_id)
                continue
            actual = normalize_definition(detail, TOOL_FIELDS)

        if diff_fields(expected_data, actual, TOOL_FIELDS):
            drift.append(tool_id)
    return drift


def analyze_drift(deployed: dict, git_tracked: dict, content_drift: list[str]) -> dict:
    """Compare deployed vs git. Returns drift report."""
    deployed_ids = set(deployed.keys())
    git_ids = set(git_tracked.keys())

    # Filter out experimental/test tools from drift detection
    def is_checked(tid: str) -> bool:
        return not tid.startswith(IGNORE_PREFIXES)

    tracked_deployed = {t for t in deployed_ids if is_checked(t)}

    # Deployed but not in git (drift: untracked)
    untracked = tracked_deployed - git_ids

    # In git but not deployed — split into drift vs intentional deferral
    missing_raw = git_ids - deployed_ids
    deferred = missing_raw & DEFERRED_PIPELINES
    missing_deployment = missing_raw - DEFERRED_PIPELINES

    # Experimental tools deployed (informational, not drift)
    experimental = {t for t in deployed_ids if t.startswith(IGNORE_PREFIXES)}

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "deployed_count": len(deployed_ids),
        "git_count": len(git_ids),
        "tracked_deployed_count": len(tracked_deployed),
        "experimental_deployed": sorted(experimental),
        "deferred_as_planned": sorted(deferred),
        "untracked_drift": sorted(untracked),
        "content_drift": sorted(content_drift),
        "missing_deployment": sorted(missing_deployment),
        "drift_detected": bool(untracked or missing_deployment or content_drift),
    }


def format_human(report: dict) -> str:
    lines = []
    lines.append("=" * 60)
    lines.append("=== Open WebUI Tool Drift Check ===")
    lines.append("=" * 60)
    lines.append(f"Timestamp: {report['timestamp']}")
    lines.append(f"Deployed tools:  {report['deployed_count']}")
    lines.append(f"Git-tracked:     {report['git_count']}")
    lines.append(f"Tracked deployed: {report['tracked_deployed_count']}")
    lines.append("")

    if report['experimental_deployed']:
        lines.append(f"ℹ  Experimental tools (ignored): {', '.join(report['experimental_deployed'])}")
        lines.append("")

    if report.get('deferred_as_planned'):
        lines.append(f"ℹ  Deferred as planned ({len(report['deferred_as_planned'])} pipelines):")
        for tid in report['deferred_as_planned']:
            lines.append(f"   - {tid} (see docs/DEFERRED_PIPELINES.md)")
        lines.append("")

    if report['untracked_drift']:
        lines.append(f"❌ DRIFT: {len(report['untracked_drift'])} tools deployed WITHOUT git source:")
        for tid in report['untracked_drift']:
            lines.append(f"   - {tid}")
        lines.append("")

    if report.get('content_drift'):
        lines.append(f"❌ CONTENT DRIFT: {len(report['content_drift'])} deployed tools differ from git source:")
        for tid in report['content_drift']:
            lines.append(f"   - {tid}")
        lines.append("")

    if report['missing_deployment']:
        lines.append(f"⚠  MISSING DEPLOYMENT: {len(report['missing_deployment'])} tools in git NOT deployed:")
        for tid in report['missing_deployment']:
            lines.append(f"   - {tid}")
        lines.append("")

    if not report['drift_detected']:
        lines.append("✅ NO DRIFT DETECTED")
        lines.append("All tracked deployed tools have git source.")
        lines.append("All git-tracked tools are deployed.")
    else:
        lines.append("❌ DRIFT DETECTED — CI gate failed.")
        lines.append("")
        lines.append("Remediation:")
        if report['untracked_drift']:
            lines.append("  For untracked_drift: export tool via API and commit to owui-tools/")
        if report.get('content_drift'):
            lines.append("  For content_drift: redeploy the git-tracked source and verify read-back")
        if report['missing_deployment']:
            lines.append("  For missing_deployment: deploy via scripts/deploy_owui_tool.py or delete from git")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Output JSON instead of human-readable")
    args = parser.parse_args()

    try:
        token = login()
    except Exception as e:
        print(f"LOGIN FAILED: {e}", file=sys.stderr)
        sys.exit(2)

    deployed = get_deployed_tools(token)
    git_tracked = load_git_tools()
    content_drift = find_content_drift(token, deployed, git_tracked)
    report = analyze_drift(deployed, git_tracked, content_drift)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(format_human(report))

    sys.exit(1 if report["drift_detected"] else 0)


if __name__ == "__main__":
    main()
