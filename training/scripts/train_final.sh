#!/usr/bin/env bash
# The final reach recipe (validation.md, rounds 1-2), for one seed:
#   stage a: 40M steps from scratch, default reward, smoothness penalties ramped over 50%
#   stage b: +30M steps resumed from a, sharper precision term (1 cm), full penalties
#   stage c: +30M more of stage b (with 4 policy joints, success was still rising at the end of b)
# Writes training/runs/<name>-s<seed>-a, <name>-s<seed>-b and <name>-s<seed> (name: "final").
#
#   scripts/train_final.sh <seed> [name]
set -euo pipefail
seed=${1:?usage: train_final.sh <seed> [name]}
name=${2:-final}
cd "$(dirname "$0")/.."
uv run python -m reach.train --seed "$seed" --steps 40000000 --name "$name-s$seed-a"
uv run python -m reach.train --seed "$((seed + 100))" --steps 30000000 --ramp 0 \
  --w_precision 1.0 --w_precision_scale 0.01 \
  --resume "$name-s$seed-a" --name "$name-s$seed-b"
uv run python -m reach.train --seed "$((seed + 200))" --steps 30000000 --ramp 0 \
  --w_precision 1.0 --w_precision_scale 0.01 \
  --resume "$name-s$seed-b" --name "$name-s$seed"
