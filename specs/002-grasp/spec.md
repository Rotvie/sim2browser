# Feature Specification: Grasp

**Feature Branch**: `002-grasp` (spec directory)

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "002-grasp: gripper and a cube, no learning yet. Re-enable the
SO-100's jaw joint and actuator plus collision geometry (Menagerie's original so_arm100.xml has
the jaw, collision meshes and finger pads; see shared/robot/README.md for what 001 removed). Add
a cube to the scene. Add a scripted grasp controller built on the DLS IK baseline: reach above
the cube, descend, close the gripper, lift. Visitors can control the gripper in the UI
(open/close) alongside dragging the target, and watch the scripted grasp. Contact physics parity
tests: Python MuJoCo vs. WASM must agree with contacts. Honest, measured grasp success metrics in
the info panel, same discipline as 001. Constitution check: Principle V (one robot, one page, one
policy per task) still holds; grasping is a new task and a new feature. No learned grasping in
this feature (that is 003)."

## Purpose

Second public rung, and the first step from reaching toward manipulation. The arm gets its
gripper back and a cube to pick up. Visitors can grasp the cube themselves (drag the target, open
and close the gripper) or watch a scripted, non-learned controller pick it up.

**Demo thesis**: Grasping is harder than reaching, and the demo shows exactly how well a
hand-engineered grasp works, including where it fails. This scripted grasp is the baseline
(constitution Principle IV) that the learned grasp of feature 003 will be compared against, and
the same simulation must hold in training and in the browser once objects touch.

## User Scenarios & Testing *(mandatory)*

Same two audiences as 001: a **visitor** with no robotics background and a **technical viewer**
who wants to see measured results. Each story is a public release on its own (Principle III).

### User Story 1 - Gripper and cube, by hand (Priority: P1)

The visitor sees the arm with a working gripper and a cube on the ground in front of it. They
drag the target to move the arm (as in 001), open and close the gripper, and pick the cube up
themselves.

**Why this priority**: Proves the gripper, the cube and contact physics work in the browser, and
gives visitors a hands-on way to grasp. Every later story builds on it.

**Independent Test**: Open the public link on a laptop and on a phone; move the arm over the
cube, lower it, close the gripper, lift; drop the cube; push it with the arm; reset.

**Acceptance Scenarios**:

1. **Given** a first visit, **When** the page loads, **Then** the arm, its gripper and a cube
   resting on the ground are visible and interactive (see SC-001).
2. **Given** a reaching controller is active, **When** the visitor opens or closes the gripper,
   **Then** the jaw moves accordingly while the arm keeps following the target.
3. **Given** the open gripper is around the cube, **When** the visitor closes it and then drags
   the target upward, **Then** the cube is lifted with the gripper and stays held while the arm
   moves.
4. **Given** the cube is held, **When** the visitor opens the gripper, **Then** the cube falls and
   comes to rest on the ground.
5. **Given** the arm touches the cube without grasping it, **When** it moves through it, **Then**
   the cube is pushed physically; the arm never passes through the cube or the ground.
6. **Given** any cube state, **When** the visitor resets, **Then** arm, gripper, target and cube
   return to a default state.

---

### User Story 2 - Scripted grasp (Priority: P2)

The visitor starts a scripted grasp. The arm moves above the cube, opens the gripper, descends,
closes, and lifts the cube. The visitor can move the cube to a new spot and try again.

**Why this priority**: Delivers the non-learned grasp baseline that feature 003 will compete
against, and the core "watch it pick up the cube" moment of the demo.

**Independent Test**: Place the cube at many reachable positions and orientations, start the
scripted grasp each time, and check whether the cube ends up lifted.

**Acceptance Scenarios**:

1. **Given** the cube rests at a graspable position, **When** the visitor starts the scripted
   grasp, **Then** the arm goes through visible phases (approach above, descend, close, lift)
   and ends holding the cube lifted (see SC-003).
2. **Given** a scripted grasp is in progress, **When** the visitor drags the target, grabs a
   joint, or switches controller, **Then** the grasp is cancelled and the chosen interaction takes
   over from the current state, with no scene reset.
3. **Given** the cube is outside the graspable region (out of reach, behind the base, tipped
   over), **When** the visitor starts the scripted grasp, **Then** the demo says the cube cannot
   be grasped from there instead of attempting it, or attempts it and reports the failure; it
   never crashes or freezes.
4. **Given** the scripted grasp fails (cube slips, is knocked away, never closes on the cube),
   **When** the attempt ends, **Then** the demo shows the attempt failed and the arm returns to a
   safe pose.
5. **Given** the cube is not held, **When** the visitor drags the cube to a new spot on the
   ground, **Then** the cube moves there and rests stably.

---

### User Story 3 - Honest grasp metrics (Priority: P3)

The technical viewer opens the info panel and sees measured grasp results for the scripted
controller: success rate over a fixed set of cube placements, typical time to lift, and the
known failure modes. The panel also confirms the simulation in the browser matches the training
simulation, now with contacts.

**Why this priority**: Same honesty discipline as 001; makes the baseline's numbers citable for
003. Depends on P1 and P2.

**Independent Test**: Run the headless grasp evaluation on the shipped code path; compare its
numbers with the info panel; run the contact parity tests.

**Acceptance Scenarios**:

1. **Given** the info panel is open, **When** the visitor reads the grasp section, **Then** it
   shows the scripted grasp's success rate, sample size, median time to lift and main failure
   modes, all produced by the same evaluation that gates release.
2. **Given** the shipped build, **When** the evaluation is re-run, **Then** it reproduces the
   numbers in the panel exactly (fixed placements, deterministic simulation).
3. **Given** a change to anything the simulation depends on, **When** the parity tests run,
   **Then** they replay the same actions in the training and browser simulations, including
   grasps with contacts, and fail release if they disagree beyond the stated tolerance.

---

### Edge Cases

- Cube dragged into the arm, under the ground, or out of the reachable area: cube placement is
  kept to valid ground positions in front of the arm; it never overlaps the arm or the ground.
- Cube knocked over, rolling, or pushed out of reach: it comes to rest physically; reset restores
  it.
- Gripper closed on nothing, or on the cube's edge: no jitter or explosion; the cube either is
  held, slips out, or is pushed away.
- Arm pressed into the ground or the cube by the visitor's target: the arm stops at contact; the
  simulation stays stable (no objects flying off, no interpenetration visible).
- Cube held while the target goes out of reach: arm holds at its limits with the cube; no drop
  caused by the simulation itself.
- Controller switched (Baseline, Learned, Manual) while the cube is held: the gripper state is
  kept, so switching does not drop the cube.
- Tab hidden mid-grasp: simulation pauses and resumes cleanly, as in 001.
- Weak device: contacts make simulation heavier; motion may slow but the simulation stays
  correct.

## Requirements *(mandatory)*

### Functional Requirements

**Gripper, cube and contacts (P1)**

- **FR-001**: The arm MUST have a working gripper whose jaw opens and closes within its defined
  limits.
- **FR-002**: The scene MUST contain one cube, sized to fit the open gripper, resting on the
  ground in front of the arm.
- **FR-003**: The arm, gripper, cube and ground MUST collide physically: no part of the arm or
  the cube passes through another or through the ground.
- **FR-004**: Visitors MUST be able to open and close the gripper with mouse and with touch,
  independently of which reaching controller (Manual, Baseline, Learned) is active.
- **FR-005**: Visitors MUST be able to lift the cube by hand: grasp it with the gripper while a
  reaching controller follows the target, then lift and carry it.
- **FR-006**: Visitors MUST be able to move the cube to a new position on the ground when it is
  not held.
- **FR-007**: The existing reset MUST also restore the cube and gripper to a default state.
- **FR-008**: Everything from 001 MUST keep working: posing, Baseline, Learned, switching, the
  policy view and the info panel. The 001 reach policy MUST be re-measured on the new robot model
  (jaw, collisions) with 001's evaluation; it is retrained on the new model only if it falls
  clearly below its 001 numbers (threshold committed in the plan). Both the re-measured numbers
  and any retraining are reported in the info panel and validation log.

**Scripted grasp (P2)**

- **FR-009**: The demo MUST provide a scripted (non-learned) grasp controller that, from the
  current state, moves above the cube, opens the gripper, descends, closes, and lifts the cube.
- **FR-010**: The scripted grasp MUST handle any cube orientation about the vertical axis within
  the graspable region, by aligning the gripper with the cube.
- **FR-011**: The current grasp phase (approach, descend, close, lift, hold, done, failed) MUST be
  visible to the visitor while the grasp runs.
- **FR-012**: The visitor MUST be able to cancel a running grasp at any time by dragging the
  target, grabbing a joint, or switching controller, with no scene reset.
- **FR-013**: The scripted grasp MUST detect and report failure (cube not lifted at the end of
  the attempt) rather than claim success.
- **FR-014**: The scripted grasp MUST be a reasonable, competent controller, not deliberately
  weakened so a future learned grasp looks better (same rule as 001's FR-018).

**Metrics and parity (P3)**

- **FR-015**: The info panel MUST show the scripted grasp's measured success rate, sample size,
  median time to lift and main failure modes, generated by the release evaluation on the shipped
  code path, not entered by hand.
- **FR-016**: The grasp evaluation MUST use a fixed, reproducible set of cube placements and
  orientations and the same success definition everywhere it is reported.
- **FR-017**: The training-side and browser simulations MUST agree with contacts: automated
  tests MUST replay identical action sequences, including grasping and lifting the cube, in both
  and fail release on disagreement beyond the stated tolerance (Principle II).
- **FR-018**: Every new value the simulation depends on (cube size, mass, friction, gripper
  limits, contact settings) MUST come from the single source of truth shared with training, not
  duplicated by hand.

### Key Entities

- **Arm**: as in 001, plus a gripper with one jaw joint (open ↔ closed).
- **Cube**: the single movable object; position, orientation, size, mass; resting, held, or
  moving.
- **Target**: as in 001; the point reaching controllers follow.
- **Controller / control mode**: Manual, Baseline, Learned (from 001), plus Scripted Grasp;
  exactly one active. Gripper open/close is a separate visitor command.
- **Grasp attempt**: one run of the scripted grasp; start cube pose, phases passed, outcome
  (lifted / failed with reason), time to lift.
- **Grasp evaluation**: fixed set of cube placements, success definition, aggregated results
  shown in the info panel.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The 001 load budget still holds with the gripper and cube added: the scene is
  visible and interactive within 3 seconds on a first visit on a mid-range laptop and phone.
- **SC-002**: With contacts active, motion stays smooth: at least 30 visual updates per second on
  those devices, no visible stall longer than 100 ms, including during grasps.
- **SC-003**: Over 100 fixed cube placements in the graspable region (random position and
  orientation about the vertical axis), the scripted grasp lifts the cube in at least 90% of
  attempts. A success means the cube is at least 5 cm above the ground, held in the gripper, for
  1 second, within 10 seconds of the grasp starting.
- **SC-004**: Median time from grasp start to successful lift is at most 6 seconds over the same
  placements.
- **SC-005**: A visitor can pick up the cube by hand (drag target and gripper control only) within
  60 seconds, verified in a scripted end-to-end test and in informal testing with at least 3
  first-time visitors, of whom at least 2 succeed without instructions.
- **SC-006**: Zero crashes, freezes, objects flying off, or visible interpenetration across a
  10-minute scripted session of random dragging, gripper toggling, cube moves, grasp starts and
  cancellations, and controller switches.
- **SC-007**: Contact parity: replaying the same actions through a full grasp-and-lift in both
  simulations gives matching arm and cube trajectories within a tolerance committed in the plan.
- **SC-008**: 001's success criteria keep holding on the shipped build, with numbers re-measured
  and reported (not carried over).
- **SC-009**: The whole demo still runs from static hosting with no application server.

## Assumptions

- One page, one robot (Principle V): grasping is added to the 001 page, not a new page. Reaching
  and grasping are two tasks of the same arm; 002 adds no learned behavior, so "one policy per
  task" holds (reach: the 001 policy; grasp: no policy yet).
- Because 002 adds no learned behavior, its own release gates are 3 and 4; gates 1 and 2 still
  apply because the 001 learned policy keeps shipping.
- Gripper control is binary from the visitor's view (open / close); intermediate jaw positions
  are not exposed in the UI.
- The cube is a single rigid cube, about 3 cm per side; its exact size, mass and friction are
  fixed in the plan to fit the SO-100 gripper.
- The graspable region is the ground area in front of the base within the arm's reach, matching
  001's front-workspace definition; cubes elsewhere are reported as not graspable.
- Grasping is top-down only; side grasps and regrasping are out of scope.
- The scripted grasp is built on the 001 classical reaching controller.
- "Held" means the cube is in contact with both gripper fingers and moves with the gripper.

## Out of Scope

- Learned grasping, demonstrations, or imitation learning (feature 003).
- Recording demonstrations in the browser (003).
- More than one object, stacking, placing at a goal, or obstacles.
- Vision or camera-based perception; cube pose is known to the controller.
- Shove recovery.
- Real hardware.
