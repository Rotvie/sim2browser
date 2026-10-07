# Research: Learned Grasping

Decisions for `plan.md`. Each: decision, rationale, alternatives considered.

## R1. Where demonstrations are produced: one recorder, two drivers

**Decision**: One demonstration recorder in `web/src/sim/` records any control step of the
shared `Session`, whatever drives it. It runs in two places on the same code path:

- **Browser, recording mode** (`?record`): the demonstrator's hand grasps (target drag with the
  Baseline, joint grabs, gripper button) and scripted grasps started from the page.
- **Node, headless** (`npm run demos -- …`): bulk scripted grasps for training, on the same
  Session and MuJoCo WASM build the evaluation already uses.

Both write the same demonstration file format (R3, contracts/demo-file.md).

**Rationale**: The scripted grasp exists only in TypeScript (`web/src/control/grasp.ts`); Python
only measures its parameters. Running it headless in Node needs no port, so the expert that
generates training data is the shipped controller itself. Planning probe: `npm run eval:grasp`
runs 100 scripted grasps in 3.5 s on the development laptop, so 2,000 demonstrations take
about 1–2 minutes. One recorder means hand and scripted demonstrations cannot drift apart in
format or semantics.

**Alternatives considered**: Port the scripted grasp to Python and generate demonstrations in the
training env (two implementations of the expert to keep in sync; rejected, Principle V and
parity risk). Record scripted demonstrations only in the browser (slow, manual; rejected).

## R2. Imitation method: behavior cloning with noise-injected expert rollouts (DART)

**Decision**: Behavior cloning (supervised regression from observation to action) on
demonstrations. Scripted demonstrations are generated with noise injection (DART, Laskey et al.
2017): the executed joint-target change is the expert's change plus Gaussian noise, while the
recorded label is the expert's intended change. Per-episode noise level drawn from
{0, 0.1, 0.2, 0.3} × the per-step joint limit; the gripper command is never perturbed. Hand
demonstrations are recorded without noise; their label is the applied change.

**Rationale**: Plain behavior cloning drifts off the demonstrated states and compounds errors
(covariate shift). The scripted grasp is reactive in its arm motion (DLS toward a goal from the
current tip) and its phases advance on observed state, so it corrects from perturbed states:
exactly what DART needs, without DAgger's requirement to query the expert at arbitrary states
(the scripted grasp keeps internal state: phase, moving goal point). Noise levels are tuned on
the selection placements (R8) and reported.

**Alternatives considered**: DAgger (needs a relabeling expert queryable from any state; the
scripted grasp is stateful; rejected for 004). Diffusion policy / ACT (multimodal and strong, but
far larger networks than a plain TypeScript MLP and a heavier pipeline; rejected, Principle V,
noted as a future plug-in candidate). RL fine-tuning after BC (out of scope per spec).

## R2b. DAgger with a reactive expert (2026-10-07, after the pilots; user decision)

**Decision**: Behavior cloning alone reached 0–12% on the selection placements (validation.md,
pilot table): the scripted grasp's descent starts on hidden conditions, so states slightly off
its path have no consistent label. DAgger (Ross et al. 2011) fixes exactly this but needs an
expert that can label any state, which the stateful scripted grasp cannot. So:

1. `web/src/control/reactiveGrasp.ts`: the scripted grasp's motion as a function of the current
   state only (cube pose, tip, jaw, gripper command), sharing its planning and arm-driving code
   (`planTopDown`, `topDownDelta`, extracted from `grasp.ts` by a pure refactor; the scripted
   evaluation reproduces exactly). Registered as a lab grasp controller and evaluated like any
   plug-in: 100% of 100 (seed 0), median 3.08 s.
2. Training demonstrations come from the reactive expert (with DART noise), so every label in the
   data has one author. The shipped baseline stays the 002 scripted grasp (Principle IV).
3. Rounds: export the current policy, roll it out in the browser code path
   (`npm run dagger`, placements from seed 3000 up), label every visited state with the reactive
   expert, aggregate, retrain from scratch (`python -m reach.imitate dagger`). DAgger episodes are
   used whatever their outcome; a rollout stops when the cube is knocked over.

**Alternatives considered**: tuning BC (more noise, data, capacity: pilot4 showed capacity does
not help); making the shipped scripted grasp reactive (changes the baseline and its numbers;
rejected); closing 004 below the bar now (premature with DAgger untried).

## R3. Demonstration file format: gzipped JSON Lines, raw simulator state

**Decision**: `*.demos.jsonl.gz`: line 1 is a header (format version, a physics-only hash `simSha256`
over the model hash, MuJoCo version, rates, gripper and cube settings, source counts; policy
sections excluded so v4 does not invalidate earlier recordings); each following line is one episode: start state
(`qpos`, `qvel`, `ctrl`), cube placement, and per control step the applied `ctrl`, the gripper
command, the optional intended action (`intent`, noise-injected episodes only), and the state
after the step (`qpos`, `qvel`). Outcome and source per episode. Raw simulator quantities only,
no policy observations: any algorithm can build its own inputs (FR-025). Full schema in
contracts/demo-file.md.

Hand demonstrations are committed (`training/demos/hand.demos.jsonl.gz`, human data that cannot
be regenerated). Scripted demonstrations are regenerated from a seed and gitignored like
`training/runs/`.

**Rationale**: JSON Lines streams in both Node and Python with no dependency; gzip (browser
`CompressionStream`, Node `zlib`, Python `gzip`) cuts the size by ~5×. Estimate: ~100 KB raw
per 5 s episode; 30 hand demos of ~20 s are ~10 MB raw, ~2 MB gzipped. Storing raw state
(not observations) keeps the file valid when the observation layout changes, and lets the
training side verify replay (SC-005).

**Alternatives considered**: NPZ/HDF5 (needs a writer in the browser; rejected). LeRobot dataset
format (Parquet + video; video-oriented and heavy for state-only data; noted for later export if
the platform grows). Storing observations (ties the file to one policy's layout; rejected).

## R4. Action space: joint-target changes plus a gripper output, same runtime as the reach policy

**Decision**: The grasp policy outputs 6 values in [-1, 1]: joint-target changes for all 5 arm
joints (scaled by `baseline.maxJointSpeed / controlHz` = 0.05 rad, the scripted grasp's own
per-step limit) and a gripper value (> 0 → closed, else open). Labels: `intent` if present, else
the applied ctrl change divided by the per-step limit, clipped to [-1, 1]; gripper label ±1 from
the recorded command. Network: tanh MLP with clipped linear output, the format `policy.ts`
already runs (`createPolicy`), so no new runtime code. Start at 2×256 hidden; 3×256 allowed if
the selection set says so (R8). Loss: MSE on all 6 outputs (the gripper target ±1 with a 0
threshold behaves like a margin classifier).

**Rationale**: Unlike reaching, grasping needs Wrist_Roll (jaw alignment with the cube) and the
gripper, so all 5 joints plus gripper. Joint-target deltas at the expert's own scale make labels
exact for the scripted grasp and for teleop. Reusing the reach policy's network format keeps one
inference path in TypeScript and one parity test pattern. Cost: 32×256 + 256×256 + 256×6 ≈ 75k
multiply-adds per 20 ms control step, negligible.

**Alternatives considered**: End-effector (Cartesian) actions fed to the DLS solver (puts the
classical controller inside the learned one, blurring the learned-vs-engineered comparison;
rejected). Separate gripper classifier head (needs runtime changes; rejected for now).

## R5. Observation: state-based, cube pose known, symmetric yaw features

**Decision**: 32 inputs, layout written to `parity.json graspPolicy.observation` by training:

| Field | Size | Meaning |
|---|---|---|
| `q` | 5 | arm joint angles |
| `qd` | 5 | arm joint speeds |
| `jaw` | 1 | jaw angle |
| `tip` | 3 | tip position (world) |
| `cube` | 3 | cube centre (world) |
| `cubeToTip` | 3 | tip − cube centre |
| `cubeYaw4` | 2 | sin, cos of 4 × cube yaw |
| `relYaw4` | 2 | sin, cos of 4 × (cube yaw − gripper yaw), gripper yaw = Rotation + Wrist_Roll − rollOffset |
| `faceYaw4` | 2 | sin, cos of 4 × (cube yaw − jaw yaw once Rotation faces the cube), bearing = atan2(cx − bx, −(cy − by)) from `reach.baseAxisXY`; added 2026-10-07 after pilot runs (validation.md) |
| `prevAction` | 6 | previous policy output (incl. gripper) |

Normalization: per-feature mean and std over the training samples, same clip/eps convention as
the reach policy, stored in `parity.json`.

**Rationale**: The cube looks the same every quarter turn, so yaw enters as 4× angle features,
continuous across the symmetry. The relative yaw is the quantity the scripted grasp actually
uses to choose Wrist_Roll; an MLP would struggle to learn the wrap-around from raw angles. All
features are functions of `qpos`, `qvel` and the previous output, so Python can rebuild them from
stored states and the browser from the live simulation; parity is tested (R9). `prevAction`
supplies the hidden phase information a memoryless MLP lacks (e.g. "I already commanded close").
No contact flags: contact sets are fragile across engines and the jaw angle plus cube height
carry the same information.

**Alternatives considered**: Raw cube quaternion (discontinuous under symmetry). A phase input
(would leak the scripted controller's internals into the learned one; rejected). Recurrent
network (needs runtime changes; noted if the memoryless MLP stalls).

## R6. Training mix: mostly scripted, hand demonstrations weighted, ablation reported

**Decision**: Train on 2,000 scripted episodes (seeds 1000–2999) plus all kept hand episodes
(at least 20, FR-007). Hand samples are up-weighted so they make up a fixed share of each batch
(default 15%, tuned among {10%, 15%, 25%} on the selection set; 0% is never a shipping
candidate, only the reported ablation). Only lifted episodes train;
for each, steps until 0.5 s after the lift succeeded. The info panel and `validation.md` report
the exact counts, the share, and the scripted-only ablation (hand share 0%).

**Rationale**: 20–50 hand episodes are ~1–2% of samples; unweighted they would have no effect,
which would make the "plus hand demos" claim hollow. Hand grasps differ in style (slower, other
approach paths); a modest share keeps their influence visible without averaging two strategies
into one bad one (MSE regression to the mean of modes). Reporting the ablation keeps the claim
honest either way.

**Alternatives considered**: Unweighted mix (hand demos irrelevant). Hand-only fine-tuning stage
(more moving parts; possible follow-up).

## R7. Grasp attempts judged by the session, not by the controller

**Decision**: A grasp attempt monitor in the session (`web/src/sim/graspAttempt.ts`) wraps any
controller registered with `task: "grasp"`: on start it records the cube pose, refuses
non-graspable placements (`not-graspable`, the controller is not stepped), feeds the existing
`GraspJudge` each step, and classifies failures from what happened (never held and cube moved
> `knockedDistance` → `knocked`; never held → `missed`; held at some point → `slipped`; still
held but not lifted at the time limit → `timeout`). A controller may still report its own phase
and an early failure (the scripted grasp does); the monitor's outcome is authoritative. The
evaluation, the status card and the recorder all read the monitor.

**Rationale**: The learned grasp has no phases to self-report, and a future plug-in must not be
able to grade itself (FR-016, FR-023). The scripted grasp's numbers come out identical because
the judge, its start time and its inputs are unchanged; `eval:grasp --check` re-measures this
(SC-003). The session's hard-coded `"grasp"` id checks (target-drag handover, snapshot) become
`task === "grasp"` checks, which is what makes a third grasp controller plug in with one
registration (SC-010).

**Alternatives considered**: Learned controller self-reports via a phase head (grading itself;
rejected). Separate evaluation-only judge (two definitions of success; rejected, 002 FR-016).

## R8. Placements: evaluation, selection and training sets are disjoint by seed and checked

**Decision**: `graspPlacements(parity, n, seed)` with: evaluation seed 0, n = 100 (002's
committed set, unchanged); selection seed 1, n = 100 (choose noise level, hand share, network
size and the shipped training seed); scripted demonstrations seeds 1000+; hand demonstrations
seed 2000+ (recording mode places the cube at the next placement of that sequence; the
demonstrator may move it). A test fails if any demonstration start placement lies within 2 mm
and 0.02 rad (mod π/2) of an evaluation placement (FR-018). Three training seeds; all reported,
the shipped one chosen on the selection set only (FR-022). Release bar: ≥ 80% on the evaluation
set (FR-015).

**Rationale**: Mirrors 001's discipline (separate selection targets), and makes "the evaluation
placements were never trained on" checkable rather than asserted.

**Alternatives considered**: Cross-validation over one placement pool (blurs which numbers are
held out; rejected).

## R9. Parity for the grasp policy

**Decision**: Three checks, all at existing tolerances:

1. **Observation + network** (`tests/parity/policy.test.ts`, extended): fixture
   `shared/parity/grasp-policy-recorded.json` holds stored states and Python's observations and
   actions for them; TypeScript must rebuild the same observations (1e-9) and outputs (1e-5,
   float32 weights, as the reach policy).
2. **Closed loop** (`tests/parity/trajectory.test.ts`, extended): `record-grasp.ts --controller
   learned-grasp` records one learned grasp's ctrl sequence in Node; Python replays it; arm and
   cube trajectories must agree at 1e-6 (002's contact tolerance; measured 5e-9 for a scripted
   grasp).
3. **Demonstration replay** (`training/tests/test_demos.py` + `python -m reach.demos check`):
   every episode of a demonstration file replays in Python from its start state and ctrl
   sequence with the same outcome (required, SC-005) and a state difference reported per
   episode and the share above 1e-6 per file. Measured (2026-10-07, 200 scripted episodes with
   DART noise): all outcomes equal, 9 of 200 above 1e-6, where a contact switches on in one engine
   and not the other and the difference jumps from < 1e-9 past 1e-6 in a single step. Training
   reads the recorded (browser) states, so this does not affect the training data.

**Rationale**: Covers the three places the browser and training can disagree: what the policy
sees, what it computes, and what the physics does with it (Principle II).

**Alternatives considered**: Closed-loop policy rollout in Python as well (needs a Python port of
the session's arm and gripper stepping; the replay test already covers the physics and the obs
test the inputs; deferred).

## R10. parity.json v4

**Decision**: Add a `graspPolicy` section (artifact paths and sha256, observation fields and
normalization, action layout and scale), written by `export.py --grasp-run <run>`. The version
bumps to 4; the reach policy header is re-exported with `parityVersion: 4` (weights and their
hash unchanged). Every evaluation file is regenerated and must reproduce its numbers.

**Rationale**: Single source of truth (Principle II); the browser never hard-codes the grasp
policy's layout. Reach weights are untouched, so 001/003 numbers must come out the same, which
the regenerated evaluations verify.

**Alternatives considered**: Keep the grasp layout only in the policy header (a second source of
parity-critical values; rejected).

## R11. Plug-in surface for grasp controllers

**Decision**: `ControllerDef` gains `task?: "reach" | "grasp"` (default `"reach"`). The mode
switch, session, evaluation (`eval:grasp --controller <id>`), recorder and info panel discover
grasp controllers by task. Evaluation reports move to one file per controller,
`shared/grasp-eval/<id>.json` (format version 2, otherwise 002's schema plus `controller` and
`task`). A lab-only example, `naiveGrasp.ts` (~40 lines: top-down grasp without wrist alignment),
proves SC-010 and shows in `?lab`.

**Rationale**: Extends the 001 registry pattern rather than adding a framework (Principle V,
platform direction). The example is the test that the interface is complete: if it needs any
change outside its file and one registry line, the interface is wrong.

**Alternatives considered**: A generic "task" abstraction with pluggable tasks, rewards and
evaluators (no second task needs it yet; rejected until one does).

## R12. Recording-mode UX

**Decision**: `?record` adds a recording card: placement counter, Start (places the cube at the
next seed-2000 placement and starts recording), Keep / Discard after the attempt ends (lift held
1 s, or Stop), kept counts by source and outcome, Save (downloads
`hand-YYYYMMDD-HHMM.demos.jsonl.gz`). Recording runs in the worker; kept episodes stay in worker
memory (and are lost on reload, stated on the card). Time limit for a hand attempt: 60 s.
Wrist roll: the Baseline holds Wrist_Roll near neutral, so the demonstrator rotates the wrist by
grabbing that joint (Manual), as in 002; the recorder captures whatever changes ctrl.

**Rationale**: Minimal UI for one demonstrator; no persistence or upload (Principle I, spec
Out of Scope). Recording from the worker sees exactly the steps the simulation took.

**Alternatives considered**: IndexedDB persistence (more code for a one-person tool; rejected).
Dedicated wrist-roll control in the toolbar (scope creep; revisit if hand demos come out
unusable).

## Risks

- **Behavior cloning falls short of 80%.** Mitigations in order: tune noise and network size on
  the selection set; more scripted episodes; 3×256. If still short, 004 closes without a grasp
  policy (FR-015), recording, plug-in surface and evaluation still ship.
- **Hand demonstrations hurt.** The scripted-only ablation shows it; the shipped policy still
  uses a hand share of at least 10% (FR-007), and if the ablation beats it, that is reported as
  "hand demos did not help" in the panel and `validation.md`.
- **Wrist-roll choice is ambiguous at the cube's 45° boundary** (two equally good face pairs):
  the MLP may average them. Measured on placements near the boundary; reported as a failure mode.
- **Long hand demos may diverge in replay** beyond 1e-6 (chaotic contacts over 60 s). Outcome
  equality is required; the measured difference is reported.
