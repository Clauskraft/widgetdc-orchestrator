"""
title: WidgeTDC Mercury Folding
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Open WebUI Tool — Context-as-a-Service Mercury Folding. Compress large texts while preserving key information. Cognitive quicksilver. Manifestopunkt #4.
requirements: aiohttp
"""

from pydantic import BaseModel, Field
import aiohttp
import json
import logging

logger = logging.getLogger(__name__)


class Tools:
    class Valves(BaseModel):
        ORCHESTRATOR_URL: str = Field(
            default="https://orchestrator-production-c27e.up.railway.app",
            description="WidgeTDC Orchestrator URL",
        )
        ORCHESTRATOR_API_KEY: str = Field(
            default="",
            description="Orchestrator API key",
        )

    def __init__(self):
        self.valves = self.Valves()

    async def fold_text(
        self,
        text: str,
        query: str = "",
        budget: int = 2000,
        strategy: str = "semantic",
        __user__: dict = {},
    ) -> str:
        """
        Compress text using Mercury Folding — preserves key information while reducing tokens.
        Use when dealing with large documents, long contexts, or when the user asks to summarize/compress/fold.

        :param text: The text to compress
        :param query: Optional focus query — what to preserve (e.g. "compliance requirements")
        :param budget: Target output token budget (100-50000, default 2000)
        :param strategy: Folding strategy: semantic | extractive | hybrid
        """
        if not text or len(text) < 50:
            return "⚠️ Tekst er for kort til at folde (minimum 50 tegn)."

        try:
            url = f"{self.valves.ORCHESTRATOR_URL}/api/fold"
            headers = {
                "Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}",
                "Content-Type": "application/json",
            }
            payload = {
                "text": text,
                "query": query or "Preserve key facts, decisions, and actionable items",
                "budget": budget,
                "strategy": strategy,
            }

            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=45)) as resp:
                    data = await resp.json()

            if not data.get("success"):
                err = data.get("error", {})
                return f"❌ Fold fejlede: {err.get('message', '?')}"

            result = data["data"]
            folded = result.get("folded_text", "")

            # Extract actual text from RLM wrapper if needed
            if isinstance(folded, dict):
                folded = folded.get("folded_context", {}).get("text", "") or folded.get("result", "") or json.dumps(folded)

            ratio = result.get("compression_ratio", 0)
            saved = result.get("tokens_saved_estimate", 0)
            duration = result.get("duration_ms", 0)
            usage = data.get("usage", {})

            lines = [
                f"## Mercury Fold Result",
                f"**{result.get('input_chars', 0):,}** → **{result.get('output_chars', 0):,}** chars ({ratio}× ratio) | {duration}ms | ~{saved} tokens saved",
                f"Strategy: {result.get('strategy', '?')} | Rate limit: {usage.get('today', '?')}/{usage.get('limit', '?')}\n",
                "---",
                folded,
            ]
            return "\n".join(lines)

        except Exception as e:
            logger.error(f"fold_text error: {e}")
            return f"❌ Mercury Fold fejl: {e}"

    async def fold_usage(self, __user__: dict = {}) -> str:
        """
        Check Mercury Folding usage stats — how many fold requests today, recent activity.
        """
        try:
            url = f"{self.valves.ORCHESTRATOR_URL}/api/fold/usage"
            headers = {"Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}"}

            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    data = await resp.json()

            if not data.get("success"):
                return "❌ Kunne ikke hente usage stats."

            stats = data["data"]
            total = stats.get("total_requests_logged", 0)
            recent = stats.get("recent_requests", [])

            lines = [f"## Mercury Fold Usage", f"**{total}** total requests logged\n"]
            if recent:
                lines.append("### Recent")
                for r in recent[:5]:
                    lines.append(f"- `{r.get('timestamp', '?')}` — {r.get('input_tokens', 0)} in / {r.get('output_tokens', 0)} out ({r.get('duration_ms', 0)}ms)")

            return "\n".join(lines)

        except Exception as e:
            return f"❌ Usage stats fejl: {e}"
