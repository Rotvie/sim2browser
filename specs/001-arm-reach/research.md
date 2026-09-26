# Research: Arm Reach

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-25

Each entry: Decision / Rationale / Alternatives considered.

## R1. Physics engine (training and browser)

- **Decision**: MuJoCo on both sides, same version: Python `mujoco` for training and the official
  DeepMind WebAssembly bindings `@mujoco/mujoco` (single-threaded build) in the browser. Both pinned
  to one exact version (currently 3.14.0; confirm a matching Python wheel exists at setup and pin
  both to the highest version available on both sides). Fallback if the official bindings block
  us: `zalo/mujoco_wasm`, pinned to a build of the same MuJoCo version.
- **Rationale**: Principle II: identical engine, identical model file, identical timestep. The
  single-threaded build needs no COOP/COEP headers, so it works on GitHub Pages (Principle I).
- **Alternatives considered**:
  - MJX / MuJoCo Playground (JAX, GPU) for training: different solver implementation from the C
    engine in the browser, which breaks parity. Reach trains cheaply on CPU.
  - Rapier / cannon-es / hand-written kinematics: need a separate training engine, so no parity.
  - Multi-threaded `/mt` build: needs cross-origin isolation headers that GitHub Pages cannot set.

## R2. Robot model

- **Decision**: SO-100 (SO-ARM100) from MuJoCo Menagerie, position-controlled actuators. The 5 arm
  joints are controlled; the jaw is fixed closed and removed from the action space. A derived
  `so100_reach.xml` (jaw fixed, collisions off, tip site added at the jaw tip) is committed to
  `shared/robot/` and used by training, browser, and parity tests.
- **Rationale**: The task is tip position only (no orientation), so 5 DoF are enough. It is a
  small arm with light meshes, which helps the 3 s load budget. It is also a well-known low-cost
  open-source arm, and physical copies exist if real hardware ever comes into scope.
- **Alternatives considered**: Franka Panda (iconic, but 7-DoF redundancy and heavier meshes);
  UR5e (heavier meshes); custom primitive arm (not a real robot).

## R3. Control interface and rates

- **Decision**: Physics timestep 2 ms; control at 50 Hz (10 substeps). Every controller writes the
  same thing: the 5 position-actuator targets (`ctrl`). The policy outputs 5 values in [-1, 1],
  each scaled to a joint-target change of up to `deltaScale` rad per control step (starting value
  0.05), added to the current target and clipped to the joint range. The baseline writes the same
  targets, with the same per-step change limit (its joint velocity limit).
- **Rationale**: One control path for Manual, Baseline, and Learned means FR-013 holds by
  construction. Clipping enforces joint limits (FR-005) whatever the controller outputs.
- **Alternatives considered**: torque control (harder to learn, awkward manual posing); absolute
  joint targets (jumpier, which hurts the thesis).

## R4. Observation layout and normalization

- **Decision**: 21-value observation, in this order: joint positions (5), joint velocities (5),
  target position (3), tip-to-target vector (3), previous action (5). Normalized with running
  mean/std from training, frozen at export, and clipped to ±10. Everything is written by
  training into `shared/parity.json` (see [contracts/parity-json.md](./contracts/parity-json.md)).
  The browser only reads it.
- **Rationale**: The minimal information a reach policy needs. The tip position can be recovered
  from the target and tip-to-target vector. The previous action supports the action-rate penalty.
  Each field carries a human-readable label for the panel (FR-014).
- **Alternatives considered**: adding the tip position and an out-of-reach flag (redundant, and
  the flag would leak hand-engineered reachability logic into the policy); stacking frames.

## R5. Learning algorithm and reward (thesis: motion quality)

- **Decision**: PPO (Stable-Baselines3) on a Gymnasium environment wrapping Python MuJoCo, CPU,
  managed with uv. Reward per control step =
  −distance(tip, target) + success bonus − w_rate·‖aₜ − aₜ₋₁‖² − w_jerk·‖tip jerk‖².
  Episodes are 5 s long, with 1–3 target changes each. Targets are randomized over the reachable
  workspace, and about 10% are out of reach. The policy is an MLP with 2 hidden layers of 128
  units (tanh), about 20k parameters; the output is the linear Gaussian mean, clipped to
  [-1, 1] (SB3 default, no tanh squashing).
- **Rationale**: Smoothness is learned from the reward, not scripted (FR-016). Mid-episode target
  changes cover dragging. Training on unreachable targets gives sane stretching behavior.
- **Alternatives considered**: SAC (often jittery without extra work); MJX parallel PPO (R1).

## R6. Baseline controller (FR-018 honesty)

- **Decision**: Damped-least-squares differential IK on tip position:
  Δq = Jᵀ(JJᵀ + λ²I)⁻¹ · k·(target − tip). A null-space term pulls the 2 redundant DoF toward a neutral pose
  (`nullspaceGain`, `neutralPose`). Δq is clipped to the joint velocity limit × control
  period and added to the actuator targets, which are then clipped to the joint range. It uses the
  same actuators and the same 50 Hz rate as the policy. It tracks the target directly, with no
  trajectory generator. Implemented once in TypeScript (the shipped controller).
- **Rationale**: The textbook reactive controller: exact, competent, robust near singularities
  and limits (FR-009). Its mechanical character comes from its design.
- **Honesty**: A trajectory generator such as minimum-jerk would also be smooth, so the claim is
  "learned reactive policy vs. classical reactive controller". The demo's info panel documents
  the baseline's design (algorithm, gains, limits) and this caveat.
- **Alternatives considered**: Jacobian transpose (weaker, looks like a straw man); analytic IK
  plus interpolation (not reactive to dragging).

## R7. Policy inference in the browser

- **Decision**: About 20 lines of TypeScript run the MLP from a flat float32 weight file with a
  JSON header ([contracts/policy-artifact.md](./contracts/policy-artifact.md)), on CPU.
- **Rationale**: About 20k parameters take microseconds; a runtime library would cost several MB
  of download against the 4 MB budget (Principles I and V). Plain arithmetic is also easy to
  check for exact parity.
- **Alternatives considered**: onnxruntime-web with WASM/WebGPU (several MB of runtime for a tiny
  MLP; WebGPU gains nothing at this size). Can be revisited if a later feature needs a much larger
  network.

## R8. Threading: Web Worker for physics and policy

- **Decision**: MuJoCo stepping, all controllers (Manual, Baseline, Learned) and the observation
  builder run in one dedicated Web Worker. The main thread owns three.js rendering, input, and the
  UI. Messages (see [contracts/worker-protocol.md](./contracts/worker-protocol.md)):
  main → worker for inputs (target, joint drag, mode, reset, visibility); worker → main for state
  snapshots at control rate (body poses, joint state, policy step), sent as transferable typed
  arrays. The main thread renders the latest snapshot and interpolates between the last two for
  smooth display. The same sim/control modules are plain TypeScript with no DOM dependency, so the
  parity tests and evaluation import them directly in Node without the worker.
- **Rationale**: Physics and inference can never drop rendering frames on phones (SC-002). Plain
  workers need no special headers.
- **Alternatives considered**: everything on the main thread (simpler, but a slow step blocks
  input and rendering); SharedArrayBuffer (needs cross-origin isolation).

## R9. Rendering and UI

- **Decision**: three.js; body meshes are posed from worker snapshots. The target is dragged with
  a gizmo in a plane facing the camera, with depth changed by scroll or two-finger drag. Joints are
  posed by dragging a link. The UI is plain DOM + CSS: mode switch, collapsible observe/output
  panel, info panel, first-visit hint, error messages.
- **Rationale**: WebGL runs on integrated and mobile GPUs (no discrete GPU needed). No UI
  framework (Principle V).
- **Alternatives considered**: React Three Fiber / `mujoco-react`, Babylon.js.

## R10. Build, hosting, load budget

- **Decision**: Vite + TypeScript builds to static files; GitHub Actions runs the tests, then
  deploys to GitHub Pages. Load budget: at most 4 MB compressed before interactive. Policy weights
  load lazily on first switch to Learned.
- **Rationale**: About 4 MB loads in 3 s at about 12 Mbit/s (SC-001).
- **Risk / open measurement**: The WASM binary size is unmeasured. The first implementation task
  measures it. Mitigations, in order: decimate meshes further; then show the arm posed from the
  model before physics is ready (a fallback only, because it adds a second code path).

## R11. Parity and other testing

- **Decision**:
  - **Parity (Principle II, FR-015)**, in top-level `tests/parity/`: Python replays fixed action
    sequences and writes fixtures; Vitest in Node replays them on `@mujoco/mujoco` with the same
    XML and `parity.json`. Joint trajectories must match within **1e-6**. The TypeScript MLP must
    reproduce the training policy's actions on recorded observations within **1e-5**. The
    MuJoCo version, model hash, and `parity.json` hash must match exactly. CI blocks deploy on
    failure.
  - **Evaluation (SC-003/004/009)**: a headless Node script runs the shipped TypeScript
    controllers on the WASM sim over 100 seeded reachable targets and outputs success rate, time
    to settle, and mean squared tip jerk.
  - **Unit (Vitest)**, **E2E (Playwright)**: desktop and mobile emulation, load time, frame rate,
    switch without reset, panel liveness, 10-minute soak, no requests to non-static endpoints.
  - **Training (pytest)**: environment and export round-trip.

## R12. Committed thresholds

| Item | Value |
|------|-------|
| Settle | tip within **1.0 cm** of target and tip speed < 2 cm/s, held 0.2 s |
| Time limit | **2.0 s** after target release |
| Baseline success (SC-003) | ≥ 99% of 100 seeded reachable targets |
| Learned success (SC-004) | ≥ **95%** of the same 100 targets within 2 s |
| Smoothness (SC-009) | learned mean squared tip jerk ≥ **30% lower** than baseline (ratio ≤ 0.70) |
| Jerk measurement | third finite difference of the simulated tip position at control rate (50 Hz) |
| Reachable (evaluation) | forward kinematics of a random joint configuration within limits |
| Reachable (UI indicator) | voxel occupancy in `shared/workspace.bin` (1 cm grid from FK samples, built at export) and above the ground, with hysteresis; `maxReach` is used only to sample unreachable training targets |
| Frame rate (SC-002) | ≥ 30 fps, no frame gap > 100 ms |

**If PPO cannot meet both SC-004 and SC-009**: ship the rung anyway and report the measured
numbers honestly in the demo's info panel. The baseline is never weakened to close the gap
(FR-018). The spec's success criteria stay as targets, and the shortfall is recorded in
`validation.md`.

## R13. Runtime loop and edge cases

- **Decision**: The worker steps against a real-time clock at 50 Hz, running at most 5 control
  steps per tick. If it falls behind, it drops time (the simulation slows down) rather than taking
  large steps. When the page is hidden, the main thread tells the worker to pause and the clock
  resets (no catch-up burst). A mode switch only changes which controller writes `ctrl`; entering
  Learned resets the previous action to zero. Grabbing a joint switches to Manual. The target is
  clamped above the ground and outside a small radius around the base.
