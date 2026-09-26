# Roadmap

Where the project stands and what comes next. The record of how feature 001 was built (spec,
plan, tasks, measurements, decisions) is in [`specs/001-arm-reach/`](../specs/001-arm-reach/),
especially [`validation.md`](../specs/001-arm-reach/validation.md).

## Status (2026-09-26)

- **001-arm-reach: shipped.** Live at https://rotvie.github.io/sim2browser/. P1 (pose the arm),
  P2 (DLS IK baseline reaches a draggable target) and P3 (PPO policy vs. baseline, policy view,
  honest metrics) are deployed; CI gates deploy on unit, training, parity, eval and e2e.
- **Controller registry**: `web/src/control/registry.ts` is the plug-in point; the example lab
  controller is shown with `?lab`.

## Open items from 001

- [ ] Real-phone checks for P1–P3 (tasks T042, T057, T078): drag, two-finger depth, switch
  Learned ↔ Baseline mid-drag, policy view as a bottom sheet, info panel.
- [ ] Polish tasks T079 (edge-case e2e), T081 (5-visitor test for SC-006/SC-007), T082
  (minimality pass), T083 (quickstart from a clean clone).
- [ ] Credibility fixes for the learned policy:
  - Remove Wrist_Roll from the policy's action space (hold it at neutral). It is invisible to
    the reward and metrics, so the policy spins it. This changes the parity contract (action
    size 5 → 4): retrain, re-export, regenerate fixtures.
  - Train 3 seeds of the final recipe and report mean ± spread (currently a single seed; success
    is at the 95% threshold: 96% on 100 targets, 94.7% on 300).
- [ ] Chore: bump GitHub Actions versions (Node 20 deprecation warnings).

## Next feature: 002-grasp (toward manipulation)

Direction agreed: **learn in Python, run and evaluate in the browser**, with the same parity and
honest-evaluation discipline. The SO-100 is the arm the LeRobot community uses for manipulation.

1. **002-grasp: gripper and a cube, no learning yet.**
   - Re-enable the jaw joint and actuator, and collision geometry (Menagerie's original
     `so_arm100.xml` has the jaw, collision meshes and finger pads; see `shared/robot/README.md`
     for what 001 removed).
   - Add a cube; a scripted grasp built on the DLS baseline (reach above, descend, close, lift).
   - Gripper control in the UI; contact physics parity tests (Python vs. WASM with contacts).
   - Constitution check: Principle V (one robot, one page, one policy per task) still holds;
     a new task is a new feature.
2. **003: learned grasping from demonstrations.**
   - Record demonstrations in the browser (dragging the target with the IK baseline is already
     a teleoperation interface), export them, train an imitation policy in Python, deploy it
     back and compare it with the scripted controller.
   - Start state-based (object pose known); vision needs camera rendering and much larger
     networks than the plain-TypeScript MLP.
3. **Alternative, cheaper next step: shove recovery** (out of scope in 001's spec): push the arm
   and compare how the controllers recover. Deepens the RL side on the same setup.

## How to resume

```bash
cd ~/Downloads/misc/projects/sim2browser
npm install && (cd training && uv sync)   # tooling
npm run test:parity && (cd web && npm test)
```

Then start the feature spec-first: `/speckit-specify` with a description of 002-grasp (step 1
above), followed by `/speckit-plan`, `/speckit-tasks` and `/speckit-implement`.
