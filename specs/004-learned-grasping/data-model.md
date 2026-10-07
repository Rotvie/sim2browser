# Data Model: Learned Grasping

Entities from the spec, with fields, validation and state. Formats on disk are in `contracts/`.

## Demonstration (episode)

One recorded grasp attempt. Contract: [contracts/demo-file.md](./contracts/demo-file.md).

| Field | Type | Notes |
|---|---|---|
| `id` | string | unique within the file (`hand-0007`, `scripted-1042`) |
| `source` | `"hand"` \| `"scripted"` | who drove the arm |
| `controller` | string | controller id at start (`grasp`, `baseline`, `manual`, …); hand episodes may switch |
| `placement` | `{pos: [x, y], yaw, seed, index}` | cube start; `seed`/`index` of `graspPlacements`, or `null` if the demonstrator moved it |
| `noise` | number | DART noise σ as a fraction of the per-step joint limit; 0 for hand |
| `start` | `{qpos, qvel, ctrl}` | full simulator state before step 0 |
| `steps[k]` | `{ctrl, grip, intent?, qpos, qvel}` | after control step k; `grip` 1 = closed; `intent` = expert's 5 joint deltas in [-1, 1] (noise-injected episodes only) |
| `outcome` | `{success, timeToLift, failure}` | from the grasp attempt monitor; same `failure` values as 002 |

**Validation**: `steps` non-empty; every array has the model's size (nq, nv, nu+1 from the
header); `outcome.success` ⇔ `timeToLift !== null` ⇔ `failure === null`; the start placement is
inside the graspable region; for training, the start placement is not within 2 mm / 0.02 rad of an
evaluation placement (FR-018).

**Lifecycle (recording mode)**: `recording` → `ended` (lift held 1 s, time limit, or Stop) →
`kept` | `discarded`. Only kept episodes are saved.

## Demonstration set (file)

| Field | Type | Notes |
|---|---|---|
| `header.format` | 1 | file format version |
| `header.simSha256` | hex | physics the episodes were recorded on (model, timestep, rates, gripper, cube); mismatch → reject (FR-006) |
| `header.parityVersion` | int | informational |
| `header.mujocoVersion` | string | |
| `header.sizes` | `{nq, nv, nu}` | |
| `header.counts` | `{hand: {lifted, failed}, scripted: {lifted, failed}}` | |
| `header.created`, `header.generator` | string | ISO time; `"record-mode"` or `"demos.ts --seed … --n …"` |
| episodes | Demonstration[] | one per line |

## Grasp policy

The learned controller for the grasp task. Contract:
[contracts/grasp-policy.md](./contracts/grasp-policy.md).

| Field | Notes |
|---|---|
| layers | tanh MLP, clipped linear output; 32 → 256 → 256 → 6 to start (R4) |
| observation | 32 values, fields and normalization in `parity.json graspPolicy.observation` (R5) |
| action | 6 values in [-1, 1]: 5 joint-target changes × `deltaScale`, gripper > 0 → closed |
| trainedWith | `algo: "BC+DART"`, epochs, seed, run, `demos: {scripted, hand, handShare, noise}` |
| metrics | evaluation success rate, median time to lift, n, seed, selection-set success |

One grasp policy and one reach policy ship (one policy per task, Principle V).

## Controller (extended)

`ControllerDef` from 001's registry gains `task: "reach" | "grasp"` (default `"reach"`).

| id | task | public | learned |
|---|---|---|---|
| `baseline` | reach | yes | no |
| `learned` | reach | yes | yes |
| `grasp` | grasp | yes | no (label "Scripted grasp") |
| `learned-grasp` | grasp | yes | yes (label "Learned grasp") |
| `jacobian-transpose` | reach | lab | no |
| `naive-grasp` | grasp | lab | no (SC-010 example) |

Exactly one controller (or Manual) active.

## Grasp attempt

Owned by the session's attempt monitor (research R7) for any `task: "grasp"` controller.

| Field | Notes |
|---|---|
| `controller` | id |
| `startPose` | cube pose at start (for Retry) |
| `startTime` | sim time at start |
| `heldEver`, `cubeMovedXY` | for failure classification |
| `phase` | controller-reported phase if any (scripted), else `running` |
| `outcome` | `running` → `done` (judge success) \| `failed` (`not-graspable`, `knocked`, `missed`, `slipped`, `timeout`) |
| `liftTime` | from `GraspJudge` |

**Transitions**: start (controller selected, Retry, or regrasp) → `running`; judge success →
`done`; time limit or controller-reported failure → `failed` (classified); visitor drag, joint
grab, controller switch or cube move → attempt ends (`cancelled`, not counted anywhere).

**Retry**: restore arm and gripper to the reset state, the cube to the visitor's placement (the
default pose after a reset, or the last cube drag), settle 0.2 s, start the currently selected
grasp controller. Lets the visitor compare both grasps on one placement (FR-010). (Not the last
attempt's start: selecting a grasp controller starts an attempt from wherever the previous grasp
left the cube; validation.md 2026-10-07.)

## Grasp evaluation report

One per grasp controller: `shared/grasp-eval/<id>.json`. Contract:
[contracts/grasp-eval.md](./contracts/grasp-eval.md). Same fields as 002's report plus
`controller`, `task`; format version 2.

## Placement sets

| Set | Seed | n | Use |
|---|---|---|---|
| evaluation | 0 | 100 | release numbers, info panel, release bar (≥ 80%) |
| selection | 1 | 100 | choose noise, hand share, network size, shipped training seed |
| scripted demos | 1000 + i | 1 each | training data |
| hand demos | 2000, index i | | recording mode's next placement |
