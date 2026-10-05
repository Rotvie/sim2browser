"""Gymnasium reach environment. Everything parity-critical comes from shared/parity.json and
mirrors web/src exactly:

- action application: web/src/sim/arm.ts applyDelta(action · deltaScale, deltaScale), with the
  action expanded to all joints (zero for joints outside parity.json `action.joints`)
- observation: web/src/sim/observation.ts buildObs (field order from parity.json)
- target clamping and front workspace: web/src/sim/target.ts clampTarget / web/src/sim/eval.ts
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import gymnasium as gym
import mujoco
import numpy as np

from .config import REWARD, SAMPLING, RewardWeights, Sampling
from .spec import SHARED, load_parity, sha256_model


def apply_action(ctrl: np.ndarray, action: np.ndarray, delta_scale: float, lim: np.ndarray):
    """ctrl = clip(ctrl + clip(a · deltaScale, ±deltaScale), low, high)."""
    step = np.clip(np.asarray(action, dtype=np.float64) * delta_scale, -delta_scale, delta_scale)
    return np.clip(ctrl + step, lim[:, 0], lim[:, 1])


def build_obs(
    parity: dict[str, Any],
    q: np.ndarray,
    qd: np.ndarray,
    target: np.ndarray,
    tip: np.ndarray,
    prev_action: np.ndarray,
) -> np.ndarray:
    """Observation in exactly the parity.json field order."""
    values = {
        "q": q,
        "qd": qd,
        "target": target,
        "tipToTarget": np.asarray(target) - np.asarray(tip),
        "prevAction": prev_action,
    }
    parts = []
    for f in parity["observation"]["fields"]:
        v = np.asarray(values[f["name"]], dtype=np.float64)
        assert v.shape == (f["size"],), (f["name"], v.shape)
        parts.append(v)
    return np.concatenate(parts)


def clamp_target(p: np.ndarray, reach: dict[str, Any]) -> np.ndarray:
    """Same clamps as web/src/sim/target.ts clampTarget."""
    out = np.array([p[0], p[1], max(reach["minZ"], p[2])], dtype=np.float64)
    bx, by = reach["baseAxisXY"]
    dx, dy = out[0] - bx, out[1] - by
    r = float(np.hypot(dx, dy))
    rad = reach["baseExclusionRadius"]
    if r < rad:
        ux, uy = (dx / r, dy / r) if r > 1e-9 else (0.0, -1.0)
        out[0], out[1] = bx + ux * rad, by + uy * rad
    return out


class ReachEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        reward: RewardWeights = REWARD,
        sampling: Sampling = SAMPLING,
        **overrides: float,
    ) -> None:
        self.parity = load_parity()
        p = self.parity
        if mujoco.__version__ != p["mujocoVersion"]:
            raise RuntimeError(f"mujoco {mujoco.__version__} != parity.json {p['mujocoVersion']}")
        if sha256_model(p["model"]["files"]) != p["model"]["sha256"]:
            raise RuntimeError("robot model files do not match parity.json")
        self.model = mujoco.MjModel.from_xml_path(str(SHARED / p["model"]["path"]))
        self.data = mujoco.MjData(self.model)
        self.scratch = mujoco.MjData(self.model)
        if self.model.opt.timestep != p["timestep"]:
            raise RuntimeError("model timestep does not match parity.json")
        self.reward_w = replace(
            reward, **{k: v for k, v in overrides.items() if hasattr(reward, k)}
        )
        self.sampling = sampling
        # Smoothness penalties scale (0..1); ramped up during training (train.py curriculum).
        self.penalty_scale = 1.0

        self.n = len(p["joints"])
        # Indices (in `joints` order) of the joints the policy observes and commands.
        self.act = np.array([p["joints"].index(j) for j in p["action"]["joints"]])
        self.na = len(self.act)
        self.qadr = np.array([self.model.joint(j).qposadr[0] for j in p["joints"]])
        self.dadr = np.array([self.model.joint(j).dofadr[0] for j in p["joints"]])
        self.lim = np.array([self.model.joint(j).range for j in p["joints"]])
        self.tip_id = self.model.site(p["tipSite"]).id
        self.shoulder_id = self.model.site(p["shoulderSite"]).id
        self.hz = p["controlHz"]
        self.substeps = p["substeps"]
        self.delta_scale = p["action"]["deltaScale"]
        self.neutral = np.array(p["baseline"]["neutralPose"])
        self.reach = p["reach"]
        self.success = p["success"]

        size = p["observation"]["size"]
        self.observation_space = gym.spaces.Box(-np.inf, np.inf, (size,), np.float64)
        self.action_space = gym.spaces.Box(-1.0, 1.0, (self.na,), np.float32)

    # --- state helpers -------------------------------------------------------------------------

    def q(self) -> np.ndarray:
        return self.data.qpos[self.qadr].copy()

    def qd(self) -> np.ndarray:
        return self.data.qvel[self.dadr].copy()

    def tip(self) -> np.ndarray:
        return self.data.site_xpos[self.tip_id].copy()

    def fk_tip(self, q: np.ndarray) -> np.ndarray:
        self.scratch.qpos[self.qadr] = q
        mujoco.mj_kinematics(self.model, self.scratch)
        return self.scratch.site_xpos[self.tip_id].copy()

    def expand(self, action: np.ndarray) -> np.ndarray:
        """Policy action → per-joint action; joints outside action.joints get 0 (held)."""
        full = np.zeros(self.n)
        full[self.act] = action
        return full

    def obs(self) -> np.ndarray:
        return build_obs(
            self.parity,
            self.q()[self.act],
            self.qd()[self.act],
            self.target,
            self.tip(),
            self.prev_action,
        )

    # --- target sampling -----------------------------------------------------------------------

    def sample_reachable(self) -> np.ndarray:
        """Same distribution as web/src/sim/eval.ts reachableTargets (front workspace)."""
        bx, by = self.reach["baseAxisXY"]
        while True:
            p = self.fk_tip(self.np_random.uniform(self.lim[:, 0], self.lim[:, 1]))
            if p[2] < self.reach["minZ"] or p[1] > by - self.reach["frontMargin"]:
                continue
            if np.hypot(p[0] - bx, p[1] - by) < self.reach["baseExclusionRadius"]:
                continue
            return p

    def sample_target(self) -> np.ndarray:
        s, rng = self.sampling, self.np_random
        u = rng.random()
        bx, by = self.reach["baseAxisXY"]
        if u < s.p_unreachable_far:
            d = rng.normal(size=3)
            d[2] = abs(d[2])
            d /= np.linalg.norm(d)
            r = self.reach["maxReach"] + rng.uniform(0.02, 0.15)
            p = self.data.site_xpos[self.shoulder_id] + d * r
        elif u < s.p_unreachable_far + s.p_unreachable_behind:
            p = np.array(
                [bx + rng.uniform(-0.3, 0.3), by + rng.uniform(0.05, 0.3), rng.uniform(0.02, 0.5)]
            )
        else:
            p = self.sample_reachable()
        return clamp_target(p, self.reach)

    # --- gym API -------------------------------------------------------------------------------

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        rng = self.np_random
        mujoco.mj_resetData(self.model, self.data)
        if rng.random() < self.sampling.p_random_start:
            q = rng.uniform(self.lim[:, 0], self.lim[:, 1])
        else:
            q = np.clip(self.neutral + rng.normal(0, 0.1, self.n), self.lim[:, 0], self.lim[:, 1])
        self.data.qpos[self.qadr] = q
        self.data.ctrl[:] = q
        mujoco.mj_forward(self.model, self.data)

        self.t = 0
        self.prev_action = np.zeros(self.na)
        self.target = self.sample_target()
        self.glide: tuple[np.ndarray, np.ndarray, int, int] | None = None
        n_changes = rng.integers(
            self.sampling.min_target_changes, self.sampling.max_target_changes + 1
        )
        steps = self.sampling.episode_steps
        self.changes = sorted(
            rng.choice(np.arange(25, steps - 25), n_changes, replace=False).tolist()
        )
        tip = self.tip()
        self.tips = [tip, tip, tip]  # history for the jerk estimate
        self.settled_run = 0
        return self.obs(), {}

    def _advance_target(self) -> None:
        if self.changes and self.t == self.changes[0]:
            self.changes.pop(0)
            new = self.sample_target()
            if self.np_random.random() < self.sampling.p_moving_target:
                dur = int(self.np_random.integers(25, 75))  # 0.5–1.5 s
                self.glide = (self.target.copy(), new, self.t, dur)
            else:
                self.target = new
                self.glide = None
        if self.glide is not None:
            a, b, t0, dur = self.glide
            f = min(1.0, (self.t - t0) / dur)
            self.target = clamp_target(a + (b - a) * f, self.reach)
            if f >= 1.0:
                self.glide = None

    def step(self, action):
        action = np.clip(np.asarray(action, dtype=np.float64), -1.0, 1.0)
        self.data.ctrl[:] = apply_action(
            self.data.ctrl.copy(), self.expand(action), self.delta_scale, self.lim
        )
        for _ in range(self.substeps):
            mujoco.mj_step(self.model, self.data)
        self.t += 1

        tip = self.tip()
        h = self.tips
        jerk = (tip - 3 * h[-1] + 3 * h[-2] - h[-3]) * self.hz**3
        speed = np.linalg.norm(tip - h[-1]) * self.hz
        self.tips = [h[-2], h[-1], tip]

        dist = float(np.linalg.norm(tip - self.target))
        settled = dist <= self.success["tolerance"] and speed < self.success["maxTipSpeed"]
        w = self.reward_w
        rate = float(np.sum((action - self.prev_action) ** 2))
        posture = float(np.sum((self.q() - self.neutral)[self.act] ** 2))
        reward = (
            -w.distance * dist
            + w.precision * (1.0 - np.tanh(dist / w.precision_scale))
            + w.success_bonus * float(settled)
            - self.penalty_scale * w.action_rate * rate
            - self.penalty_scale * w.jerk * float(np.sum(jerk**2))
            - self.penalty_scale * w.joint_speed * float(np.sum(self.qd()[self.act] ** 2))
            - self.penalty_scale * w.posture * posture
            - self.penalty_scale * w.effort * float(np.sum(action**2))
        )
        self.prev_action = action
        self._advance_target()
        truncated = self.t >= self.sampling.episode_steps
        info = {"dist": dist, "settled": settled, "jerk_sq": float(np.sum(jerk**2)), "rate": rate}
        return self.obs(), reward, False, truncated, info
