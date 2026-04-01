"""
Unit tests for Open WebUI pipeline filters:
  - srag_filter.py    (inlet — knowledge graph injection)
  - citation_formatter.py  (outlet — reference formatting)
  - followup_generator.py  (outlet — contextual suggestions)

All HTTP calls are mocked — no real network traffic.
"""
import pytest
import json
import copy
from unittest.mock import AsyncMock, patch, MagicMock

# Import pipeline classes
from srag_filter import Pipeline as SRAGPipeline
from citation_formatter import Pipeline as CitationPipeline
from followup_generator import Pipeline as FollowupPipeline


# ===========================================================================
# SRAG Filter Tests
# ===========================================================================

class TestSRAGFilter:
    """Tests for srag_filter.py inlet filter."""

    def _make_pipeline(self, **valve_overrides):
        p = SRAGPipeline()
        for k, v in valve_overrides.items():
            setattr(p.valves, k, v)
        return p

    def _mock_session(self, json_response):
        """Build a mock aiohttp.ClientSession context manager that returns json_response.

        The production code uses a double async-with pattern:
            async with ClientSession(...) as session:
                async with session.post(...) as resp:
        Both layers must be async context managers.
        """
        mock_resp = AsyncMock()
        mock_resp.status = 200
        mock_resp.json = AsyncMock(return_value=json_response)
        # resp is used as `async with session.post(...) as resp:`
        mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_resp.__aexit__ = AsyncMock(return_value=False)

        mock_session_inst = MagicMock()
        # session.post(...) must return an async context manager (mock_resp)
        mock_session_inst.post = MagicMock(return_value=mock_resp)

        mock_session_cls = MagicMock()
        # ClientSession(...) is used as `async with ClientSession(...) as session:`
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session_inst)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        return mock_session_cls

    # ------------------------------------------------------------------
    # 1. Normal message — cards injected
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_inlet_normal_message(self, user_body, mcp_kg_rag_response):
        pipeline = self._make_pipeline(BACKEND_API_KEY="test-key")
        original_content = user_body["messages"][0]["content"]

        with patch("srag_filter.aiohttp.ClientSession", self._mock_session(mcp_kg_rag_response)):
            result = await pipeline.inlet(user_body)

        messages = result["messages"]
        # System message should have been injected at position 0
        assert messages[0]["role"] == "system"
        assert "Knowledge Context" in messages[0]["content"]
        assert "MI-1234" in messages[0]["content"]
        # Original user message should still be present
        assert any(m.get("content") == original_content for m in messages if m["role"] == "user")

    # ------------------------------------------------------------------
    # 2. Short message — skipped
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_inlet_short_message_skip(self, short_user_body):
        pipeline = self._make_pipeline()
        original = copy.deepcopy(short_user_body)

        result = await pipeline.inlet(short_user_body)

        assert result == original

    # ------------------------------------------------------------------
    # 3. Disabled — pass through
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_inlet_disabled(self, user_body):
        pipeline = self._make_pipeline(ENABLED=False)
        original = copy.deepcopy(user_body)

        result = await pipeline.inlet(user_body)

        assert result == original

    # ------------------------------------------------------------------
    # 4. Timeout — body returned unmodified
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_inlet_timeout_passthrough(self, user_body):
        import asyncio as _asyncio

        pipeline = self._make_pipeline(BACKEND_API_KEY="test-key")
        original_messages = copy.deepcopy(user_body["messages"])

        mock_session_cls = MagicMock()
        mock_session_inst = MagicMock()
        mock_session_inst.post = MagicMock(side_effect=_asyncio.TimeoutError)
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session_inst)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("srag_filter.aiohttp.ClientSession", mock_session_cls):
            result = await pipeline.inlet(user_body)

        # No system message injected — body unchanged
        assert result["messages"] == original_messages

    # ------------------------------------------------------------------
    # 5. Empty kg_rag results — falls back to srag.query
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_inlet_empty_results_fallback(self, user_body):
        pipeline = self._make_pipeline(BACKEND_API_KEY="test-key")

        srag_response = {
            "results": [
                {
                    "ref": "SRAG-0001",
                    "title": "Fallback Result",
                    "summary": "This came from srag.query fallback.",
                    "score": 0.75,
                }
            ]
        }

        call_count = 0

        def mock_post_side_effect(url, json=None, headers=None):
            nonlocal call_count
            call_count += 1
            mock_resp = AsyncMock()
            mock_resp.status = 200
            if call_count == 1:
                # First call (kg_rag) returns empty
                mock_resp.json = AsyncMock(return_value={"result": {"cards": []}})
            else:
                # Second call (srag) returns data
                mock_resp.json = AsyncMock(return_value=srag_response)
            # resp used as async context manager
            mock_resp.__aenter__ = AsyncMock(return_value=mock_resp)
            mock_resp.__aexit__ = AsyncMock(return_value=False)
            return mock_resp

        mock_session_inst = MagicMock()
        mock_session_inst.post = mock_post_side_effect

        mock_session_cls = MagicMock()
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session_inst)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("srag_filter.aiohttp.ClientSession", mock_session_cls):
            result = await pipeline.inlet(user_body)

        # Should have made 2 MCP calls (kg_rag + srag fallback)
        assert call_count == 2
        # System message should contain fallback result
        assert result["messages"][0]["role"] == "system"
        assert "SRAG-0001" in result["messages"][0]["content"]


# ===========================================================================
# Citation Formatter Tests
# ===========================================================================

class TestCitationFormatter:
    """Tests for citation_formatter.py outlet filter."""

    def _make_pipeline(self, **valve_overrides):
        p = CitationPipeline()
        for k, v in valve_overrides.items():
            setattr(p.valves, k, v)
        return p

    # ------------------------------------------------------------------
    # 1. Inline mode — tooltip links
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_inline_mode(self, assistant_body_with_refs):
        pipeline = self._make_pipeline(CITATION_STYLE="inline")

        result = await pipeline.outlet(assistant_body_with_refs)

        content = result["messages"][-1]["content"]
        # Should be formatted as markdown tooltip links
        assert '[MI-1234](# "Management Insight: MI-1234")' in content
        assert '[KPI-5678](# "Key Performance Indicator: KPI-5678")' in content
        assert '[FW-9012](# "Framework Reference: FW-9012")' in content

    # ------------------------------------------------------------------
    # 2. Footnote mode — references at bottom
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_footnote_mode(self, assistant_body_with_refs):
        pipeline = self._make_pipeline(CITATION_STYLE="footnote")

        result = await pipeline.outlet(assistant_body_with_refs)

        content = result["messages"][-1]["content"]
        # References should be bolded in text
        assert "**[MI-1234]**" in content
        assert "**[KPI-5678]**" in content
        # Footnote section at bottom
        assert "### Referencer" in content
        assert "Management Insight" in content
        assert "Key Performance Indicator" in content
        assert "Framework Reference" in content

    # ------------------------------------------------------------------
    # 3. No match — pass through unmodified
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_no_match_passthrough(self, assistant_body_no_refs):
        pipeline = self._make_pipeline()
        original = copy.deepcopy(assistant_body_no_refs)

        result = await pipeline.outlet(assistant_body_no_refs)

        assert result["messages"][-1]["content"] == original["messages"][-1]["content"]

    # ------------------------------------------------------------------
    # 4. Mixed references — MI + KPI + FW all formatted
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_mixed_refs(self):
        pipeline = self._make_pipeline(CITATION_STYLE="inline")
        body = {
            "messages": [
                {
                    "role": "assistant",
                    "content": "See [MI-1000], [KPI-2000], [FW-3000], [REG-4000], and [RISK-5000].",
                }
            ]
        }

        result = await pipeline.outlet(body)

        content = result["messages"][-1]["content"]
        assert "Management Insight" in content
        assert "Key Performance Indicator" in content
        assert "Framework Reference" in content
        assert "Regulatory Reference" in content
        assert "Risk Assessment" in content

    # ------------------------------------------------------------------
    # 5. Short IDs — [MI-5] with 1-digit should match (regex is \d{1,5})
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_short_ids(self):
        pipeline = self._make_pipeline(CITATION_STYLE="inline")
        body = {
            "messages": [
                {"role": "assistant", "content": "See [MI-5] and [KPI-42] for details."}
            ]
        }

        result = await pipeline.outlet(body)

        content = result["messages"][-1]["content"]
        # Regex \d{1,5} matches short IDs
        assert '[MI-5](# "Management Insight: MI-5")' in content
        assert '[KPI-42](# "Key Performance Indicator: KPI-42")' in content

    # ------------------------------------------------------------------
    # 6. Disabled — pass through
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_disabled(self, assistant_body_with_refs):
        pipeline = self._make_pipeline(ENABLED=False)
        original = copy.deepcopy(assistant_body_with_refs)

        result = await pipeline.outlet(assistant_body_with_refs)

        assert result["messages"][-1]["content"] == original["messages"][-1]["content"]


# ===========================================================================
# Follow-up Generator Tests
# ===========================================================================

class TestFollowupGenerator:
    """Tests for followup_generator.py outlet filter."""

    def _make_pipeline(self, **valve_overrides):
        p = FollowupPipeline()
        for k, v in valve_overrides.items():
            setattr(p.valves, k, v)
        return p

    def _make_body(self, content):
        return {
            "messages": [
                {"role": "user", "content": "question"},
                {"role": "assistant", "content": content},
            ]
        }

    # ------------------------------------------------------------------
    # 1. Compliance keywords — GDPR/NIS2 triggers compliance suggestions
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_compliance_keywords(self):
        pipeline = self._make_pipeline()
        body = self._make_body(
            "The GDPR compliance audit revealed gaps in NIS2 readiness. "
            "Regulatory requirements demand immediate action on data protection measures."
        )

        result = await pipeline.outlet(body)

        content = result["messages"][-1]["content"]
        assert "N\u00e6ste skridt" in content
        # Should contain compliance-specific suggestions
        assert "compliance" in content.lower() or "framework" in content.lower() or "audit" in content.lower()

    # ------------------------------------------------------------------
    # 2. Strategy keywords — strategi/framework triggers strategy suggestions
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_strategy_keywords(self):
        pipeline = self._make_pipeline()
        body = self._make_body(
            "The digital transformation strategy includes a roadmap for Q3 with key initiatives "
            "and recommendations for organizational change. The framework prioritizes ROI."
        )

        result = await pipeline.outlet(body)

        content = result["messages"][-1]["content"]
        assert "N\u00e6ste skridt" in content

    # ------------------------------------------------------------------
    # 3. Analysis keywords — data/graph triggers analysis suggestions
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_analysis_keywords(self):
        pipeline = self._make_pipeline()
        body = self._make_body(
            "The graph analysis shows 1500 nodes connected across the knowledge base. "
            "KPI metrics indicate a positive trend in performance dashboard scores."
        )

        result = await pipeline.outlet(body)

        content = result["messages"][-1]["content"]
        assert "N\u00e6ste skridt" in content

    # ------------------------------------------------------------------
    # 4. Short response — skip (<80 chars)
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_short_response_skip(self, assistant_body_short):
        pipeline = self._make_pipeline()
        original = copy.deepcopy(assistant_body_short)

        result = await pipeline.outlet(assistant_body_short)

        assert result["messages"][-1]["content"] == original["messages"][-1]["content"]

    # ------------------------------------------------------------------
    # 5. MAX_SUGGESTIONS limit respected
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_max_suggestions(self):
        pipeline = self._make_pipeline(MAX_SUGGESTIONS=2)
        body = self._make_body(
            "GDPR compliance audit with data analysis on graph nodes and KPI metrics. "
            "Strategy framework includes roadmap and transformation recommendations."
        )

        result = await pipeline.outlet(body)

        content = result["messages"][-1]["content"]
        # Count suggestion lines (lines starting with "> " after the divider)
        suggestion_lines = [line for line in content.split("\n") if line.startswith("> ")]
        assert len(suggestion_lines) <= 2

    # ------------------------------------------------------------------
    # 6. Danish keywords detected correctly
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_danish_keywords(self):
        pipeline = self._make_pipeline()
        body = self._make_body(
            "Regulering af databeskyttelse kr\u00e6ver tilsyn med persondataforordningen. "
            "Lovgivningen p\u00e5l\u00e6gger virksomheder at gennemf\u00f8re compliance-vurderinger."
        )

        result = await pipeline.outlet(body)

        content = result["messages"][-1]["content"]
        # Should detect Danish compliance terms and add suggestions
        assert "N\u00e6ste skridt" in content

    # ------------------------------------------------------------------
    # 7. Disabled — pass through
    # ------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_outlet_disabled(self, assistant_body_long):
        pipeline = self._make_pipeline(ENABLED=False)
        original = copy.deepcopy(assistant_body_long)

        result = await pipeline.outlet(assistant_body_long)

        assert result["messages"][-1]["content"] == original["messages"][-1]["content"]
