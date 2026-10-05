# Contract: contact parity fixtures

Delta against [001's contract](../../001-arm-reach/contracts/parity-fixture.md). The 001
fixtures (`trajectory-random`, `trajectory-limits`, `policy-recorded`) are regenerated on the v3
model and keep their format; their `qpos`/`qvel` now include the jaw and the cube.

## New fixture kind: `ctrl`

The new fixtures drive actuators directly with absolute targets (all 6 actuators, model order),
instead of the 001 per-joint deltas, because the grasp controller writes the jaw too.

```json
{
  "fixtureVersion": 2,
  "parityJsonSha256": "<hex>",
  "modelSha256": "<hex>",
  "mujocoVersion": "3.14.0",
  "kind": "ctrl",
  "init": { "qpos": [13], "qvel": [12], "ctrl": [6] },
  "steps": [ { "ctrl": [6], "qpos": [13], "qvel": [12] } ]
}
```

Each step: set `ctrl`, run `substeps` physics steps, compare.

## Fixtures

| File | Written by | Content |
|------|-----------|---------|
| `contact-random.json` | `make_fixtures.py` | 300 control steps: seeded random walk of the arm targets from home with the gripper over the cube; jaw toggles open/closed every 60 steps. Must contain contacts (asserted at generation: max contacts ≥ 4, at least one jaw–cube contact) |
| `grasp-actions.json` | `web/scripts/record-grasp.ts` | Input only: `init` + `ctrl` per step from one scripted grasp (cube at `cube.defaultPose`, yaw 0.3 rad) through `hold` + 0.5 s; asserts the recorded attempt succeeded |
| `grasp-recorded.json` | `make_fixtures.py` | Python replay of `grasp-actions.json`, with `qpos`/`qvel` per step |

## Assertions (`tests/parity/trajectory.test.ts`)

| Check | Tolerance |
|-------|-----------|
| Replay `ctrl` sequence → full `qpos`, `qvel` (arm, jaw, cube) at every step | ≤ **1e-6** max abs |
| Cube lifted at the end of `grasp-recorded` in both engines | exact (boolean) |
| MuJoCo version, model hash, `parity.json` hash | exact |

If `grasp-recorded` cannot meet 1e-6, the tolerance is set per component from a measurement and
recorded in `validation.md` (research R2); the test states the reason next to the number.
