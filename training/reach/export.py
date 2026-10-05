"""Write shared/parity.json (and, with a trained run, the policy artifacts).

uv run python -m reach.export --no-policy      # P1/P2: no training needed
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import mujoco
import numpy as np

from .spec import (
    MODEL_PATH,
    PARITY_VERSION,
    SHARED,
    model_files,
    sha256_file,
    sha256_model,
    write_parity,
)

JOINTS = ["Rotation", "Pitch", "Elbow", "Wrist_Pitch", "Wrist_Roll"]
# Joints the policy observes and commands. Wrist_Roll does not move the tip, so neither the reward
# nor the metrics can see it; left to the policy it spins (001 runs r3-r6). The policy holds it.
POLICY_JOINTS = ["Rotation", "Pitch", "Elbow", "Wrist_Pitch"]
TIMESTEP = 0.002
SUBSTEPS = 10
CONTROL_HZ = 50
DELTA_SCALE = 0.05
MIN_Z = 0.01
# Demo workspace = in front of the base (research R12): the tip must be at least this far in
# front of the base axis (−y). Behind-the-base points need the arm folded back over itself.
FRONT_MARGIN = 0.02
VOXEL = 0.01
REACH_SAMPLES = 200_000
WORKSPACE_EXTRA_SAMPLES = 800_000
WORKSPACE_PATH = "workspace.bin"


def load_model() -> mujoco.MjModel:
    mujoco_version = (SHARED / "MUJOCO_VERSION").read_text().strip()
    if mujoco.__version__ != mujoco_version:
        raise SystemExit(f"mujoco {mujoco.__version__} != shared/MUJOCO_VERSION {mujoco_version}")
    model = mujoco.MjModel.from_xml_path(str(SHARED / MODEL_PATH))
    if model.opt.timestep != TIMESTEP:
        raise SystemExit(f"model timestep {model.opt.timestep} != {TIMESTEP}")
    return model


def joint_limits(model: mujoco.MjModel) -> np.ndarray:
    return np.array([model.joint(j).range for j in JOINTS])


def tip_samples(model: mujoco.MjModel, n: int, rng: np.random.Generator) -> np.ndarray:
    """Tip positions for n uniform joint configurations within limits."""
    lim = joint_limits(model)
    data = mujoco.MjData(model)
    tip = model.site("tip").id
    out = np.empty((n, 3))
    qs = rng.uniform(lim[:, 0], lim[:, 1], size=(n, len(JOINTS)))
    for i, q in enumerate(qs):
        data.qpos[:] = q
        mujoco.mj_kinematics(model, data)
        out[i] = data.site_xpos[tip]
    return out


def build_workspace(points: np.ndarray) -> tuple[np.ndarray, list[float], list[int]]:
    """Occupancy grid of reachable tip positions: mark, dilate by one voxel, erode by one voxel."""
    origin = points.min(axis=0) - 0.02
    dims = np.ceil((points.max(axis=0) + 0.02 - origin) / VOXEL).astype(int)
    grid = np.zeros(dims[::-1], dtype=bool)  # indexed [z, y, x] so x is fastest in memory
    idx = np.floor((points - origin) / VOXEL).astype(int)
    grid[idx[:, 2], idx[:, 1], idx[:, 0]] = True

    def shift_or(g: np.ndarray) -> np.ndarray:
        out = g.copy()
        for axis in range(3):
            for step in (-1, 1):
                out |= np.roll(g, step, axis=axis)
        return out

    closed = ~shift_or(~shift_or(grid))  # dilate, then erode (morphological closing)
    return closed, origin.round(6).tolist(), dims.tolist()


def base_parity(model: mujoco.MjModel) -> dict:
    rng = np.random.default_rng(0)
    data = mujoco.MjData(model)
    mujoco.mj_kinematics(model, data)
    shoulder = data.site_xpos[model.site("shoulder").id].copy()
    base_axis = data.xpos[model.body("Rotation_Pitch").id][:2].copy()

    reach_pts = tip_samples(model, REACH_SAMPLES, rng)
    max_reach = float(np.linalg.norm(reach_pts - shoulder, axis=1).max())

    ws_pts = np.concatenate([reach_pts, tip_samples(model, WORKSPACE_EXTRA_SAMPLES, rng)])
    ws_pts = ws_pts[(ws_pts[:, 2] >= MIN_Z) & (ws_pts[:, 1] <= base_axis[1] - FRONT_MARGIN)]
    grid, origin, dims = build_workspace(ws_pts)
    packed = np.packbits(grid.ravel(), bitorder="little")
    (SHARED / WORKSPACE_PATH).write_bytes(packed.tobytes())

    lim = joint_limits(model)
    neutral = lim.mean(axis=1)

    files = model_files()
    na = len(POLICY_JOINTS)
    return {
        "version": PARITY_VERSION,
        "mujocoVersion": mujoco.__version__,
        "model": {"path": MODEL_PATH, "sha256": sha256_model(files), "files": files},
        "timestep": TIMESTEP,
        "substeps": SUBSTEPS,
        "controlHz": CONTROL_HZ,
        "joints": JOINTS,
        "tipSite": "tip",
        "shoulderSite": "shoulder",
        "action": {
            "size": na,
            "joints": POLICY_JOINTS,
            "low": -1.0,
            "high": 1.0,
            "deltaScale": DELTA_SCALE,
        },
        "observation": {
            "size": 3 * na + 6,
            "fields": [
                {"name": "q", "size": na, "label": "Joint angles", "unit": "rad"},
                {"name": "qd", "size": na, "label": "Joint speeds", "unit": "rad/s"},
                {"name": "target", "size": 3, "label": "Target position", "unit": "m"},
                {"name": "tipToTarget", "size": 3, "label": "Tip → target", "unit": "m"},
                {"name": "prevAction", "size": na, "label": "Previous command", "unit": ""},
            ],
        },
        "reach": {
            "maxReach": round(max_reach, 6),
            "margin": 0.01,
            "hysteresis": 0.005,
            "minZ": MIN_Z,
            "frontMargin": FRONT_MARGIN,
            "baseAxisXY": base_axis.round(6).tolist(),
            "baseExclusionRadius": 0.05,
            "workspace": {
                "path": WORKSPACE_PATH,
                "sha256": sha256_file(SHARED / WORKSPACE_PATH),
                "origin": origin,
                "voxel": VOXEL,
                "dims": dims,
                "layout": "x-fastest, bit-packed little-endian",
            },
        },
        "success": {"tolerance": 0.01, "maxTipSpeed": 0.02, "hold": 0.2, "timeLimit": 2.0},
        "baseline": {
            "damping": 0.05,
            "gain": 5.0,
            "maxJointSpeed": DELTA_SCALE * CONTROL_HZ,
            "nullspaceGain": 0.5,
            "reachStandoff": 0.02,
            "neutralPose": neutral.round(6).tolist(),
        },
    }


POLICY_BIN = "policy/reach.bin"
POLICY_JSON = "policy/reach.json"
RUNS = SHARED.parent / "training" / "runs"


def policy_layers(model) -> list[tuple[np.ndarray, np.ndarray]]:
    """(W out x in, b) for each layer of the deterministic actor: 2 hidden tanh + linear."""
    net = model.policy.mlp_extractor.policy_net
    linears = [m for m in net if hasattr(m, "weight")] + [model.policy.action_net]
    return [
        (m.weight.detach().cpu().numpy().astype(np.float64), m.bias.detach().cpu().numpy())
        for m in linears
    ]


def export_policy(parity: dict, run: Path) -> dict:
    """Write normalization into parity, and shared/policy/reach.{bin,json}."""
    import pickle

    from stable_baselines3 import PPO

    model = PPO.load(run / "model.zip", device="cpu")
    with open(run / "vecnormalize.pkl", "rb") as f:
        vecnorm = pickle.load(f)
    rms = vecnorm.obs_rms
    size = parity["observation"]["size"]
    if rms.mean.shape != (size,):
        raise SystemExit(f"run observation size {rms.mean.shape} != parity.json {size}")
    parity["observation"]["normalization"] = {
        "mean": rms.mean.tolist(),
        "std": np.sqrt(rms.var + vecnorm.epsilon).tolist(),
        "clip": float(vecnorm.clip_obs),
        "eps": float(vecnorm.epsilon),
    }

    layers = policy_layers(model)
    blob = b"".join(np.concatenate([w.ravel(), b]).astype("<f4").tobytes() for w, b in layers)
    (SHARED / "policy").mkdir(exist_ok=True)
    (SHARED / POLICY_BIN).write_bytes(blob)
    config = json.loads((run / "config.json").read_text())
    header = {
        "format": 1,
        "parityVersion": parity["version"],
        "activation": "tanh",
        "outputActivation": "clip",
        "layers": [{"in": int(w.shape[1]), "out": int(w.shape[0])} for w, _ in layers],
        "dtype": "float32-le",
        "sha256": sha256_file(SHARED / POLICY_BIN),
        "trainedWith": {
            "algo": "PPO",
            "steps": config["steps"],
            "seed": config["seed"],
            "run": run.name,
            "reward": config["reward"],
        },
    }
    (SHARED / POLICY_JSON).write_text(json.dumps(header, indent=2) + "\n")
    parity["policy"] = {"path": POLICY_BIN, "header": POLICY_JSON, "sha256": header["sha256"]}
    return parity


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-policy", action="store_true", help="write parity.json without a policy")
    ap.add_argument("--run", type=str, help="training run id under training/runs/")
    args = ap.parse_args()
    if not args.no_policy and not args.run:
        raise SystemExit("pass --run <id> (or --no-policy)")
    model = load_model()
    parity = base_parity(model)
    if not args.no_policy:
        parity = export_policy(parity, RUNS / args.run)
    write_parity(parity)
    print(
        f"wrote shared/parity.json: maxReach={parity['reach']['maxReach']:.3f} m, "
        f"workspace dims={parity['reach']['workspace']['dims']}"
        + (f", policy from {args.run}" if args.run else "")
    )


if __name__ == "__main__":
    main()
