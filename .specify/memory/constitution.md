# web-robot Constitution

web-robot is a robot arm you can play with in your browser. A learned policy controls it live:
you move a target and it reaches for it, you shove it and it recovers. No installs, no server,
just a link.

## Core Principles

### I. Browser-Only Runtime

- The shipped product MUST run entirely in the viewer's browser from static hosting. No backend,
  API server, or server-side inference is permitted at runtime.
- Simulation, policy inference, and rendering MUST all execute client-side.
- The viewer MUST NOT need a dedicated/discrete GPU: policy inference MUST have a CPU execution
  path; hardware acceleration MAY be used as an optional enhancement only.
- The viewer MUST NOT need to install anything (no extensions, plugins, or native apps).

**Rationale**: "No installs, no server, just a link" is the product. Anything requiring a server
or special hardware breaks shareability and hosting cost assumptions.

### II. Sim Parity (NON-NEGOTIABLE)

- The browser simulation MUST match the training simulation in: robot model file, physics
  timestep (and control/substep frequency), observation layout and ordering, action layout and
  scaling, and observation/action normalization statistics.
- These parity-critical values MUST come from a single source of truth shared by training and
  the browser build (e.g., the same model file and an exported config), not duplicated by hand.
- Parity MUST be verified by automated tests that compare browser-side and training-side
  observations, actions, and state trajectories for identical inputs within stated tolerances.
- Any change to a parity-critical value MUST re-run the parity tests before merge; a failing
  parity test blocks release.

**Rationale**: A policy is only valid in the environment it was trained in. Silent drift makes
the demo lie. Parity is tested, not assumed.

### III. Every Rung Is Shippable

- Work is organized into milestones ("rungs"). Each rung MUST end in a public, working demo
  deployed to static hosting.
- Each rung's demo MUST stand on its own: understandable and compelling enough to be recorded as
  a standalone video without referencing future work.
- A rung is not complete until its demo is live at a public URL.

**Rationale**: Continuous, visible progress beats a big-bang release; each step proves the
pipeline end to end and produces something shareable.

### IV. Learned vs. Engineered Is Always Visible

- Every learned behavior MUST ship with a non-learned baseline for the same task (e.g., a scripted
  or classical controller such as IK/PD).
- The demo MUST let the viewer see or switch between the learned policy and its baseline under
  the same conditions.
- A learned behavior without a working baseline MUST NOT be released.

**Rationale**: Showing the engineered alternative makes clear what learning actually buys and
keeps claims honest.

### V. Minimal

- Scope is fixed at: one robot, one page, one policy per task.
- New dependencies, pages, robots, or abstractions MUST be justified against this principle in
  the plan's Constitution Check; unjustified additions are rejected.
- When choosing between adding and deleting, prefer deleting. Unused code, assets, and options
  MUST be removed.

**Rationale**: Small surface area keeps the static bundle light, parity tractable, and each rung
shippable.

## Platform Constraints

- Deployment target: static file hosting only (HTML, JS, WASM, model and asset files).
- All runtime assets (robot model, policy weights, normalization stats) MUST be served as static
  files alongside the page.
- The page MUST remain interactive (live control, target dragging, perturbation) on a typical
  laptop CPU without a discrete GPU.
- Training tooling MAY use any hardware or backend; only the shipped demo is bound by
  Principle I.
- Technology stack is intentionally not fixed by this constitution; it is decided per feature in
  `/speckit-plan` and MUST satisfy Principles I, II, and V.

## Development Workflow & Quality Gates

- Every implementation plan MUST include a Constitution Check covering all five principles and
  explicitly justify any deviation in its complexity tracking.
- Release gates for each rung:
  1. Parity tests pass (Principle II).
  2. Baseline controller present and switchable in the demo (Principle IV).
  3. Demo builds to static assets and runs with no backend (Principle I).
  4. Demo deployed to a public URL (Principle III).
- Reviews MUST reject changes that add scope without justification (Principle V).

## Governance

- This constitution supersedes all other project practices. Where guidance conflicts, the
  constitution wins.
- Amendments MUST be made via `/speckit-constitution`, documented with a Sync Impact Report, and
  reflected in dependent specs and plans before the next rung ships.
- Versioning follows semantic versioning:
  - MAJOR: removal or backward-incompatible redefinition of a principle or governance rule.
  - MINOR: new principle or section, or materially expanded guidance.
  - PATCH: clarifications, wording, and typo fixes with no semantic change.
- Compliance review: every `/speckit-plan` Constitution Check and every code review MUST verify
  adherence; `/speckit-analyze` findings that contradict the constitution are treated as blocking.

**Version**: 1.0.0 | **Ratified**: 2026-09-25 | **Last Amended**: 2026-09-25
