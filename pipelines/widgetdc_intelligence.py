"""
title: WidgeTDC Intelligence Suite
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Open WebUI Tool — Red Queen failure analysis + Competitive Phagocytosis intelligence. The Cognitive Boardroom for platform intelligence. Manifestopunkt #3 + #7.
requirements: aiohttp
"""

from typing import Optional
from pydantic import BaseModel, Field
import aiohttp
import json
import logging

logger = logging.getLogger(__name__)


class Tools:
    class Valves(BaseModel):
        ORCHESTRATOR_URL: str = Field(
            default="https://orchestrator-production-c27e.up.railway.app",
            description="WidgeTDC Orchestrator base URL",
        )
        ORCHESTRATOR_API_KEY: str = Field(
            default="",
            description="Orchestrator API key (Bearer token)",
        )
        BACKEND_URL: str = Field(
            default="https://backend-production-d3da.up.railway.app",
            description="WidgeTDC Backend URL (for intent.resolve + proactive.queue)",
        )
        BACKEND_API_KEY: str = Field(
            default="",
            description="Backend API key",
        )

    def __init__(self):
        self.valves = self.Valves()

    async def _call(self, path: str, method: str = "GET", body: dict = None) -> dict:
        """Internal: call orchestrator endpoint."""
        url = f"{self.valves.ORCHESTRATOR_URL}{path}"
        headers = {
            "Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}",
            "Content-Type": "application/json",
        }
        async with aiohttp.ClientSession() as session:
            if method == "POST":
                async with session.post(url, headers=headers, json=body or {}, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                    return await resp.json()
            else:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                    return await resp.json()

    async def _mcp(self, tool: str, payload: dict = {}) -> dict:
        """Internal: call backend MCP tool."""
        url = f"{self.valves.BACKEND_URL}/api/mcp/route"
        headers = {
            "Authorization": f"Bearer {self.valves.BACKEND_API_KEY}",
            "Content-Type": "application/json",
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json={"tool": tool, "payload": payload}, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                return await resp.json()

    async def intent_resolve(self, query: str, __user__: dict = {}) -> str:
        """
        Find the best tools for a natural language intent using Neo4j graph routing (LIN-576).
        The graph learns from every tool execution — routing improves over time.
        Call this when the user asks: what tool should I use, how do I do X, find a tool for Y.

        :param query: Natural language description of what the user wants to do
        """
        try:
            data = await self._mcp("intent.resolve", {"query": query})
            result = data.get("result", {})

            if isinstance(result, dict) and result.get("tools"):
                tools = result["tools"]
                lines = [f"## 🎯 Intent Resolution: '{query}'", f"**{len(tools)} matching tools** found\n"]
                for t in tools[:8]:
                    conf = t.get("confidence", 0)
                    bar = "█" * int(conf * 10) + "░" * (10 - int(conf * 10))
                    lines.append(f"- **`{t.get('name', '?')}`** [{bar}] {conf:.0%}")
                    if t.get("description"):
                        lines.append(f"  _{t['description'][:80]}_")
                return "\n".join(lines)
            return f"Ingen matching tools fundet for '{query}'."
        except Exception as e:
            return f"⚠️ Intent resolution ikke tilgængelig: {e}"

    async def proactive_notifications(self, __user__: dict = {}) -> str:
        """
        Check the proactive notification queue (LIN-575).
        Shows confidence-gated findings from platform crons — things the system
        discovered before you asked. Anticipatory Intelligence.
        """
        try:
            data = await self._mcp("proactive.queue", {})
            result = data.get("result", {})

            if isinstance(result, dict):
                notifications = result.get("notifications", result.get("queue", []))
                if not notifications:
                    return "📭 Ingen proaktive notifikationer. Systemet har ikke fundet noget der kræver opmærksomhed."

                lines = [f"## 🔔 Proactive Notifications", f"**{len(notifications)} findings**\n"]
                for n in notifications[:10]:
                    severity = n.get("severity", "info")
                    emoji = {"critical": "🔴", "warning": "🟡", "info": "🔵"}.get(severity, "⚪")
                    conf = n.get("confidence", 0)
                    lines.append(f"{emoji} **{n.get('title', '?')}** (confidence: {conf:.0%})")
                    if n.get("description"):
                        lines.append(f"   _{n['description'][:100]}_")
                return "\n".join(lines)
            return str(result)[:500]
        except Exception as e:
            return f"⚠️ Proactive queue ikke tilgængelig: {e}"

    async def failure_analysis(self, __user__: dict = {}) -> str:
        """
        Analyze platform failure patterns from the Red Queen harvester.
        Shows what's breaking, how often, which tools and agents are affected.
        Call this when the user asks about: failures, errors, what's breaking, platform health, system issues.
        """
        try:
            data = await self._call("/api/failures/summary")
            if not data.get("success"):
                return "❌ Kunne ikke hente failure data."

            summary = data["data"]
            total = summary.get("total_failures", 0)
            cats = summary.get("by_category", {})
            top_tools = summary.get("top_tools", [])
            top_agents = summary.get("top_agents", [])
            window = summary.get("window_hours", 24)

            lines = [
                f"## 🔴 Red Queen Failure Analysis ({window}h window)",
                f"**{total} failures** detected\n",
                "### By Category",
            ]
            for cat, count in sorted(cats.items(), key=lambda x: -x[1]):
                if count > 0:
                    emoji = {"502": "🔌", "timeout": "⏱️", "auth": "🔐", "validation": "⚠️", "mcp_error": "🔧"}.get(cat, "❓")
                    lines.append(f"- {emoji} **{cat}**: {count}")

            if top_tools:
                lines.append("\n### Top Failing Tools")
                for t in top_tools[:5]:
                    pct = round(t["count"] / total * 100) if total else 0
                    lines.append(f"- `{t['tool']}` — {t['count']}× ({pct}%)")

            if top_agents:
                lines.append("\n### Affected Agents")
                for a in top_agents[:5]:
                    lines.append(f"- `{a['agent']}` — {a['count']}×")

            # Recent failures sample
            recent = summary.get("recent", [])
            if recent:
                lines.append("\n### Latest Failures")
                for f in recent[:3]:
                    lines.append(f"- **[{f['category']}]** {f['chain_name'][:40]} — _{f['error_message'][:80]}_")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"failure_analysis error: {e}")
            return f"❌ Fejl ved failure analyse: {e}"

    async def competitive_intel(self, __user__: dict = {}) -> str:
        """
        Get competitive intelligence — what capabilities do competitors have that we don't?
        Analyzes 5 competitors: Palantir AIP, Dust.tt, Glean, LangGraph, Copilot Studio.
        Call this when the user asks about: competitors, competitive analysis, market gaps, what others are doing.
        """
        try:
            data = await self._call("/api/competitive/report")
            if not data.get("success"):
                return "❌ Kunne ikke hente competitive rapport."

            report = data.get("data")
            if not report or report.get("total_capabilities_found", 0) == 0:
                return "ℹ️ Ingen competitive rapport endnu. Brug `trigger_competitive_crawl` for at starte en analyse."

            total = report["total_capabilities_found"]
            by_comp = report.get("by_competitor", {})
            gaps = report.get("gaps", [])
            strengths = report.get("strengths", [])

            lines = [
                f"## 🔍 Competitive Intelligence Report",
                f"**{total} capabilities** identificeret hos konkurrenter\n",
                "### Capabilities per Competitor",
            ]
            for comp, count in sorted(by_comp.items(), key=lambda x: -x[1]):
                lines.append(f"- **{comp}**: {count} capabilities")

            if gaps:
                lines.append(f"\n### ❌ Gaps ({len(gaps)} capabilities vi mangler)")
                for g in gaps[:8]:
                    comps = ", ".join(g["competitors_with"])
                    lines.append(f"- **{g['capability'][:70]}**\n  _Hos: {comps}_")

            if strengths:
                lines.append("\n### ✅ WidgeTDC Strengths (unikke fordele)")
                for s in strengths:
                    lines.append(f"- ✦ {s}")

            lines.append(f"\n_Genereret: {report.get('generated_at', '?')}_")
            return "\n".join(lines)

        except Exception as e:
            logger.error(f"competitive_intel error: {e}")
            return f"❌ Fejl ved competitive analyse: {e}"

    async def trigger_failure_harvest(self, window_hours: int = 24, __user__: dict = {}) -> str:
        """
        Trigger a fresh failure harvest scan. Scans Redis for failed chain executions.
        Use when you need the latest failure data, not cached results.

        :param window_hours: How many hours back to scan (1-720, default 24)
        """
        try:
            data = await self._call("/api/failures/harvest", "POST", {"window_hours": window_hours})
            if data.get("success"):
                total = data["data"].get("total_failures", 0)
                return f"✅ Harvest complete: **{total} failures** fundet i seneste {window_hours}h."
            return f"❌ Harvest fejlede: {data.get('error', {}).get('message', '?')}"
        except Exception as e:
            return f"❌ Harvest fejl: {e}"

    async def trigger_competitive_crawl(self, __user__: dict = {}) -> str:
        """
        Trigger a competitive crawl of 5 competitors' public documentation.
        Fetches web pages, extracts capabilities via LLM, persists to Neo4j.
        Takes 1-2 minutes. Has 1-hour cooldown between crawls.
        """
        try:
            data = await self._call("/api/competitive/crawl", "POST")
            if data.get("success"):
                total = data["data"].get("total_capabilities_found", 0)
                gaps = len(data["data"].get("gaps", []))
                return f"✅ Crawl complete: **{total} capabilities** fundet, **{gaps} gaps** identificeret."
            code = data.get("error", {}).get("code", "?")
            msg = data.get("error", {}).get("message", "?")
            return f"⚠️ {code}: {msg}"
        except Exception as e:
            return f"❌ Crawl fejl: {e}"

    async def platform_pulse(self, __user__: dict = {}) -> str:
        """
        Get a complete platform health pulse — combines health check, failures, and competitive status.
        Call this when the user asks about: status, how is the platform, what's going on, overview.
        """
        try:
            health_data = await self._call("/health")
            failure_data = await self._call("/api/failures/summary")
            comp_data = await self._call("/api/competitive/report")

            version = health_data.get("version", "?")
            status = health_data.get("status", "?")
            agents = health_data.get("agents_registered", 0)
            crons = health_data.get("cron_jobs", 0)
            redis = "✓" if health_data.get("redis_enabled") else "✗"
            rlm = "✓" if health_data.get("rlm_available") else "✗"

            failures = failure_data.get("data", {}).get("total_failures", 0) if failure_data.get("success") else "?"
            top_fail = ""
            if failure_data.get("success"):
                tools = failure_data["data"].get("top_tools", [])
                if tools:
                    top_fail = f" (top: `{tools[0]['tool']}` {tools[0]['count']}×)"

            comp_total = comp_data.get("data", {}).get("total_capabilities_found", 0) if comp_data.get("success") and comp_data.get("data") else 0
            comp_gaps = len(comp_data.get("data", {}).get("gaps", [])) if comp_data.get("success") and comp_data.get("data") else 0

            lines = [
                f"## WidgeTDC Platform Pulse",
                f"**v{version}** • {status.upper()} • {agents} agents • {crons} crons",
                f"Redis {redis} • RLM {rlm}\n",
                f"🔴 **{failures} failures** (24h){top_fail}",
                f"🔍 **{comp_total} competitive capabilities** tracked ({comp_gaps} gaps)",
                f"\n_Timestamp: {health_data.get('timestamp', '?')}_",
            ]
            return "\n".join(lines)

        except Exception as e:
            return f"❌ Platform pulse fejl: {e}"
