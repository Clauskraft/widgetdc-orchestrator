"""
title: Follow-up Suggestion Generator
author: WidgeTDC
version: 1.0.0
description: Appends contextual follow-up suggestions as clickable chips to assistant responses.
"""

import re
from typing import Optional, List, Tuple
from pydantic import BaseModel, Field


class Pipeline:
    """Open WebUI outlet filter that generates contextual follow-up suggestions."""

    class Valves(BaseModel):
        ENABLED: bool = Field(default=True, description="Enable follow-up suggestions")
        MAX_SUGGESTIONS: int = Field(
            default=3, description="Maximum number of suggestions to show"
        )
        BACKEND_URL: str = Field(
            default="https://backend-production-d3da.up.railway.app",
            description="Backend MCP URL",
        )
        BACKEND_API_KEY: str = Field(
            default="", description="Backend API key for MCP calls"
        )

    def __init__(self):
        self.type = "filter"
        self.name = "Follow-up Suggestion Generator"
        self.valves = self.Valves()

        # Category keyword patterns (case-insensitive matching)
        self._categories = {
            "compliance": {
                "keywords": re.compile(
                    r"\b(compliance|regulatory|gdpr|nis2|iso\s*27001|audit|"
                    r"lovgivning|regulering|databeskyttelse|persondataforordning|"
                    r"tilsyn|hvidvask|aml|dora|csr[d]?|esg)\b",
                    re.IGNORECASE,
                ),
                "suggestions": [
                    ("\U0001f6e1\ufe0f", "K\u00f8r fuld compliance-audit"),
                    ("\U0001f4cb", "Vis framework-d\u00e6kning"),
                    ("\u26a0\ufe0f", "Identificer compliance-gaps"),
                    ("\U0001f4c5", "Vis n\u00e6ste audit-deadline"),
                    ("\U0001f4ca", "Sammenlign med branchebenchmark"),
                ],
            },
            "analysis": {
                "keywords": re.compile(
                    r"\b(data|graf|graph|noder|nodes|kpi|metrik|analyse|"
                    r"statistik|trend|m\u00e5ling|dashboard|indsigt|insight|"
                    r"performance|benchmark|score)\b",
                    re.IGNORECASE,
                ),
                "suggestions": [
                    ("\U0001f50d", "G\u00e5 dybere i analysen"),
                    ("\U0001f4ca", "Vis relaterede KPI'er"),
                    ("\U0001f504", "Sammenlign med tidligere periode"),
                    ("\U0001f310", "Vis i graf-kontekst"),
                    ("\U0001f4c8", "Trend-analyse over tid"),
                ],
            },
            "strategy": {
                "keywords": re.compile(
                    r"\b(strategi|strategy|framework|anbefaling|recommendation|"
                    r"roadmap|plan|initiativ|transformation|m\u00e5ls\u00e6tning|"
                    r"vision|prioritering|investment|roi)\b",
                    re.IGNORECASE,
                ),
                "suggestions": [
                    ("\U0001f4dd", "Udarbejd handlingsplan"),
                    ("\U0001f4b0", "ROI-beregning"),
                    ("\U0001f3af", "Definer succeskriterier"),
                    ("\U0001f5d3\ufe0f", "Vis implementeringstidslinje"),
                    ("\U0001f465", "Interessentanalyse"),
                ],
            },
            "knowledge": {
                "keywords": re.compile(
                    r"\b(viden|knowledge|dokument|rapport|rapport|reference|"
                    r"kilde|source|research|unders\u00f8gelse|studie|artikel|"
                    r"best.practice|erfaringer|lessons)\b",
                    re.IGNORECASE,
                ),
                "suggestions": [
                    ("\U0001f4da", "Vis relaterede dokumenter"),
                    ("\U0001f517", "Find kilder og referencer"),
                    ("\U0001f9e0", "Uddyb dette punkt"),
                    ("\U0001f50e", "S\u00f8g efter lignende cases"),
                    ("\U0001f4a1", "Vis relaterede indsigter"),
                ],
            },
        }

        # General fallback suggestions
        self._general_suggestions = [
            ("\U0001f9e0", "Uddyb dette punkt"),
            ("\U0001f50d", "Vis relaterede indsigter"),
            ("\U0001f4cb", "Opsummer som handlingspunkter"),
            ("\U0001f4ac", "Forklar i enklere termer"),
            ("\U0001f4ca", "Vis data bag ved konklusionen"),
        ]

    async def on_startup(self):
        pass

    async def on_shutdown(self):
        pass

    async def on_valves_updated(self):
        pass

    def _detect_categories(self, content: str) -> List[str]:
        """Detect content categories based on keyword matching."""
        scores = {}
        for category, config in self._categories.items():
            matches = config["keywords"].findall(content)
            if matches:
                scores[category] = len(matches)

        # Sort by match count descending
        return [cat for cat, _ in sorted(scores.items(), key=lambda x: -x[1])]

    def _pick_suggestions(self, categories: List[str]) -> List[Tuple[str, str]]:
        """Select suggestions based on detected categories, up to MAX_SUGGESTIONS."""
        max_count = self.valves.MAX_SUGGESTIONS
        suggestions = []
        seen_texts = set()

        # Gather suggestions from matched categories in priority order
        for cat in categories:
            for emoji, text in self._categories[cat]["suggestions"]:
                if text not in seen_texts and len(suggestions) < max_count:
                    suggestions.append((emoji, text))
                    seen_texts.add(text)

        # Fill remaining slots with general suggestions
        if len(suggestions) < max_count:
            for emoji, text in self._general_suggestions:
                if text not in seen_texts and len(suggestions) < max_count:
                    suggestions.append((emoji, text))
                    seen_texts.add(text)

        return suggestions[:max_count]

    def _format_suggestions(self, suggestions: List[Tuple[str, str]]) -> str:
        """Format suggestions as a markdown block."""
        lines = ["\n\n---", "\U0001f4a1 **N\u00e6ste skridt:**"]
        for emoji, text in suggestions:
            lines.append(f"> {emoji} {text}")
        return "\n".join(lines)

    async def outlet(self, body: dict, __user__: Optional[dict] = None) -> dict:
        """Process assistant response and append follow-up suggestions."""
        try:
            if not self.valves.ENABLED:
                return body

            messages = body.get("messages", [])
            if not messages:
                return body

            # Find the last assistant message
            last_msg = messages[-1]
            if last_msg.get("role") != "assistant":
                return body

            content = last_msg.get("content", "")
            if not isinstance(content, str) or not content:
                return body

            # Skip very short responses (greetings, confirmations)
            if len(content.strip()) < 80:
                return body

            # Detect content categories
            categories = self._detect_categories(content)

            # Pick the best suggestions
            suggestions = self._pick_suggestions(categories)

            if not suggestions:
                return body

            # Append suggestions to the response
            suffix = self._format_suggestions(suggestions)
            messages[-1]["content"] = content + suffix
            body["messages"] = messages

        except Exception:
            # Zero degradation: pass through unmodified on any error
            pass

        return body
