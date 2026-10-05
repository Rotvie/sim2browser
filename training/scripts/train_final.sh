#!/usr/bin/env bash
# The final reach recipe (validation.md, rounds 1-2), for one seed:
#   stage a: 40M steps from scratch, default reward, smoothness penalties ramped over 50%
#   stage b: +30M steps resumed from a, sharper precision term (1 cm), full penalties
#   stage c: +30M more of stage b (with 4 policy joints, success was still rising at the end of b)
# Writes training/runs/final-s<seed>-a, final-s<seed>-b and final-s<seed>.
#
#   scripts/train_final.sh <seed>
set -euo pipefail
seed=${1:?usage: train_final.sh <seed>}
cd "$(dirname "$0")/.."
uv run python -m reach.train --seed "$seed" --steps 40000000 --name "final-s$seed-a"
uv run python -m reach.train --seed "$((seed + 100))" --steps 30000000 --ramp 0 \
  --w_precision 1.0 --w_precision_scale 0.01 \
  --resume "final-s$seed-a" --name "final-s$seed-b"
uv run python -m reach.train --seed "$((seed + 200))" --steps 30000000 --ramp 0 \
  --w_precision 1.0 --w_precision_scale 0.01 \
  --resume "final-s$seed-b" --name "final-s$seed"
