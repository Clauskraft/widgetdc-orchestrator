"""
title: WidgeTDC MCP Bridge
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Open WebUI Tool — Call any of 140+ MCP tools from chat. Universal bridge between Open WebUI and WidgeTDC backend MCP ecosystem. SNOUT-19 (LIN-585).
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
        BACKEND_URL: str = Field(
            default="https://backend-production-d3da.up.railway.app",
            description="WidgeTDC Backend URL",
        )
        BACKEND_API_KEY: str = Field(
            default="",
            description="Backend API key (Bearer token)",
        )
        ORCHESTRATOR_URL: str = Field(
            default="https://orchestrator-production-c27e.up.railway.app",
            description="WidgeTDC Orchestrator URL (for orchestrator tools)",
        )
        ORCHESTRATOR_API_KEY: str = Field(
            default="",
            description="Orchestrator API key",
        )

    def __init__(self):
        self.valves = self.Valves()

    async def _mcp(self, tool: str, payload: dict = {}) -> dict:
        """Call backend MCP tool."""
        url = f"{self.valves.BACKEND_URL}/api/mcp/route"
        headers = {
            "Authorization": f"Bearer {self.valves.BACKEND_API_KEY}",
            "Content-Type": "application/json",
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                json={"tool": tool, "payload": payload},
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                return await resp.json()

    async def _orch_tool(self, tool_name: str, args: dict = {}) -> dict:
        """Call orchestrator tool via gateway."""
        url = f"{self.valves.ORCHESTRATOR_URL}/api/tools/{tool_name}"
        headers = {
            "Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}",
            "Content-Type": "application/json",
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                json=args,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                return await resp.json()

    async def mcp_call(self, tool_name: str, payload: str = "{}", __user__: dict = {}) -> str:
        """
        Call any MCP tool on the WidgeTDC backend by name. Over 140 tools available.
        Use `mcp_list_tools` first to discover available tools.

        :param tool_name: MCP tool name (e.g. 'srag.query', 'graph.read_cypher', 'omega.sitrep')
        :param payload: JSON string with tool arguments (e.g. '{"query": "NIS2 compliance"}')
        """
        try:
            args = json.loads(payload) if isinstance(payload, str) else payload
        except json.JSONDecodeError:
            return f"Invalid JSON payload: {payload}"

        try:
            data = await self._mcp(tool_name, args)
            result = data.get("result", data)

            if isinstance(result, dict):
                return json.dumps(result, indent=2, ensure_ascii=False)[:3000]
            return str(result)[:3000]
        except Exception as e:
            return f"MCP call failed: {e}"

    async def mcp_list_tools(self, namespace: str = "", __user__: dict = {}) -> str:
        """
        List available MCP tools. Optionally filter by namespace.
        Common namespaces: graph, srag, omega, autonomous, audit, harvest, agent, rlm, legal.

        :param namespace: Filter by namespace prefix (e.g. 'graph', 'omega'). Leave empty for all.
        """
        try:
            data = await self._mcp("agent.capabilities", {})
            result = data.get("result", {})
            tools = result.get("capabilities", []) if isinstance(result, dict) else []

            if namespace:
                tools = [t for t in tools if isinstance(t, str) and t.startswith(namespace)]

            if not tools:
                return f"No tools found{f' for namespace {namespace}' if namespace else ''}."

            # Group by namespace
            grouped = {}
            for t in tools[:200]:
                ns = t.split(".")[0] if "." in t else "other"
                grouped.setdefault(ns, []).append(t)

            lines = []
            for ns, ts in sorted(grouped.items()):
                lines.append(f"**{ns}** ({len(ts)} tools)")
                for t in ts[:10]:
                    lines.append(f"  - `{t}`")
                if len(ts) > 10:
                    lines.append(f"  ... and {len(ts) - 10} more")

            return f"**{len(tools)} MCP tools available:**\n\n" + "\n".join(lines)
        except Exception as e:
            return f"Failed to list tools: {e}"

    async def orchestrator_tool(self, tool_name: str, args: str = "{}", __user__: dict = {}) -> str:
        """
        Call an orchestrator tool (32 tools: search_knowledge, moa_query, judge_response, forge_tool, etc.).
        Use this for orchestrator-native tools that aren't MCP backend tools.

        :param tool_name: Orchestrator tool name (e.g. 'search_knowledge', 'moa_query', 'critique_refine')
        :param args: JSON string with tool arguments
        """
        try:
            parsed_args = json.loads(args) if isinstance(args, str) else args
        except json.JSONDecodeError:
            return f"Invalid JSON args: {args}"

        try:
            data = await self._orch_tool(tool_name, parsed_args)
            if data.get("success"):
                result = data.get("data", {}).get("result", data.get("data", {}))
                if isinstance(result, str):
                    return result[:3000]
                return json.dumps(result, indent=2, ensure_ascii=False)[:3000]
            else:
                error = data.get("error", {})
                return f"Error: {error.get('message', str(error))}"
        except Exception as e:
            return f"Orchestrator tool failed: {e}"
