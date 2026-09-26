# Contract: parity fixtures (`shared/parity/*.json`)

Written by `training/reach/make_fixtures.py` (Python MuJoCo is the reference). Replayed by
`tests/parity/*.test.ts` (WASM MuJoCo under Node). Enforces Principle II / FR-015. CI blocks deploy
on any failure.

```json
{
  "fixtureVersion": 1,
  "parityJsonSha256": "<hex>",
  "modelSha256": "<hex>",
  "mujocoVersion": "3.14.0",
  "kind": "trajectory" | "policy",
  "init": { "qpos": [...], "qvel": [...], "ctrl": [...], "target": [x, y, z] },
  "targetChanges": [ { "step": 120, "target": [x, y, z] } ],
  "steps": [
    { "action": [5], "obsRaw": [21], "obsNorm": [21], "policyAction": [5],
      "qpos": [...], "qvel": [...] }
  ]
}
```

## Fixtures

1. `trajectory-random.json`: 500 control steps of a fixed, seeded random action sequence.
2. `trajectory-limits.json`: actions saturated against joint limits.
3. `policy-recorded.json`: observations recorded while the trained policy runs (3 target changes,
   one unreachable), with the training policy's actions.

## Assertions

| Check | Tolerance |
|-------|-----------|
| Replay `action` sequence → `qpos`, `qvel` at every step (trajectory fixtures) | ≤ **1e-6** max abs |
| TS observation builder → `obsRaw`, `obsNorm` from the replayed state | ≤ 1e-6 |
| TS MLP on recorded `obsNorm` → `policyAction` | ≤ **1e-5** |
| MuJoCo version, model hash, `parity.json` hash | exact |

A failure reports the first step and field that diverged.
