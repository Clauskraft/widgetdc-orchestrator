"""
title: WidgeTDC Data Browser
author: WidgeTDC
date: 2026-04-03
version: 1.0
license: MIT
description: Open WebUI Tool — Interactive sortable/filterable data tables in chat via AG Grid. Queries Neo4j graph and renders results as HTML tables. SNOUT-17 (LIN-587).
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

    def __init__(self):
        self.valves = self.Valves()

    async def _cypher(self, query: str, params: dict = {}) -> list:
        """Execute Cypher query via MCP."""
        url = f"{self.valves.BACKEND_URL}/api/mcp/route"
        headers = {
            "Authorization": f"Bearer {self.valves.BACKEND_API_KEY}",
            "Content-Type": "application/json",
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                headers=headers,
                json={"tool": "graph.read_cypher", "payload": {"query": query, "params": params}},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                data = await resp.json()
                result = data.get("result", {})
                return result.get("results", []) if isinstance(result, dict) else (result if isinstance(result, list) else [])

    async def browse_data(self, cypher_query: str, title: str = "Query Results", __user__: dict = {}) -> str:
        """
        Execute a Cypher query and render results as an interactive sortable table in chat.
        Uses AG Grid Community for sorting, filtering, and pagination.

        Example queries:
        - MATCH (n:Domain) RETURN n.name AS domain, n.description AS description LIMIT 20
        - MATCH (a:Agent) RETURN a.name AS name, a.status AS status, a.capabilities AS caps LIMIT 50
        - MATCH (t:Tool) RETURN t.name AS tool, t.namespace AS ns, t.status AS status ORDER BY t.name

        :param cypher_query: Cypher query (must include RETURN clause with named columns)
        :param title: Table title shown above the grid
        """
        try:
            rows = await self._cypher(cypher_query)
        except Exception as e:
            return f"Query failed: {e}"

        if not rows:
            return f"No results for query: `{cypher_query}`"

        # Extract columns from first row
        first = rows[0] if rows else {}
        columns = list(first.keys()) if isinstance(first, dict) else []

        if not columns:
            return f"Query returned {len(rows)} rows but no named columns. Use RETURN ... AS column_name."

        # Sanitize data
        safe_rows = []
        for row in rows[:500]:
            safe_row = {}
            for col in columns:
                val = row.get(col, "")
                if isinstance(val, dict) and "low" in val:
                    val = val["low"]  # Neo4j integer
                if isinstance(val, (list, dict)):
                    val = json.dumps(val, ensure_ascii=False)[:200]
                safe_row[col] = html.escape(str(val)) if val is not None else ""
            safe_rows.append(safe_row)

        col_defs = json.dumps([{"field": c, "sortable": True, "filter": True, "resizable": True} for c in columns])
        row_data = json.dumps(safe_rows, ensure_ascii=False)
        esc_title = html.escape(title)

        return f"""<html>
<head>
<script src="https://cdn.jsdelivr.net/npm/ag-grid-community@31/dist/ag-grid-community.min.js"></script>
<style>
  body {{ font-family: -apple-system, sans-serif; margin: 0; padding: 16px; background: #1a1a2e; color: #e0e0e0; }}
  h2 {{ margin: 0 0 12px; font-size: 18px; color: #00d4ff; }}
  .info {{ font-size: 12px; color: #888; margin-bottom: 8px; }}
  #grid {{ height: 400px; width: 100%; }}
  .ag-theme-alpine-dark {{ --ag-background-color: #16213e; --ag-header-background-color: #0f3460; --ag-odd-row-background-color: #1a1a2e; }}
</style>
</head>
<body>
  <h2>{esc_title}</h2>
  <div class="info">{len(safe_rows)} rows, {len(columns)} columns</div>
  <div id="grid" class="ag-theme-alpine-dark"></div>
  <script>
    const gridOptions = {{
      columnDefs: {col_defs},
      rowData: {row_data},
      pagination: true,
      paginationPageSize: 25,
      defaultColDef: {{ flex: 1, minWidth: 100 }},
    }};
    const grid = agGrid.createGrid(document.getElementById('grid'), gridOptions);
  </script>
</body>
</html>"""

    async def browse_nodes(self, label: str, limit: int = 50, __user__: dict = {}) -> str:
        """
        Quick browse: show all nodes of a given label as a sortable table.
        Automatically picks the most useful properties.

        :param label: Node label (e.g. 'Agent', 'Tool', 'Domain', 'Service', 'Pattern')
        :param limit: Max rows (default: 50)
        """
        safe_limit = min(max(int(limit), 1), 500)
        query = f"MATCH (n:{label}) RETURN properties(n) AS props LIMIT {safe_limit}"

        try:
            rows = await self._cypher(query)
        except Exception as e:
            return f"Query failed: {e}"

        if not rows:
            return f"No nodes found with label `{label}`."

        # Flatten properties
        flat_rows = []
        all_keys = set()
        for row in rows:
            props = row.get("props", row)
            if isinstance(props, dict):
                all_keys.update(props.keys())
                flat_rows.append(props)

        # Pick top columns (skip embedding, large content)
        skip = {"embedding", "vector", "content", "description"}
        columns = sorted([k for k in all_keys if k not in skip])[:12]

        if not columns:
            return f"Found {len(rows)} `{label}` nodes but couldn't extract properties."

        return await self.browse_data(
            f"MATCH (n:{label}) RETURN " + ", ".join(f"n.{c} AS {c}" for c in columns) + f" LIMIT {safe_limit}",
            title=f"{label} nodes ({len(flat_rows)} results)",
        )
