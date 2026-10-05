"""003: the performance-gated penalty ramp (research R4, data-model "Penalty ramp")."""

import pytest

from reach.train import GatedRamp


def test_ramp_advances_only_while_reaching_works():
    r = GatedRamp(total=1_000_000, rollout=10_000, gate_dist=0.15)
    assert r.scale == 0.0
    r.update(mean_dist=0.30)
    assert r.scale == 0.0
    r.update(mean_dist=0.10)
    first = r.scale
    assert first > 0
    r.update(mean_dist=0.40)  # never decreases, never advances above the gate
    assert r.scale == first


def test_ramp_takes_at_least_a_quarter_of_the_stage_and_caps_at_one():
    total, rollout = 1_000_000, 10_000
    r = GatedRamp(total=total, rollout=rollout, gate_dist=0.15)
    steps = 0
    while r.scale < 1.0:
        r.update(mean_dist=0.05)
        steps += rollout
    assert steps >= 0.25 * total
    r.update(mean_dist=0.05)
    assert r.scale == 1.0


def test_gate_is_inclusive():
    r = GatedRamp(total=100, rollout=10, gate_dist=0.15)
    r.update(mean_dist=0.15)
    assert r.scale == pytest.approx(10 / 25)
