from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = [
    ROOT / ".github" / "workflows" / "deploy-to-railway.yml",
    ROOT / ".github" / "workflows" / "agent-delivery-follow-up.yml",
]


class DeployWorkflowGuardTests(unittest.TestCase):
    def test_workflows_do_not_use_start_sleep_or_fixed_sleep_gate(self) -> None:
        for path in WORKFLOWS:
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("Start-Sleep", content, msg=f"{path.name} must not use Start-Sleep")
            self.assertNotIn("sleep 45", content, msg=f"{path.name} must not use fixed sleep 45")
            self.assertNotIn("sleep 90", content, msg=f"{path.name} must not use fixed sleep 90")

    def test_workflows_use_readiness_loop_and_verifier(self) -> None:
        for path in WORKFLOWS:
            content = path.read_text(encoding="utf-8")
            self.assertIn("until curl -fsSL", content, msg=f"{path.name} must poll health with until loop")
            self.assertIn("python scripts/verify_deploy_stack.py", content, msg=f"{path.name} must call deploy verifier")


if __name__ == "__main__":
    unittest.main()
