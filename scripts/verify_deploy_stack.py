from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


DEFAULT_BACKEND_URL = "https://backend-production-d3da.up.railway.app"
DEFAULT_ORCHESTRATOR_URL = "https://orchestrator-production-c27e.up.railway.app"
READY_TIMEOUT_SECONDS = int(os.environ.get("READY_TIMEOUT_SECONDS", "180"))
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "5"))
REPO_ROOT = Path(__file__).resolve().parent.parent


JsonDict = dict[str, Any]


@dataclass(frozen=True)
class Probe:
    name: str
    kind: str
    request: JsonDict
    expectation: str
    success_markers: tuple[str, ...] = ()


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def initialize_environment() -> None:
    load_dotenv(REPO_ROOT / ".env")


def get_backend_url() -> str:
    return os.environ.get("BACKEND_URL", DEFAULT_BACKEND_URL)


def get_orchestrator_url() -> str:
    return os.environ.get("ORCHESTRATOR_URL", DEFAULT_ORCHESTRATOR_URL)


def get_backend_api_key() -> str:
    for key in ("BACKEND_API_KEY", "WIDGETDC_BEARER_TOKEN", "ORCHESTRATOR_BEARER", "OPENAI_API_KEY"):
        value = os.environ.get(key, "")
        if value:
            return value
    return ""


def http_json(
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    body: JsonDict | None = None,
    timeout: int = 30,
) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw


def extract_status(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("status",):
            value = payload.get(key)
            if isinstance(value, str):
                return value.lower()
        data = payload.get("data")
        if isinstance(data, dict):
            return extract_status(data)
    return None


def wait_until_healthy(
    health_url: str,
    timeout_seconds: int = READY_TIMEOUT_SECONDS,
    poll_seconds: int = POLL_SECONDS,
    http_get: Callable[[str], tuple[int, Any]] | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
    time_fn: Callable[[], float] = time.monotonic,
) -> JsonDict:
    getter = http_get or (lambda url: http_json("GET", url))
    start = time_fn()
    attempts = 0

    while True:
        attempts += 1
        status_code, payload = getter(health_url)
        status = extract_status(payload)
        if status_code == 200 and status in {"ok", "healthy"}:
            return {
                "health_url": health_url,
                "attempts": attempts,
                "status": status,
                "payload": payload,
            }
        if time_fn() - start >= timeout_seconds:
            raise TimeoutError(f"Timed out waiting for healthy status from {health_url}")
        sleep_fn(poll_seconds)


def require_env(name: str, value: str) -> str:
    if value:
        return value
    raise RuntimeError(f"Environment variable {name} is required")


def build_targeted_orchestrator_probe() -> list[Probe]:
    return [
        Probe(
            name="orchestrator_health_chat",
            kind="orchestrator_v1",
            request={
                "model": "widgetdc-neural",
                "messages": [
                    {
                        "role": "user",
                        "content": "Service status og health check for hele WidgeTDC platformen",
                    }
                ],
                "stream": False,
            },
            expectation="Deterministisk WidgeTDC health-format via /v1/chat/completions",
            success_markers=(
                "WidgeTDC Platform Health",
                "Backend:",
                "RLM:",
                "Orchestrator:",
            ),
        )
    ]


def build_full_stack_probes(include_write_probes: bool = False) -> list[Probe]:
    probes = [
        Probe(
            name="rag_srag_query",
            kind="mcp",
            request={"tool": "srag.query", "payload": {"query": "deploy verification"}},
            expectation="RAG-laget svarer med grounded data",
        ),
        Probe(
            name="intent_visualization_route",
            kind="mcp",
            request={"tool": "intent_detect", "payload": {"input": "normalize this illustration into a canonical visualization system"}},
            expectation="Intent-laget matcher visualization-system-loop eller anden canonical composition",
        ),
        Probe(
            name="rlm_reasoning",
            kind="mcp",
            request={"tool": "reason_deeply", "payload": {"question": "Verify deploy health routing for the current production runtime", "mode": "reason"}},
            expectation="RLM reasoning svarer uden fallback-fejl",
        ),
        Probe(
            name="context_fold",
            kind="mcp",
            request={
                "tool": "context_fold",
                "payload": {
                    "text": "Deploy verification context. " * 220,
                    "query": "compress deployment verification context while preserving service names, latencies, and decisions",
                    "budget": 800,
                },
            },
            expectation="Folding returnerer komprimeret kontekst",
        ),
        Probe(
            name="phantom_skill_loop",
            kind="mcp",
            request={
                "tool": "recommend_skill_loop",
                "payload": {
                    "intent": "normalize illustration and visualization runtime after deploy",
                    "repo_or_domain": "widgetdc-orchestrator",
                },
            },
            expectation="Phantom BOM/autonomous loop routing svarer med reuse-anbefaling",
        ),
        Probe(
            name="llm_generate",
            kind="mcp",
            request={"tool": "llm.generate", "payload": {"prompt": "ping", "maxTokens": 5}},
            expectation="Model-gateway svarer på en minimal probe",
        ),
    ]
    if include_write_probes:
        probes.append(
            Probe(
                name="knowledge_normalize",
                kind="mcp",
                request={
                    "tool": "knowledge_normalize",
                    "payload": {
                        "title": "Deploy verification smoke event",
                        "content": "Manual smoke event for deploy verification.",
                        "source": "manual",
                        "tags": ["deploy-verification", "smoke"],
                    },
                },
                expectation="Normalization bus accepterer et manuelt smoke-event",
            )
        )
    return probes


def run_probe(probe: Probe, backend_url: str, orchestrator_url: str, backend_api_key: str) -> JsonDict:
    started = time.perf_counter()
    if probe.kind == "mcp":
        status, payload = http_json(
            "POST",
            f"{backend_url}/api/mcp/route",
            headers={
                "Authorization": f"Bearer {backend_api_key}",
                "Content-Type": "application/json",
            },
            body=probe.request,
            timeout=60,
        )
    elif probe.kind == "orchestrator_v1":
        status, payload = http_json(
            "POST",
            f"{orchestrator_url}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {backend_api_key}",
                "Content-Type": "application/json",
            },
            body=probe.request,
            timeout=60,
        )
    else:
        raise RuntimeError(f"Unsupported probe kind: {probe.kind}")

    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    validation = validate_probe_payload(probe, status, payload)
    preview = validation["preview"]

    return {
        "name": probe.name,
        "kind": probe.kind,
        "expectation": probe.expectation,
        "status_code": status,
        "latency_ms": elapsed_ms,
        "ok": validation["ok"],
        "validation_reason": validation["reason"],
        "preview": preview,
    }


def extract_text_fragments(payload: Any) -> list[str]:
    fragments: list[str] = []
    if isinstance(payload, str):
        stripped = payload.strip()
        if stripped:
            fragments.append(stripped)
    elif isinstance(payload, dict):
        for value in payload.values():
            fragments.extend(extract_text_fragments(value))
    elif isinstance(payload, list):
        for value in payload:
            fragments.extend(extract_text_fragments(value))
    return fragments


def summarize_payload(payload: Any) -> str:
    if isinstance(payload, str):
        return payload[:400]
    try:
        return json.dumps(payload, ensure_ascii=False)[:400]
    except TypeError:
        return str(payload)[:400]


def validate_probe_payload(probe: Probe, status_code: int, payload: Any) -> JsonDict:
    preview = summarize_payload(payload)
    if not 200 <= status_code < 300:
        return {"ok": False, "reason": f"http_{status_code}", "preview": preview}

    if isinstance(payload, dict) and "error" in payload:
        return {"ok": False, "reason": "payload_error_envelope", "preview": preview}

    combined = "\n".join(extract_text_fragments(payload))
    normalized = combined.lower()
    failure_markers = (
        "unknown tool",
        "tool execution failed",
        "timed out",
        "timeout",
        "failed to fetch",
        "internal_error",
        '"status":"error"',
        "service unavailable",
    )
    if any(marker in normalized for marker in failure_markers):
        return {"ok": False, "reason": "failure_marker_detected", "preview": preview}

    if probe.success_markers:
        missing = [marker for marker in probe.success_markers if marker not in combined]
        if missing:
            return {
                "ok": False,
                "reason": f"missing_success_markers:{','.join(missing)}",
                "preview": preview,
            }

    if len(combined.strip()) < 12:
        return {"ok": False, "reason": "payload_too_small", "preview": preview}

    return {"ok": True, "reason": "validated_payload", "preview": preview}


def format_text_report(readiness: JsonDict, results: list[JsonDict]) -> str:
    lines = [
        f"READY after {readiness['attempts']} checks: {readiness['status']}",
        "",
    ]
    for result in results:
        outcome = "OK" if result["ok"] else "FAIL"
        lines.append(f"[{outcome}] {result['name']} {result['status_code']} {result['latency_ms']}ms")
        lines.append(f"  expectation: {result['expectation']}")
        lines.append(f"  validation: {result['validation_reason']}")
        lines.append(f"  preview: {result['preview']}")
    return "\n".join(lines)


def main() -> int:
    initialize_environment()
    parser = argparse.ArgumentParser(description="Post-deploy readiness + targeted/full-stack verification for WidgeTDC services.")
    parser.add_argument("--service", choices=["backend", "orchestrator"], default="orchestrator")
    parser.add_argument("--mode", choices=["targeted", "full-stack"], default="targeted")
    parser.add_argument("--include-write-probes", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=READY_TIMEOUT_SECONDS)
    parser.add_argument("--poll-seconds", type=int, default=POLL_SECONDS)
    args = parser.parse_args()

    backend_url = get_backend_url()
    orchestrator_url = get_orchestrator_url()
    backend_api_key = require_env("BACKEND_API_KEY", get_backend_api_key())
    health_url = f"{backend_url if args.service == 'backend' else orchestrator_url}/health"

    readiness = wait_until_healthy(
        health_url,
        timeout_seconds=args.timeout_seconds,
        poll_seconds=args.poll_seconds,
    )

    probes = build_targeted_orchestrator_probe() if args.mode == "targeted" else build_full_stack_probes(args.include_write_probes)
    results = [run_probe(probe, backend_url, orchestrator_url, backend_api_key) for probe in probes]

    report = {
        "service": args.service,
        "mode": args.mode,
        "readiness": readiness,
        "results": results,
        "all_ok": all(result["ok"] for result in results),
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_text_report(readiness, results))

    return 0 if report["all_ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
