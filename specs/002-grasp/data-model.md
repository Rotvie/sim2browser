# Data Model: Grasp

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md) | **Base**:
[001 data model](../001-arm-reach/data-model.md)

Changes and additions to the 001 data model. Runtime state still lives in the sim worker; the
main thread holds only the latest snapshot.

## Runtime entities (worker)

### Arm (changed)

The 5 arm joints are unchanged (`parity.joints`); the jaw is not one of them, so the DLS
baseline, the policy and `Arm.applyDelta` keep working on 5 joints.

| Field | Type | Notes |
|-------|------|-------|
| `ctrl` | float[6] | 5 arm targets + jaw target (actuator order from the model) |
| `jaw` | float | jaw joint position (rad) |
| `jawTarget` | float | jaw actuator target, moved toward the gripper command at `gripper.maxSpeed` |

**Rules**: The jaw target is clipped to the jaw range like every other target (FR-001). Only the
gripper path writes the jaw target.

### Gripper command

| Field | Type | Notes |
|-------|------|-------|
| `command` | `"open"` \| `"closed"` | set by the visitor (button / `G`) or by the grasp controller |

**Rules**: Independent of the control mode; a mode switch never changes it (spec edge case:
switching while holding does not drop the cube). Reset sets `closed`.

### Cube (new)

| Field | Type | Notes |
|-------|------|-------|
| `pos` | float[3] | centre, world (m), from the free joint's qpos |
| `quat` | float[4] | orientation (w, x, y, z) |
| `yaw` | float | rotation about z (rad), derived; used by the grasp |
| `held` | bool | both jaw bodies in contact with the cube (MuJoCo contacts) |
| `upright` | bool | some cube axis within 10° of world z (a face is down) |
| `graspable` | bool | upright, resting, and centre inside `grasp.region` |

**Rules**: Visitor placement (`setCube`) is accepted only when not `held`; the pose is clamped to
the floor in front of the arm, outside the base exclusion radius, then set with zero velocity.
Reset restores `cube.defaultPose`.

### ControlMode (changed)

New state `grasp` (registry id, public). New transitions:

| From | Event | To |
|------|-------|----|
| any | `setMode("grasp")` | `grasp`; a new GraspAttempt starts from the current state |
| `grasp` | `setTarget` (visitor drag) | `baseline` (reason `target-drag`) |
| `grasp` | `dragJoint` | `manual` (reason `joint-grab`, as 001) |
| `grasp` | `setGripper` (visitor) | `baseline` (reason `user`), then the command applies |
| `grasp` | `regrasp` | `grasp`; new GraspAttempt |

**Rules**: Leaving `grasp` keeps the gripper command and the arm pose. `setTarget` in other modes
behaves as in 001.

### GraspAttempt (new, one per entry into `grasp`)

| Field | Type | Notes |
|-------|------|-------|
| `phase` | `approach` \| `descend` \| `close` \| `lift` \| `hold` \| `done` \| `failed` | |
| `failure` | `not-graspable` \| `missed` \| `slipped` \| `knocked` \| `timeout` \| null | first that applies (research R6) |
| `startTime` | float | sim time at start |
| `liftTime` | float \| null | start of the successful 1 s hold, relative to `startTime` |
| `cubeStart` | pose | cube pose at start (yaw used for the wrist roll) |

**State transitions**:

```text
start ──(not graspable)──────────────────────────────▶ failed(not-graspable)
start ─▶ approach ─▶ descend ─▶ close ─▶ lift ─▶ hold ─(1 s held, lifted)─▶ done
            │         │          │       │       └─(dropped)──────────▶ failed(slipped)
            │         └─(cube moved > 2 cm)────────────────────────────▶ failed(knocked)
            │                    └─(jaws closed, cube not held)────────▶ failed(missed)
            └─(10 s since start, any phase)────────────────────────────▶ failed(timeout)
failed ─▶ gripper opens, tip returns to the approach point (mode stays `grasp`)
done   ─▶ holds the lifted pose (mode stays `grasp`)
```

### Snapshot (changed)

Adds `jaw`, `gripper` (command), `cube` (`pos`, `quat`, `held`, `graspable`), and `grasp`
(`phase`, `failure`) while in `grasp` mode. `bodyPos`/`bodyQuat` already include the cube body.

## Static artifacts

### parity.json v3 (changed)

New sections `gripper`, `cube`, `grasp`; `model.path` → `robot/so100.xml`. Full schema in
[contracts/parity-json.md](./contracts/parity-json.md).

### GraspEvalReport → `shared/grasp-eval.json` (new, shipped)

| Field | Type | Notes |
|-------|------|-------|
| `version` | 1 | |
| `parityJsonSha256` | string | ties the numbers to one parity.json |
| `n`, `seed` | int | 100, 0 |
| `successRate` | float | SC-003 (target ≥ 0.90) |
| `medianTimeToLift` | float | s, over successes (SC-004, target ≤ 6) |
| `failures` | `{ [reason]: count }` | |
| `placements` | `{ pos[2], yaw, success, timeToLift, failure }[]` | per placement, for audit |

Contract: [contracts/grasp-eval.md](./contracts/grasp-eval.md).

### Parity fixtures (new)

`contact-random.json`, `grasp-recorded.json` (references) and `grasp-actions.json` (input
commands). Format: [contracts/parity-fixture.md](./contracts/parity-fixture.md).

### Policy header `reach.json` (changed)

`parityVersion: 3`; `metrics` replaced by the re-measured values on the new model (research R7),
with `model: "so100.xml"` noted. Weights and their hash change only if R7 triggers a retrain.
