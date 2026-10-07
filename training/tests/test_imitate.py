"""Behavior cloning and grasp-policy export (004 research R4-R6, contracts/grasp-policy.md).

The Python and TypeScript observations are compared to 1e-9 by the parity fixture
shared/parity/grasp-policy-recorded.json (tests/parity/policy.test.ts); here the Python side is
checked against the definition.
"""

import argparse
import json
import math
import shutil
from pathlib import Path

import numpy as np
import pytest

from reach import demos, imitate
from reach.export import export_grasp_policy
from reach.spec import SHARED, load_parity, validate

TINY = Path(__file__).parent / "data" / "tiny.demos.jsonl.gz"


@pytest.fixture(scope="module")
def parity():
    return load_parity()


@pytest.fixture(scope="module")
def episodes(parity):
    _, eps = demos.read(TINY, parity)
    return list(eps)


def test_observation_definition(parity, episodes):
    obs = demos.GraspObs(parity)
    ep = episodes[0]
    prev = np.array([0.1, 0.2, 0.3, 0.4, 0.5, -1.0])
    st = ep["steps"][50]
    x = obs(st["qpos"], st["qvel"], prev)
    assert x.shape == (32,)
    q = np.asarray(st["qpos"])[obs.qadr]
    np.testing.assert_array_equal(x[:5], q)
    np.testing.assert_array_equal(x[5:10], np.asarray(st["qvel"])[obs.dadr])
    cube = np.asarray(st["qpos"][obs.cube : obs.cube + 3])
    np.testing.assert_allclose(x[17:20], x[11:14] - cube, atol=1e-15)  # cubeToTip = tip - cube
    yaw = demos.cube_yaw(np.asarray(st["qpos"][obs.cube + 3 : obs.cube + 7]))
    assert x[20] == pytest.approx(math.sin(4 * yaw)) and x[21] == pytest.approx(math.cos(4 * yaw))
    rel = yaw - (q[0] + q[4] - parity["grasp"]["rollOffset"])
    assert x[22] == pytest.approx(math.sin(4 * rel)) and x[23] == pytest.approx(math.cos(4 * rel))
    base = parity["reach"]["baseAxisXY"]
    face = yaw - (
        math.atan2(cube[0] - base[0], -(cube[1] - base[1])) + q[4] - parity["grasp"]["rollOffset"]
    )
    assert x[24] == pytest.approx(math.sin(4 * face)) and x[25] == pytest.approx(math.cos(4 * face))
    np.testing.assert_array_equal(x[26:], prev)


def test_labels(parity, episodes):
    obs = demos.GraspObs(parity)
    scale = parity["baseline"]["maxJointSpeed"] / parity["controlHz"]
    clean, noisy = episodes[0], episodes[1]
    X, Y, ok = demos.episode_samples(clean, obs, scale)
    assert ok.all()
    ctrl = np.array([s["ctrl"] for s in clean["steps"]])[:, obs.aid]
    applied = np.diff(np.vstack([np.asarray(clean["start"]["ctrl"])[obs.aid], ctrl]), axis=0)
    np.testing.assert_allclose(Y[:, :5], np.clip(applied / scale, -1, 1), atol=1e-12)
    np.testing.assert_array_equal(Y[:, 5], [1.0 if s["grip"] else -1.0 for s in clean["steps"]])
    np.testing.assert_array_equal(X[0, 26:], 0)  # no previous command at the start
    np.testing.assert_array_equal(X[1:, 26:], Y[:-1])  # then the previous step's label
    _, Yn, _ = demos.episode_samples(noisy, obs, scale)
    np.testing.assert_array_equal(Yn[:, :5], [s["intent"] for s in noisy["steps"]])


def test_a_dragged_joint_is_not_a_label(parity, episodes):
    obs = demos.GraspObs(parity)
    scale = parity["baseline"]["maxJointSpeed"] / parity["controlHz"]
    ep = json.loads(json.dumps(episodes[0]))
    ep["steps"][10]["ctrl"][obs.aid[0]] += 0.5  # a jump no controller makes in one step
    _, _, ok = demos.episode_samples(ep, obs, scale)
    assert not ok[10] and ok[:10].all()


def test_only_lifted_episodes(parity, tmp_path):
    src = tmp_path / TINY.name
    shutil.copy(TINY, src)
    data = imitate.load_samples(src, parity)
    _, eps = demos.read(TINY, parity)
    lifted = [e for e in eps if e["outcome"]["success"]]
    assert int(data["used_scripted"]) == len(lifted)
    assert len(data["X"]) == sum(len(e["steps"]) for e in lifted)
    again = imitate.load_samples(src, parity)  # from the cache
    np.testing.assert_array_equal(again["X"], data["X"])


def test_hand_share_of_batches():
    rng = np.random.default_rng(0)
    hand = np.zeros(10_000, dtype=bool)
    hand[:100] = True  # 1% of the samples
    sampler = imitate.BatchSampler(hand, 0.15, rng)
    share = np.mean([hand[sampler(256)].mean() for _ in range(1000)])
    assert share == pytest.approx(0.15, abs=0.02)
    with pytest.raises(SystemExit):
        imitate.BatchSampler(np.zeros(10, dtype=bool), 0.15, rng)


def test_numpy_forward_matches_torch():
    import torch

    net = imitate.build_mlp(16, 2)
    x = np.random.default_rng(1).normal(size=(4, 32))
    want = np.clip(net(torch.tensor(x, dtype=torch.float32)).detach().numpy(), -1, 1)
    np.testing.assert_allclose(imitate.forward(imitate.mlp_layers(net), x), want, atol=1e-5)


def test_train_and_export(parity, tmp_path, monkeypatch):
    monkeypatch.setattr(imitate, "RUNS", tmp_path / "runs")
    src = tmp_path / TINY.name
    shutil.copy(TINY, src)
    args = argparse.Namespace(
        run="t", seed=0, demos=[str(src)], hand_share=0.0, hidden=16, layers=2, steps=20,
        batch=64, lr=1e-3, log_every=10, force=False,
    )  # fmt: skip
    run = imitate.train(args)
    config = json.loads((run / "config.json").read_text())
    assert config["demos"] == {"scripted": 3, "hand": 0, "dagger": 0, "noise": [0.0, 0.2]}
    assert config["handShare"] == 0.0 and len(config["normalization"]["mean"]) == 32

    shared = tmp_path / "shared"
    shutil.copytree(SHARED, shared)
    p = export_grasp_policy(load_parity(), run, shared=shared)
    validate(p)
    gp = p["graspPolicy"]
    assert gp["observation"]["fields"] == demos.GRASP_OBS_FIELDS
    assert gp["action"]["deltaScale"] == pytest.approx(0.05)
    header = json.loads((shared / gp["header"]).read_text())
    assert [lyr["in"] for lyr in header["layers"]] == [32, 16, 16]
    assert header["trainedWith"]["demos"]["handShare"] == 0.0
    assert "metrics" not in header  # never typed in: only from a matching evaluation report
    assert (shared / gp["path"]).stat().st_size == 4 * (32 * 16 + 16 + 16 * 16 + 16 + 16 * 6 + 6)


def test_selection_refuses_the_evaluation_seed():
    with pytest.raises(SystemExit, match="evaluation"):
        imitate.select(argparse.Namespace(runs=["x"], seed=0, n=100))
