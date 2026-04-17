"""
Open WebUI legacy tool cleanup.

Backs up selected live tools to a local JSON file, deletes them from the live
Open WebUI instance, and verifies they are gone with a read-back probe.

Usage:
    OWUI_EMAIL=... OWUI_PASSWORD=... python scripts/cleanup_owui_tools.py --ids a b c --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OWUI_URL = os.environ.get("OWUI_URL", "https://open-webui-production-25cb.up.railway.app")
OWUI_EMAIL = os.environ.get("OWUI_EMAIL", "")
OWUI_PASSWORD = os.environ.get("OWUI_PASSWORD", "")
OWUI_TOKEN = os.environ.get("OWUI_TOKEN", "")


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


def backup_tools(token: str, ids: list[str], backup_path: Path) -> None:
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "owui_url": OWUI_URL,
        "tools": [],
    }
    for tool_id in ids:
        status, data = api_request(token, "GET", f"/api/v1/tools/id/{tool_id}")
        payload["tools"].append(
            {
                "id": tool_id,
                "fetch_status": status,
                "data": data,
            }
        )
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def delete_tool(token: str, tool_id: str) -> tuple[bool, str]:
    status, payload = api_request(token, "DELETE", f"/api/v1/tools/id/{tool_id}/delete")
    if not (200 <= status < 300):
        return False, f"delete HTTP {status}: {payload}"
    verify_status, _ = api_request(token, "GET", f"/api/v1/tools/id/{tool_id}")
    if verify_status == 404:
        return True, "verified deleted"
    return False, f"delete returned {status}, but verify GET returned {verify_status}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ids", nargs="+", required=True, help="Tool ids to delete")
    parser.add_argument("--apply", action="store_true", help="Actually delete the tools after backup")
    parser.add_argument(
        "--backup",
        default=f"tmp/owui-backups/legacy-tools-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json",
        help="Local backup path for exported live tool payloads",
    )
    args = parser.parse_args()

    token = login()
    backup_path = Path(args.backup)
    backup_tools(token, args.ids, backup_path)
    print(f"[OK] backup written to {backup_path}")

    if not args.apply:
        print("[DRY-RUN] backup completed; no deletes performed")
        return 0

    failures = 0
    for tool_id in args.ids:
        ok, message = delete_tool(token, tool_id)
        marker = "OK" if ok else "FAIL"
        print(f"[{marker}] {tool_id}: {message}")
        if not ok:
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
