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
| Mode switch | segmented control: `Manual` · `Baseline` · `Learned` | same | P2 (Learned from P3) |
| Reset | button | button | P1 |
| Observe/output panel | toggle button, collapsed by default | same, becomes a bottom sheet | P3 |

## Visible states

- **Active mode**: always highlighted in the mode switch (FR-010).
- **Out of reach**: the target changes color and a ring appears around it; label "out of reach"
  (FR-009).
- **First visit hint**: an animated hand/arrow pointing at the target (P1: at a joint) that
  disappears on the first interaction (FR-017). Not shown again once the visitor has
  interacted during that page session.
- **Loading**: a progress indicator until interactive; never a blank page.
- **Errors**: plain-language message plus a Retry button for asset failures; a "your browser
  lacks WebAssembly/WebGL" message for unsupported browsers.

## Panel content (P3)

- Observation groups with labels from `env-spec.json` (joint angles as small bars, tip/target as
  numbers, flag as badge), raw values, and normalized values on hover or tap.
- Output: 7 bars from −1 to +1 labeled "joint 1..7 command".
- Footer names both controllers: "Learned: PPO policy, 2×128 MLP" and "Baseline: damped
  least-squares IK" (R6 honesty note).
- When the mode is not Learned, the panel keeps showing live observations and shows the
  policy's outputs greyed out.

## Test hooks

`window.__webRobot` (present in all builds, read-only): `{ mode, q, target, reachable, fps,
lastPolicyStep }`. Playwright tests use it. It is not a public API.
