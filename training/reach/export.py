"""Write shared/parity.json (and, with a trained run, the policy artifacts).

uv run python -m reach.export --no-policy      # P1/P2: no training needed
"""

from __future__ import annotations

import argparse

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
TIMESTEP = 0.002
SUBSTEPS = 10
CONTROL_HZ = 50
DELTA_SCALE = 0.05
MIN_Z = 0.01
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
    ws_pts = ws_pts[ws_pts[:, 2] >= MIN_Z]
    grid, origin, dims = build_workspace(ws_pts)
    packed = np.packbits(grid.ravel(), bitorder="little")
    (SHARED / WORKSPACE_PATH).write_bytes(packed.tobytes())

    lim = joint_limits(model)
    neutral = lim.mean(axis=1)

    files = model_files()
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
        "action": {"size": len(JOINTS), "low": -1.0, "high": 1.0, "deltaScale": DELTA_SCALE},
        "observation": {
            "size": 21,
            "fields": [
                {"name": "q", "size": 5, "label": "Joint angles", "unit": "rad"},
                {"name": "qd", "size": 5, "label": "Joint speeds", "unit": "rad/s"},
                {"name": "target", "size": 3, "label": "Target position", "unit": "m"},
                {"name": "tipToTarget", "size": 3, "label": "Tip → target", "unit": "m"},
                {"name": "prevAction", "size": 5, "label": "Previous command", "unit": ""},
            ],
        },
        "reach": {
            "maxReach": round(max_reach, 6),
            "margin": 0.01,
            "hysteresis": 0.005,
            "minZ": MIN_Z,
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
            "neutralPose": neutral.round(6).tolist(),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-policy", action="store_true", help="write parity.json without a policy")
    args = ap.parse_args()
    if not args.no_policy:
        raise SystemExit("policy export is implemented in P3 (tasks T060); use --no-policy")
    model = load_model()
    parity = base_parity(model)
    write_parity(parity)
    print(
        f"wrote shared/parity.json: maxReach={parity['reach']['maxReach']:.3f} m, "
        f"workspace dims={parity['reach']['workspace']['dims']}"
    )


if __name__ == "__main__":
    main()
