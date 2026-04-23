"""
evaluate.py
===========
Rule-Based Baseline + Evaluation Engine + Metrics + Plots + Comparison Table

Run after training:
    python evaluate.py

Outputs (saved to ./results/)
──────────────────────────────
  baseline_results.npz
  eval_results.npz
  plots/reward_curves.png
  plots/energy_comparison.png
  plots/comfort_deviation.png
  plots/action_distribution.png
  plots/indoor_temp_trace.png
  plots/summary_radar.png
  comparison_table.txt
"""

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.gridspec import GridSpec
from pathlib import Path
import pickle, sys, textwrap
sys.path.insert(0, ".")

from env.hvac_env import HVACEnv

# ── Paths ────────────────────────────────────────────────────────────────────
CKPT_DIR    = Path("checkpoints")
RESULTS_DIR = Path("results")
PLOT_DIR    = RESULTS_DIR / "plots"
RESULTS_DIR.mkdir(exist_ok=True)
PLOT_DIR.mkdir(exist_ok=True)

# ── Plot style ───────────────────────────────────────────────────────────────
COLORS = {
    "baseline":  "#e74c3c",
    "qlearning": "#f39c12",
    "dqn":       "#2980b9",
    "ppo":       "#27ae60",
}
LABELS = {
    "baseline":  "Rule-Based",
    "qlearning": "Q-Learning",
    "dqn":       "DQN",
    "ppo":       "PPO",
}

plt.rcParams.update({
    "figure.dpi":        150,
    "font.family":       "DejaVu Sans",
    "axes.spines.top":   False,
    "axes.spines.right": False,
    "axes.grid":         True,
    "grid.alpha":        0.3,
    "axes.titlesize":    11,
    "axes.labelsize":    10,
    "legend.fontsize":   9,
})

N_EVAL_EPISODES = 50   # episodes per agent for evaluation
SMOOTH_WINDOW   = 50   # rolling-average window for training curves


# ═══════════════════════════════════════════════════════════════════════════════
#  1 · Rule-Based Baseline
# ═══════════════════════════════════════════════════════════════════════════════

class RuleBasedController:
    """
    Thermostat baseline from the report (Section IV):
      T > 24 °C  → High Cooling  (action 3)
      T < 22 °C  → HVAC Off      (action 0)
      otherwise  → Low Cooling   (action 1)

    Extended: during unoccupied hours we relax the dead-band to [20, 27 °C]
    to save energy — consistent with real thermostat "setback" mode.
    """

    def select_action(self, obs: np.ndarray, raw_info: dict) -> int:
        t   = raw_info["indoor_temp"]
        occ = raw_info["occupancy"]

        if occ == 1.0:                 # occupied: tight band
            if t > 24.0:   return 3   # high cooling
            elif t < 22.0: return 0   # off
            else:          return 1   # low cooling
        else:                          # unoccupied: relaxed setback band
            if t > 27.0:   return 2   # medium cooling
            elif t < 20.0: return 0   # off
            else:          return 0   # off (save energy)


# ═══════════════════════════════════════════════════════════════════════════════
#  2 · Evaluation Engine
# ═══════════════════════════════════════════════════════════════════════════════

def _run_one_episode(env, policy_fn, seed=None):
    """
    Roll out one episode and return per-step arrays.
    policy_fn(obs, info) -> action
    info here is the PREVIOUS step's info dict (current state before step).
    """
    obs, _ = env.reset(seed=seed)

    # We need raw state for the rule-based controller.
    # Reconstruct a synthetic info from the first obs.
    synthetic_info = {
        "indoor_temp":  obs[0] * 30.0 + 15.0,
        "occupancy":    obs[2],
    }

    rewards, energies, deviations, actions, indoor_temps = [], [], [], [], []

    done = False
    while not done:
        action              = policy_fn(obs, synthetic_info)
        obs, r, term, trunc, info = env.step(action)
        done = term or trunc

        rewards.append(r)
        energies.append(info["energy_kwh"])
        deviations.append(info["comfort_deviation"])
        actions.append(action)
        indoor_temps.append(info["indoor_temp"])

        synthetic_info = info   # pass real info forward for next step

    return (
        np.array(rewards,      dtype=np.float32),
        np.array(energies,     dtype=np.float32),
        np.array(deviations,   dtype=np.float32),
        np.array(actions,      dtype=np.int32),
        np.array(indoor_temps, dtype=np.float32),
    )


def evaluate_agent(env, policy_fn, n_episodes=N_EVAL_EPISODES, base_seed=1000):
    """
    Run n_episodes deterministic evaluation episodes and collect metrics.
    """
    all_rewards   = []
    all_energies  = []
    all_devs      = []
    all_actions   = []
    all_temps     = []

    for i in range(n_episodes):
        r, e, d, a, t = _run_one_episode(env, policy_fn, seed=base_seed + i)
        all_rewards.append(r.sum())
        all_energies.append(e.sum())
        all_devs.append(d.mean())
        all_actions.append(a)
        all_temps.append(t)

    return {
        "ep_rewards":    np.array(all_rewards),
        "ep_energies":   np.array(all_energies),
        "ep_deviations": np.array(all_devs),
        "action_counts": np.bincount(np.concatenate(all_actions), minlength=4),
        "temp_trace":    np.array(all_temps),   # shape (n_ep, 96)
    }


def compute_metrics(results: dict) -> dict:
    """
    Derive summary statistics from evaluation results.

    Metrics (aligned with report Section VII):
      mean_reward        : average total episode reward
      mean_energy_kwh    : average total energy per episode
      mean_comfort_dev   : average per-step |T_in - 23| (°C)
      pct_in_band        : % of steps where T_in ∈ [22, 24] °C
      action_entropy     : Shannon entropy of action distribution
    """
    r    = results["ep_rewards"]
    e    = results["ep_energies"]
    d    = results["ep_deviations"]
    t    = results["temp_trace"]         # (n_ep, 96)
    ac   = results["action_counts"].astype(np.float64)

    in_band = np.mean((t >= 22.0) & (t <= 24.0)) * 100.0

    ac_prob  = ac / ac.sum()
    entropy  = float(-np.sum(ac_prob * np.log(ac_prob + 1e-9)))

    return {
        "mean_reward":     float(r.mean()),
        "std_reward":      float(r.std()),
        "mean_energy_kwh": float(e.mean()),
        "std_energy_kwh":  float(e.std()),
        "mean_comfort_dev": float(d.mean()),
        "std_comfort_dev": float(d.std()),
        "pct_in_band":     float(in_band),
        "action_entropy":  float(entropy),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  3 · Load Trained Agents
# ═══════════════════════════════════════════════════════════════════════════════

def load_agents():
    """
    Load checkpoints and return (name → policy_fn) dict.
    Gracefully skips missing checkpoints with a warning.
    """
    agents = {}

    # ── Rule-Based ────────────────────────────────────────────────────────────
    rb = RuleBasedController()
    agents["baseline"] = lambda obs, info: rb.select_action(obs, info)

    # ── Q-Learning ────────────────────────────────────────────────────────────
    ql_path = CKPT_DIR / "qlearning_table.pkl"
    if ql_path.exists():
        from agents.q_learning import QLearningAgent
        ql = QLearningAgent()
        ql.load(str(ql_path))
        agents["qlearning"] = lambda obs, info, _a=ql: _a.select_action(obs, greedy=True)
    else:
        print(f"  [warn] Q-Learning checkpoint not found: {ql_path}")

    # ── DQN ───────────────────────────────────────────────────────────────────
    dqn_path = CKPT_DIR / "dqn_model.pt"
    if dqn_path.exists():
        from agents.dqn_agent import DQNAgent
        dqn = DQNAgent()
        dqn.load(str(dqn_path))
        agents["dqn"] = lambda obs, info, _a=dqn: _a.select_action(obs, greedy=True)
    else:
        print(f"  [warn] DQN checkpoint not found: {dqn_path}")

    # ── PPO ───────────────────────────────────────────────────────────────────
    ppo_path = CKPT_DIR / "ppo_model.pt"
    if ppo_path.exists():
        from agents.ppo_agent import PPOAgent
        ppo = PPOAgent()
        ppo.load(str(ppo_path))
        agents["ppo"] = lambda obs, info, _a=ppo: _a.select_action(obs, greedy=True)[0]
    else:
        print(f"  [warn] PPO checkpoint not found: {ppo_path}")

    return agents


# ═══════════════════════════════════════════════════════════════════════════════
#  4 · Plotting
# ═══════════════════════════════════════════════════════════════════════════════

def _smooth(arr, w):
    if len(arr) < w:
        return arr
    kernel = np.ones(w) / w
    return np.convolve(arr, kernel, mode="valid")


# ── 4a. Training curves ───────────────────────────────────────────────────────

def plot_training_curves(curves_path: Path):
    """
    Reward and comfort deviation training curves for Q-Learning, DQN, PPO.
    """
    if not curves_path.exists():
        print(f"  [skip] training_curves.npz not found — skipping training curve plot")
        return

    data = np.load(curves_path)
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.5))
    fig.suptitle("Training Curves", fontsize=13, fontweight="bold", y=1.01)

    for name in ["qlearning", "dqn", "ppo"]:
        rk = f"{name}_rewards"
        dk = f"{name}_deviations"
        if rk not in data:
            continue
        c  = COLORS[name]
        lb = LABELS[name]
        r  = _smooth(data[rk], SMOOTH_WINDOW)
        d  = _smooth(data[dk], SMOOTH_WINDOW) if dk in data else None
        x  = np.arange(len(r))
        axes[0].plot(x, r, color=c, label=lb, linewidth=1.4)
        if d is not None:
            axes[1].plot(x, d, color=c, label=lb, linewidth=1.4)

    axes[0].set_title("Episode Reward (smoothed)")
    axes[0].set_xlabel("Episode")
    axes[0].set_ylabel("Total Reward")
    axes[0].legend()

    axes[1].set_title("Avg Comfort Deviation °C (smoothed)")
    axes[1].set_xlabel("Episode")
    axes[1].set_ylabel("|T_in − 23| °C")
    axes[1].legend()

    fig.tight_layout()
    out = PLOT_DIR / "reward_curves.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


# ── 4b. Evaluation bar charts ─────────────────────────────────────────────────

def plot_energy_comparison(all_metrics: dict):
    agents = list(all_metrics.keys())
    means  = [all_metrics[a]["mean_energy_kwh"] for a in agents]
    stds   = [all_metrics[a]["std_energy_kwh"]  for a in agents]
    colors = [COLORS[a] for a in agents]
    labels = [LABELS[a] for a in agents]

    fig, ax = plt.subplots(figsize=(7, 4.5))
    bars = ax.bar(labels, means, color=colors, edgecolor="white",
                  linewidth=0.8, width=0.55, yerr=stds,
                  capsize=5, error_kw={"linewidth": 1.2, "ecolor": "#555"})

    for bar, mean in zip(bars, means):
        ax.text(bar.get_x() + bar.get_width() / 2,
                mean + max(stds) * 0.15,
                f"{mean:.2f}", ha="center", va="bottom", fontsize=9, fontweight="bold")

    ax.set_title("Energy Consumption per Episode", fontweight="bold")
    ax.set_ylabel("Total Energy (kWh)")
    ax.set_ylim(0, max(means) * 1.35)
    ax.axhline(means[0], color=COLORS["baseline"], linestyle="--",
               linewidth=1.0, alpha=0.5, label="Baseline level")
    ax.legend(fontsize=8)
    fig.tight_layout()
    out = PLOT_DIR / "energy_comparison.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


def plot_comfort_deviation(all_metrics: dict):
    agents = list(all_metrics.keys())
    means  = [all_metrics[a]["mean_comfort_dev"] for a in agents]
    stds   = [all_metrics[a]["std_comfort_dev"]  for a in agents]
    bands  = [all_metrics[a]["pct_in_band"]      for a in agents]
    colors = [COLORS[a] for a in agents]
    labels = [LABELS[a] for a in agents]

    fig, axes = plt.subplots(1, 2, figsize=(13, 4.5))

    # Left: mean deviation
    bars = axes[0].bar(labels, means, color=colors, edgecolor="white",
                       linewidth=0.8, width=0.55, yerr=stds,
                       capsize=5, error_kw={"linewidth": 1.2, "ecolor": "#555"})
    for bar, m in zip(bars, means):
        axes[0].text(bar.get_x() + bar.get_width() / 2,
                     m + max(stds) * 0.1,
                     f"{m:.2f}°C", ha="center", va="bottom", fontsize=9, fontweight="bold")
    axes[0].set_title("Mean Comfort Deviation", fontweight="bold")
    axes[0].set_ylabel("|T_in − 23| °C")
    axes[0].set_ylim(0, max(means) * 1.4)

    # Right: % time in comfort band
    bars2 = axes[1].bar(labels, bands, color=colors, edgecolor="white",
                        linewidth=0.8, width=0.55)
    for bar, b in zip(bars2, bands):
        axes[1].text(bar.get_x() + bar.get_width() / 2,
                     b + 1.5, f"{b:.1f}%",
                     ha="center", va="bottom", fontsize=9, fontweight="bold")
    axes[1].set_title("% Steps in Comfort Band [22–24 °C]", fontweight="bold")
    axes[1].set_ylabel("% Steps")
    axes[1].set_ylim(0, 115)
    axes[1].axhline(100, color="#888", linestyle=":", linewidth=1.0)

    fig.tight_layout()
    out = PLOT_DIR / "comfort_deviation.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


def plot_action_distribution(all_results: dict):
    action_labels = ["Off", "Low", "Medium", "High"]
    n_agents = len(all_results)
    x = np.arange(4)
    width = 0.8 / n_agents

    fig, ax = plt.subplots(figsize=(9, 4.5))
    for i, (name, res) in enumerate(all_results.items()):
        counts = res["action_counts"].astype(np.float64)
        pct    = counts / counts.sum() * 100
        offset = (i - n_agents / 2 + 0.5) * width
        bars   = ax.bar(x + offset, pct, width=width * 0.9,
                        color=COLORS[name], label=LABELS[name],
                        edgecolor="white", linewidth=0.6)

    ax.set_xticks(x)
    ax.set_xticklabels(action_labels)
    ax.set_title("Action Distribution Across All Evaluation Episodes", fontweight="bold")
    ax.set_ylabel("Usage (%)")
    ax.legend()
    ax.set_ylim(0, 80)
    fig.tight_layout()
    out = PLOT_DIR / "action_distribution.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


def plot_temp_trace(all_results: dict):
    """
    Plot mean indoor temperature profile over a 24-hour day (averaged over all eval episodes).
    Also shade the comfort band [22, 24] °C.
    """
    fig, ax = plt.subplots(figsize=(11, 4.5))
    hours = np.linspace(0, 24, 96)

    ax.axhspan(22, 24, color="#27ae60", alpha=0.07, label="Comfort band [22–24 °C]")
    ax.axhline(23, color="#27ae60", linestyle=":", linewidth=1.0, alpha=0.5)

    for name, res in all_results.items():
        traces = res["temp_trace"]   # (n_ep, 96)
        mean   = traces.mean(axis=0)
        std    = traces.std(axis=0)
        ax.plot(hours, mean, color=COLORS[name], label=LABELS[name], linewidth=1.6)
        ax.fill_between(hours, mean - std, mean + std,
                        color=COLORS[name], alpha=0.10)

    # Annotate occupancy period
    ax.axvspan(8, 18, color="#f39c12", alpha=0.07)
    ax.text(13, ax.get_ylim()[1] if ax.get_ylim()[1] > 26 else 26.5,
            "Occupied", ha="center", fontsize=8, color="#b7770d")

    ax.set_title("Mean Indoor Temperature Profile (24 h)", fontweight="bold")
    ax.set_xlabel("Hour of Day")
    ax.set_ylabel("Indoor Temperature (°C)")
    ax.set_xlim(0, 24)
    ax.set_xticks(range(0, 25, 2))
    ax.legend(loc="upper left")
    fig.tight_layout()
    out = PLOT_DIR / "indoor_temp_trace.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


def plot_radar(all_metrics: dict):
    """
    Radar / spider chart comparing 5 normalised metrics across all agents.
    All axes are oriented so that "further from centre = better".
    """
    metric_keys = [
        "mean_reward",
        "mean_energy_kwh",
        "mean_comfort_dev",
        "pct_in_band",
        "action_entropy",
    ]
    metric_display = [
        "Reward ↑",
        "Energy ↓",
        "Comfort Dev ↓",
        "In-Band % ↑",
        "Act Diversity ↑",
    ]

    # Collect raw values
    raw = {k: np.array([all_metrics[a][k] for a in all_metrics]) for k in metric_keys}

    # Normalise to [0, 1]; for "lower is better" metrics, flip after normalising
    def norm(arr, flip=False):
        lo, hi = arr.min(), arr.max()
        if hi == lo:
            return np.ones_like(arr) * 0.5
        n = (arr - lo) / (hi - lo)
        return 1.0 - n if flip else n

    normed = {
        "mean_reward":      norm(raw["mean_reward"],      flip=False),
        "mean_energy_kwh":  norm(raw["mean_energy_kwh"],  flip=True),   # lower better
        "mean_comfort_dev": norm(raw["mean_comfort_dev"],  flip=True),  # lower better
        "pct_in_band":      norm(raw["pct_in_band"],      flip=False),
        "action_entropy":   norm(raw["action_entropy"],   flip=False),
    }

    N   = len(metric_keys)
    angles = np.linspace(0, 2 * np.pi, N, endpoint=False).tolist()
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(6.5, 6.5),
                           subplot_kw={"projection": "polar"})
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_thetagrids(np.degrees(angles[:-1]), metric_display, fontsize=9)
    ax.set_ylim(0, 1.15)
    ax.set_yticks([0.25, 0.5, 0.75, 1.0])
    ax.set_yticklabels(["0.25", "0.5", "0.75", "1.0"], fontsize=7)

    for i, (name, metrics) in enumerate(all_metrics.items()):
        vals = [normed[k][i] for k in metric_keys]
        vals += vals[:1]
        ax.plot(angles, vals, color=COLORS[name], linewidth=2,
                label=LABELS[name])
        ax.fill(angles, vals, color=COLORS[name], alpha=0.10)

    ax.set_title("Agent Comparison (Normalised Metrics)",
                 fontweight="bold", pad=18)
    ax.legend(loc="upper right", bbox_to_anchor=(1.35, 1.15))
    fig.tight_layout()
    out = PLOT_DIR / "summary_radar.png"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved: {out}")


# ═══════════════════════════════════════════════════════════════════════════════
#  5 · Comparison Table
# ═══════════════════════════════════════════════════════════════════════════════

def print_and_save_comparison_table(all_metrics: dict):
    col_w   = 16
    agents  = list(all_metrics.keys())
    headers = ["Metric"] + [LABELS[a] for a in agents]

    rows = [
        ("Mean Reward",       "mean_reward",      "{:+.4f}"),
        ("Std Reward",        "std_reward",        "{:.4f}"),
        ("Mean Energy (kWh)", "mean_energy_kwh",  "{:.4f}"),
        ("Std Energy (kWh)",  "std_energy_kwh",   "{:.4f}"),
        ("Mean Comfort Dev",  "mean_comfort_dev", "{:.4f}"),
        ("Std Comfort Dev",   "std_comfort_dev",  "{:.4f}"),
        ("% In-Band [22-24]", "pct_in_band",      "{:.2f}%"),
        ("Action Entropy",    "action_entropy",   "{:.4f}"),
    ]

    def fmt_row(cells):
        return "│ " + " │ ".join(c.ljust(col_w) for c in cells) + " │"

    sep   = "├─" + "─┼─".join(["─" * col_w] * len(headers)) + "─┤"
    top   = "┌─" + "─┬─".join(["─" * col_w] * len(headers)) + "─┐"
    bot   = "└─" + "─┴─".join(["─" * col_w] * len(headers)) + "─┘"
    lines = [top, fmt_row(headers), sep]

    for display, key, fmt in rows:
        vals = [display]
        best_idx = None
        raw_vals = [all_metrics[a][key] for a in agents]
        # Highlight best: higher = better for reward, pct_in_band, entropy;
        # lower = better for energy, comfort_dev
        if key in ("mean_energy_kwh", "mean_comfort_dev",
                   "std_energy_kwh",   "std_comfort_dev"):
            best_idx = int(np.argmin(raw_vals))
        else:
            best_idx = int(np.argmax(raw_vals))

        for i, (a, v) in enumerate(zip(agents, raw_vals)):
            cell = fmt.format(v)
            if i == best_idx:
                cell = "★ " + cell
            vals.append(cell)
        lines.append(fmt_row(vals))

    lines.append(bot)
    lines.append("")
    lines.append("  ★ = best value in row")

    table_str = "\n".join(lines)
    print("\n" + "═" * 70)
    print("  EVALUATION RESULTS  (50 episodes, greedy policy)")
    print("═" * 70)
    print(table_str)

    # Narrative improvement summary vs baseline
    if "baseline" in all_metrics:
        b = all_metrics["baseline"]
        print("\n  Improvement over Rule-Based Baseline:")
        for name in agents:
            if name == "baseline":
                continue
            m = all_metrics[name]
            e_imp = (b["mean_energy_kwh"] - m["mean_energy_kwh"]) / b["mean_energy_kwh"] * 100
            d_imp = (b["mean_comfort_dev"] - m["mean_comfort_dev"]) / b["mean_comfort_dev"] * 100
            r_imp = (m["mean_reward"] - b["mean_reward"]) / abs(b["mean_reward"]) * 100
            print(f"    {LABELS[name]:<12}: "
                  f"Energy {e_imp:+.1f}% | "
                  f"Comfort Dev {d_imp:+.1f}% | "
                  f"Reward {r_imp:+.1f}%")

    out = RESULTS_DIR / "comparison_table.txt"
    with open(out, "w",encoding="utf-8") as f:
        f.write("EVALUATION RESULTS  (50 episodes, greedy policy)\n")
        f.write("=" * 70 + "\n")
        f.write(table_str + "\n")
    print(f"\n  Table saved → {out}")


# ═══════════════════════════════════════════════════════════════════════════════
#  6 · Main
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 70)
    print("  HVAC RL — Evaluation & Comparison")
    print("=" * 70)

    env = HVACEnv(episode_length=96)

    # ── Load agents ───────────────────────────────────────────────────────────
    print("\n[1] Loading agents...")
    agents = load_agents()
    print(f"    Loaded: {list(agents.keys())}")

    # ── Evaluate each agent ───────────────────────────────────────────────────
    print(f"\n[2] Evaluating ({N_EVAL_EPISODES} episodes each)...")
    all_results = {}
    all_metrics = {}

    for name, policy_fn in agents.items():
        print(f"    → {LABELS[name]} ...", end=" ", flush=True)
        res = evaluate_agent(env, policy_fn, n_episodes=N_EVAL_EPISODES)
        met = compute_metrics(res)
        all_results[name] = res
        all_metrics[name] = met
        print(f"R={met['mean_reward']:+.3f} | E={met['mean_energy_kwh']:.3f}kWh "
              f"| ΔT={met['mean_comfort_dev']:.3f}°C")

    np.savez(str(RESULTS_DIR / "eval_results.npz"),
             **{f"{n}_{k}": v for n, r in all_results.items()
                for k, v in r.items() if isinstance(v, np.ndarray)})

    # ── Plots ─────────────────────────────────────────────────────────────────
    print(f"\n[3] Generating plots → {PLOT_DIR}/")

    plot_training_curves(CKPT_DIR / "training_curves.npz")
    plot_energy_comparison(all_metrics)
    plot_comfort_deviation(all_metrics)
    plot_action_distribution(all_results)
    plot_temp_trace(all_results)
    plot_radar(all_metrics)

    # ── Comparison table ──────────────────────────────────────────────────────
    print("\n[4] Comparison Table")
    print_and_save_comparison_table(all_metrics)

    print("\n[Done] All outputs saved to ./results/")


if __name__ == "__main__":
    main()
