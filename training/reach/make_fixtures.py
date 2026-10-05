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

from .env import ReachEnv, apply_action, build_obs, clamp_target, reset_scene
from .export import RUNS
from .grasp import Arm as GraspArm
from .grasp import full_pose, topdown_ik
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
    reset_scene(env)
    env.data.qpos[env.qadr] = q
    env.data.ctrl[env.aid] = q
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
    env.data.ctrl[env.aid] = apply_action(env.data.ctrl[env.aid], action, env.delta_scale, env.lim)
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


def ctrl_header(p: dict) -> dict:
    return {**header(p, "ctrl"), "fixtureVersion": 2}


def contact_random(env: ReachEnv, p: dict) -> dict:
    """Open gripper lowered onto the cube, closed, then a seeded random walk of the arm targets
    with the jaw toggling every 60 steps (contracts/parity-fixture.md `contact-random.json`)."""
    m, d = env.model, env.data
    g, grasp = p["gripper"], p["grasp"]
    arm = GraspArm(m)
    cube = np.array(p["cube"]["defaultPose"]["pos"])
    vertical = grasp["verticalOffset"]
    q3 = np.array([0.0, -1.0, 1.5])
    waypoints = []
    for z in (cube[2] + 0.06, cube[2] + 0.005):
        q3 = topdown_ik(arm, np.array([cube[0], cube[1], z]), vertical, q3, 0.2)
        assert q3 is not None
        waypoints.append(full_pose(arm, vertical, q3))
    reset_scene(env)
    d.qpos[env.qadr] = waypoints[0]
    d.ctrl[env.aid] = waypoints[0]
    d.qpos[env.jaw_qadr] = d.ctrl[env.jaw_aid] = g["open"]
    mujoco.mj_forward(m, d)
    init = {"qpos": d.qpos.tolist(), "qvel": d.qvel.tolist(), "ctrl": d.ctrl.tolist()}

    rng = np.random.default_rng(1)
    lo, hi = m.actuator_ctrlrange[:, 0], m.actuator_ctrlrange[:, 1]
    ctrl = d.ctrl.copy()
    steps, max_con, jaw_cube = [], 0, False
    jaw_bodies = {m.body("Fixed_Jaw").id, m.body("Moving_Jaw").id}
    cube_body = m.body("cube").id
    for k in range(300):
        if k < 40:  # descend onto the cube
            f = (k + 1) / 40
            ctrl[env.aid] = (1 - f) * waypoints[0] + f * waypoints[1]
        elif k == 40:
            ctrl[env.jaw_aid] = g["closed"]
        else:
            ctrl[env.aid] = np.clip(
                ctrl[env.aid] + rng.normal(0, 0.04, env.n), lo[env.aid], hi[env.aid]
            )
            if k % 60 == 0:
                ctrl[env.jaw_aid] = g["open"] if ctrl[env.jaw_aid] < 0 else g["closed"]
        d.ctrl[:] = ctrl
        for _ in range(env.substeps):
            mujoco.mj_step(m, d)
            max_con = max(max_con, d.ncon)
            for i in range(d.ncon):
                b = {m.geom_bodyid[d.contact[i].geom1], m.geom_bodyid[d.contact[i].geom2]}
                jaw_cube |= cube_body in b and bool(b & jaw_bodies)
        steps.append({"ctrl": ctrl.tolist(), "qpos": d.qpos.tolist(), "qvel": d.qvel.tolist()})
    if max_con < 4 or not jaw_cube:
        raise SystemExit(f"contact-random has too few contacts ({max_con}, jaw-cube {jaw_cube})")
    print(f"contact-random: max {max_con} contacts, jaw-cube contact {jaw_cube}")
    return {**ctrl_header(p), "init": init, "steps": steps}


def grasp_recorded(env: ReachEnv, p: dict) -> dict | None:
    """Replay the commands of one scripted grasp, recorded from the browser controller by
    web/scripts/record-grasp.ts, in Python: the reference states for that grasp."""
    src = SHARED / "parity" / "grasp-actions.json"
    if not src.exists():
        print("no shared/parity/grasp-actions.json yet (run web/scripts/record-grasp.ts)")
        return None
    rec = json.loads(src.read_text())
    m, d = env.model, env.data
    d.qpos[:], d.qvel[:], d.ctrl[:] = rec["init"]["qpos"], rec["init"]["qvel"], rec["init"]["ctrl"]
    mujoco.mj_forward(m, d)
    steps = []
    for st in rec["steps"]:
        d.ctrl[:] = st["ctrl"]
        for _ in range(env.substeps):
            mujoco.mj_step(m, d)
        steps.append({"ctrl": st["ctrl"], "qpos": d.qpos.tolist(), "qvel": d.qvel.tolist()})
    cube_z = d.qpos[m.joint(p["cube"]["joint"]).qposadr[0] + 2]
    lifted = p["cube"]["size"] / 2 + p["grasp"]["success"]["liftCheck"]
    if cube_z < lifted:
        raise SystemExit(f"grasp-recorded: cube ends at z = {cube_z:.3f}, not lifted in Python")
    print(f"grasp-recorded: cube ends at z = {cube_z:.3f}")
    return {**ctrl_header(p), "init": rec["init"], "steps": steps}


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
        "contact-random.json": contact_random(env, p),
    }
    grasp = grasp_recorded(env, p)
    if grasp is not None:
        fixtures["grasp-recorded.json"] = grasp
    for name, fx in fixtures.items():
        (out / name).write_text(json.dumps(fx) + "\n")
        print(f"wrote shared/parity/{name} ({len(fx['steps'])} steps)")


if __name__ == "__main__":
    main()
