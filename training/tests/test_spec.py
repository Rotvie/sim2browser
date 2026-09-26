import copy

import mujoco
import numpy as np
import pytest

from reach.spec import SHARED, ParityError, load_parity, sha256_file, sha256_model, validate


@pytest.fixture(scope="module")
def parity():
    return load_parity()


def test_round_trip_is_valid(parity):
    validate(copy.deepcopy(parity))


def test_bad_timestep_product_rejected(parity):
    bad = copy.deepcopy(parity)
    bad["substeps"] = 7
    with pytest.raises(ParityError):
        validate(bad)


def test_wrong_observation_size_rejected(parity):
    bad = copy.deepcopy(parity)
    bad["observation"]["size"] = 20
    with pytest.raises(ParityError):
        validate(bad)


def test_reach_and_hashes(parity):
    assert parity["reach"]["maxReach"] > 0
    assert sha256_model(parity["model"]["files"]) == parity["model"]["sha256"]
    ws = parity["reach"]["workspace"]
    assert sha256_file(SHARED / ws["path"]) == ws["sha256"]


def test_joint_names_exist_in_model(parity):
    model = mujoco.MjModel.from_xml_path(str(SHARED / parity["model"]["path"]))
    for name in parity["joints"]:
        assert model.joint(name).id >= 0
    assert model.nu == len(parity["joints"])


def test_workspace_contains_neutral_tip(parity):
    model = mujoco.MjModel.from_xml_path(str(SHARED / parity["model"]["path"]))
    data = mujoco.MjData(model)
    data.qpos[:] = parity["baseline"]["neutralPose"]
    mujoco.mj_kinematics(model, data)
    tip = data.site_xpos[model.site("tip").id]
    ws = parity["reach"]["workspace"]
    nx, ny, nz = ws["dims"]
    bits = np.unpackbits(np.fromfile(SHARED / ws["path"], dtype=np.uint8), bitorder="little")
    i, j, k = np.floor((tip - np.array(ws["origin"])) / ws["voxel"]).astype(int)
    assert bits[i + nx * (j + ny * k)] == 1
    assert tip[2] >= parity["reach"]["minZ"]
