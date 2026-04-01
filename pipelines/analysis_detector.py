"""
title: Analysis Detector + WAD Artifact Creator
author: WidgeTDC
version: 1.0.0
description: Detects analysis-worthy LLM responses, auto-creates WAD artifacts, and appends Obsidian deep-links.
"""

import re
import uuid
import json
import logging
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

try:
    import aiohttp

    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False

logger = logging.getLogger("analysis_detector")


class Pipeline:
    """Open WebUI outlet filter: G4.6 detect, G4.7 create artifact, G4.8 deep-link."""

    class Valves(BaseModel):
        ENABLED: bool = Field(default=True, description="Enable analysis detection")
        SCORE_THRESHOLD: float = Field(
            default=0.7,
            description="Minimum score (0-1) to trigger artifact creation",
        )
        ORCHESTRATOR_URL: str = Field(
            default="https://orchestrator-production-c27e.up.railway.app",
            description="Orchestrator base URL",
        )
        ORCHESTRATOR_API_KEY: str = Field(
            default="", description="Orchestrator API key for artifact creation"
        )
        # Individual signal weights (sum should ~= 1.0 for intuitive threshold)
        WEIGHT_TABLE: float = Field(default=0.25, description="Weight for markdown table signal")
        WEIGHT_FRAMEWORK_REF: float = Field(
            default=0.20, description="Weight for framework reference signal"
        )
        WEIGHT_DATA_POINTS: float = Field(
            default=0.15, description="Weight for numeric data points signal"
        )
        WEIGHT_COMPARISON: float = Field(
            default=0.15, description="Weight for comparison language signal"
        )
        WEIGHT_LENGTH: float = Field(
            default=0.25, description="Weight for response length signal"
        )
        MIN_LENGTH_FOR_SCORE: int = Field(
            default=1500, description="Char length threshold for length signal"
        )
        MIN_DATA_POINTS: int = Field(
            default=3, description="Minimum numeric data points to trigger signal"
        )

    def __init__(self):
        self.type = "filter"
        self.name = "Analysis Detector"
        self.valves = self.Valves()

        # Precompiled patterns
        self._table_pattern = re.compile(r"\|[-:]+\|")
        self._framework_ref_pattern = re.compile(
            r"\[(?:MI|FW|KPI|REG|REC|GAP|RISK|ACT)-\d{3,5}\]"
        )
        self._number_pattern = re.compile(r"\b\d+(?:[.,]\d+)?(?:\s*%|\s*kr\.?|\s*DKK)?\b")
        self._comparison_pattern = re.compile(
            r"\b(?:versus|compared|higher|lower|større|mindre|sammenlign|"
            r"overstiger|understiger|stigning|fald|difference|gap|delta)\b",
            re.IGNORECASE,
        )
        # Block parsing patterns
        self._code_block_pattern = re.compile(r"```[\s\S]*?```", re.MULTILINE)
        self._table_block_pattern = re.compile(
            r"(?:^|\n)(\|.+\|(?:\n\|.+\|)+)", re.MULTILINE
        )

    async def on_startup(self):
        pass

    async def on_shutdown(self):
        pass

    async def on_valves_updated(self):
        pass

    # ─── G4.6: Heuristic Scoring ────────────────────────────

    def _score_response(self, content: str) -> Dict[str, Any]:
        """Score a response for analysis-worthiness. Returns dict with signals and total."""
        v = self.valves

        has_table = bool(self._table_pattern.search(content))
        has_framework_ref = bool(self._framework_ref_pattern.search(content))
        data_point_matches = self._number_pattern.findall(content)
        has_data_points = len(data_point_matches) >= v.MIN_DATA_POINTS
        has_comparison = bool(self._comparison_pattern.search(content))
        length_score = len(content) >= v.MIN_LENGTH_FOR_SCORE

        total = (
            (v.WEIGHT_TABLE if has_table else 0.0)
            + (v.WEIGHT_FRAMEWORK_REF if has_framework_ref else 0.0)
            + (v.WEIGHT_DATA_POINTS if has_data_points else 0.0)
            + (v.WEIGHT_COMPARISON if has_comparison else 0.0)
            + (v.WEIGHT_LENGTH if length_score else 0.0)
        )

        return {
            "score": round(total, 3),
            "signals": {
                "has_table": has_table,
                "has_framework_ref": has_framework_ref,
                "has_data_points": has_data_points,
                "data_point_count": len(data_point_matches),
                "has_comparison": has_comparison,
                "length_score": length_score,
                "char_count": len(content),
            },
        }

    # ─── G4.7: Parse Response into WAD Blocks ──────────────

    def _parse_blocks(self, content: str) -> List[Dict[str, Any]]:
        """Parse response into structured blocks (text, table, code)."""
        blocks: List[Dict[str, Any]] = []
        remaining = content

        # Extract code blocks first
        code_blocks = list(self._code_block_pattern.finditer(content))
        table_blocks = list(self._table_block_pattern.finditer(content))

        # Collect all special regions with their positions
        regions = []
        for m in code_blocks:
            lang_line = m.group(0).split("\n", 1)[0].strip("`").strip()
            code_content = m.group(0).strip("`").strip()
            if lang_line and "\n" not in lang_line:
                code_content = m.group(0)[3 + len(lang_line) + 1 : -3].strip()
            else:
                code_content = m.group(0)[3:-3].strip()
                lang_line = ""
            regions.append(
                {
                    "start": m.start(),
                    "end": m.end(),
                    "type": "code",
                    "content": code_content,
                    "language": lang_line or None,
                }
            )

        for m in table_blocks:
            # Avoid overlap with code blocks
            overlaps = any(
                r["start"] <= m.start() < r["end"] for r in regions
            )
            if not overlaps:
                regions.append(
                    {
                        "start": m.start(),
                        "end": m.end(),
                        "type": "table",
                        "content": m.group(0).strip(),
                    }
                )

        # Sort by position
        regions.sort(key=lambda r: r["start"])

        # Build blocks: text between regions + the regions themselves
        cursor = 0
        for region in regions:
            if region["start"] > cursor:
                text_chunk = content[cursor : region["start"]].strip()
                if text_chunk:
                    blocks.append({"type": "text", "content": text_chunk})

            block: Dict[str, Any] = {
                "type": region["type"],
                "content": region["content"],
            }
            if region.get("language"):
                block["language"] = region["language"]
            blocks.append(block)
            cursor = region["end"]

        # Trailing text
        if cursor < len(content):
            text_chunk = content[cursor:].strip()
            if text_chunk:
                blocks.append({"type": "text", "content": text_chunk})

        return blocks if blocks else [{"type": "text", "content": content}]

    def _extract_title(self, content: str) -> str:
        """Extract a title from the first heading or first 60 chars."""
        heading_match = re.search(r"^#+\s+(.+)$", content, re.MULTILINE)
        if heading_match:
            return heading_match.group(1).strip()[:80]

        # Use first non-empty line truncated
        for line in content.split("\n"):
            stripped = line.strip()
            if stripped and not stripped.startswith("|"):
                return stripped[:60] + ("..." if len(stripped) > 60 else "")

        return "Untitled Analysis"

    # ─── G4.7: Create WAD Artifact via Orchestrator ─────────

    async def _create_artifact(
        self, content: str, blocks: List[Dict[str, Any]], score_info: Dict[str, Any]
    ) -> Optional[str]:
        """POST artifact to orchestrator. Returns artifact ID or None."""
        if not HAS_AIOHTTP:
            logger.warning("aiohttp not available — skipping artifact creation")
            return None

        v = self.valves
        if not v.ORCHESTRATOR_URL or not v.ORCHESTRATOR_API_KEY:
            logger.warning("Orchestrator URL/key not configured — skipping artifact creation")
            return None

        title = self._extract_title(content)
        artifact_id = str(uuid.uuid4())

        payload = {
            "id": artifact_id,
            "title": title,
            "blocks": blocks,
            "metadata": {
                "source": "analysis_detector",
                "score": score_info["score"],
                "signals": score_info["signals"],
            },
        }

        url = f"{v.ORCHESTRATOR_URL.rstrip('/')}/api/artifacts"

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {v.ORCHESTRATOR_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status in (200, 201):
                        data = await resp.json()
                        return data.get("id", artifact_id)
                    else:
                        body = await resp.text()
                        logger.error(
                            "Artifact creation failed: HTTP %d — %s",
                            resp.status,
                            body[:200],
                        )
                        return None
        except Exception as exc:
            logger.error("Artifact creation error: %s", exc)
            return None

    # ─── G4.8: Append Deep-link ─────────────────────────────

    def _append_deep_link(self, content: str, artifact_id: str) -> str:
        """Append Obsidian URI + HTML deep-link to response."""
        v = self.valves
        base = v.ORCHESTRATOR_URL.rstrip("/")
        obsidian_uri = f"obsidian://widgetdc-open?artifact={artifact_id}"
        html_url = f"{base}/api/artifacts/{artifact_id}.html"

        suffix = (
            f"\n\n---\n"
            f"\U0001f4ca [Åbn i Obsidian]({obsidian_uri}) "
            f"| [Se HTML]({html_url})"
        )
        return content + suffix

    # ─── Outlet Entry Point ─────────────────────────────────

    async def outlet(self, body: dict, __user__: Optional[dict] = None) -> dict:
        """Process assistant response: detect, score, create artifact, append link."""
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

            # G4.6: Score the response
            score_info = self._score_response(content)

            if score_info["score"] < self.valves.SCORE_THRESHOLD:
                return body

            # G4.7: Parse into blocks and create artifact
            blocks = self._parse_blocks(content)
            artifact_id = await self._create_artifact(content, blocks, score_info)

            if artifact_id:
                # G4.8: Append deep-link
                messages[-1]["content"] = self._append_deep_link(content, artifact_id)
                body["messages"] = messages

        except Exception:
            # Zero degradation: pass through unmodified on any error
            pass

        return body
