"""Train the reach policy with PPO (research R5).

    uv run python -m reach.train --seed 0 [--steps 5000000] [--envs 12] [--w_jerk 2e-4 ...]

Writes training/runs/<run-id>/: model.zip, vecnormalize.pkl, config.json, progress.csv.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, fields
from pathlib import Path

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, CheckpointCallback
from stable_baselines3.common.logger import configure
from stable_baselines3.common.vec_env import SubprocVecEnv, VecMonitor, VecNormalize
from torch import nn

from .config import REWARD, RewardWeights
from .env import ReachEnv

RUNS = Path(__file__).resolve().parents[1] / "runs"


class PenaltyCurriculum(BaseCallback):
    """Ramp the smoothness penalties from 0 to full over the first `ramp` fraction of training.

    With full penalties from the start, exploration noise makes jerk enormous and the policy
    learns to stay still instead of reaching (run r1).
    """

    def __init__(self, total: int, ramp: float) -> None:
        super().__init__()
        self.total, self.ramp = total, ramp

    def _on_rollout_start(self) -> None:
        scale = 1.0 if self.ramp <= 0 else min(1.0, self.num_timesteps / (self.ramp * self.total))
        self.training_env.set_attr("penalty_scale", scale)
        self.logger.record("reach/penalty_scale", scale)

    def _on_step(self) -> bool:
        return True


class Stats(BaseCallback):
    """Logs mean distance, settled fraction, jerk and action rate from step infos."""

    def __init__(self) -> None:
        super().__init__()
        self.buf: dict[str, list[float]] = {"dist": [], "settled": [], "jerk_sq": [], "rate": []}

    def _on_step(self) -> bool:
        for info in self.locals["infos"]:
            for k in self.buf:
                self.buf[k].append(float(info[k]))
        return True

    def _on_rollout_end(self) -> None:
        for k, v in self.buf.items():
            if v:
                self.logger.record(f"reach/{k}", float(np.mean(v)))
            v.clear()


def make_env(rank: int, seed: int, weights: dict[str, float]):
    def _init():
        env = ReachEnv(**weights)
        env.reset(seed=seed + rank)
        return env

    return _init


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--steps", type=int, default=5_000_000)
    ap.add_argument("--envs", type=int, default=12)
    ap.add_argument("--name", type=str, default="")
    ap.add_argument("--ramp", type=float, default=0.5, help="penalty curriculum fraction")
    ap.add_argument("--resume", type=str, default="", help="continue from runs/<id> (final model)")
    for f in fields(RewardWeights):
        ap.add_argument(f"--w_{f.name}", type=float, default=getattr(REWARD, f.name))
    args = ap.parse_args()

    weights = {f.name: getattr(args, f"w_{f.name}") for f in fields(RewardWeights)}
    run_id = args.name or time.strftime("%Y%m%d-%H%M%S") + f"-s{args.seed}"
    out = RUNS / run_id
    out.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(2)

    venv = SubprocVecEnv([make_env(i, args.seed * 1000, weights) for i in range(args.envs)])
    if args.resume:
        src = RUNS / args.resume
        venv = VecNormalize.load(str(src / "vecnormalize.pkl"), VecMonitor(venv))
        venv.training = True
        model = PPO.load(src / "model.zip", env=venv, device="cpu")
    else:
        venv = VecNormalize(VecMonitor(venv), norm_obs=True, norm_reward=True, clip_obs=10.0)
        model = PPO(
            "MlpPolicy",
            venv,
            n_steps=1024,
            batch_size=4096,
            n_epochs=10,
            learning_rate=3e-4,
            gamma=0.99,
            gae_lambda=0.95,
            clip_range=0.2,
            ent_coef=0.0,
            policy_kwargs=dict(
                net_arch=dict(pi=[128, 128], vf=[128, 128]),
                activation_fn=nn.Tanh,
                log_std_init=-1.0,
            ),
            seed=args.seed,
            device="cpu",
            verbose=0,
        )
    model.set_logger(configure(str(out), ["csv", "stdout"]))
    (out / "config.json").write_text(
        json.dumps(
            {
                "seed": args.seed,
                "steps": args.steps,
                "envs": args.envs,
                "reward": weights,
                "penalty_ramp": args.ramp,
                "reward_defaults": asdict(REWARD),
            },
            indent=2,
        )
    )
    t0 = time.time()
    model.learn(
        total_timesteps=args.steps,
        callback=[
            PenaltyCurriculum(args.steps, args.ramp),
            Stats(),
            CheckpointCallback(
                save_freq=max(1, 5_000_000 // args.envs),
                save_path=str(out / "checkpoints"),
                name_prefix="model",
                save_vecnormalize=True,
            ),
        ],
    )
    model.save(out / "model.zip")
    venv.save(str(out / "vecnormalize.pkl"))
    print(f"done in {time.time() - t0:.0f} s -> {out}")


if __name__ == "__main__":
    main()
