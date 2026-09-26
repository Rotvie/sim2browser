# Contract: policy artifact (`shared/policy/reach.json` + `reach.bin`)

## Header `reach.json`

```json
{
  "format": 1,
  "envSpecVersion": 1,
  "activation": "tanh",
  "outputActivation": "tanh",
  "layers": [
    { "in": 31,  "out": 128 },
    { "in": 128, "out": 128 },
    { "in": 128, "out": 7 }
  ],
  "dtype": "float32-le",
  "sha256": "<hex of reach.bin>",
  "trainedWith": { "algo": "PPO", "steps": 0, "seed": 0, "gitRev": "<rev>" }
}
```

## Binary `reach.bin`

For each layer in order: `W` (row-major, `out × in`), then `b` (`out`), as little-endian float32.
Total size = Σ(out·in + out)·4 bytes (≈ 86 KB).

## Forward pass (both sides MUST agree)

```
h = obsNorm
for each hidden layer: h = tanh(W·h + b)
action = tanh(W_last·h + b_last)        # deterministic mean action, no sampling
```

## Rules

- The browser uses only the deterministic mean action (no exploration noise).
- The loader MUST check `envSpecVersion`, the byte length, and `sha256` before use; on mismatch,
  Learned mode is disabled and an error is shown (see data-model ControlMode).
