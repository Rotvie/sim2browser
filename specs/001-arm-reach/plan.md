# Implementation Plan: Arm Reach

**Branch**: `001-arm-reach` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-arm-reach/spec.md`

## Summary

A static single-page demo: an SO-100 arm simulated live in the browser by MuJoCo compiled to
WebAssembly. Physics and control run in a Web Worker; three.js renders on the main thread.
Visitors pose joints (P1), drag a target that a damped-least-squares IK baseline follows (P2), and
switch to a PPO policy trained offline with MuJoCo in Python and rewarded for smooth motion (P3).
A live panel shows what the policy observes and outputs; an info panel documents the baseline
and reports measured results honestly. Parity comes from one shared XML and a `parity.json` that
only training writes, and is verified by fixture replay in CI. Thesis: smooth learned motion vs.
exact-but-mechanical classical motion.

## Technical Context

**Language/Version**: TypeScript 5.x (web app, evaluation, parity tests); Python 3.12 via uv
(training, export, fixtures)

**Primary Dependencies**: Web: `@mujoco/mujoco` (official WASM, single-threaded, pinned; fallback
`zalo/mujoco_wasm`), three.js, Vite. Training: `mujoco` (same version), Gymnasium,
Stable-Baselines3 (PyTorch).

**Storage**: N/A. Static files only.

**Testing**: Vitest (unit; parity in `tests/parity` under Node), Playwright (e2e desktop + mobile
emulation, perf, soak), pytest (training), headless Node evaluation (SC-003/004/009).

**Target Platform**: Evergreen desktop and mobile browsers with WebAssembly, WebGL, and Web
Workers; GitHub Pages via GitHub Actions. Training: any CPU machine.

**Project Type**: Static web app plus an offline training pipeline (no backend).

**Performance Goals**: Interactive ≤ 3 s on first visit; ≥ 30 fps, no frame gap > 100 ms on
mid-range devices without a discrete GPU; physics 500 Hz, control 50 Hz, off the main thread.

**Constraints**: No backend; ≤ 4 MB compressed before interactive; no COOP/COEP headers; policy
inference on CPU in plain TypeScript (no ONNX runtime, research R7); parity tolerances 1e-6
(trajectory) and 1e-5 (policy).

**Scale/Scope**: One robot, one page, one policy; three rungs, each deployed. Thresholds in
[research.md R12](./research.md): learned ≥ 95% success within 2 s; learned jerk ≥ 30% lower
than baseline.

No NEEDS CLARIFICATION remain. One open measurement: WASM binary size (R10).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Pre-research | Post-design | Evidence |
|-----------|--------------|-------------|----------|
| I. Browser-Only Runtime | PASS | PASS | Static build on GitHub Pages; sim, policy and rendering client-side; CPU inference in TS; single-threaded WASM in a plain worker (no special headers); SC-008 e2e check that no server requests are made. |
| II. Sim Parity | PASS | PASS | Same MuJoCo version; one XML; `parity.json` written only by training, read by everyone else; hash and version checks; `tests/parity` replay (1e-6 / 1e-5) blocks deploy. |
| III. Every Rung Shippable | PASS | PASS | P1/P2 need no training (`export --no-policy`); each rung has its own e2e tag and deploy. |
| IV. Learned vs. Engineered Visible | PASS | PASS | DLS IK baseline ships in P2; mode switch without reset; info panel documents the baseline design and shows the measured comparison, including shortfalls. |
| V. Minimal | PASS | PASS | One arm, one page, one policy. Runtime dependencies: `@mujoco/mujoco`, three.js. No UI framework, no inference runtime. The worker is justified below. |

## Project Structure

### Documentation (this feature)

```text
specs/001-arm-reach/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/     # parity-json, policy-artifact, parity-fixture, worker-protocol, ui
├── checklists/requirements.md
└── tasks.md       # /speckit-tasks
```

### Source Code (repository root)

```text
shared/                        # single source of truth
├── robot/
│   ├── so100_reach.xml        # derived from Menagerie SO-ARM100: jaw fixed, tip site, no collisions
│   └── assets/                # meshes
├── parity.json                # written by training/reach/export.py only
├── workspace.bin              # reachable-workspace voxel grid (export.py)
├── policy/                    # reach.json + reach.bin (P3)
└── parity/                    # fixtures (P3)

web/
├── index.html
├── src/
│   ├── main.ts                # boot, loading/error states, render loop
│   ├── worker.ts              # thin adapter: messages ↔ sim/control
│   ├── sim/                   # mujoco loader, stepping clock, obs builder, reach check (no DOM)
│   ├── control/               # modes, manual, baseline (DLS IK), policy (MLP) (no DOM)
│   ├── render/                # scene, arm meshes, target gizmo, camera, interpolation
│   └── ui/                    # mode switch, observe/output panel, info panel, hint, messages
├── scripts/                   # eval.ts, eval-compare.ts, size.ts
├── tests/                     # unit/, e2e/
├── vite.config.ts             # serves/copies ../shared as static assets
└── package.json

training/
├── pyproject.toml             # uv
├── reach/                     # env.py, train.py, export.py, make_fixtures.py
└── tests/

tests/
└── parity/                    # Vitest, Node: replays shared/parity fixtures on web/src/sim + control

.github/workflows/ci.yml       # unit, parity, eval, e2e → deploy to Pages (blocked on parity failure)
```

**Structure Decision**: `web/` (shipped), `training/` (offline), and `shared/` (artifacts). The
parity tests are top-level in `tests/parity`, because they span both sides: they import
`web/src/sim` and `web/src/control` and consume fixtures produced by `training/`.

## Complexity Tracking

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|-------------------------------------|
| Two languages (TS + Python) | The browser needs TS/WASM; the training ecosystem is Python | Training in the browser is out of scope; Python can't run in the demo |
| Web Worker for physics + policy | Keeps rendering and input smooth on phones (SC-002) | Main-thread stepping can drop frames on slow devices; the cost is kept to one thin adapter file |
| Load-time fallback (kinematic posing before WASM is ready) | Only if WASM measurement breaks the 3 s budget | Held in reserve; not built unless measured necessary |
