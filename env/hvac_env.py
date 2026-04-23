import numpy as np
import gymnasium as gym
from gymnasium import spaces
from typing import Optional, Tuple, Dict, Any

#  Environment
class HVACEnv(gym.Env):
    metadata = {"render_modes": ["human"]}
    # ── Physical constants ───────────────────────────────────────────────────
    TARGET_TEMP: float = 23.0          # °C  comfort set-point
    ALPHA:       float = 0.05          # heat transfer coefficient
    BETA:        float = 0.35          # cooling efficiency  (°C / kW · step)

    TEMP_MIN:    float = 15.0          # hard clamp lower bound  (°C)
    TEMP_MAX:    float = 45.0          # hard clamp upper bound  (°C)

    PRICE_MIN:   float = 0.05          # off-peak electricity price  ($/kWh)
    PRICE_MAX:   float = 0.30          # peak electricity price      ($/kWh)

    HVAC_POWER_LEVELS = np.array([0.0, 1.0, 2.0, 3.5], dtype=np.float32)
    # ── Comfort penalty weights ──────────────────────────────────────────────
    COMFORT_WEIGHT_OCCUPIED:   float = 1.5
    COMFORT_WEIGHT_UNOCCUPIED: float = 0.5
    
    def __init__(self,episode_length: int = 96,render_mode: Optional[str] = None,) -> None:
        super().__init__()

        self.episode_length = episode_length
        self.render_mode    = render_mode

        # Action space: 4 discrete cooling levels
        self.action_space = spaces.Discrete(4)

        # Observation space: 6 normalised floats ∈ [0, 1]
        self.observation_space = spaces.Box(
            low   = np.zeros(6, dtype=np.float32),
            high  = np.ones(6,  dtype=np.float32),
            dtype = np.float32,
        )

        # Internal simulation state (raw, un-normalised)
        self._indoor_temp:    float = self.TARGET_TEMP
        self._outdoor_temp:   float = 30.0
        self._occupancy:      float = 0.0
        self._time_of_day:    float = 0.0
        self._price:          float = self.PRICE_MIN
        self._prev_hvac_power: float = 0.0

        self._step: int = 0
        self._start_step: int = 0   # randomised on reset
    #  Gym API
    def reset(self,seed: Optional[int] = None,options: Optional[Dict] = None,) -> Tuple[np.ndarray, Dict]:
        super().reset(seed=seed)

        # Randomise start time (0–95 = any 15-min slot in the day)
        self._start_step = int(self.np_random.integers(0,96))
        self._step = 0

        abs_step = self._start_step
        # Initial indoor temperature: slightly above comfort set-point
        self._indoor_temp     = float(self.np_random.uniform(22.0, 28.0))
        self._outdoor_temp    = self._compute_outdoor_temp(abs_step)
        self._occupancy       = self._compute_occupancy(abs_step)
        self._time_of_day     = (abs_step * 0.25) % 24.0
        self._price           = self._compute_price(abs_step)
        self._prev_hvac_power = 0.0

        return self._get_obs(), {}
    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, Dict]:
        assert self.action_space.contains(action), \
            f"Invalid action {action}. Must be in {{0,1,2,3}}."

        hvac_power = float(self.HVAC_POWER_LEVELS[action])

        # ── Reward on current state ──────────────────────────────────────────
        reward = self._compute_reward(self._indoor_temp,hvac_power,self._price,self._occupancy,)
        # ── Advance simulation ───────────────────────────────────────────────
        self._step += 1
        abs_step = self._start_step + self._step

        self._indoor_temp     = self._compute_next_temp(self._indoor_temp,self._outdoor_temp,hvac_power)
        self._outdoor_temp    = self._compute_outdoor_temp(abs_step)
        self._occupancy       = self._compute_occupancy(abs_step)
        self._time_of_day     = (abs_step * 0.25) % 24.0
        self._price           = self._compute_price(abs_step)
        self._prev_hvac_power = hvac_power

        terminated = self._step >= self.episode_length
        truncated  = False

        info: Dict[str, Any] = {
            "indoor_temp":        self._indoor_temp,
            "outdoor_temp":       self._outdoor_temp,
            "occupancy":          self._occupancy,
            "time_of_day":        self._time_of_day,
            "electricity_price":  self._price,
            "hvac_power_kw":      hvac_power,
            "comfort_deviation":  abs(self._indoor_temp - self.TARGET_TEMP),
            "energy_kwh":         hvac_power * 0.25,   # kW × 0.25 h
        }

        if self.render_mode == "human":
            self.render()

        return self._get_obs(), reward, terminated, truncated, info

    def render(self) -> None:
        if self.render_mode != "human":
            return
        bar_len   = 20
        deviation = abs(self._indoor_temp - self.TARGET_TEMP)
        filled    = int(min(deviation / 5.0, 1.0) * bar_len)
        bar       = "█" * filled + "░" * (bar_len - filled)
        print(
            f"[Step {self._step:03d}/{self.episode_length}] "
            f"T_in={self._indoor_temp:5.1f}°C  "
            f"T_out={self._outdoor_temp:5.1f}°C  "
            f"Occ={int(self._occupancy)}  "
            f"Hour={self._time_of_day:4.1f}h  "
            f"Price=${self._price:.3f}  "
            f"Power={self._prev_hvac_power:.1f}kW  "
            f"Δ=[{bar}] {deviation:.2f}°C"
        )

    def close(self) -> None:
        pass

    #  MDP Components

    # ── Observation ──
    def _get_obs(self) -> np.ndarray:
        """Return normalised observation vector."""
        return np.array([
            self._norm_temp(self._indoor_temp),
            self._norm_temp(self._outdoor_temp),
            self._occupancy,                                     # {0, 1}
            self._time_of_day / 24.0,                            # [0, 1)
            self._norm_price(self._price),
            self._prev_hvac_power / self.HVAC_POWER_LEVELS[-1],  # [0, 1]
        ], dtype=np.float32)
    
    # ── Reward (Eq. 1) ───
    def _compute_reward(self,indoor_temp:float,hvac_power:float,price:float,occupancy:float,) -> float:
        
        # Energy cost: normalised by worst-case (max price × max power)
        energy_cost = (price * hvac_power) / \
                      (self.PRICE_MAX * self.HVAC_POWER_LEVELS[-1])   # ∈ [0,1]

        # Comfort penalty: deviation from target, scaled to ~[0,1] for 10°C swing
        w = (self.COMFORT_WEIGHT_OCCUPIED
             if occupancy == 1.0
             else self.COMFORT_WEIGHT_UNOCCUPIED)
        comfort_penalty = w * abs(indoor_temp - self.TARGET_TEMP) / 10.0

        return float(-(energy_cost + comfort_penalty))

    # ── Temperature dynamics (Eq. 2) ─────────────────────────────────────────

    def _compute_next_temp(self,indoor_temp:  float,outdoor_temp: float,hvac_power:   float,) -> float:
        delta = (
            self.ALPHA * (outdoor_temp - indoor_temp)
            - self.BETA  * hvac_power
        )
        return float(np.clip(indoor_temp + delta, self.TEMP_MIN, self.TEMP_MAX))

    # ── Environmental drivers ─────────────────────────────────────────────────

    @staticmethod
    def _compute_outdoor_temp(abs_step: int) -> float:
        hour = (abs_step * 0.25) % 24.0
        return float(28.0 + 7.0 * np.sin(np.pi * (hour - 6.0) / 12.0))

    @staticmethod
    def _compute_occupancy(abs_step: int) -> float:
        hour = (abs_step * 0.25) % 24.0
        return 1.0 if 8.0 <= hour < 18.0 else 0.0

    @staticmethod
    def _compute_price(abs_step: int) -> float:
        hour = (abs_step * 0.25) % 24.0
        if 9.0 <= hour < 21.0:
            return float(0.15 + 0.10 * np.sin(np.pi * (hour - 9.0) / 12.0))
        return 0.08

    # ── Normalisation helpers ─────────────────────────────────────────────────
    def _norm_temp(self, t: float) -> float:
        return (t - self.TEMP_MIN) / (self.TEMP_MAX - self.TEMP_MIN)
    def _norm_price(self, p: float) -> float:
        return (p - self.PRICE_MIN) / (self.PRICE_MAX - self.PRICE_MIN)

#  Sanity-check (run directly: python hvac_env.py)
if __name__ == "__main__":
    print("  HVACEnv — Sanity Check (random policy, 1 episode)")

    env = HVACEnv(episode_length=96, render_mode="human")
    obs, info = env.reset(seed=42)

    total_reward  = 0.0
    total_energy  = 0.0
    deviations    = []

    terminated = truncated = False
    while not (terminated or truncated):
        action = env.action_space.sample()
        obs, reward, terminated, truncated, info = env.step(action)
        total_reward += reward
        total_energy += info["energy_kwh"]
        deviations.append(info["comfort_deviation"])

    print("\n" + "─" * 70)
    print(f"  Episode Summary (random policy)")
    print(f"  Total reward        : {total_reward:.3f}")
    print(f"  Total energy (kWh)  : {total_energy:.3f}")
    print(f"  Avg comfort dev (°C): {np.mean(deviations):.3f}")
    print(f"  Max comfort dev (°C): {np.max(deviations):.3f}")
    print(f"  Obs space           : {env.observation_space}")
    print(f"  Action space        : {env.action_space}")
    env.close()
