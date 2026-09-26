# Contract: policy artifact (`shared/policy/reach.json` + `reach.bin`)

Written by `training/reach/export.py` from the trained SB3 policy.

## Header `reach.json`

```json
{
  "format": 1,
  "parityVersion": 1,
  "activation": "tanh",
  "outputActivation": "clip",
  "layers": [
    { "in": 21,  "out": 128 },
    { "in": 128, "out": 128 },
    { "in": 128, "out": 5 }
  ],
  "dtype": "float32-le",
  "sha256": "<hex of reach.bin>",
  "trainedWith": { "algo": "PPO", "steps": 0, "seed": 0, "gitRev": "<rev>" },
  "metrics": { "successRate": 0.0, "jerkRatioVsBaseline": 0.0 }
}
```

`metrics` is filled in from the Node evaluation after export. The info panel shows it
(honest reporting, research R12).

## Binary `reach.bin`

For each layer in order: `W` (row-major, `out × in`), then `b` (`out`), as little-endian float32.
Total ≈ 20k parameters ≈ 80 KB.

## Forward pass (both sides MUST agree within 1e-5)

```
h = obsNorm
for each hidden layer: h = tanh(W·h + b)
action = clip(W_last·h + b_last, -1, 1)  # SB3 PPO deterministic mean (linear), clipped to bounds
```

## Rules

- The browser uses only the deterministic mean action.
- The loader checks `parityVersion`, the byte length, and `sha256`; on mismatch, Learned mode is
  disabled and an error is shown.
- There is no ONNX export: the browser runs this format directly (research R7).
