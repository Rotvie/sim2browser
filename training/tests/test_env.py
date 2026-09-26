import mujoco
import numpy as np
import pytest

from reach.env import ReachEnv, apply_action


@pytest.fixture(scope="module")
def env():
    e = ReachEnv()
    e.reset(seed=0)
    return e


def test_observation_layout(env):
    obs, _ = env.reset(seed=1)
    assert obs.shape == (21,)
    fields = [(f["name"], f["size"]) for f in env.parity["observation"]["fields"]]
    assert fields == [("q", 5), ("qd", 5), ("target", 3), ("tipToTarget", 3), ("prevAction", 5)]
    np.testing.assert_array_equal(obs[0:5], env.q())
    np.testing.assert_array_equal(obs[5:10], env.qd())
    np.testing.assert_array_equal(obs[10:13], env.target)
    np.testing.assert_allclose(obs[13:16], env.target - env.tip(), atol=1e-15)
    np.testing.assert_array_equal(obs[16:21], np.zeros(5))


def test_action_application_and_substeps(env):
    env.reset(seed=2)
    ctrl0 = env.data.ctrl.copy()
    a = np.array([1.0, -1.0, 0.5, 0.0, -0.25], dtype=np.float32)
    ref = mujoco.MjData(env.model)
    mujoco.mj_copyData(ref, env.model, env.data)
    obs, *_ = env.step(a)
    expected_ctrl = np.clip(ctrl0 + a.astype(np.float64) * 0.05, env.lim[:, 0], env.lim[:, 1])
    np.testing.assert_array_equal(env.data.ctrl, expected_ctrl)
    ref.ctrl[:] = expected_ctrl
    for _ in range(env.parity["substeps"]):
        mujoco.mj_step(env.model, ref)
    np.testing.assert_array_equal(env.data.qpos, ref.qpos)
    np.testing.assert_array_equal(obs[16:21], a.astype(np.float64))


def test_apply_action_clips_to_limits():
    lim = np.array([[-1.0, 1.0], [0.0, 2.0]])
    out = apply_action(np.array([0.99, 0.01]), np.array([1.0, -1.0]), 0.05, lim)
    np.testing.assert_allclose(out, [1.0, 0.0])


def test_target_sampling_mix(env):
    env.reset(seed=3)
    sh = env.data.site_xpos[env.shoulder_id].copy()
    by = env.reach["baseAxisXY"][1]
    far = behind = 0
    n = 10_000
    for _ in range(n):
        t = env.sample_target()
        if np.linalg.norm(t - sh) > env.reach["maxReach"]:
            far += 1
        elif t[1] > by - env.reach["frontMargin"]:
            behind += 1
    # ~5% far and ~5% behind the base, ~10% unreachable in total.
    assert 0.035 < far / n < 0.07
    assert 0.035 < behind / n < 0.07


def test_episode_length_and_target_changes(env):
    env.reset(seed=4)
    assert 1 <= len(env.changes) <= 3
    targets = [env.target.copy()]
    steps = 0
    while True:
        _, _, term, trunc, _ = env.step(env.action_space.sample())
        steps += 1
        targets.append(env.target.copy())
        if term or trunc:
            break
    assert steps == 250
    moved = sum(not np.array_equal(a, b) for a, b in zip(targets, targets[1:], strict=False))
    assert moved >= 1
