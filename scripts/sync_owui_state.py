"""
Sync the intended Open WebUI production surface from repo source-of-truth.

Categories:
  - json-tools:      owui-tools/*.json
  - pipeline-tools:  pipelines/widgetdc_*.py (excluding deferred by default)
  - models:          docs/openwebui-consulting-assistants.json
  - cleanup-probes:  delete obvious probe/test models

Each write is followed by read-back verification.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from owui_sync_lib import (
    DEFERRED_PIPELINES,
    MODEL_FIELDS,
    TOOL_FIELDS,
    api_request,
    build_pipeline_tool_definition,
    diff_fields,
    load_json_tool_definition,
    load_model_definitions,
    login,
    model_detail_path,
    normalize_definition,
)

ROOT = Path(__file__).parent.parent
OWUI_TOOLS_DIR = ROOT / "owui-tools"
PIPELINES_DIR = ROOT / "pipelines"
MODELS_PATH = ROOT / "docs" / "openwebui-consulting-assistants.json"

PROBE_MODEL_PREFIXES = ("probe-", "test-probe-")


def collect_json_tools() -> list[tuple[str, dict]]:
    return [
        (path.name, load_json_tool_definition(path))
        for path in sorted(OWUI_TOOLS_DIR.glob("*.json"))
    ]


def collect_pipeline_tools(include_deferred: bool) -> list[tuple[str, dict]]:
    entries: list[tuple[str, dict]] = []
    for path in sorted(PIPELINES_DIR.glob("widgetdc_*.py")):
        definition = build_pipeline_tool_definition(path)
        if not include_deferred and definition["id"] in DEFERRED_PIPELINES:
            continue
        entries.append((path.name, definition))
    return entries


def collect_models() -> list[tuple[str, dict]]:
    return [(definition["id"], definition) for definition in load_model_definitions(MODELS_PATH)]


def upsert_tool(token: str, label: str, definition: dict) -> tuple[bool, str]:
    tool_id = definition["id"]
    status, _ = api_request(token, "GET", f"/api/v1/tools/id/{tool_id}")
    if status == 200:
        action, status, payload = "updated", *api_request(token, "POST", f"/api/v1/tools/id/{tool_id}/update", definition)
    elif status == 404:
        action, status, payload = "created", *api_request(token, "POST", "/api/v1/tools/create", definition)
    else:
        return False, f"[FAIL] tool {tool_id} ({label}) probe -> HTTP {status}"

    if not (200 <= status < 300):
        return False, f"[FAIL] {action} tool {tool_id} ({label}) -> HTTP {status} | {json.dumps(payload, ensure_ascii=False)[:500]}"

    verify_status, verify_payload = api_request(token, "GET", f"/api/v1/tools/id/{tool_id}")
    if verify_status != 200:
        return False, f"[FAIL] {action} tool {tool_id} ({label}) read-back -> HTTP {verify_status}"

    expected = normalize_definition(definition, TOOL_FIELDS)
    actual = normalize_definition(verify_payload, TOOL_FIELDS)
    mismatches = diff_fields(expected, actual, TOOL_FIELDS)
    if mismatches:
        return False, f"[FAIL] {action} tool {tool_id} ({label}) read-back mismatch: {', '.join(mismatches)}"

    return True, f"[OK] {action} tool {tool_id} ({label})"


def upsert_model(token: str, label: str, definition: dict) -> tuple[bool, str]:
    model_id = definition["id"]
    detail_path = model_detail_path(model_id)
    status, _ = api_request(token, "GET", detail_path)
    if status == 200:
        action, status, payload = "updated", *api_request(token, "POST", "/api/v1/models/model/update", definition)
    elif status == 404:
        action, status, payload = "created", *api_request(token, "POST", "/api/v1/models/create", definition)
    else:
        return False, f"[FAIL] model {model_id} ({label}) probe -> HTTP {status}"

    if not (200 <= status < 300):
        return False, f"[FAIL] {action} model {model_id} ({label}) -> HTTP {status} | {json.dumps(payload, ensure_ascii=False)[:500]}"

    verify_status, verify_payload = api_request(token, "GET", detail_path)
    if verify_status != 200:
        return False, f"[FAIL] {action} model {model_id} ({label}) read-back -> HTTP {verify_status}"

    expected = normalize_definition(definition, MODEL_FIELDS)
    actual = normalize_definition(verify_payload, MODEL_FIELDS)
    mismatches = diff_fields(expected, actual, MODEL_FIELDS)
    if mismatches:
        return False, f"[FAIL] {action} model {model_id} ({label}) read-back mismatch: {', '.join(mismatches)}"

    return True, f"[OK] {action} model {model_id} ({label})"


def cleanup_probe_models(token: str) -> list[str]:
    status, payload = api_request(token, "GET", "/api/models")
    if status != 200 or not isinstance(payload, dict):
        return [f"[FAIL] cleanup probes list -> HTTP {status}"]

    messages: list[str] = []
    for model in payload.get("data", []):
        model_id = model.get("id", "")
        if not any(model_id.startswith(prefix) for prefix in PROBE_MODEL_PREFIXES):
            continue
        delete_status, delete_payload = api_request(token, "POST", "/api/v1/models/model/delete", {"id": model_id})
        if not (200 <= delete_status < 300):
            messages.append(f"[FAIL] delete probe model {model_id} -> HTTP {delete_status} | {json.dumps(delete_payload, ensure_ascii=False)[:500]}")
            continue

        verify_status, _ = api_request(token, "GET", model_detail_path(model_id))
        if verify_status != 404:
            messages.append(f"[FAIL] delete probe model {model_id} read-back -> expected 404, got {verify_status}")
            continue

        messages.append(f"[OK] deleted probe model {model_id}")
    return messages


def verify_live_config(token: str) -> list[str]:
    messages: list[str] = []
    config_status, config_payload = api_request(token, "GET", "/api/config")
    functions_status, functions_payload = api_request(token, "GET", "/api/v1/functions/")
    pipelines_status, pipelines_payload = api_request(token, "GET", "/api/v1/pipelines/list")

    if config_status == 200 and isinstance(config_payload, dict):
        default_model = config_payload.get("default_models")
        prompt_count = len(config_payload.get("default_prompt_suggestions") or [])
        messages.append(f"[INFO] config default_model={default_model} prompt_suggestions={prompt_count}")
    else:
        messages.append(f"[FAIL] config read-back -> HTTP {config_status}")

    if functions_status == 200:
        items = functions_payload if isinstance(functions_payload, list) else functions_payload.get("data", [])
        messages.append(f"[INFO] functions count={len(items)}")
    else:
        messages.append(f"[FAIL] functions read-back -> HTTP {functions_status}")

    if pipelines_status == 200 and isinstance(pipelines_payload, dict):
        messages.append(f"[INFO] admin pipelines count={len(pipelines_payload.get('data') or [])}")
    else:
        messages.append(f"[FAIL] pipelines read-back -> HTTP {pipelines_status}")

    return messages


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--include-deferred", action="store_true", help="Include deferred pipeline tools")
    parser.add_argument("--skip-json-tools", action="store_true")
    parser.add_argument("--skip-pipeline-tools", action="store_true")
    parser.add_argument("--skip-models", action="store_true")
    parser.add_argument("--cleanup-probe-models", action="store_true")
    parser.add_argument("--fail-fast", action="store_true")
    args = parser.parse_args()

    token = login()
    failures = 0

    if not args.skip_json_tools:
        for label, definition in collect_json_tools():
            ok, message = upsert_tool(token, label, definition)
            print(message)
            failures += 0 if ok else 1
            if failures and args.fail_fast:
                return 1

    if not args.skip_pipeline_tools:
        for label, definition in collect_pipeline_tools(args.include_deferred):
            ok, message = upsert_tool(token, label, definition)
            print(message)
            failures += 0 if ok else 1
            if failures and args.fail_fast:
                return 1

    if not args.skip_models:
        for label, definition in collect_models():
            ok, message = upsert_model(token, label, definition)
            print(message)
            failures += 0 if ok else 1
            if failures and args.fail_fast:
                return 1

    if args.cleanup_probe_models:
        for message in cleanup_probe_models(token):
            print(message)
            if message.startswith("[FAIL]"):
                failures += 1
                if args.fail_fast:
                    return 1

    for message in verify_live_config(token):
        print(message)
        if message.startswith("[FAIL]"):
            failures += 1
            if args.fail_fast:
                return 1

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
