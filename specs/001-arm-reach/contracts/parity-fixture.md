# Contract: parity fixture (`shared/parity/*.json`)

Written by `train/make_fixtures.py` (Python MuJoCo, reference); replayed by
`web/tests/parity/*.test.ts` (WASM MuJoCo in Node). Enforces Principle II / FR-015.

```json
{
  "fixtureVersion": 1,
  "envSpecSha256": "<hex>",
  "modelSha256": "<hex>",
  "mujocoVersion": "3.14.0",
  "kind": "open-loop" | "closed-loop-policy",
  "init": { "qpos": [...], "qvel": [...], "ctrl": [...], "target": [x, y, z] },
  "targetChanges": [ { "step": 120, "target": [x, y, z] } ],
  "steps": [
    {
      "action": [7],          // open-loop: given; closed-loop: the Python policy's output
      "obsRaw": [31],
      "obsNorm": [31],
      "qpos": [...], "qvel": [...], "tip": [3]
    }
  ]
}
```

## Fixture set (minimum)

1. `open-loop-random.json`: 500 steps of seeded random actions (tests engine plus action
   application).
2. `open-loop-limits.json`: actions saturated against joint limits.
3. `closed-loop-policy.json`: 500 steps where the policy drives the arm, including 3 target
   changes and one unreachable target (tests observation builder, normalization, MLP).

## Assertions (TS side)

| Quantity | Tolerance (max abs) |
|----------|---------------------|
| `qpos`, `qvel`, `tip` | 1e-9 open-loop; 1e-6 closed-loop |
| `obsRaw`, `obsNorm` | 1e-6 |
| policy `action` (TS MLP on Python's `obsNorm`) | 1e-5 |
| env-spec / model / MuJoCo version | exact match |

In closed-loop mode, the TS side runs its own policy on its own observations. A drift beyond the
tolerance at any step fails the test and reports the first step and field that diverged.
