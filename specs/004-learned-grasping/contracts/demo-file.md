# Contract: demonstration file (`*.demos.jsonl.gz`)

The training-method-independent record of grasp demonstrations (spec FR-003, FR-005, FR-006,
FR-025; research R3). Written by the recorder (browser recording mode and `npm run demos`), read
by `training/reach/demos.py`. Any other learner may read it.

## Encoding

- gzip-compressed UTF-8 JSON Lines. Line 1: header object. Lines 2…: one episode object each.
- Numbers are JSON numbers written with full float64 precision (`JSON.stringify`), so a replay
  starts from the exact recorded state.
- File name: `<source>-<label>.demos.jsonl.gz` (e.g. `hand-20261012-1430.demos.jsonl.gz`,
  `scripted-s1000-n2000.demos.jsonl.gz`).

## Header (line 1)

```json
{
  "kind": "sim2browser-demos",
  "format": 1,
  "simSha256": "<hex>",
  "parityVersion": 4,
  "mujocoVersion": "3.14.0",
  "controlHz": 50,
  "sizes": { "nq": 13, "nv": 12, "nu": 6 },
  "counts": { "hand": { "lifted": 0, "failed": 0 }, "scripted": { "lifted": 0, "failed": 0 } },
  "created": "2026-10-12T14:30:00Z",
  "generator": "record-mode | demos.ts --seed 1000 --n 2000 --noise 0,0.1,0.2,0.3"
}
```

`simSha256` identifies the physics the episodes were recorded on: sha256 of the canonical JSON
(sorted keys, no whitespace) of `{model.sha256, mujocoVersion, timestep, substeps, controlHz,
gripper, cube}` from `parity.json`. It ignores policy and evaluation sections, so adding the grasp
policy (parity.json v4) does not invalidate demonstrations recorded before it. `parityVersion` is
informational. Readers MUST reject a file whose `kind`, `format` or `simSha256` does not match,
with a message naming the mismatch.

## Episode (lines 2…)

```json
{
  "id": "scripted-1042",
  "source": "scripted",
  "controller": "grasp",
  "placement": { "pos": [0.01, -0.25], "yaw": 0.4, "seed": 1042, "index": 0 },
  "noise": 0.2,
  "timeLimit": 10,
  "start": { "qpos": [...13], "qvel": [...12], "ctrl": [...6] },
  "steps": [
    { "ctrl": [...6], "grip": 1, "intent": [...5], "qpos": [...13], "qvel": [...12] }
  ],
  "outcome": { "success": true, "timeToLift": 4.48, "failure": null }
}
```

- `start` is the state after the 0.2 s cube settle, immediately before control step 0.
- `steps[k].ctrl`: actuator targets applied for step k (arm joints then jaw), i.e.
  `data.ctrl` after the controller and gripper stepped, before physics.
- `steps[k].qpos/qvel`: state after the step's `substeps` physics steps.
- `steps[k].grip`: gripper command during step k (1 closed, 0 open).
- `steps[k].intent` (optional): the driving controller's intended joint-target change for the 5
  arm joints, divided by the per-step limit and clipped to [-1, 1]; present only when the applied
  change was perturbed (DART noise). Absent → the label is the applied change.
- `steps[k].gripIntent`, `steps[k].action` (DAgger episodes, `source: "dagger"`): a learned
  policy drove; `intent` and `gripIntent` are the reactive expert's labels for the state the step
  started from, `action` is the policy's own output (its next `prevAction`).
- `source`: `hand`, `scripted`, or `dagger` (header `counts` gains a `dagger` entry when present).
- `placement.seed`/`index` are `null` when the demonstrator moved the cube before starting.
- `timeLimit`: the attempt's time limit (s): `grasp.success.timeLimit` when a grasp controller
  was in charge at the start, else 60. Judging time is counted in control steps: after step k
  (0-based), t = (k + 1) / controlHz.
- `outcome.failure` ∈ `knocked | missed | slipped | timeout | cancelled` (cancelled = Stop
  pressed; such episodes are normally discarded).
- Episodes end 0.5 s after a successful lift, at the attempt time limit (10 s scripted, 60 s
  hand), or on Stop.

## Replay rule (parity)

Set `qpos`, `qvel`, `ctrl` from `start`, call forward; for each step set `data.ctrl = steps[k].ctrl`
and run `substeps` physics steps. The replay MUST give the same outcome: lifted or not. Episodes whose
time to lift differs are reported. Failure labels are not compared (a grasp controller may report its own, which
a replay cannot see). The max difference to `steps[k].qpos/qvel` is reported per episode, and the
share of episodes above 1e-6 is reported per file: contact events occasionally amplify the
engines' ~1e-11 differences (research R9, validation.md).
