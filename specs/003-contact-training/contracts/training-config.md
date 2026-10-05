# Contract: training configuration and recipe (developer-facing)

Training-only: nothing here is parity-critical or read by the browser.

## `training/reach/config.py`

`RewardWeights` adds `jerk_cap: float = 5000.0`, `floor: float = 1.0`, `cube: float = 0.5`.
`Sampling` adds `p_cube_default: float = 0.2`, `cube_r: tuple = (0.08, 0.40)`,
`cube_max_angle: float = 1.396` (80°), `target_cube_margin: float = 0.04`.

`reach.train` exposes each as `--w_<name>` (as 001 does for reward weights) and adds:

| Flag | Default | Meaning |
|------|---------|---------|
| `--ramp gated` | (stage a) | performance-gated penalty ramp (data-model "Penalty ramp") |
| `--ramp <fraction>` | 0.5 | 001 fixed ramp, kept for reproducing 001 |
| `--gate_dist` | 0.15 | mean distance (m) at or below which the ramp advances |

## `training/scripts/train_final.sh <seed> [name]`

Stage a: `--ramp gated`, 40 M steps; stages b and c unchanged (full penalties, sharper precision).
The script's header records the recipe version (`003`).

## Pilot

`uv run python -m reach.train --seed <s> --steps 10000000 --ramp gated --name <name>-pilot-s<s>`
for s in 0, 1, 2. Go/no-go in research R5.

## Run outputs

`training/runs/<id>/progress.csv` gains `reach/floor_rate`, `reach/cube_rate`,
`reach/jerk_sq_raw`, `reach/penalty_scale`.
