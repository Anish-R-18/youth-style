"""
agent_qlearning.py
==================
Tabular Q-Learning with uniform-grid state discretisation.

Why discretisation?
  The environment's 6-dim continuous observation [0,1]^6 cannot be indexed
  directly into a table. We bin each dimension into N_BINS equal partitions,
  converting each float to an integer bucket. The resulting table has shape
  (B0, B1, B2, B3, B4, B5, 4) where Bi = bins for dim i and 4 = actions.

Stability tips embedded:
  ① Optimistic initialisation (Q=+0.1) drives early exploration without a
     separate count-based bonus.
  ② α decays per-cell: α(s,a) = α0 / (1 + visit_count(s,a)^0.6)
     — prevents thrashing in well-visited states.
  ③ ε-greedy with linear decay (ε_min = 0.05) ensures the agent never fully
     stops exploring rare states.
  ④ Q-values are clipped to [-20, 5] to prevent runaway negatives.
"""

import numpy as np
import pickle
from pathlib import Path
from typing import Tuple, Dict, List


# ═══════════════════════════════════════════════════════════════════════════════
#  Hyperparameters
# ═══════════════════════════════════════════════════════════════════════════════

HPARAMS: Dict = {
    # ── Q-Learning core ──────────────────────────────────────────────────────
    "alpha_0":       0.5,       # initial learning rate
    "alpha_decay":   0.6,       # per-cell decay exponent: α = α0 / (1+n^decay)
    "gamma":         0.97,      # discount — high because episode = 96 steps
    "epsilon_start": 1.0,       # initial exploration rate
    "epsilon_min":   0.05,      # floor — never fully greedy
    "epsilon_decay": 0.9995,    # multiplicative per-step decay
    # ── Discretisation ───────────────────────────────────────────────────────
    "n_bins": [10, 8, 2, 8, 5, 4],
    # dims:   T_in T_out occ tod price prev_pow
    # rule of thumb: finer for state vars that drive decisions (T_in, T_out),
    # coarser for slow-varying or binary vars (occupancy, prev_power).
    # total table cells = 10×8×2×8×5×4×4 = 102 400  (manageable in RAM)
    # ── Training ─────────────────────────────────────────────────────────────
    "n_episodes":    3_000,
    "log_interval":  200,
    # ── Q-value clipping ─────────────────────────────────────────────────────
    "q_min": -20.0,
    "q_max":   5.0,
}


# ═══════════════════════════════════════════════════════════════════════════════
#  QLearningAgent
# ═══════════════════════════════════════════════════════════════════════════════

class QLearningAgent:
    """
    Tabular Q-Learning agent with adaptive learning rate and ε-greedy policy.
    """

    def __init__(self, hparams: Dict = HPARAMS, seed: int = 0) -> None:
        self.hp  = hparams
        self.rng = np.random.default_rng(seed)

        bins = self.hp["n_bins"]
        n_actions = 4

        # Q-table: shape (*bins, n_actions); init optimistic at +0.1
        self.Q = np.full((*bins, n_actions), 0.1, dtype=np.float64)

        # Visit counts for per-cell learning-rate decay
        self.N = np.zeros((*bins, n_actions), dtype=np.int32)

        self.epsilon = self.hp["epsilon_start"]

        # Logging
        self.ep_rewards:    List[float] = []
        self.ep_energies:   List[float] = []
        self.ep_deviations: List[float] = []
        self.epsilons:      List[float] = []

    # ── Discretisation ──────────────────────────────────────────────────────

    def _discretise(self, obs: np.ndarray) -> Tuple[int, ...]:
        """
        Map a normalised obs ∈ [0,1]^6 → tuple of integer bin indices.
        Uses np.clip to handle the rare edge case obs == 1.0 exactly.
        """
        bins = self.hp["n_bins"]
        idx = []
        for i, (val, b) in enumerate(zip(obs, bins)):
            bucket = int(np.clip(val * b, 0, b - 1))
            idx.append(bucket)
        return tuple(idx)

    # ── Policy ───────────────────────────────────────────────────────────────

    def select_action(self, obs: np.ndarray, greedy: bool = False) -> int:
        """ε-greedy selection. Set greedy=True during evaluation."""
        if not greedy and self.rng.random() < self.epsilon:
            return int(self.rng.integers(0, 4))
        state = self._discretise(obs)
        return int(np.argmax(self.Q[state]))

    # ── Update ───────────────────────────────────────────────────────────────

    def update(
        self,
        obs:      np.ndarray,
        action:   int,
        reward:   float,
        next_obs: np.ndarray,
        done:     bool,
    ) -> None:
        s  = self._discretise(obs)
        s_ = self._discretise(next_obs)

        self.N[s][action] += 1
        # Adaptive per-cell learning rate
        alpha = self.hp["alpha_0"] / (1.0 + self.N[s][action] ** self.hp["alpha_decay"])

        td_target = reward + (0.0 if done else self.hp["gamma"] * np.max(self.Q[s_]))
        td_error  = td_target - self.Q[s][action]

        self.Q[s][action] = np.clip(
            self.Q[s][action] + alpha * td_error,
            self.hp["q_min"], self.hp["q_max"]
        )

    def decay_epsilon(self) -> None:
        self.epsilon = max(
            self.hp["epsilon_min"],
            self.epsilon * self.hp["epsilon_decay"]
        )

    # ── Save / Load ──────────────────────────────────────────────────────────

    def save(self, path: str = "qlearning_table.pkl") -> None:
        with open(path, "wb") as f:
            pickle.dump({"Q": self.Q, "N": self.N, "epsilon": self.epsilon}, f)
        print(f"[Q-Learning] Saved table → {path}")

    def load(self, path: str = "qlearning_table.pkl") -> None:
        with open(path, "rb") as f:
            data = pickle.load(f)
        self.Q, self.N, self.epsilon = data["Q"], data["N"], data["epsilon"]
        print(f"[Q-Learning] Loaded table ← {path}")


# ═══════════════════════════════════════════════════════════════════════════════
#  Training Loop
# ═══════════════════════════════════════════════════════════════════════════════

def train_qlearning(env, hparams: Dict = HPARAMS, seed: int = 42) -> QLearningAgent:
    """
    Train a Q-Learning agent on HVACEnv.

    Returns
    -------
    agent : QLearningAgent
        Trained agent with Q-table populated.
    """
    agent = QLearningAgent(hparams=hparams, seed=seed)
    n_ep  = hparams["n_episodes"]
    log_interval = hparams["log_interval"]

    print(f"\n{'═'*60}")
    print(f"  Q-Learning Training  ({n_ep} episodes)")
    print(f"  State table shape : {agent.Q.shape}")
    print(f"  Total cells       : {agent.Q.size:,}")
    print(f"{'═'*60}")

    for ep in range(1, n_ep + 1):
        obs, _ = env.reset()
        ep_reward  = 0.0
        ep_energy  = 0.0
        ep_dev     = 0.0
        terminated = truncated = False

        while not (terminated or truncated):
            action = agent.select_action(obs)
            next_obs, reward, terminated, truncated, info = env.step(action)
            agent.update(obs, action, reward, next_obs, terminated or truncated)
            agent.decay_epsilon()

            ep_reward += reward
            ep_energy += info["energy_kwh"]
            ep_dev    += info["comfort_deviation"]
            obs = next_obs

        ep_steps = env.episode_length
        agent.ep_rewards.append(ep_reward)
        agent.ep_energies.append(ep_energy)
        agent.ep_deviations.append(ep_dev / ep_steps)
        agent.epsilons.append(agent.epsilon)

        if ep % log_interval == 0:
            window = min(log_interval, ep)
            r_avg  = np.mean(agent.ep_rewards[-window:])
            e_avg  = np.mean(agent.ep_energies[-window:])
            d_avg  = np.mean(agent.ep_deviations[-window:])
            print(
                f"  Ep {ep:>5}/{n_ep} | "
                f"ε={agent.epsilon:.3f} | "
                f"R={r_avg:+.3f} | "
                f"Energy={e_avg:.2f}kWh | "
                f"ΔT={d_avg:.2f}°C"
            )

    print(f"\n[Q-Learning] Training complete.")
    return agent


# ═══════════════════════════════════════════════════════════════════════════════
#  Quick test
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from hvac_env import HVACEnv

    env   = HVACEnv(episode_length=96)
    agent = train_qlearning(env, seed=42)
    agent.save("qlearning_table.pkl")

    # Greedy evaluation — 5 episodes
    print("\n[Q-Learning] Greedy evaluation (5 episodes):")
    for i in range(5):
        obs, _ = env.reset()
        tot_r = 0.0
        done  = False
        while not done:
            a = agent.select_action(obs, greedy=True)
            obs, r, term, trunc, _ = env.step(a)
            tot_r += r
            done = term or trunc
        print(f"  Eval ep {i+1}: total reward = {tot_r:.3f}")
