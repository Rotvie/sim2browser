# Validation log: 002-grasp

Measurements, manual checks and decisions recorded during implementation. Newest entries at the
bottom of each section.

## Risk checks

### Planning probes (2026-10-05, planning probe)

Original Menagerie `so_arm100.xml` (commit `c96a32d`) with this repo's decimated visual meshes and
Menagerie's five jaw collision meshes, MuJoCo 3.14.0 (Python wheel and `@mujoco/mujoco` WASM).

- **Contact parity**: arm + jaw + floor + resting 30 mm cube, 300 control steps × 10 substeps of a
  random ctrl walk with the jaw toggled every 60 steps, up to 8 contacts, elliptic cones: max |Δ|
  over qpos (13) and qvel (12) = **1.6e-11**; no step above 1e-6.
- **Physics cost** (Node, WASM, laptop): 4.7 µs/step for `so100_reach.xml` (no contacts),
  7.2 µs/step with collisions, jaw, floor and cube (4 contacts).
- **Gripper opening** (pad-centre distance minus pad thickness, home pose; fingertip pad … rear
  pad):

| Jaw (rad) | Gap |
|-----------|-----|
| −0.174 | 4 mm … 19 mm |
| 0.0 | 16 mm … 25 mm |
| 0.3 | 39 mm … 36 mm |
| 0.6 | 62 mm … 46 mm |
| 1.0 | 90 mm … 59 mm |

## Measurements

### T011: derived grasp values (2026-10-05)

`export.py` → `reach/grasp.py`, from `so100.xml`:

| Value | Result |
|-------|--------|
| `verticalOffset` | 1.570785757 rad (fingers down when Wrist_Pitch = this − Pitch − Elbow; fit residual < 1e-15) |
| `rollOffset` | −1.57079 rad (closing-axis yaw = Rotation + Wrist_Roll + 1.57079; residual 1.5e-11) |
| `fixedJawOffset` | 0.0101 m (fixed pad inner face at x = 0.0079 in Fixed_Jaw; cube half 0.015; clearance 3 mm) |
| `region` | centre (0, −0.0452), r ∈ [0.1212, 0.2612] m, \|angle\| ≤ 1.405 rad |

The region's angle is limited by the front margin at `rMin` (acos(0.02 / 0.1212) = 1.405), not by
the arm. `cube.defaultPose` (r = 0.2198) is inside it, so it stays where the plan put it.

## Decisions

### Wrist tilt at the approach point (2026-10-05, T011)

With the fingers exactly vertical, the approach point 8 cm above a cube at r = 0.2 m needs
Wrist_Pitch = 1.727 rad, past its 1.66 limit. The controller clips Wrist_Pitch to its limits (as
every browser controller does through `Arm`), so the fingers tilt slightly there. The region
allows ≤ 0.2 rad tilt at the approach point and ≤ 0.03 rad at the grasp point
(`MAX_TILT_APPROACH`, `MAX_TILT_GRASP` in `training/reach/grasp.py`). The region computation
also rejects poses where the open gripper touches the floor or the arm itself.

### Policy header metrics dropped by re-export (2026-10-05, T012)

`export.py --run final-s1` rewrites `shared/policy/reach.json` without `metrics` (they come from
`eval:compare`). The weights and their hash are unchanged; T030/T032 restore re-measured metrics.

### No arm self-collision (2026-10-05, T017)

With Menagerie's full collision set, the regenerated 001 fixture `trajectory-limits.json` (every
joint driven to its limits, folding the gripper into the base) diverged by 3.2e-5 at step 56,
growing to 9e-4 by step 60. Python and WASM were bit-identical (~1e-15) up to the substep where a
mesh-vs-mesh contact (Base hull vs Moving_Jaw collision mesh) came out with different depths from
identical state: Python −0.000219 m, WASM −0.000079 m. That is a degenerate flat-face case in convex
mesh collision, where last-bit noise picks a different face; `ccd_tolerance="1e-10"` with
200 iterations changed nothing (identical numbers).

Decision: arm collision geoms use `contype="2" conaffinity="1"` (class `collision` in `so100.xml`),
so the arm collides with the floor and the cube (and the pads with the cube) but not with itself,
exactly as in 001, which had no arm self-collision. All four trajectory/policy fixtures then pass at
1e-6. Consequence: in contrived poses (posing joints by hand) links can pass through each other, as
they could in 001. Spec FR-003 is read as arm vs. cube and ground.

### Joint-limit overshoot against the floor (2026-10-05, T020)

The 001 test that slams every joint between its limits (FR-005) now sees the stretched-out arm
press the gripper into the floor: Elbow overshoots its lower limit by up to 0.016 rad while the
floor pushes back, and by 0.014 rad on the rebound step after. MuJoCo joint limits are soft, so
the floor and the limit share the load. The test now keeps 0.01 rad for free motion and allows
0.02 rad during floor contact and the 0.1 s after it (`web/tests/unit/session.test.ts`).

### Collision geometry inlined as hulls (2026-10-05, T020)

First version: link collision through the decimated visual meshes, jaw collision through
Menagerie's five STL files. Time to interactive (P1 e2e, 12 Mbit/s + 40 ms, local preview) rose
past SC-001's 3 s on mobile-chromium (4× CPU). Measured on this machine, same session:

| Build | Model compile (WASM, warm) | mobile-chromium | desktop-chromium |
|-------|---------------------------|-----------------|------------------|
| 001 (`HEAD`, worktree) | 2–4 ms | 3.00–3.01 s | 2.91 s |
| 002, visual meshes as link hulls + 5 jaw STL | 20 ms | 3.07 s | — |
| 002, precomputed hull STL files (+10 requests) | 3 ms | 3.09 s | 2.99–3.02 s |
| 002, hulls inlined in the XML (vertices + faces) | 15 ms | 3.03–3.04 s | 2.94 s |
| 002, inlined, link hulls capped at 32 vertices | 9 ms | **3.01–3.03 s** | **2.93 s** |

Shipped: the last row. `training/scripts/make_hulls.py` takes MuJoCo's own hulls (`mesh_graph`),
caps the five link hulls at 32 vertices (`maxhullvert`; they only meet the floor and the cube) and
keeps the jaw hulls full, and writes them into `so100.xml`; no collision mesh files ship. The grasp
region and all parity fixtures are unchanged by the cap.

**SC-001 status**: 002 adds ~18 ms over 001 on both projects. On mobile-chromium that is 3.01–3.03 s
against the 3 s budget, a miss of 13–28 ms; the 001 build itself measures 3.00 s here today (it
measured 2.92–2.95 s when 001 shipped). Desktop passes (2.93 s).

### Contact parity, P1 fixtures (2026-10-05, T029)

Max |Δ| over qpos and qvel, every control step, WASM replay vs Python reference (v3 model):

| Fixture | Steps | Max |Δ| |
|---------|-------|---------|
| trajectory-random | 500 | 9.1e-12 |
| trajectory-limits | 500 | 9.4e-11 |
| policy-recorded | 500 | 2.3e-12 |
| contact-random (gripper lowered onto the cube, closed, random walk; max 10 contacts, jaw–cube contact) | 300 | 2.3e-13 |

### Cube pressed into the floor (2026-10-05, T023)

With MuJoCo's default contact parameters, the baseline pressing straight down on the cube sank it
4.7 mm into the floor (30 g cube, servo forces up to 3.5 N·m). The cube and the floor now use
`solref="0.004 1" solimp="0.95 0.99 0.001"`: 0.16 mm in the same press. Parity, the grasp region
and grasping by hand are unaffected.

### Grasping by hand with the baseline (2026-10-05, T023)

With the 001 baseline following the target, aiming 1.2–2 cm to the base side of the cube (so it
sits between the open jaws), lowering, closing and lifting holds the cube (lifted to z = 0.085–0.087,
jaw stops at ≈ 0.2 rad on the 30 mm cube). Aiming at the cube centre puts the fixed jaw on top of
it: only one jaw moves. Tested in `web/tests/unit/byHand.test.ts`.

### T030: 001 reach policy on the v3 model (2026-10-05)

`final-s1` (unchanged weights), seed 0, cube at its default pose. Mean squared tip jerk in m²/s⁶.

| `reach.minZ` | n | Baseline success | Baseline jerk | Learned success | Learned jerk | Jerk ratio |
|--------------|---|------------------|---------------|-----------------|--------------|------------|
| 001 (v2 model, 0.01) | 300 | 100% | — | 94.0% | — | 0.715 |
| 0.01 | 100 | 100% | 278.3 | 94.0% | 751.8 | 2.70 |
| 0.01 | 300 | 100% | 275.8 | 93.7% | 507.9 | 1.84 |
| 0.04 | 100 | 100% | 277.8 | 95.0% | 358.8 | 1.29 |
| 0.04 | 300 | 100% | 264.8 | 94.7% | 246.5 | 0.93 |

The mean is dominated by a few impacts: at `minZ` 0.01, target 38 (z = 0.021) drives the gripper into
the floor for 61 steps (jerk 47,590: 476 of the mean of 752), target 96 sweeps the arm into the
cube, target 82 sits just above the cube. Without those three the learned mean is ≈ 190 (ratio
≈ 0.68). At `minZ` 0.04 the learned policy's path still dips into the floor on the way to a
z = 0.058 target (jerk 11,601). The 001 policy never saw a floor.

### T031: retrain (2026-10-05)

- `reach.minZ` raised from 0.01 to 0.04 (`MIN_Z` in `export.py`): with the fingers 6 mm or more below
  the tip, targets under 4 cm force the gripper into the floor in many orientations. This changes
  the reach target set: numbers before and after are not comparable target-for-target.
- After that, the learned jerk ratio on 300 targets (0.93) is above the R7 trigger (0.75), so the
  recipe is retrained on the v3 model: `scripts/train_final.sh <seed> v3` for seeds 0, 1, 2 (runs
  `v3-s*`, started 2026-10-05; `train_final.sh` gained a run-name argument so the shipped
  `final-s*` runs are kept). Selection by the existing rule; every seed reported.

### Scripted grasp and its parity fixture (2026-10-05, T035–T047)

- Unit tests (`web/tests/unit/grasp.test.ts`, 13): lifts from the default pose through
  approach → descend → close → lift → hold → done; lifts cubes turned 0, π/4 and 1.2 rad;
  fingers ≤ 2° from vertical when closing (≤ 0.2 rad on the way down, where the wrist limit
  bites); `not-graspable` without moving; `knocked`; `missed`; hand-over rules; regrasp.
- `grasp-recorded.json` (cube yaw 0.3 rad, 359 control steps, lifted at 5.66 s): max |Δ| 4.2e-9
  over qpos and qvel (cube qpos 3.1e-11); the cube ends lifted in both engines.
- e2e `@g2` (desktop, mobile Chromium, mobile WebKit): 9 checks pass.

### minZ split (2026-10-05, T031)

Raising `reach.minZ` to 0.04 also raised the clamp on the visitor's target, so the gripper could no
longer be lowered around the 3 cm cube (the by-hand tests failed: FR-005). `reach.minZ` is back at
0.01 (UI clamp and reachability grid, as in 001) and the new `reach.evalMinZ` = 0.04 is the lowest
target the evaluation (`reachableTargets`) and training (`sample_reachable`) sample. Retraining
stage a of the `v3-s*` runs started with `minZ` 0.04 for both; stages b and c see the split
(sampling ≥ 4 cm in all stages; the clamp only affects unreachable targets during training).

### Grasp tuning and evaluation (2026-10-05, T044, T052–T053)

Defaults (approach 0.15, descend 0.05, lift 0.05 m/s): 100% of 100, median time to lift 6.07 s
(SC-004 miss). Tuned in `export.py` only, aiming for the best grasp:

| approach / descend / lift (m/s) | Success (100, seed 0) | Median time to lift |
|---|---|---|
| 0.15 / 0.05 / 0.05 | 100% | 6.07 s |
| 0.15 / 0.08 / 0.08 | 100% | 5.15 s |
| 0.20 / 0.08 / 0.08 | 100% | 4.76 s |
| **0.20 / 0.10 / 0.10** (shipped) | **100%** | **4.46 s** |

Shipped setting on 300 other placements (seed 1): 100%, median 4.52 s, no failures.
`shared/grasp-eval.json` (n = 100, seed 0) is reproduced exactly by `eval:grasp --check` under
Node 26 and Node 22 (CI's version) on macOS; the first CI run checks Linux.

### Retraining on the v3 model fails as is (2026-10-05, T031)

The unchanged recipe (`train_final.sh <seed> v3`, seeds 0–2) was stopped at 14.5 M of stage a's 40 M
steps: it never learned. At 13.6 M steps, compared with the 001 run at the same point
(`final-s1-a`): tip jerk² 136,000–278,000 vs 513, distance to target 0.38–0.42 m vs 0.12 m, episode
reward −9,300 to −12,300 vs −39. Jerk² is ≈ 400,000 from the start and the reward collapses as the
penalty ramp brings the jerk term in.

Causes: 12.8% of training episodes start with the arm more than 1 mm inside the floor or the cube
(`p_random_start` samples joint angles uniformly, which the contact-free 001 model allowed), and
random exploration hits the floor; every impact is a jerk spike far larger than the reach terms.
A retrain needs a recipe change (collision-free start poses; an impact-robust smoothness term),
not just a rerun. Status: open; the shipped policy is still `final-s1` (see the P1 gate notes).

### SC-001/SC-002 re-measured without training load (2026-10-05, T033)

The 3.01–3.03 s mobile figures above were taken while the retraining runs held the CPU. Near idle:
mobile-chromium 3.003–3.006 s, desktop-chromium 2.93–2.96 s, against 3.00 s and 2.91 s for the 001
build earlier the same day: within ~5–30 ms, so 002 keeps SC-001 where 001 had it, on the 3 s edge
on the throttled mobile project. The full e2e suite (`@p1|@p2|@p3|@g1|@g2|@g3`, 3 projects) passes:
61 tests, including SC-001 and the SC-002 frame-rate checks.

### T032: policy header (2026-10-05)

`shared/policy/reach.json` metrics re-measured on the v3 model (`final-s1`, 300 targets ≥ 4 cm,
seed 0): success 94.7%, jerk ratio 0.931, baseline 100%. SC-004 (95%) and SC-009 (0.70) are missed
and shown as misses in the info panel.

### T058: 10-minute soak, SC-006 (2026-10-05)

desktop-chromium, seed 12345: passed. 772 actions (172 target drags, 54 cube drags, gripper
toggles, Grasp mode and "Grasp again", tab hide/show, resets, mode switches); no errors, no NaN,
joints within limits (0.02 rad allowance against the floor), cube never more than 1.5 mm into the
floor or flung away; max snapshot gap 100.8 ms.
