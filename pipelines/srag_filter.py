"""
title: SRAG Filter Pipeline
author: WidgeTDC
date: 2026-04-01
version: 1.0
license: MIT
description: Inlet filter that intercepts user messages, queries the knowledge graph via kg_rag.query, and injects Knowledge Cards into the system prompt before the LLM sees it.
requirements: aiohttp
"""

from typing import List, Optional
from pydantic import BaseModel
import asyncio
import aiohttp
import json
import logging

logger = logging.getLogger(__name__)


class Pipeline:
    class Valves(BaseModel):
        # Target pipeline ids — ["*"] connects to all pipelines
        pipelines: List[str] = []
        # Execution priority (lower = earlier)
        priority: int = 0
        # Backend MCP endpoint base URL
        BACKEND_URL: str = "https://backend-production-d3da.up.railway.app"
        # Backend API key (set via Open WebUI Pipelines admin UI)
        BACKEND_API_KEY: str = ""
        # Number of knowledge cards to retrieve
        TOP_K: int = 5
        # Enable/disable the filter
        ENABLED: bool = True
        # Skip messages shorter than this
        MIN_QUERY_LENGTH: int = 10

    def __init__(self):
        self.type = "filter"
        self.name = "SRAG Knowledge Filter"

        self.valves = self.Valves(
            **{
                "pipelines": ["*"],
            }
        )

    async def on_startup(self):
        print(f"on_startup:{__name__}")

    async def on_shutdown(self):
        print(f"on_shutdown:{__name__}")

    async def on_valves_updated(self):
        pass

    async def inlet(self, body: dict, user: Optional[dict] = None) -> dict:
        """
        Intercept user messages, query knowledge graph, inject Knowledge Cards
        into the system prompt before the LLM processes the conversation.
        """
        if not self.valves.ENABLED:
            return body

        messages = body.get("messages", [])
        if not messages:
            return body

        # Extract last user message
        user_message = None
        for msg in reversed(messages):
            if msg.get("role") == "user":
                content = msg.get("content", "")
                if isinstance(content, str):
                    user_message = content
                elif isinstance(content, list):
                    # Handle multi-part content (text + images)
                    text_parts = [
                        p.get("text", "")
                        for p in content
                        if isinstance(p, dict) and p.get("type") == "text"
                    ]
                    user_message = " ".join(text_parts)
                break

        if not user_message or len(user_message.strip()) < self.valves.MIN_QUERY_LENGTH:
            return body

        # Query knowledge graph via MCP
        knowledge_context = await self._query_knowledge_graph(user_message.strip())
        if not knowledge_context:
            return body

        # Inject knowledge context into system message
        body = self._inject_system_context(body, knowledge_context)
        return body

    async def _query_knowledge_graph(self, query: str) -> Optional[str]:
        """
        Call backend MCP endpoint with kg_rag.query to retrieve Knowledge Cards.
        Falls back to srag.query if kg_rag returns nothing.
        Returns formatted markdown string or None.
        """
        mcp_url = f"{self.valves.BACKEND_URL.rstrip('/')}/api/mcp/route"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.valves.BACKEND_API_KEY}",
        }

        # Try kg_rag.query first
        cards = await self._mcp_call(
            mcp_url,
            headers,
            {
                "tool": "kg_rag.query",
                "payload": {"question": query, "top_k": self.valves.TOP_K},
            },
        )

        # Fallback to srag.query if no results
        if not cards:
            cards = await self._mcp_call(
                mcp_url,
                headers,
                {
                    "tool": "srag.query",
                    "payload": {"query": query, "domains": ["all"]},
                },
            )

        if not cards:
            return None

        return self._format_knowledge_cards(cards)

    async def _mcp_call(self, url: str, headers: dict, payload: dict) -> Optional[list]:
        """
        Execute an MCP tool call with timeout.
        kg_rag.query typically takes 5-15s; 10s balances UX vs hit rate.
        Returns list of card dicts or None on failure.
        """
        timeout = aiohttp.ClientTimeout(total=10)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status != 200:
                        logger.warning(
                            f"SRAG filter: MCP call {payload.get('tool')} returned {resp.status}"
                        )
                        return None

                    data = await resp.json()

                    # Extract cards from various response shapes
                    return self._extract_cards(data)

        except aiohttp.ClientError as e:
            logger.warning(f"SRAG filter: MCP network error — {e}")
            return None
        except asyncio.TimeoutError:
            logger.warning("SRAG filter: MCP call timed out (10s)")
            return None
        except Exception as e:
            logger.warning(f"SRAG filter: unexpected error — {e}")
            return None

    def _extract_cards(self, data: dict) -> Optional[list]:
        """
        Extract knowledge cards from MCP response.
        Handles multiple response shapes from kg_rag.query and srag.query.
        """
        if not data:
            return None

        # Direct list response
        if isinstance(data, list) and len(data) > 0:
            return data

        # Nested under common keys
        for key in ("result", "results", "data", "cards", "matches", "hits", "sources"):
            val = data.get(key)
            if isinstance(val, list) and len(val) > 0:
                return val
            if isinstance(val, dict):
                # One more level: result.sources, result.cards, etc.
                for inner_key in ("sources", "cards", "matches", "results", "hits", "items"):
                    inner = val.get(inner_key)
                    if isinstance(inner, list) and len(inner) > 0:
                        return inner

        # If data itself looks like a single card with a title/summary
        if isinstance(data, dict) and ("title" in data or "summary" in data):
            return [data]

        return None

    def _format_knowledge_cards(self, cards: list) -> str:
        """
        Format knowledge cards as markdown for system prompt injection.
        """
        if not cards:
            return ""

        lines = ["### 📚 Knowledge Context\n"]

        for i, card in enumerate(cards[: self.valves.TOP_K], 1):
            if not isinstance(card, dict):
                continue

            # Extract fields with flexible key names
            ref = (
                card.get("ref")
                or card.get("id")
                or card.get("node_id")
                or card.get("$id")
                or f"KC-{i:04d}"
            )
            title = card.get("title") or card.get("name") or card.get("label") or ""
            summary = (
                card.get("summary")
                or card.get("description")
                or card.get("content")
                or card.get("text")
                or ""
            )
            score = card.get("score") or card.get("similarity") or card.get("relevance")
            domains = card.get("domains") or card.get("domain") or card.get("tags")

            # Build card line
            header = f"**[{ref}]**"
            if title:
                header += f" {title}"
            if score is not None:
                try:
                    header += f" (relevance: {float(score):.2f})"
                except (ValueError, TypeError):
                    pass

            parts = [f"{i}. {header}"]
            if summary:
                # Truncate long summaries
                text = str(summary).strip()
                if len(text) > 300:
                    text = text[:297] + "..."
                parts.append(f"   {text}")
            if domains:
                if isinstance(domains, list):
                    parts.append(f"   _Domains: {', '.join(str(d) for d in domains)}_")
                else:
                    parts.append(f"   _Domain: {domains}_")

            lines.append("\n".join(parts))

        return "\n\n".join(lines)

    def _inject_system_context(self, body: dict, knowledge_context: str) -> dict:
        """
        Inject knowledge context into the system message.
        Prepends to existing system message or creates a new one.
        """
        messages = body.get("messages", [])
        injection = (
            f"{knowledge_context}\n\n"
            "Use the knowledge cards above as context when answering. "
            "Cite references like [MI-xxxx] when using specific knowledge.\n\n---\n\n"
        )

        # Check if first message is system
        if messages and messages[0].get("role") == "system":
            existing = messages[0].get("content", "")
            messages[0]["content"] = injection + existing
        else:
            messages.insert(0, {"role": "system", "content": injection.rstrip()})

        body["messages"] = messages
        return body
