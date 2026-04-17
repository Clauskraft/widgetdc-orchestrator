import asyncio
import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class OwuiToolBehaviorTests(unittest.TestCase):
    def test_cognitive_tool_uses_valve_auth_and_fallback(self):
        data = json.loads((ROOT / "owui-tools" / "cognitive-tool.json").read_text(encoding="utf-8"))
        content = data["content"]
        self.assertIn("ORCHESTRATOR_API_KEY", content)
        self.assertIn("investigate (fallback after reason_deeply=", content)
        self.assertNotIn("Bearer Heravej_22", content)

    def test_flow_editor_generates_canonical_business_analysis_flow(self):
        path = ROOT / "pipelines" / "widgetdc_flow_editor.py"
        spec = importlib.util.spec_from_file_location("widgetdc_flow_editor", path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)

        tool = module.Tools()
        html = asyncio.run(tool.visualize_pipeline("vis mig et procesdiagram for en forretningsanalyse"))

        self.assertIn("Scope og problemdefinition", html)
        self.assertIn("Roadmap og implementering", html)
        self.assertIn("nodes, 6 edges", html)


if __name__ == "__main__":
    unittest.main()
