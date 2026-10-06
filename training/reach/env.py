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


def actuator_for(model: mujoco.MjModel, joint: str) -> int:
    """Id of the actuator driving `joint`."""
    jid = model.joint(joint).id
    ids = [a for a in range(model.nu) if model.actuator_trnid[a, 0] == jid]
    if len(ids) != 1:
        raise RuntimeError(f"expected one actuator on joint {joint}, found {len(ids)}")
    return ids[0]


def arm_body_ids(model: mujoco.MjModel, joints: list[str]) -> set[int]:
    """Bodies of the arm that move (each body a joint moves, and the jaw): web Sim.armBodies."""
    ids = {model.jnt_bodyid[model.joint(j).id] for j in joints}
    return ids | {model.body("Moving_Jaw").id}


def contact_flags(env: ReachEnv) -> tuple[bool, bool]:
    """(arm touches the floor, arm touches the cube) in the current contact set."""
    m, d = env.model, env.data
    floor = cube = False
    for i in range(d.ncon):
        c = d.contact[i]
        b1, b2 = m.geom_bodyid[c.geom1], m.geom_bodyid[c.geom2]
        arm1, arm2 = b1 in env.arm_bodies, b2 in env.arm_bodies
        if not (arm1 or arm2):
            continue
        other, other_geom = (b2, c.geom2) if arm1 else (b1, c.geom1)
        floor |= other_geom == env.floor_geom
        cube |= other == env.cube_body
    return floor, cube


def _arm_penetrates(env: ReachEnv) -> bool:
    """An arm body more than 1 mm inside the floor or the cube (after mj_forward)."""
    m, d = env.model, env.data
    for i in range(d.ncon):
        c = d.contact[i]
        if c.dist >= -0.001:
            continue
        b1, b2 = m.geom_bodyid[c.geom1], m.geom_bodyid[c.geom2]
        if (b1 in env.arm_bodies) == (b2 in env.arm_bodies):
            continue
        if env.floor_geom in (c.geom1, c.geom2) or env.cube_body in (b1, b2):
            return True
    return False


MAX_ATTEMPTS = 100


def place_cube(env: ReachEnv, rng: np.random.Generator) -> None:
    """Cube at its default pose (p_cube_default) or uniform by area in front of the arm."""
    p, s = env.parity, env.sampling
    a = env.cube_qadr
    if rng.random() < s.p_cube_default:
        pos, yaw = p["cube"]["defaultPose"]["pos"], p["cube"]["defaultPose"]["yaw"]
    else:
        bx, by = p["reach"]["baseAxisXY"]
        lo, hi = s.cube_r
        r = np.sqrt(rng.uniform(lo * lo, hi * hi))
        ang = rng.uniform(-s.cube_max_angle, s.cube_max_angle)
        pos = [bx + r * np.sin(ang), by - r * np.cos(ang), p["cube"]["size"] / 2]
        yaw = rng.uniform(0, np.pi / 2)
    env.data.qpos[a : a + 3] = pos
    env.data.qpos[a + 3 : a + 7] = [np.cos(yaw / 2), 0, 0, np.sin(yaw / 2)]


def in_cube_box(env: ReachEnv, point: np.ndarray) -> bool:
    c = env.data.qpos[env.cube_qadr : env.cube_qadr + 3]
    half = env.parity["cube"]["size"] / 2 + env.sampling.target_cube_margin
    return bool(np.all(np.abs(np.asarray(point) - c) <= half))


def collision_free_reset(env: ReachEnv, rng: np.random.Generator, sample_pose) -> None:
    """003 (research R2): cube placed, then an arm start pose that does not penetrate the floor
    or the cube (resampled), with ctrl = pose. General: reused by later learned features."""
    reset_scene(env)
    place_cube(env, rng)
    for _ in range(MAX_ATTEMPTS):
        q = sample_pose()
        env.data.qpos[env.qadr] = q
        env.data.ctrl[env.aid] = q
        env.data.qvel[:] = 0
        mujoco.mj_forward(env.model, env.data)
        if not _arm_penetrates(env):
            return
    raise RuntimeError(f"no collision-free start pose in {MAX_ATTEMPTS} attempts")


def reset_scene(env: ReachEnv) -> None:
    """MuJoCo defaults (cube at its default pose), gripper closed, as web/src/sim/session.ts."""
    mujoco.mj_resetData(env.model, env.data)
    env.data.qpos[env.jaw_qadr] = env.jaw_closed
    env.data.ctrl[env.jaw_aid] = env.jaw_closed


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
        # Actuator ids of the arm joints (ctrl also holds the gripper, research R8).
        self.aid = np.array([actuator_for(self.model, j) for j in p["joints"]])
        self.jaw_aid = self.model.actuator(p["gripper"]["actuator"]).id
        self.jaw_qadr = self.model.joint(p["gripper"]["joint"]).qposadr[0]
        self.jaw_closed = p["gripper"]["closed"]
        self.arm_bodies = arm_body_ids(self.model, p["joints"])
        self.floor_geom = self.model.geom("floor").id
        self.cube_body = self.model.body(p["cube"]["body"]).id
        self.cube_qadr = self.model.joint(p["cube"]["joint"]).qposadr[0]
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
            if p[2] < self.reach["evalMinZ"] or p[1] > by - self.reach["frontMargin"]:
                continue
            if np.hypot(p[0] - bx, p[1] - by) < self.reach["baseExclusionRadius"]:
                continue
            return p

    def sample_target(self) -> np.ndarray:
        """A target (001 mix), never inside the cube's box grown by target_cube_margin (003)."""
        for _ in range(MAX_ATTEMPTS):
            p = self._sample_target()
            if not in_cube_box(self, p):
                return p
        raise RuntimeError(f"no target outside the cube in {MAX_ATTEMPTS} attempts")

    def _sample_target(self) -> np.ndarray:
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

        def sample_pose() -> np.ndarray:
            if rng.random() < self.sampling.p_random_start:
                return rng.uniform(self.lim[:, 0], self.lim[:, 1])
            return np.clip(
                self.neutral + rng.normal(0, 0.1, self.n), self.lim[:, 0], self.lim[:, 1]
            )

        collision_free_reset(self, rng, sample_pose)

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

    def _contact_penalty(self, floor: bool, cube: bool) -> float:
        """003: explicit, unramped cost of touching the floor / the cube."""
        return -self.reward_w.floor * floor - self.reward_w.cube * cube

    def step(self, action):
        action = np.clip(np.asarray(action, dtype=np.float64), -1.0, 1.0)
        self.data.ctrl[self.aid] = apply_action(
            self.data.ctrl[self.aid], self.expand(action), self.delta_scale, self.lim
        )
        floor = cube = False
        for _ in range(self.substeps):
            mujoco.mj_step(self.model, self.data)
            f, c = contact_flags(self)
            floor |= f
            cube |= c
        self.t += 1

        tip = self.tip()
        h = self.tips
        jerk = (tip - 3 * h[-1] + 3 * h[-2] - h[-3]) * self.hz**3
        speed = np.linalg.norm(tip - h[-1]) * self.hz
        self.tips = [h[-2], h[-1], tip]

        dist = float(np.linalg.norm(tip - self.target))
        settled = dist <= self.success["tolerance"] and speed < self.success["maxTipSpeed"]
        w = self.reward_w
        jerk_raw = float(np.sum(jerk**2))
        # Cap only impacts (steps with an arm contact): capping free motion too removed the
        # incentive to be smooth once ordinary motion exceeded the cap (003 validation, T017).
        jerk_sq = min(jerk_raw, w.jerk_cap) if (floor or cube) else jerk_raw
        rate = float(np.sum((action - self.prev_action) ** 2))
        posture = float(np.sum((self.q() - self.neutral)[self.act] ** 2))
        reward = (
            -w.distance * dist
            + w.precision * (1.0 - np.tanh(dist / w.precision_scale))
            + w.success_bonus * float(settled)
            - self.penalty_scale * w.action_rate * rate
            - self.penalty_scale * w.jerk * jerk_sq
            - self.penalty_scale * w.joint_speed * float(np.sum(self.qd()[self.act] ** 2))
            - self.penalty_scale * w.posture * posture
            - self.penalty_scale * w.effort * float(np.sum(action**2))
            + self._contact_penalty(floor, cube)
        )
        self.prev_action = action
        self._advance_target()
        truncated = self.t >= self.sampling.episode_steps
        info = {
            "dist": dist,
            "settled": settled,
            "jerk_sq": jerk_sq,
            "jerk_sq_raw": jerk_raw,
            "rate": rate,
            "floor": floor,
            "cube_contact": cube,
        }
        return self.obs(), reward, False, truncated, info
