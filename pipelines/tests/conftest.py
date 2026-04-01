"""
Shared fixtures for pipeline tests.
"""
import pytest
import sys
import os

# Add pipelines directory to path so we can import pipeline modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ---------------------------------------------------------------------------
# Body fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def user_body():
    """Standard user message body."""
    return {
        "messages": [
            {"role": "user", "content": "What is the compliance status for GDPR across our portfolio?"}
        ]
    }


@pytest.fixture
def short_user_body():
    """User message shorter than MIN_QUERY_LENGTH (10)."""
    return {
        "messages": [
            {"role": "user", "content": "Hi"}
        ]
    }


@pytest.fixture
def assistant_body_with_refs():
    """Assistant response containing citation references."""
    return {
        "messages": [
            {"role": "user", "content": "Show compliance status"},
            {
                "role": "assistant",
                "content": (
                    "Based on [MI-1234] the compliance score is 87%. "
                    "See also [KPI-5678] for details and [FW-9012] for the framework."
                ),
            },
        ]
    }


@pytest.fixture
def assistant_body_no_refs():
    """Assistant response without any citation references."""
    return {
        "messages": [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hello! How can I help you today?"},
        ]
    }


@pytest.fixture
def assistant_body_long():
    """Assistant response long enough for follow-up suggestions (>80 chars)."""
    return {
        "messages": [
            {"role": "user", "content": "Tell me about GDPR compliance"},
            {
                "role": "assistant",
                "content": (
                    "GDPR compliance requires organizations to implement data protection measures "
                    "including data processing agreements, privacy impact assessments, and breach "
                    "notification procedures. Our current compliance score is 87%."
                ),
            },
        ]
    }


@pytest.fixture
def assistant_body_short():
    """Assistant response too short for follow-up suggestions (<80 chars)."""
    return {
        "messages": [
            {"role": "user", "content": "Thanks"},
            {"role": "assistant", "content": "You're welcome!"},
        ]
    }


# ---------------------------------------------------------------------------
# MCP response fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mcp_kg_rag_response():
    """Typical kg_rag.query MCP response with knowledge cards."""
    return {
        "result": {
            "cards": [
                {
                    "ref": "MI-1234",
                    "title": "GDPR Compliance Score",
                    "summary": "Current GDPR compliance is at 87% across the portfolio.",
                    "score": 0.92,
                    "domains": ["compliance", "gdpr"],
                },
                {
                    "ref": "MI-5678",
                    "title": "NIS2 Readiness",
                    "summary": "NIS2 directive readiness assessment shows gaps in incident reporting.",
                    "score": 0.85,
                    "domains": ["compliance", "nis2"],
                },
            ]
        }
    }


@pytest.fixture
def mcp_empty_response():
    """Empty MCP response (no cards found)."""
    return {"result": {"cards": []}}
