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
    assert obs.shape == (18,)
    fields = [(f["name"], f["size"]) for f in env.parity["observation"]["fields"]]
    assert fields == [("q", 4), ("qd", 4), ("target", 3), ("tipToTarget", 3), ("prevAction", 4)]
    assert env.parity["action"]["joints"] == ["Rotation", "Pitch", "Elbow", "Wrist_Pitch"]
    np.testing.assert_array_equal(obs[0:4], env.q()[:4])
    np.testing.assert_array_equal(obs[4:8], env.qd()[:4])
    np.testing.assert_array_equal(obs[8:11], env.target)
    np.testing.assert_allclose(obs[11:14], env.target - env.tip(), atol=1e-15)
    np.testing.assert_array_equal(obs[14:18], np.zeros(4))


def test_action_application_and_substeps(env):
    env.reset(seed=2)
    ctrl0 = env.data.ctrl.copy()
    expected_ctrl0 = ctrl0[env.aid]
    a = np.array([1.0, -1.0, 0.5, -0.25], dtype=np.float32)
    ref = mujoco.MjData(env.model)
    mujoco.mj_copyData(ref, env.model, env.data)
    obs, *_ = env.step(a)
    full = np.append(a.astype(np.float64), 0.0)  # Wrist_Roll is held
    expected_ctrl = np.clip(expected_ctrl0 + full * 0.05, env.lim[:, 0], env.lim[:, 1])
    np.testing.assert_array_equal(env.data.ctrl[env.aid], expected_ctrl)
    assert env.data.ctrl[env.aid[4]] == ctrl0[env.aid[4]]
    assert env.data.ctrl[env.jaw_aid] == ctrl0[env.jaw_aid]
    ref.ctrl[env.aid] = expected_ctrl
    for _ in range(env.parity["substeps"]):
        mujoco.mj_step(env.model, ref)
    np.testing.assert_array_equal(env.data.qpos, ref.qpos)
    np.testing.assert_array_equal(obs[14:18], a.astype(np.float64))


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


def test_jaw_closed_and_cube_on_the_floor_after_reset(env):
    # 003: the cube is placed randomly in training (test_resets_never_start_inside_floor_or_cube).
    env.reset(seed=5)
    p = env.parity
    assert env.model.nu == 6
    assert env.data.ctrl[env.jaw_aid] == p["gripper"]["closed"]
    assert env.data.qpos[env.cube_qadr + 2] == pytest.approx(p["cube"]["size"] / 2)


# --- 003: contact-robust episode setup and reward --------------------------------------------


def _penetrating(env) -> bool:
    m, d = env.model, env.data
    for i in range(d.ncon):
        c = d.contact[i]
        b = {m.geom_bodyid[c.geom1], m.geom_bodyid[c.geom2]}
        if b & env.arm_bodies and (env.floor_geom in (c.geom1, c.geom2) or env.cube_body in b):
            if c.dist < -0.001:
                return True
    return False


def _in_cube_box(env, p) -> bool:
    c = env.data.qpos[env.cube_qadr : env.cube_qadr + 3]
    half = env.parity["cube"]["size"] / 2 + env.sampling.target_cube_margin
    return bool(np.all(np.abs(np.asarray(p) - c) <= half))


def test_resets_never_start_inside_floor_or_cube(env):
    rng = np.random.default_rng(0)
    p = env.parity
    default, placed = 0, 0
    bx, by = p["reach"]["baseAxisXY"]
    for _ in range(2000):
        env.reset(seed=int(rng.integers(1 << 30)))
        assert not _penetrating(env)
        assert not _in_cube_box(env, env.target)
        c = env.data.qpos[env.cube_qadr : env.cube_qadr + 3]
        if np.allclose(c, p["cube"]["defaultPose"]["pos"]):
            default += 1
        else:
            placed += 1
            r = np.hypot(c[0] - bx, c[1] - by)
            lo, hi = env.sampling.cube_r
            assert lo - 1e-9 <= r <= hi + 1e-9
            assert abs(np.arctan2(c[0] - bx, -(c[1] - by))) <= env.sampling.cube_max_angle + 1e-9
    assert 0.15 <= default / 2000 <= 0.25


def test_reset_gives_up_loudly(env, monkeypatch):
    import reach.env as E

    monkeypatch.setattr(E, "_arm_penetrates", lambda env: True)
    with pytest.raises(RuntimeError):
        env.reset(seed=1)


def test_reward_caps_jerk_and_penalizes_contacts(env):
    env.reset(seed=11)
    w = env.reward_w
    # Drive the gripper hard into the floor: fully extended down.
    hit = False
    for _ in range(80):
        _, _, _, _, info = env.step(np.array([0.0, 1.0, -1.0, 1.0], dtype=np.float32))
        contact = info["floor"] or info["cube_contact"]
        if contact:  # impacts are capped...
            assert info["jerk_sq"] == min(info["jerk_sq_raw"], w.jerk_cap)
        else:  # ...free motion pays the full jerk (a cap there stops smoothness learning: 003)
            assert info["jerk_sq"] == info["jerk_sq_raw"]
        hit |= info["floor"]
    assert hit, "the test motion should reach the floor"


def test_contact_terms_are_not_ramped(env):
    env.reset(seed=12)
    env.penalty_scale = 0.0
    r_no = env._contact_penalty(False, False)
    r_floor = env._contact_penalty(True, False)
    r_both = env._contact_penalty(True, True)
    assert r_no == 0.0
    assert r_floor == pytest.approx(-env.reward_w.floor)
    assert r_both == pytest.approx(-env.reward_w.floor - env.reward_w.cube)
