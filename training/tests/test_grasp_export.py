"""parity.json v3: gripper, cube and grasp sections from export.py (contracts/parity-json.md)."""

import math

import mujoco
import numpy as np
import pytest

from reach.spec import SHARED, load_parity


@pytest.fixture(scope="module")
def parity():
    return load_parity()


@pytest.fixture(scope="module")
def model(parity):
    return mujoco.MjModel.from_xml_path(str(SHARED / parity["model"]["path"]))


def test_sections_present(parity):
    assert parity["version"] == 3
    assert set(parity["gripper"]) >= {"joint", "actuator", "open", "closed", "maxSpeed", "default"}
    assert set(parity["cube"]) >= {"body", "joint", "size", "defaultPose"}
    g = parity["grasp"]
    for k in [
        "approachHeight",
        "descendSpeed",
        "approachSpeed",
        "liftHeight",
        "liftSpeed",
        "closeSettle",
        "closeTimeout",
        "fixedJawOffset",
        "verticalOffset",
        "rollOffset",
        "knockedDistance",
        "region",
        "success",
    ]:
        assert k in g, k
    assert set(g["success"]) == {"liftCheck", "hold", "timeLimit"}


def test_cube_matches_model(parity, model):
    c = parity["cube"]
    geom = model.geom(c["body"])
    assert math.isclose(c["size"], 2 * geom.size[0])
    np.testing.assert_allclose(model.body(c["body"]).pos, c["defaultPose"]["pos"])


def test_vertical_offset_points_jaws_down(parity, model):
    data = mujoco.MjData(model)
    qadr = [model.joint(j).qposadr[0] for j in parity["joints"]]
    rng = np.random.default_rng(0)
    for _ in range(20):
        r, p, e = rng.uniform(-1, 1), rng.uniform(-1.5, 0), rng.uniform(0.5, 2.5)
        w = parity["grasp"]["verticalOffset"] - p - e
        data.qpos[:] = model.qpos0
        data.qpos[qadr] = [r, p, e, w, rng.uniform(-2, 2)]
        mujoco.mj_kinematics(model, data)
        finger = -data.xmat[model.body("Fixed_Jaw").id].reshape(3, 3)[:, 1]
        assert finger[2] < -1 + 1e-9


def test_region_is_sane(parity):
    reg = parity["grasp"]["region"]
    assert reg["center"] == parity["reach"]["baseAxisXY"]
    assert 0.07 < reg["rMin"] < reg["rMax"] <= parity["reach"]["maxReach"]
    assert reg["rMax"] - reg["rMin"] > 0.08  # a useful band, not a sliver
    assert 0.3 < reg["maxAngle"] <= math.pi / 2
