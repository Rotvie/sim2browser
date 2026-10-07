# Implementation Plan: Learned Grasping

**Branch**: `004-learned-grasping` (spec directory) | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-learned-grasping/spec.md`

## Summary

A grasp policy learned from demonstrations joins the 002 page next to the scripted grasp. One
recorder on the shared `Session` records grasp episodes as raw simulator state (gzipped JSON
Lines, training-method-independent): in the browser behind `?record` for hand demonstrations,
and headless in Node for 2,000 scripted grasps with DART noise injection (R1–R3). Python trains a
behavior-cloning MLP (32 inputs → 2×256 tanh → 6 outputs: 5 joint-target changes + gripper) on
the mix, with hand demonstrations weighted to a fixed batch share (R4–R6). The policy runs in the
existing TypeScript MLP runtime; its layout lives in `parity.json` v4 (R10). Grasp attempts are
judged by a session-level monitor for every controller with `task: "grasp"`, so the scripted
grasp, the learned grasp and any future plug-in are graded the same way (R7, R11). Evaluation
writes one report per grasp controller on 002's 100 placements; the learned grasp ships only at
≥ 80% (FR-015), else 004 closes with the recording, plug-in surface and evaluation shipped.

## Technical Context

**Language/Version**: TypeScript 6.x (web app, recorder, evaluation, demo generation, parity
tests); Python 3.12 via uv (demo replay, behavior cloning, export, fixtures). Unchanged.

**Primary Dependencies**: Unchanged. Web: `@mujoco/mujoco` 3.14.0, three.js; browser
`CompressionStream` and Node `zlib` for gzip. Training: `mujoco` 3.14.0, PyTorch (already pulled
in by Stable-Baselines3) for behavior cloning. No new dependencies.

**Storage**: Static files only. New shipped: `shared/policy/grasp.{bin,json}`,
`shared/grasp-eval/<id>.json`. New committed training data:
`training/demos/hand.demos.jsonl.gz` (~2 MB). Scripted demonstrations regenerated, gitignored.

**Testing**: Vitest (unit; parity under Node), Playwright (e2e, perf, soak), pytest (demos,
imitation, export), headless Node evaluation (`eval`, `eval:compare`, `eval:grasp
--controller`).

**Target Platform**: Evergreen desktop and mobile browsers; GitHub Pages. Recording mode targets
desktop Chromium (one demonstrator). Unchanged otherwise.

**Project Type**: Static web app plus an offline training pipeline (no backend). Unchanged.

**Performance Goals**: Unchanged from 001/002: interactive ≤ 3 s, ≥ 30 fps, no stall > 100 ms
(CI tolerance 150 ms on mobile WebKit, 002 open item). Grasp policy inference ≈ 75k
multiply-adds per 20 ms control step (R4), negligible next to physics. Demo generation:
probe 100 scripted grasps in 3.5 s headless (R1).

**Constraints**: No backend, no uploads (Principle I). Grasp policy weights ≈ 300 KB raw
(32×256 + 256×256 + 256×6 floats), loaded on first selection of Learned grasp, not before
interactive. Parity tolerances: observation 1e-9, network 1e-5, trajectory 1e-6 (R9).

**Scale/Scope**: One robot, one page, two policies (reach, grasp), two public grasp controllers
plus one lab example. Training data: 2,000 scripted + ≥ 20 hand episodes. Three training seeds.
Release bar ≥ 80% on 100 evaluation placements.

No NEEDS CLARIFICATION remain (spec Q1: mostly scripted + ≥ 20 hand; Q2: ship at ≥ 80%).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Pre-research | Post-design | Evidence |
|-----------|--------------|-------------|----------|
| I. Browser-Only Runtime | PASS | PASS | Learned grasp inference in TypeScript on the CPU; recording stays in the tab and leaves only as a user-initiated download; no upload path. Static-only e2e check kept (SC-009). |
| II. Sim Parity | PASS | PASS | Grasp policy layout, normalization and action scale only in `parity.json` v4 written by `export.py`; same model file; three parity checks: observation + network fixture, closed-loop learned grasp replay, every demonstration replays in Python (R9). Demo files carry the parity hash and are rejected on mismatch. |
| III. Every Rung Shippable | PASS | PASS | P1 (recording mode + plug-in surface + per-controller eval, scripted numbers re-measured) deploys alone; P2 (learned grasp) only at ≥ 80%; P3 (comparison panel, parity) completes it. If P2 misses the bar, P1 + P3 without a grasp policy is the shipped rung (as 003). |
| IV. Learned vs. Engineered Visible | PASS | PASS | Scripted grasp (002) is the baseline, unchanged in behavior; both selectable on the same placement via Retry; both measured by the same monitor and evaluation (R7). |
| V. Minimal | PASS | PASS | Same robot and page. No new dependencies. Second policy is justified: grasping is a new task (one policy per task). New abstractions limited to `task` on `ControllerDef` and the attempt monitor, both with ≥ 2 users now (scripted, learned, naive example). Recording mode is ~1 card + 1 module. Deleted: scripted grasp's own not-graspable check (moved to the monitor), the hard-coded `"grasp"` id checks in `session.ts`. Rejected: task framework, IndexedDB, diffusion/ACT, Python port of the expert. |

Release gates 1–4 all apply (learned behaviors ship).

## Project Structure

### Documentation (this feature)

```text
specs/004-learned-grasping/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/     # demo-file, grasp-policy (+ parity.json v4), grasp-controller-plugin, grasp-eval v2, ui
├── checklists/requirements.md
└── tasks.md       # /speckit-tasks
```

### Source Code (repository root)

Changes relative to 002/003; unlisted files are unchanged.

```text
shared/
├── parity.json                    # v4: + graspPolicy (export.py only)
├── policy/
│   ├── reach.json                 # parityVersion 4, same weights
│   ├── grasp.bin                  # NEW (only if the release bar is met)
│   └── grasp.json                 # NEW header: trainedWith.demos, metrics
├── grasp-eval/                    # NEW dir; replaces grasp-eval.json
│   ├── grasp.json                 # scripted, format v2
│   └── learned-grasp.json         # learned
└── parity/
    ├── grasp-policy-recorded.json # NEW: states → obs → action (Python)
    ├── learned-grasp-actions.json # NEW: ctrl sequence of one learned grasp (Node)
    └── learned-grasp-recorded.json# NEW: Python replay

web/src/
├── protocol.ts                    # + record, retry messages; grasp snapshot by task
├── sim/
│   ├── graspAttempt.ts            # NEW: attempt monitor (R7)
│   ├── recorder.ts                # NEW: demo recorder + gzip JSONL writer (R1, R3)
│   ├── observation.ts             # field builders generalized; + grasp fields (R5)
│   ├── session.ts                 # task-based grasp handling, monitor, retry, recorder hook
│   ├── parity.ts                  # v4 validation, graspPolicy types
│   └── eval.ts                    # runGraspEpisode(session, placement, controllerId) via monitor
├── control/
│   ├── learnedGrasp.ts            # NEW: grasp policy controller
│   ├── naiveGrasp.ts              # NEW: lab example (SC-010)
│   ├── policy.ts                  # loadPolicy(read, section) for reach or grasp
│   ├── grasp.ts                   # not-graspable check removed (monitor owns it)
│   ├── modes.ts                   # GraspState gains controller/outcome
│   └── registry.ts                # + task field, learnedGrasp, naiveGrasp
└── ui/
    ├── recordPanel.ts             # NEW: ?record card
    ├── graspStatus.ts             # + Retry, learned outcome display
    ├── modeSwitch.ts              # relabel, 360 px fit
    ├── panel.ts                   # policy view for grasp inputs/outputs
    └── infoPanel.ts               # per-controller grasp table + demo line
web/scripts/
├── demos.ts                       # NEW: npm run demos (headless scripted demos, DART noise)
├── eval-grasp.ts                  # --controller, per-controller output
└── record-grasp.ts                # --controller
web/tests/unit/                    # + recorder, graspAttempt, learnedGrasp, naiveGrasp plug-in
web/tests/e2e/                     # + learned-grasp-p1/p2/p3.spec.ts (@lg1–3)

training/
├── demos/                         # NEW: hand.demos.jsonl.gz committed; scripted-* gitignored
├── reach/
│   ├── demos.py                   # NEW: read/validate/replay demo files; grasp observation
│   ├── imitate.py                 # NEW: behavior cloning, selection via Node eval
│   ├── export.py                  # --grasp-run; parity v4
│   ├── spec.py                    # PARITY_VERSION 4, graspPolicy validation
│   └── make_fixtures.py           # grasp-policy-recorded, learned-grasp-recorded
└── tests/
    ├── test_demos.py              # NEW: header, replay, disjointness (FR-018)
    └── test_imitate.py            # NEW: smoke training on a tiny demo file; export round trip

tests/parity/
├── policy.test.ts                 # + grasp obs/network fixture
├── trajectory.test.ts             # + learned-grasp-recorded
└── versions.test.ts               # v4 checks
.github/workflows/ci.yml           # eval:grasp --check per controller
```

**Structure Decision**: Same three-part layout (`web/` shipped, `training/` offline, `shared/`
artifacts). The Python package keeps the name `reach/` (002 decision; renaming touches every
script for no gain); new modules `demos.py` and `imitate.py` sit beside `grasp.py`. Training
selects runs by calling the Node evaluation on the selection placements, so model selection runs
on the shipped code path rather than a Python re-implementation of the session.

## Phases and order

1. **P1 (shippable alone)**: `task` on `ControllerDef`, attempt monitor, per-controller eval
   (scripted re-measured, must reproduce 100% / 4.46 s), recorder + `?record` + `npm run demos`,
   Python replay/validation, naive-grasp plug-in. parity.json stays v3 here unless a value
   changes.
2. **P2**: grasp observation (TS + Python), imitation training, three seeds, selection, export
   (v4), learned grasp controller, Retry, policy view. Release-bar decision recorded in
   `validation.md` before deploy.
3. **P3**: info panel comparison, parity fixtures and tests, CI checks, e2e, soak, README and
   roadmap.

## Complexity Tracking

No constitution violations. Noted trade-offs:

| Choice | Why | Simpler alternative rejected because |
|--------|-----|-------------------------------------|
| Attempt monitor in the session | Learned and future grasps must be graded by the same judge, not by themselves | Controller self-reporting lets a plug-in grade itself |
| Second shipped policy | Grasping is a new task (one policy per task) | Folding grasp into the reach policy changes the shipped reach behavior |
| Recording mode on the public build (hidden) | Demonstrations must come from the shipped simulation | A separate recording page is a second page (Principle V) |
