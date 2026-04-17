from __future__ import annotations

import sys
import unittest
import shutil
from pathlib import Path
from unittest import mock
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.verify_deploy_stack import (
    build_full_stack_probes,
    build_targeted_orchestrator_probe,
    initialize_environment,
    get_backend_api_key,
    validate_probe_payload,
    wait_until_healthy,
)


class WaitUntilHealthyTests(unittest.TestCase):
    def test_wait_until_healthy_retries_until_status_is_ok(self) -> None:
        responses = iter([
            (200, {"status": "starting"}),
            (503, {"status": "booting"}),
            (200, {"status": "ok", "version": "1.0.0"}),
        ])
        slept: list[float] = []
        ticks = iter([0.0, 0.0, 5.0, 5.0, 10.0])

        result = wait_until_healthy(
            "https://example.test/health",
            timeout_seconds=20,
            poll_seconds=5,
            http_get=lambda _url: next(responses),
            sleep_fn=lambda seconds: slept.append(seconds),
            time_fn=lambda: next(ticks),
        )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["attempts"], 3)
        self.assertEqual(slept, [5, 5])


class ProbePlanTests(unittest.TestCase):
    def test_targeted_probe_uses_orchestrator_health_chat(self) -> None:
        probes = build_targeted_orchestrator_probe()
        self.assertEqual(len(probes), 1)
        self.assertEqual(probes[0].name, "orchestrator_health_chat")
        self.assertEqual(probes[0].kind, "orchestrator_v1")
        self.assertEqual(probes[0].request["model"], "widgetdc-neural")

    def test_full_stack_plan_covers_tested_layers_without_writes_by_default(self) -> None:
        probes = build_full_stack_probes()
        names = [probe.name for probe in probes]
        self.assertEqual(
            names,
            [
                "rag_srag_query",
                "intent_visualization_route",
                "rlm_reasoning",
                "context_fold",
                "phantom_skill_loop",
                "llm_generate",
            ],
        )

    def test_full_stack_write_probe_is_opt_in(self) -> None:
        probes = build_full_stack_probes(include_write_probes=True)
        names = [probe.name for probe in probes]
        self.assertIn("knowledge_normalize", names)

    def test_targeted_probe_requires_deterministic_health_markers(self) -> None:
        probe = build_targeted_orchestrator_probe()[0]
        payload = {
            "choices": [
                {
                    "message": {
                        "content": "# WidgeTDC Platform Health\n- Backend: healthy\n- RLM: healthy\n- Orchestrator: healthy"
                    }
                }
            ]
        }

        result = validate_probe_payload(probe, 200, payload)

        self.assertTrue(result["ok"])
        self.assertEqual(result["reason"], "validated_payload")

    def test_targeted_probe_rejects_missing_health_markers(self) -> None:
        probe = build_targeted_orchestrator_probe()[0]
        payload = {
            "choices": [
                {
                    "message": {
                        "content": "Generic response without deterministic health structure"
                    }
                }
            ]
        }

        result = validate_probe_payload(probe, 200, payload)

        self.assertFalse(result["ok"])
        self.assertIn("missing_success_markers", result["reason"])

    def test_generic_probe_rejects_error_payloads_even_with_200(self) -> None:
        probe = build_full_stack_probes()[0]
        payload = {"error": {"message": "Unknown tool"}}

        result = validate_probe_payload(probe, 200, payload)

        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "payload_error_envelope")


class DotenvLoadingTests(unittest.TestCase):
    def make_repo_root(self) -> Path:
        temp_root = ROOT / "test" / "fixtures" / ".tmp-dotenv-tests"
        temp_root.mkdir(parents=True, exist_ok=True)
        repo_path = temp_root / f"repo-{uuid4().hex}"
        repo_path.mkdir(parents=True, exist_ok=True)
        self.addCleanup(lambda: shutil.rmtree(repo_path, ignore_errors=True))
        return repo_path

    def test_initialize_environment_loads_missing_values_from_dotenv(self) -> None:
        repo = self.make_repo_root()
        env_file = repo / ".env"
        env_file.write_text(
            "WIDGETDC_BEARER_TOKEN=from-dotenv\n"
            "BACKEND_URL=https://backend.example\n"
            "ORCHESTRATOR_URL=https://orchestrator.example\n",
            encoding="utf-8",
        )

        with mock.patch("scripts.verify_deploy_stack.REPO_ROOT", repo):
            with mock.patch.dict("os.environ", {}, clear=True):
                initialize_environment()
                self.assertEqual(get_backend_api_key(), "from-dotenv")

    def test_initialize_environment_does_not_override_existing_env(self) -> None:
        repo = self.make_repo_root()
        env_file = repo / ".env"
        env_file.write_text("WIDGETDC_BEARER_TOKEN=from-dotenv\n", encoding="utf-8")

        with mock.patch("scripts.verify_deploy_stack.REPO_ROOT", repo):
            with mock.patch.dict("os.environ", {"BACKEND_API_KEY": "already-set"}, clear=True):
                initialize_environment()
                self.assertEqual(get_backend_api_key(), "already-set")


if __name__ == "__main__":
    unittest.main()
