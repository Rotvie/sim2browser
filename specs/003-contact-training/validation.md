# Validation log: 003-contact-training

Measurements and decisions recorded during implementation. Newest entries at the bottom of each
section.

## Measurements

### Planning probes (2026-10-05, planning probe)

- Unchanged 001 recipe on the v3 model (002's `v3-s*`, stopped at 14.5 M): at 13.6 M steps jerk²
  136,000–278,000 (001: 513), distance 0.38–0.42 m (0.12), reward −9,300 to −12,300 (−39);
  12.8% of episodes start with the arm > 1 mm inside the floor or the cube.
- `final-s1` on the v3 model, 200 episodes × 150 steps: per-step tip jerk² contact-free median 1,
  p99 4,254, p99.9 11,800, max 100,898; on arm–floor/cube contact steps median 5,484, p99 155,317;
  2/200 episodes with arm–floor or arm–cube contact.
- 001 seed 2 (`final-s2*`): stalls at 0.17–0.19 m, settled 0.000 in all stages, jerk 215 (seeds
  0/1: 357–684), exploration std 0.026 at the end of stage a.

## Decisions

### T006: before (2026-10-05)

`final-s1` (shipped since 001) on the v3 model, release evaluation (300 targets ≥ 4 cm, seed 0, cube
at its default pose):

| | Success | Mean sq. tip jerk | Jerk ratio | Floor contact | Cube moved |
|---|---|---|---|---|---|
| Baseline | 100% | 264.8 | 1.00 | 0.0% | 0.0% |
| Learned (`final-s1`) | 94.7% | 246.5 | 0.931 | 0.7% (2 episodes) | 0.0% |

Two floor-brushing episodes are enough to move the jerk ratio from ≈ 0.68 to 0.93. Python proxy
(seed 999, 300): 95% success, ratio 1.29, floor 1.0%, cube 0.0%.

### T016: pilot, 3 seeds × 10 M steps, gated ramp (2026-10-05)

| Seed | At | Distance (m) | Settled | Raw jerk² | Capped jerk² | Floor (steps) | Cube | Penalty scale | Std |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2.5 M | 0.140 | 0.000 | 7,364 | 2,740 | 4.3% | 0.0% | 0.31 | 0.271 |
| 0 | 10 M | 0.138 | 0.005 | 2,058 | 700 | 0.1% | 0.1% | 1.00 | 0.055 |
| 1 | 2.5 M | 0.144 | 0.000 | 5,258 | 2,663 | 3.9% | 0.0% | 0.29 | 0.269 |
| 1 | 10 M | 0.124 | 0.029 | 2,008 | 650 | 0.3% | 0.0% | 1.00 | 0.056 |
| 2 | 2.5 M | 0.129 | 0.000 | 9,028 | 3,047 | 0.8% | 0.0% | 0.25 | 0.291 |
| 2 | 10 M | 0.123 | 0.001 | 990 | 585 | 0.0% | 0.1% | 1.00 | 0.052 |

Each seed ran 872 s. Go/no-go (research R5): distance ≤ 0.20 m ✓ (0.12–0.14, as close as 001's
final runs after 100 M); raw jerk² < 5,000 ✓ (vs ≈ 400,000 in the failed unchanged run); floor
contact falling ✓. Distance rose slightly from 5 M (0.11) to 10 M once penalties were full, as in
001 mid-training. Seed 2, which never learned in 001, learns like the others. **GO** for the full
recipe.

### T017: full recipe, run `c3` (2026-10-05)

All 3 seeds converged (SC-004 ✓); stage durations ≈ 2,510 s for each 30 M stage. Python proxy
(300 targets ≥ 4 cm, seed 999):

| Seed | Success | Jerk ratio | Floor | Cube moved |
|---|---|---|---|---|
| c3-s0 | 89% | 2.83 | 0.0% | 0.0% |
| c3-s1 | 92% | 3.33 | 0.0% | 0.0% |
| c3-s2 | 87% | 2.99 | 0.0% | 0.0% |
| `final-s1` (shipped) | 95% | 1.29 | 1.0% | 0.0% |

Floor and cube contact are gone and every seed learns, but the policies are far jerkier. Cause:
research R3 capped jerk on every step at 5,000 (p99 of the old policy's free motion); once the new
policies' ordinary motion exceeded that (raw jerk² 7,000–13,000 by the end of stage b), extra jerk
cost nothing and smoothness stopped being learned. None of these runs can ship (FR-010).

Fix (2026-10-05): cap jerk only on steps with an arm contact (the impacts the cap was meant for);
free motion pays the full jerk, as in 001. Stage a ended with raw jerk² 2,300–5,500, near the cap,
so stages b and c are re-run from the `c3-s*-a` checkpoints as `c3r-s*` (≈ 70 min).

### T017 (rerun): stages b and c from `c3-s*-a`, jerk capped on contact steps only (`c3r`, 2026-10-05)

| Seed | Success | Jerk ratio | Floor | Cube moved |
|---|---|---|---|---|
| c3r-s0 | 42% | 1.53 | 0.3% | 0.0% |
| c3r-s1 | 16% | 1.73 | 0.0% | 0.0% |
| c3r-s2 | 39% | 1.51 | 0.0% | 1.0% |

With the full jerk penalty back on free motion, the policies lost precision instead of becoming
smoother. Two full attempts produced nothing better than `final-s1`.

Decision (2026-10-05, with the user): fine-tune `final-s1` (smooth on the contact-free model) on the
v3 model instead of training from scratch: 3 seeds × 30 M steps, stage-c settings (full penalties,
precision 1.0 / 0.01), jerk capped on contact steps only, collision-free resets with the random cube.
Runs `c3ft-s*`. If none beats `final-s1` on the release evaluation, 003 closes without a new policy
(infrastructure only), with the retrain as an open research item.

### T017 (fine-tune): `final-s1` fine-tuned on the v3 model (`c3ft`, 2026-10-05)

The three "seeds" (300–302) produced identical training curves and identical results: on resume,
Stable-Baselines3 restores the saved model's seed and ignored `--seed`. That was one run, and it
also means 001's stages b and c never used their stated seeds (only stage a's differed). Fixed in
`reach/train.py` (`model.set_random_seed(args.seed)` after loading); verified that two resumed
seeds now produce different models.

Python proxy (300 targets, seed 999), final and checkpoints:

| Checkpoint | Success | Jerk ratio | Floor | Cube moved |
|---|---|---|---|---|
| 5 M | 90% | 1.07 | 0.3% | 0.0% |
| 10 M | 88% | 0.89 | 0.0% | 0.0% |
| 15 M | 83% | 1.01 | 0.7% | 0.0% |
| 20 M | 83% | 1.68 | 1.0% | 0.0% |
| 25 M | 86% | 1.00 | 0.7% | 0.0% |
| 30 M (final) | 85% | 0.93 | 0.7% | 0.0% |
| `final-s1` | 95% | 1.29 | 1.0% | 0.0% |

Fine-tuning trades 5–12 points of success for smoothness and never reaches the 0.70 jerk target.

## Decisions

### T018: no new policy ships (2026-10-05)

No run of 003 (`c3`, `c3r`, `c3ft`) meets SC-001/SC-002, and none beats `final-s1` without losing
precision, so by FR-010 and the agreed fallback `final-s1` stays live. 003 closes with:

- a training setup that works with contacts: collision-free resets with a random cube, impact-capped
  jerk (contact steps only) plus floor and cube penalties, a performance-gated ramp (every seed
  learns, including 001's stuck seed 2), and correct seeding of resumed stages;
- per-episode floor and cube counters in both evaluations and in the info panel (the shipped policy:
  floor 0.7%, cube 0.0% of 300 release episodes).

Open (roadmap): a reward that keeps 001's smoothness with contacts. Evidence so far: capping all jerk
removes the smoothness incentive; the full jerk penalty from a contact-trained stage a loses
precision; fine-tuning the smooth policy trades precision for smoothness. Next candidates:
a jerk term relative to the policy's own contact-free jerk, or training the policy to observe
the floor height (an observation change, FR-007).
