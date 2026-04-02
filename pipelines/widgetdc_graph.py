"""
title: WidgeTDC Graph Intelligence
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Open WebUI Tool — Knowledge Graph hygiene, health checks, and certified decisions. Immutable truths from the Neo4j knowledge graph. Manifestopunkt #5 + #7.
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
        BACKEND_URL: str = Field(
            default="https://backend-production-d3da.up.railway.app",
            description="WidgeTDC Backend URL (for Neo4j queries)",
        )
        BACKEND_API_KEY: str = Field(
            default="",
            description="Backend API key",
        )

    def __init__(self):
        self.valves = self.Valves()

    async def _orch_call(self, path: str, method: str = "GET", body: dict = None) -> dict:
        url = f"{self.valves.ORCHESTRATOR_URL}{path}"
        headers = {"Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}", "Content-Type": "application/json"}
        async with aiohttp.ClientSession() as session:
            if method == "POST":
                async with session.post(url, headers=headers, json=body or {}, timeout=aiohttp.ClientTimeout(total=120)) as resp:
                    return await resp.json()
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                return await resp.json()

    async def _graph_query(self, cypher: str) -> list:
        url = f"{self.valves.BACKEND_URL}/api/mcp/route"
        headers = {"Authorization": f"Bearer {self.valves.BACKEND_API_KEY}", "Content-Type": "application/json"}
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json={"tool": "graph.read_cypher", "payload": {"query": cypher}}, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                data = await resp.json()
                return data.get("result", {}).get("results", [])

    def _neo4j_int(self, val) -> int:
        if val is None:
            return 0
        if isinstance(val, int):
            return val
        if isinstance(val, dict) and "low" in val:
            return val["low"]
        return int(val) if str(val).isdigit() else 0

    async def graph_health(self, __user__: dict = {}) -> str:
        """
        Check knowledge graph health — node counts, relationship stats, bloat indicators.
        Call when the user asks about: graph status, Neo4j health, knowledge base, ontology.
        """
        try:
            nodes = await self._graph_query("MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count ORDER BY count DESC LIMIT 15")
            rels = await self._graph_query("MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS cnt ORDER BY cnt DESC LIMIT 10")

            total_nodes = sum(self._neo4j_int(r.get("count")) for r in nodes)
            total_rels = sum(self._neo4j_int(r.get("cnt")) for r in rels)

            lines = [
                "## 🧠 Knowledge Graph Health",
                f"**{total_nodes:,} nodes** across {len(nodes)} labels | **{total_rels:,} relationships**\n",
                "### Top Node Labels",
            ]
            for r in nodes[:10]:
                label = r.get("label", "?")
                count = self._neo4j_int(r.get("count"))
                lines.append(f"- **{label}**: {count:,}")

            lines.append("\n### Top Relationship Types")
            for r in rels[:8]:
                rtype = r.get("type", "?")
                count = self._neo4j_int(r.get("cnt"))
                bloat = " ⚠️ **BLOAT**" if count > 1_000_000 else ""
                lines.append(f"- `{rtype}`: {count:,}{bloat}")

            return "\n".join(lines)

        except Exception as e:
            return f"❌ Graph health fejl: {e}"

    async def run_graph_hygiene(self, operation: str = "all", __user__: dict = {}) -> str:
        """
        Run graph cleanup operations to improve knowledge quality.
        Operations: all | framework_domain_rels | domain_consolidation | graph_bloat_purge

        :param operation: Which operation to run (default: all)
        """
        try:
            if operation == "all":
                data = await self._orch_call("/api/graph-hygiene/run", "POST")
            else:
                data = await self._orch_call(f"/api/graph-hygiene/fix/{operation}", "POST")

            if not data.get("success"):
                return f"❌ Hygiene fejlede: {data.get('error', {}).get('message', '?')}"

            if operation == "all":
                report = data["data"]
                lines = [
                    f"## 🧹 Graph Hygiene Report",
                    f"**{report['total_fixed']}** fixes applied in {report['duration_ms']}ms\n",
                ]
                for op in report.get("operations", []):
                    emoji = {"P0": "🔴", "P1": "🟡", "P2": "🔵"}.get(op["severity"], "⚪")
                    lines.append(f"{emoji} **[{op['severity']}] {op['operation']}**: {op['before']} → {op['after']} (fixed: {op['fixed']})")
                    lines.append(f"   _{op['details']}_\n")
                return "\n".join(lines)
            else:
                result = data["data"]
                return f"✅ **{result['operation']}** [{result['severity']}]: {result['before']} → {result['after']} (fixed: {result['fixed']})\n_{result['details']}_"

        except Exception as e:
            return f"❌ Hygiene fejl: {e}"

    async def search_knowledge(self, query: str, __user__: dict = {}) -> str:
        """
        Search the WidgeTDC knowledge graph using hybrid RAG (graphrag + semantic + cypher).
        Use for any question about consulting frameworks, regulations, architecture patterns, etc.

        :param query: Natural language search query
        """
        try:
            url = f"{self.valves.ORCHESTRATOR_URL}/api/tools/search_knowledge"
            headers = {"Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}", "Content-Type": "application/json"}
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json={"query": query}, timeout=aiohttp.ClientTimeout(total=45)) as resp:
                    data = await resp.json()

            if data.get("success"):
                result = data.get("data", {}).get("result", "")
                return str(result) if result else "Ingen resultater fundet."
            return f"❌ Søgning fejlede: {data.get('error', {}).get('message', '?')}"

        except Exception as e:
            return f"❌ Knowledge search fejl: {e}"
