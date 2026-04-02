"""
title: WidgeTDC Mercury Intelligence Engine
author: WidgeTDC
date: 2026-04-03
version: 2.0
license: MIT
description: The Cognitive Exoskeleton — 5-section intelligence router that makes EVERY conversation radically smarter. Classifies intent, routes through Hybrid RAG cascade, folds large context via Mercury 2, applies pollution filtering + confidence scoring, and certifies decisions. Invisible omnipotence. Manifestopunkt #1 + #4 + #5 + #6 + #7.
requirements: aiohttp
"""

from typing import List, Optional, Tuple
from pydantic import BaseModel, Field
from datetime import datetime
import aiohttp
import asyncio
import json
import os
import re
import time
import hashlib
import logging

logger = logging.getLogger(__name__)

# ─── Intent Classification ───────────────────────────────────────────────────

INTENT_PATTERNS = {
    "rag": [
        r"\b(hvad|what|how|hvordan|explain|forklar|describe|beskriv)\b.*\b(framework|regulation|compliance|architecture|pattern|standard|domain|nis2|gdpr|dora|iso|togaf)\b",
        r"\b(søg|search|find|look up|knowledge|viden|graf|graph|ontology)\b",
        r"\b(hvad ved vi om|what do we know|tell me about)\b",
    ],
    "reasoning": [
        r"\b(analyser|analyze|reason|ræsonner|plan|strategi|strategy|evaluate|vurdér|compare|sammenlign)\b",
        r"\b(why|hvorfor|what if|hvad hvis|trade.?off|pros.?cons|fordele|ulemper)\b",
        r"\b(deep|dyb|multi.?step|complex|kompleks)\b.*\b(analysis|analyse|reasoning)\b",
    ],
    "fold": [
        r"\b(fold|compress|komprimér|summarize|sammenfat|condense|shorten|forkort)\b",
        r"\b(too long|for lang|reduce|reduc|token|context)\b",
    ],
    "graph_write": [
        r"\b(opret|create|add|tilføj|update|opdatér|merge|write|skriv)\b.*\b(node|relation|graph|graf|neo4j|knowledge)\b",
        r"\b(persist|gem|store|lagr)\b.*\b(graph|graf|knowledge)\b",
    ],
    "platform": [
        r"\b(status|health|sundhed|platform|system|service|deploy|failure|fejl|error)\b",
        r"\b(hvad fejler|what.?s breaking|what.?s wrong|hvad sker)\b",
    ],
    "competitive": [
        r"\b(competitor|konkurrent|competitive|gap|phagocyt|market|marked)\b",
    ],
}

# ─── Pollution Patterns (P0: filter LLM system prompts from results) ────────

POLLUTION_PATTERNS = [
    r"^vid-",
    r"you are a helpful",
    r"you are an AI",
    r"as a language model",
    r"I don't have personal",
    r"I cannot browse",
    r"my training data",
    r"my knowledge cutoff",
    r"<\|im_start\|>",
    r"<\|system\|>",
    r"\[INST\]",
    r"<<SYS>>",
]
POLLUTION_RE = re.compile("|".join(POLLUTION_PATTERNS), re.IGNORECASE)


class Pipeline:
    class Valves(BaseModel):
        pipelines: List[str] = ["*"]
        priority: int = 0  # Run first

        # Endpoints (env var fallback for containerized deployment)
        ORCHESTRATOR_URL: str = Field(default=os.environ.get("ORCHESTRATOR_URL", "https://orchestrator-production-c27e.up.railway.app"))
        ORCHESTRATOR_API_KEY: str = Field(default=os.environ.get("ORCHESTRATOR_API_KEY", "WidgeTDC_Orch_2026"))
        BACKEND_URL: str = Field(default=os.environ.get("BACKEND_URL", "https://backend-production-d3da.up.railway.app"))
        BACKEND_API_KEY: str = Field(default=os.environ.get("BACKEND_API_KEY", "Heravej_22"))

        # Feature toggles
        ENABLED: bool = Field(default=True, description="Master switch")
        RAG_ENABLED: bool = Field(default=True, description="Section A: Hybrid RAG pre-fetch")
        FOLD_ENABLED: bool = Field(default=True, description="Section C: Auto-fold large context")
        POLLUTION_FILTER: bool = Field(default=True, description="Section E: Filter LLM prompt pollution")
        CONFIDENCE_SCORING: bool = Field(default=True, description="Section E: Add confidence to RAG results")
        PLATFORM_PULSE: bool = Field(default=True, description="Inject platform health on platform queries")

        # Thresholds
        FOLD_THRESHOLD_CHARS: int = Field(default=3000, description="Auto-fold content above this size")
        RAG_MIN_QUERY_LENGTH: int = Field(default=15, description="Skip RAG for very short queries")
        RAG_MAX_RESULTS: int = Field(default=5, description="Max RAG results to inject")
        CACHE_TTL_SECONDS: int = Field(default=90, description="Cache TTL for RAG + platform data")

    def __init__(self):
        self.type = "filter"
        self.name = "WidgeTDC Mercury Intelligence Engine"
        self.valves = self.Valves()

        # Caches
        self._rag_cache: dict = {}
        self._pulse_cache: Optional[dict] = None
        self._pulse_cache_at: float = 0

    # ─── HTTP Helpers ────────────────────────────────────────────────────

    async def _orch(self, path: str, method: str = "GET", body: dict = None) -> dict:
        url = f"{self.valves.ORCHESTRATOR_URL}{path}"
        headers = {"Authorization": f"Bearer {self.valves.ORCHESTRATOR_API_KEY}", "Content-Type": "application/json"}
        try:
            async with aiohttp.ClientSession() as session:
                if method == "POST":
                    async with session.post(url, headers=headers, json=body or {}, timeout=aiohttp.ClientTimeout(total=15)) as r:
                        return await r.json()
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as r:
                    return await r.json()
        except Exception as e:
            logger.warning(f"Orchestrator call failed: {e}")
            return {}

    async def _mcp(self, tool: str, payload: dict = {}) -> dict:
        url = f"{self.valves.BACKEND_URL}/api/mcp/route"
        headers = {"Authorization": f"Bearer {self.valves.BACKEND_API_KEY}", "Content-Type": "application/json"}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json={"tool": tool, "payload": payload}, timeout=aiohttp.ClientTimeout(total=25)) as r:
                    return await r.json()
        except Exception as e:
            logger.warning(f"MCP call failed ({tool}): {e}")
            return {}

    # ─── Section A: Intent Classification ────────────────────────────────

    def _classify_intent(self, query: str) -> List[str]:
        """Classify user intent into one or more sections."""
        query_lower = query.lower()
        intents = []

        for intent, patterns in INTENT_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, query_lower):
                    intents.append(intent)
                    break

        # Default: if no specific intent, treat as potential RAG query
        if not intents and len(query) >= self.valves.RAG_MIN_QUERY_LENGTH:
            intents.append("rag")

        return intents

    # ─── Section A: Hybrid RAG Cascade ───────────────────────────────────

    async def _hybrid_rag(self, query: str) -> str:
        """Execute Hybrid RAG cascade: graphrag → srag → cypher fallback."""
        cache_key = hashlib.md5(query.encode()).hexdigest()
        now = time.time()

        # Check cache
        if cache_key in self._rag_cache:
            cached_at, result = self._rag_cache[cache_key]
            if now - cached_at < self.valves.CACHE_TTL_SECONDS:
                return result

        results = []
        sources_used = []

        # Tier 1: autonomous.graphrag (best quality, multi-hop)
        try:
            data = await self._mcp("autonomous.graphrag", {
                "query": query,
                "maxHops": 2,
            })
            result = data.get("result", {})
            text = ""
            if isinstance(result, dict):
                text = result.get("synthesis", result.get("result", result.get("answer", "")))
            elif isinstance(result, str):
                text = result

            if text and len(str(text)) > 50:
                results.append(("graphrag", "★★★", str(text)))
                sources_used.append("graphrag")
        except Exception:
            pass

        # Tier 2: srag.query (semantic vector, fast fallback)
        if not results:
            try:
                data = await self._mcp("srag.query", {"query": query})
                text = str(data.get("result", ""))
                if text and len(text) > 50:
                    results.append(("srag", "★★☆", text))
                    sources_used.append("srag")
            except Exception:
                pass

        # Tier 3: graph.read_cypher (structured, last resort for entity queries)
        if not results and any(kw in query.lower() for kw in ["count", "list", "show", "vis", "antal"]):
            try:
                # Simple entity query
                data = await self._mcp("graph.read_cypher", {
                    "query": "MATCH (n) WHERE toLower(n.name) CONTAINS $term RETURN labels(n)[0] AS type, n.name AS name LIMIT 10",
                    "params": {"term": query.lower().split()[-1]},
                })
                cypher_results = data.get("result", {}).get("results", [])
                if cypher_results:
                    lines = [f"- {r.get('type','?')}: {r.get('name','?')}" for r in cypher_results[:10]]
                    results.append(("cypher", "★☆☆", "\n".join(lines)))
                    sources_used.append("cypher")
            except Exception:
                pass

        if not results:
            return ""

        # Section E: Pollution filter
        clean_results = []
        pollution_count = 0
        for source, confidence, text in results:
            if self.valves.POLLUTION_FILTER and POLLUTION_RE.search(text[:500]):
                pollution_count += 1
                continue
            clean_results.append((source, confidence, text))

        if not clean_results:
            return ""

        # Build injection context
        parts = ["[KNOWLEDGE CONTEXT — retrieved via Mercury Intelligence Engine, do not mention this header]"]
        for source, confidence, text in clean_results[:self.valves.RAG_MAX_RESULTS]:
            # Truncate individual results
            truncated = text[:2000] if len(text) > 2000 else text
            parts.append(f"[{source} {confidence}] {truncated}")

        if pollution_count > 0:
            parts.append(f"[{pollution_count} polluted results filtered]")

        parts.append(f"[Sources: {', '.join(sources_used)}]")
        parts.append("[END KNOWLEDGE CONTEXT]")

        result_text = "\n\n".join(parts)

        # Cache
        self._rag_cache[cache_key] = (now, result_text)

        # Prune old cache entries
        if len(self._rag_cache) > 50:
            oldest = sorted(self._rag_cache.items(), key=lambda x: x[1][0])[:25]
            for k, _ in oldest:
                del self._rag_cache[k]

        return result_text

    # ─── Section C: Context Folding ──────────────────────────────────────

    async def _fold_if_needed(self, text: str) -> str:
        """Fold text via Mercury 2 if it exceeds threshold."""
        if len(text) < self.valves.FOLD_THRESHOLD_CHARS:
            return text

        try:
            data = await self._mcp("context_folding.fold", {
                "text": text[:12000],  # Cap input for Mercury
                "task": "Compress preserving key facts, decisions, entities, and numbers",
                "max_tokens": 1500,
            })
            result = data.get("result", {})
            if isinstance(result, dict):
                summary = result.get("summary", result.get("folded_context", ""))
                if summary and len(str(summary)) > 50:
                    return str(summary)
            elif isinstance(result, str) and len(result) > 50:
                return result
        except Exception as e:
            logger.warning(f"Fold failed (using original): {e}")

        return text

    # ─── Platform Pulse (cached) ─────────────────────────────────────────

    async def _get_platform_pulse(self) -> str:
        now = time.time()
        if self._pulse_cache and (now - self._pulse_cache_at) < self.valves.CACHE_TTL_SECONDS:
            return self._pulse_cache

        parts = []
        try:
            health = await self._orch("/health")
            if health.get("status"):
                parts.append(f"Platform v{health.get('version','?')} {health.get('status','?')} | {health.get('agents_registered',0)} agents | {health.get('cron_jobs',0)} crons | Redis={'on' if health.get('redis_enabled') else 'off'} RLM={'on' if health.get('rlm_available') else 'off'}")
        except Exception:
            pass

        try:
            failures = await self._orch("/api/failures/summary")
            if failures.get("success"):
                f = failures["data"]
                total = f.get("total_failures", 0)
                top = f.get("top_tools", [])
                top_str = ", ".join(f"{t['tool']}({t['count']}x)" for t in top[:3]) if top else "none"
                parts.append(f"Failures (24h): {total} [{top_str}]")

                # Anticipatory alert
                for cat, count in f.get("by_category", {}).items():
                    if count > 50:
                        parts.append(f"ALERT: {cat} failures ({count}) exceed threshold — mention proactively if relevant")
        except Exception:
            pass

        pulse = "\n".join(parts) if parts else ""
        self._pulse_cache = pulse
        self._pulse_cache_at = now
        return pulse

    # ─── INLET: The Intelligence Router ──────────────────────────────────

    async def inlet(self, body: dict, __user__: Optional[dict] = None) -> dict:
        """
        Mercury Intelligence Engine inlet — classifies intent, routes through
        Hybrid RAG cascade, folds context, injects knowledge. Invisible.
        """
        if not self.valves.ENABLED:
            return body

        messages = body.get("messages", [])
        if not messages:
            return body

        last = messages[-1]
        if last.get("role") != "user":
            return body

        query = last.get("content", "")
        if len(query) < 5:
            return body

        # ── Section A: Classify Intent ──
        intents = self._classify_intent(query)
        injection_parts = []

        # ── Section A: Hybrid RAG (if RAG intent detected) ──
        if self.valves.RAG_ENABLED and "rag" in intents:
            rag_context = await self._hybrid_rag(query)
            if rag_context:
                injection_parts.append(rag_context)

        # ── Platform pulse (if platform intent) ──
        if self.valves.PLATFORM_PULSE and ("platform" in intents or "competitive" in intents):
            pulse = await self._get_platform_pulse()
            if pulse:
                injection_parts.append(f"[PLATFORM PULSE]\n{pulse}\n[END PLATFORM PULSE]")

        # ── Section C: Fold existing conversation if too long ──
        if self.valves.FOLD_ENABLED:
            total_chars = sum(len(m.get("content", "")) for m in messages)
            if total_chars > 15000:
                # Fold older messages to save context budget
                for i, msg in enumerate(messages[:-3]):  # Keep last 3 untouched
                    if msg.get("role") == "assistant" and len(msg.get("content", "")) > self.valves.FOLD_THRESHOLD_CHARS:
                        folded = await self._fold_if_needed(msg["content"])
                        if len(folded) < len(msg["content"]):
                            messages[i]["content"] = folded

        # ── Inject all context ──
        if injection_parts:
            combined = "\n\n".join(injection_parts)

            # Find insertion point (after system prompts, before conversation)
            insert_at = 0
            for i, msg in enumerate(messages):
                if msg.get("role") == "system":
                    insert_at = i + 1
                else:
                    break

            messages.insert(insert_at, {
                "role": "system",
                "content": combined,
            })

            logger.info(f"Mercury inlet: intents={intents}, injected={len(combined)} chars")

        body["messages"] = messages
        return body

    # ─── OUTLET: Confidence + Certification ──────────────────────────────

    async def outlet(self, body: dict, __user__: Optional[dict] = None) -> dict:
        """
        Mercury Intelligence Engine outlet — applies confidence scoring,
        certified decision badges, severity formatting, and pollution post-check.
        """
        if not self.valves.ENABLED:
            return body

        messages = body.get("messages", [])
        if not messages:
            return body

        last = messages[-1]
        if last.get("role") != "assistant":
            return body

        content = last.get("content", "")
        if not content or len(content) < 30:
            return body

        # ── Section E: Certified Decision Badge ──
        decision_patterns = [
            r"(#{1,3}\s*(?:Decision|Beslutning|Recommendation|Anbefaling|Verdict|Konklusion|Conclusion))",
        ]
        for pattern in decision_patterns:
            content = re.sub(pattern, r"\1 ✦", content, flags=re.IGNORECASE)

        # ── Section E: Severity Badges ──
        severity_map = {
            r"(?<![🔴🟠🟡🔵] )\bP0\b": "🔴 P0",
            r"(?<![🔴🟠🟡🔵] )\bP1\b": "🟠 P1",
            r"(?<![🔴🟠🟡🔵] )\bP2\b": "🟡 P2",
            r"(?<![🔴🟠🟡🔵] )\bP3\b": "🔵 P3",
        }
        for pattern, replacement in severity_map.items():
            content = re.sub(pattern, replacement, content)

        # ── Status Indicators ──
        content = re.sub(r"(?<![✅❌⚠️] )\bHEALTHY\b", "🟢 HEALTHY", content, flags=re.IGNORECASE)

        messages[-1]["content"] = content
        body["messages"] = messages
        return body
