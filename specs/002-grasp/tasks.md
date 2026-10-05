---

description: "Task list for 002-grasp"
---

# Tasks: Grasp

**Input**: Design documents from `specs/002-grasp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Parity tests are a release gate (constitution Principle II), and the spec's
success criteria are checked by the headless evaluations and Playwright e2e tests, as in 001.
Test tasks come before the implementation they verify and are expected to fail first.

**Analysis fixes (2026-10-05)**: `/speckit-analyze` findings C1–C4, I1–I4, U1, A3, G1, G2 are folded into T002, T011, T016, T023, T027, T032, T035, T038, T041, T053, T054, T058, T044.

**Organization**: One phase per user story (P1 → P2 → P3). Each story ends in a public deploy
(Principle III). Measurements go to `specs/002-grasp/validation.md` (created in T001), newest
entries at the bottom of each section, same style as `specs/001-arm-reach/validation.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1 = gripper and cube by hand, US2 = scripted grasp, US3 = honest grasp metrics

## Path Conventions (from plan.md)

- `web/` shipped app; `training/` offline Python; `shared/` single source of truth;
  `tests/parity/` cross-side parity tests
- `web/src/sim/` and `web/src/control/` MUST NOT import DOM or worker APIs (001 rule), so Node
  tests, evaluation and recording scripts import them
- `training/` is the only writer of `shared/parity.json`
- e2e tags for this feature: `@g1`, `@g2`, `@g3` (001 keeps `@p1`–`@p3`)

---

## Phase 1: Setup

**Purpose**: Bring in the Menagerie assets and the validation log.

- [X] T001 Create `specs/002-grasp/validation.md` with sections "Risk checks", "Measurements", "Decisions", and record the planning probes from research.md R2/R3/R10 (contact parity 1.6e-11, pad gaps table, 4.7 → 7.2 µs/step) as the first entries, marked "planning probe, 2026-10-05"
- [X] T002 [P] Download Menagerie's five jaw collision meshes (`Fixed_Jaw_Collision_1.stl`, `Fixed_Jaw_Collision_2.stl`, `Moving_Jaw_Collision_1.stl`, `Moving_Jaw_Collision_2.stl`, `Moving_Jaw_Collision_3.stl`) from `https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/c96a32d28fb5da84da38c1da4d749e7a13212855/trs_so_arm100/assets/` into `shared/robot/assets/`, unmodified (not decimated; they are 0.7–22 KB). The Vite plugin already serves every `X.stl` as `X.stl.bin` (`web/vite.config.ts`), no conversion step
- [X] T003 [P] Add e2e tags `@g1|@g2|@g3` to the grep in `.github/workflows/ci.yml` e2e job and to the tag list in `web/playwright.config.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The v3 robot model and `parity.json`, and a sim layer that no longer assumes
"actuators = arm joints" or "qpos = arm joints". Every story needs these. The 001 page must keep
working at the end of this phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Model and parity.json v3

- [X] T004 Rename `shared/robot/so100_reach.xml` → `shared/robot/so100.xml` (git mv) and apply research R1: restore the `Jaw` joint (class `Jaw`: `axis="0 0 1" range="-0.174 1.75"`) and `<position class="Jaw" name="Jaw" joint="Jaw" inheritrange="1"/>`; restore class `collision` (`group="3" type="mesh"`) and `finger_collision` (`type="box" solimp="2 1 0.01" solref="0.01 1" friction="1 0.005 0.0001"`) and every collision geom and the 8 pads exactly as in Menagerie `so_arm100.xml` at commit c96a32d; restore `<contact><exclude body1="Base" body2="Rotation_Pitch"/></contact>`; set `<option timestep="0.002" cone="elliptic" impratio="10"/>`; add `<geom name="floor" type="plane" size="1 1 0.05" group="3"/>` as the first worldbody child; add body `cube` at the default pose (`pos="0 -0.265 0.015"`) with `<freejoint name="cube"/>` and `<geom name="cube" type="box" size="0.015 0.015 0.015" mass="0.03" friction="1 0.005 0.0001" rgba="1 0.45 0.1 1" group="2"/>`; keep sites `tip` and `shoulder` unchanged; extend keyframe `home` with jaw `-0.174` and the cube's 7 free-joint coordinates; update the header comment
- [X] T005 [P] Update `shared/robot/README.md` "Modifications" for `so100.xml`: list what is now restored from Menagerie (jaw, collisions, pads, exclude, cone/impratio), what is added (floor, cube, keyframe), and that link collision uses the convex hull of the decimated visual meshes (research R1)
- [X] T006 Update `training/reach/spec.py`: `MODEL_PATH = "robot/so100.xml"`, `PARITY_VERSION = 3`, and add the v3 validation rules from `contracts/parity-json.md` ("`gripper.closed` and `gripper.open` within the jaw joint range; `closed < open`", "`grasp.region.rMin < grasp.region.rMax ≤ reach.maxReach`; `0 < maxAngle ≤ π/2`", "`cube.defaultPose` inside `grasp.region`")
- [X] T007 Test first: in `training/tests/test_spec.py` and `training/tests/test_export.py`, add failing tests for the v3 rules of T006 and for `export.py` writing `gripper`, `cube`, `grasp` with the shapes in `contracts/parity-json.md`; in `training/tests/test_env.py` add a test that `ReachEnv` resets with 6 actuators and the jaw held at `gripper.closed`
- [X] T008 Update `training/reach/export.py`: index qpos by joint address in `tip_samples` (replace `data.qpos[:] = q`, the model now has 13 qpos); write `gripper` (`joint`, `actuator`, `open: 1.0`, `closed: -0.174`, `maxSpeed: 3.0`, `default: "closed"`) and `cube` (`body`, `joint`, `size` read from the model geom, `defaultPose` read from the model body) sections; write the `grasp` section with the research R5 defaults (`approachHeight 0.08`, `descendSpeed 0.05`, `approachSpeed 0.15`, `liftHeight 0.08`, `liftSpeed 0.05`, `closeSettle 0.2`, `closeTimeout 1.0`, `knockedDistance 0.02`, `success: {liftCheck 0.05, hold 1.0, timeLimit 10.0}`) and placeholders for the computed values (`verticalOffset`, `rollOffset`, `fixedJawOffset`, `region`), which T011 fills
- [X] T009 Update `training/reach/env.py`, `training/reach/evaluate.py` and `training/reach/make_fixtures.py`: replace every `ctrl[:] = …` with writes through actuator ids of `parity.joints` (`self.aid`), set the jaw ctrl to `gripper.closed` on reset, and `mj_resetDataKeyframe(home)` before setting arm joints so the cube starts at its default pose; reach reward, observation and action unchanged
- [X] T010 Update `web/src/sim/parity.ts`: `PARITY_VERSION = 3`, `Parity` type gains `gripper`, `cube`, `grasp` (shapes from `contracts/parity-json.md`), and `validateParity` applies the same v3 rules as T006
- [X] T011 Compute the derived grasp values in `training/reach/export.py` (research R4/R5): `verticalOffset` = the constant `c` such that `Wrist_Pitch = c − Pitch − Elbow` points the jaws straight down (find it with `mj_kinematics` on a few poses and assert it is pose-independent to 1e-9); `rollOffset` = the Wrist_Roll at Rotation 0 that makes the jaw closing axis parallel to world x; `fixedJawOffset` = signed distance along the closing axis from `tip` to the fixed-jaw pad face minus (cube half-size + 3 mm clearance); `region` = for a 5 mm polar grid on the floor in front of the base, mark positions where the top-down pose with the tip at the grasp point and at `approachHeight` above it is within joint limits (closed-form planar IK on Pitch/Elbow); write the largest annulus sector (`center` = `reach.baseAxisXY`, `rMin`, `rMax`, `maxAngle`) fully inside the marked set. If `cube.defaultPose` falls outside it, move the default pose to the sector's centre line at mid radius (XML body pos and keyframe) and re-export. Record the values in `specs/002-grasp/validation.md`
- [X] T012 Run `(cd training && uv run python -m reach.export --run final-s1)` to write `shared/parity.json` v3 (model hash and files now include the 5 collision meshes), then `uv run pytest`; T007's tests pass

### Sim layer (TypeScript)

- [X] T013 Test first in `web/tests/unit/sim.test.ts` (new): with the v3 model, `createSim` succeeds; `sim.nu === 5` (arm actuators, unchanged plug-in API in README) and `sim.model.nu === 6`; `q()`/`qd()` return the 5 arm joints; `jaw()` returns the jaw angle; `cubePose()` returns the default pose; `setState(qpos, qvel, ctrl)` round-trips; `geoms()` reports `type`, `size` and `group` for the cube box and the floor plane
- [X] T014 Update `web/src/sim/mujoco.ts`: keep `sim.nu` = arm actuators (`parity.joints`, the documented plug-in API) and stop assuming it equals `model.nu`; replace the `model.nu !== n` check with "`model.nu === n + 1` and actuator `parity.gripper.actuator` exists"; map arm joints to actuator ids instead of assuming ctrl order; add `jaw()`, `jawTarget()`, `setJawTarget(v)` (clipped to the jaw range), `cubePose()` → `{pos, quat}`, `setCubePose(pos, quat)` (zero cube qvel, `mj_forward`), `contacts(geomA, geomB)` / `bodiesInContact(bodyA, bodyB)` from `data.contact`, and `setState(qpos, qvel, ctrl)` (full state, for fixtures); `resetToPose` also resets the jaw target to `gripper.closed` and the cube to `cube.defaultPose`; `geoms()` adds `type`, `size`, `group` per geom
- [X] T015 Update `web/src/sim/arm.ts` so `Arm` writes only the arm actuators via the actuator-id map from T014 (jaw untouched), and add `web/src/sim/gripper.ts`: `createGripper(sim, parity)` with `command` (`"open" | "closed"`, default `parity.gripper.default`), `set(command)`, and `step()` that moves the jaw target toward `open`/`closed` by at most `maxSpeed / controlHz` (data-model "Only the gripper path writes the jaw target")
- [X] T016 Update `web/src/sim/session.ts`: own a `Gripper`, call `gripper.step()` each control step after the active controller, expose `setGripper(command)`; `reset()` restores the gripper command to `gripper.default` and the cube to `cube.defaultPose`; add `jaw`, `gripper`, `cube: {pos, quat, held, graspable}` to `snapshot()` (held = both `Fixed_Jaw` and `Moving_Jaw` bodies in contact with `cube`; `graspable` from `isGraspable` in `web/src/sim/cube.ts`, so do T018 before this task)
- [X] T017 Update `tests/parity/trajectory.test.ts` and `tests/parity/fixtures.ts` to initialize from the full `init.qpos`/`init.qvel`/`init.ctrl` with `sim.setState`, and `tests/parity/versions.test.ts` to expect version 3 and the new model path; regenerate the three 001 fixtures with `(cd training && uv run python -m reach.make_fixtures --run final-s1)`; `npm run test:parity` passes
- [X] T018 Create `web/src/sim/cube.ts`: `cubeYaw(quat)`, `isUpright(quat)` ("cube's z axis within 10° of a world axis"), `inRegion(pos, region)`, `isGraspable(pose, region)` ("upright, resting, and centre inside `grasp.region`"), and `clampCubePlacement(xy, parity)` (floor, in front of the base: y ≤ base y − `reach.frontMargin`, outside `reach.baseExclusionRadius`, within `reach.maxReach`); unit tests in `web/tests/unit/cube.test.ts` first
- [X] T019 Update `web/src/protocol.ts` and `web/src/worker.ts` per `contracts/worker-protocol.md`: messages `setGripper`, `setCube`, `regrasp`; `ready` gains `gripper`, `cube`, `graspRegion`, geom `type`/`size`/`group`; `snapshot` gains `jaw`, `gripper`, `cube`, optional `grasp`; `ModeChangeReason` gains `"target-drag"` in `web/src/control/modes.ts`
- [X] T020 Run `npm test --workspace web`, `npm run test:parity`, `npm run build --workspace web` and the 001 e2e suite (`npx playwright test --grep "@p1|@p2|@p3"` in `web/`); the 001 page still works on the v3 model (cube rendered or not; T024 adds it)

**Checkpoint**: v3 model loads on both sides; 001 behavior intact; ready for stories.

---

## Phase 3: User Story 1 - Gripper and cube, by hand (Priority: P1) 🎯 MVP

**Goal**: Visitors open/close the gripper and pick up, carry, drop and push the cube; contact
parity holds; the reach policy is re-measured on the new model.

**Independent Test**: Quickstart §1–§3: parity incl. `contact-random` ≤ 1e-6; reach re-measure
recorded; on the deployed page, move over the cube, open, lower, close, lift, drop, push, reset.

### Tests for User Story 1

- [X] T021 [P] [US1] In `training/reach/make_fixtures.py`, add `contact_random()` writing `shared/parity/contact-random.json` per `contracts/parity-fixture.md` (kind `ctrl`, `fixtureVersion` 2): 300 control steps from `home` with the arm targets walking from a pose that places the open gripper over the cube (seeded `numpy` RNG, σ 0.04 rad per step, clipped to ctrl ranges) and the jaw toggling between `gripper.open` and `gripper.closed` every 60 steps; assert at generation "max contacts ≥ 4, at least one jaw–cube contact", else raise
- [X] T022 [P] [US1] Add `contact-random.json` to `tests/parity/trajectory.test.ts` as a `ctrl`-kind fixture: each step set all 6 ctrl values, step `substeps`, compare full `qpos` (13) and `qvel` (12) at ≤ 1e-6
- [X] T023 [P] [US1] (Done as two files: the grasping physics below runs on the worker's Session in `web/tests/unit/byHand.test.ts`, the page wiring in `web/tests/e2e/grasp-p1.spec.ts`, because steering the camera-plane target gizmo onto the cube by mouse is not reliable in e2e.) Write `web/tests/e2e/grasp-p1.spec.ts` tagged `@g1` (desktop and mobile projects): cube visible at load; gripper button toggles its label ("Open gripper" ↔ "Close gripper"), key `G` too; scripted by-hand grasp (drag target above cube, open, lower, close, lift by 6 cm) ends with snapshot `cube.held === true` and cube z ≥ 0.05; open drops it to rest (z ≈ 0.015 within 2 mm after 1 s); target pushed through the cube moves it (no interpenetration: cube z never < 0.0145); reset restores cube default pose and gripper `closed`; cube drag moves it on the floor and is refused while held; switching Baseline ↔ Learned while holding keeps `cube.held`; holding the cube with the target out of reach for 2 s keeps `cube.held`; dropping the cube onto the resting arm is refused (cube keeps its pose)

### Implementation for User Story 1

- [X] T024 [US1] Update `web/src/render/arm.ts`: skip geoms with `group === 3`; render `type` box geoms as `THREE.BoxGeometry(2·size)` with the geom rgba (the cube); keep mesh rendering as is
- [X] T025 [US1] Create `web/src/ui/gripperButton.ts` per `contracts/ui.md`: toolbar toggle, label "Open gripper" when closed / "Close gripper" when open (action button, no `aria-pressed`), key `G` (ignored while typing in inputs), sends `setGripper`; state follows `snapshot.gripper`; wire it in `web/src/app.ts`
- [X] T026 [US1] Add cube dragging (done in a new `web/src/render/cubeDrag.ts` beside the target gizmo; `picking.ts` stays the joint picker): hit-test the cube mesh first; while dragging, project the pointer onto the floor plane z = 0, show the target region ring (annulus sector from `graspRegion`, orange when outside), and on pointer up send `setCube {pos: [x, y]}`; do not start a drag while `snapshot.cube.held`; cursor `grab`; one-finger touch drags the cube, two-finger stays camera (001 behavior)
- [X] T027 [US1] Handle `setCube` in `web/src/sim/session.ts`: ignore while held; else `clampCubePlacement` (T018), keep the current yaw, place the cube resting (z = half size), zero velocity; refuse the placement (keep the old pose) if the cube at the new pose would overlap any arm geom (place it on scratch data, `mj_forward`, check for cube–arm contacts with penetration)
- [X] T028 [US1] Add the one-time hint "Close the gripper around the cube" after the first target drag in `web/src/ui/hint.ts` (`contracts/ui.md` "Hint")
- [X] T029 [US1] Generate `contact-random.json` (`uv run python -m reach.make_fixtures --run final-s1`) and run `npm run test:parity`; record the max difference in `specs/002-grasp/validation.md`. If > 1e-6, stop and follow research R2 (measure per component, document) before continuing
- [X] T030 [US1] Re-measure 001 on the new model (research R7): `npm run eval --workspace web -- --controller baseline --n 100 --seed 0`, `-- --controller learned --n 300 --seed 0` and `--n 100`, `npm run eval:compare --workspace web`; record success, settle time and jerk ratio next to the 001 values in `specs/002-grasp/validation.md`, plus the failing targets' heights (floor-contact check)
- [ ] T031 [US1] Decide per research R7 and record the decision in `specs/002-grasp/validation.md`: if failures cluster at low targets from floor contact, raise `MIN_Z` in `training/reach/export.py`, re-export and re-measure (note the changed target definition); if learned < 91% (300 targets) or jerk ratio > 0.75 or baseline < 99% (100 targets) after that, retrain with `training/scripts/train_final.sh` on the new model, select by the existing rule (best 300-target proxy success among seeds with jerk ≤ 0.70), report every seed, re-export with the new run and regenerate all fixtures
- [X] T032 [US1] Stamp the re-measured metrics into `shared/policy/reach.json` via `npm run eval:compare --workspace web` (`metrics`; `parityVersion` 3 is written by the T012 export); update `web/src/ui/infoPanel.ts` text only if the measured story changed (e.g. a new minimum height)
- [X] T033 [US1] Measure load and frame rate: `npm run build && npm run size` in `web/` (≤ 4 MB compressed before interactive) and the 001 perf e2e with the cube scene; record in `specs/002-grasp/validation.md` (SC-001, SC-002)
- [ ] T034 [US1] Run `npx playwright test --grep "@g1|@p1|@p2|@p3"` and the static-only spec; all pass. Deploy (push to `main` after review) and verify the live page by hand; record the deploy date in `specs/002-grasp/validation.md`

**Checkpoint**: P1 live. Gripper and cube by hand; contact parity in CI; reach numbers honest on
the new model.

---

## Phase 4: User Story 2 - Scripted grasp (Priority: P2)

**Goal**: A public "Grasp" mode that picks the cube up from the current state with visible phases,
cancels cleanly, and reports failures; its contacts are covered by a parity fixture.

**Independent Test**: Quickstart §4: select Grasp → "Lifted ✓" at the default pose and after
moving the cube; out-of-region cube → "Failed: cube out of reach" with no attempt; target drag
mid-grasp → Baseline with gripper state kept; `grasp-recorded` parity ≤ 1e-6.

### Tests for User Story 2

- [X] T035 [P] [US2] Unit tests in `web/tests/unit/grasp.test.ts` (Node, real sim): from reset with the cube at `cube.defaultPose`, the grasp reaches `done` within `grasp.success.timeLimit` with the cube ≥ `liftCheck` above rest; phases appear in order `approach, descend, close, lift, hold, done`; cube outside the region → `failed` with `not-graspable` and no arm motion; cube teleported 5 cm away during `descend` → `failed(knocked)`; cube removed (placed out of region) during `close` → `failed(missed)`; after `failed` the gripper is `open` and the tip returns to the approach point; Wrist_Pitch keeps the jaws vertical within 2° during `descend`; cube yaw 0, π/4, 1.2 rad all succeed
- [X] T036 [P] [US2] Unit tests in `web/tests/unit/modes.test.ts`: `setTarget` in `grasp` → `baseline` with reason `target-drag`; `dragJoint` in `grasp` → `manual` (`joint-grab`); visitor `setGripper` in `grasp` → `baseline` (`user`) then applies; `regrasp` in `grasp` starts a new attempt; leaving `grasp` keeps the gripper command
- [X] T037 [P] [US2] Write `web/tests/e2e/grasp-p2.spec.ts` tagged `@g2`: select Grasp → chip shows the phases and ends "Lifted ✓" within 10 s; drag cube to another in-region spot, "Grasp again" → "Lifted ✓"; drag cube outside the region (ring orange) → "Failed: cube out of reach"; target drag mid-grasp → mode Baseline, gripper state unchanged; 001 mode switch shows Manual · Baseline · Learned · Grasp

### Implementation for User Story 2

- [X] T038 [US2] Create `web/src/control/grasp.ts` (research R5, data-model "GraspAttempt"): `createGraspController(ctx)` returning a `Controller` plus `state()` → `{phase, failure, liftTime}`; on `enter()` start an attempt (`startTime`, `cubeStart`); `not-graspable` check first; phases `approach` (gripper open, tip target along a straight line to the approach point at `approachSpeed`), `descend` (to the grasp point at `descendSpeed`), `close` (gripper closed, wait for jaw speed < 0.05 rad/s for `closeSettle` or `closeTimeout`), `lift` (up `liftHeight` at `liftSpeed`), `hold`; failure rules exactly as the data-model state diagram (`knocked` = cube moved > `knockedDistance` before `close`; `missed` = jaws closed and not `held`; `slipped` = was lifted, then cube below `liftCheck` or not held; `timeout` = `success.timeLimit` since start); after `failed`: gripper open, tip back to the approach point
- [X] T039 [US2] In `web/src/control/grasp.ts`, implement the arm motion: DLS from `web/src/control/baseline.ts` (`dlsStep`, same `damping`, `gain`, `maxJointSpeed`) on Rotation, Pitch, Elbow only (3-column Jacobian slice of `jacSiteJoints`), `Wrist_Pitch = verticalOffset − Pitch − Elbow`, `Wrist_Roll = rollOffset + cubeYaw − Rotation` wrapped by π/2 to the nearest value within limits; grasp point = cube centre shifted by `fixedJawOffset` along the closing axis (horizontal, perpendicular to the jaw plane), at cube-centre height; write joint targets only through `arm.applyDelta` with the `maxJointSpeed / controlHz` cap
- [X] T040 [US2] Add the grasp success detector to `web/src/sim/eval.ts`: `graspSuccess` = cube centre ≥ `liftCheck` above its resting height and `held`, continuously for `success.hold`, all within `success.timeLimit`; used by both `grasp.ts` (`hold` → `done`) and the evaluation (T049), so there is one definition (FR-016)
- [X] T041 [US2] Register `grasp` in `web/src/control/registry.ts` (`label: "Grasp"`, public, description "Scripted top-down grasp built on the baseline: approach, descend, close, lift. No learning.", created on first selection); expose `state()` through `session.snapshot().grasp` in `web/src/sim/session.ts`; the grasp controller drives the gripper through `session`'s `Gripper` (not the jaw ctrl directly): extend `ControllerContext` with `gripper` (`set`, `command`) and `cube` (`pose()`, `held()`, `jawsClosed()`); existing controllers ignore them
- [X] T042 [US2] Implement the mode transitions in `web/src/sim/session.ts` and `web/src/control/modes.ts` per data-model "ControlMode (changed)": `setTarget` in `grasp` switches to `baseline` first (`target-drag`), visitor `setGripper` in `grasp` switches to `baseline` (`user`) then applies, `regrasp` restarts the attempt; T036 passes
- [X] T043 [US2] Create `web/src/ui/graspStatus.ts` per `contracts/ui.md` "Grasp status chip": visible only in `grasp` mode, phase texts, "Lifted ✓", "Failed: <reason in words>" (`not-graspable` → "cube out of reach", `missed` → "missed the cube", `slipped` → "cube slipped", `knocked` → "knocked the cube", `timeout` → "took too long"), "Grasp again" button sending `regrasp`; wire in `web/src/app.ts`
- [X] T044 [US2] Tune the `grasp` defaults only through `training/reach/export.py` (never in TS) until T035 passes at the default pose and the three yaws; re-export; record every change and why in `specs/002-grasp/validation.md`, aiming for the best grasp, never a deliberately weak one (FR-014)
- [X] T045 [US2] Create `web/scripts/record-grasp.ts`: Node session, cube at `cube.defaultPose` with yaw 0.3 rad, select `grasp`, record `init` (full qpos/qvel/ctrl) and every control step's full `ctrl` (6) through `hold` + 0.5 s into `shared/parity/grasp-actions.json` (`contracts/parity-fixture.md`); assert the attempt reached `done`, else exit non-zero
- [X] T046 [US2] In `training/reach/make_fixtures.py`, add `grasp_recorded()`: load `shared/parity/grasp-actions.json`, replay in Python from `init`, write `shared/parity/grasp-recorded.json` with `qpos`/`qvel` per step, and assert the cube ends ≥ `liftCheck` above rest; add the fixture to `tests/parity/trajectory.test.ts` (≤ 1e-6, plus the "cube lifted at the end in both engines" boolean check)
- [X] T047 [US2] Generate the fixture (`npx tsx scripts/record-grasp.ts` in `web/`, then `uv run python -m reach.make_fixtures --run final-s1`), run `npm run test:parity`, record the max difference in `specs/002-grasp/validation.md` (research R2 fallback if > 1e-6)
- [ ] T048 [US2] Run unit, parity, and `npx playwright test --grep "@g1|@g2|@p1|@p2|@p3"`; measure frame rate during a grasp on the mobile-chromium project (SC-002); deploy and verify the live page by hand; record in `specs/002-grasp/validation.md`

**Checkpoint**: P2 live. The scripted grasp is the baseline 003 will compete against.

---

## Phase 5: User Story 3 - Honest grasp metrics (Priority: P3)

**Goal**: Measured grasp results on the shipped code path, shown in the info panel, reproducible
by CI.

**Independent Test**: Quickstart §5: `eval:grasp` writes `shared/grasp-eval.json`; `--check`
reproduces it exactly; the panel shows the same numbers.

### Tests for User Story 3

- [X] T049 [P] [US3] Unit tests in `web/tests/unit/eval.test.ts`: `graspPlacements(parity, n, seed)` is deterministic, all placements inside `grasp.region`, centres uniform by area (mean radius within 3% of the analytic mean for n = 10,000), yaw in [0, π/2); `graspSuccess` (T040) on synthetic traces: lifted 1 s → success, lifted 0.9 s → fail, lifted after `timeLimit` → fail
- [X] T050 [P] [US3] Write `web/tests/e2e/grasp-p3.spec.ts` tagged `@g3`: open the info panel → "Scripted grasp" section shows success rate, sample size, median time to lift and failure counts equal to the values in `shared/grasp-eval.json`; ok/miss styling matches the targets (≥ 90%, ≤ 6 s)

### Implementation for User Story 3

- [X] T051 [US3] Add `graspPlacements` and `runGraspEpisode(session, placement)` to `web/src/sim/eval.ts` per `contracts/grasp-eval.md` (reset, `setCube`, settle 0.2 s, `setMode("grasp")`, step until `done`/`failed` or `timeLimit + 1` s; return success, timeToLift, failure)
- [X] T052 [US3] Create `web/scripts/eval-grasp.ts` and add `"eval:grasp": "tsx scripts/eval-grasp.ts"` to `web/package.json`: options `--n 100 --seed 0 --out ../shared/grasp-eval.json --check`; writes the `GraspEvalReport` (fields exactly as `contracts/grasp-eval.md`, with `parityJsonSha256` of the current `shared/parity.json`); prints a summary; `--check` recomputes and exits non-zero on any difference from the committed file; exit 0 when SC-003/SC-004 are missed
- [X] T053 [US3] Run `npm run eval:grasp --workspace web` with the CI Node major version (22) and commit `shared/grasp-eval.json`; after the first CI run, record in validation.md that `--check` passed on Linux; record success rate, median time to lift and failure counts in `specs/002-grasp/validation.md`. If < 90%, report as measured and open a follow-up in `docs/ROADMAP.md`; do not shrink `grasp.region` to pass (plan "Risks")
- [X] T054 [US3] Add the "Scripted grasp" section to `web/src/ui/infoPanel.ts` per `contracts/ui.md`: fetched from `grasp-eval.json` on first open (same pattern as the policy header), 4-sentence description of the phases, success rate "(target ≥ 90%)" and median time to lift "(target ≤ 6 s)" with `ok`/`miss` classes, failure counts by reason in words, sample size and the success definition ("cube ≥ 5 cm up, held for 1 s, within 10 s"); add `"grasp-eval.json"` to `SHIPPED` in `web/vite.config.ts` so the file is in the production build
- [X] T055 [US3] Add `npm run eval:grasp --workspace web -- --check` to the eval steps of `.github/workflows/ci.yml` (job `web`), so deploy depends on it; upload `shared/grasp-eval.json` as an artifact like `eval-baseline`
- [X] T056 [US3] Re-measure every 001 success criterion on the shipped build (SC-008): `eval` baseline/learned, `eval:compare`, perf and soak e2e; record in `specs/002-grasp/validation.md` next to the 001 values
- [ ] T057 [US3] Run all suites and `npx playwright test --grep "@g1|@g2|@g3|@p1|@p2|@p3"`; deploy and verify the panel on the live page; record in `specs/002-grasp/validation.md`

**Checkpoint**: P3 live. Feature complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T058 Extend `web/tests/e2e/soak.spec.ts` (`@soak`) for SC-006: 10 minutes of random target drags, gripper toggles (including closing on nothing), cube moves, grasp starts, cancels, controller switches and tab hide/show mid-grasp; assert no errors, no frame gap > 100 ms, cube always above the floor (z ≥ 0.0145 when resting) and within 2 m of the base
- [ ] T059 [P] Informal visitor test for SC-005: at least 3 first-time visitors try to pick up the cube by hand without instructions; record success count and time in `specs/002-grasp/validation.md`
- [ ] T060 [P] Real-phone check (drag cube, gripper button, Grasp mode, chip, info panel in portrait and landscape); record in `specs/002-grasp/validation.md`
- [X] T061 [P] Update `README.md` (demo text, results table with a grasp row from `grasp-eval.json`, model name `so100.xml`, how to evaluate the grasp) and `docs/ROADMAP.md` (002 status, open items, next: 003)
- [X] T062 [P] Minimality pass (Principle V): remove dead code and options left by the model rename and the sim split (e.g. any `so100_reach` references, unused accessors); `npm run lint --workspace web` and `uv run ruff check` clean
- [ ] T063 Run quickstart.md from a clean clone end to end and fix any step that fails

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks all stories. Order inside: T004 → T005/T006 →
  T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015 → T016 → T017 → T018 → T019 →
  T020.
- **US1 (Phase 3)**: after Phase 2. T029 (contact parity) and T030–T032 (reach re-measure) gate
  the P1 deploy (T034).
- **US2 (Phase 4)**: after Phase 2; deploys after US1 (one live page). Needs T018 (`cube.ts`)
  and T026 (cube drag) for its e2e test.
- **US3 (Phase 5)**: after US2 (evaluates the grasp controller).
- **Polish (Phase 6)**: after the stories it touches; T058 after US2.

### Story dependencies

- US1 → independent (MVP).
- US2 → uses US1's gripper and cube drag; the controller itself (T038–T042) can be built in
  parallel with US1's UI tasks once Phase 2 is done.
- US3 → requires US2.

### Within each story

Tests first (expected to fail), then implementation, then measure, then deploy.

## Parallel Opportunities

- Setup: T002, T003 together.
- Phase 2: T005 alongside T006–T008 (different files).
- US1: T021, T022, T023 together; T024, T025 together after T019.
- US2: T035, T036, T037 together; T043 (UI chip) in parallel with T038–T040 (controller).
- US3: T049, T050 together.
- Polish: T059–T062 together.

### Parallel example: User Story 2

```text
Task: "T035 Unit tests for the grasp controller in web/tests/unit/grasp.test.ts"
Task: "T036 Mode-transition tests in web/tests/unit/modes.test.ts"
Task: "T037 e2e grasp-p2.spec.ts tagged @g2"
# then
Task: "T038/T039 Grasp controller in web/src/control/grasp.ts"
Task: "T043 Grasp status chip in web/src/ui/graspStatus.ts"
```

## Implementation Strategy

### MVP first (US1)

1. Phase 1 + Phase 2 → v3 model on both sides, 001 intact (T020).
2. Phase 3 → gripper and cube by hand, contact parity, reach re-measure (and retrain only if R7
   says so).
3. **Stop and validate**: quickstart §1–§3; deploy P1.

### Incremental delivery

1. P1 live → by-hand grasping, honest reach numbers on the new model.
2. P2 live → scripted grasp with phases and failure reasons.
3. P3 live → measured grasp numbers in the panel, CI-reproducible.

Each deploy keeps the 001 suites green (constitution gates 1–4).

## Notes

- `parity.json` is only ever written by `training/reach/export.py`; tune grasp parameters there.
- Report every measurement as measured, including misses (spec FR-013/FR-015, 001 discipline).
- Commit after each task or logical group; record decisions in `validation.md` as they happen.
