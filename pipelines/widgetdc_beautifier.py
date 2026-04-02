"""
title: WidgeTDC Response Beautifier
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Outlet filter that post-processes LLM responses into executive-grade formatting with WidgeTDC branding. Manifestopunkt #2 Æstetisk Autoritet.
requirements: aiohttp
"""

from typing import List, Optional
from pydantic import BaseModel, Field
import re
import logging

logger = logging.getLogger(__name__)


class Pipeline:
    class Valves(BaseModel):
        pipelines: List[str] = ["*"]
        priority: int = 99  # Run last (after all other outlet filters)
        ENABLED: bool = Field(default=True, description="Enable response beautification")
        ADD_CERTIFIED_BADGE: bool = Field(default=True, description="Add ✦ CERTIFIED badge to decision-like outputs")
        ENHANCE_TABLES: bool = Field(default=True, description="Enhance markdown tables with alignment")

    def __init__(self):
        self.type = "filter"
        self.name = "WidgeTDC Response Beautifier"
        self.valves = self.Valves()

    async def outlet(self, body: dict, __user__: Optional[dict] = None) -> dict:
        """Post-process LLM responses for executive-grade formatting."""
        if not self.valves.ENABLED:
            return body

        messages = body.get("messages", [])
        if not messages:
            return body

        last = messages[-1]
        if last.get("role") != "assistant":
            return body

        content = last.get("content", "")
        if not content or len(content) < 50:
            return body

        try:
            content = self._enhance(content)
            messages[-1]["content"] = content
            body["messages"] = messages
        except Exception as e:
            logger.warning(f"Beautifier error (non-blocking): {e}")

        return body

    def _enhance(self, text: str) -> str:
        """Apply beautification transforms."""

        # 1. Certified Decision badge
        if self.valves.ADD_CERTIFIED_BADGE:
            text = self._add_certified_badge(text)

        # 2. Severity badges for failure mentions
        text = self._add_severity_badges(text)

        # 3. Status indicators
        text = self._add_status_indicators(text)

        return text

    def _add_certified_badge(self, text: str) -> str:
        """Add ✦ CERTIFIED badge to decision-like headers."""
        patterns = [
            r"(#{1,3}\s*(?:Decision|Beslutning|Recommendation|Anbefaling|Verdict|Conclusion))",
            r"(#{1,3}\s*(?:Certified|Certificeret))",
        ]
        for pattern in patterns:
            text = re.sub(
                pattern,
                r"\1 ✦",
                text,
                flags=re.IGNORECASE,
            )
        return text

    def _add_severity_badges(self, text: str) -> str:
        """Add visual severity indicators to P0/P1/P2/P3 mentions."""
        replacements = {
            r"\bP0\b": "🔴 P0",
            r"\bP1\b": "🟠 P1",
            r"\bP2\b": "🟡 P2",
            r"\bP3\b": "🔵 P3",
        }
        for pattern, replacement in replacements.items():
            # Only replace if not already badged
            text = re.sub(
                rf"(?<!🔴 )(?<!🟠 )(?<!🟡 )(?<!🔵 ){pattern}",
                replacement,
                text,
            )
        return text

    def _add_status_indicators(self, text: str) -> str:
        """Add visual status indicators."""
        # PASS/FAIL/WARN indicators
        text = re.sub(r"\bPASS\b", "✅ PASS", text)
        text = re.sub(r"\bFAIL\b", "❌ FAIL", text)
        text = re.sub(r"(?<!\w)WARN(?!\w)", "⚠️ WARN", text)

        # Platform status
        text = re.sub(r"\bHEALTHY\b", "🟢 HEALTHY", text, flags=re.IGNORECASE)
        text = re.sub(r"\bDEGRADED\b", "🟡 DEGRADED", text, flags=re.IGNORECASE)
        text = re.sub(r"\bDOWN\b(?!\s*(?:to|the|from|load))", "🔴 DOWN", text, flags=re.IGNORECASE)

        return text
