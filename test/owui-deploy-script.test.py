import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = ROOT / "scripts" / "deploy_owui_tool.py"
SPEC = importlib.util.spec_from_file_location("deploy_owui_tool", SCRIPT_PATH)
deploy = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(deploy)


class DeployOwuiToolTests(unittest.TestCase):
    def write_fixture(self, name: str, definition: dict) -> Path:
        fixture_dir = ROOT / "tmp" / "test-fixtures"
        fixture_dir.mkdir(parents=True, exist_ok=True)
        path = fixture_dir / name
        path.write_text(json.dumps(definition), encoding="utf-8")
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        return path

    def test_load_definition_requires_bearer_for_placeholder(self):
        definition = {
            "id": "tool-a",
            "name": "Tool A",
            "content": "Authorization: Bearer __ORCHESTRATOR_BEARER__",
            "meta": {"description": "x"},
        }
        path = self.write_fixture("owui-tool-a.json", definition)
        previous = deploy.ORCHESTRATOR_BEARER
        deploy.ORCHESTRATOR_BEARER = ""
        try:
            with self.assertRaises(RuntimeError):
                deploy.load_definition(path)
        finally:
            deploy.ORCHESTRATOR_BEARER = previous

    def test_load_definition_substitutes_legacy_bearers(self):
        definition = {
            "id": "tool-b",
            "name": "Tool B",
            "content": "Bearer WidgeTDC_Orch_2026 and Heravej_22 and __ORCHESTRATOR_BEARER__",
            "meta": {"description": "y"},
        }
        path = self.write_fixture("owui-tool-b.json", definition)
        previous = deploy.ORCHESTRATOR_BEARER
        deploy.ORCHESTRATOR_BEARER = "secret-123"
        try:
            loaded = deploy.load_definition(path)
        finally:
            deploy.ORCHESTRATOR_BEARER = previous

        self.assertEqual(loaded["content"].count("secret-123"), 3)
        self.assertNotIn("WidgeTDC_Orch_2026", loaded["content"])
        self.assertNotIn("Heravej_22", loaded["content"])
        self.assertNotIn("__ORCHESTRATOR_BEARER__", loaded["content"])

    def test_verify_definition_accepts_read_back_match(self):
        definition = {
            "id": "tool-c",
            "name": "Tool C",
            "content": "hello",
            "meta": {"description": "z"},
        }
        original = deploy.api_request
        deploy.api_request = lambda token, method, path, body=None: (200, dict(definition))
        try:
            verified, message = deploy.verify_definition("token", definition)
        finally:
            deploy.api_request = original

        self.assertTrue(verified)
        self.assertIn("verified", message)

    def test_verify_definition_reports_mismatched_fields(self):
        definition = {
            "id": "tool-d",
            "name": "Tool D",
            "content": "expected",
            "meta": {"description": "same"},
        }
        payload = {
            "id": "tool-d",
            "name": "Tool D",
            "content": "actual",
            "meta": {"description": "same"},
        }
        original = deploy.api_request
        deploy.api_request = lambda token, method, path, body=None: (200, payload)
        try:
            verified, message = deploy.verify_definition("token", definition)
        finally:
            deploy.api_request = original

        self.assertFalse(verified)
        self.assertIn("content", message)

    def test_verify_definition_accepts_meta_superset(self):
        definition = {
            "id": "tool-e",
            "name": "Tool E",
            "content": "hello",
            "meta": {"description": "kept"},
        }
        payload = {
            "id": "tool-e",
            "name": "Tool E",
            "content": "hello",
            "meta": {
                "description": "kept",
                "manifest": {"title": "Tool E"},
            },
        }
        original = deploy.api_request
        deploy.api_request = lambda token, method, path, body=None: (200, payload)
        try:
            verified, message = deploy.verify_definition("token", definition)
        finally:
            deploy.api_request = original

        self.assertTrue(verified)
        self.assertIn("verified", message)


if __name__ == "__main__":
    unittest.main()
