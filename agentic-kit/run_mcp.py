#!/usr/bin/env python3
"""
run_mcp.py — MCP CLI Entry Point for agentic-kit

Called from TypeScript via spawn('python', ['run_mcp.py', '<command>', '<json_args>']).
Returns JSON on stdout, errors on stderr. Exit code 0 = success, 1 = error.

Usage:
  python run_mcp.py snout_ingest '{"mode":"discovery"}'
  python run_mcp.py mrp_recalculate '{}'
  python run_mcp.py mrp_route '{"capability":"reasoning","geo":"EU","max_cost":0.00001}'
  python run_mcp.py hitl_escalate '{"issue_type":"Low Confidence","context":{"agent_id":"test"}}'
  python run_mcp.py contract_issue '{"requester":"test","contractor_agent_id":"qwen-eu-v2.5","deliverable_spec":{"task":"reasoning"}}'
  python run_mcp.py canary_evaluate '{"agent_id":"mistral-eu-large-v2"}'
  python run_mcp.py reward_compute '{"quality_score":0.9,"cost_per_1k":0.000002,"latency_ms":320}'
  python run_mcp.py chaos_test '{}'
  python run_mcp.py compliance_audit '{"action":"vendor_scrape","data_class":"PII"}'
"""

import sys
import os
import json
import traceback

# Add parent dir to path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _require_env(key: str) -> str:
    val = os.environ.get(key, "")
    if not val:
        raise EnvironmentError(f"Missing required env var: {key}")
    return val


# ─── Command Handlers ─────────────────────────────────────────────────────


def cmd_snout_ingest(args: dict) -> dict:
    """Run Snout discovery + ingestion cycle."""
    from snout_ingestor import SnoutIngestor

    uri = _require_env("NEO4J_URI")
    user = _require_env("NEO4J_USER")
    pw = _require_env("NEO4J_PASSWORD")

    ingestor = SnoutIngestor(uri, user, pw)
    try:
        mode = args.get("mode", "discovery")
        if mode == "discovery":
            evidence_ids = ingestor.run_discovery_cycle()
            return {"status": "success", "mode": "discovery", "evidence_ids": evidence_ids, "count": len(evidence_ids)}
        elif mode == "ingest":
            agent_data = args.get("agent_data")
            if not agent_data:
                return {"status": "error", "error": "agent_data required for ingest mode"}
            eid = ingestor.ingest_agent(agent_data)
            return {"status": "success" if eid else "skipped", "evidence_id": eid}
        else:
            return {"status": "error", "error": f"Unknown mode: {mode}"}
    finally:
        ingestor.close()


def cmd_mrp_recalculate(args: dict) -> dict:
    """Recalculate PhantomCluster nodes via MRP Engine."""
    from mrp_engine import MRPEngine

    engine = MRPEngine()
    try:
        count = engine.recalculate_clusters()
        return {"status": "success", "clusters_recalculated": count}
    finally:
        engine.close()


def cmd_mrp_route(args: dict) -> dict:
    """Route a request via DynamicRouter."""
    from router import DynamicRouter

    capability = args.get("capability")
    if not capability:
        return {"status": "error", "error": "capability is required"}

    router = DynamicRouter()
    try:
        result = router.route_request(
            capability=capability,
            geo=args.get("geo", "ANY"),
            max_cost=float(args.get("max_cost", 0.00001)),
        )
        return result
    finally:
        router.close()


def cmd_hitl_escalate(args: dict) -> dict:
    """Create a Linear HITL issue."""
    from linear_hitl import escalate_to_linear

    issue_type = args.get("issue_type", "Low Confidence Ingest")
    context = args.get("context", {})

    issue_id = escalate_to_linear(issue_type, context)
    return {"status": "success" if issue_id else "skipped", "issue_id": issue_id}


def cmd_contract_issue(args: dict) -> dict:
    """Issue an agent contract with SLA."""
    from contract_validator import ContractValidator

    requester = args.get("requester")
    contractor_agent_id = args.get("contractor_agent_id")
    if not requester or not contractor_agent_id:
        return {"status": "error", "error": "requester and contractor_agent_id required"}

    cv = ContractValidator()
    try:
        contract_id = cv.issue_contract(
            requester=requester,
            contractor_agent_id=contractor_agent_id,
            deliverable_spec=args.get("deliverable_spec", {}),
            sla_latency_ms=float(args.get("sla_latency_ms", 5000)),
            sla_quality_threshold=float(args.get("sla_quality_threshold", 0.85)),
        )
        return {"status": "success", "contract_id": contract_id}
    finally:
        cv.close()


def cmd_canary_evaluate(args: dict) -> dict:
    """Evaluate canary window for an agent."""
    from reward_function import CanaryController

    agent_id = args.get("agent_id")
    if not agent_id:
        return {"status": "error", "error": "agent_id required"}

    ctrl = CanaryController(agent_id)
    decision = ctrl.evaluate_window()
    status = ctrl.status()
    return {"status": "success", "decision": decision, "canary_status": status}


def cmd_reward_compute(args: dict) -> dict:
    """Compute reward R = 0.4*Q + 0.3*C + 0.3*L."""
    from reward_function import compute_reward, persist_reward_log

    quality = float(args.get("quality_score", 0.8))
    cost = float(args.get("cost_per_1k", 0.000002))
    latency = float(args.get("latency_ms", 320))

    reward = compute_reward(quality, cost, latency)

    agent_id = args.get("agent_id")
    if agent_id:
        try:
            persist_reward_log(agent_id, reward, quality, cost, latency)
        except Exception as e:
            return {"status": "success", "reward": reward, "persist_warning": str(e)}

    return {"status": "success", "reward": reward, "components": {
        "quality": quality,
        "cost_efficiency": 1.0 - min(cost / 0.0001, 1.0),
        "latency_score": 1.0 - min(latency / 5000, 1.0),
    }}


def cmd_chaos_test(args: dict) -> dict:
    """Run chaos engineering test suite."""
    from chaos_test import run_chaos_suite

    all_pass = run_chaos_suite()
    return {"status": "success", "all_pass": all_pass}


def cmd_compliance_audit(args: dict) -> dict:
    """Run GDPR compliance audit."""
    from compliance_audit import ResidencyEnforcer

    enforcer = ResidencyEnforcer()
    try:
        action = args.get("action", "audit")
        data_class = args.get("data_class", "GENERAL")

        try:
            enforcer.enforce(action, data_class)
            return {"status": "compliant", "action": action, "data_class": data_class}
        except Exception as e:
            return {"status": "violation", "error": str(e)}
    finally:
        enforcer.close()


# ─── Dispatch ─────────────────────────────────────────────────────────────

COMMANDS = {
    "snout_ingest":      cmd_snout_ingest,
    "mrp_recalculate":   cmd_mrp_recalculate,
    "mrp_route":         cmd_mrp_route,
    "hitl_escalate":     cmd_hitl_escalate,
    "contract_issue":    cmd_contract_issue,
    "canary_evaluate":   cmd_canary_evaluate,
    "reward_compute":    cmd_reward_compute,
    "chaos_test":        cmd_chaos_test,
    "compliance_audit":  cmd_compliance_audit,
}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "error": "Usage: run_mcp.py <command> [json_args]"}), file=sys.stderr)
        print(json.dumps({"commands": list(COMMANDS.keys())}))
        sys.exit(1)

    command = sys.argv[1]
    args_json = sys.argv[2] if len(sys.argv) > 2 else "{}"

    if command not in COMMANDS:
        print(json.dumps({
            "status": "error",
            "error": f"Unknown command: {command}",
            "available": list(COMMANDS.keys()),
        }))
        sys.exit(1)

    try:
        args = json.loads(args_json)
    except json.JSONDecodeError as e:
        print(json.dumps({"status": "error", "error": f"Invalid JSON args: {e}"}))
        sys.exit(1)

    try:
        result = COMMANDS[command](args)
        print(json.dumps(result, default=str))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }), file=sys.stderr)
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
