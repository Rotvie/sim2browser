# Research: Arm Reach

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-25

Each entry: Decision / Rationale / Alternatives considered.

## R1. Physics engine (training and browser)

- **Decision**: MuJoCo on both sides, same version: Python `mujoco` for training and the official
  DeepMind WebAssembly bindings `@mujoco/mujoco` (single-threaded build) in the browser. Both pinned
  to one exact version (currently 3.14.0; confirm a matching Python wheel exists at setup and pin
  both to the highest version available on both sides).
- **Rationale**: Principle II: identical engine, identical model file, identical timestep gives
  bit-for-bit or near-bit-identical stepping. The single-threaded build needs no COOP/COEP headers,
  so it works on any static host (Principle I).
- **Alternatives considered**:
  - MJX / MuJoCo Playground (JAX, GPU) for training: much faster, but a different solver
    implementation than the C engine in the browser, which breaks the parity guarantee. Reach is
    cheap enough to train on CPU.
  - Community `zalo/mujoco_wasm`: predates the official bindings; less maintained.
  - Rapier / cannon-es / hand-written kinematics: would need a separate training engine, so no
    parity.
  - Multi-threaded `/mt` build: needs SharedArrayBuffer and cross-origin isolation headers, which
    many static hosts cannot set. Not needed for a single arm.

## R2. Robot model

- **Decision**: Franka Emika Panda from MuJoCo Menagerie (Apache-2.0), 7 arm joints; gripper
  fingers removed. A derived `panda_reach.xml` is committed once to `shared/robot/` and used by both
  training and browser. Collision is disabled for the reach task (no contacts besides
  target-is-visual-only). Visual meshes are decimated to reduce download size.
- **Rationale**: Widely recognized robot-learning arm (good for videos and a technical audience).
  Position actuators and joint limits already defined. Principle V: one robot, reused by the next
  feature (shove recovery).
- **Alternatives considered**: UR5e (6-DoF; less common in RL demos), SO-ARM100 (cheap hobby arm,
  less recognizable), custom primitive-geometry arm (smallest download, but not a real robot).

## R3. Control interface and rates

- **Decision**: Physics timestep 2 ms; control at 50 Hz (10 physics substeps per control step).
  Every controller writes the same thing: the 7 position-actuator targets (`ctrl`). The learned
  policy outputs 7 values in [-1, 1], each scaled to a joint-target change of up to
  0.05 rad per control step, added to the current target and clipped to the joint range.
- **Rationale**: One control path for Manual, Baseline, and Learned means FR-013 (identical
  conditions) holds by construction. Delta targets plus clipping enforce joint limits (FR-005)
  whatever the controller outputs.
- **Alternatives considered**: Torque control (harder to learn, and makes manual posing awkward);
  absolute joint targets (policy jumps are more likely, which hurts the smoothness thesis).

## R4. Observation layout and normalization

- **Decision**: 31-value observation, in this order: joint positions (7), joint velocities (7),
  tip position (3), target position (3), tip-to-target vector (3), previous action (7), and an
  out-of-reach flag (1). Normalized with running mean/std collected during training, frozen at
  export, and clipped to ±10. Layout, scale and stats are all stored in `shared/env-spec.json`
  (see [contracts/env-spec.md](./contracts/env-spec.md)).
- **Rationale**: Includes what a reach policy needs, plus the previous action, which the
  smoothness penalty needs. Every field has a human-readable label, which the observe/output panel
  (FR-014) shows directly.
- **Alternatives considered**: Adding sin/cos of joint angles (not needed within Panda's limits);
  stacking several past frames (more complex; the previous action is enough).

## R5. Learning algorithm and reward (thesis: motion quality)

- **Decision**: PPO (Stable-Baselines3) on a Gymnasium environment wrapping Python MuJoCo, CPU
  training. Reward per control step = −distance(tip, target)
  − w_rate·‖aₜ − aₜ₋₁‖² − w_jerk·‖tip jerk‖² − w_vel·‖q̇‖² + a bonus while settled. The weights are
  tuned so the agent meets both SC-004 (success) and SC-009 (smoothness). Episodes are 5 s long;
  the target is resampled 1–3 times per episode so the policy learns to track a moving target.
  About 10% of targets are out of reach. The policy is an MLP with 2 hidden layers of 128 units
  (tanh).
- **Rationale**: The smoothness terms make "smooth and natural" the trained behavior, not
  post-processing (thesis, FR-016). SB3 PPO is standard, runs on CPU, and exports easily.
  Resampling the target mid-episode covers dragging. Training on some unreachable targets gives
  sane stretching behavior (US3 scenario 4).
- **Alternatives considered**: SAC (faster to learn, but often jittery actions without extra
  work); MJX-based massively parallel PPO (rejected in R1 for parity).

## R6. Baseline controller (FR-018 honesty)

- **Decision**: Damped-least-squares (DLS) differential IK: each control step,
  Δq = Jᵀ(JJᵀ + λ²I)⁻¹ · k·(target − tip), with the per-step joint change clipped, added to the
  actuator targets, and clipped to the joint range. Null-space pull toward a neutral pose to keep
  the 7th DoF stable. Implemented once in TypeScript (the shipped controller); training-side
  evaluation replays it through the parity harness rather than keeping a second copy.
- **Rationale**: The textbook reactive reaching controller: correct, robust at singularities and
  limits (FR-009), not deliberately degraded. Its mechanical character (sudden start when the
  target moves, exponential approach, velocity snapping at clip limits) is inherent to it.
- **Honesty note**: A trajectory generator that plans motion ahead (e.g. minimum-jerk) would also
  produce smooth motion. The demo's claim is limited to "learned reactive policy vs. classical
  reactive controller". The technical panel names the baseline algorithm, so technical viewers
  can judge the comparison.
- **Alternatives considered**: Jacobian transpose (weaker, looks like a straw man); analytic IK
  plus joint interpolation (not reactive to dragging; Panda has no simple closed form).

## R7. Policy inference in the browser

- **Decision**: A few lines of plain TypeScript run the MLP from weights exported as a flat
  little-endian float32 binary plus a JSON header (see
  [contracts/policy-artifact.md](./contracts/policy-artifact.md)). About 22k parameters; well
  under 0.1 ms per inference on a phone.
- **Rationale**: Principle V (no inference runtime dependency); easy to verify for exact
  parity; runs on CPU (Principle I).
- **Alternatives considered**: onnxruntime-web (adds a multi-MB download for a 2-layer MLP);
  TensorFlow.js (same problem).

## R8. Rendering and UI

- **Decision**: three.js renders the scene, reading body poses from MuJoCo each frame. The target
  is dragged with a 3D gizmo: dragging moves it within a plane facing the camera, and scrolling or
  pinching the handle changes depth. Joints are posed by dragging on a link, which rotates the
  parent joint about its axis. UI is plain DOM + CSS (mode switch, collapsible panel, first-visit
  hint, error/fallback messages). No UI framework.
- **Rationale**: three.js is the standard WebGL library, and WebGL runs on integrated and mobile
  GPUs (the constitution forbids requiring a discrete GPU, not WebGL). Plain DOM for three or four
  widgets follows Principle V.
- **Alternatives considered**: MuJoCo's own renderer (not in the WASM bindings); React Three Fiber
  / `mujoco-react` (adds a framework for a single-page demo); Babylon.js (heavier).

## R9. Build, hosting, load budget

- **Decision**: Vite + TypeScript builds to static files, deployed to GitHub Pages. Load budget:
  at most 4 MB compressed transfer before the arm is interactive. Order: page shell and meshes
  first, then MuJoCo WASM (streamed compile), policy weights loaded lazily when Learned is first
  selected.
- **Rationale**: Around 4 MB fits in 3 s at about 12 Mbit/s (typical 4G/broadband, SC-001).
  GitHub Pages is free, static-only, and serves compressed files.
- **Risk / open measurement**: The size of the `@mujoco/mujoco` WASM binary is not yet measured.
  The first implementation task measures it. If WASM plus meshes exceed the budget, mitigations
  in order: (1) more mesh decimation; (2) show the arm posed from the MJCF before physics is
  ready, so posing works kinematically until the WASM arrives. (2) is a fallback only, because it
  adds a second code path.
- **Alternatives considered**: Cloudflare Pages / Netlify (also fine; GitHub Pages keeps the repo
  and the hosting together).

## R10. Testing strategy (parity included)

- **Decision**:
  - **Parity (Principle II, FR-015)**: Python generates `parity/fixtures/*.json`. Each fixture holds
    the initial state and an action sequence, plus the observations, normalized observations,
    policy outputs, and states Python recorded at every step. A Vitest suite in Node loads the same
    `@mujoco/mujoco` build, `panda_reach.xml`, `env-spec.json`, and policy weights, replays the
    actions, and asserts agreement within tolerances (state 1e-9, obs 1e-6, policy output 1e-5).
    Also checks that the timestep, frame skip, and model file hash match. Runs in CI and blocks
    release.
  - **Controller evaluation (SC-003/004/009)**: A headless Node script runs the shipped TypeScript
    controllers on the WASM sim over 100 seeded reachable targets and outputs a JSON report of
    success rate, time to settle, and mean squared tip jerk.
  - **Unit (Vitest)**: MLP forward pass, observation builder, DLS IK, reach check, target clamping,
    mode state machine.
  - **E2E (Playwright)**: loads on desktop and emulated mobile, time to interactive, stays smooth
    (frame timings), no console errors, controller switching keeps state, panel updates, 10-minute
    random-drag soak (SC-005), and no requests to non-static endpoints (SC-008).
  - **Python (pytest)**: environment checks, reward sanity, export round-trip.
- **Rationale**: Parity is tested, not assumed (Principle II); success criteria are measured on
  the shipped code path, not on a training-side stand-in.

## R11. Committed thresholds (spec asked the plan to fix these)

| Item | Value |
|------|-------|
| Settle tolerance | tip within **1.0 cm** of target and tip speed < 2 cm/s, held for 0.2 s |
| Settle time limit | **2.0 s** after target release (baseline and learned) |
| Baseline success (SC-003) | ≥ 99% of 100 seeded reachable targets |
| Learned success (SC-004) | ≥ **90%** of the same 100 targets |
| Smoothness (SC-009) | learned mean squared tip jerk ≤ **50%** of baseline's on the same 100 targets |
| Reachable definition | target produced by forward kinematics of a random joint configuration within limits (evaluation); in UI, shoulder distance ≤ max reach minus 2 cm and above the ground (with a small hysteresis band) |
| Smoothness (SC-002) | ≥ 30 fps; no frame gap > 100 ms |

## R12. Runtime loop and edge cases

- **Decision**: The loop is driven by `requestAnimationFrame` and keeps a time accumulator; it runs
  as many 50 Hz control steps as real time requires, at most 5 per frame. If it falls behind, it
  drops time (the simulation slows down) rather than taking huge steps, so it never diverges.
  When the tab is hidden, the loop pauses and the accumulator resets (no catch-up burst). Switching
  controller only changes which function writes `ctrl`; the policy's previous action resets to
  zero. Grabbing a joint switches to Manual. The target is clamped above the ground and outside a
  small radius around the base.
- **Rationale**: Covers the spec's edge cases with one mechanism, and keeps the simulation correct
  on weak devices.
