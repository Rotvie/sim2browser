# Contract: visitor-facing UI

One page (`index.html`), no routes. Covers FR-001–FR-017.

## Controls

| Control | Mouse | Touch | Available from |
|---------|-------|-------|----------------|
| Orbit camera | drag empty space | one-finger drag on empty space | P1 |
| Zoom | wheel | pinch | P1 |
| Pose joint | drag a link (rotates its joint) | drag a link | P1 |
| Move target | drag the target (in a plane facing the camera) | drag the target | P2 |
| Target depth | wheel over the target / shift-drag | two-finger drag on the target | P2 |
| Mode switch | segmented control: `Manual` + registry controllers (`Baseline` · `Learned`; lab controllers with `?lab`) | same | P2 (Learned from P3) |
| Reset | button | button | P1 |
| Observe/output panel | toggle button, collapsed by default | same, becomes a bottom sheet | P3 |
| Info panel | "i" button | same | P2 (baseline design), P3 (policy + metrics) |

## Visible states

- **Active mode**: always highlighted in the mode switch (FR-010).
- **Target**: blue sphere with a dashed stem to a ground dot (depth cue). **Out of reach**: it
  turns orange, a camera-facing ring appears around it, and an "Out of reach" label shows (FR-009).
- **Camera**: framed so the arm and its front workspace fit any aspect ratio (portrait phones
  back off further) until the visitor orbits or zooms.
- **First visit hint**: an animated marker labelled "Drag the target" on the target (P1: "Drag
  the arm" on the upper arm) that
  disappears on the first interaction (FR-017). Not shown again once the visitor has
  interacted during that page session.
- **Loading**: a progress indicator until interactive; never a blank page.
- **Errors**: plain-language message plus a Retry button for asset failures; a "your browser
  lacks WebAssembly/WebGL" message for unsupported browsers.

## Observe/output panel (P3)

- Observation groups with labels from `parity.json` (joint angles as small bars, target and
  tip → target as numbers, previous command as bars), raw values, and normalized values on hover
  or tap.
- Output: 5 bars from −1 to +1 labeled "joint 1..5 command".
- When the mode is not Learned, the panel keeps showing live observations and shows the
  policy's outputs greyed out.

## Info panel (P2 onward)

- **Baseline design**: damped-least-squares IK on tip position, gains, damping, and joint speed
  limit (read from `parity.json`); "tracks the target directly, no trajectory planning"; the caveat
  that a trajectory planner would also be smooth (research R6).
- **Learned policy** (P3): PPO, 2×128 MLP, what it observes, reward terms (distance, success bonus,
  action-rate and jerk penalties).
- **Measured results** (P3): success rate and jerk ratio vs. baseline from `reach.json` `metrics`,
  shown as-is even when below target (research R12).

## Test hooks

`window.__sim2browser` (present in all builds, read-only): `snapshot` (latest worker snapshot), `ready`,
`fps`, `maxFrameGapMs`, `resetFrameStats()`, `camera()`, `linkScreenPoint(bodyName)`, `bodyNames()`,
`limits()`, `targetScreenPoint()`, `worldToScreen(p)`. Playwright tests use it. It is not a public API.
