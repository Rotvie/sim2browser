# Feature Specification: Learned Grasping

**Feature Branch**: `004-learned-grasping` (spec directory)

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "004 learned grasping from demonstrations: record grasp
demonstrations in the browser (the draggable target with the IK baseline plus gripper control
serves as the teleoperation interface; the scripted grasp may also generate demonstrations),
export them, train a state-based imitation policy in Python (cube pose known, no vision, small
MLP that runs in plain TypeScript), deploy it back to the browser with parity tests (Python vs.
TypeScript network and physics), and compare it with the scripted grasp under the same honest
evaluation (lift success over 100 random cube placements, median time to lift), shown in the info
panel. Constitution Principle V: one robot, one page, one policy per task; grasping is a new
task."

## Purpose

Third step toward manipulation, after 002 (gripper, cube, scripted grasp) and 003 (contact-robust
reach training, closed without a new policy). The arm learns to pick up the cube from
demonstrations instead of following a hand-written script.

**Demo thesis**: A grasp learned from examples, running live in the browser, next to the
engineered grasp it learned from, with measured numbers for both. The visitor sees what learning
from demonstrations buys and what it costs, and can switch between the two on the same cube
placement.

## User Scenarios & Testing *(mandatory)*

Same audiences as 001 and 002: a **visitor** with no robotics background, and a **technical
viewer** who wants measured results. A third actor appears: the **demonstrator**, who records
grasps that become training data (the project author; see Assumptions). Each story is a public
release on its own (Principle III).

### User Story 1 - Record grasp demonstrations (Priority: P1)

The demonstrator opens the demo in recording mode, picks up the cube by hand (drag the target,
open and close the gripper, as in 002) or lets the scripted grasp do it, and each attempt is
recorded. When done, they save the collected demonstrations as a file that the training side
can read.

**Why this priority**: Without demonstrations there is nothing to learn from. It also proves the
browser is a usable teleoperation interface and that a recorded browser episode can be replayed
exactly on the training side.

**Independent Test**: In recording mode, record several hand grasps and several scripted grasps
(successful and failed), save the file, replay every recorded episode in the training
simulation, and check that each replay reproduces the recorded outcome and trajectory.

**Acceptance Scenarios**:

1. **Given** recording mode, **When** the demonstrator starts an attempt and grasps the cube by
   hand or with the scripted grasp, **Then** the attempt is recorded from start to end with its
   outcome (lifted or not).
2. **Given** a recorded attempt has ended, **When** the demonstrator reviews it, **Then** they can
   keep or discard it, and the running count of kept demonstrations is visible.
3. **Given** kept demonstrations, **When** the demonstrator saves them, **Then** a single file is
   downloaded that contains every kept attempt, enough to replay it exactly in the training
   simulation.
4. **Given** a saved file, **When** its episodes are replayed in the training simulation,
   **Then** every replay reaches the same outcome as in the browser (lifted or not), and its
   state difference and time to lift are reported. Contact events can amplify the
   engines' ~1e-11 differences in some episodes; how often is measured and reported.
5. **Given** normal (non-recording) mode, **When** a visitor uses the demo, **Then** nothing is
   recorded and no recording controls are shown.

---

### User Story 2 - Learned grasp, live (Priority: P2)

The visitor places the cube and starts the learned grasp. The arm, driven by the policy trained
on the demonstrations, approaches, closes the gripper and lifts the cube. The visitor can switch
to the scripted grasp on the same placement and compare.

**Why this priority**: The core moment of the feature: a learned manipulation skill running live
in the browser, beside its engineered baseline (Principle IV).

**Independent Test**: Place the cube at many reachable positions and orientations, run the
learned grasp and the scripted grasp from the same placement each time, and check whether each
lifts the cube.

**Acceptance Scenarios**:

1. **Given** the cube rests in the graspable region, **When** the visitor starts the learned
   grasp, **Then** the policy controls the arm and gripper and the attempt ends lifted or failed,
   with the outcome shown.
2. **Given** any cube placement, **When** the visitor starts the learned grasp and then the
   scripted grasp (or the reverse) after a reset to the same placement, **Then** both run under
   identical conditions.
3. **Given** a learned grasp is in progress, **When** the visitor drags the target, grabs a joint,
   switches controller, or moves the cube, **Then** the learned grasp is cancelled and the chosen
   interaction takes over from the current state, with no scene reset (same as the scripted
   grasp).
4. **Given** the learned grasp fails (misses, drops, knocks the cube away, runs out of time),
   **When** the attempt ends, **Then** the demo reports the failure; it never claims success.
5. **Given** the policy view from 001 is open, **When** the learned grasp runs, **Then** the view
   shows what the grasp policy sees and outputs.

---

### User Story 3 - Honest comparison (Priority: P3)

The technical viewer opens the info panel and sees the learned grasp and the scripted grasp
measured on the same placements: success rate, median time to lift, failure modes, plus how many
demonstrations the policy learned from and where they came from. The panel confirms that the
browser and training simulations match, and that the browser runs the same network as training.

**Why this priority**: Same honesty discipline as 001 to 003; makes the numbers citable. Depends
on P1 and P2.

**Independent Test**: Run the headless grasp evaluation for both controllers on the shipped code
path; compare with the info panel; run the parity tests for the grasp policy.

**Acceptance Scenarios**:

1. **Given** the info panel is open, **When** the viewer reads the grasp section, **Then** it
   shows both controllers' success rate, sample size, median time to lift and failure modes,
   produced by the evaluation that gates release, and the number and source of the training
   demonstrations.
2. **Given** the shipped build, **When** the evaluation is re-run, **Then** it reproduces the
   numbers in the panel exactly.
3. **Given** a change to the policy or to anything the simulation depends on, **When** the
   parity tests run, **Then** they compare the grasp policy's outputs and a full learned grasp
   between training and browser and fail release on disagreement beyond the stated tolerance.
4. **Given** the learned grasp is weaker than the scripted one, **When** the viewer reads the
   panel, **Then** the gap is shown plainly, with the main failure modes.

---

### Edge Cases

- Cube placed outside the graspable region: the learned grasp says it cannot grasp from there, or
  attempts and reports the failure, as the scripted grasp does; no crash or freeze.
- Cube placement unlike any demonstration (edge of the region, unusual turn): the policy may fail;
  the failure is reported and counted, not hidden.
- Policy closes the gripper on nothing, or drops the cube mid-lift: the attempt ends as failed;
  the arm returns to a safe pose.
- Policy pushes the arm into the floor or the cube: physics stays stable (as in 002); contacts
  are counted in the evaluation.
- Visitor drags the cube while a grasp runs: the attempt is cancelled (not counted as a
  failure), as for the scripted grasp; the visitor starts a new one or uses Retry.
- Demonstrator records an attempt where the cube is knocked away or never lifted: it is marked
  failed and excluded from training unless explicitly kept as such.
- Demonstration file from an older simulation version: rejected with a clear message rather than
  silently replayed on a different model.
- Switching between learned grasp, scripted grasp, Baseline, Learned reach and Manual while the
  cube is held: the gripper state is kept (as in 002).
- Tab hidden mid-attempt or mid-recording: simulation and recording pause and resume cleanly.

## Requirements *(mandatory)*

### Functional Requirements

**Recording demonstrations (P1)**

- **FR-001**: The demo MUST offer a recording mode, not shown to regular visitors, in which grasp
  attempts are recorded.
- **FR-002**: In recording mode, both hand grasps (target dragging and gripper control as in 002)
  and scripted grasps MUST be recordable.
- **FR-003**: Each recorded attempt MUST store enough to replay it exactly in the training
  simulation: the starting scene (arm, gripper, cube pose), the commands applied at every control
  step, the states reached, the outcome (lifted or failed, with reason) and its source (hand or
  scripted).
- **FR-004**: The demonstrator MUST be able to keep or discard each attempt and see the count of
  kept attempts by source and outcome.
- **FR-005**: Kept attempts MUST be saved as one downloadable file, identified with the
  simulation version it was recorded on.
- **FR-006**: The training side MUST replay recorded attempts and reject files recorded on a
  different simulation version.
- **FR-007**: The training data MUST be mostly scripted-grasp demonstrations (generated in bulk
  on the training side from the 002 scripted grasp) plus at least 20 hand demonstrations recorded
  in the browser; the share of each source MUST be reported (FR-019).

**Learned grasp (P2)**

- **FR-008**: A grasp policy MUST be trained offline from the demonstrations by imitation, using
  the known cube pose and the robot's own state (no camera images).
- **FR-009**: The grasp policy MUST run in the browser on the CPU, with no server, alongside the
  existing reach policy.
- **FR-010**: The visitor MUST be able to start the learned grasp and the scripted grasp from the
  same cube placement and switch between them under identical conditions (Principle IV).
- **FR-011**: The learned grasp MUST control the arm and the gripper from the start of the attempt
  to the lift, and MUST end in a reported outcome: lifted or failed with a reason.
- **FR-012**: The visitor MUST be able to cancel or override a running learned grasp at any time
  (drag target, grab joint, switch controller, move cube), with no scene reset.
- **FR-013**: The policy view MUST show the grasp policy's inputs and outputs while it runs.
- **FR-014**: Everything from 001 to 003 MUST keep working: posing, reach Baseline and Learned,
  scripted grasp, gripper by hand, policy view, info panel, and their measured numbers.
- **FR-015**: The learned grasp ships only if it lifts the cube in at least 80% of the 100
  evaluation placements (at most 3 candidates are evaluated on them, all reported); otherwise the feature closes without deploying a grasp policy (as 003
  did) and the recording, training and evaluation results are documented.

**Pluggable grasp controllers**

- **FR-023**: Grasp controllers (scripted, learned, and future ones) MUST plug in through one
  documented interface, as reach controllers already do: adding a new grasp algorithm MUST NOT
  require changes to the page, the recording mode or the evaluation beyond registering it.
- **FR-024**: The headless grasp evaluation MUST run any registered grasp controller on the same
  placements and produce the same report format, so a new algorithm can be compared with the
  scripted and learned grasps without new evaluation code.
- **FR-025**: The demonstration file format MUST be documented and independent of the training
  method, so other learning algorithms can train on the same demonstrations.

**Comparison and parity (P3)**

- **FR-016**: The info panel MUST show, for the learned and the scripted grasp, the success rate,
  sample size, median time to lift and failure modes, generated by the release evaluation on the
  shipped code path, not entered by hand.
- **FR-017**: Both grasps MUST be evaluated on the same fixed, reproducible set of cube placements
  and with 002's success definition (cube at least 5 cm up, held for 1 s, within 10 s).
- **FR-018**: The evaluation placements MUST NOT be among the placements used for the training
  demonstrations, and this MUST be checked automatically.
- **FR-019**: The info panel MUST state how many demonstrations the policy was trained on and
  their source (hand, scripted).
- **FR-020**: Automated parity tests MUST show that the browser computes the same grasp policy
  outputs as training for identical inputs, and that a full learned grasp gives the same arm and
  cube trajectory in both simulations, within tolerances committed in the plan (Principle II).
- **FR-021**: Every new value the grasp policy depends on (its input and output layout, scaling,
  normalization) MUST come from the single source of truth shared with training.
- **FR-022**: Training MUST be reproducible and reported honestly: the number of training runs
  (seeds), each run's result, and how the shipped run was chosen (on placements separate from the
  evaluation set), as in 001.

### Key Entities

- **Demonstration**: one recorded grasp attempt; starting scene, per-step commands and states,
  outcome, source (hand or scripted), simulation version.
- **Demonstration set**: the saved collection of kept demonstrations used for training; counts by
  source and outcome.
- **Grasp policy**: the learned controller for the grasp task; inputs (robot state, cube pose),
  outputs (arm and gripper commands); one per task (reach and grasp each have one).
- **Grasp attempt**: one run of a grasp controller (learned or scripted): start placement, outcome,
  time to lift, failure reason.
- **Grasp evaluation**: fixed placement set, success definition, per-controller results shown in
  the info panel; disjoint from the demonstration placements.
- **Controller**: Manual, reach Baseline, reach Learned, Scripted Grasp (from 001–002), plus
  Learned Grasp; exactly one active.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The learned grasp lifts the cube in at least 80% of 100 fixed evaluation
  placements, with 002's success definition (release bar, FR-015).
- **SC-002**: The learned grasp's median time to lift over the same placements is at most
  8 seconds, reported next to the scripted grasp's 4.5 s (a target with a PASS/MISS verdict;
  the release bar is SC-001 alone).
- **SC-003**: The scripted grasp's numbers are re-measured on the shipped build and still meet
  002's criteria (at least 90% lifted, median at most 6 s).
- **SC-004**: A demonstrator can record, review and save 20 hand demonstrations in under 30
  minutes.
- **SC-005**: Every recorded demonstration replays on the training side with the same outcome as
  in the browser (100% of a saved file).
- **SC-006**: The load budget and smoothness from 001 and 002 still hold with the second policy
  added: interactive within 3 seconds on first visit, at least 30 visual updates per second,
  no stall longer than 100 ms during a learned grasp.
- **SC-007**: Parity: grasp policy outputs agree between training and browser within a tolerance
  committed in the plan; a full learned grasp and a replayed demonstration give matching arm and
  cube trajectories in both simulations within the contact tolerance committed in 002.
- **SC-008**: Zero crashes, freezes or objects flying off across a 10-minute scripted session of
  learned grasps, scripted grasps, cancellations, cube moves and controller switches.
- **SC-009**: The whole demo still runs from static hosting with no application server.
- **SC-010**: A third grasp controller (for example a trivial example controller) can be added and
  evaluated against the scripted and learned grasps by writing one controller and registering it,
  verified by doing so in a test.

## Assumptions

- One page, one robot (Principle V): the learned grasp is added to the existing page. Reach and
  grasp are two tasks with one policy each, so the page ships two policies.
- The demonstrator is the project author. Recording mode is opened by a page option that is not
  advertised to visitors (like 001's `?lab`), and demonstrations are saved as a download and
  committed with the training setup; visitors never send data anywhere (Principle I).
- State-based only: the policy receives the cube's position and orientation directly. Vision is
  out of scope.
- Top-down grasps of the single cube in 002's graspable region, as in 002.
- The scripted grasp from 002 is the baseline for Principle IV and is not changed to make the
  learned grasp look better.
- The 001 reach policy stays live and unchanged (003 decision); reach improvements remain an open
  roadmap item outside this feature.
- The policy is a small network of the kind that already runs in the demo (the reach policy);
  its exact size and the training method details are decided in the plan.
- The simulation model and contact settings are those of 002 (parity.json v3); a change to them
  is out of scope unless the plan justifies it.

- Platform direction: the project is meant to become a general testbed for plugging in and
  comparing distinct control and learning algorithms. This feature therefore keeps the grasp
  task, the demonstration format and the evaluation algorithm-agnostic. Generality is limited to
  what this feature uses (grasp interface, demo format, evaluation); no extra frameworks or
  abstractions without a second user (Principle V).

## Out of Scope

- Vision or camera-based policies.
- Visitors contributing demonstrations, or any data upload from the page.
- Reinforcement-learning fine-tuning of the grasp policy (possible later feature).
- Placing the cube at a goal, stacking, more objects, side grasps, regrasping.
- Changing the reach policy.
- Shove recovery, real hardware.
