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
