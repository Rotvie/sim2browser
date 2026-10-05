# Feature Specification: Contact-Robust Training

**Feature Branch**: `003-contact-training`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "003-contact-training: make the reach policy's training work with
contacts, then retrain it. Since 002, the robot model has a floor and a cube that collide with the
arm and gripper. On that model the 001 reach policy (trained without a floor) measures 94.7%
success and a tip-jerk ratio of 0.93 vs the baseline (300 targets at least 4 cm high), missing
SC-004 (95%) and SC-009 (0.70) of 001, because some of its paths brush the floor and each impact
is a jerk spike. Rerunning the 001 training recipe unchanged on the new model failed: 12.8% of
training episodes start with the arm inside the floor or cube, and impact jerk swamps the reward,
so the policy never learns. Goal: a training setup that is robust to contacts, which learned
grasping (next feature, 004) will reuse. Scope: collision-free start poses (and target/obstacle
placement), an impact-robust smoothness term in the reward, the cube present at random positions
during reach training, and fixing the recipe's seed fragility. Keep the jerk evaluation metric
unchanged. Success: SC-004 and SC-009 met on the v3 model over 300 targets, 3 of 3 seeds converge,
parity, grasp results and all 002 behavior intact. No change to the policy's observation or action
layout unless measurements force it."

## Purpose

002 gave the arm a floor and a cube. The learned reach policy was trained before either existed,
and on the new scene it is no longer smoother than the classical baseline: some of its paths brush
the floor, and every impact is a visible jolt. The demo's central claim (learned motion is
smoother) no longer holds on the live page.

This feature makes training work in a world with contacts, then retrains the reach policy so the
claim holds again, measured exactly as in 001. The same training setup is the foundation for
learned grasping (004), which is contact-heavy by nature.

## User Scenarios & Testing *(mandatory)*

Two audiences: the **visitor** who switches between Learned and Baseline on the page, and the
**developer/researcher** who retrains policies with the project's recipe (including for 004).

### User Story 1 - A training recipe that learns with contacts (Priority: P1)

The developer runs the project's training recipe on the current robot model (floor and cube
included) and gets a policy that learns to reach, on every seed tried.

**Why this priority**: Nothing else in this feature is possible without it, and 004 depends on
it. Today the recipe does not learn at all on the current model.

**Independent Test**: Run the recipe on 3 seeds on the current model; inspect the training logs
and the training-side evaluation for each seed.

**Acceptance Scenarios**:

1. **Given** the current robot model, **When** a training episode starts, **Then** the arm never
   starts inside the floor or the cube, and the target and cube are placed where they can coexist
   with the arm.
2. **Given** a training run, **When** the arm touches the floor during learning, **Then** the
   learning signal still reflects reaching progress (an impact is penalized, but does not drown
   out everything else).
3. **Given** 3 seeds of the recipe, **When** each finishes, **Then** every seed's policy has
   learned to reach and settle (no seed stuck at 0%), and all seeds' results are reported.

---

### User Story 2 - The live policy is smooth again (Priority: P2)

The visitor switches between Learned and Baseline on the page, with the floor and the cube present,
and sees the learned policy reach as reliably as before and visibly more smoothly than the
baseline, without hitting the floor or knocking the cube.

**Why this priority**: Restores the demo's thesis on the live page; depends on P1.

**Independent Test**: Evaluate the shipped policy on the shipped code path over 300 targets and
compare with the baseline; watch it on the page with the cube in several places.

**Acceptance Scenarios**:

1. **Given** the retrained policy is shipped, **When** it is evaluated over 300 random reachable
   targets, **Then** it meets the 001 success and smoothness targets (SC-001, SC-002).
2. **Given** the cube sits anywhere on the floor in front of the arm, **When** the learned policy
   reaches for targets, **Then** it avoids hitting the floor and rarely touches the cube (SC-003).
3. **Given** the policy changes, **When** the release checks run, **Then** parity, the scripted
   grasp's measured results and every 002 behavior are unchanged.

---

### User Story 3 - Honest reporting (Priority: P3)

The technical viewer reads the info panel and the validation log and sees the retrained policy's
measured numbers, how many seeds were run and how each did, and the before/after comparison.

**Why this priority**: The project's discipline; depends on P2.

**Independent Test**: Compare the info panel and the validation log with the release evaluation.

**Acceptance Scenarios**:

1. **Given** the retrained policy ships, **When** the info panel opens, **Then** it shows the
   newly measured success rate and smoothness, as measured, including any miss.
2. **Given** the training runs, **When** the validation log is read, **Then** it lists every seed
   with its result and the selection rule used.

---

### Edge Cases

- Targets near or below the cube's height, or right above the cube: the policy must not dive
  through the cube; such targets may be harder, and their results count like any other.
- A target behind the cube as seen from the arm: the arm may need to go around or over the cube.
- The visitor moves the cube during a reach: the policy reacts to contacts physically; no crash.
- A seed that still fails to converge after the recipe changes: reported, never hidden; the
  feature's seed criterion is then missed and recorded as such.
- The retrained policy is better on one target and worse on another: only the predefined
  evaluation decides.

## Requirements *(mandatory)*

### Functional Requirements

**Training setup (P1)**

- **FR-001**: Training episodes MUST start from arm poses that do not penetrate the floor or the
  cube.
- **FR-002**: The cube MUST be present during reach training, at varied positions on the floor in
  front of the arm, never overlapping the arm's start pose or the target.
- **FR-003**: The training reward MUST stay informative when contacts happen: a single impact may
  not outweigh the reward for reaching by orders of magnitude. Touching the floor MUST be
  discouraged explicitly.
- **FR-004**: The recipe MUST be run on at least 3 seeds, and every seed's outcome MUST be
  reported, including failures.
- **FR-005**: The training setup changes MUST be reusable by later learned features (004) without
  modification of their mechanism (e.g. collision-free starts and impact handling are general,
  not reach-specific).

**Shipped policy (P2)**

- **FR-006**: The shipped policy MUST be chosen by a selection rule fixed before the runs finish
  (as in 001), on a target set separate from the release evaluation.
- **FR-007**: The policy's observation and action layout MUST stay as in 002 unless measurements
  show it cannot meet the success criteria; any change MUST be justified in the plan.
- **FR-008**: The browser simulation the policy runs in MUST match its training environment,
  verified by the parity tests before release (Principle II).
- **FR-009**: The evaluation metric for smoothness MUST stay exactly the 001 definition (mean
  squared tip jerk, compared with the baseline on the same targets).
- **FR-010**: If no seed meets the targets, the feature MUST NOT ship a policy worse than the
  current one; a better-but-short policy may ship with its numbers reported as misses.

**Reporting (P3)**

- **FR-011**: The info panel MUST show the shipped policy's numbers from the release evaluation,
  not entered by hand.
- **FR-012**: The validation log MUST record every seed, the selection, and the before/after
  numbers on the same targets.

### Key Entities

- **Training recipe**: the staged training procedure, its reward terms and its episode setup
  (start poses, target and cube placement).
- **Training run**: one seed of the recipe; its curves and its training-side evaluation.
- **Selection rule**: how the shipped run is chosen among seeds, fixed in advance.
- **Release evaluation**: the 001 evaluation on the shipped code path (300 targets, at least 4 cm
  high, cube at its default pose), plus a cube-avoidance check.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The shipped policy reaches at least 95% of 300 random reachable targets (at least
  4 cm above the floor), with the 001 success definition.
- **SC-002**: Over the same 300 targets, its mean squared tip jerk is at most 70% of the
  baseline's (the 001 smoothness target).
- **SC-003**: Over the same 300 targets, the learned policy touches the floor in at most 1% of
  episodes and moves the cube by more than 1 cm in at most 2% of episodes.
- **SC-004**: All 3 seeds of the recipe learn to reach (training-side success at least 80% each);
  all are reported.
- **SC-005**: Parity tests, the scripted grasp's committed evaluation and all 002 end-to-end tests
  pass unchanged with the new policy.
- **SC-006**: The info panel shows exactly the release evaluation's numbers for the shipped
  policy.

## Assumptions

- The robot model, the floor and the cube are as shipped in 002; the policy does not observe the
  cube (no observation change, FR-007). It learns a cautious posture rather than explicit cube
  avoidance; SC-003 measures whether that is enough.
- Training runs on the developer's machine; a full recipe takes a few hours for 3 seeds, which is
  acceptable.
- "Converged" for SC-004 uses the training-side evaluation already in the project.
- The release evaluation keeps 002's target set definition (targets at least 4 cm high) so before
  and after numbers are comparable.
- The visible change on the page is the policy's behavior and the info panel's numbers; no new UI.

## Out of Scope

- Learned grasping (004).
- Observing the cube in the reach policy, or any change to the policy's inputs and outputs (unless
  FR-007's exception applies).
- Changing the smoothness metric.
- Arm self-collision (disabled since 002).
- Shove recovery.
