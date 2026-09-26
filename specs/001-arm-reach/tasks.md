---

description: "Task list for 001-arm-reach"
---

# Tasks: Arm Reach

**Input**: Design documents from `specs/001-arm-reach/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. The constitution makes parity tests a release gate (Principle II), and the
spec's success criteria (SC-001–SC-009) and acceptance scenarios are verified by the evaluation
script and Playwright e2e tests defined in the plan (research R11). Test tasks come before the
implementation they verify and are expected to fail first.

**Naming**: the project was renamed from web-robot to **sim2browser** on 2026-09-26, before it was
published. Completed task text keeps the original name as a record; open tasks use the new one.

**Organization**: One phase per user story (P1 → P2 → P3). Each story ends in a public deploy
(constitution Principle III).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1 = see and pose the arm, US2 = baseline reaches target, US3 = learned vs. baseline

## Path Conventions (from plan.md)

- `web/` shipped app (TypeScript, Vite, three.js, `@mujoco/mujoco`)
- `training/` offline Python (uv, MuJoCo, Gymnasium, Stable-Baselines3)
- `shared/` single source of truth: `robot/`, `parity.json`, `policy/`, `parity/`
- `tests/parity/` cross-side parity tests (Vitest under Node)
- Simulation and control modules under `web/src/sim/` and `web/src/control/` MUST NOT import DOM or
  worker APIs (worker-protocol rule), so Node tests and evaluation can import them.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project skeleton and toolchains on both sides, pinned to the same MuJoCo version.

- [X] T001 Create the directory skeleton from plan.md: `shared/robot/assets/`, `shared/policy/`, `shared/parity/`, `web/src/{sim,control,render,ui}/`, `web/scripts/`, `web/tests/{unit,e2e}/`, `training/reach/`, `training/tests/`, `training/scripts/`, `tests/parity/`, `.github/workflows/`, each with a `.gitkeep` where it would otherwise be empty
- [X] T002 Pin MuJoCo: find the highest version published both as npm `@mujoco/mujoco` and as the PyPI `mujoco` wheel (for macOS arm64 and Linux x86_64), and record it with the date checked in `shared/MUJOCO_VERSION` (a single line, e.g. `3.14.0`). If the official npm bindings cannot load a model with mesh assets in both a browser and Node, record that in `specs/001-arm-reach/validation.md` and switch to the `zalo/mujoco_wasm` fallback built at the same version (research R1)
- [X] T003 Initialize `web/package.json` (private, `"type": "module"`) with exact-pinned dependencies `@mujoco/mujoco@<shared/MUJOCO_VERSION>` and `three`, and dev dependencies `vite`, `typescript`, `@types/three`, `vitest`, `@playwright/test`, `eslint`, `prettier`. Scripts: `dev`, `build`, `preview`, `test` (vitest unit), `test:e2e` (playwright), `eval` (`tsx scripts/eval.ts`), `eval:compare` (`tsx scripts/eval-compare.ts`), `size` (`tsx scripts/size.ts`), `lint`. Add `tsx` as a dev dependency. Add `web/tsconfig.json` (strict, ES2022, `moduleResolution: bundler`, `lib: [ES2022, DOM, WebWorker]`)
- [X] T004 [P] Initialize `training/pyproject.toml` for uv: Python `>=3.12,<3.13`, dependencies `mujoco==<shared/MUJOCO_VERSION>`, `gymnasium`, `stable-baselines3`, `torch` (CPU wheels via a uv index for `pytorch-cpu`), `numpy`; dev dependencies `pytest`, `ruff`. Package `reach` in `training/reach/__init__.py`. Run `uv sync` to produce `training/uv.lock`
- [X] T005 [P] Configure lint/format: `web/eslint.config.js` + `web/.prettierrc` (TypeScript), and a `[tool.ruff]` section in `training/pyproject.toml`
- [X] T006 [P] Create `tests/parity/vitest.config.ts` (environment `node`, include `tests/parity/**/*.test.ts`, alias `@web` → `web/src`), and add root `package.json` scripts `test:parity` → `vitest run --config tests/parity/vitest.config.ts`, using the `web/` toolchain via a workspace (`"workspaces": ["web"]`)
- [X] T007 [P] Create `web/playwright.config.ts`: projects `desktop-chromium`, `mobile-chromium` (Pixel 7 device), `mobile-webkit` (iPhone 14 device); `webServer` = `npm run build && npm run preview -- --port 4173`; `baseURL` `http://localhost:4173/web-robot/`; tag grep support (`@p1`, `@p2`, `@p3`, `@soak`); a shared fixture `web/tests/e2e/fixtures.ts` that, on the `mobile-chromium` project, applies CDP `Emulation.setCPUThrottlingRate` with rate 4 (a mid-range phone) before each test

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Robot model, `parity.json`, the MuJoCo sim wrapper, the worker, and the empty render
loop, which every story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Robot model and parity.json (training writes, web reads)

- [X] T008 Derive `shared/robot/so100_reach.xml` from the MuJoCo Menagerie `trs_so_arm100` model: copy the required mesh files to `shared/robot/assets/`; fix the jaw joint closed (remove its joint and actuator); keep position actuators for the 5 arm joints; add site `tip` at the jaw tip and site `shoulder` at the shoulder-pitch joint origin; set `contype="0" conaffinity="0"` on all geoms (no collisions); set `<option timestep="0.002"/>`; make sure every body has an explicit `<inertial>` (copy the values Menagerie's compiled model computes if the source XML relies on `inertiafromgeom`), so mesh changes can never change the physics (contracts/parity-json.md rule). Record the Menagerie commit hash, license (Apache-2.0), and every modification in `shared/robot/README.md`. List the actual joint names found and update the `joints` example in `specs/001-arm-reach/contracts/parity-json.md` if they differ
- [X] T009 Write `training/reach/spec.py`: dataclasses mirroring [contracts/parity-json.md](./contracts/parity-json.md), `load_parity(path)` and `write_parity(obj, path)`; `sha256_model(files)` (SHA-256 over sorted `path\0bytes\0` of the XML and every referenced asset, per contracts/parity-json.md); validation that raises on `timestep × substeps ≠ 1 / controlHz` (to 1e-12), on observation `size ≠ Σ field sizes`, and on action `size ≠ len(joints)`
- [X] T010 Write `training/reach/export.py` with `--no-policy` mode: load `shared/robot/so100_reach.xml` with Python `mujoco`; assert `mujoco.__version__` equals `shared/MUJOCO_VERSION`; compute `maxReach` as the maximum `‖tip − shoulder‖` over 200,000 seeded uniform joint samples within limits; set `neutralPose` to the midpoint of each joint range (clipped to keep the tip above `minZ`); build the `reach.workspace` occupancy grid (voxel 1 cm, bounds = the FK sample bounding box plus 2 cm; mark voxels hit by the 200,000 FK tip samples plus 800,000 more; dilate by one voxel, then erode by one) and write it bit-packed to `shared/workspace.bin` with its sha256, origin, voxel size and dims; write `shared/parity.json` with every section in the contract except `observation.normalization` and `policy` (omitted when `--no-policy`), including `model.sha256` + `model.files` and `mujocoVersion`
- [X] T011 Write `training/tests/test_spec.py`: round-trip of `parity.json`; validation errors for a bad timestep/substeps product and a wrong observation size; `maxReach > 0`; joint names in `parity.json` exist in the XML
- [X] T012 Run `uv run python -m reach.export --no-policy` and commit the generated `shared/parity.json`

### Sim core (web, no DOM)

- [X] T013 [P] Write `web/src/sim/parity.ts`: TypeScript types for `parity.json`; `loadParity(fetchLike, baseUrl)` that checks: `version === 1`; `mujocoVersion` equals the loaded MuJoCo module's version; `sha256Model(model.files) === model.sha256` (same algorithm as `training/reach/spec.py`) (via `crypto.subtle`, available in browsers, workers and Node 22); `timestep × substeps` = `1/controlHz`. On any failure it throws `ParityError` with a `code` of `version-mismatch` or `hash-mismatch`
- [X] T014 [P] Write `web/src/sim/mujoco.ts`: `createSim(parity, files)` loads `@mujoco/mujoco` (works in a module worker and in Node), writes the XML and `assets/*` into the MuJoCo virtual FS, compiles the model, asserts `model.opt.timestep === parity.timestep`, and exposes `stepPhysics(n)`, `q()`, `qd()` (joint addresses resolved by name from `parity.joints`), `setCtrl(Float64Array)`, `ctrl()`, `sitePos(name)`, `bodyPoses()` (`xpos`, `xquat` as `Float64Array`), `jointLimits()`, `resetToPose(q)`, and `jacSite(name)` (3×nv translational Jacobian via `mj_jacSite`; if the binding does not expose it, fall back to central finite differences over `mj_kinematics` on a scratch `MjData` and document that in a code comment)
- [X] T015 [P] Write `web/src/sim/clock.ts`: `createClock({ controlHz, maxStepsPerTick: 5 })` with `tick(nowMs) → nSteps` using an accumulator, dropping excess time beyond 5 steps (the sim slows down instead of taking large steps), and `pause()` / `resume(nowMs)` that reset the accumulator (no catch-up burst). Pure logic with an injected clock (research R13)
- [X] T016 [P] Write `web/src/sim/arm.ts`: `Arm` wrapper over the sim with `limits`, `setJointTarget(i, angle)` → `ctrl[i] = clip(angle, min_i, max_i)`, and `applyDelta(delta, maxPerStep)` → `ctrl = clip(ctrl + clip(delta, ±maxPerStep), min, max)`. Enforces the data-model rule "`ctrl[i]` is always clipped to `limits[i]` (FR-005)"
- [X] T017 [P] Write `web/src/control/modes.ts`: `ControlMode = "manual" | "baseline" | "learned"`; a `Controller` interface `{ name; enter(state): void; step(state): void }`; and `ModeMachine` implementing the data-model transition table exactly: any + `setMode` → requested mode; `baseline`/`learned` + `dragJoint` → `manual` (reason `joint-grab`); any + `reset` → same mode, default arm and target; `learned` + policy load/hash failure → `baseline` (reason `policy-load-failed`). `learned` is only selectable when a learned controller is registered. A switch MUST NOT modify `q`, `qd`, or the target position (FR-012)
- [X] T018 [P] Write `web/src/control/manual.ts`: a controller that leaves `ctrl` unchanged (joint targets are set only by `dragJoint`)
- [X] T019 Write `web/src/sim/session.ts`: `createSession({ sim, parity, controllers })` composing Arm, ModeMachine, and Clock; methods `dragJoint(i, angle)`, `setMode(mode)`, `reset()`, `setHidden(bool)`, `tick(nowMs)` (for each control step: active controller `step`, then `sim.stepPhysics(parity.substeps)`), and `snapshot()` returning the shape in [contracts/worker-protocol.md](./contracts/worker-protocol.md) (without target fields until US2). No DOM or worker imports
- [X] T020 Write `web/src/protocol.ts` (message types from worker-protocol.md) and `web/src/worker.ts`: a thin adapter that fetches `parity.json`, the XML and assets from `baseUrl`, creates the session, replies `ready { joints, limits, bodies, maxReach }` or `error { code, message }`, maps incoming messages to session methods, runs `tick` from a `setInterval(…, 1000 / parity.controlHz)` loop, and posts `snapshot` with `bodyPos`/`bodyQuat` as transferables after each tick that stepped

### Render shell (main thread)

- [X] T021 [P] Write `web/vite.config.ts`: `base: "/web-robot/"`; serve `../shared` during dev and copy it into `dist/shared/` on build (e.g. `vite-plugin-static-copy` or a small custom plugin); worker built as an ES module (`worker: { format: "es" }`)
- [X] T022 [P] Write `web/src/render/scene.ts`: three.js `WebGLRenderer` (antialias, `setPixelRatio(min(devicePixelRatio, 2))`), hemisphere + directional light, ground plane with grid at z = 0 (MuJoCo z-up mapped onto three.js), `PerspectiveCamera` framing the arm, `OrbitControls` with touch (one-finger rotate, pinch zoom), and resize handling
- [X] T023 [P] Write `web/src/render/interp.ts`: keeps the last two snapshots and returns interpolated body positions (lerp) and quaternions (slerp) for a render time lagging one control period behind the latest snapshot
- [X] T024 Write `web/src/render/arm.ts`: build one `THREE.Group` per MuJoCo body from the model's geoms (mesh geoms loaded from `shared/robot/assets/` with `STLLoader`, or from the vertex data in the compiled model when available; primitive geoms from geom type and size), then apply interpolated poses each frame
- [X] T025 Write `web/src/ui/messages.ts` (loading progress overlay, plain-language asset error with a Retry button that re-posts `init`, "your browser lacks WebAssembly/WebGL/Web Workers" message) and `web/index.html` + `web/src/style.css` (full-viewport canvas, overlay container, mobile viewport meta, no page scroll)
- [X] T026 Write `web/src/main.ts`: feature detection (WebAssembly, WebGL2 or WebGL, Worker) → unsupported message; spawn `worker.ts`; show loading until `ready`; render loop via `requestAnimationFrame` using `interp.ts`; forward `document.visibilitychange` as `visibility { hidden }`; FPS meter (frame intervals over a rolling 2 s window, plus the maximum frame gap); expose read-only `window.__webRobot = { snapshot, fps, maxFrameGapMs }` (contracts/ui.md test hooks)

### Foundational tests and CI

- [X] T027 [P] Write unit tests `web/tests/unit/clock.test.ts` (≤ 5 steps per tick, time dropped when behind, no burst after resume), `web/tests/unit/arm.test.ts` (clipping at both limits, `maxPerStep` bound), and `web/tests/unit/modes.test.ts` (every row of the transition table; switching leaves the state untouched)
- [X] T028 [P] Write `web/tests/unit/parity.test.ts`: `loadParity` throws `version-mismatch` for a wrong `mujocoVersion`, `hash-mismatch` for modified XML bytes, and rejects a wrong timestep/substeps product
- [X] T029 [P] Write `tests/parity/engine.test.ts`: in Node, load the real `shared/parity.json` + XML via `web/src/sim/mujoco.ts`, step 100 physics steps from the neutral pose with `ctrl = neutralPose`, and assert no NaN and `model.opt.timestep === 0.002`. This is the smoke test that the WASM engine runs under Node
- [X] T030 Write `web/scripts/size.ts`: after `vite build`, sum the brotli-compressed sizes of everything the page fetches before `ready` (HTML, JS, CSS, WASM, XML, mesh assets; excludes `shared/policy/*`), print a per-file table, and exit non-zero above 4 MB (4,194,304 bytes). Run it once now and record the WASM size and total in `specs/001-arm-reach/validation.md` (resolves the research R10 open measurement)
- [X] T031 Write `web/tests/e2e/static-only.spec.ts`: record all network requests during load and posing (extend the scenario with target dragging in US2 and a Learned switch in US3); assert every request is a GET to the page's own origin under `/web-robot/` for static files (html, js, css, wasm, xml, stl/obj, json, bin), with no other hosts and no POST (SC-008, Principle I) Deploy depends on it from P1 on (constitution gate 3)
- [X] T032 Write `.github/workflows/ci.yml`: on push/PR, a job with Node 22 (`npm ci`, `npm run lint`, `npm test`, `npm run build`, `npm run size`), a job with uv (`uv sync`, `uv run ruff check`, `uv run pytest`), and a job running `npm run test:parity`; on push to `main`, deploy `web/dist` to GitHub Pages with `actions/upload-pages-artifact` + `actions/deploy-pages`, with `needs:` on every test job so a parity failure blocks deploy

**Checkpoint**: The page loads, shows the arm in its neutral pose from live MuJoCo stepping in a worker, and CI deploys it.

---

## Phase 3: User Story 1 - See and pose the arm (Priority: P1) 🎯 MVP

**Goal**: The visitor opens the link, sees the arm within 3 s, orbits the camera, and poses each joint by hand within its limits, on laptop and phone.

**Independent Test**: Open the public URL on a laptop and a phone; orbit; drag each joint through and past its range (quickstart "Rung P1").

### Tests for User Story 1 ⚠️ (write first, expect failure)

- [X] T033 [P] [US1] Write `web/tests/e2e/p1.spec.ts` (tag `@p1`, all Playwright projects): (a) with Chromium CDP network throttling at 12 Mbit/s down and 40 ms latency and a cold cache, `window.__webRobot.snapshot` exists and the canvas accepts input within 3,000 ms of navigation (SC-001); (b) a pointer drag on empty canvas changes the camera position; (c) a pointer drag on the upper-arm link changes the corresponding `q[i]` in the snapshot; (d) dragging a joint far past its limit leaves `q[i]` within `[min_i − 0.01, max_i + 0.01]` with no frame-to-frame jump > 0.1 rad; (e) during 10 s of continuous joint dragging, `fps ≥ 30` and `maxFrameGapMs ≤ 100` (SC-002; asserted on `desktop-chromium` and on `mobile-chromium` with 4× CPU throttling; on `mobile-webkit`, recorded but not asserted because WebKit can't throttle the CPU); (f) no console errors
- [X] T034 [P] [US1] Write `web/tests/unit/picking.test.ts`: the pointer-to-joint-angle mapping in `web/src/render/picking.ts` rotates in the correct direction about the joint axis for axes along x, y, and z, and is continuous across ±π
- [X] T035 [P] [US1] Write `web/tests/e2e/soak.spec.ts` (tag `@soak`, desktop Chromium, 10 min) as a seeded random walk over the actions available in the current build (read the modes from the mode switch): joint grabs, camera orbits and resets in P1; plus target drags (including out of reach) and mode switches every 5–20 s once US2/US3 add them. Assert no console errors, no NaN in snapshots, joints always within limits, and snapshots keep arriving (no gap > 500 ms) (SC-005). It is a release check for every rung (T042, T057, T078) and also runs nightly in `.github/workflows/soak.yml`

### Implementation for User Story 1

- [X] T036 [US1] Write `web/src/render/picking.ts`: raycast the pointer (mouse and touch via Pointer Events) against arm meshes and map the hit body to the joint that moves it (its parent joint from the model); while dragging, disable `OrbitControls`, project pointer motion onto the plane perpendicular to the joint's world axis through the joint anchor, convert the angular change to a new target angle, and post `dragJoint { joint, angle }` at most once per animation frame; drags on empty space fall through to orbit
- [X] T037 [US1] Handle `dragJoint` in `web/src/sim/session.ts`: `arm.setJointTarget(i, angle)` (clipped to limits, FR-005) and a mode transition through `ModeMachine` (to `manual`, reason `joint-grab`); post `modeChanged` from `web/src/worker.ts`. In P1 the initial mode is `manual` (data-model rule)
- [X] T038 [P] [US1] Write `web/src/ui/resetButton.ts`: a button that posts `reset {}` (FR-006); the session resets `q`, `qd`, and `ctrl` to `neutralPose` from `parity.json`
- [X] T039 [P] [US1] Write `web/src/ui/hint.ts`: on first load, an animated hand/arrow over the upper-arm link (screen position computed from the link's world position each frame), removed on the first pointer interaction with the canvas; not shown again during that page session (`sessionStorage`, with reads and writes wrapped in try/catch) (FR-017)
- [X] T040 [US1] Wire `picking.ts`, `resetButton.ts`, and `hint.ts` into `web/src/main.ts`; make controls usable in portrait and landscape phone layouts (touch targets ≥ 44 px) in `web/src/style.css`
- [X] T041 [US1] (Triggered by SC-001, not the budget: time to interactive was 3.0–3.1 s before decimation while T030 stayed under 4 MB.) If T030 measured more than 4 MB, or the SC-001 load test fails: add `training/scripts/decimate_meshes.py` (e.g. `trimesh` or `open3d` quadric decimation, visual meshes only, target ≤ 40% of faces), regenerate `shared/robot/assets/`, re-run `export --no-policy` (the model hash changes; `<inertial>` elements keep physics unchanged, and `tests/parity/engine.test.ts` must still pass), and re-run `npm run size`. If still over, record it in `validation.md` and open a follow-up for the kinematic-posing fallback (plan Complexity Tracking); do not build that fallback here
- [ ] T042 [US1] Make `web/tests/e2e/p1.spec.ts`, the `@soak` run, and all unit tests pass; deploy locally with `npm run build && npm run preview -- --host` (production build under `/sim2browser/`); check manually on a real phone over the LAN (orbit, pinch, pose every joint) and record the device, load time, and observations under "P1" in `specs/001-arm-reach/validation.md`. When a GitHub remote with Pages exists: push to `main` and confirm the public deploy. The rung counts as complete only then (constitution gate 4)

**Checkpoint**: P1 is live at the public URL. This is the first shippable rung and can be recorded as a video on its own.

---

## Phase 4: User Story 2 - Baseline reaches the target (Priority: P2)

**Goal**: A draggable target that a damped-least-squares IK baseline follows continuously; unreachable targets are shown and handled cleanly; the info panel documents the baseline.

**Independent Test**: With the baseline active, drag the target to many reachable and unreachable positions, in single moves and continuous sweeps; run `npm run eval -- --controller baseline --n 100 --seed 0` (quickstart "Rung P2").

### Tests for User Story 2 ⚠️ (write first, expect failure)

- [X] T043 [P] [US2] Write `web/tests/unit/target.test.ts` for `web/src/sim/target.ts`: clamps z to ≥ `minZ`; pushes positions inside `baseExclusionRadius` of the base axis radially out to that radius; `reachable` follows the `workspace.bin` grid: a point behind the base but within `maxReach` whose voxel is empty is unreachable; a point must move at least `hysteresis` past the grid boundary before the flag flips (no flicker when dragging along the boundary)
- [X] T044 [P] [US2] Write `web/tests/unit/baseline.test.ts` for `web/src/control/baseline.ts` (running in Node on the real sim): for 20 seeded FK-generated reachable targets, the tip reaches within 1 cm in ≤ 2 s; per-step `|Δctrl_i| ≤ maxJointSpeed / controlHz`; for a target at 2 × `maxReach`, after 3 s `ctrl` stays finite, joints stay within limits, and the tip position varies by less than 1 mm over the last 0.5 s (no oscillation); no NaN when started at a fully stretched (singular) pose
- [X] T045 [P] [US2] Write `web/tests/unit/eval.test.ts` for `web/src/sim/eval.ts`: the success detector requires `‖tip − target‖ ≤ tolerance` AND tip speed < `maxTipSpeed` held for `hold` seconds within `timeLimit`; the jerk of a synthetic cubic tip trajectory `x(t) = t³` sampled at 50 Hz is 6 at interior points (third finite difference / dt³); seeded target generation is deterministic for a given seed
- [X] T046 [P] [US2] Write `web/tests/e2e/p2.spec.ts` (tag `@p2`): the default mode is `baseline`; dragging the target to a reachable position gets the tip within 1 cm within 2 s (from the snapshot); a continuous 3 s circular drag keeps the tip-to-target distance under 5 cm after the first 0.5 s, with no snapshot gaps > 100 ms; dragging beyond reach sets `reachable = false`, shows the out-of-reach indicator, and the tip is stable (< 1 mm variation over 0.5 s); dragging back within reach resumes reaching; grabbing a joint switches the mode to `manual`; the info panel opens and shows "damped least-squares" and the gains read from `parity.json`

### Implementation for User Story 2

- [X] T047 [P] [US2] Write `web/src/sim/target.ts`: `Target { pos; reachable }` with `set(pos)` applying the data-model rules "`pos` is clamped to z ≥ `minZ` and outside `baseExclusionRadius` around the base axis" and the reachable rule: the voxel in `shared/workspace.bin` (loaded and hash-checked like the model) is occupied and z ≥ `minZ`, with `hysteresis` applied by distance to the nearest boundary voxel; the default position is the neutral-pose tip position
- [X] T048 [P] [US2] Write `web/src/control/baseline.ts`: each control step, `e = target − tip`; `J = jacSite("tip")` restricted to the 5 arm DoF; `Δq = Jᵀ(JJᵀ + λ²I)⁻¹ · gain · e / controlHz + (I − J⁺J) · nullspaceGain · (neutralPose − q) / controlHz` (with `J⁺` the damped pseudo-inverse, λ = `damping`); then `arm.applyDelta(Δq, maxJointSpeed / controlHz)`. All parameters come from `parity.baseline`, with no hard-coded constants (research R6)
- [X] T049 [US2] Extend `web/src/sim/session.ts` and `web/src/worker.ts` for the target: handle `setTarget { pos }` via `Target.set`; add `target` and `reachable` to the snapshot; register the baseline controller; initial mode `baseline` (data-model rule "`baseline` from P2 onward"); `reset` also restores the default target
- [X] T050 [P] [US2] Write `web/src/sim/eval.ts`: `reachableTargets(sim, n, seed)` (seeded PRNG, e.g. mulberry32; sample joint configs uniformly within limits, FK to the tip, reject z < `minZ` and points inside `baseExclusionRadius`); `runEpisode(session, controller, target)` that starts from `neutralPose`, sets the target, steps up to `timeLimit` + 1 s, and returns `{ success, settleTime, tipTrace }`; `successDetector(parity.success)`; `meanSqJerk(tipTrace, controlHz)` = mean over interior samples of ‖third finite difference / dt³‖²
- [X] T051 [US2] Write `web/scripts/eval.ts`: CLI `--controller baseline|learned --n 100 --seed 0 [--out path]` that loads `shared/` from disk, runs `eval.ts` headless in Node, and writes the `EvalReport` JSON from data-model.md (`controller`, `seed`, `n`, `successRate`, `settleTimeP50`, `settleTimeP95`, `meanSqTipJerk`, `perTarget`) to `web/eval/<controller>.json` and prints a summary; exits non-zero if the baseline `successRate < 0.99` (SC-003)
- [X] T052 [US2] Write `web/src/render/target.ts`: a target sphere with a drag gizmo. Dragging moves it in the plane through the target facing the camera; the wheel over the target, shift-drag, or a two-finger vertical drag moves it along the camera-to-target axis. Posts `setTarget` at most once per frame and takes priority over orbit and joint picking when the pointer hits the target. When `reachable` is false it changes color, shows a ring, and shows an "out of reach" label (FR-009, contracts/ui.md)
- [X] T053 [P] [US2] Write `web/src/ui/modeSwitch.ts`: a segmented control `Manual · Baseline` (Learned hidden until US3); highlights the active mode from `snapshot.mode` / `modeChanged` (FR-010); posts `setMode`
- [X] T054 [P] [US2] Write `web/src/ui/infoPanel.ts`: an "i" button that opens a panel whose "Baseline design" section reads from `parity.json`: "Damped least-squares inverse kinematics on tip position", the gain, damping, max joint speed, and null-space gain values; "Tracks the target directly, with no trajectory planning"; and the caveat "A controller that plans a smooth trajectory ahead of time would also move smoothly; this demo compares reactive controllers" (research R6)
- [X] T055 [US2] Wire `render/target.ts`, `modeSwitch.ts`, and `infoPanel.ts` into `web/src/main.ts`; point the first-visit hint (`hint.ts`) at the target instead of the joint from P2 on
- [X] T056 [US2] Add a CI step to `.github/workflows/ci.yml` that runs `npm run eval -- --controller baseline --n 100 --seed 0` and uploads `web/eval/baseline.json` as an artifact; it gates deploy
- [ ] T057 [US2] Make the US2 unit and e2e tests, the `@soak` run, and the baseline eval pass (`successRate ≥ 0.99`); deploy (local preview until the remote exists, then GitHub Pages); record the eval summary and manual observations under "P2" in `specs/001-arm-reach/validation.md`

**Checkpoint**: P2 is live. The target can be dragged and the baseline reaches it. It stands on its own as a video.

---

## Phase 5: User Story 3 - Learned policy vs. baseline (Priority: P3)

**Goal**: A PPO policy trained offline with smoothness penalties, running in the browser with verified parity; the visitor switches between Learned and Baseline without a reset; a live observe/output panel; honest metrics in the info panel.

**Independent Test**: Parity tests pass; `npm run eval:compare` gives the SC-004/SC-009 verdict; switch controllers mid-reach; open the panel while dragging (quickstart "Rung P3").

### Training side

- [X] T058 [P] [US3] Write `training/tests/test_env.py` for `training/reach/env.py`: observation shape `(21,)`, with field order and slices matching `parity.json` `observation.fields` (q 0:5, qd 5:10, target 10:13, tipToTarget 13:16, prevAction 16:21); the action is applied as `ctrl = clip(ctrl + a·deltaScale, low, high)` followed by exactly `substeps` physics steps; `tipToTarget == target − tip`; target sampling yields about 10% unreachable targets (distance > `maxReach`) over 10,000 samples; each episode lasts 250 control steps (5 s) with 1–3 target changes
- [X] T059 [US3] Write `training/reach/env.py`: a Gymnasium `ReachEnv` that reads `shared/parity.json` and the XML (asserting the MuJoCo version and model hash); resets to `neutralPose` plus small noise; samples targets by FK of uniform joint configs (reachable) or at shoulder distance in `[maxReach + 0.02, maxReach + 0.15]` (unreachable, about 10%); 1–3 target changes at random steps; reward = −‖tip − target‖ + `success_bonus`·[settled] − `w_rate`·‖aₜ − aₜ₋₁‖² − `w_jerk`·‖tip jerk‖² (tip jerk by third finite difference at 50 Hz), with weights in `training/reach/config.py`. The observation builder MUST be a separate function `build_obs(...)` so fixtures can reuse it
- [X] T060 [US3] Write `training/reach/train.py`: SB3 PPO with `VecNormalize(norm_obs=True, norm_reward=True, clip_obs=10.0)`, `policy_kwargs=dict(net_arch=dict(pi=[128,128], vf=[128,128]), activation_fn=nn.Tanh)`, `--seed`, `--steps` (default 5M), 16 parallel `SubprocVecEnv` workers, checkpoints and VecNormalize stats saved to `training/runs/<run-id>/` (gitignored)
- [X] T061 [US3] Extend `training/reach/export.py` (without `--no-policy`): load a checkpoint and VecNormalize stats from `--run`; write `observation.normalization` (`mean` = `obs_rms.mean`, `std` = `sqrt(obs_rms.var + eps)` with the `eps` used by VecNormalize, `clip` = 10.0) into `shared/parity.json`; write `shared/policy/reach.bin` (per layer: `W` row-major `out×in`, then `b`, float32 little-endian, taken from `mlp_extractor.policy_net` and `action_net`) and `shared/policy/reach.json` per [contracts/policy-artifact.md](./contracts/policy-artifact.md) (`outputActivation: "clip"`); set `policy.sha256` in `parity.json`
- [X] T062 [P] [US3] Write `training/tests/test_export.py`: a NumPy forward pass over `reach.bin` (`tanh`, `tanh`, linear, then clip to [-1, 1]) on 1,000 normalized observations matches `model.predict(obs, deterministic=True)` to within 1e-6; the byte length equals `Σ(out·in + out)·4`; `sha256` matches
- [X] T063 [US3] Write `training/reach/make_fixtures.py`: produce `shared/parity/trajectory-random.json` (500 control steps of seeded uniform actions in [-1, 1]), `shared/parity/trajectory-limits.json` (500 steps of ±1 actions alternating every 50 steps, saturating limits), and `shared/parity/policy-recorded.json` (500 steps of the trained policy, with 3 target changes including one unreachable, recording `obsRaw`, `obsNorm`, `policyAction`), all per [contracts/parity-fixture.md](./contracts/parity-fixture.md), including `parityJsonSha256`, `modelSha256`, and `mujocoVersion`
- [X] T064 [US3] Train and iterate: run `uv run python -m reach.train --seed 0`, export, and run the web evaluation (T071). Tune the reward weights in `training/reach/config.py` (and `--steps`) until learned `successRate ≥ 0.95` and jerk ratio ≤ 0.70 versus the baseline, or until 5 tuning rounds are done. Log every run (weights, steps, success rate, jerk ratio) in `specs/001-arm-reach/validation.md`. If thresholds are not met, keep the best run and record the shortfall; NEVER change `parity.baseline` to close the gap (FR-018). Then run `export` and `make_fixtures` on the chosen run and commit `shared/parity.json`, `shared/policy/*`, and `shared/parity/*`

### Parity tests (release gate) ⚠️

- [X] T065 [P] [US3] Write `tests/parity/versions.test.ts`: `shared/MUJOCO_VERSION`, the `@mujoco/mujoco` module version, `parity.json` `mujocoVersion`, and each fixture's `mujocoVersion` are identical; the model hash (XML plus all assets, per contracts/parity-json.md) equals `model.sha256` and each fixture's `modelSha256`; the SHA-256 of `workspace.bin` equals `reach.workspace.sha256`; the SHA-256 of `parity.json` equals each fixture's `parityJsonSha256`; the SHA-256 of `reach.bin` equals `policy.sha256`
- [X] T066 [P] [US3] Write `tests/parity/trajectory.test.ts`: for `trajectory-random.json` and `trajectory-limits.json`, restore `init` on the WASM sim, apply each `action` with the same rule as Python (`applyDelta` with `deltaScale`, then `substeps` physics steps), and assert that `qpos`/`qvel` match at every step within **1e-6** max abs; report the first diverging step and field on failure
- [X] T067 [P] [US3] Write `tests/parity/policy.test.ts`: for `policy-recorded.json`, (a) the TS observation builder `web/src/sim/observation.ts` on the replayed state reproduces `obsRaw` and `obsNorm` within 1e-6; (b) the TS MLP `web/src/control/policy.ts` on the recorded `obsNorm` reproduces `policyAction` within **1e-5** at every step

### Web side

- [X] T068 [P] [US3] Write `web/src/sim/observation.ts`: `buildObs(state, target, prevAction, parity)` returning a `Float64Array(21)` in exactly the `parity.json` `observation.fields` order (q, qd, target, tipToTarget, prevAction), and `normalize(obs, norm)` = `clip((obs − mean)/max(std, eps), ±clip)`. Field slices are derived from `fields`, not hard-coded
- [X] T069 [P] [US3] Write `web/src/control/policy.ts`: `loadPolicy(fetchLike, baseUrl, parity)` that fetches `reach.json` + `reach.bin` and verifies `parityVersion === parity.version`, the byte length `Σ(out·in + out)·4`, and `sha256 === parity.policy.sha256` (else throws `ParityError` code `hash-mismatch`); `forward(obsNorm)` using float64 accumulation over float32 weights: `tanh` on hidden layers, linear output clipped to [-1, 1] (contracts/policy-artifact.md)
- [X] T070 [US3] Write `web/src/control/learned.ts`: a controller whose `enter()` sets `prevAction` to zeros (data-model rule) and whose `step()` builds obs → normalize → forward → `arm.applyDelta(action · deltaScale, deltaScale)` → stores `prevAction` and the latest `PolicyStep { obsRaw, obsNorm, action, prevAction }`
- [X] T071 [US3] Extend `web/scripts/eval.ts` for `--controller learned` (loads the policy from disk) and write `web/scripts/eval-compare.ts`: reads `web/eval/baseline.json` and `web/eval/learned.json` (same seed and n), prints SC-004 (`learned.successRate ≥ 0.95`) and SC-009 (`learned.meanSqTipJerk / baseline.meanSqTipJerk ≤ 0.70`) verdicts, and with `--write-metrics` writes `metrics { successRate, jerkRatioVsBaseline }` into `shared/policy/reach.json`. It always exits 0: shortfalls are reported, not hidden (research R12)
- [X] T072 [US3] Extend `web/src/sim/session.ts` and `web/src/worker.ts`: on the first `setMode learned`, lazily load the policy (T069) and register the learned controller; on failure, post `modeChanged { mode: "baseline", reason: "policy-load-failed" }` and `error { code }`; once loaded, include `policyStep` in every snapshot, computing the policy on the current observation for display even when another mode is active (contracts/ui.md); switching never resets `q`, `qd`, or the target (FR-012)
- [X] T073 [P] [US3] Write `web/src/ui/panel.ts`: a collapsible observe/output panel, collapsed by default and shown as a bottom sheet under 700 px width. It shows observation groups with labels from `parity.json` fields (joint angles and previous command as small bars, target and tip → target as numbers), normalized values on hover or tap, and 5 output bars from −1 to +1 labeled "joint 1..5 command", greyed out when the mode is not `learned`. Updates every animation frame from the latest snapshot (FR-014)
- [X] T074 [US3] Extend `web/src/ui/modeSwitch.ts` with `Learned` (shows a spinner while the policy loads, disabled with a tooltip on load failure), and `web/src/ui/infoPanel.ts` with a "Learned policy" section (PPO, 2×128 MLP, the 21 observed values by label, and the reward terms distance, success bonus, action-rate penalty, and jerk penalty) and a "Measured results" section showing `reach.json` `metrics` (success rate against the 95% target, jerk ratio against 0.70) exactly as measured, including when below target
- [X] T075 [P] [US3] Write unit tests `web/tests/unit/observation.test.ts` (order and slices follow `fields`; normalization clips at ±`clip`; `std` below `eps` is guarded) and `web/tests/unit/policy.test.ts` (a hand-built 2→2→1 network gives the expected values; wrong byte length or hash throws `hash-mismatch`)
- [X] T076 [P] [US3] Write `web/tests/e2e/p3.spec.ts` (tag `@p3`): select Learned, drag the target to a reachable spot, and the tip gets within 1 cm within 2 s; switching Learned → Baseline → Learned mid-reach keeps `q` (within one control step of motion) and `target` unchanged; with the panel open, the displayed values change across 10 consecutive frames while dragging; the info panel shows the measured metrics; with `shared/policy/reach.bin` served corrupted (route interception), selecting Learned falls back to Baseline and shows an error
- [X] T077 [US3] Add CI steps to `.github/workflows/ci.yml`: `npm run test:parity` now includes `versions`, `trajectory`, and `policy` (deploy stays blocked on failure), plus `npm run eval -- --controller learned`, `npm run eval:compare`, and upload of both reports
- [ ] T078 [US3] Make all US3 tests pass, including the parity gate and the `@soak` run; deploy (local preview until the remote exists, then GitHub Pages); record the eval-compare output, parity results, and manual observations under "P3" in `specs/001-arm-reach/validation.md`

**Checkpoint**: P3 is live. Learned and baseline can be compared side by side, parity is verified, and the metrics are shown honestly.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T079 [P] Write `web/tests/e2e/edge-cases.spec.ts`: a hidden tab (emulated `visibilitychange`) pauses the sim, and on resume `q` changes smoothly with no jump > 0.1 rad in the first frame; blocking `so100_reach.xml` shows the error message with Retry, and Retry after unblocking loads the arm; the portrait and landscape mobile viewports keep the mode switch, reset, and panel toggle visible and clickable
- [X] T080 [P] Write the root `README.md`: what web-robot is, the public URL, the three rungs, how to run (link to `specs/001-arm-reach/quickstart.md`), the parity approach, and credits (MuJoCo, Menagerie SO-ARM100, Apache-2.0 notices)
- [ ] T081 Run the informal visitor test with at least 5 first-time visitors without a robotics background on the public URL: measure the seconds until their first target/joint move (SC-006: ≥ 4 of 5 within 10 s) and ask them to compare Learned and Baseline without explanation (SC-007: ≥ 4 of 5 describe Learned as smoother or more natural). Record the anonymized results in `specs/001-arm-reach/validation.md`
- [ ] T082 Minimality pass (Principle V): remove unused code, exports, dependencies, and assets across `web/`, `training/`, and `shared/`; confirm runtime dependencies are only `@mujoco/mujoco` and `three`; re-run `npm run size`
- [ ] T083 Run every command in `specs/001-arm-reach/quickstart.md` from a clean clone and fix any drift between the docs and the code

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T002 (version pin) precedes T003 and T004.
- **Foundational (Phase 2)**: depends on Setup; BLOCKS all stories. Internal order: T008 → T009 → T010 → T011 → T012 (parity.json exists) → T013–T018 [P] → T019 → T020; T021–T023 [P] → T024 → T025 → T026; tests T027–T029 [P] after their modules; T030 and T031 after T026; T032 last (its deploy job needs T031).
- **US1 (Phase 3)**: after Foundational.
- **US2 (Phase 4)**: after US1 is deployed (rungs ship in order; Principle III). Code-wise it needs only Foundational plus `picking.ts` (T036), because target dragging must take priority over joint picking.
- **US3 (Phase 5)**: after US2. It needs the baseline (T048) and evaluation (T050/T051) for the comparison and the training-side `export.py` (T010).
- **Polish (Phase 6)**: after US3 (T079 can start after US2 for the parts that don't involve Learned).

### User Story Dependencies

- **US1**: Foundational only.
- **US2**: Foundational + US1 picking (T036). Testable on its own with the baseline.
- **US3**: US2 baseline and evaluation, used for the jerk ratio and the side-by-side comparison. Constitution Principle IV requires the baseline to exist first.

### Within Each Story

- Tests are written first and fail → core modules → session/worker integration → UI → CI → deploy and validate.
- Training tasks: T058 → T059 → T060 → T061 → T062 → T063 → T064 (T064 also needs T068–T071 to evaluate).
- Parity tests T065–T067 need T063/T064 fixtures and T068/T069.

### Parallel Opportunities

- Setup: T004, T005, T006, T007 in parallel after T003.
- Foundational: T013–T018 in parallel; T021–T023 in parallel; T027–T029 in parallel.
- US1: T033, T034, T035 in parallel; T038, T039 in parallel.
- US2: T043–T046 in parallel; T047, T048, T050 in parallel; T053, T054 in parallel.
- US3: the training track (T058–T063) and the web track (T068, T069, T073, T075) run in parallel until T064; T065–T067 in parallel.
- Polish: T079, T080 in parallel.

---

## Parallel Example: User Story 2

```bash
# Tests first, together:
Task: "T043 target clamp/hysteresis unit tests in web/tests/unit/target.test.ts"
Task: "T044 DLS baseline unit tests in web/tests/unit/baseline.test.ts"
Task: "T045 success/jerk/eval unit tests in web/tests/unit/eval.test.ts"
Task: "T046 P2 e2e in web/tests/e2e/p2.spec.ts"

# Then core modules, together:
Task: "T047 Target in web/src/sim/target.ts"
Task: "T048 DLS IK baseline in web/src/control/baseline.ts"
Task: "T050 evaluation core in web/src/sim/eval.ts"
```

## Parallel Example: User Story 3

```bash
# Training track and web track side by side:
Task: "T059 ReachEnv in training/reach/env.py"
Task: "T068 observation builder in web/src/sim/observation.ts"
Task: "T069 policy loader + MLP in web/src/control/policy.ts"
Task: "T073 observe/output panel in web/src/ui/panel.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational (incl. WASM size measurement T030)
2. Phase 3 US1 → **STOP and VALIDATE** on a real phone → deploy (first public rung)

### Incremental Delivery

1. Setup + Foundational → arm visible, CI deploying
2. US1 → pose the arm → deploy/video (MVP)
3. US2 → baseline reach → deploy/video
4. US3 → learned vs. baseline, parity gate → deploy/video
5. Polish → edge cases, README, visitor test, minimality pass

### Risk Order

- T002 (MuJoCo npm/PyPI version match) and T030 (WASM size vs. 4 MB) are the earliest checks that could invalidate the plan; do them first.
- T064 (training reaches 95% / ≤ 0.70) is the main uncertainty; the honest-reporting path means it cannot block shipping.

---

## Notes

- [P] = different files, no dependency on incomplete tasks.
- Never hand-copy parity-critical values into code; read them from `shared/parity.json`.
- Never tune `parity.baseline` to make the learned policy look better (FR-018).
- Commit after each task or logical group; each story's checkpoint is a deploy.
