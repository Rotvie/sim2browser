"""Demonstration files (004 contracts/demo-file.md, research R9, spec FR-006, FR-018, SC-005).

The fixture `tests/data/tiny.demos.jsonl.gz` holds 3 scripted episodes (seeds 1000-1002, noise 0
and 0.2) made by `npm run demos --workspace web -- --seed 1000 --n 3 --noise 0,0.2
--out ../training/tests/data/tiny.demos.jsonl.gz`. Regenerate it whenever the physics changes
(`simSha256` mismatch).
"""

import gzip
import json
from pathlib import Path

import pytest

from reach import demos
from reach.spec import SHARED, load_parity

TINY = Path(__file__).parent / "data" / "tiny.demos.jsonl.gz"


@pytest.fixture(scope="module")
def parity():
    return load_parity()


@pytest.fixture(scope="module")
def episodes(parity):
    _, eps = demos.read(TINY, parity)
    return list(eps)


def write_variant(tmp_path, change):
    lines = gzip.open(TINY, "rt").read().splitlines()
    header = json.loads(lines[0])
    change(header)
    out = tmp_path / "bad.demos.jsonl.gz"
    with gzip.open(out, "wt") as f:
        f.write("\n".join([json.dumps(header), *lines[1:]]) + "\n")
    return out


def test_header(parity):
    header, eps = demos.read(TINY, parity)
    assert header["kind"] == "sim2browser-demos" and header["format"] == 1
    assert header["sizes"] == {"nq": 13, "nv": 12, "nu": 6}
    assert sum(sum(c.values()) for c in header["counts"].values()) == len(list(eps)) == 3


@pytest.mark.parametrize(
    "field,value",
    [("kind", "other"), ("format", 2), ("simSha256", "0" * 64)],
)
def test_rejects_other_files(parity, tmp_path, field, value):
    bad = write_variant(tmp_path, lambda h: h.__setitem__(field, value))
    with pytest.raises(demos.DemoError, match=field):
        demos.read(bad, parity)


def test_sim_sha_matches_typescript(parity):
    # The fixture's header was written by recorder.ts simSha256 on the current physics.
    header = json.loads(gzip.open(TINY, "rt").readline())
    assert demos.sim_sha256(parity) == header["simSha256"]


def test_sim_sha_ignores_policy_sections(parity):
    other = {**parity, "version": 99, "policy": None}
    assert demos.sim_sha256(other) == demos.sim_sha256(parity)
    assert demos.sim_sha256({**parity, "timestep": 0.001}) != demos.sim_sha256(parity)


def test_replay_matches_recording(parity, episodes):
    rp = demos.Replayer(parity)
    for ep in episodes:
        r = rp.replay(ep)
        assert max(r["max_dqpos"], r["max_dqvel"]) <= demos.REPLAY_TOL, ep["id"]
        assert demos.same_outcome(r["outcome"], ep["outcome"]), (ep["id"], r["outcome"])
        assert demos.same_lift_time(r["outcome"], ep["outcome"]), (ep["id"], r["outcome"])


def test_episode_fields(episodes):
    ep = episodes[1]  # noise 0.2
    assert ep["noise"] == 0.2 and ep["timeLimit"] == 10
    assert all(len(s["intent"]) == 5 for s in ep["steps"])
    assert "intent" not in episodes[0]["steps"][0]


def test_placements_match_typescript(parity):
    report = json.loads((SHARED / "grasp-eval" / "grasp.json").read_text())
    for py, ts in zip(demos.grasp_placements(parity, 100, 0), report["placements"], strict=True):
        assert py["pos"] == pytest.approx(ts["pos"], abs=1e-6)
        assert py["yaw"] == pytest.approx(ts["yaw"], abs=1e-6)


def test_demo_placements_are_not_evaluation_placements(parity, episodes):
    assert demos.overlapping(episodes, parity) == []
    ev = demos.grasp_placements(parity, 1, 0)[0]
    fake = {"id": "x", "placement": {"pos": [ev["pos"][0] + 0.001, ev["pos"][1]], "yaw": ev["yaw"]}}
    assert demos.overlapping([fake], parity) == ["x"]
    turned = {**fake, "placement": {**fake["placement"], "yaw": ev["yaw"] + 3.14159265 / 2}}
    assert demos.overlapping([turned], parity) == ["x"]  # a quarter turn is the same cube


def test_check_cli(parity, capsys):
    assert demos.check(TINY, parity)
    assert "OK" in capsys.readouterr().out
