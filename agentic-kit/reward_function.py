"""
reward_function.py — RL-Canary Deployment Engine (Phase 3)

Implements reward-driven traffic adaptation with safe canary rollout.

Reward formula:
  R = 0.4 × quality_score
    + 0.3 × cost_efficiency     (1 - normalised_cost)
    + 0.3 × latency_score       (1 - normalised_latency_penalty)

Canary stages: 1% → 5% → 25% → 100%
  - Auto-promotes when ΔR ≥ 0 over evaluation window
  - Auto-rolls-back when ΔR < -0.05 for 3 consecutive 6h windows
  - State persisted in Redis (key: canary:<agent_id>)

Operates strictly on clusters with validity_score ≥ 0.75 (HITL boundary).

Environment variables:
  NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
  REDIS_URL  (optional — falls back to in-memory state)
"""

import os
import json
import time
import logging
from typing import Optional
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# ─── Reward weights (from Orch_8 spec) ───────────────────────────────────────
W_QUALITY   = 0.4
W_COST      = 0.3
W_LATENCY   = 0.3

# ─── Canary stages ────────────────────────────────────────────────────────────
CANARY_STAGES   = [0.01, 0.05, 0.25, 1.0]   # traffic fractions
EVAL_WINDOW_H   = 6                           # evaluation window in hours
ROLLBACK_DELTA  = -0.05                       # ΔR threshold for rollback
ROLLBACK_STREAK = 3                           # consecutive bad windows before revert

# ─── Cost / latency normalisation bounds ──────────────────────────────────────
MAX_COST_PER_1K    = 0.0001   # $0.0001/1k tokens = ceiling for normalisation
MAX_LATENCY_MS     = 5000     # 5 000 ms = ceiling for normalisation


# ─── Reward function ──────────────────────────────────────────────────────────

def compute_reward(
    quality_score: float,       # 0–1 (LLM-as-Judge or task outcome score)
    cost_per_1k: float,         # pricing_input_per_1k of selected agent
    latency_ms: float,          # actual response latency
) -> float:
    """
    Compute scalar reward R ∈ [0, 1].

    quality_score   — higher is better
    cost_per_1k     — lower is better  (normalised against MAX_COST_PER_1K)
    latency_ms      — lower is better  (normalised against MAX_LATENCY_MS)
    """
    cost_efficiency = 1.0 - min(cost_per_1k / MAX_COST_PER_1K, 1.0)
    latency_score   = 1.0 - min(latency_ms  / MAX_LATENCY_MS,  1.0)

    reward = (
        W_QUALITY * quality_score  +
        W_COST    * cost_efficiency +
        W_LATENCY * latency_score
    )
    return round(min(max(reward, 0.0), 1.0), 4)


# ─── In-memory state (Redis-backed in production) ────────────────────────────

_state: dict[str, dict] = {}  # agent_id → canary state


def _load_state(agent_id: str) -> dict:
    """Load canary state. Uses in-memory fallback if Redis unavailable."""
    try:
        redis_url = os.environ.get("REDIS_URL", "")
        if redis_url:
            import redis as redislib
            r = redislib.from_url(redis_url)
            raw = r.get(f"canary:{agent_id}")
            if raw:
                return json.loads(raw)
    except Exception:
        pass
    return _state.get(agent_id, {})


def _save_state(agent_id: str, state: dict) -> None:
    try:
        redis_url = os.environ.get("REDIS_URL", "")
        if redis_url:
            import redis as redislib
            r = redislib.from_url(redis_url)
            r.set(f"canary:{agent_id}", json.dumps(state), ex=86400 * 7)
    except Exception:
        pass
    _state[agent_id] = state


# ─── Canary controller ────────────────────────────────────────────────────────

class CanaryController:
    """
    Manages canary traffic fraction for a candidate agent.

    Usage:
        ctrl = CanaryController("mistral-eu-large-v2")
        fraction = ctrl.traffic_fraction()   # how much traffic to send to canary
        ctrl.record_outcome(reward)           # call after each routed request
        ctrl.evaluate_window()               # call every 6h (from cron)
    """

    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        state = _load_state(agent_id)
        self.stage_idx        = state.get("stage_idx",        0)
        self.reward_history   = state.get("reward_history",   [])  # list of (ts, R)
        self.bad_streak       = state.get("bad_streak",       0)
        self.promoted_at      = state.get("promoted_at",      None)
        self.rolled_back      = state.get("rolled_back",      False)

    def _persist(self) -> None:
        _save_state(self.agent_id, {
            "stage_idx":      self.stage_idx,
            "reward_history": self.reward_history[-200:],  # cap at 200 entries
            "bad_streak":     self.bad_streak,
            "promoted_at":    self.promoted_at,
            "rolled_back":    self.rolled_back,
        })

    def traffic_fraction(self) -> float:
        """Current traffic fraction for this canary agent (0.0 if rolled back)."""
        if self.rolled_back:
            return 0.0
        return CANARY_STAGES[self.stage_idx]

    def record_outcome(self, reward: float) -> None:
        """Record a reward observation for this canary agent."""
        self.reward_history.append((time.time(), reward))
        self._persist()

    def evaluate_window(self) -> str:
        """
        Evaluate the last EVAL_WINDOW_H hours of reward data.
        Returns one of: 'promote', 'hold', 'rollback'.
        """
        if self.rolled_back:
            return "rollback"

        now = time.time()
        window_start = now - EVAL_WINDOW_H * 3600
        recent = [r for ts, r in self.reward_history if ts >= window_start]

        if len(recent) < 2:
            logging.info(f"[Canary:{self.agent_id}] Insufficient data ({len(recent)} samples) — hold")
            return "hold"

        avg_reward = sum(recent) / len(recent)

        # Compare against previous window
        prev_start  = window_start - EVAL_WINDOW_H * 3600
        prev        = [r for ts, r in self.reward_history if prev_start <= ts < window_start]
        prev_avg    = sum(prev) / len(prev) if prev else avg_reward
        delta       = avg_reward - prev_avg

        logging.info(
            f"[Canary:{self.agent_id}] stage={self.stage_idx} "
            f"avg_R={avg_reward:.4f} ΔR={delta:+.4f} bad_streak={self.bad_streak}"
        )

        if delta < ROLLBACK_DELTA:
            self.bad_streak += 1
            if self.bad_streak >= ROLLBACK_STREAK:
                self.rolled_back = True
                self._persist()
                logging.warning(
                    f"[Canary:{self.agent_id}] ROLLBACK — {self.bad_streak} consecutive bad windows"
                )
                return "rollback"
            self._persist()
            return "hold"

        # Reset streak on recovery
        self.bad_streak = 0

        if delta >= 0 and self.stage_idx < len(CANARY_STAGES) - 1:
            self.stage_idx   += 1
            self.promoted_at  = datetime.now(timezone.utc).isoformat()
            self._persist()
            logging.info(
                f"[Canary:{self.agent_id}] PROMOTED → {CANARY_STAGES[self.stage_idx]*100:.0f}%"
            )
            return "promote"

        self._persist()
        return "hold"

    def status(self) -> dict:
        return {
            "agent_id":       self.agent_id,
            "stage":          self.stage_idx,
            "traffic_pct":    f"{self.traffic_fraction()*100:.0f}%",
            "rolled_back":    self.rolled_back,
            "bad_streak":     self.bad_streak,
            "observations":   len(self.reward_history),
            "promoted_at":    self.promoted_at,
        }


# ─── Integration: canary-aware route selection ───────────────────────────────

def canary_route(primary: dict, fallback: Optional[dict]) -> dict:
    """
    Intercepts route_request() output and applies canary traffic splitting.

    primary  — result from DynamicRouter (highest validity cluster, lowest cost)
    fallback — second candidate (used when canary is active)

    Returns:
        selected agent dict + canary metadata
    """
    if not fallback:
        return {**primary, "canary_active": False, "traffic_split": "100%→primary"}

    canary_agent_id = fallback["agent_id"]
    ctrl = CanaryController(canary_agent_id)
    frac = ctrl.traffic_fraction()

    import random
    use_canary = (not ctrl.rolled_back) and (random.random() < frac)

    selected = fallback if use_canary else primary
    return {
        **selected,
        "canary_active":  frac > 0,
        "canary_agent":   canary_agent_id,
        "traffic_split":  f"{frac*100:.0f}%→canary / {(1-frac)*100:.0f}%→primary",
        "rolled_back":    ctrl.rolled_back,
    }


# ─── Reward persistence to Neo4j ─────────────────────────────────────────────

def persist_reward_log(
    agent_id: str,
    reward: float,
    quality_score: float,
    cost_per_1k: float,
    latency_ms: float,
) -> None:
    """Write reward observation to Neo4j for long-term RL analysis."""
    try:
        uri      = os.environ.get("NEO4J_URI",      "")
        user     = os.environ.get("NEO4J_USER",     "neo4j")
        password = os.environ.get("NEO4J_PASSWORD", "")
        if not (uri and password):
            return

        from neo4j import GraphDatabase
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session() as session:
            session.run("""
                MATCH (a:Agent {agent_id: $agent_id})
                CREATE (r:RewardLog {
                    agent_id:      $agent_id,
                    reward:        $reward,
                    quality_score: $quality_score,
                    cost_per_1k:   $cost_per_1k,
                    latency_ms:    $latency_ms,
                    logged_at:     datetime()
                })
                MERGE (a)-[:HAS_REWARD_LOG]->(r)
            """, agent_id=agent_id, reward=reward, quality_score=quality_score,
                cost_per_1k=cost_per_1k, latency_ms=latency_ms)
        driver.close()
    except Exception as e:
        logging.warning(f"[RewardLog] Failed to persist: {e}")


# ─── Demo / standalone test ───────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== RL-Canary Reward Function Demo ===\n")

    # 1. Compute sample rewards
    scenarios = [
        ("high quality, low cost, fast",  0.92, 0.000002, 320),
        ("medium quality, medium cost",   0.75, 0.000005, 800),
        ("low quality, high cost, slow",  0.45, 0.000008, 3200),
        ("baseline (qwen-eu-v2.5 typical)", 0.88, 0.000002, 450),
    ]

    print("Reward calculations:")
    for label, q, c, l in scenarios:
        r = compute_reward(q, c, l)
        print(f"  {label:<40} R = {r:.4f}")

    print()

    # 2. Simulate canary lifecycle for mistral-eu-large-v2
    ctrl = CanaryController("mistral-eu-large-v2")
    print(f"Canary status: {ctrl.status()}")
    print(f"Initial traffic fraction: {ctrl.traffic_fraction()*100:.0f}%")

    # Simulate 5 good outcomes → expect promotion after window eval
    for i in range(5):
        ctrl.record_outcome(compute_reward(0.90, 0.000003, 400))

    decision = ctrl.evaluate_window()
    print(f"Window evaluation: {decision}")
    print(f"Post-eval status: {ctrl.status()}")

    # 3. Canary route demo
    primary  = {"agent_id": "qwen-eu-v2.5",        "cost": 0.000002, "cluster_id": "Cluster_EU_reasoning"}
    fallback = {"agent_id": "mistral-eu-large-v2",  "cost": 0.000003, "cluster_id": "Cluster_EU_reasoning"}

    result = canary_route(primary, fallback)
    print(f"\nCanary route result: {result}")
