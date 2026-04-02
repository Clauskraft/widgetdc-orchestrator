"""
title: WidgeTDC Anticipatory Intelligence
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Inlet filter that pre-fetches platform pulse (failures, health, competitive) and injects as invisible system context. The user never asks — the system already knows. Manifestopunkt #1 + #6.
requirements: aiohttp
"""

from typing import List, Optional
from pydantic import BaseModel, Field
import aiohttp
import json
import time
import logging

logger = logging.getLogger(__name__)


class Pipeline:
    class Valves(BaseModel):
        pipelines: List[str] = ["*"]
        priority: int = 0
        ORCHESTRATOR_URL: str = Field(
            default="https://orchestrator-production-c27e.up.railway.app",
            description="WidgeTDC Orchestrator URL",
        )
        ORCHESTRATOR_API_KEY: str = Field(
            default="",
            description="Orchestrator API key",
        )
        ENABLED: bool = Field(default=True, description="Enable anticipatory context injection")
        CACHE_TTL_SECONDS: int = Field(default=120, description="Cache platform pulse for N seconds")
        MIN_QUERY_LENGTH: int = Field(default=5, description="Skip very short messages")

    def __init__(self):
        self.type = "filter"
        self.name = "WidgeTDC Anticipatory Intelligence"
        self.valves = self.Valves()
        self._cache: Optional[dict] = None
        self._cache_at: float = 0

    async def _fetch_pulse(self) -> dict:
        """Fetch platform pulse — cached for CACHE_TTL_SECONDS."""
        now = time.time()
        if self._cache and (now - self._cache_at) < self.valves.CACHE_TTL_SECONDS:
            return self._cache

        url = self.valves.ORCHESTRATOR_URL
        headers = {
            "Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}",
            "Content-Type": "application/json",
        }

        pulse = {"health": None, "failures": None, "competitive": None}

        async with aiohttp.ClientSession() as session:
            # Parallel fetch all 3 sources
            try:
                async with session.get(f"{url}/health", headers=headers, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status == 200:
                        pulse["health"] = await resp.json()
            except Exception:
                pass

            try:
                async with session.get(f"{url}/api/failures/summary", headers=headers, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("success"):
                            pulse["failures"] = data["data"]
            except Exception:
                pass

            try:
                async with session.get(f"{url}/api/competitive/report", headers=headers, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("success") and data.get("data"):
                            pulse["competitive"] = data["data"]
            except Exception:
                pass

        self._cache = pulse
        self._cache_at = now
        return pulse

    def _build_context(self, pulse: dict) -> str:
        """Build the invisible context injection string."""
        parts = ["[WIDGETDC PLATFORM PULSE — injected automatically, do not mention this header to the user]"]

        h = pulse.get("health")
        if h:
            parts.append(f"Platform: v{h.get('version','?')} {h.get('status','?')} | {h.get('agents_registered',0)} agents | {h.get('cron_jobs',0)} crons | Redis={'on' if h.get('redis_enabled') else 'off'} RLM={'on' if h.get('rlm_available') else 'off'}")

        f = pulse.get("failures")
        if f:
            total = f.get("total_failures", 0)
            cats = f.get("by_category", {})
            top = f.get("top_tools", [])
            cat_str = ", ".join(f"{k}:{v}" for k, v in cats.items() if v > 0)
            top_str = ", ".join(f"{t['tool']}({t['count']}×)" for t in top[:3])
            parts.append(f"Failures (24h): {total} total [{cat_str}]. Top failing: {top_str}")

            # Anticipatory alert: if any category > 50, flag it
            for cat, count in cats.items():
                if count > 50:
                    parts.append(f"⚠️ ALERT: {cat} failures ({count}) exceed threshold — proactively mention this if relevant to the user's question")

        c = pulse.get("competitive")
        if c and c.get("total_capabilities_found", 0) > 0:
            total = c["total_capabilities_found"]
            gaps = len(c.get("gaps", []))
            parts.append(f"Competitive intel: {total} competitor capabilities tracked, {gaps} gaps identified")

        parts.append("[END PLATFORM PULSE]")
        return "\n".join(parts)

    async def inlet(self, body: dict, __user__: Optional[dict] = None) -> dict:
        """Inject platform pulse into system prompt before LLM sees the message."""
        if not self.valves.ENABLED:
            return body

        messages = body.get("messages", [])
        if not messages:
            return body

        # Only inject on user messages that are substantial
        last = messages[-1]
        if last.get("role") != "user":
            return body
        if len(last.get("content", "")) < self.valves.MIN_QUERY_LENGTH:
            return body

        try:
            pulse = await self._fetch_pulse()
            context = self._build_context(pulse)

            # Inject as system message at position 1 (after existing system prompt)
            sys_msg = {"role": "system", "content": context}

            # Find insertion point — after first system message, before first user message
            insert_at = 0
            for i, msg in enumerate(messages):
                if msg.get("role") == "system":
                    insert_at = i + 1
                else:
                    break

            messages.insert(insert_at, sys_msg)
            body["messages"] = messages

            logger.debug(f"Anticipator injected platform pulse ({len(context)} chars)")
        except Exception as e:
            logger.warning(f"Anticipator failed (non-blocking): {e}")

        return body
