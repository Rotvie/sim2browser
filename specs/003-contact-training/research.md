# Research: Contact-Robust Training

Decisions for 003, with the measurements behind them (2026-10-05). Background: 002
`validation.md` ("Retraining on the v3 model fails as is", T030/T031).

## R1. Why the unchanged recipe failed

**Measured** (002, stopped run `v3-s*`, 13.6 M steps vs 001's `final-s1-a` at the same point):
jerk² 136,000–278,000 vs 513; distance 0.38–0.42 m vs 0.12 m; reward −9,300 to −12,300 vs −39.
12.8% of episodes start with the arm > 1 mm inside the floor or the cube. Jerk² ≈ 400,000 from the
first rollouts; the reward collapses as the penalty ramp brings the jerk term in.

**Conclusion**: two independent causes, both fixed below: penetrating start states (R2) and
unbounded impact jerk in the reward (R3).

## R2. Collision-free episode setup

**Decision**: rejection sampling at reset, in this order:

1. Cube: uniform yaw, position uniform on the floor in front of the arm (r ∈ [0.08, 0.40] m from
   the base axis, |angle| ≤ 80°), or, with probability 0.2, its default pose (the evaluation's).
2. Start pose: as in 001 (50% uniform in joint limits, 50% neutral + noise), resampled until no
   arm geom penetrates the floor or the cube (contact distance < −1 mm after `mj_forward`).
3. Target: as in 001, resampled while inside the cube's box grown by 4 cm (a target the tip
   cannot occupy).

**Measured**: 12.8% of 001-style starts penetrate; rejection costs < 1.2 attempts on average.

**Rationale**: removes impossible states without biasing the distribution beyond excluding them;
the cube varies so the policy cannot overfit one obstacle position (spec FR-002). A general
`collision_free_reset` helper is reusable by 004 (FR-005).

**Alternatives considered**: projecting penetrating poses out of the floor (biases poses toward
contact); starting only from neutral (loses 001's robustness to arbitrary poses).

## R3. Impact-robust smoothness term

**Measured** (001 policy `final-s1` on the v3 model, 200 episodes × 150 steps): per-step tip
jerk² on contact-free steps: median 1, p99 4,254, p99.9 11,800, max 100,898 (m²/s⁶); on steps with
an arm–floor or arm–cube contact: median 5,484, p99 155,317. With weight 2e-4, one impact step
costs up to ≈ 33, against ≈ 0.3 per step for the distance term.

**Decision**:

- `jerk` term: `−w_jerk · min(‖jerk‖², jerk_cap)` with `jerk_cap = 5,000` (≈ p99 of contact-free
  motion: 99% of normal steps are unchanged, an impact costs at most 1/step).
- New `floor` term: `−w_floor` (1.0) per control step in which any arm geom touches the floor.
- New `cube` term: `−w_cube` (0.5) per control step in which any arm geom touches the cube.

All in `training/reach/config.py` (training-only, not parity-critical). The evaluation metric is
untouched (spec FR-009): the cap only shapes learning; the policy is still judged on raw jerk.

**Rationale**: impacts stay strongly penalized (floor 1.0 + capped jerk 1.0 per step ≫ the
reach terms) but no longer dominate the value function's scale. Explicit contact penalties give
the policy a direct reason to avoid contact that the capped jerk alone would weaken.

**Alternatives considered**: removing jerk on contact steps (then impacts become free);
log-jerk (changes the shape for normal motion too); huber-style jerk (similar to the cap, one more
parameter).

## R4. Seed fragility (001's seed 2)

**Measured** (001 runs, end of each stage): seed 2 stalls at 0.17–0.19 m from the target, never
settles (0.000 in all stages), with the lowest jerk (215 vs 357–684) and exploration std down to
0.026: it learned to move little to avoid the smoothness penalties, a local optimum, while seeds 0
and 1 reach 0.11–0.12 m and settle ≈ 25%.

**Decision**: a performance-gated penalty ramp. The smoothness penalty scale grows only while the
training-side reaching improves: after each rollout, `penalty_scale` rises by `ramp_step` if the
rollout's mean distance is below the gate (≤ 0.15 m, i.e. reaching works), and stays otherwise;
it never decreases. Replaces the fixed 50% ramp of stage a; stages b and c keep full penalties.

**Rationale**: the fixed ramp applies the full penalty at 50% of stage a whether or not the policy
reaches yet; a seed that has not discovered reaching by then gets locked into standing still.
Gating keeps the incentive to reach dominant until reaching is learned.

**Alternatives considered**: entropy bonus / minimum log-std (keeps exploring but does not remove
the incentive to stand still); more seeds with early discard (the roadmap idea; hides fragility
rather than fixing it, and the spec asks 3/3); a nearby-target curriculum (helps precision, not
this failure mode).

## R5. Training budget and pilots

**Measured**: 002's aborted runs: ≈ 12,000 env steps/s per seed with 3 seeds in parallel (14,659
in 001 without contacts). Full recipe 100 M steps ≈ 2.3 h per 3 seeds.

**Decision**: a pilot first: stage a only, 10 M steps, 3 seeds (≈ 15 min). Go/no-go: distance at
10 M ≤ 0.20 m and falling, jerk² (raw, logged) < 5,000, floor-contact rate falling. Then the full
recipe (`train_final.sh <seed> c3`). Results of every run go to `validation.md`.

## R6. Selection and evaluation

**Decision**: keep 001's selection rule unchanged: among seeds, the best training-side proxy
success (seed 999, 300 targets) among those with proxy jerk ratio ≤ 0.70; all seeds reported.
Release evaluation: 001's (300 targets ≥ 4 cm, seed 0, cube at its default pose), extended to
count, per episode, arm–floor contact and cube displacement > 1 cm (spec SC-003). The Python
proxy (`reach/evaluate.py`) gets the same two counts, so selection can see them.

## R7. What does not change

Observation and action layout (spec FR-007), parity.json except the policy's normalization
statistics and hashes, the robot model, the browser code apart from the evaluation counters, and
the scripted grasp. Parity fixtures that involve the policy (`policy-recorded.json`) are
regenerated with the new run; the others must not change.
