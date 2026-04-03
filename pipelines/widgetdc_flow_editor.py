"""
title: WidgeTDC Flow Editor
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Open WebUI Tool — Interactive process flow diagrams in chat via React Flow. Visualize workflows, agent chains, and data pipelines. SNOUT-18 (LIN-588).
requirements: aiohttp
"""

from pydantic import BaseModel, Field
import aiohttp
import json
import logging
import html

logger = logging.getLogger(__name__)


class Tools:
    class Valves(BaseModel):
        BACKEND_URL: str = Field(
            default="https://backend-production-d3da.up.railway.app",
            description="WidgeTDC Backend URL",
        )
        BACKEND_API_KEY: str = Field(
            default="",
            description="Backend API key",
        )
        ORCHESTRATOR_URL: str = Field(
            default="https://orchestrator-production-c27e.up.railway.app",
            description="Orchestrator URL",
        )
        ORCHESTRATOR_API_KEY: str = Field(
            default="",
            description="Orchestrator API key",
        )

    def __init__(self):
        self.valves = self.Valves()

    async def _orch_get(self, path: str) -> dict:
        url = f"{self.valves.ORCHESTRATOR_URL}{path}"
        headers = {"Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}"}
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                return await resp.json()

    async def visualize_chain(self, chain_id: str = "", __user__: dict = {}) -> str:
        """
        Visualize an agent chain execution as an interactive flow diagram.
        Shows steps, agents, tool calls, and status with directed edges.
        If no chain_id, shows the most recent execution.

        :param chain_id: Chain execution ID (leave empty for most recent)
        """
        try:
            if chain_id:
                data = await self._orch_get(f"/api/chains/{chain_id}")
            else:
                data = await self._orch_get("/api/chains")
                executions = data.get("data", {}).get("executions", [])
                if not executions:
                    return "No chain executions found."
                data = {"data": executions[0]}

            chain = data.get("data", {})
            if not chain:
                return f"Chain '{chain_id}' not found."

            return self._render_chain_flow(chain)
        except Exception as e:
            return f"Failed to load chain: {e}"

    async def visualize_crons(self, __user__: dict = {}) -> str:
        """
        Visualize all 20+ cron jobs as an interactive flow diagram.
        Shows job dependencies, schedules, and last run status.
        """
        try:
            data = await self._orch_get("/api/cron")
            crons = data.get("data", {}).get("jobs", [])
            if not crons:
                return "No cron jobs found."

            return self._render_cron_flow(crons)
        except Exception as e:
            return f"Failed to load crons: {e}"

    async def visualize_pipeline(self, description: str, __user__: dict = {}) -> str:
        """
        Generate a flow diagram from a natural language description.
        Describe a process, workflow, or data pipeline and get an interactive visualization.

        Example: "User submits query → classify complexity → route to agents → parallel execution → merge consensus → return"

        :param description: Natural language description of the flow (use → for connections)
        """
        # Parse description into nodes and edges
        steps = [s.strip() for s in description.replace("->", "→").split("→") if s.strip()]

        if len(steps) < 2:
            return "Please describe a flow with at least 2 steps connected by → arrows."

        nodes = []
        edges = []
        for i, step in enumerate(steps):
            nodes.append({
                "id": f"step-{i}",
                "data": {"label": step[:40]},
                "position": {"x": 50 + (i % 4) * 250, "y": 50 + (i // 4) * 120},
            })
            if i > 0:
                edges.append({
                    "id": f"e-{i-1}-{i}",
                    "source": f"step-{i-1}",
                    "target": f"step-{i}",
                    "animated": True,
                })

        return self._render_reactflow(nodes, edges, f"Flow: {steps[0][:20]}...→...{steps[-1][:20]}")

    def _render_chain_flow(self, chain: dict) -> str:
        steps = chain.get("results", chain.get("steps", []))
        name = chain.get("name", "Chain")
        mode = chain.get("mode", "sequential")

        nodes = []
        edges = []

        # Start node
        nodes.append({"id": "start", "data": {"label": f"⚡ {name} ({mode})"}, "position": {"x": 200, "y": 0}})

        for i, step in enumerate(steps):
            agent = step.get("agent_id", f"step-{i}")
            tool = step.get("tool_name", "")
            status = step.get("status", "pending")
            color = "#2ecc71" if status == "success" else "#e74c3c" if status == "error" else "#f39c12"
            label = f"{agent}" + (f"\n{tool}" if tool else "")

            nodes.append({
                "id": f"step-{i}",
                "data": {"label": label[:50]},
                "position": {"x": 50 + (i % 3) * 250, "y": 100 + (i // 3) * 120},
                "style": {"borderColor": color, "borderWidth": 2},
            })

            if mode == "parallel":
                edges.append({"id": f"e-start-{i}", "source": "start", "target": f"step-{i}", "animated": True})
            else:
                src = "start" if i == 0 else f"step-{i-1}"
                edges.append({"id": f"e-{i}", "source": src, "target": f"step-{i}", "animated": True})

        return self._render_reactflow(nodes, edges, f"Chain: {name}")

    def _render_cron_flow(self, crons: list) -> str:
        nodes = []
        edges = []

        # Scheduler hub
        nodes.append({"id": "scheduler", "data": {"label": "⏰ Cron Scheduler"}, "position": {"x": 300, "y": 0}})

        for i, cron in enumerate(crons):
            name = cron.get("name", cron.get("id", f"cron-{i}"))
            schedule = cron.get("schedule", "")
            enabled = cron.get("enabled", True)
            status = cron.get("last_status", "unknown")
            color = "#2ecc71" if enabled and status == "completed" else "#e74c3c" if not enabled else "#f39c12"

            nodes.append({
                "id": f"cron-{i}",
                "data": {"label": f"{name}\n{schedule}"},
                "position": {"x": 50 + (i % 4) * 180, "y": 100 + (i // 4) * 100},
                "style": {"borderColor": color, "borderWidth": 2},
            })
            edges.append({"id": f"e-{i}", "source": "scheduler", "target": f"cron-{i}"})

        return self._render_reactflow(nodes, edges, f"Cron Jobs ({len(crons)})")

    def _render_reactflow(self, nodes: list, edges: list, title: str) -> str:
        nodes_json = json.dumps(nodes, ensure_ascii=False)
        edges_json = json.dumps(edges, ensure_ascii=False)
        esc_title = html.escape(title)

        return f"""<html>
<head>
<style>
  body {{ font-family: -apple-system, sans-serif; margin: 0; padding: 16px; background: #1a1a2e; color: #e0e0e0; }}
  h2 {{ margin: 0 0 12px; font-size: 18px; color: #00d4ff; }}
  .info {{ font-size: 12px; color: #888; margin-bottom: 8px; }}
  #flow {{ height: 500px; width: 100%; border: 1px solid #333; border-radius: 8px; background: #0f0f23; position: relative; overflow: hidden; }}
  .node {{ position: absolute; padding: 10px 16px; border: 2px solid #3498db; border-radius: 8px; background: #16213e; color: #e0e0e0; font-size: 12px; white-space: pre-line; text-align: center; cursor: move; transition: box-shadow 0.2s; }}
  .node:hover {{ box-shadow: 0 0 12px rgba(0,212,255,0.4); }}
  svg {{ position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }}
  line {{ stroke: #555; stroke-width: 1.5; marker-end: url(#arrow); }}
</style>
</head>
<body>
  <h2>{esc_title}</h2>
  <div class="info">{len(nodes)} nodes, {len(edges)} edges</div>
  <div id="flow">
    <svg><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#555"/></marker></defs></svg>
  </div>
  <script>
    const nodes = {nodes_json};
    const edges = {edges_json};
    const flow = document.getElementById('flow');
    const svg = flow.querySelector('svg');

    // Render nodes
    const nodeEls = {{}};
    nodes.forEach(n => {{
      const el = document.createElement('div');
      el.className = 'node';
      el.style.left = (n.position?.x || 0) + 'px';
      el.style.top = (n.position?.y || 0) + 'px';
      if (n.style?.borderColor) el.style.borderColor = n.style.borderColor;
      el.textContent = n.data?.label || n.id;
      flow.appendChild(el);
      nodeEls[n.id] = el;
    }});

    // Render edges
    setTimeout(() => {{
      edges.forEach(e => {{
        const src = nodeEls[e.source];
        const tgt = nodeEls[e.target];
        if (!src || !tgt) return;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', src.offsetLeft + src.offsetWidth / 2);
        line.setAttribute('y1', src.offsetTop + src.offsetHeight);
        line.setAttribute('x2', tgt.offsetLeft + tgt.offsetWidth / 2);
        line.setAttribute('y2', tgt.offsetTop);
        svg.appendChild(line);
      }});
    }}, 50);
  </script>
</body>
</html>"""
