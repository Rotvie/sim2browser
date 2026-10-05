"""Quick training-side evaluation of a checkpoint (a proxy for web/scripts/eval.ts, which is the
number of record: it runs the shipped TypeScript policy on the WASM sim).

    uv run python -m reach.evaluate --run r3-precision [--checkpoint 20000000] [--n 100]

Same protocol as the web evaluation: from the neutral pose, one reachable front-workspace target,
settled = within tolerance and slower than maxTipSpeed for `hold` seconds, complete by timeLimit.
"""

from __future__ import annotations

import argparse
import pickle
from pathlib import Path

import mujoco
import numpy as np
from stable_baselines3 import PPO

from .env import ReachEnv, apply_action, clamp_target, reset_scene
from .export import RUNS

BASELINE_JERK = 278.3  # web/eval/baseline.json, seed 0 (m²/s⁶)


def load(run: Path, checkpoint: str | None):
    if checkpoint:
        model = PPO.load(run / "checkpoints" / f"model_{checkpoint}_steps.zip", device="cpu")
        vn = run / "checkpoints" / f"model_vecnormalize_{checkpoint}_steps.pkl"
    else:
        model = PPO.load(run / "model.zip", device="cpu")
        vn = run / "vecnormalize.pkl"
    with open(vn, "rb") as f:
        vecnorm = pickle.load(f)
    vecnorm.training = False
    return model, vecnorm


def evaluate(model, vecnorm, n: int, seed: int) -> dict:
    env = ReachEnv()
    env.reset(seed=seed)
    succ = env.success
    hz = env.hz
    need = round(succ["hold"] * hz)
    steps = round((succ["timeLimit"] + 1) * hz)
    successes, jerks, settle, speeds = 0, [], [], []
    for _ in range(n):
        target = env.sample_reachable()
        reset_scene(env)
        env.data.qpos[env.qadr] = env.neutral
        env.data.ctrl[env.aid] = env.neutral
        mujoco.mj_forward(env.model, env.data)
        env.target = clamp_target(target, env.reach)
        env.prev_action = np.zeros(env.na)
        trace = []
        obs = env.obs()
        for _ in range(steps):
            a, _ = model.predict(
                vecnorm.normalize_obs(obs[None]).astype(np.float32), deterministic=True
            )
            env.data.ctrl[env.aid] = apply_action(
                env.data.ctrl[env.aid], env.expand(a[0]), env.delta_scale, env.lim
            )
            for _ in range(env.substeps):
                mujoco.mj_step(env.model, env.data)
            env.prev_action = np.clip(a[0].astype(np.float64), -1, 1)
            trace.append(env.tip())
            speeds.append(np.abs(env.qd()))
            obs = env.obs()
        tr = np.array(trace)
        run = 0
        ok = False
        for k in range(len(tr)):
            d = np.linalg.norm(tr[k] - env.target)
            v = np.linalg.norm(tr[k] - tr[k - 1]) * hz if k else 0.0
            run = run + 1 if (d <= succ["tolerance"] and v < succ["maxTipSpeed"]) else 0
            if run >= need:
                ok = (k + 1) / hz <= succ["timeLimit"] + 1e-9
                if ok:
                    settle.append((k - need + 2) / hz)
                break
        successes += ok
        j = (tr[3:] - 3 * tr[2:-1] + 3 * tr[1:-2] - tr[:-3]) * hz**3
        jerks.append(float(np.mean(np.sum(j**2, axis=1))))
    return {
        "success": successes / n,
        "jerk": float(np.mean(jerks)),
        "jerk_ratio_vs_baseline": float(np.mean(jerks)) / BASELINE_JERK,
        "settle_p50": float(np.median(settle)) if settle else None,
        # Mean |joint speed| per joint (rad/s): exposes motion the tip metrics cannot see.
        "joint_speed": np.mean(speeds, axis=0).round(3).tolist(),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--seed", type=int, default=123)
    args = ap.parse_args()
    model, vecnorm = load(RUNS / args.run, args.checkpoint)
    r = evaluate(model, vecnorm, args.n, args.seed)
    print(
        f"{args.run} {args.checkpoint or 'final'}: success {r['success']:.0%}, "
        f"jerk {r['jerk']:.1f} (ratio {r['jerk_ratio_vs_baseline']:.2f} vs baseline), "
        f"settle p50 {r['settle_p50']}, mean |joint speed| {r['joint_speed']}"
    )


if __name__ == "__main__":
    main()
