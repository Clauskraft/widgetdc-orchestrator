"""
linear_hitl.py — HITL Escalation Gate (Phase 2)

Creates Linear issues for low-confidence ingests or routing failures.
Uses Linear's GraphQL API directly (no MCP dependency — standalone kit).

Environment variables:
  LINEAR_API_KEY  = lin_api_...  (required)
  LINEAR_TEAM_ID  = e7e882f6-...  (UUID, defaults to Linear-clauskraft)
"""

import os
import json
import requests

# Default: Linear-clauskraft workspace (confirmed UUID from list_teams)
_DEFAULT_TEAM_ID = "e7e882f6-d598-4dc4-8766-eaa76dcf140f"

LINEAR_API_KEY = os.environ.get("LINEAR_API_KEY", "")
LINEAR_TEAM_ID = os.environ.get("LINEAR_TEAM_ID", _DEFAULT_TEAM_ID)


def escalate_to_linear(issue_type: str, context: dict) -> str | None:
    """
    Creates a Linear HITL issue and returns the issue identifier (e.g. 'LIN-745').

    If LINEAR_API_KEY is not set, logs a warning and returns None (non-fatal).
    """
    if not LINEAR_API_KEY:
        print("⚠️  LINEAR_API_KEY not set — skipping HITL escalation.")
        return None

    title       = f"[HITL] {issue_type}: {context.get('agent_id', 'Unknown')}"
    description = f"## HITL Escalation\n\n**Type:** {issue_type}\n\n```json\n{json.dumps(context, indent=2)}\n```"

    payload = {
        "query": """
            mutation CreateIssue($title: String!, $description: String!, $teamId: String!) {
                issueCreate(input: {
                    title: $title,
                    description: $description,
                    teamId: $teamId,
                    priority: 2
                }) {
                    success
                    issue { id identifier url }
                }
            }
        """,
        "variables": {
            "title":       title,
            "description": description,
            "teamId":      LINEAR_TEAM_ID,
        },
    }

    try:
        resp = requests.post(
            "https://api.linear.app/graphql",
            json=payload,
            headers={
                "Authorization": LINEAR_API_KEY,   # Linear accepts raw token (no "Bearer" prefix)
                "Content-Type":  "application/json",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("errors"):
            print(f"❌ Linear GraphQL error: {data['errors']}")
            return None

        result = data.get("data", {}).get("issueCreate", {})
        if result.get("success"):
            identifier = result["issue"]["identifier"]
            url        = result["issue"]["url"]
            print(f"🎫 Linear HITL created: {identifier} — {url}")
            return identifier
        else:
            print(f"❌ Linear issueCreate returned success=false: {result}")
            return None

    except requests.RequestException as e:
        print(f"❌ Linear API request failed: {e}")
        return None


if __name__ == "__main__":
    # Simulate a low-confidence ingestion escalation
    escalate_to_linear(
        issue_type="Low Confidence Ingest",
        context={
            "agent_id":   "test-agent-01",
            "confidence": 0.62,
            "reason":     "Confidence < 0.7 threshold",
            "source":     "snout_ingestor",
        },
    )
