# Feature Specification: Arm Reach

**Feature Branch**: `001-arm-reach` (spec directory; project is not a git repository yet)

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "Reach: a robot arm in the browser that reaches a target the visitor
moves, driven by a learned policy, with a classical baseline to compare against."

## Purpose

First public web-robot demo. It proves the whole pipeline (arm in the browser, a controller, a
public link) and shows what a learned policy does compared to a hand-engineered controller.

**Demo thesis**: Motion quality. Both controllers reach the target; the baseline gets there
exactly but mechanically (abrupt starts/stops, jerky corrections), while the learned policy moves
smoothly and naturally. The difference is visible just by watching both on the same target.

## User Scenarios & Testing *(mandatory)*

Two audiences: a **visitor** with no robotics background arriving from a video or post, and a
**technical viewer** (researcher, recruiter, lab) who wants to see what the policy observes and
does. Each story below is a public release on its own (constitution Principle III).

### User Story 1 - See and pose the arm (Priority: P1)

The visitor opens the link and sees a robot arm in a 3D scene. They orbit the camera and move
each joint by hand.

**Why this priority**: Proves the arm, the scene, and the public link work end to end. Every
later story builds on it.

**Independent Test**: Open the public link on a laptop and on a phone; orbit the camera; drag
each joint through its full range and past its limits.

**Acceptance Scenarios**:

1. **Given** a first visit on a typical laptop or phone, **When** the visitor opens the link,
   **Then** the arm is visible and interactive within 3 seconds.
2. **Given** the scene is loaded, **When** the visitor drags on empty space, **Then** the camera
   orbits around the arm; pinch/scroll zooms.
3. **Given** the scene is loaded, **When** the visitor drags a joint, **Then** that joint rotates
   and the rest of the arm follows kinematically.
4. **Given** a joint at its limit, **When** the visitor keeps dragging past it, **Then** the joint
   stays at its limit with no jump, jitter, or error.
5. **Given** the visitor is continuously posing joints, **When** motion is ongoing, **Then** the
   scene stays smooth (see SC-002).

---

### User Story 2 - Baseline reaches the target (Priority: P2)

A target sits in the scene. The visitor drags it anywhere; a classical (non-learned) controller
moves the arm so its tip follows the target continuously.

**Why this priority**: Delivers the core "reach" interaction and the engineered reference that
the learned policy is later compared against (Principle IV).

**Independent Test**: With the baseline active, drag the target to many reachable and
unreachable positions, both in single moves and continuous sweeps.

**Acceptance Scenarios**:

1. **Given** the baseline is active, **When** the visitor places the target at a reachable
   position, **Then** the arm tip settles on the target (see SC-003).
2. **Given** the baseline is active, **When** the visitor drags the target continuously, **Then**
   the arm follows without stalls or freezes.
3. **Given** the baseline is active, **When** the target is placed out of reach, **Then** the arm
   stretches toward it, stops at its limits, and the target is visibly marked as out of reach;
   no crash, flicker, or oscillation occurs.
4. **Given** the target moves from unreachable back to reachable, **When** it re-enters reach,
   **Then** the arm resumes reaching it.

---

### User Story 3 - Learned policy vs. baseline (Priority: P3)

Same scene, same target. The visitor switches between "learned policy" and "baseline" and sees
both reach under identical conditions. A panel shows, live, what the policy observes and what it
outputs.

**Why this priority**: The thesis of the demo; depends on P1 and P2.

**Independent Test**: With the learned policy active, run the same target positions used for P2;
switch controllers mid-reach; open the panel and watch values change as the target and arm move.

**Acceptance Scenarios**:

1. **Given** the learned policy is active, **When** the target is placed at reachable positions,
   **Then** the tip reaches the target at or above the success rate committed in the plan
   (SC-004).
2. **Given** either controller is active mid-motion, **When** the visitor switches controller,
   **Then** the arm pose and target position are preserved and the newly selected controller
   continues from the current state (no scene reset).
3. **Given** the learned policy is active, **When** the visitor opens the observe/output panel,
   **Then** it shows the policy's current observations and outputs, updating live as the arm and
   target move.
4. **Given** the learned policy is active, **When** the target is out of reach, **Then** the arm
   behaves without crash or glitch, and any difference from the baseline is visible.

---

### Edge Cases

- Target dragged inside the arm's own body or base, or below the ground plane: target is kept in
  a valid region (clamped) and the controller behaves as for an unreachable target.
- Target moved faster than the arm can follow: arm keeps pursuing the latest position; no
  queueing of stale positions.
- Visitor grabs a joint while a controller is active: manual posing takes over; control mode
  switches to Manual until the visitor selects a controller again.
- Tab hidden or backgrounded: simulation pauses and resumes cleanly without a burst of catch-up
  motion.
- Device too weak to hold smooth motion: simulation stays correct (motion may slow) rather than
  diverging; the demo never shows a physically broken arm.
- Assets fail to load (network error): the visitor sees a plain message with a retry, not a blank
  page.
- Browser lacks required features: the visitor sees a message naming the problem instead of a
  broken scene.
- Phone in portrait vs. landscape: controls and the panel remain usable in both.

## Requirements *(mandatory)*

### Functional Requirements

**Scene & posing (P1)**

- **FR-001**: The demo MUST open from a single public link with no install, sign-in, or backend
  (Principle I).
- **FR-002**: The demo MUST show one robot arm in a 3D scene with a ground reference.
- **FR-003**: Visitors MUST be able to orbit and zoom the camera with mouse and with touch.
- **FR-004**: Visitors MUST be able to rotate each joint individually by direct manipulation with
  mouse and with touch.
- **FR-005**: Every joint MUST stay within its defined limits under all interaction and control
  modes.
- **FR-006**: The demo MUST offer a one-action reset to a default arm pose and target position.

**Target & baseline (P2)**

- **FR-007**: The scene MUST contain one target the visitor can drag in 3D with mouse and with
  touch.
- **FR-008**: The demo MUST provide a classical (non-learned) controller that continuously drives
  the arm tip toward the target.
- **FR-009**: When the target is unreachable, the arm MUST move toward it and hold at its limits,
  and the demo MUST visibly indicate the target is out of reach.
- **FR-010**: The demo MUST provide control modes: Manual, Baseline, and (from P3) Learned. Exactly
  one mode is active at a time and the active mode is always visible.

**Learned policy & comparison (P3)**

- **FR-011**: The demo MUST provide a learned policy that drives the arm toward the target,
  running entirely on the visitor's device.
- **FR-012**: Visitors MUST be able to switch between Learned and Baseline at any time without
  resetting arm pose or target.
- **FR-013**: Both controllers MUST act on the identical simulated arm, with identical target and
  conditions, so differences are attributable to the controller alone.
- **FR-014**: The demo MUST provide a panel showing, live, the policy's observations and its
  outputs, labeled in human-readable terms. The panel MUST be collapsible so it does not obstruct
  casual visitors.
- **FR-015**: The browser simulation the policy runs in MUST match its training environment, and
  this match MUST be verified by automated checks before release (Principle II).
- **FR-016**: The demo MUST make the motion-quality difference (smooth learned motion vs.
  exact-but-mechanical baseline motion) visible without explanatory text (see Purpose).
- **FR-018**: The baseline MUST be a reasonable, competent classical controller: it MUST NOT be
  deliberately degraded to make the learned policy look better. Its mechanical character comes
  from its design, not from sabotage.

**Onboarding**

- **FR-017**: On first load, the demo MUST make the primary action (drag the target / pose the
  arm) discoverable without reading instructions, e.g. through an obvious affordance or short
  visual hint that disappears after first interaction.

### Key Entities

- **Arm**: the single robot; joints, each with angle and limits; a tip whose position is
  compared to the target.
- **Target**: a point in the scene set by the visitor; reachable or unreachable.
- **Controller / control mode**: Manual, Baseline, or Learned; exactly one active.
- **Policy observation**: the values the learned policy receives each step (e.g. joint state,
  target relative position).
- **Policy output**: the values the policy emits each step to move the arm.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a first visit over a typical broadband or 4G connection, the arm is visible and
  interactive within 3 seconds on a mid-range laptop and a mid-range phone.
- **SC-002**: While posing or reaching, motion appears smooth: at least 30 visual updates per
  second on those same devices, with no visible stalls longer than 100 ms.
- **SC-003**: With the baseline active, for 100 random reachable targets, the tip settles on the
  target in at least 99% of trials within 2 seconds of the target being released.
- **SC-004**: With the learned policy active, the tip reaches reachable targets at a success rate
  of at least the threshold committed in the plan (proposed floor: 90% over the same 100 targets
  and same settle definition as SC-003).
- **SC-005**: Zero crashes, freezes, or visibly broken arm poses across a 10-minute scripted
  session of random dragging, including unreachable targets and rapid controller switching.
- **SC-006**: In informal testing with at least 5 first-time visitors without robotics background,
  at least 4 move the target or a joint within 10 seconds without being told how.
- **SC-007**: In the same testing, at least 4 of 5 visitors, after switching controllers, describe
  the learned policy's motion as smoother or more natural than the baseline's, without
  explanation.
- **SC-009**: Over the same 100 reachable targets, the learned policy's motion is measurably
  smoother than the baseline's: lower average abruptness (rate of change of acceleration) of the
  arm tip, by a margin committed in the plan.
- **SC-008**: The whole demo runs from static hosting: loading it generates no requests to any
  application server.

## Assumptions

- "Side by side" means switching one arm between controllers in the same scene, not two arms at
  once (constitution Principle V: one robot, one page).
- "Settles on the target" means the tip comes to rest within a small distance of the target;
  the exact tolerance is fixed in the plan and shared by SC-003 and SC-004.
- "Typical laptop/phone" means devices roughly 3-4 years old without a discrete GPU.
- The 3-second load target applies to first visit; repeat visits are expected to be faster.
- Grabbing a joint while a controller is active switches to Manual mode.
- The learned policy is trained offline, outside the browser; training tooling is not part of the
  shipped demo.
- Robot model choice (which arm, how many joints) is decided in the plan.
- The target is the only movable object; no obstacles in this feature.

## Out of Scope

- Recovering from shoves or perturbations (next feature).
- Manipulating objects, drawing.
- Real hardware.
- Training in the browser.
- Multiple robots.
