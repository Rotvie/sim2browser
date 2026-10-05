"""Model-derived values for the scripted grasp (research R4/R5), written into parity.json `grasp`.

The grasp controller itself lives in web/src/control/grasp.ts; this module only measures the
model so the controller needs no hand-entered geometry:

- verticalOffset: Pitch, Elbow and Wrist_Pitch turn about parallel axes, so the fingers point
  straight down when Wrist_Pitch = verticalOffset - Pitch - Elbow.
- rollOffset: with the fingers down, the jaw closing axis has yaw
  Rotation + Wrist_Roll - rollOffset, so Wrist_Roll = rollOffset + cubeYaw - Rotation lines the
  jaws up with two cube faces.
- fixedJawOffset: only one jaw moves. The tip target is the cube centre plus fixedJawOffset along
  the closing axis, so the fixed pad comes down just outside its cube face.
- region: the floor annulus sector where a top-down grasp and its approach point are reachable
  within joint limits and without the arm touching the floor.
"""

from __future__ import annotations

import math

import mujoco
import numpy as np

ARM = ["Rotation", "Pitch", "Elbow", "Wrist_Pitch", "Wrist_Roll"]
CLEARANCE = 0.003  # gap between the fixed pad and its cube face on the way down (m)
# The wrist cannot always point the fingers straight down: Wrist_Pitch is clipped to its limit,
# tilting the fingers. Allowed tilt at the grasp point and at the approach point above it (rad).
MAX_TILT_GRASP = 0.03
MAX_TILT_APPROACH = 0.2
RADIAL_STEP = 0.005


def _circ_mean(a: np.ndarray) -> float:
    return float(np.angle(np.mean(np.exp(1j * a))))


def _wrap(a: np.ndarray | float) -> np.ndarray | float:
    return np.angle(np.exp(1j * np.asarray(a)))


class Arm:
    def __init__(self, model: mujoco.MjModel) -> None:
        self.m = model
        self.d = mujoco.MjData(model)
        self.qadr = np.array([model.joint(j).qposadr[0] for j in ARM])
        self.dadr = np.array([model.joint(j).dofadr[0] for j in ARM])
        self.lim = np.array([model.joint(j).range for j in ARM])
        self.jaw = model.joint("Jaw").qposadr[0]
        self.cube = model.joint("cube").qposadr[0]
        self.fixed_jaw = model.body("Fixed_Jaw").id
        self.tip = model.site("tip").id
        self.jac = np.zeros((3, model.nv))
        self.floor = model.geom("floor").id
        self.cube_geom = model.geom("cube").id

    def pose(self, q: np.ndarray, jaw: float = 0.0, cube_away: bool = False) -> None:
        d = self.d
        d.qpos[:] = self.m.qpos0
        d.qpos[self.qadr] = q
        d.qpos[self.jaw] = jaw
        if cube_away:
            d.qpos[self.cube : self.cube + 3] = [10.0, 10.0, 0.015]
        mujoco.mj_kinematics(self.m, d)
        mujoco.mj_comPos(self.m, d)

    def frame(self) -> tuple[np.ndarray, np.ndarray]:
        """(closing axis, finger direction) in world: Fixed_Jaw +x and -y."""
        r = self.d.xmat[self.fixed_jaw].reshape(3, 3)
        return r[:, 0].copy(), -r[:, 1].copy()


def wrist_offsets(arm: Arm, seed: int = 0) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    # Finger elevation (from forward, -y, in the Rotation = 0 plane) = -(P + E + W) + c.
    pew, elev = [], []
    for _ in range(50):
        q = np.array([0.0, rng.uniform(-1.5, 0.1), rng.uniform(0, 3), rng.uniform(-1.5, 1.5), 0])
        arm.pose(q)
        _, f = arm.frame()
        pew.append(q[1] + q[2] + q[3])
        elev.append(math.atan2(f[2], -f[1]))
    c = _circ_mean(np.array(elev) + np.array(pew))
    resid = np.abs(_wrap(np.array(elev) + np.array(pew) - c)).max()
    assert resid < 1e-9, f"finger elevation is not -(P+E+W)+c (residual {resid})"
    vertical = math.pi / 2 + c

    # Closing-axis yaw with fingers down = Rotation + Wrist_Roll + c2.
    yaw, rr = [], []
    for _ in range(50):
        r, roll, p, e = rng.uniform(-1.5, 1.5), rng.uniform(-2.5, 2.5), -1.0, 1.5
        arm.pose(np.array([r, p, e, vertical - p - e, roll]))
        x, f = arm.frame()
        assert f[2] < -1 + 1e-9, "verticalOffset does not point the fingers down"
        yaw.append(math.atan2(x[1], x[0]))
        rr.append(r + roll)
    c2 = _circ_mean(np.array(yaw) - np.array(rr))
    resid = np.abs(_wrap(np.array(yaw) - np.array(rr) - c2)).max()
    assert resid < 1e-9, f"closing-axis yaw is not Rotation + Wrist_Roll + c (residual {resid})"
    return vertical, float(_wrap(-c2))


def fixed_jaw_offset(model: mujoco.MjModel, cube_half: float) -> float:
    pad = model.geom("fixed_jaw_pad_1")
    moving = model.geom("moving_jaw_pad_1")
    # The moving jaw sits on the -x side of Fixed_Jaw (its body is turned by pi about y).
    mj = model.body("Moving_Jaw")
    rot = np.zeros(9)
    mujoco.mju_quat2Mat(rot, mj.quat)
    moving_x = mj.pos[0] + (rot.reshape(3, 3) @ moving.pos)[0]
    assert moving_x < 0 < pad.pos[0], "expected the moving jaw on the -x side"
    inner = pad.pos[0] - pad.size[0]  # inner face of the fingertip pad, Fixed_Jaw frame
    cube_x = inner - cube_half - CLEARANCE  # cube centre in Fixed_Jaw x; the tip is at x = 0
    return round(float(-cube_x), 6)


def wrist_pitch(arm: Arm, vertical: float, q3: np.ndarray) -> tuple[float, bool]:
    """Wrist_Pitch for fingers down, clipped to its limits (as the browser's Arm clips it)."""
    w = vertical - q3[1] - q3[2]
    wc = float(np.clip(w, arm.lim[3, 0], arm.lim[3, 1]))
    return wc, wc == w


def full_pose(arm: Arm, vertical: float, q3: np.ndarray) -> np.ndarray:
    return np.array([q3[0], q3[1], q3[2], wrist_pitch(arm, vertical, q3)[0], 0.0])


def topdown_ik(
    arm: Arm, target: np.ndarray, vertical: float, q0: np.ndarray, max_tilt: float
) -> np.ndarray | None:
    """Rotation, Pitch, Elbow putting the tip on `target` with the fingers down (tilted at most
    `max_tilt` where the wrist limit bites), or None."""
    q = q0.copy()
    lim = arm.lim
    for _ in range(300):
        arm.pose(full_pose(arm, vertical, q))
        e = target - arm.d.site_xpos[arm.tip]
        if np.linalg.norm(e) < 1e-5:
            break
        mujoco.mj_jacSite(arm.m, arm.d, arm.jac, None, arm.tip)
        j = arm.jac[:, arm.dadr]
        jw = j[:, 3] if wrist_pitch(arm, vertical, q)[1] else 0 * j[:, 3]
        jeff = np.stack([j[:, 0], j[:, 1] - jw, j[:, 2] - jw], axis=1)
        dq = jeff.T @ np.linalg.solve(jeff @ jeff.T + 1e-4 * np.eye(3), e)
        q = np.clip(q + np.clip(dq, -0.2, 0.2), lim[:3, 0], lim[:3, 1])
    arm.pose(full_pose(arm, vertical, q))
    if np.linalg.norm(target - arm.d.site_xpos[arm.tip]) > 1e-3:
        return None
    if abs(vertical - q[1] - q[2] - wrist_pitch(arm, vertical, q)[0]) > max_tilt:
        return None
    return q


def touches(arm: Arm, q3: np.ndarray, vertical: float, jaw: float) -> bool:
    """Arm (gripper open) in contact with the floor, with the cube out of the way. (The arm does
    not collide with itself: so100.xml collision class.)"""
    full = full_pose(arm, vertical, q3)
    d = arm.d
    d.qpos[:] = arm.m.qpos0
    d.qpos[arm.qadr] = full
    d.qpos[arm.jaw] = jaw
    d.qpos[arm.cube : arm.cube + 3] = [10.0, 10.0, 1.0]
    mujoco.mj_fwdPosition(arm.m, d)
    return any(d.contact[i].dist < -1e-4 for i in range(d.ncon))


def feasible(arm, xy, z_grasp, z_approach, vertical, jaw_open, q0):
    """Both the grasp point and the approach point above it; returns a warm start or None."""
    q = q0
    for z, tilt in ((z_approach, MAX_TILT_APPROACH), (z_grasp, MAX_TILT_GRASP)):
        q = topdown_ik(arm, np.array([xy[0], xy[1], z]), vertical, q, tilt)
        if q is None or touches(arm, q, vertical, jaw_open):
            return None
    return q


def grasp_region(
    model: mujoco.MjModel,
    base_xy: list[float],
    vertical: float,
    cube_half: float,
    approach_height: float,
    jaw_open: float,
    max_reach: float,
    front_margin: float,
    min_radius: float,
) -> dict:
    arm = Arm(model)
    bx, by = base_xy
    z_grasp, z_approach = cube_half, cube_half + approach_height
    q0 = np.array([0.0, -1.0, 1.5])

    def at(r: float, theta: float, q):
        return feasible(
            arm,
            (bx + r * math.sin(theta), by - r * math.cos(theta)),
            z_grasp,
            z_approach,
            vertical,
            jaw_open,
            q,
        )

    radii = np.arange(min_radius, max_reach, RADIAL_STEP)
    ok, q = [], q0
    for r in radii:
        sol = at(r, 0.0, q)
        ok.append(sol is not None)
        q = sol if sol is not None else q0
    # Longest run of feasible radii.
    best, start = (0, 0), None
    for i, f in enumerate([*ok, False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start > best[1] - best[0]:
                best = (start, i)
            start = None
    if best[1] - best[0] < 2:
        raise SystemExit("no top-down grasp region found")
    r_min, r_max = float(radii[best[0]]), float(radii[best[1] - 1])

    # Widest angle (symmetric) at which the band's edges and middle stay feasible.
    theta = min(math.pi / 2, math.acos(min(1.0, front_margin / r_min)))
    while theta > 0.05:
        if all(
            at(r, s * theta, q0) is not None
            for r in (r_min, 0.5 * (r_min + r_max), r_max)
            for s in (1, -1)
        ):
            break
        theta -= 0.05
    return {
        "center": [round(bx, 6), round(by, 6)],
        "rMin": round(r_min, 4),
        "rMax": round(r_max, 4),
        "maxAngle": round(theta, 4),
    }
