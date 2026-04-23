"""
agent_dqn.py
============
Deep Q-Network (DQN) — Mnih et al., Nature 2015.

Key components
──────────────
  ① Online network  Q(s,a; θ)        — updated every step
  ② Target network  Q(s,a; θ⁻)       — frozen copy, soft-synced every C steps
  ③ Replay buffer   (s, a, r, s', d) — breaks temporal correlations
  ④ Double-DQN      — reduces overestimation bias
     target = r + γ · Q(s', argmax_a Q(s',a;θ); θ⁻)

Stability tips embedded
───────────────────────
  ① Huber loss (SmoothL1) instead of MSE — tolerant of outlier TD errors
  ② Gradient clipping (max norm 10) — prevents exploding gradients
  ③ Soft target update (τ=0.005) — smoother than hard copy every C steps
  ④ Layer normalisation in Q-network — stabilises activations with small batches
  ⑤ Reward clipping during replay sampling — ±5 hard clip
  ⑥ Warm-up phase — no training until buffer has ≥ min_replay_size samples
"""

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from collections import deque
from typing import Tuple, Dict, List
import random


# ═══════════════════════════════════════════════════════════════════════════════
#  Hyperparameters
# ═══════════════════════════════════════════════════════════════════════════════

HPARAMS: Dict = {
    # ── Network ──────────────────────────────────────────────────────────────
    "hidden_dims":       [128, 128],   # MLP layer widths
    "activation":        "relu",
    # ── Replay buffer ────────────────────────────────────────────────────────
    "buffer_size":       50_000,
    "batch_size":        256,
    "min_replay_size":   1_000,        # warm-up: fill buffer before first update
    # ── Learning ─────────────────────────────────────────────────────────────
    "lr":                3e-4,         # Adam — conservative for stability
    "gamma":             0.97,
    "tau":               0.005,        # soft target update coefficient
    "grad_clip":         10.0,
    # ── Exploration ──────────────────────────────────────────────────────────
    "epsilon_start":     1.0,
    "epsilon_min":       0.05,
    "epsilon_decay":     0.9997,       # slower than Q-Learning: DQN trains every step
    # ── Training schedule ────────────────────────────────────────────────────
    "n_episodes":        1_500,
    "train_every":       1,            # update network every N env steps
    "log_interval":      100,
    # ── Reward clipping ──────────────────────────────────────────────────────
    "reward_clip":       5.0,
}


# ═══════════════════════════════════════════════════════════════════════════════
#  Replay Buffer
# ═══════════════════════════════════════════════════════════════════════════════

class ReplayBuffer:
    """
    Fixed-size circular replay buffer with uniform sampling.
    Stores transitions as numpy arrays and converts to tensors on demand.
    """

    def __init__(self, capacity: int, obs_dim: int = 6, device: str = "cpu") -> None:
        self.capacity = capacity
        self.device   = device
        self.ptr      = 0
        self.size     = 0

        self.obs      = np.zeros((capacity, obs_dim), dtype=np.float32)
        self.actions  = np.zeros((capacity,),         dtype=np.int64)
        self.rewards  = np.zeros((capacity,),         dtype=np.float32)
        self.next_obs = np.zeros((capacity, obs_dim), dtype=np.float32)
        self.dones    = np.zeros((capacity,),         dtype=np.float32)

    def push(
        self,
        obs: np.ndarray, action: int, reward: float,
        next_obs: np.ndarray, done: bool,
    ) -> None:
        self.obs[self.ptr]      = obs
        self.actions[self.ptr]  = action
        self.rewards[self.ptr]  = reward
        self.next_obs[self.ptr] = next_obs
        self.dones[self.ptr]    = float(done)
        self.ptr  = (self.ptr + 1) % self.capacity
        self.size = min(self.size + 1, self.capacity)

    def sample(self, batch_size: int):
        idx = np.random.randint(0, self.size, size=batch_size)
        return (
            torch.FloatTensor(self.obs[idx]).to(self.device),
            torch.LongTensor(self.actions[idx]).to(self.device),
            torch.FloatTensor(self.rewards[idx]).to(self.device),
            torch.FloatTensor(self.next_obs[idx]).to(self.device),
            torch.FloatTensor(self.dones[idx]).to(self.device),
        )

    def __len__(self) -> int:
        return self.size


# ═══════════════════════════════════════════════════════════════════════════════
#  Q-Network
# ═══════════════════════════════════════════════════════════════════════════════

class QNetwork(nn.Module):
    """
    MLP Q-Network with LayerNorm for training stability.

    Architecture: Linear → LayerNorm → ReLU → … → Linear(n_actions)
    LayerNorm after each hidden layer normalises activations independently
    of batch statistics — important because our batches contain heterogeneous
    time steps from a non-stationary environment.
    """

    def __init__(
        self, obs_dim: int, n_actions: int, hidden_dims: List[int]
    ) -> None:
        super().__init__()
        layers = []
        in_dim = obs_dim
        for h in hidden_dims:
            layers += [
                nn.Linear(in_dim, h),
                nn.LayerNorm(h),
                nn.ReLU(),
            ]
            in_dim = h
        layers.append(nn.Linear(in_dim, n_actions))
        self.net = nn.Sequential(*layers)
        self._init_weights()

    def _init_weights(self) -> None:
        """Orthogonal init for all Linear layers — empirically stable for RL."""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
                nn.init.constant_(m.bias, 0.0)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


# ═══════════════════════════════════════════════════════════════════════════════
#  DQN Agent
# ═══════════════════════════════════════════════════════════════════════════════

class DQNAgent:

    def __init__(
        self,
        obs_dim:  int = 6,
        n_actions: int = 4,
        hparams:  Dict = HPARAMS,
        seed:     int  = 0,
    ) -> None:
        self.hp       = hparams
        self.n_actions = n_actions
        self.epsilon  = hparams["epsilon_start"]
        self.device   = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        torch.manual_seed(seed)
        np.random.seed(seed)
        random.seed(seed)

        # Networks
        self.online = QNetwork(obs_dim, n_actions, hparams["hidden_dims"]).to(self.device)
        self.target = QNetwork(obs_dim, n_actions, hparams["hidden_dims"]).to(self.device)
        self.target.load_state_dict(self.online.state_dict())
        self.target.eval()

        self.optimizer = optim.Adam(self.online.parameters(), lr=hparams["lr"])
        self.loss_fn   = nn.SmoothL1Loss()  # Huber loss — robust to outlier TD errors

        self.buffer = ReplayBuffer(
            capacity=hparams["buffer_size"], obs_dim=obs_dim, device=str(self.device)
        )

        self.total_steps  = 0
        self.losses:           List[float] = []
        self.ep_rewards:       List[float] = []
        self.ep_energies:      List[float] = []
        self.ep_deviations:    List[float] = []

        print(f"[DQN] Device: {self.device}")
        print(f"[DQN] Network params: {sum(p.numel() for p in self.online.parameters()):,}")

    # ── Policy ───────────────────────────────────────────────────────────────

    def select_action(self, obs: np.ndarray, greedy: bool = False) -> int:
        if not greedy and random.random() < self.epsilon:
            return random.randint(0, self.n_actions - 1)
        with torch.no_grad():
            t = torch.FloatTensor(obs).unsqueeze(0).to(self.device)
            return int(self.online(t).argmax(dim=1).item())

    # ── Learning step ────────────────────────────────────────────────────────

    def learn(self) -> float:
        """
        One gradient update using a sampled mini-batch.

        Uses Double-DQN target:
          a* = argmax_a Q(s', a; θ_online)
          y  = r + γ(1-d) · Q(s', a*; θ_target)
        """
        obs_b, act_b, rew_b, nobs_b, done_b = self.buffer.sample(self.hp["batch_size"])

        # Reward clipping — prevents large TD targets from destabilising Q-values
        rew_b = torch.clamp(rew_b, -self.hp["reward_clip"], self.hp["reward_clip"])

        with torch.no_grad():
            # Double DQN: action selection from online, value from target
            best_actions = self.online(nobs_b).argmax(dim=1, keepdim=True)
            next_q       = self.target(nobs_b).gather(1, best_actions).squeeze(1)
            y            = rew_b + self.hp["gamma"] * (1.0 - done_b) * next_q

        q_pred = self.online(obs_b).gather(1, act_b.unsqueeze(1)).squeeze(1)
        loss   = self.loss_fn(q_pred, y)

        self.optimizer.zero_grad()
        loss.backward()
        # Gradient clipping — prevents exploding gradient pathologies
        nn.utils.clip_grad_norm_(self.online.parameters(), self.hp["grad_clip"])
        self.optimizer.step()

        # Soft target update: θ⁻ ← τθ + (1−τ)θ⁻
        for p_online, p_target in zip(self.online.parameters(), self.target.parameters()):
            p_target.data.copy_(
                self.hp["tau"] * p_online.data + (1.0 - self.hp["tau"]) * p_target.data
            )

        return float(loss.item())

    def decay_epsilon(self) -> None:
        self.epsilon = max(
            self.hp["epsilon_min"],
            self.epsilon * self.hp["epsilon_decay"]
        )

    # ── Save / Load ──────────────────────────────────────────────────────────

    def save(self, path: str = "dqn_model.pt") -> None:
        torch.save({
            "online":  self.online.state_dict(),
            "target":  self.target.state_dict(),
            "epsilon": self.epsilon,
        }, path)
        print(f"[DQN] Saved → {path}")

    def load(self, path: str = "dqn_model.pt") -> None:
        ckpt = torch.load(path, map_location=self.device)
        self.online.load_state_dict(ckpt["online"])
        self.target.load_state_dict(ckpt["target"])
        self.epsilon = ckpt["epsilon"]
        print(f"[DQN] Loaded ← {path}")


# ═══════════════════════════════════════════════════════════════════════════════
#  Training Loop
# ═══════════════════════════════════════════════════════════════════════════════

def train_dqn(env, hparams: Dict = HPARAMS, seed: int = 42) -> DQNAgent:
    """
    Train a DQN agent on HVACEnv.

    Returns
    -------
    agent : DQNAgent
        Trained agent.
    """
    agent = DQNAgent(obs_dim=6, n_actions=4, hparams=hparams, seed=seed)
    n_ep  = hparams["n_episodes"]
    log_i = hparams["log_interval"]

    print(f"\n{'═'*60}")
    print(f"  DQN Training  ({n_ep} episodes)")
    print(f"  Warm-up until {hparams['min_replay_size']} transitions in buffer")
    print(f"{'═'*60}")

    for ep in range(1, n_ep + 1):
        obs, _     = env.reset()
        ep_reward  = 0.0
        ep_energy  = 0.0
        ep_dev     = 0.0
        ep_loss    = []
        terminated = truncated = False

        while not (terminated or truncated):
            action = agent.select_action(obs)
            next_obs, reward, terminated, truncated, info = env.step(action)

            agent.buffer.push(obs, action, reward, next_obs, terminated)
            agent.total_steps += 1

            # Only start learning once the buffer has enough diversity
            if (
                len(agent.buffer) >= hparams["min_replay_size"]
                and agent.total_steps % hparams["train_every"] == 0
            ):
                loss = agent.learn()
                ep_loss.append(loss)

            agent.decay_epsilon()
            ep_reward += reward
            ep_energy += info["energy_kwh"]
            ep_dev    += info["comfort_deviation"]
            obs = next_obs

        ep_steps = env.episode_length
        agent.ep_rewards.append(ep_reward)
        agent.ep_energies.append(ep_energy)
        agent.ep_deviations.append(ep_dev / ep_steps)
        if ep_loss:
            agent.losses.append(np.mean(ep_loss))

        if ep % log_i == 0:
            window  = min(log_i, ep)
            r_avg   = np.mean(agent.ep_rewards[-window:])
            e_avg   = np.mean(agent.ep_energies[-window:])
            d_avg   = np.mean(agent.ep_deviations[-window:])
            l_avg   = np.mean(agent.losses[-window:]) if agent.losses else float("nan")
            buf_pct = 100 * len(agent.buffer) / hparams["buffer_size"]
            print(
                f"  Ep {ep:>4}/{n_ep} | "
                f"ε={agent.epsilon:.3f} | "
                f"R={r_avg:+.3f} | "
                f"E={e_avg:.2f}kWh | "
                f"ΔT={d_avg:.2f}°C | "
                f"Loss={l_avg:.4f} | "
                f"Buf={buf_pct:.0f}%"
            )

    print(f"\n[DQN] Training complete. Total steps: {agent.total_steps:,}")
    return agent


# ═══════════════════════════════════════════════════════════════════════════════
#  Quick test
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from hvac_env import HVACEnv

    env   = HVACEnv(episode_length=96)
    agent = train_dqn(env, seed=42)
    agent.save("dqn_model.pt")

    print("\n[DQN] Greedy evaluation (5 episodes):")
    for i in range(5):
        obs, _ = env.reset()
        tot_r  = 0.0
        done   = False
        while not done:
            a = agent.select_action(obs, greedy=True)
            obs, r, term, trunc, _ = env.step(a)
            tot_r += r
            done = term or trunc
        print(f"  Eval ep {i+1}: total reward = {tot_r:.3f}")
