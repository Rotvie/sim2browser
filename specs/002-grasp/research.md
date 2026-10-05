# Research: Grasp

Decisions for 002-grasp, with measurements taken while planning (2026-10-05). Probes ran on the
original Menagerie model (commit `c96a32d`) with this repo's decimated visual meshes plus
Menagerie's five jaw collision meshes, under MuJoCo 3.14.0 (Python wheel and the pinned
`@mujoco/mujoco` WASM build). Probe scripts are not kept; the numbers are re-measured by the
implementation tasks noted below.

## R1. Robot model: what comes back from Menagerie

**Decision**: Rename the model file to `shared/robot/so100.xml` (it is no longer reach-only) and
restore from Menagerie:

- `Jaw` joint (`axis="0 0 1" range="-0.174 1.75"`) and its position actuator (same `so_arm100`
  class: kp 50, dampratio 1, forcerange ±3.5).
- Collision geoms in class `collision` (group 3, never rendered): the arm links collide through
  their meshes (MuJoCo uses each mesh's convex hull), the jaws through Menagerie's five small
  collision meshes, and the eight `finger_collision` pads (boxes, `solimp="2 1 0.01"`,
  `solref="0.01 1"`, friction `1 0.005 0.0001`).
- `<contact><exclude body1="Base" body2="Rotation_Pitch"/></contact>`.
- `<option cone="elliptic" impratio="10"/>` (Menagerie's grasping settings; elliptic friction
  cones and a high impratio reduce slip in a pinch grasp). The timestep stays 0.002.

New in this repo, not in Menagerie:

- A `floor` plane geom at z = 0 (collides; rendered by the existing three.js ground, so the
  plane itself is group 3).
- A `cube` body with a free joint: one box geom, edge 30 mm, mass 30 g, friction `1 0.005
  0.0001` (matching the pads), orange, group 2 (rendered).
- The `tip` site is unchanged (Fixed_Jaw, `pos="0 -0.1 0"`), so the reach policy's observation
  is unchanged.
- Keyframe `home` gets the jaw and cube coordinates.

**Rationale**: Collision meshes come from the decimated visual meshes the browser already
downloads, so no new link-mesh downloads; the five jaw collision meshes add ~45 KB raw. Convex
hulls of decimated meshes differ from Menagerie's by well under a millimetre, which is below
anything the task can see. Menagerie's own grasp settings are a better default than tuning our
own.

**Implementation update (2026-10-05)**: two changes after measuring (see `validation.md`): the
arm does not collide with itself (collision class `contype="2" conaffinity="1"`), because
mesh-vs-mesh self-contacts broke Python/WASM parity in degenerate cases; and the collision hulls
are precomputed and inlined in `so100.xml` (links capped at 32 hull vertices), because computing
them at load cost the phone budget.

**Alternatives considered**: Primitive capsules for the links (fewer contacts, cheaper) — more
hand-tuning, and a second geometry source to keep consistent with the visuals; held back unless
R10 measurements show contact cost matters. Keeping the name `so100_reach.xml` — misleading once
the model grasps.

## R2. Contact parity: Python vs. WASM

**Decision**: Keep the 1e-6 trajectory tolerance (qpos and qvel, every control step) for
fixtures with contacts. Add two fixtures:

- `contact-random.json`: 300 control steps of a random joint-target walk from home that dips the
  gripper toward the floor and cube and toggles the jaw every 60 steps (the probe below).
- `grasp-recorded.json`: the full ctrl sequence of one scripted grasp (approach, descend, close,
  lift, hold), recorded from the TypeScript controller on a fixed cube pose, replayed by Python
  to produce the reference states (R8).

**Measured**: Probe with arm, jaw, floor and a resting cube, 300 control steps × 10 substeps,
up to 8 simultaneous contacts, elliptic cones: max |Δ| over qpos (13) and qvel (12) =
**1.6e-11**, no step above 1e-6. Python and WASM run the same C code with the same
floating-point operations, so contacts do not break parity by themselves.

**Rationale**: Contact dynamics amplify small differences, but the measured gap starts at
~1e-14 and stays ~1e-11. If the grasp fixture fails 1e-6 during implementation, the plan
requires a measured, documented tolerance per state component (cube vs. arm) in
`validation.md`, never a silent loosening.

**Alternatives considered**: Comparing only final states — too weak; divergence would show only
as a failed grasp. Comparing only arm states — misses the object, the point of this feature.

## R3. Gripper control

**Decision**: Binary from the visitor's view. `parity.json` `gripper` holds `open: 1.0` rad and
`closed: -0.174` rad (the jaw's lower limit) and `maxSpeed: 3.0` rad/s. The jaw target moves
toward the commanded state at `maxSpeed`, through the same clip-to-limits path as the arm
(`Arm`), so closing on the cube makes the position servo squeeze up to its 3.5 N·m force limit.

**Measured** (pad-centre distance minus pad thickness, at home pose):

| Jaw (rad) | Gap at fingertip pad … rear pad |
|-----------|-------------------------------|
| −0.174 | 4 mm … 19 mm |
| 0.0 (001's welded pose) | 16 mm … 25 mm |
| 0.3 | 39 mm … 36 mm |
| 0.6 | 62 mm … 46 mm |
| 1.0 | 90 mm … 59 mm |

**Rationale**: At 1.0 rad the opening is 6–9 cm, room for a 3 cm cube with ±1.5 cm placement
error; fully open (1.75) only swings the moving jaw into the way during the descent. Commanding
the lower limit gives a firm grip on a 30 mm cube without a force controller.

**Alternatives considered**: A continuous gripper slider — the spec fixes binary control; a
force-limited grip mode — not needed at 30 g.

## R4. Cube and graspable region

**Decision**: Cube edge 30 mm, mass 30 g. Default pose: on the floor 22 cm in front of the base
axis, yaw 0. The **graspable region** is the floor annulus in front of the base where a
top-down grasp is kinematically feasible: distance from the base axis in `[rMin, rMax]` and
angle from straight ahead within `±maxAngle`. `export.py` computes it by checking that the tip
can reach the grasp point and the approach point above it with the gripper vertical (R5), for a
grid of positions, and writes the largest inscribed annulus sector to `parity.json` `grasp.region`.

**Rationale**: A region the grasp can actually serve keeps SC-003's denominator honest and makes
"not graspable from here" a geometric fact, not a guess. An annulus sector is easy to sample
uniformly, display, and clamp cube drags to.

**Alternatives considered**: The 001 voxel workspace — it describes tip positions in any
orientation, not top-down feasibility. A hand-picked rectangle — arbitrary.

## R5. Scripted grasp controller

**Decision**: A phase machine on top of the 001 DLS controller, all parameters in
`parity.json` `grasp`:

1. **approach**: open the gripper; move the tip to the approach point, `approachHeight` (8 cm)
   above the grasp point.
2. **descend**: move the tip to the grasp point at `descendSpeed` (5 cm/s).
3. **close**: command closed; wait until the jaw has stopped moving for `closeSettle` (0.2 s) or
   `closeTimeout`.
4. **lift**: move the tip up `liftHeight` (8 cm) at `liftSpeed`.
5. **hold**: hold the lifted pose; the attempt is judged here (R6).
6. **done** or **failed** (R6); after `failed` the gripper opens and the arm returns to the
   approach point.

Within each phase the tip target moves along a straight line at the phase speed, and the DLS
step from 001 (same gains, same joint-speed cap) tracks it on the first three joints
(Rotation, Pitch, Elbow) only.

- **Top-down orientation**: Pitch, Elbow and Wrist_Pitch rotate about parallel axes, so the
  gripper's direction in the arm's vertical plane is `Pitch + Elbow + Wrist_Pitch + const`. The
  controller sets `Wrist_Pitch = verticalOffset − Pitch − Elbow` each step, keeping the jaws
  pointing straight down. `verticalOffset` is computed by `export.py` from the model.
- **Wrist roll**: `Wrist_Roll = rollOffset + cubeYaw − Rotation`, wrapped to the nearest
  equivalent angle (cube symmetry: period π/2) within the joint limits, so the jaws close across
  two opposite faces.
- **Single moving jaw**: only one jaw moves, and `tip` sits ~8 mm from the fixed pad. The grasp
  point is the cube centre shifted along the closing axis by `fixedJawOffset` so the fixed pad
  descends just outside its cube face; closing pushes the cube onto it. Grasp height:
  cube-centre height (fingertips ~9 mm above the floor).
- **Cancel**: any visitor action (target drag, joint grab, mode switch) leaves the mode; the
  gripper keeps its last command so a held cube is not dropped (spec edge cases).

**Rationale**: Reuses the 001 baseline instead of a second IK; the closed-form wrist terms keep
it to position-only DLS, already tested. Parameters in `parity.json` keep the controller
reproducible in evaluation, the same rule 001 applied to the baseline gains.

**Alternatives considered**: 5-DoF DLS with an orientation task — more general, more tuning, and
the planar wrist makes it unnecessary. Joint-space waypoints from offline IK — no feedback, fails
when the cube is pushed during the descent.

## R6. Success definition and grasp evaluation

**Decision**:

- **Success** (spec SC-003): cube centre ≥ `liftCheck` (5 cm) above its resting height, both jaw
  bodies touching the cube, held continuously for 1 s, all within 10 s of the grasp starting.
  Time to lift = start of that 1 s hold.
- **Failure reasons** (first that applies, for the info panel and report): `not-graspable`
  (start pose outside the region, no attempt), `missed` (jaws closed on nothing), `slipped`
  (cube lifted then dropped), `knocked` (cube moved > 2 cm before closing), `timeout`.
- **Evaluation**: `npm run eval:grasp -- --n 100 --seed 0` places the cube uniformly in the
  graspable region with uniform yaw, from the reset state, on the shipped code path (Node,
  same `Session`). It writes a `GraspEvalReport` to `shared/grasp-eval.json`, the file the info
  panel reads. CI re-runs it and fails if the result differs from the committed file, so the
  panel's numbers are always reproducible (spec P3 AS2).

**Rationale**: The same discipline as 001: one definition, measured on the shipped code, shown as
measured. Writing into `shared/` mirrors how 001's `eval-compare.ts` stamps metrics into the
policy header.

**Alternatives considered**: Measuring in Python — not the shipped code path. Computing the
numbers in the browser on load — 100 grasps cost ~2 min of CPU.

## R7. The 001 reach policy on the new model (spec FR-008, option A)

**Decision**: After the model change, re-run 001's evaluation (`npm run eval` for baseline and
learned, n = 100 and 300, seed 0, with the cube at its default pose) and stamp the new numbers
into the policy header. **Retrain only if** the learned policy's success on 300 targets drops
below **91%** (3 points under its 94.0%) or its jerk ratio rises above **0.75**, or the
baseline drops below 99% on 100 targets (SC-003 of 001). Retraining uses
`training/scripts/train_final.sh` unchanged on the new model and the existing seed-selection
rule; all seeds are reported.

**Risks to watch**:

- Floor contact: 001 targets go down to `minZ = 1 cm` for the tip, and the fingertips sit ~6 mm
  below the tip, so low targets may now be blocked by the floor. If this is what fails, raise
  `reach.minZ` (and note the changed target definition in `validation.md`) rather than retrain.
- Self-collision of non-adjacent links in folded poses near the base.
- The jaw servo adds a little dynamics at the wrist; expected negligible.

**Rationale**: Cheapest path that keeps the comparison honest; the threshold is set before
measuring.

**Outcome (2026-10-05)**: floor and cube impacts dominated the jerk metric; `evalMinZ` = 0.04 was
introduced for evaluation and training (the visitor's `minZ` stays 0.01), the jerk ratio stayed
above 0.75, and the recipe was retrained on the v3 model. Details in `validation.md`.

## R8. Training side (Python)

**Decision**: `training/` stays the only writer of `parity.json`.

- `spec.py`: `PARITY_VERSION = 3`, `MODEL_PATH = "robot/so100.xml"`, validation of the new
  sections.
- `export.py`: writes `gripper`, `cube`, `grasp` (including the region and the wrist offsets of
  R4/R5); workspace sampling indexes qpos by joint address (the model now has 13 qpos).
- `env.py`: indexes ctrl by actuator id instead of `ctrl[:] = q` (now 6 actuators) and holds
  the jaw at `gripper.closed`; the cube rests at its default pose. The reach task is otherwise
  unchanged, so a retrain (R7) needs no new training code.
- `make_fixtures.py`: writes `contact-random.json`, and `grasp-recorded.json` by replaying
  `shared/parity/grasp-actions.json`, a ctrl sequence recorded by
  `web/scripts/record-grasp.ts` (the grasp controller exists only in TypeScript).

**Rationale**: Python stays the physics reference for every fixture; recording ctrl in TS and
replaying it in Python tests exactly the contacts the shipped controller produces, without a
second implementation of the grasp.

**Alternatives considered**: A Python copy of the grasp controller — duplicate logic that must
itself be kept in parity.

## R9. Interaction design

**Decision**:

- **Gripper button** in the toolbar: "Open gripper" / "Close gripper" toggle (key `G`), works in
  every mode. The button's state follows the command, including when the grasp controller
  drives it.
- **Grasp mode** in the mode switch, label "Grasp", public: selecting it starts an attempt from
  the current state; a status chip shows the phase (Approach, Descend, Close, Lift, Holding,
  Failed: reason). "Grasp again" in the chip restarts it.
- **Cancel**: dragging the target while in Grasp switches to Baseline (new mode-change reason
  `target-drag`); grabbing a joint switches to Manual (001 behavior).
- **Cube drag**: the cube is pickable when not held; dragging moves it over the floor, clamped
  to floor positions in front of the arm that do not overlap the arm (cube outside the region is
  allowed: the grasp then reports `not-graspable`). On release the worker teleports the cube
  (pose set, velocity zeroed). Yaw is kept; reset restores the default pose.
- **Reset** also restores the gripper to its default command (closed, close to 001's look) and
  the cube to its default pose.

**Rationale**: Smallest set of controls that covers the spec's flows on touch and mouse; the
target drag that already exists is the teleoperation interface for the by-hand grasp.

**Alternatives considered**: A separate "Grasp" button outside the mode switch — the spec models
the scripted grasp as a control mode, and the mode switch already explains "one controller at a
time". Cube rotation by gesture — not required by the spec; random yaw is covered by evaluation.

## R10. Performance and load

**Measured** (Node, WASM, laptop): physics step **4.7 µs** for the 001 model without contacts,
**7.2 µs** with collisions, jaw, floor and a resting cube (4 contacts). At 500 Hz that is ~3.6
ms of CPU per simulated second, so a 5× slower phone still stays under 20 ms/s.

**Decision**: No change to rates or threading. Load budget: +~45 KB raw (jaw collision
meshes), compressed size re-measured by `npm run size` against the 4 MB budget; SC-001/SC-002
e2e tests re-run, including during a grasp.

## R11. parity.json version 3

**Decision**: Bump `version` to 3. New sections `gripper`, `cube`, `grasp`; `model.path` →
`robot/so100.xml`. No change to `observation` or `action`. Details in
[contracts/parity-json.md](./contracts/parity-json.md). The policy header's `parityVersion`
becomes 3 when re-exported; the policy weights (and their hash) do not change unless R7 forces a
retrain.
