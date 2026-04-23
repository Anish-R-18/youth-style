"""
agent_ppo.py
============
Proximal Policy Optimisation (PPO-Clip) — Schulman et al., 2017.

Architecture: Shared-torso Actor-Critic
  ┌──────────────────────────────────┐
  │  Shared MLP trunk (2 × 128)      │
  ├──────────────────┬───────────────┤
  │  Policy head     │  Value head   │
  │  π(a|s) softmax  │  V(s) scalar  │
  └──────────────────┴───────────────┘

Key algorithmic components
──────────────────────────
  ① PPO-Clip objective:
       L_CLIP = E[min(r·Â, clip(r,1-ε,1+ε)·Â)]
     Prevents destructively large policy updates.

  ② Generalised Advantage Estimation (GAE, λ=0.95):
       Â_t = δ_t + (γλ)δ_{t+1} + … + (γλ)^{T-t}δ_T
     Trades off bias vs variance in the advantage estimate.

  ③ Entropy bonus: H(π) added to objective — keeps policy exploratory.

  ④ Value function clipping: |V_pred - V_old|² clipped — stabilises critic.

  ⑤ Rollout-based training: collect N steps, compute returns, run K epochs.

Stability tips embedded
───────────────────────
  ① Advantage normalisation: (Â - μ)/σ per mini-batch
  ② Shared trunk with separate heads and separate learning-rate scale
  ③ Orthogonal weight init with gain √2 (hidden) and 0.01 (policy head)
  ④ Gradient clipping at 0.5 — stricter than DQN because on-policy is sensitive
  ⑤ Early stopping on KL: if mean KL > 0.015, stop update epochs
"""

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import Categorical
from typing import Dict, List, Tuple


# ═══════════════════════════════════════════════════════════════════════════════
#  Hyperparameters
# ═══════════════════════════════════════════════════════════════════════════════

HPARAMS: Dict = {
    # ── Network ──────────────────────────────────────────────────────────────
    "hidden_dims":    [128, 128],
    # ── PPO core ─────────────────────────────────────────────────────────────
    "lr":             3e-4,
    "gamma":          0.97,
    "gae_lambda":     0.95,
    "clip_epsilon":   0.2,          # PPO clip ratio
    "vf_coef":        0.5,          # value loss weight in combined objective
    "ent_coef":       0.01,         # entropy bonus weight (encourages exploration)
    "max_grad_norm":  0.5,          # strict clipping for on-policy stability
    "target_kl":      0.015,        # early-stop threshold per update epoch
    # ── Rollout ──────────────────────────────────────────────────────────────
    "n_steps":        96,           # steps per rollout = 1 full episode
    "n_epochs":       10,           # gradient epochs per rollout
    "mini_batch_size": 32,
    # ── Training ─────────────────────────────────────────────────────────────
    "n_episodes":     1_500,
    "log_interval":   100,
}


# ═══════════════════════════════════════════════════════════════════════════════
#  Actor-Critic Network
# ═══════════════════════════════════════════════════════════════════════════════

class ActorCritic(nn.Module):
    """
    Shared-backbone Actor-Critic.

    Shared trunk extracts features common to both policy and value heads,
    reducing total parameter count and encouraging useful representations.
    """

    def __init__(
        self,
        obs_dim:    int,
        n_actions:  int,
        hidden_dims: List[int],
    ) -> None:
        super().__init__()

        # Shared feature extractor
        trunk_layers = []
        in_dim = obs_dim
        for h in hidden_dims:
            trunk_layers += [nn.Linear(in_dim, h), nn.Tanh()]
            # Tanh preferred over ReLU in PPO: bounded activations, better
            # with orthogonal init, empirically more stable for policy gradients
            in_dim = h
        self.trunk = nn.Sequential(*trunk_layers)

        # Policy head — small init to start near uniform policy
        self.policy_head = nn.Linear(in_dim, n_actions)
        # Value head
        self.value_head  = nn.Linear(in_dim, 1)

        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.trunk.modules():
            if isinstance(m, nn.Linear):
                nn.init.orthogonal_(m.weight, gain=np.sqrt(2))
                nn.init.constant_(m.bias, 0.0)
        # Policy head: small gain → near-uniform initial distribution
        nn.init.orthogonal_(self.policy_head.weight, gain=0.01)
        nn.init.constant_(self.policy_head.bias, 0.0)
        # Value head: unit gain
        nn.init.orthogonal_(self.value_head.weight, gain=1.0)
        nn.init.constant_(self.value_head.bias, 0.0)

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """Returns (logits, value)."""
        features = self.trunk(x)
        return self.policy_head(features), self.value_head(features).squeeze(-1)

    def get_action_and_value(
        self, x: torch.Tensor, action: torch.Tensor = None
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Sample (or evaluate) an action and return:
          action, log_prob, entropy, value
        """
        logits, value = self(x)
        dist  = Categorical(logits=logits)
        if action is None:
            action = dist.sample()
        log_prob = dist.log_prob(action)
        entropy  = dist.entropy()
        return action, log_prob, entropy, value


# ═══════════════════════════════════════════════════════════════════════════════
#  Rollout Buffer
# ═══════════════════════════════════════════════════════════════════════════════

class RolloutBuffer:
    """
    On-policy rollout storage.
    Stores one full rollout, computes returns and GAE advantages.
    Cleared after each update — PPO is on-policy.
    """

    def __init__(self, n_steps: int, obs_dim: int, device: str) -> None:
        self.n_steps = n_steps
        self.device  = device
        self.ptr     = 0

        self.obs      = np.zeros((n_steps, obs_dim), dtype=np.float32)
        self.actions  = np.zeros((n_steps,),          dtype=np.int64)
        self.rewards  = np.zeros((n_steps,),          dtype=np.float32)
        self.values   = np.zeros((n_steps,),          dtype=np.float32)
        self.log_probs = np.zeros((n_steps,),         dtype=np.float32)
        self.dones    = np.zeros((n_steps,),          dtype=np.float32)

        # Computed after rollout finishes
        self.returns:    np.ndarray = None
        self.advantages: np.ndarray = None

    def push(
        self,
        obs: np.ndarray, action: int, reward: float,
        value: float, log_prob: float, done: bool,
    ) -> None:
        self.obs[self.ptr]       = obs
        self.actions[self.ptr]   = action
        self.rewards[self.ptr]   = reward
        self.values[self.ptr]    = value
        self.log_probs[self.ptr] = log_prob
        self.dones[self.ptr]     = float(done)
        self.ptr += 1

    def compute_returns_and_advantages(
        self, last_value: float, gamma: float, gae_lambda: float
    ) -> None:
        """
        GAE:  δ_t = r_t + γ·V(s_{t+1})·(1−d_t) − V(s_t)
              Â_t = δ_t + (γλ)·δ_{t+1} + … + (γλ)^{T-t}·δ_T
        Returns: Â_t + V(s_t)  (used as regression target for value head)
        """
        advantages = np.zeros_like(self.rewards)
        gae        = 0.0

        for t in reversed(range(self.n_steps)):
            next_val   = last_value if t == self.n_steps - 1 else self.values[t + 1]
            next_done  = self.dones[t]
            delta      = self.rewards[t] + gamma * next_val * (1.0 - next_done) - self.values[t]
            gae        = delta + gamma * gae_lambda * (1.0 - next_done) * gae
            advantages[t] = gae

        self.returns    = advantages + self.values
        self.advantages = advantages

    def get_mini_batches(self, mini_batch_size: int, device: str):
        """Yield shuffled mini-batches as tensors."""
        idx = np.arange(self.n_steps)
        np.random.shuffle(idx)

        obs_t   = torch.FloatTensor(self.obs).to(device)
        act_t   = torch.LongTensor(self.actions).to(device)
        lp_t    = torch.FloatTensor(self.log_probs).to(device)
        ret_t   = torch.FloatTensor(self.returns).to(device)
        adv_t   = torch.FloatTensor(self.advantages).to(device)
        val_t   = torch.FloatTensor(self.values).to(device)

        for start in range(0, self.n_steps, mini_batch_size):
            mb = idx[start: start + mini_batch_size]
            yield obs_t[mb], act_t[mb], lp_t[mb], ret_t[mb], adv_t[mb], val_t[mb]

    def reset(self) -> None:
        self.ptr = 0


# ═══════════════════════════════════════════════════════════════════════════════
#  PPO Agent
# ═══════════════════════════════════════════════════════════════════════════════

class PPOAgent:

    def __init__(
        self,
        obs_dim:   int  = 6,
        n_actions: int  = 4,
        hparams:   Dict = HPARAMS,
        seed:      int  = 0,
    ) -> None:
        self.hp       = hparams
        self.n_actions = n_actions
        self.device   = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        torch.manual_seed(seed)
        np.random.seed(seed)

        self.ac = ActorCritic(obs_dim, n_actions, hparams["hidden_dims"]).to(self.device)
        self.optimizer = optim.Adam(self.ac.parameters(), lr=hparams["lr"], eps=1e-5)

        self.buffer = RolloutBuffer(hparams["n_steps"], obs_dim, str(self.device))

        # Logging
        self.ep_rewards:    List[float] = []
        self.ep_energies:   List[float] = []
        self.ep_deviations: List[float] = []
        self.policy_losses: List[float] = []
        self.value_losses:  List[float] = []
        self.entropies:     List[float] = []

        print(f"[PPO] Device: {self.device}")
        print(f"[PPO] Network params: {sum(p.numel() for p in self.ac.parameters()):,}")

    # ── Policy ───────────────────────────────────────────────────────────────

    @torch.no_grad()
    def select_action(
        self, obs: np.ndarray, greedy: bool = False
    ) -> Tuple[int, float, float]:
        """
        Returns (action, log_prob, value) for training.
        During evaluation (greedy=True), selects argmax action.
        """
        t = torch.FloatTensor(obs).unsqueeze(0).to(self.device)
        logits, value = self.ac(t)
        if greedy:
            action = int(logits.argmax(dim=-1).item())
            return action, 0.0, float(value.item())
        dist     = Categorical(logits=logits)
        action   = dist.sample()
        log_prob = dist.log_prob(action)
        return int(action.item()), float(log_prob.item()), float(value.item())

    # ── PPO Update ───────────────────────────────────────────────────────────

    def update(self, last_value: float) -> Dict[str, float]:
        """
        Compute GAE → run K epochs of PPO-Clip updates → clear buffer.
        Returns mean losses for logging.
        """
        hp = self.hp
        self.buffer.compute_returns_and_advantages(
            last_value, hp["gamma"], hp["gae_lambda"]
        )

        epoch_pol_losses = []
        epoch_val_losses = []
        epoch_entropies  = []
        approx_kl        = 0.0

        for epoch in range(hp["n_epochs"]):
            for obs_b, act_b, old_lp_b, ret_b, adv_b, old_val_b in \
                    self.buffer.get_mini_batches(hp["mini_batch_size"], str(self.device)):

                # Advantage normalisation — crucial for gradient scale stability
                adv_b = (adv_b - adv_b.mean()) / (adv_b.std() + 1e-8)

                _, new_lp, entropy, new_val = self.ac.get_action_and_value(obs_b, act_b)

                # ── Policy loss (PPO-Clip) ────────────────────────────────────
                ratio    = torch.exp(new_lp - old_lp_b)
                clip_adv = torch.clamp(ratio, 1.0 - hp["clip_epsilon"],
                                               1.0 + hp["clip_epsilon"]) * adv_b
                pol_loss  = -torch.min(ratio * adv_b, clip_adv).mean()

                # ── Value loss (clipped) ──────────────────────────────────────
                val_pred_clipped = old_val_b + torch.clamp(
                    new_val - old_val_b, -hp["clip_epsilon"], hp["clip_epsilon"]
                )
                val_loss = 0.5 * torch.max(
                    (new_val - ret_b).pow(2),
                    (val_pred_clipped - ret_b).pow(2)
                ).mean()

                # ── Entropy bonus ─────────────────────────────────────────────
                entropy_loss = -entropy.mean()

                # ── Combined loss ─────────────────────────────────────────────
                loss = pol_loss + hp["vf_coef"] * val_loss + hp["ent_coef"] * entropy_loss

                self.optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(self.ac.parameters(), hp["max_grad_norm"])
                self.optimizer.step()

                epoch_pol_losses.append(float(pol_loss.item()))
                epoch_val_losses.append(float(val_loss.item()))
                epoch_entropies.append(float(entropy.mean().item()))

                # Approximate KL for early stopping
                with torch.no_grad():
                    approx_kl = float(((ratio - 1) - (new_lp - old_lp_b)).mean().item())

            # Early-stop: if KL divergence is too large, stop further epochs
            if abs(approx_kl) > hp["target_kl"]:
                break

        self.buffer.reset()
        return {
            "pol_loss": np.mean(epoch_pol_losses),
            "val_loss": np.mean(epoch_val_losses),
            "entropy":  np.mean(epoch_entropies),
            "kl":       approx_kl,
        }

    # ── Save / Load ──────────────────────────────────────────────────────────

    def save(self, path: str = "ppo_model.pt") -> None:
        torch.save(self.ac.state_dict(), path)
        print(f"[PPO] Saved → {path}")

    def load(self, path: str = "ppo_model.pt") -> None:
        self.ac.load_state_dict(torch.load(path, map_location=self.device))
        print(f"[PPO] Loaded ← {path}")


# ═══════════════════════════════════════════════════════════════════════════════
#  Training Loop
# ═══════════════════════════════════════════════════════════════════════════════

def train_ppo(env, hparams: Dict = HPARAMS, seed: int = 42) -> PPOAgent:
    """
    Train a PPO agent on HVACEnv.

    PPO is episode-aligned here: each episode = one rollout of 96 steps.
    After each episode the rollout buffer is used for K gradient epochs.
    """
    agent = PPOAgent(obs_dim=6, n_actions=4, hparams=hparams, seed=seed)
    n_ep  = hparams["n_episodes"]
    log_i = hparams["log_interval"]

    print(f"\n{'═'*60}")
    print(f"  PPO Training  ({n_ep} episodes)")
    print(f"  Rollout length  : {hparams['n_steps']} steps")
    print(f"  Update epochs   : {hparams['n_epochs']}")
    print(f"  Mini-batch size : {hparams['mini_batch_size']}")
    print(f"{'═'*60}")

    for ep in range(1, n_ep + 1):
        obs, _     = env.reset()
        ep_reward  = 0.0
        ep_energy  = 0.0
        ep_dev     = 0.0
        terminated = truncated = False
        last_value = 0.0

        while not (terminated or truncated):
            action, log_prob, value = agent.select_action(obs)
            next_obs, reward, terminated, truncated, info = env.step(action)
            done = terminated or truncated

            agent.buffer.push(obs, action, reward, value, log_prob, done)

            ep_reward += reward
            ep_energy += info["energy_kwh"]
            ep_dev    += info["comfort_deviation"]
            obs = next_obs

            if done:
                last_value = 0.0
            else:
                # Bootstrap value for incomplete episode (shouldn't happen here
                # since n_steps == episode_length, but defensive coding)
                _, _, last_value = agent.select_action(obs)

        # PPO update using the just-collected rollout
        metrics = agent.update(last_value)

        ep_steps = env.episode_length
        agent.ep_rewards.append(ep_reward)
        agent.ep_energies.append(ep_energy)
        agent.ep_deviations.append(ep_dev / ep_steps)
        agent.policy_losses.append(metrics["pol_loss"])
        agent.value_losses.append(metrics["val_loss"])
        agent.entropies.append(metrics["entropy"])

        if ep % log_i == 0:
            window = min(log_i, ep)
            r_avg  = np.mean(agent.ep_rewards[-window:])
            e_avg  = np.mean(agent.ep_energies[-window:])
            d_avg  = np.mean(agent.ep_deviations[-window:])
            h_avg  = np.mean(agent.entropies[-window:])
            print(
                f"  Ep {ep:>4}/{n_ep} | "
                f"R={r_avg:+.3f} | "
                f"E={e_avg:.2f}kWh | "
                f"ΔT={d_avg:.2f}°C | "
                f"H={h_avg:.3f} | "
                f"KL={metrics['kl']:.4f}"
            )

    print(f"\n[PPO] Training complete.")
    return agent


# ═══════════════════════════════════════════════════════════════════════════════
#  Quick test
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from hvac_env import HVACEnv

    env   = HVACEnv(episode_length=96)
    agent = train_ppo(env, seed=42)
    agent.save("ppo_model.pt")

    print("\n[PPO] Greedy evaluation (5 episodes):")
    for i in range(5):
        obs, _ = env.reset()
        tot_r  = 0.0
        done   = False
        while not done:
            a, _, _ = agent.select_action(obs, greedy=True)
            obs, r, term, trunc, _ = env.step(a)
            tot_r += r
            done = term or trunc
        print(f"  Eval ep {i+1}: total reward = {tot_r:.3f}")
