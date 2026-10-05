# Contract: `shared/parity.json` version 3

Delta against [001's contract](../../001-arm-reach/contracts/parity-json.md). Written only by
`training/reach/export.py`; read by the browser, the evaluation and the parity tests. Version
mismatch is a load error (`version-mismatch`), as in 001.

## Changed

| Field | v2 | v3 |
|-------|----|----|
| `version` | 2 | **3** |
| `model.path` | `robot/so100_reach.xml` | `robot/so100.xml` |
| `model.files` | 13 meshes + XML | unchanged list (collision hulls are inlined in the XML) |
| `model.sha256` | | recomputed (same algorithm) |

`joints`, `action`, `observation`, `baseline`, `success` keep their shape. `joints` stays the
5 arm joints; the jaw is described by `gripper`. `reach` gains `evalMinZ` (0.04): the lowest
target the evaluation and training sample, while `minZ` (0.01) stays the lowest target a visitor
can set, so the gripper can still be lowered around the cube (research R7, `validation.md`).

## Added

```json
{
  "gripper": {
    "joint": "Jaw",
    "actuator": "Jaw",
    "open": 1.0,
    "closed": -0.174,
    "maxSpeed": 3.0,
    "default": "closed"
  },
  "cube": {
    "body": "cube",
    "joint": "cube",
    "size": 0.03,
    "defaultPose": { "pos": [0.0, -0.265, 0.015], "yaw": 0.0 }
  },
  "grasp": {
    "approachHeight": 0.08,
    "descendSpeed": 0.05,
    "approachSpeed": 0.15,
    "liftHeight": 0.08,
    "liftSpeed": 0.05,
    "closeSettle": 0.2,
    "closeTimeout": 1.0,
    "fixedJawOffset": 0.0,
    "verticalOffset": 0.0,
    "rollOffset": 0.0,
    "knockedDistance": 0.02,
    "region": { "center": [0.0, -0.0452], "rMin": 0.0, "rMax": 0.0, "maxAngle": 0.0 },
    "success": { "liftCheck": 0.05, "hold": 1.0, "timeLimit": 10.0 }
  }
}
```

Values shown as `0.0` are computed by `export.py` from the model (research R4/R5); the others are
the research defaults and may be tuned during P2, always through `export.py`.

## Validation (`spec.py` and `web/src/sim/parity.ts`, same rules)

- `gripper.closed` and `gripper.open` within the jaw joint range; `closed < open`.
- `grasp.region.rMin < grasp.region.rMax ≤ reach.maxReach`; `0 < maxAngle ≤ π/2`.
- `cube.defaultPose` inside `grasp.region`.
- `model.nu == len(joints) + 1` and the gripper actuator exists (checked at sim creation).
