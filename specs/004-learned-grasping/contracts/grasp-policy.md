# Contract: grasp policy artifact and `parity.json` v4

Spec FR-008, FR-009, FR-020, FR-021; research R4, R5, R10.

## Files

- `shared/policy/grasp.bin`: float32 little-endian weights, layer by layer (W row-major
  `out × in`, then b), same layout as `reach.bin`.
- `shared/policy/grasp.json`: header, same schema as `reach.json` (`PolicyHeader` in
  `web/src/control/policy.ts`) with these differences:

```json
{
  "format": 1,
  "parityVersion": 4,
  "activation": "tanh",
  "outputActivation": "clip",
  "layers": [{ "in": 32, "out": 256 }, { "in": 256, "out": 256 }, { "in": 256, "out": 6 }],
  "dtype": "float32-le",
  "sha256": "<hex of grasp.bin>",
  "trainedWith": {
    "algo": "BC+DART",
    "steps": 20000,
    "seed": 0,
    "run": "g1-s0",
    "demos": { "scripted": 2000, "hand": 24, "handShare": 0.15, "noise": [0, 0.1, 0.2, 0.3] }
  },
  "metrics": {
    "successRate": 0.0,
    "medianTimeToLift": 0.0,
    "selectionSuccessRate": 0.0,
    "n": 100,
    "seed": 0
  }
}
```

`trainedWith.demos` and `metrics` feed the info panel (FR-019). `metrics` are copied from
`shared/grasp-eval/learned-grasp.json` after evaluation, never typed in.

## `parity.json` v4 additions

```json
{
  "version": 4,
  "graspPolicy": {
    "path": "policy/grasp.bin",
    "header": "policy/grasp.json",
    "sha256": "<hex>",
    "observation": {
      "size": 32,
      "fields": [
        { "name": "q", "size": 5, "label": "Joint angles", "unit": "rad" },
        { "name": "qd", "size": 5, "label": "Joint speeds", "unit": "rad/s" },
        { "name": "jaw", "size": 1, "label": "Jaw angle", "unit": "rad" },
        { "name": "tip", "size": 3, "label": "Tip position", "unit": "m" },
        { "name": "cube", "size": 3, "label": "Cube position", "unit": "m" },
        { "name": "cubeToTip", "size": 3, "label": "Cube → tip", "unit": "m" },
        { "name": "cubeYaw4", "size": 2, "label": "Cube turn (sin, cos ×4)", "unit": "" },
        { "name": "relYaw4", "size": 2, "label": "Cube vs. jaws (sin, cos ×4)", "unit": "" },
        { "name": "faceYaw4", "size": 2, "label": "Cube vs. jaws facing it (sin, cos ×4)", "unit": "" },
        { "name": "prevAction", "size": 6, "label": "Previous command", "unit": "" }
      ],
      "normalization": { "mean": [...32], "std": [...32], "clip": 10.0, "eps": 1e-8 }
    },
    "action": {
      "size": 6,
      "joints": ["Rotation", "Pitch", "Elbow", "Wrist_Pitch", "Wrist_Roll"],
      "deltaScale": 0.05,
      "gripperIndex": 5,
      "gripperThreshold": 0.0
    }
  }
}
```

- Written only by `training/reach/export.py --grasp-run <run>` (Principle II). Absent
  `graspPolicy` → the learned grasp is not offered (`available()` false), the scripted grasp
  still is: that is the shipped state if 004 closes below the release bar.
- `deltaScale` = `baseline.maxJointSpeed / controlHz`; the export asserts it.
- The reach `policy` section is unchanged; `reach.json` is re-exported with `parityVersion: 4`
  and the same weights hash.
- Validation (`spec.py`, `parity.ts`): version 4; `graspPolicy.observation.size` = sum of field
  sizes = first layer `in`; `action.size` = last layer `out`; sha256 of `grasp.bin` matches.

## Runtime behavior (`learnedGrasp.ts`)

Per control step: build the observation from the live simulation in field order → normalize →
`createPolicy(...).forward` → `arm.applyDelta(action[0..4] × deltaScale, deltaScale)`;
`gripper.set(action[5] > gripperThreshold ? "closed" : "open")`; `prevAction = action`.
`enter()` zeroes `prevAction`. `inspect()` returns the step for the policy view.

## Parity

- `shared/parity/grasp-policy-recorded.json`: `{states: [{qpos, qvel, ctrl, prevAction}],
  obs: [[...32]], action: [[...6]]}` from Python; TypeScript must match obs to 1e-9 and action to
  1e-5.
- `shared/parity/learned-grasp-actions.json` / `learned-grasp-recorded.json`: one learned grasp's
  ctrl sequence recorded in Node and replayed in Python, same schema and 1e-6 tolerance as 002's
  `grasp-actions.json` / `grasp-recorded.json`.
