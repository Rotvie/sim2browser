"""Behavior cloning for the grasp policy (004 research R2, R4-R6).

Trains a tanh MLP (30 -> hidden -> 6, clipped linear output: the network format the browser runs)
to map grasp observations to the demonstrated action, by mean squared error. Hand demonstrations
are sampled to a fixed share of each batch (--hand-share), since they are few next to the
scripted ones. Only lifted episodes train.

    uv run python -m reach.imitate train --run g1-s0 --seed 0 \\
        --demos demos/scripted-s1000-n2000.demos.jsonl.gz demos/hand.demos.jsonl.gz \\
        --hand-share 0.15
    uv run python -m reach.imitate select --runs g1-s0 g1-s1 g1-s2

`select` evaluates each run in the browser code path (Node, MuJoCo WASM) on the selection
placements (seed 1) only; the evaluation placements (seed 0) are never used here (spec FR-022).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

from reach import demos
from reach.spec import SHARED, load_parity

RUNS = SHARED.parent / "training" / "runs"
CACHE_VERSION = 1  # bump when the observation or label definition changes
STD_FLOOR = 1e-3  # features that barely vary are not blown up by the normalization
CLIP, EPS = 10.0, 1e-8


# --- data ---------------------------------------------------------------------------------------


def _cache_path(path: Path) -> Path:
    key = hashlib.sha256(
        json.dumps([CACHE_VERSION, demos.GRASP_OBS_FIELDS, path.stat().st_size]).encode()
    ).hexdigest()[:12]
    return path.with_name(f"{path.name}.{key}.npz")


def load_samples(path: Path, p: dict) -> dict:
    """Observations and labels of every lifted episode in a file (cached next to it)."""
    path = Path(path)
    cache = _cache_path(path)
    if cache.exists():
        z = np.load(cache, allow_pickle=False)
        return {k: z[k] for k in z.files} | {"header": json.loads(str(z["header_json"]))}
    header, episodes = demos.read(path, p)
    obs = demos.GraspObs(p)
    scale = p["baseline"]["maxJointSpeed"] / p["controlHz"]
    X, Y, hand, episode = [], [], [], []
    used = {"hand": 0, "scripted": 0, "dagger": 0}
    for i, ep in enumerate(episodes):
        # Demonstrations teach only when they lifted the cube; DAgger episodes are labelled by the
        # expert at every state, so the learner's failures teach too.
        if not ep["outcome"]["success"] and ep["source"] != "dagger":
            continue
        x, y, ok = demos.episode_samples(ep, obs, scale)
        X.append(x[ok])
        Y.append(y[ok])
        hand.append(np.full(ok.sum(), ep["source"] == "hand"))
        episode.append(np.full(ok.sum(), i))
        used[ep["source"]] += 1
    out = {
        "X": np.concatenate(X),
        "Y": np.concatenate(Y),
        "hand": np.concatenate(hand),
        "episode": np.concatenate(episode),
        "used_hand": np.array(used["hand"]),
        "used_scripted": np.array(used["scripted"]),
        "used_dagger": np.array(used["dagger"]),
        "header_json": np.array(json.dumps(header)),
    }
    np.savez_compressed(cache, **out)
    return out | {"header": header}


def combine(files: list[Path], p: dict) -> dict:
    parts = [load_samples(f, p) for f in files]
    # Noise levels of generated files (header generator: "demos.ts ... --noise 0,0.1,...").
    found = (re.search(r"--noise (\S+)", q["header"]["generator"]) for q in parts)
    noise = sorted({float(x) for m in found if m for x in m.group(1).split(",")})
    offset = 0
    episode = []
    for part in parts:
        episode.append(part["episode"] + offset)
        offset += int(part["episode"].max()) + 1 if len(part["episode"]) else 0
    return {
        "X": np.concatenate([q["X"] for q in parts]),
        "Y": np.concatenate([q["Y"] for q in parts]),
        "hand": np.concatenate([q["hand"] for q in parts]),
        "episode": np.concatenate(episode),
        "demos": {
            "scripted": int(sum(q["used_scripted"] for q in parts)),
            "hand": int(sum(q["used_hand"] for q in parts)),
            "dagger": int(sum(q.get("used_dagger", 0) for q in parts)),
            "noise": noise,
        },
        "files": [str(f) for f in files],
    }


def normalization(X: np.ndarray) -> dict:
    return {
        "mean": X.mean(axis=0).tolist(),
        "std": np.maximum(X.std(axis=0), STD_FLOOR).tolist(),
        "clip": CLIP,
        "eps": EPS,
    }


def normalize(X: np.ndarray, norm: dict) -> np.ndarray:
    """As web/src/sim/observation.ts normalize."""
    z = (X - np.array(norm["mean"])) / np.maximum(np.array(norm["std"]), norm["eps"])
    return np.clip(z, -norm["clip"], norm["clip"])


class BatchSampler:
    """Index batches with a fixed share of hand samples (research R6)."""

    def __init__(self, hand: np.ndarray, share: float, rng: np.random.Generator) -> None:
        self.hand_idx = np.flatnonzero(hand)
        self.other_idx = np.flatnonzero(~hand)
        if share > 0 and len(self.hand_idx) == 0:
            raise SystemExit("--hand-share > 0 but there are no hand samples")
        if share < 1 and len(self.other_idx) == 0:
            raise SystemExit("no scripted samples")
        self.share, self.rng = share, rng

    def __call__(self, size: int) -> np.ndarray:
        n_hand = self.rng.binomial(size, self.share) if self.share > 0 else 0
        return np.concatenate(
            [
                self.rng.choice(self.hand_idx, n_hand),
                self.rng.choice(self.other_idx, size - n_hand),
            ]
        )


# --- model --------------------------------------------------------------------------------------


def build_mlp(hidden: int, layers: int):
    import torch.nn as nn

    mods, width = [], demos.GRASP_OBS_SIZE
    for _ in range(layers):
        mods += [nn.Linear(width, hidden), nn.Tanh()]
        width = hidden
    mods.append(nn.Linear(width, demos.GRASP_ACTION_SIZE))
    return nn.Sequential(*mods)


def mlp_layers(net) -> list[tuple[np.ndarray, np.ndarray]]:
    """(W out x in, b) per linear layer, float64, for export."""
    return [
        (m.weight.detach().cpu().numpy().astype(np.float64), m.bias.detach().cpu().numpy())
        for m in net
        if hasattr(m, "weight")
    ]


def forward(layers: list[tuple[np.ndarray, np.ndarray]], x: np.ndarray) -> np.ndarray:
    """NumPy mirror of web/src/control/policy.ts forward (tanh hidden, clipped linear output)."""
    h = x
    for i, (w, b) in enumerate(layers):
        h = h @ w.T + b
        h = np.tanh(h) if i < len(layers) - 1 else np.clip(h, -1, 1)
    return h


def train(args: argparse.Namespace) -> Path:
    import torch

    p = load_parity()
    run = RUNS / args.run
    run.mkdir(parents=True, exist_ok=args.force)
    rng = np.random.default_rng(args.seed)
    torch.manual_seed(args.seed)
    t0 = time.time()
    data = combine([Path(f) for f in args.demos], p)
    print(
        f"{len(data['X'])} samples from {data['demos']['scripted']} scripted and "
        f"{data['demos']['hand']} hand episodes ({time.time() - t0:.0f} s)"
    )
    if data["demos"]["hand"] == 0 and args.hand_share > 0:
        raise SystemExit("no hand demonstrations: pass --hand-share 0 for a scripted-only run")

    # Hold out 5% of the episodes for the validation loss.
    eps = np.unique(data["episode"])
    val_eps = rng.choice(eps, max(1, len(eps) // 20), replace=False)
    val = np.isin(data["episode"], val_eps)
    norm = normalization(data["X"][~val])
    X = torch.tensor(normalize(data["X"], norm), dtype=torch.float32)
    Y = torch.tensor(data["Y"], dtype=torch.float32)
    tr_idx = np.flatnonzero(~val)
    sampler = BatchSampler(data["hand"][tr_idx], args.hand_share, rng)

    net = build_mlp(args.hidden, args.layers)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.steps)
    log = []
    for step in range(1, args.steps + 1):
        idx = tr_idx[sampler(args.batch)]
        loss = torch.mean((net(X[idx]) - Y[idx]) ** 2)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % args.log_every == 0 or step == args.steps:
            with torch.no_grad():
                vl = float(torch.mean((net(X[val]) - Y[val]) ** 2))
            tl = float(loss.detach())
            log.append({"step": step, "train": tl, "val": vl})
            print(f"step {step:6d}  train {tl:.5f}  val {vl:.5f}")

    layers = mlp_layers(net)
    np.savez(run / "weights.npz", *[a for wb in layers for a in wb])
    config = {
        "algo": "BC+DART",
        "run": args.run,
        "seed": args.seed,
        "steps": args.steps,
        "batch": args.batch,
        "lr": args.lr,
        "hidden": args.hidden,
        "layers": args.layers,
        "handShare": args.hand_share,
        "demos": data["demos"],
        "files": data["files"],
        "samples": int(len(data["X"])),
        "normalization": norm,
        "log": log,
        "seconds": round(time.time() - t0, 1),
    }
    (run / "config.json").write_text(json.dumps(config, indent=2) + "\n")
    print(f"wrote {run} ({config['seconds']} s)")
    return run


def load_run(run: Path) -> tuple[dict, list[tuple[np.ndarray, np.ndarray]]]:
    config = json.loads((run / "config.json").read_text())
    z = np.load(run / "weights.npz")
    arrays = [z[f"arr_{i}"] for i in range(len(z.files))]
    return config, list(zip(arrays[::2], arrays[1::2], strict=True))


# --- selection ----------------------------------------------------------------------------------


def evaluate_in_browser_path(run: Path, seed: int = 1, n: int = 100) -> dict:
    """Export `run` into a temporary copy of shared/ and run the Node grasp evaluation on it."""
    from reach.export import export_grasp_policy

    with tempfile.TemporaryDirectory() as tmp:
        shared = Path(tmp) / "shared"
        shutil.copytree(SHARED, shared, ignore=shutil.ignore_patterns("grasp-eval"))
        p = load_parity(shared / "parity.json")
        p = export_grasp_policy(p, run, shared=shared)
        (shared / "parity.json").write_text(json.dumps(p, indent=2) + "\n")
        out = Path(tmp) / "sel.json"
        cmd = [
            "npm",
            "run",
            "--silent",
            "eval:grasp",
            "--workspace",
            "web",
            "--",
            "--controller",
            "learned-grasp",
            "--seed",
            str(seed),
            "--n",
            str(n),
            "--shared",
            str(shared),
            "--out",
            str(out),
        ]
        subprocess.run(cmd, cwd=SHARED.parent, check=True)
        return json.loads(out.read_text())


def dagger(args: argparse.Namespace) -> None:
    """DAgger rounds: roll out the current policy in the browser code path (Node), label every
    visited state with the reactive expert, add the data, retrain from scratch on everything."""
    from reach.export import export_grasp_policy

    if args.seed_base < 3000:
        raise SystemExit("DAgger placements use seeds >= 3000 (0: evaluation, 1: selection)")
    files = list(args.demos)
    run = args.init_run
    for i in range(1, args.iters + 1):
        out = Path(args.out_dir) / f"dagger-{args.name}-{i}.demos.jsonl.gz"
        with tempfile.TemporaryDirectory() as tmp:
            shared = Path(tmp) / "shared"
            shutil.copytree(SHARED, shared, ignore=shutil.ignore_patterns("grasp-eval"))
            p = export_grasp_policy(load_parity(shared / "parity.json"), RUNS / run, shared=shared)
            (shared / "parity.json").write_text(json.dumps(p, indent=2) + "\n")
            seed = args.seed_base + (i - 1) * args.episodes
            cmd = ["npm", "run", "--silent", "dagger", "--workspace", "web", "--"]
            cmd += ["--shared", str(shared), "--seed", str(seed), "--n", str(args.episodes)]
            subprocess.run([*cmd, "--out", str(out.resolve())], cwd=SHARED.parent, check=True)
        files.append(str(out))
        run = f"{args.name}-{i}"
        targs = argparse.Namespace(**{**vars(args), "run": run, "demos": files, "force": True})
        train(targs)
        if args.select:
            select(argparse.Namespace(runs=[run], seed=1, n=100))
    print(f"last run: {run}; data: {files}")


def select(args: argparse.Namespace) -> None:
    if args.seed == 0:
        raise SystemExit("seed 0 is the evaluation set: selection uses other placements (FR-022)")
    rows = []
    for name in args.runs:
        r = evaluate_in_browser_path(RUNS / name, seed=args.seed, n=args.n)
        rows.append((r["successRate"], r["medianTimeToLift"], name, r["failures"]))
        config_path = RUNS / name / "config.json"
        config = json.loads(config_path.read_text())
        config["selection"] = {
            "seed": args.seed,
            "n": args.n,
            "successRate": r["successRate"],
            "medianTimeToLift": r["medianTimeToLift"],
            "failures": r["failures"],
        }
        config_path.write_text(json.dumps(config, indent=2) + "\n")
    print(f"\nselection placements: seed {args.seed}, n {args.n}")
    for rate, med, name, fails in sorted(rows, reverse=True):
        print(f"  {name:>16}  {rate * 100:5.1f}%  median {med}  {fails}")
    print(f"best: {max(rows)[2]}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train")
    t.add_argument("--run", required=True)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument("--demos", nargs="+", required=True)
    t.add_argument("--hand-share", type=float, default=0.15)
    t.add_argument("--hidden", type=int, default=256)
    t.add_argument("--layers", type=int, default=2)
    t.add_argument("--steps", type=int, default=20000)
    t.add_argument("--batch", type=int, default=1024)
    t.add_argument("--lr", type=float, default=1e-3)
    t.add_argument("--log-every", type=int, default=1000)
    t.add_argument("--force", action="store_true", help="overwrite an existing run")
    d = sub.add_parser("dagger")
    d.add_argument("--name", required=True, help="run prefix: <name>-1, <name>-2, ...")
    d.add_argument("--init-run", required=True, help="the behavior-cloning run to start from")
    d.add_argument("--demos", nargs="+", required=True, help="the demonstrations it trained on")
    d.add_argument("--iters", type=int, default=4)
    d.add_argument("--episodes", type=int, default=400, help="DAgger episodes per round")
    d.add_argument("--seed-base", type=int, default=3000)
    d.add_argument("--out-dir", default="demos")
    d.add_argument("--select", action="store_true", help="score every round on seed 1")
    d.add_argument("--seed", type=int, default=0)
    d.add_argument("--hand-share", type=float, default=0.15)
    d.add_argument("--hidden", type=int, default=256)
    d.add_argument("--layers", type=int, default=2)
    d.add_argument("--steps", type=int, default=20000)
    d.add_argument("--batch", type=int, default=1024)
    d.add_argument("--lr", type=float, default=1e-3)
    d.add_argument("--log-every", type=int, default=5000)
    s = sub.add_parser("select")
    s.add_argument("--runs", nargs="+", required=True)
    s.add_argument("--seed", type=int, default=1)
    s.add_argument("--n", type=int, default=100)
    args = ap.parse_args()
    {"train": train, "dagger": dagger, "select": select}[args.cmd](args)


if __name__ == "__main__":
    main()
