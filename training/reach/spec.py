"""Read, write and validate shared/parity.json (contracts/parity-json.md).

Training is the only writer of parity.json; every other consumer reads it.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

SHARED = Path(__file__).resolve().parents[2] / "shared"
PARITY_PATH = SHARED / "parity.json"
MODEL_PATH = "robot/so100.xml"
PARITY_VERSION = 4


class ParityError(ValueError):
    pass


def model_files(shared: Path = SHARED) -> list[str]:
    """The XML plus every asset it can reference, as sorted paths relative to shared/."""
    assets = sorted(
        str(p.relative_to(shared)) for p in (shared / "robot" / "assets").iterdir() if p.is_file()
    )
    return sorted([MODEL_PATH, *assets])


def sha256_model(files: list[str], shared: Path = SHARED) -> str:
    """SHA-256 over sorted `path\\0bytes\\0` records (same algorithm as web/src/sim/hash.ts)."""
    h = hashlib.sha256()
    for rel in sorted(files):
        h.update(rel.encode())
        h.update(b"\0")
        h.update((shared / rel).read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate(p: dict[str, Any]) -> None:
    if p.get("version") != PARITY_VERSION:
        raise ParityError(f"unsupported parity.json version {p.get('version')}")
    if abs(p["timestep"] * p["substeps"] - 1.0 / p["controlHz"]) > 1e-12:
        raise ParityError("timestep * substeps must equal 1 / controlHz")
    obs = p["observation"]
    if obs["size"] != sum(f["size"] for f in obs["fields"]):
        raise ParityError("observation.size must equal the sum of field sizes")
    act = p["action"]
    if not set(act["joints"]) <= set(p["joints"]):
        raise ParityError("action.joints must be a subset of joints")
    if act["size"] != len(act["joints"]):
        raise ParityError("action.size must equal the number of action.joints")
    norm = obs.get("normalization")
    if norm is not None and not (len(norm["mean"]) == len(norm["std"]) == obs["size"]):
        raise ParityError("normalization mean/std must have observation.size entries")
    g = p["gripper"]
    if not g["closed"] < g["open"]:
        raise ParityError("gripper.closed must be below gripper.open")
    reg = p["grasp"]["region"]
    if not 0 <= reg["rMin"] < reg["rMax"] <= p["reach"]["maxReach"]:
        raise ParityError("grasp.region needs 0 <= rMin < rMax <= reach.maxReach")
    if not 0 < reg["maxAngle"] <= math.pi / 2:
        raise ParityError("grasp.region.maxAngle must be in (0, pi/2]")
    if not in_region(p["cube"]["defaultPose"]["pos"], reg):
        raise ParityError("cube.defaultPose must be inside grasp.region")
    gp = p.get("graspPolicy")
    if gp is not None:
        validate_grasp_policy(p, gp)


def validate_grasp_policy(p: dict[str, Any], gp: dict[str, Any]) -> None:
    """004 contracts/grasp-policy.md. Layer sizes and the weights hash are checked on export and
    in the parity tests (they need the policy files)."""
    obs, act = gp["observation"], gp["action"]
    if obs["size"] != sum(f["size"] for f in obs["fields"]):
        raise ParityError("graspPolicy.observation.size must equal the sum of field sizes")
    norm = obs["normalization"]
    if not len(norm["mean"]) == len(norm["std"]) == obs["size"]:
        raise ParityError("graspPolicy normalization mean/std must have observation.size entries")
    if not set(act["joints"]) <= set(p["joints"]):
        raise ParityError("graspPolicy.action.joints must be a subset of joints")
    if act["size"] != len(act["joints"]) + 1 or act["gripperIndex"] != len(act["joints"]):
        raise ParityError("graspPolicy.action: one output per joint, then the gripper")
    want = p["baseline"]["maxJointSpeed"] / p["controlHz"]
    if abs(act["deltaScale"] - want) > 1e-12:
        raise ParityError("graspPolicy.action.deltaScale must equal maxJointSpeed / controlHz")


def in_region(pos: list[float], reg: dict[str, Any]) -> bool:
    """Same test as web/src/sim/cube.ts inRegion: annulus sector opening toward -y."""
    dx, dy = pos[0] - reg["center"][0], pos[1] - reg["center"][1]
    r = math.hypot(dx, dy)
    return reg["rMin"] <= r <= reg["rMax"] and abs(math.atan2(dx, -dy)) <= reg["maxAngle"]


def load_parity(path: Path = PARITY_PATH) -> dict[str, Any]:
    p = json.loads(path.read_text())
    validate(p)
    return p


def write_parity(p: dict[str, Any], path: Path = PARITY_PATH) -> None:
    validate(p)
    path.write_text(json.dumps(p, indent=2) + "\n")
