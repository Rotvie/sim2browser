# Implementation Plan: Grasp

**Branch**: `002-grasp` (spec directory) | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-grasp/spec.md`

## Summary

The 001 page gets the SO-100's gripper back and a 30 mm cube on a collidable floor. The robot
model regains Menagerie's jaw joint, collision geometry, finger pads and grasp contact settings
(research R1). Visitors open and close the gripper from a toolbar button while any reaching
controller follows the target, so they can pick the cube up by hand (P1). A new public "Grasp"
mode runs a scripted top-down grasp built on the 001 DLS controller: approach, descend, close,
lift, hold, with visible phases and honest failure reasons (P2, R5). A headless evaluation on the
shipped code path measures the grasp over 100 fixed placements and writes the numbers the info
panel shows; CI re-runs it and requires the same result (P3, R6). Contact parity is checked by
two new fixtures at the existing 1e-6 tolerance; a planning probe measured 1.6e-11 (R2). The 001
reach policy is re-measured on the new model and retrained only below a threshold fixed in
advance (R7).

## Technical Context

**Language/Version**: TypeScript 6.x (web app, evaluation, parity tests); Python 3.12 via uv
(export, fixtures, retraining if needed). Unchanged from 001.

**Primary Dependencies**: Unchanged. Web: `@mujoco/mujoco` 3.14.0, three.js. Training:
`mujoco` 3.14.0, Gymnasium, Stable-Baselines3. No new dependencies.

**Storage**: N/A. Static files only; new shipped file `shared/grasp-eval.json`.

**Testing**: Vitest (unit; parity under Node), Playwright (e2e, perf, soak), pytest (training),
headless Node evaluation (`eval`, `eval:compare`, new `eval:grasp`).

**Target Platform**: Evergreen desktop and mobile browsers; GitHub Pages. Unchanged.

**Project Type**: Static web app plus an offline training pipeline (no backend). Unchanged.

**Performance Goals**: Unchanged from 001: interactive ≤ 3 s, ≥ 30 fps, no frame gap > 100 ms;
physics 500 Hz, control 50 Hz in the worker. Measured physics cost with contacts: 7.2 µs/step
(was 4.7) in WASM on a laptop (R10).

**Constraints**: No backend; ≤ 4 MB compressed before interactive (+~45 KB raw of collision
meshes); trajectory parity 1e-6 including contacts (R2); policy parity 1e-5 unchanged.

**Scale/Scope**: One robot, one page, one learned policy (reach) and one scripted grasp; three
rungs (P1–P3), each deployed. Thresholds: grasp success ≥ 90% over 100 placements, median time
to lift ≤ 6 s (spec SC-003/SC-004); reach policy retrain trigger < 91% (300 targets) or jerk
ratio > 0.75 (R7).

No NEEDS CLARIFICATION remain.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Pre-research | Post-design | Evidence |
|-----------|--------------|-------------|----------|
| I. Browser-Only Runtime | PASS | PASS | Grasp controller, contacts and evaluation numbers all static/client-side; `grasp-eval.json` is a static file; SC-009 keeps the no-server e2e check. |
| II. Sim Parity | PASS | PASS | One model file (`so100.xml`) for training and browser; every new value (gripper, cube, grasp parameters, region) in `parity.json` v3, written only by training; two contact fixtures at 1e-6 (probe: 1.6e-11); hash and version checks extended. |
| III. Every Rung Shippable | PASS | PASS | P1 (gripper + cube by hand), P2 (scripted grasp), P3 (metrics + panel) each deploy on their own; P1 already requires the reach policy re-measure so the live page never runs an unmeasured policy. |
| IV. Learned vs. Engineered Visible | PASS | PASS | Reach keeps Learned vs. Baseline. Grasp ships no learned behavior; the scripted grasp is the baseline 003 will be compared against, and is not weakened (FR-014). |
| V. Minimal | PASS | PASS | Same robot, same page; no new dependencies, pages or robots. New code: one controller (`grasp.ts`), one gripper helper, cube drag in the existing picking code, one eval script, one recording script. The grasp reuses the 001 DLS step rather than adding an orientation IK (R5). Primitive collision shapes rejected in favor of the meshes already shipped (R1). |

Release gates: 002 adds no learned behavior, but the 001 policy keeps shipping, so all four
gates apply (constitution "Development Workflow").

## Project Structure

### Documentation (this feature)

```text
specs/002-grasp/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/     # parity-json, parity-fixture, worker-protocol, grasp-eval, ui (deltas vs. 001)
├── checklists/requirements.md
└── tasks.md       # /speckit-tasks
```

### Source Code (repository root)

Changes relative to 001; unlisted files are unchanged.

```text
shared/
├── robot/
│   ├── so100.xml              # renamed from so100_reach.xml; jaw, collisions, floor, cube (R1)
│   ├── README.md              # modifications list updated
│   └── assets/                # + 5 jaw collision meshes from Menagerie
├── parity.json                # v3: + gripper, cube, grasp (export.py only)
├── grasp-eval.json            # NEW: GraspEvalReport, written by web/scripts/eval-grasp.ts
├── policy/reach.json          # header: parityVersion 3, re-measured metrics (R7)
└── parity/
    ├── contact-random.json    # NEW fixture (make_fixtures.py)
    ├── grasp-actions.json     # NEW: ctrl sequence recorded from the TS grasp controller
    └── grasp-recorded.json    # NEW fixture: Python replay of grasp-actions.json

web/src/
├── protocol.ts                # + setGripper, setCube, grasp state in snapshots
├── sim/
│   ├── mujoco.ts              # nu ≠ joints; jaw + cube accessors; box/plane geoms for rendering
│   ├── arm.ts                 # + gripper target (same clip/speed path)
│   ├── cube.ts                # NEW: cube pose get/set, region test, clamp for drags
│   ├── session.ts             # gripper command, cube, target-drag cancel, reset
│   └── eval.ts                # + grasp episode + success detection (R6)
├── control/
│   ├── grasp.ts               # NEW: scripted grasp phase machine (R5)
│   ├── modes.ts               # + reason "target-drag"
│   └── registry.ts            # + grasp ControllerDef (public)
├── render/
│   ├── arm.ts                 # renders box geoms (cube); skips collision group 3
│   └── picking.ts             # + cube drag on the floor
└── ui/
    ├── gripperButton.ts       # NEW: open/close toggle (key G)
    ├── graspStatus.ts         # NEW: phase chip + "Grasp again"
    └── infoPanel.ts           # + grasp section from grasp-eval.json
web/scripts/
├── eval-grasp.ts              # NEW: npm run eval:grasp
└── record-grasp.ts            # NEW: writes shared/parity/grasp-actions.json
web/tests/unit/                # + gripper, cube, grasp controller, grasp eval
web/tests/e2e/                 # + grasp-p1/p2/p3.spec.ts, one per story

training/reach/
├── spec.py                    # PARITY_VERSION 3, MODEL_PATH, validation
├── export.py                  # gripper, cube, grasp (region, wrist offsets); qpos by address
├── env.py                     # ctrl by actuator id; jaw held closed; cube at default pose
└── make_fixtures.py           # contact-random, grasp-recorded

tests/parity/
├── trajectory.test.ts         # + contact-random, grasp-recorded (full qpos/qvel incl. cube)
└── versions.test.ts           # v3 checks
.github/workflows/ci.yml       # + eval:grasp reproducibility check
```

**Structure Decision**: Same three-part layout as 001 (`web/` shipped, `training/` offline,
`shared/` artifacts). The training package keeps the name `reach/`: it still trains only the
reach policy, and renaming it touches every 001 script for no gain (Principle V). The grasp
controller lives only in TypeScript; Python replays its recorded commands for parity (R8).

## Phasing (one deploy per story)

1. **P1 – gripper and cube by hand**: model change (R1), parity.json v3, sim/arm/session support,
   gripper button, cube rendering and drag, contact-random fixture, reach re-measure (R7) and
   any retrain, e2e: pick up the cube by hand.
2. **P2 – scripted grasp**: `grasp.ts`, Grasp mode, phase chip, cancel paths, record-grasp +
   grasp-recorded fixture, e2e: grasp lifts the cube from a fixed placement.
3. **P3 – honest metrics**: `eval:grasp`, `grasp-eval.json`, info panel section, CI
   reproducibility check, `validation.md` entries; re-measure 001 SCs (SC-008).

## Risks

| Risk | Early signal | Response |
|------|--------------|----------|
| Floor/self contact blocks low or folded reach targets (R7) | Reach re-measure in P1 | Raise `reach.minZ`, document; retrain only past the R7 threshold |
| Grasp fixture diverges > 1e-6 | `grasp-recorded` parity test | Measure, set documented per-component tolerance in `validation.md` (R2) |
| Cube slips in the pinch grasp | Eval failure reason `slipped` | Tune grasp height / close settle; pad friction stays Menagerie's |
| Scripted grasp < 90% | `eval:grasp` | Report as measured (SC-003 shown as a miss), then improve; never shrink the region to pass |
| Contact cost on phones | P1 perf e2e | Capsule collision geometry for links (R1 alternative) |

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|-------------------------------------|
| TS-recorded ctrl sequence replayed in Python (`grasp-actions.json`) | Parity must cover the contacts the shipped grasp produces; Python stays the reference | A Python copy of the grasp controller duplicates logic that would itself need parity |
| Committed `grasp-eval.json` checked by CI | Panel numbers must be exactly the measured ones (FR-015) | Computing in the browser costs ~2 min of CPU per visitor |
