"""
title: WidgeTDC Graph Explorer
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Open WebUI Tool — Interactive graph visualization in chat via Cytoscape.js + Neo4j MCP. Explore nodes, relationships, and neighborhoods. SNOUT-16 (LIN-586).
requirements: aiohttp
"""

from pydantic import BaseModel, Field
import aiohttp
import json
import logging
import html

logger = logging.getLogger(__name__)

# Node colors by label (matching WidgeTDC canvas palette)
LABEL_COLORS = {
    "Domain": "#e74c3c", "Agent": "#3498db", "Tool": "#2ecc71", "Service": "#9b59b6",
    "Pattern": "#f39c12", "Lesson": "#1abc9c", "StrategicInsight": "#e67e22",
    "Knowledge": "#27ae60", "Capability": "#2980b9", "Framework": "#8e44ad",
    "Organization": "#c0392b", "ConsultingService": "#16a085", "VectorDocument": "#7f8c8d",
    "ComplianceGap": "#d35400", "McKinseyInsight": "#2c3e50", "FailureMemory": "#c0392b",
    "EvolutionEvent": "#f1c40f", "GraphHealthSnapshot": "#95a5a6",
    "CommunitySummary": "#1abc9c", "ErrorPattern": "#e74c3c",
}
DEFAULT_COLOR = "#95a5a6"


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

    def __init__(self):
        self.valves = self.Valves()

    async def _cypher(self, query: str) -> list:
        url = f"{self.valves.BACKEND_URL}/api/mcp/route"
        headers = {
            "Authorization": f"Bearer {self.valves.BACKEND_API_KEY}",
            "Content-Type": "application/json",
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                json={"tool": "graph.read_cypher", "payload": {"query": query}},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                result = data.get("result", {})
                return result.get("results", []) if isinstance(result, dict) else (result if isinstance(result, list) else [])

    async def explore_neighborhood(self, node_name: str, depth: int = 1, limit: int = 30, __user__: dict = {}) -> str:
        """
        Explore a node's neighborhood as an interactive graph visualization.
        Shows the node and its connected neighbors up to the specified depth.

        :param node_name: Name or ID of the node to explore (e.g. 'Neo4j', 'omega', 'NIS2')
        :param depth: How many hops to explore (1-3, default: 1)
        :param limit: Max neighbor nodes (default: 30, max: 100)
        """
        safe_depth = min(max(int(depth), 1), 3)
        safe_limit = min(max(int(limit), 5), 100)

        query = f"""
        MATCH (center) WHERE center.name = $name OR center.id = $name
        WITH center LIMIT 1
        CALL apoc.path.subgraphAll(center, {{maxLevel: {safe_depth}, limit: {safe_limit}}})
        YIELD nodes, relationships
        UNWIND nodes AS n
        WITH collect(DISTINCT {{
            id: elementId(n),
            label: labels(n)[0],
            name: coalesce(n.name, n.title, n.id, elementId(n))
        }}) AS nodeList, relationships
        UNWIND relationships AS r
        RETURN nodeList,
               collect(DISTINCT {{
                   source: elementId(startNode(r)),
                   target: elementId(endNode(r)),
                   type: type(r)
               }}) AS edgeList
        """

        # Fallback if APOC not available
        fallback_query = f"""
        MATCH (center) WHERE center.name = $name OR center.id = $name
        WITH center LIMIT 1
        MATCH path = (center)-[r*1..{safe_depth}]-(neighbor)
        WITH center, collect(DISTINCT neighbor)[..{safe_limit}] AS neighbors,
             collect(DISTINCT r) AS allRels
        UNWIND ([center] + neighbors) AS n
        WITH collect(DISTINCT {{
            id: elementId(n),
            label: labels(n)[0],
            name: coalesce(n.name, n.title, n.id, elementId(n))
        }}) AS nodeList
        RETURN nodeList, [] AS edgeList
        """

        try:
            rows = await self._cypher(query.replace("$name", f"'{node_name}'"))
            if not rows:
                rows = await self._cypher(fallback_query.replace("$name", f"'{node_name}'"))
        except Exception:
            try:
                rows = await self._cypher(fallback_query.replace("$name", f"'{node_name}'"))
            except Exception as e:
                return f"Graph query failed: {e}"

        if not rows:
            return f"Node '{node_name}' not found in the knowledge graph."

        row = rows[0]
        nodes = row.get("nodeList", [])
        edges = row.get("edgeList", [])

        return self._render_graph(nodes, edges, f"Neighborhood: {node_name} (depth {safe_depth})")

    async def explore_label(self, label: str, limit: int = 30, __user__: dict = {}) -> str:
        """
        Visualize nodes of a specific label and their relationships as an interactive graph.

        :param label: Node label (e.g. 'Domain', 'Agent', 'Tool', 'Service')
        :param limit: Max nodes to show (default: 30)
        """
        safe_limit = min(max(int(limit), 5), 100)

        query = f"""
        MATCH (n:{label})
        WITH n LIMIT {safe_limit}
        OPTIONAL MATCH (n)-[r]-(m)
        WITH collect(DISTINCT {{
            id: elementId(n), label: labels(n)[0],
            name: coalesce(n.name, n.title, n.id, elementId(n))
        }}) + collect(DISTINCT {{
            id: elementId(m), label: labels(m)[0],
            name: coalesce(m.name, m.title, m.id, elementId(m))
        }}) AS allNodes,
        collect(DISTINCT {{
            source: elementId(startNode(r)),
            target: elementId(endNode(r)),
            type: type(r)
        }}) AS edges
        RETURN allNodes AS nodeList, edges AS edgeList
        """

        try:
            rows = await self._cypher(query)
        except Exception as e:
            return f"Graph query failed: {e}"

        if not rows:
            return f"No nodes found with label `{label}`."

        row = rows[0]
        nodes = row.get("nodeList", [])
        edges = row.get("edgeList", [])

        return self._render_graph(nodes, edges, f"{label} nodes ({len(nodes)} nodes)")

    def _render_graph(self, nodes: list, edges: list, title: str) -> str:
        """Render Cytoscape.js graph as HTML."""
        # Deduplicate nodes by id
        seen = set()
        unique_nodes = []
        for n in nodes:
            nid = n.get("id", "")
            if nid and nid not in seen:
                seen.add(nid)
                label = n.get("label", "Unknown")
                color = LABEL_COLORS.get(label, DEFAULT_COLOR)
                unique_nodes.append({
                    "data": {
                        "id": nid,
                        "label": html.escape(str(n.get("name", nid))[:30]),
                        "nodeLabel": label,
                        "color": color,
                    }
                })

        cy_edges = []
        for e in edges:
            src = e.get("source", "")
            tgt = e.get("target", "")
            if src and tgt and src in seen and tgt in seen:
                cy_edges.append({
                    "data": {
                        "source": src,
                        "target": tgt,
                        "label": e.get("type", ""),
                    }
                })

        elements = json.dumps(unique_nodes + cy_edges, ensure_ascii=False)
        esc_title = html.escape(title)

        return f"""<html>
<head>
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3/dist/cytoscape.min.js"></script>
<style>
  body {{ font-family: -apple-system, sans-serif; margin: 0; padding: 16px; background: #1a1a2e; color: #e0e0e0; }}
  h2 {{ margin: 0 0 12px; font-size: 18px; color: #00d4ff; }}
  .info {{ font-size: 12px; color: #888; margin-bottom: 8px; }}
  #cy {{ height: 500px; width: 100%; border: 1px solid #333; border-radius: 8px; background: #0f0f23; }}
  .legend {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 11px; }}
  .legend span {{ display: flex; align-items: center; gap: 4px; }}
  .legend .dot {{ width: 10px; height: 10px; border-radius: 50%; }}
</style>
</head>
<body>
  <h2>{esc_title}</h2>
  <div class="info">{len(unique_nodes)} nodes, {len(cy_edges)} edges</div>
  <div id="cy"></div>
  <div class="legend" id="legend"></div>
  <script>
    const cy = cytoscape({{
      container: document.getElementById('cy'),
      elements: {elements},
      style: [
        {{ selector: 'node', style: {{
          'background-color': 'data(color)',
          'label': 'data(label)',
          'color': '#ccc',
          'font-size': '10px',
          'text-valign': 'bottom',
          'text-margin-y': 4,
          'width': 24, 'height': 24,
        }}}},
        {{ selector: 'edge', style: {{
          'width': 1, 'line-color': '#555',
          'target-arrow-color': '#555',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '8px',
          'color': '#666',
        }}}},
        {{ selector: ':selected', style: {{
          'border-width': 3, 'border-color': '#00d4ff',
        }}}},
      ],
      layout: {{ name: 'cose', animate: false, nodeDimensionsIncludeLabels: true }},
    }});
    // Legend
    const labels = new Map();
    cy.nodes().forEach(n => labels.set(n.data('nodeLabel'), n.data('color')));
    const legend = document.getElementById('legend');
    labels.forEach((color, label) => {{
      legend.innerHTML += `<span><span class="dot" style="background:${{color}}"></span>${{label}}</span>`;
    }});
  </script>
</body>
</html>"""
