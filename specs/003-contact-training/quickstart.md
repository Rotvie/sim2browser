# Quickstart: validating 003-contact-training

Contracts: [training-config](./contracts/training-config.md), [eval-report](./contracts/eval-report.md).

## 1. Training setup (P1)

```bash
cd training && uv sync && uv run pytest
```

Expected: tests prove that resets never start the arm inside the floor or cube, that targets are
never inside the cube, that jerk is capped in the reward (not in `info["jerk_sq_raw"]`), and that the
gated ramp only advances while the mean distance is under the gate.

## 2. Pilot (P1, ≈ 15 min)

```bash
for s in 0 1 2; do uv run python -m reach.train --seed $s --steps 10000000 --ramp gated \
  --name c3-pilot-s$s > runs/c3-pilot-s$s.log 2>&1 & done; wait
```

Expected (research R5): at 10 M, `reach/dist` ≤ 0.20 m and falling, `reach/jerk_sq_raw` < 5,000,
`reach/floor_rate` falling, for every seed.

## 3. Full recipe and selection (P1/P2, ≈ 2.3 h)

```bash
for s in 0 1 2; do scripts/train_final.sh $s c3 > runs/c3-s$s.log 2>&1 & done; wait
for s in 0 1 2; do uv run python -m reach.evaluate --run c3-s$s; done
```

Expected: every seed ≥ 80% training-side success (SC-004); pick by the 001 rule (research R6).

## 4. Ship (P2/P3)

```bash
uv run python -m reach.export --run <selected> && uv run python -m reach.make_fixtures --run <selected>
cd .. && npm run test:parity
cd web && npm run eval -- --controller baseline --n 300 --seed 0
npm run eval -- --controller learned --n 300 --seed 0 && npm run eval:compare -- --write-metrics
npm run eval:grasp -- --check && npm test && npm run test:e2e
```

Expected: SC-001 ≥ 95%, SC-002 ≤ 0.70, SC-003 floor ≤ 1% and cube ≤ 2% (printed with verdicts);
grasp evaluation reproduced exactly (re-run `eval:grasp` without `--check` only if `parity.json`'s
hash changed, and commit it); all suites green; the info panel shows the new numbers.
