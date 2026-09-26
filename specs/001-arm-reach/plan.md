# Implementation Plan: Arm Reach

**Branch**: `001-arm-reach` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-arm-reach/spec.md`

## Summary

A static single-page demo: a Franka Panda arm simulated live in the browser by MuJoCo compiled
to WebAssembly, rendered with three.js. Visitors pose joints (P1), drag a target that a
damped-least-squares IK baseline follows (P2), and switch to a PPO policy trained offline with
MuJoCo in Python, rewarded for smooth motion (P3). A live panel shows what the policy observes and
outputs. Parity between training and browser is guaranteed by one shared model file and
`env-spec.json`, and verified by replaying fixtures. The demo thesis is motion quality: smooth
learned motion vs. exact-but-mechanical classical motion.

## Technical Context

**Language/Version**: TypeScript 5.x (browser demo, evaluation, parity tests); Python 3.12
(training, export, fixtures)

**Primary Dependencies**: Web: `@mujoco/mujoco` (official WASM, single-threaded, pinned),
three.js, Vite. Train: `mujoco` (same version), Gymnasium, Stable-Baselines3 (PyTorch).

**Storage**: N/A. Static files only (model, meshes, `env-spec.json`, policy weights).

**Testing**: Vitest (unit + parity in Node), Playwright (e2e desktop + mobile emulation, perf,
soak), pytest (training side), headless evaluation script (SC-003/004/009).

**Target Platform**: Evergreen desktop and mobile browsers with WebAssembly + WebGL (Chrome,
Safari/iOS, Firefox, from the last 2 years); static hosting on GitHub Pages. Training: any CPU
machine.

**Project Type**: Static web app plus an offline training pipeline (no backend).

**Performance Goals**: Interactive ≤ 3 s on first visit (4G/broadband); ≥ 30 fps with no gap
> 100 ms on mid-range devices without a discrete GPU; 50 Hz control, 500 Hz physics.

**Constraints**: No backend (Principle I); ≤ 4 MB compressed transfer before interactive; no
COOP/COEP headers needed; policy inference on CPU in plain TypeScript; parity tolerances per
[contracts/parity-fixture.md](./contracts/parity-fixture.md).

**Scale/Scope**: One robot, one page, one policy; three rungs (P1, P2, P3), each deployed.
Committed thresholds are in [research.md R11](./research.md).

No NEEDS CLARIFICATION remain. One open measurement: the WASM binary size (R9), with ordered
mitigations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Pre-research | Post-design | Evidence |
|-----------|--------------|-------------|----------|
| I. Browser-Only Runtime | PASS | PASS | Static Vite build on GitHub Pages; sim, policy, rendering all client-side; MLP in plain TS on CPU; single-threaded WASM, no special headers; SC-008 e2e check that no server requests are made. WebGL on integrated/mobile GPUs is not a discrete-GPU requirement. |
| II. Sim Parity | PASS | PASS | Same MuJoCo version both sides; one `panda_reach.xml`; `env-spec.json` single source for timestep, frame skip, obs/action layout, normalization; hash checks; fixture replay tests in CI block release (R10). |
| III. Every Rung Shippable | PASS | PASS | P1, P2, P3 each have their own e2e tag, validation steps, and deploy (quickstart). P1 ships without training; P2 without the policy. |
| IV. Learned vs. Engineered Visible | PASS | PASS | DLS IK baseline ships in P2, before the learned policy; mode switch without reset; panel names both algorithms; FR-018 honesty note (R6). |
| V. Minimal | PASS | PASS | One arm, one page, one policy. No UI framework, no inference runtime, no backend. Runtime dependencies: `@mujoco/mujoco` and three.js only. |

Release gates (constitution workflow) map to: `npm run test:parity`, `@p2/@p3` e2e baseline and
switch checks, `npm run build` + SC-008 check, and live deploy.

## Project Structure

### Documentation (this feature)

```text
specs/001-arm-reach/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1: env-spec, policy-artifact, parity-fixture, ui
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
shared/                      # single source of truth, read by train/ and web/
├── robot/
│   ├── panda_reach.xml
│   └── meshes/              # decimated visual meshes
├── env-spec.json
├── policy/                  # reach.json + reach.bin (P3)
└── parity/                  # fixtures (P3)

web/
├── index.html
├── src/
│   ├── main.ts              # boot, loading/error states, loop
│   ├── sim/                 # mujoco loader, stepping, obs builder, reach check
│   ├── control/             # modes.ts, manual.ts, baseline.ts (DLS IK), policy.ts (MLP)
│   ├── render/              # scene, arm meshes, target gizmo, orbit
│   └── ui/                  # mode switch, panel, hint, messages
├── scripts/
│   ├── eval.ts              # headless SC-003/004/009 evaluation
│   └── size.ts              # load-budget check
├── tests/
│   ├── unit/
│   ├── parity/
│   └── e2e/
├── vite.config.ts           # serves/copies ../shared as static assets
└── package.json

train/
├── pyproject.toml
├── reach/
│   ├── env.py               # Gymnasium env reading shared/env-spec.json
│   ├── train.py             # PPO
│   ├── export.py            # weights + normalization stats + maxReach + hashes
│   └── make_fixtures.py
└── tests/

.github/workflows/ci.yml     # unit, parity, eval, e2e, deploy to Pages
```

**Structure Decision**: Two small projects (`web/` shipped, `train/` offline) around a
`shared/` artifact directory. This is the minimal split: training needs Python and the demo
needs a browser, and `shared/` makes parity values impossible to duplicate by hand.

## Complexity Tracking

No constitution violations. Two items worth recording:

| Item | Why Needed | Simpler Alternative Rejected Because |
|------|------------|-------------------------------------|
| Two languages (TS + Python) | The browser needs TS/WASM; training tooling is mature only in Python | Training in TS/browser is out of scope and much slower; a Python-only demo can't run in the browser |
| Load-time fallback (kinematic posing before WASM is ready) | Only if the WASM measurement breaks the 3 s budget (R9) | Held in reserve; not built unless the measurement requires it, because it adds a second code path |
