# Roadmap

Where the project stands and what comes next. The record of how each feature was built (spec,
plan, tasks, measurements, decisions) is in `specs/<feature>/`, especially each `validation.md`.

## Status (2026-10-07)

- **004-learned-grasping: in progress.** Deployed (P1, 2026-10-07): grasp controllers plug in by
  `task: "grasp"` and are judged by the session; per-controller grasp evaluation
  (`shared/grasp-eval/<id>.json`); demonstration recording (`?record`, `npm run demos`);
  parity.json v4; controller picker grouped by task. Built, not shipped yet: the learned grasp
  (behavior cloning + DAgger with a reactive expert, 96–98% on the selection placements without
  hand demos). Next: record ≥ 20 hand demonstrations, final runs, one evaluation against the 80%
  bar (`specs/004-learned-grasping/tasks.md`, T026 and T043–T047), then the comparison panel and
  grasp parity fixtures (US3).

- **001-arm-reach: shipped.** Live at https://rotvie.github.io/sim2browser/. P1 (pose the arm),
  P2 (DLS IK baseline reaches a draggable target) and P3 (PPO policy vs. baseline, policy view,
  honest metrics) are deployed; CI gates deploy on unit, training, parity, eval and e2e.
- **Controller registry**: `web/src/control/registry.ts` is the plug-in point; the example lab
  controller is shown with `?lab`.
- **Policy v2 deployed (2026-10-04)**: the policy controls 4 joints (Wrist_Roll held), parity.json
  version 2; shipped seed final-s1 of 3 (94.0% / jerk 0.715 on 300 targets).

- **003-contact-training: closed 2026-10-06 without a new policy** (infrastructure shipped: contact-
  robust training setup, floor/cube counters in the evaluation and the info panel).
- **002-grasp: deployed 2026-10-05.** Gripper and cube with contacts
  (`so100.xml`, parity.json v3), grasping by hand, a scripted grasp (100% of 100 placements,
  median 4.5 s to lift), measured numbers in the info panel, contact parity fixtures (≤ 5e-9).

## Open items from 002

- [ ] A reach reward that keeps 001's smoothness with contacts (003 closed without a new policy).
      003 made training work with the floor and the cube (collision-free resets, impact-capped jerk,
      floor/cube penalties, a gated ramp: every seed learns) but no run kept both precision and
      smoothness: capping all jerk removed the smoothness incentive, the full jerk penalty lost
      precision, fine-tuning the 001 policy traded ~7 points of success for smoothness. Next
      candidates: a jerk term relative to the policy's own contact-free jerk; observing the floor.
- [ ] SC-001 sits on the 3 s edge on mobile-chromium (≈ 3.00 s for both 001 and 002 on the
      development machine).
- [ ] Visitor test for grasping by hand (T059) and real-phone checks (T060).
- [ ] WebKit performance: since the contacts, CI's mobile-webkit runner shows 120–140 ms worker
      stalls in the circular-drag check (CI tolerance 150 ms, 100 ms elsewhere). Profile the worker
      on WebKit and confirm on a real iPhone.

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

## Toward manipulation (002 done as step 1; learned grasping is now 004)

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
2. **004: learned grasping from demonstrations** (in progress, see Status).
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
npm run test:parity && (cd web && npm test) && (cd training && uv run pytest)
```

Then continue 004 from `specs/004-learned-grasping/tasks.md` (first open task) and its
`quickstart.md`; measurements so far are in its `validation.md`. New features start spec-first:
`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`.
