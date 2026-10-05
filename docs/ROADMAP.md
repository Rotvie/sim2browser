# Roadmap

Where the project stands and what comes next. The record of how each feature was built (spec,
plan, tasks, measurements, decisions) is in [`specs/001-arm-reach/`](../specs/001-arm-reach/) and
[`specs/002-grasp/`](../specs/002-grasp/), especially their `validation.md`.

## Status (2026-10-04)

- **001-arm-reach: shipped.** Live at https://rotvie.github.io/sim2browser/. P1 (pose the arm),
  P2 (DLS IK baseline reaches a draggable target) and P3 (PPO policy vs. baseline, policy view,
  honest metrics) are deployed; CI gates deploy on unit, training, parity, eval and e2e.
- **Controller registry**: `web/src/control/registry.ts` is the plug-in point; the example lab
  controller is shown with `?lab`.
- **Policy v2 deployed (2026-10-04)**: the policy controls 4 joints (Wrist_Roll held), parity.json
  version 2; shipped seed final-s1 of 3 (94.0% / jerk 0.715 on 300 targets).

- **002-grasp: implemented, not deployed yet (2026-10-05).** Gripper and cube with contacts
  (`so100.xml`, parity.json v3), grasping by hand, a scripted grasp (100% of 100 placements,
  median 4.5 s to lift), measured numbers in the info panel, contact parity fixtures (≤ 5e-9).

## Open items from 002

- [ ] Retrain the reach policy with contacts. On the v3 model the 001 policy measures 94.7% and a
      jerk ratio of 0.93 (300 targets ≥ 4 cm), because some paths brush the floor. Rerunning the
      recipe unchanged failed (12.8% of episodes start inside the floor; impact jerk swamps the
      reward): it needs collision-free start poses and an impact-robust smoothness term.
- [ ] SC-001 sits on the 3 s edge on mobile-chromium (≈ 3.00 s for both 001 and 002 on the
      development machine).
- [ ] Visitor test for grasping by hand (T059) and real-phone checks (T060).

## Open items from 001

- [ ] Real-phone checks for P1–P3 (tasks T042, T057, T078): drag, two-finger depth, switch
      Learned ↔ Baseline mid-drag, policy view as a bottom sheet, info panel.
- [ ] Polish tasks T079 (edge-case e2e), T081 (5-visitor test for SC-006/SC-007), T082
      (minimality pass), T083 (quickstart from a clean clone).
- [x] Credibility fixes for the learned policy (2026-10-04, `validation.md` "Follow-up"):
      Wrist_Roll removed from the policy (parity.json v2, action size 4); 3 training seeds of the
      recipe: 92.0% / 94.0% / 0% on 300 targets. The shipped seed: 94.0%, jerk ratio 0.715.
- [ ] Make the training recipe robust: 1 of 3 seeds never learns to settle, and the shipped policy
      misses SC-004 (95%) and SC-009 (0.70) on 300 targets by a small margin. Ideas: a
      success-rate curriculum (start with nearby targets), more seeds with early discard of
      non-converging runs (reported, not hidden), longer stage a.
- [ ] Chore: bump GitHub Actions versions (Node 20 deprecation warnings).

## Toward manipulation (002 done as step 1)

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
