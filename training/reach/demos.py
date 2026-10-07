"""Grasp demonstration files (004 contracts/demo-file.md): read, check, replay.

Files come from the browser's recording mode (`?record`) or `npm run demos`
(web/src/sim/recorder.ts). They hold raw simulator state only; this module turns them back into
trajectories and checks that the training simulation reproduces them (research R9, SC-005).

    uv run python -m reach.demos check demos/hand.demos.jsonl.gz
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from reach.spec import SHARED, load_parity

KIND = "sim2browser-demos"
FORMAT = 1
#: State differences above this are reported (contract: the outcome must match; the difference is
#: reported). Contact events occasionally turn 1e-11 into visible differences (validation.md).
REPLAY_TOL = 1e-6
#: Disjointness from the evaluation placements (FR-018): position (m) and yaw mod pi/2 (rad).
NEAR_POS, NEAR_YAW = 0.002, 0.02


class DemoError(ValueError):
    pass


def _canonical_numbers(x: Any) -> Any:
    """JSON numbers as JavaScript prints them: integral floats without '.0'."""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    if isinstance(x, dict):
        return {k: _canonical_numbers(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_canonical_numbers(v) for v in x]
    return x


def canonical_json(x: Any) -> str:
    """Same bytes as recorder.ts canonicalJson: sorted keys, no whitespace."""
    return json.dumps(_canonical_numbers(x), sort_keys=True, separators=(",", ":"))


def sim_sha256(p: dict) -> str:
    """Identity of the physics the demonstrations depend on (contracts/demo-file.md)."""
    subset = {
        "model": {"sha256": p["model"]["sha256"]},
        "mujocoVersion": p["mujocoVersion"],
        "timestep": p["timestep"],
        "substeps": p["substeps"],
        "controlHz": p["controlHz"],
        "gripper": p["gripper"],
        "cube": p["cube"],
    }
    return hashlib.sha256(canonical_json(subset).encode()).hexdigest()


def read(path: Path | str, p: dict | None = None) -> tuple[dict, Iterator[dict]]:
    """Header and a lazy iterator over episodes. Rejects files recorded on other physics."""
    p = p or load_parity()
    f = gzip.open(path, "rt", encoding="utf-8")
    header = json.loads(f.readline())
    for key, want in (("kind", KIND), ("format", FORMAT), ("simSha256", sim_sha256(p))):
        if header.get(key) != want:
            f.close()
            raise DemoError(
                f"{path}: header {key} is {header.get(key)!r}, expected {want!r}"
                + (" (recorded on different physics)" if key == "simSha256" else "")
            )

    def episodes() -> Iterator[dict]:
        with f:
            for line in f:
                if line.strip():
                    yield json.loads(line)

    return header, episodes()


# --- grasp success, as web/src/sim/graspAttempt.ts createAttemptJudge -------------------------


class Judge:
    def __init__(self, p: dict, cube_xy: np.ndarray, time_limit: float) -> None:
        s = p["grasp"]["success"]
        self.lift_z = p["cube"]["size"] / 2 + s["liftCheck"]
        self.hold, self.limit = s["hold"], time_limit
        self.knocked = p["grasp"]["knockedDistance"]
        self.xy0 = cube_xy.copy()
        self.since: float | None = None
        self.lift_time: float | None = None
        self.held_ever = False
        self.travel = 0.0
        self.failure: str | None = None

    def update(self, t: float, cube_pos: np.ndarray, held: bool) -> None:
        if self.failure is not None or self.lift_time is not None:
            return
        self.held_ever |= held
        self.travel = max(self.travel, float(np.hypot(*(cube_pos[:2] - self.xy0))))
        if held and cube_pos[2] >= self.lift_z:
            if self.since is None:
                self.since = t
        else:
            self.since = None
        if self.since is not None and t - self.since >= self.hold - 1e-9:
            if t <= self.limit + 1e-9:
                self.lift_time = self.since
                return
        if t > self.limit + 1e-9:
            self.failure = (
                "timeout"
                if held
                else "slipped"
                if self.held_ever
                else "knocked"
                if self.travel > self.knocked
                else "missed"
            )

    def outcome(self) -> dict:
        if self.lift_time is not None:
            return {"success": True, "timeToLift": self.lift_time, "failure": None}
        return {"success": False, "timeToLift": None, "failure": self.failure}


class Replayer:
    """Replays episodes on the training model."""

    def __init__(self, p: dict | None = None) -> None:
        self.p = p or load_parity()
        self.m = mujoco.MjModel.from_xml_path(str(SHARED / self.p["model"]["path"]))
        self.d = mujoco.MjData(self.m)
        cube = self.p["cube"]
        self.cube_adr = self.m.joint(cube["joint"]).qposadr[0]
        self.cube_body = self.m.body(cube["body"]).id
        self.jaws = {self.m.body("Fixed_Jaw").id, self.m.body("Moving_Jaw").id}
        self.substeps = self.p["substeps"]
        self.hz = self.p["controlHz"]

    def held(self) -> bool:
        """Both jaws touch the cube (session.ts cubeHeld)."""
        touching = set()
        gb = self.m.geom_bodyid
        for i in range(self.d.ncon):
            c = self.d.contact[i]
            b1, b2 = gb[c.geom1], gb[c.geom2]
            if b1 == self.cube_body and b2 in self.jaws:
                touching.add(b2)
            elif b2 == self.cube_body and b1 in self.jaws:
                touching.add(b1)
        return touching == self.jaws

    def states(self, ep: dict) -> Iterator[tuple[int, mujoco.MjData]]:
        """Set the start state and apply each step's ctrl; yields (k, data) after each step."""
        d = self.d
        mujoco.mj_resetData(self.m, d)
        st = ep["start"]
        d.qpos[:], d.qvel[:], d.ctrl[:] = st["qpos"], st["qvel"], st["ctrl"]
        mujoco.mj_forward(self.m, d)
        for k, step in enumerate(ep["steps"]):
            d.ctrl[:] = step["ctrl"]
            for _ in range(self.substeps):
                mujoco.mj_step(self.m, d)
            yield k, d

    def replay(self, ep: dict) -> dict:
        """Max state difference to the recording and the outcome judged in Python."""
        cube0 = np.array(ep["start"]["qpos"][self.cube_adr : self.cube_adr + 2])
        judge = Judge(self.p, cube0, ep["timeLimit"])
        dq = dv = 0.0
        for k, d in self.states(ep):
            step = ep["steps"][k]
            dq = max(dq, float(np.abs(d.qpos - step["qpos"]).max()))
            dv = max(dv, float(np.abs(d.qvel - step["qvel"]).max()))
            cube = d.qpos[self.cube_adr : self.cube_adr + 3]
            judge.update((k + 1) / self.hz, cube, self.held())
        out = judge.outcome()
        rec = ep["outcome"]
        if not out["success"] and out["failure"] is None and rec["failure"] is not None:
            # Ended before the time limit by a failure the grasp controller reported itself, or by
            # the demonstrator (cancelled): Python can only confirm the cube was not lifted.
            out["failure"] = rec["failure"]
        return {"max_dqpos": dq, "max_dqvel": dv, "outcome": out}


def same_outcome(a: dict, b: dict) -> bool:
    """Lifted or not (spec SC-005). Failure labels are not compared: a grasp controller may report
    its own (e.g. the scripted grasp's timeout), which Python cannot see."""
    return a["success"] == b["success"]


def same_lift_time(a: dict, b: dict) -> bool:
    """Reported, not required: a contact event that amplifies the engines' tiny differences can
    shift the lift by a control step or a few (validation.md)."""
    return not a["success"] or abs(a["timeToLift"] - b["timeToLift"]) < 1e-9


# --- grasp policy inputs and labels (research R4/R5, contracts/grasp-policy.md) ----------------

#: Written to parity.json graspPolicy.observation.fields by export.py; the browser reads it there.
GRASP_OBS_FIELDS = [
    {"name": "q", "size": 5, "label": "Joint angles", "unit": "rad"},
    {"name": "qd", "size": 5, "label": "Joint speeds", "unit": "rad/s"},
    {"name": "jaw", "size": 1, "label": "Jaw angle", "unit": "rad"},
    {"name": "tip", "size": 3, "label": "Tip position", "unit": "m"},
    {"name": "cube", "size": 3, "label": "Cube position", "unit": "m"},
    {"name": "cubeToTip", "size": 3, "label": "Cube → tip", "unit": "m"},
    {"name": "cubeYaw4", "size": 2, "label": "Cube turn (sin, cos ×4)", "unit": ""},
    {"name": "relYaw4", "size": 2, "label": "Cube vs. jaws (sin, cos ×4)", "unit": ""},
    {"name": "faceYaw4", "size": 2, "label": "Cube vs. jaws facing it (sin, cos ×4)", "unit": ""},
    {"name": "prevAction", "size": 6, "label": "Previous command", "unit": ""},
]
GRASP_OBS_SIZE = sum(f["size"] for f in GRASP_OBS_FIELDS)
GRASP_ACTION_SIZE = 6  # 5 joint-target changes, then the gripper


def cube_yaw(quat: np.ndarray) -> float:
    """Same as web/src/sim/cube.ts cubeYaw (MuJoCo quaternion w, x, y, z)."""
    w, x, y, z = quat
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


class GraspObs:
    """The grasp policy's observation from raw state (mirrors observation.ts buildGraspObs)."""

    def __init__(self, p: dict, model: mujoco.MjModel | None = None) -> None:
        self.p = p
        self.m = model or mujoco.MjModel.from_xml_path(str(SHARED / p["model"]["path"]))
        self.d = mujoco.MjData(self.m)
        self.qadr = np.array([self.m.joint(j).qposadr[0] for j in p["joints"]])
        self.dadr = np.array([self.m.joint(j).dofadr[0] for j in p["joints"]])
        self.jaw = self.m.joint(p["gripper"]["joint"]).qposadr[0]
        self.cube = self.m.joint(p["cube"]["joint"]).qposadr[0]
        self.tip = self.m.site(p["tipSite"]).id
        self.aid = np.array([self.m.actuator(j).id for j in p["joints"]])
        self.roll_offset = p["grasp"]["rollOffset"]
        self.base = p["reach"]["baseAxisXY"]

    def __call__(self, qpos, qvel, prev_action) -> np.ndarray:
        d = self.d
        d.qpos[:] = qpos
        mujoco.mj_kinematics(self.m, d)
        q = d.qpos[self.qadr]
        tip = d.site_xpos[self.tip].copy()
        cube = d.qpos[self.cube : self.cube + 3]
        yaw = cube_yaw(d.qpos[self.cube + 3 : self.cube + 7])
        rel = yaw - (q[0] + q[4] - self.roll_offset)
        bearing = math.atan2(cube[0] - self.base[0], -(cube[1] - self.base[1]))
        face = yaw - (bearing + q[4] - self.roll_offset)
        values = {
            "q": q,
            "qd": np.asarray(qvel)[self.dadr],
            "jaw": [d.qpos[self.jaw]],
            "tip": tip,
            "cube": cube,
            "cubeToTip": tip - cube,
            "cubeYaw4": [math.sin(4 * yaw), math.cos(4 * yaw)],
            "relYaw4": [math.sin(4 * rel), math.cos(4 * rel)],
            "faceYaw4": [math.sin(4 * face), math.cos(4 * face)],
            "prevAction": prev_action,
        }
        out = []
        for f in GRASP_OBS_FIELDS:
            v = np.asarray(values[f["name"]], dtype=np.float64)
            if v.shape != (f["size"],):
                raise ValueError(f"observation field {f['name']}: bad size")
            out.append(v)
        return np.concatenate(out)


def episode_samples(ep: dict, obs: GraspObs, delta_scale: float) -> tuple[np.ndarray, ...]:
    """(observations, labels, usable) for each control step of one episode.

    The observation of step k is built from the state the step started from, with the driving
    controller's previous output as `prevAction` (zeros at k = 0), exactly as the browser
    controller sees it: the recorded `action` (DAgger episodes, where a learned policy drove), else
    the previous label. Labels: the recorded `intent` (noise-injected or DAgger episodes), else the
    applied joint-target change / deltaScale clipped to [-1, 1]; the gripper label is `gripIntent`
    (DAgger) or the gripper command, +1 closed, -1 open. A step whose applied change exceeds the
    per-step limit (a joint dragged by hand) is not usable as a label.
    """
    n = len(ep["steps"])
    X = np.empty((n, GRASP_OBS_SIZE))
    Y = np.empty((n, GRASP_ACTION_SIZE))
    usable = np.ones(n, dtype=bool)
    qpos, qvel = ep["start"]["qpos"], ep["start"]["qvel"]
    ctrl_prev = np.asarray(ep["start"]["ctrl"])[obs.aid]
    prev = np.zeros(GRASP_ACTION_SIZE)
    for k, st in enumerate(ep["steps"]):
        X[k] = obs(qpos, qvel, prev)
        ctrl = np.asarray(st["ctrl"])[obs.aid]
        if "intent" in st:
            joints = np.asarray(st["intent"])
        else:
            raw = (ctrl - ctrl_prev) / delta_scale
            usable[k] = bool(np.all(np.abs(raw) <= 1 + 1e-6))
            joints = np.clip(raw, -1, 1)
        Y[k, :5] = joints
        Y[k, 5] = 1.0 if st.get("gripIntent", st["grip"]) else -1.0
        prev = np.asarray(st["action"]) if "action" in st else Y[k]
        qpos, qvel, ctrl_prev = st["qpos"], st["qvel"], ctrl
    return X, Y, usable


# --- placements, as web/src/sim/eval.ts -------------------------------------------------------


def mulberry32(seed: int):
    s = seed & 0xFFFFFFFF

    def rand() -> float:
        nonlocal s
        s = (s + 0x6D2B79F5) & 0xFFFFFFFF
        t = s
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand


def grasp_placements(p: dict, n: int, seed: int) -> list[dict]:
    rand = mulberry32(seed)
    reg = p["grasp"]["region"]
    cx, cy = reg["center"]
    out = []
    for _ in range(n):
        r = math.sqrt(reg["rMin"] ** 2 + rand() * (reg["rMax"] ** 2 - reg["rMin"] ** 2))
        a = (2 * rand() - 1) * reg["maxAngle"]
        yaw = rand() * math.pi / 2
        out.append({"pos": [cx + r * math.sin(a), cy - r * math.cos(a)], "yaw": yaw})
    return out


def near(a: dict, b: dict) -> bool:
    """Same placement within NEAR_POS and NEAR_YAW (yaw modulo the cube's quarter-turn symmetry)."""
    dyaw = (a["yaw"] - b["yaw"]) % (math.pi / 2)
    dyaw = min(dyaw, math.pi / 2 - dyaw)
    return math.dist(a["pos"], b["pos"]) <= NEAR_POS and dyaw <= NEAR_YAW


def overlapping(episodes: list[dict], p: dict, n: int = 100, seed: int = 0) -> list[str]:
    """Ids of episodes starting at (or next to) an evaluation placement (FR-018)."""
    evals = grasp_placements(p, n, seed)
    return [e["id"] for e in episodes if any(near(e["placement"], q) for q in evals)]


# --- CLI ----------------------------------------------------------------------------------------


def check(path: Path, p: dict | None = None) -> bool:
    p = p or load_parity()
    header, episodes = read(path, p)
    rp = Replayer(p)
    print(f"{path}: {header['generator']} ({header['created']}), counts {header['counts']}")
    ok = True
    worst = 0.0
    diverged = shifted = 0
    eps = []
    for ep in episodes:
        eps.append({"id": ep["id"], "placement": ep["placement"]})
        r = rp.replay(ep)
        diff = max(r["max_dqpos"], r["max_dqvel"])
        same = same_outcome(r["outcome"], ep["outcome"])
        on_time = same_lift_time(r["outcome"], ep["outcome"])
        shifted += same and not on_time
        diverged += diff > REPLAY_TOL
        worst = max(worst, diff)
        flag = "" if same else "  <-- outcome differs"
        flag += "  (diff > 1e-6)" if diff > REPLAY_TOL else ""
        flag += "  (lift time differs)" if same and not on_time else ""
        print(
            f"  {ep['id']:>16} {ep['source']:>8} {len(ep['steps']):5d} steps  "
            f"{'lifted' if ep['outcome']['success'] else ep['outcome']['failure']:>9}  "
            f"max diff {diff:.1e}{flag}"
        )
        ok &= same
    bad = overlapping(eps, p)
    if bad:
        print(f"  episodes at evaluation placements (FR-018): {bad}")
        ok = False
    print(
        f"{len(eps)} episodes, {diverged} with a state difference > {REPLAY_TOL:g} "
        f"(worst {worst:.1e}), {shifted} with a different lift time: {'OK' if ok else 'FAILED'}"
    )
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="replay every episode and compare")
    c.add_argument("files", nargs="+", type=Path)
    args = ap.parse_args()
    ok = all([check(f) for f in args.files])
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
