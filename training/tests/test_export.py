"""Round trip: exported reach.bin reproduces the trained SB3 actor (policy-artifact contract)."""

import json

import numpy as np
import pytest

from reach.spec import SHARED, load_parity, sha256_file

parity = load_parity()
pytestmark = pytest.mark.skipif("policy" not in parity, reason="no exported policy yet")


def load_layers():
    header = json.loads((SHARED / parity["policy"]["header"]).read_text())
    blob = np.frombuffer((SHARED / parity["policy"]["path"]).read_bytes(), dtype="<f4")
    layers, off = [], 0
    for layer in header["layers"]:
        n_w = layer["out"] * layer["in"]
        w = blob[off : off + n_w].reshape(layer["out"], layer["in"]).astype(np.float64)
        b = blob[off + n_w : off + n_w + layer["out"]].astype(np.float64)
        off += n_w + layer["out"]
        layers.append((w, b))
    return header, blob, layers


def forward(layers, x):
    for w, b in layers[:-1]:
        x = np.tanh(w @ x + b)
    w, b = layers[-1]
    return np.clip(w @ x + b, -1.0, 1.0)


def test_byte_length_and_hash():
    header, blob, _ = load_layers()
    expected = sum(layer["out"] * layer["in"] + layer["out"] for layer in header["layers"]) * 4
    assert blob.nbytes == expected
    assert sha256_file(SHARED / parity["policy"]["path"]) == parity["policy"]["sha256"]
    assert header["sha256"] == parity["policy"]["sha256"]
    assert [(la["in"], la["out"]) for la in header["layers"]] == [(21, 128), (128, 128), (128, 5)]


def test_forward_matches_sb3():
    from stable_baselines3 import PPO

    from reach.export import RUNS

    header, _, layers = load_layers()
    run = RUNS / header["trainedWith"]["run"]
    if not (run / "model.zip").exists():
        pytest.skip(f"training run {run.name} not available locally")
    model = PPO.load(run / "model.zip", device="cpu")
    rng = np.random.default_rng(0)
    obs = rng.normal(size=(1000, 21)).clip(-10, 10)
    ours = np.array([forward(layers, o) for o in obs])
    theirs, _ = model.predict(obs.astype(np.float32), deterministic=True)
    np.testing.assert_allclose(ours, theirs, atol=1e-6)
