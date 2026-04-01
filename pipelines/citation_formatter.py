"""
title: Citation Formatter
author: WidgeTDC
version: 1.0.0
description: Formats [MI-xxxx], [KPI-xxxx], [FW-xxxx] references as clickable citations in assistant responses.
"""

import re
from typing import Optional
from pydantic import BaseModel, Field


class Pipeline:
    """Open WebUI outlet filter that formats insight references as clickable citations."""

    class Valves(BaseModel):
        ENABLED: bool = Field(default=True, description="Enable citation formatting")
        CITATION_STYLE: str = Field(
            default="inline",
            description="Citation style: 'inline' (tooltip links) or 'footnote' (collected at bottom)",
        )

    def __init__(self):
        self.type = "filter"
        self.name = "Citation Formatter"
        self.valves = self.Valves()
        # Pattern matches [PREFIX-NUMBER] references
        self._ref_pattern = re.compile(r"\[([A-Z]{2,5})-(\d{3,5})\]")
        # Prefix descriptions for tooltip text
        self._prefix_labels = {
            "MI": "Management Insight",
            "KPI": "Key Performance Indicator",
            "FW": "Framework Reference",
            "REG": "Regulatory Reference",
            "REC": "Recommendation",
            "GAP": "Gap Analysis Finding",
            "RISK": "Risk Assessment",
            "ACT": "Action Item",
        }

    async def on_startup(self):
        pass

    async def on_shutdown(self):
        pass

    async def on_valves_updated(self):
        pass

    def _get_label(self, prefix: str) -> str:
        """Return human-readable label for a reference prefix."""
        return self._prefix_labels.get(prefix, "Reference")

    def _format_inline(self, content: str) -> str:
        """Replace references with inline tooltip links."""

        def replace_match(match):
            full = match.group(0)  # e.g. [MI-1234]
            prefix = match.group(1)
            number = match.group(2)
            label = self._get_label(prefix)
            ref_id = f"{prefix}-{number}"
            return f'[{ref_id}](# "{label}: {ref_id}")'

        return self._ref_pattern.sub(replace_match, content)

    def _format_footnote(self, content: str) -> str:
        """Collect references and append footnote section."""
        refs_found = []
        seen = set()

        for match in self._ref_pattern.finditer(content):
            prefix = match.group(1)
            number = match.group(2)
            ref_id = f"{prefix}-{number}"
            if ref_id not in seen:
                seen.add(ref_id)
                label = self._get_label(prefix)
                refs_found.append((ref_id, label))

        if not refs_found:
            return content

        # Bold the references in the text
        def bold_match(match):
            prefix = match.group(1)
            number = match.group(2)
            return f"**[{prefix}-{number}]**"

        formatted = self._ref_pattern.sub(bold_match, content)

        # Append footnote section
        footnotes = "\n\n---\n### Referencer\n"
        for i, (ref_id, label) in enumerate(refs_found, 1):
            footnotes += f"{i}. **[{ref_id}]** — {label}\n"

        return formatted + footnotes

    async def outlet(self, body: dict, __user__: Optional[dict] = None) -> dict:
        """Process assistant response and format citation references."""
        try:
            if not self.valves.ENABLED:
                return body

            messages = body.get("messages", [])
            if not messages:
                return body

            # Find the last assistant message
            last_msg = messages[-1]
            if last_msg.get("role") != "assistant":
                return body

            content = last_msg.get("content", "")
            if not isinstance(content, str) or not content:
                return body

            # Check if any references exist
            if not self._ref_pattern.search(content):
                return body

            # Format based on style
            if self.valves.CITATION_STYLE == "footnote":
                formatted = self._format_footnote(content)
            else:
                formatted = self._format_inline(content)

            # Update the message content
            messages[-1]["content"] = formatted
            body["messages"] = messages

        except Exception:
            # Zero degradation: pass through unmodified on any error
            pass

        return body
