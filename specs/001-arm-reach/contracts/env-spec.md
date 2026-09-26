# Contract: `shared/env-spec.json`

The single source of truth for every value parity depends on (constitution Principle II). The
training side and the browser side both read this file; neither side hard-codes these values.

```json
{
  "version": 1,
  "mujocoVersion": "3.14.0",
  "model": { "path": "robot/panda_reach.xml", "sha256": "<hex>" },
  "timestep": 0.002,
  "frameSkip": 10,
  "joints": ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6", "joint7"],
  "tipSite": "tip",
  "action": { "size": 7, "low": -1.0, "high": 1.0, "deltaScale": 0.05 },
  "observation": {
    "size": 31,
    "fields": [
      { "name": "q",            "size": 7, "label": "Joint angles",        "unit": "rad" },
      { "name": "qd",           "size": 7, "label": "Joint speeds",        "unit": "rad/s" },
      { "name": "tip",          "size": 3, "label": "Tip position",        "unit": "m" },
      { "name": "target",       "size": 3, "label": "Target position",     "unit": "m" },
      { "name": "tipToTarget",  "size": 3, "label": "Tip → target",        "unit": "m" },
      { "name": "prevAction",   "size": 7, "label": "Previous command",    "unit": "" },
      { "name": "outOfReach",   "size": 1, "label": "Target out of reach", "unit": "flag" }
    ],
    "normalization": { "mean": [/* 31 */], "std": [/* 31 */], "clip": 10.0, "eps": 1e-8 }
  },
  "reach": { "shoulderSite": "shoulder", "maxReach": 0.855, "margin": 0.02, "hysteresis": 0.01,
             "minZ": 0.02, "baseExclusionRadius": 0.12 },
  "success": { "tolerance": 0.01, "maxTipSpeed": 0.02, "hold": 0.2, "timeLimit": 2.0 },
  "policy": { "path": "policy/reach.bin", "header": "policy/reach.json", "sha256": "<hex>" }
}
```

## Rules

- The field order in `observation.fields` IS the vector layout. Appending or reordering fields
  bumps `version` and requires re-training and new fixtures.
- `normalization.std` values are used as `max(std, eps)`.
- The action is applied as: `ctrl = clip(ctrl + action·deltaScale, jointLow, jointHigh)`, once per
  control step, then `frameSkip` physics steps.
- `maxReach` is measured, not guessed: `export.py` computes it from forward kinematics sampling
  and writes it here.
- Both sides MUST fail loudly when `mujocoVersion` or `model.sha256` differs from what they load.
