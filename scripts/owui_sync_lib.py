from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OWUI_URL = os.environ.get("OWUI_URL", "https://open-webui-production-25cb.up.railway.app")
OWUI_EMAIL = os.environ.get("OWUI_EMAIL", "")
OWUI_PASSWORD = os.environ.get("OWUI_PASSWORD", "")
OWUI_TOKEN = os.environ.get("OWUI_TOKEN", "")
ORCHESTRATOR_BEARER = os.environ.get("ORCHESTRATOR_BEARER", "")

LEGACY_BEARERS = (
    "__ORCHESTRATOR_BEARER__",
    "WidgeTDC_Orch_2026",
    "Heravej_22",
)

TOOL_FIELDS = ("id", "name", "content", "meta")
MODEL_FIELDS = ("id", "name", "base_model_id", "params", "meta", "is_active")

PIPELINE_TO_TOOL_ID = {
    "widgetdc_intelligence.py": "widgetdc_intelligence_suite",
    "widgetdc_graph.py": "widgetdc_graph_intel",
    "widgetdc_obsidian.py": "widgetdc_obsidian_bridge",
    "widgetdc_fold.py": "widgetdc_mercury_fold",
    "widgetdc_data_browser.py": "widgetdc_data_browser",
    "widgetdc_flow_editor.py": "widgetdc_flow_editor",
    "widgetdc_mcp_bridge.py": "widgetdc_mcp_bridge",
    "widgetdc_graph_explorer.py": "widgetdc_graph_explorer",
    "widgetdc_anticipator.py": "widgetdc_anticipator",
    "widgetdc_beautifier.py": "widgetdc_beautifier",
}

DEFERRED_PIPELINES = frozenset({
    "widgetdc_mcp_bridge",
    "widgetdc_anticipator",
    "widgetdc_beautifier",
})


def login(
    owui_url: str = OWUI_URL,
    email: str = OWUI_EMAIL,
    password: str = OWUI_PASSWORD,
    token: str = OWUI_TOKEN,
) -> str:
    if token:
        return token
    if not email or not password:
        raise RuntimeError("OWUI_EMAIL + OWUI_PASSWORD or OWUI_TOKEN are required")
    payload = json.dumps({"email": email, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        f"{owui_url}/api/v1/auths/signin",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())["token"]


def api_request(
    token: str,
    method: str,
    path: str,
    body: dict | None = None,
    owui_url: str = OWUI_URL,
) -> tuple[int, dict | str]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{owui_url}{path}",
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


def replace_bearers(content: str, orchestrator_bearer: str = ORCHESTRATOR_BEARER) -> str:
    if not orchestrator_bearer:
        return content
    updated = content
    for legacy in LEGACY_BEARERS:
        updated = updated.replace(f"Bearer {legacy}", f"Bearer {orchestrator_bearer}")
        updated = updated.replace(legacy, orchestrator_bearer)
    return updated


def parse_manifest_header(content: str) -> dict[str, str]:
    match = re.match(r'^\s*"""(.*?)"""', content, re.DOTALL)
    if not match:
        return {}

    manifest: dict[str, str] = {}
    for raw_line in match.group(1).splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        manifest[key.strip()] = value.strip()
    return manifest


def build_pipeline_tool_definition(path: Path, orchestrator_bearer: str = ORCHESTRATOR_BEARER) -> dict:
    content = path.read_text(encoding="utf-8")
    manifest = parse_manifest_header(content)
    tool_id = PIPELINE_TO_TOOL_ID.get(path.name)
    if not tool_id:
        raise RuntimeError(f"No pipeline-to-tool mapping for {path.name}")
    name = manifest.get("title") or path.stem
    meta = {
        "description": manifest.get("description", ""),
        "manifest": manifest,
    }
    return {
        "id": tool_id,
        "name": name,
        "content": replace_bearers(content, orchestrator_bearer),
        "meta": meta,
    }


def load_json_tool_definition(path: Path, orchestrator_bearer: str = ORCHESTRATOR_BEARER) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not {"id", "name", "content", "meta"} <= set(data.keys()):
        raise RuntimeError(f"{path.name}: expected id/name/content/meta")
    data["content"] = replace_bearers(data["content"], orchestrator_bearer)
    return data


def load_model_definitions(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as fh:
        raw_models = json.load(fh)

    models: list[dict] = []
    for raw in raw_models:
        meta = dict(raw.get("meta", {}))
        meta.setdefault("profile_image_url", "/static/favicon.png")
        prompts = meta.get("suggestion_prompts")
        if isinstance(prompts, list):
            meta["suggestion_prompts"] = [p for p in prompts if isinstance(p, dict) and p.get("content")]

        models.append({
            "id": raw["id"],
            "name": raw["name"],
            "base_model_id": raw["base_model_id"],
            "params": raw.get("params", {}),
            "meta": meta,
            "is_active": raw.get("is_active", True),
        })
    return models


def normalize_definition(data: dict | str, fields: tuple[str, ...]) -> dict:
    if not isinstance(data, dict):
        return {}
    if isinstance(data.get("data"), dict):
        data = data["data"]
    return {field: data.get(field) for field in fields}


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


def diff_fields(expected: dict, actual: dict, fields: tuple[str, ...]) -> list[str]:
    mismatches: list[str] = []
    for field in fields:
        if not is_subset_match(expected.get(field), actual.get(field)):
            mismatches.append(field)
    return mismatches


def model_detail_path(model_id: str) -> str:
    return f"/api/v1/models/model?id={urllib.parse.quote(model_id, safe='')}"
