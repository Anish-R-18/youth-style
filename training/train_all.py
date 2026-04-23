"""
train_all.py
============
Unified entry point — trains all three agents sequentially and
saves their results for comparison in the next phase (evaluation).

Usage
─────
  python train_all.py                  # train all three
  python train_all.py --agent qlearning
  python train_all.py --agent dqn
  python train_all.py --agent ppo
  python train_all.py --agent dqn --episodes 2000

Outputs (saved to ./checkpoints/)
──────────────────────────────────
  qlearning_table.pkl
  dqn_model.pt
  ppo_model.pt
  training_curves.npz   ← reward / energy / deviation arrays per agent
"""

import argparse
import numpy as np
from pathlib import Path

from env.hvac_env       import HVACEnv
from agents.q_learning import train_qlearning, HPARAMS as QL_HP
from agents.dqn_agent       import train_dqn,       HPARAMS as DQN_HP
from agents.ppo_agent       import train_ppo,        HPARAMS as PPO_HP

CKPT_DIR = Path("checkpoints")
CKPT_DIR.mkdir(exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def make_env(seed: int = 0) -> HVACEnv:
    """Return a fresh HVACEnv instance."""
    return HVACEnv(episode_length=96)


def print_summary(name: str, rewards, energies, deviations, n: int = 100) -> None:
    """Print final-N-episode statistics for one agent."""
    r = np.mean(rewards[-n:])
    e = np.mean(energies[-n:])
    d = np.mean(deviations[-n:])
    print(f"\n  {'─'*50}")
    print(f"  {name} — last {n} episode average")
    print(f"    Reward          : {r:+.4f}")
    print(f"    Energy (kWh)    : {e:.4f}")
    print(f"    Comfort dev (°C): {d:.4f}")
    print(f"  {'─'*50}")


# ═══════════════════════════════════════════════════════════════════════════════
#  Train each agent
# ═══════════════════════════════════════════════════════════════════════════════

def run_qlearning(episodes: int, seed: int) -> dict:
    hp = {**QL_HP, "n_episodes": episodes}
    env = make_env(seed)
    agent = train_qlearning(env, hparams=hp, seed=seed)
    agent.save(str(CKPT_DIR / "qlearning_table.pkl"))
    print_summary("Q-Learning", agent.ep_rewards, agent.ep_energies, agent.ep_deviations)
    return {
        "rewards":    np.array(agent.ep_rewards),
        "energies":   np.array(agent.ep_energies),
        "deviations": np.array(agent.ep_deviations),
    }


def run_dqn(episodes: int, seed: int) -> dict:
    hp = {**DQN_HP, "n_episodes": episodes}
    env = make_env(seed)
    agent = train_dqn(env, hparams=hp, seed=seed)
    agent.save(str(CKPT_DIR / "dqn_model.pt"))
    print_summary("DQN", agent.ep_rewards, agent.ep_energies, agent.ep_deviations)
    return {
        "rewards":    np.array(agent.ep_rewards),
        "energies":   np.array(agent.ep_energies),
        "deviations": np.array(agent.ep_deviations),
    }


def run_ppo(episodes: int, seed: int) -> dict:
    hp = {**PPO_HP, "n_episodes": episodes}
    env = make_env(seed)
    agent = train_ppo(env, hparams=hp, seed=seed)
    agent.save(str(CKPT_DIR / "ppo_model.pt"))
    print_summary("PPO", agent.ep_rewards, agent.ep_energies, agent.ep_deviations)
    return {
        "rewards":    np.array(agent.ep_rewards),
        "energies":   np.array(agent.ep_energies),
        "deviations": np.array(agent.ep_deviations),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  Entry point
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="HVAC RL Training Runner")
    parser.add_argument("--agent",    type=str, default="all",
                        choices=["all", "qlearning", "dqn", "ppo"])
    parser.add_argument("--episodes", type=int, default=None,
                        help="Override n_episodes for the selected agent")
    parser.add_argument("--seed",     type=int, default=42)
    args = parser.parse_args()

    curves = {}

    if args.agent in ("all", "qlearning"):
        ep = args.episodes or QL_HP["n_episodes"]
        curves["qlearning"] = run_qlearning(ep, args.seed)

    if args.agent in ("all", "dqn"):
        ep = args.episodes or DQN_HP["n_episodes"]
        curves["dqn"] = run_dqn(ep, args.seed)

    if args.agent in ("all", "ppo"):
        ep = args.episodes or PPO_HP["n_episodes"]
        curves["ppo"] = run_ppo(ep, args.seed)

    # Save training curves for evaluation phase
    save_path = CKPT_DIR / "training_curves.npz"
    flat = {}
    for agent_name, data in curves.items():
        for metric, arr in data.items():
            flat[f"{agent_name}_{metric}"] = arr
    np.savez(str(save_path), **flat)
    print(f"\n[Runner] Training curves saved → {save_path}")
    print("[Runner] All done. Ready for evaluation phase.\n")


if __name__ == "__main__":
    main()
