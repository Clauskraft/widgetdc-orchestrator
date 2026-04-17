"""
Open WebUI tool deployer.

Upserts `owui-tools/*.json` definitions into a live Open WebUI instance.
Uses env vars for auth and optional bearer substitution so secrets are not
committed into tool JSON.

Usage:
    OWUI_EMAIL=... OWUI_PASSWORD=... python scripts/deploy_owui_tool.py
    python scripts/deploy_owui_tool.py --path owui-tools/engagement-intel.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

OWUI_URL = os.environ.get("OWUI_URL", "https://open-webui-production-25cb.up.railway.app")
OWUI_EMAIL = os.environ.get("OWUI_EMAIL", "")
OWUI_PASSWORD = os.environ.get("OWUI_PASSWORD", "")
OWUI_TOKEN = os.environ.get("OWUI_TOKEN", "")
ORCHESTRATOR_BEARER = os.environ.get("ORCHESTRATOR_BEARER", "")
DEFAULT_ROOT = Path(__file__).parent.parent / "owui-tools"

LEGACY_BEARERS = (
    "__ORCHESTRATOR_BEARER__",
    "WidgeTDC_Orch_2026",
    "Heravej_22",
)
TOOL_FIELDS = ("id", "name", "content", "meta")


def login() -> str:
    if OWUI_TOKEN:
        return OWUI_TOKEN
    if not OWUI_EMAIL or not OWUI_PASSWORD:
        raise RuntimeError("OWUI_EMAIL + OWUI_PASSWORD or OWUI_TOKEN are required")
    payload = json.dumps({"email": OWUI_EMAIL, "password": OWUI_PASSWORD}).encode()
    req = urllib.request.Request(
        f"{OWUI_URL}/api/v1/auths/signin",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())["token"]


def api_request(token: str, method: str, path: str, body: dict | None = None) -> tuple[int, dict | str]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{OWUI_URL}{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = raw
        return exc.code, payload


def load_definition(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not {"id", "name", "content", "meta"} <= set(data.keys()):
        raise RuntimeError(f"{path.name}: expected id/name/content/meta")
    content = data["content"]
    contains_placeholder = any(token in content for token in LEGACY_BEARERS)
    if contains_placeholder and not ORCHESTRATOR_BEARER:
        raise RuntimeError(
            f"{path.name}: ORCHESTRATOR_BEARER is required because the tool content contains a bearer placeholder"
        )
    if ORCHESTRATOR_BEARER:
        for legacy in LEGACY_BEARERS:
            content = content.replace(f"Bearer {legacy}", f"Bearer {ORCHESTRATOR_BEARER}")
            content = content.replace(legacy, ORCHESTRATOR_BEARER)
        data["content"] = content
    return data


def normalize_definition(data: dict | str) -> dict:
    if not isinstance(data, dict):
        return {}
    if isinstance(data.get("data"), dict):
        data = data["data"]
    return {field: data.get(field) for field in TOOL_FIELDS}


def is_subset_match(expected: object, actual: object) -> bool:
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return False
        return all(is_subset_match(value, actual.get(key)) for key, value in expected.items())
    if isinstance(expected, list):
        if not isinstance(actual, list) or len(expected) != len(actual):
            return False
        return all(is_subset_match(exp, act) for exp, act in zip(expected, actual))
    return expected == actual


def diff_definitions(expected: dict, actual: dict) -> list[str]:
    mismatches: list[str] = []
    for field in TOOL_FIELDS:
        if not is_subset_match(expected.get(field), actual.get(field)):
            mismatches.append(field)
    return mismatches


def collect_paths(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return sorted(target.glob("*.json"))


def upsert_definition(token: str, definition: dict) -> tuple[str, int, dict | str]:
    tool_id = definition["id"]
    status, _ = api_request(token, "GET", f"/api/v1/tools/id/{tool_id}")
    if status == 200:
        return "updated", *api_request(token, "POST", f"/api/v1/tools/id/{tool_id}/update", definition)
    if status == 404:
        return "created", *api_request(token, "POST", "/api/v1/tools/create", definition)
    return "probe_failed", status, {"detail": "unexpected probe status", "probe_status": status}


def verify_definition(token: str, definition: dict) -> tuple[bool, str]:
    tool_id = definition["id"]
    status, payload = api_request(token, "GET", f"/api/v1/tools/id/{tool_id}")
    if status != 200:
        return False, f"read-back probe returned HTTP {status}"

    expected = normalize_definition(definition)
    actual = normalize_definition(payload)
    mismatches = diff_definitions(expected, actual)
    if mismatches:
        return False, f"read-back mismatch in fields: {', '.join(mismatches)}"
    return True, "verified by read-back"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", default=str(DEFAULT_ROOT), help="JSON file or directory to deploy")
    parser.add_argument("--fail-fast", action="store_true", help="Stop on first failed upsert")
    args = parser.parse_args()

    target = Path(args.path)
    if not target.exists():
        print(f"Target not found: {target}", file=sys.stderr)
        return 2

    token = login()
    paths = collect_paths(target)
    if not paths:
        print(f"No JSON files found under: {target}", file=sys.stderr)
        return 2

    failures = 0
    for path in paths:
        definition = load_definition(path)
        action, status, payload = upsert_definition(token, definition)
        ok = 200 <= status < 300
        if not ok:
            print(f"[FAIL] {action} {definition['id']} ({path.name}) -> HTTP {status}")
            failures += 1
            print(json.dumps(payload, ensure_ascii=False)[:2000], file=sys.stderr)
            if args.fail_fast:
                return 1
            continue

        verified, verify_message = verify_definition(token, definition)
        marker = "OK" if verified else "FAIL"
        print(f"[{marker}] {action} {definition['id']} ({path.name}) -> HTTP {status} | {verify_message}")
        if not verified:
            failures += 1
            if args.fail_fast:
                return 1

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
