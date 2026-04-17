import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
TMP_ROOT = ROOT / "tmp" / "test-artifacts"
TMP_ROOT.mkdir(parents=True, exist_ok=True)

from owui_sync_lib import (  # noqa: E402
    MODEL_FIELDS,
    TOOL_FIELDS,
    build_pipeline_tool_definition,
    diff_fields,
    load_model_definitions,
    normalize_definition,
    parse_manifest_header,
)


class OwuiSyncLibTests(unittest.TestCase):
    def test_parse_manifest_header(self):
        content = '''"""
title: Example Tool
author: WidgeTDC
description: Test description
requirements: aiohttp
"""
print("ok")
'''
        manifest = parse_manifest_header(content)
        self.assertEqual(manifest["title"], "Example Tool")
        self.assertEqual(manifest["description"], "Test description")
        self.assertEqual(manifest["requirements"], "aiohttp")

    def test_build_pipeline_tool_definition(self):
        path = TMP_ROOT / "widgetdc_data_browser.py"
        try:
            path.write_text(
                '"""\n'
                'title: WidgeTDC Data Browser\n'
                'author: WidgeTDC\n'
                'description: Tool description.\n'
                '"""\n'
                'print("hello")\n',
                encoding="utf-8",
            )
            definition = build_pipeline_tool_definition(path)
        finally:
            path.unlink(missing_ok=True)

        self.assertEqual(definition["id"], "widgetdc_data_browser")
        self.assertEqual(definition["name"], "WidgeTDC Data Browser")
        self.assertEqual(definition["meta"]["description"], "Tool description.")
        self.assertIn('print("hello")', definition["content"])

    def test_load_model_definitions_and_diff(self):
        path = TMP_ROOT / "models.json"
        try:
            path.write_text(
                json.dumps([
                    {
                        "id": "platform-health",
                        "base_model_id": "gemini-flash",
                        "name": "Platform Health",
                        "params": {"system": "x"},
                        "meta": {
                            "description": "Health",
                            "suggestion_prompts": [{"content": "valid"}, {"content": ""}],
                        },
                        "is_active": True,
                    }
                ]),
                encoding="utf-8",
            )
            models = load_model_definitions(path)
        finally:
            path.unlink(missing_ok=True)

        self.assertEqual(models[0]["meta"]["profile_image_url"], "/static/favicon.png")
        self.assertEqual(models[0]["meta"]["suggestion_prompts"], [{"content": "valid"}])

        expected = normalize_definition(models[0], MODEL_FIELDS)
        actual = normalize_definition({**models[0], "created_at": 1}, MODEL_FIELDS)
        self.assertEqual(diff_fields(expected, actual, MODEL_FIELDS), [])

    def test_tool_diff_detects_content_change(self):
        expected = normalize_definition(
            {"id": "x", "name": "n", "content": "alpha", "meta": {"description": "d"}},
            TOOL_FIELDS,
        )
        actual = normalize_definition(
            {"id": "x", "name": "n", "content": "beta", "meta": {"description": "d"}},
            TOOL_FIELDS,
        )
        self.assertEqual(diff_fields(expected, actual, TOOL_FIELDS), ["content"])


if __name__ == "__main__":
    unittest.main()
