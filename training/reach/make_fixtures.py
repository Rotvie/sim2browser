"""Write parity fixtures (contracts/parity-fixture.md) from Python MuJoCo, the reference.

    uv run python -m reach.make_fixtures --run <run-id>

Must run after the final export: fixtures record the hashes of parity.json and the model.
"""

from __future__ import annotations

import argparse
import json
import pickle

import mujoco
import numpy as np
from stable_baselines3 import PPO

from .env import ReachEnv, apply_action, build_obs, clamp_target
from .export import RUNS
from .spec import SHARED, load_parity, sha256_file

STEPS = 500


def header(p: dict, kind: str) -> dict:
    return {
        "fixtureVersion": 1,
        "parityJsonSha256": sha256_file(SHARED / "parity.json"),
        "modelSha256": p["model"]["sha256"],
        "mujocoVersion": mujoco.__version__,
        "kind": kind,
    }


def init_state(env: ReachEnv, q: np.ndarray, target: np.ndarray) -> dict:
    mujoco.mj_resetData(env.model, env.data)
    env.data.qpos[env.qadr] = q
    env.data.ctrl[:] = q
    mujoco.mj_forward(env.model, env.data)
    env.target = clamp_target(target, env.reach)
    env.prev_action = np.zeros(env.na)
    return {
        "qpos": env.data.qpos.tolist(),
        "qvel": env.data.qvel.tolist(),
        "ctrl": env.data.ctrl.tolist(),
        "target": env.target.tolist(),
    }


def physics_step(env: ReachEnv, action: np.ndarray) -> None:
    env.data.ctrl[:] = apply_action(env.data.ctrl.copy(), action, env.delta_scale, env.lim)
    for _ in range(env.substeps):
        mujoco.mj_step(env.model, env.data)


def trajectory(env: ReachEnv, p: dict, actions: np.ndarray) -> dict:
    init = init_state(env, np.array(p["baseline"]["neutralPose"]), env.fk_tip(env.neutral))
    steps = []
    for a in actions:
        physics_step(env, a)
        steps.append(
            {"action": a.tolist(), "qpos": env.data.qpos.tolist(), "qvel": env.data.qvel.tolist()}
        )
    return {**header(p, "trajectory"), "init": init, "targetChanges": [], "steps": steps}


def policy_recorded(env: ReachEnv, p: dict, run: str) -> dict:
    model = PPO.load(RUNS / run / "model.zip", device="cpu")
    with open(RUNS / run / "vecnormalize.pkl", "rb") as f:
        vecnorm = pickle.load(f)
    norm = p["observation"]["normalization"]
    mean, std = np.array(norm["mean"]), np.array(norm["std"])

    env.reset(seed=7)
    by = p["reach"]["baseAxisXY"][1]
    targets = [env.sample_reachable(), env.sample_reachable()]
    targets.append(np.array([0.0, by + 0.2, 0.25]))  # behind the base: unreachable
    targets.append(env.sample_reachable())
    change_at = {120: targets[1], 240: targets[2], 360: targets[3]}
    init = init_state(env, np.array(p["baseline"]["neutralPose"]), targets[0])
    changes, steps = [], []
    for k in range(STEPS):
        if k in change_at:
            env.target = clamp_target(change_at[k], env.reach)
            changes.append({"step": k, "target": env.target.tolist()})
        tip = env.data.site_xpos[env.tip_id].copy()
        obs_raw = build_obs(
            p, env.q()[env.act], env.qd()[env.act], env.target, tip, env.prev_action
        )
        obs_norm = np.clip(
            (obs_raw - mean) / np.maximum(std, norm["eps"]), -norm["clip"], norm["clip"]
        )
        # Cross-check against SB3's own normalization.
        assert np.allclose(obs_norm, vecnorm.normalize_obs(obs_raw[None])[0], atol=1e-9)
        action, _ = model.predict(obs_norm.astype(np.float32), deterministic=True)
        action = np.asarray(action, dtype=np.float64)
        steps.append(
            {
                "action": action.tolist(),
                "obsRaw": obs_raw.tolist(),
                "obsNorm": obs_norm.tolist(),
                "policyAction": action.tolist(),
            }
        )
        physics_step(env, env.expand(action))
        env.prev_action = action
        steps[-1]["qpos"] = env.data.qpos.tolist()
        steps[-1]["qvel"] = env.data.qvel.tolist()
    return {**header(p, "policy"), "init": init, "targetChanges": changes, "steps": steps}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    args = ap.parse_args()
    p = load_parity()
    if p.get("policy", {}).get("header") is None:
        raise SystemExit("export a policy first: uv run python -m reach.export --run <id>")
    env = ReachEnv()
    rng = np.random.default_rng(0)
    out = SHARED / "parity"
    out.mkdir(exist_ok=True)
    rand = rng.uniform(-1, 1, size=(STEPS, env.n))
    limits = np.array([[1.0 if (k // 50) % 2 == 0 else -1.0] * env.n for k in range(STEPS)])
    fixtures = {
        "trajectory-random.json": trajectory(env, p, rand),
        "trajectory-limits.json": trajectory(env, p, limits),
        "policy-recorded.json": policy_recorded(env, p, args.run),
    }
    for name, fx in fixtures.items():
        (out / name).write_text(json.dumps(fx) + "\n")
        print(f"wrote shared/parity/{name} ({len(fx['steps'])} steps)")


if __name__ == "__main__":
    main()
