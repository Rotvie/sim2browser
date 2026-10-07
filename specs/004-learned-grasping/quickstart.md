# Quickstart: Learned Grasping

Validation guide: commands and expected outcomes that prove 004 end to end. Formats and rules
are in [contracts/](./contracts/) and [data-model.md](./data-model.md).

## Prerequisites

```bash
cd ~/Downloads/misc/projects/sim2browser
npm install && (cd training && uv sync)
npm run test:parity && (cd web && npm test) && (cd training && uv run pytest)
```

All green on the parent commit (002 + 003 state).

## P1: record demonstrations

1. `cd web && npm run dev`, open `http://localhost:5173/?record`.
2. Start → grasp the cube by hand (drag target, gripper button, grab the wrist joint to turn
   it) → Keep. Repeat; also record two scripted grasps (Start, then "Scripted grasp").
   Expected: counts update; Save downloads `hand-….demos.jsonl.gz`.
3. Open the page without `?record`: no recording card.
4. Move the file to `training/demos/hand.demos.jsonl.gz`, then:

   ```bash
   cd training && uv run python -m reach.demos check demos/hand.demos.jsonl.gz
   ```

   Expected: every episode replays with the same outcome; max state difference per episode
   printed, none above 1e-6 flagged as error (long episodes reported, SC-005).
5. Bulk scripted demonstrations:

   ```bash
   cd web && npm run demos -- --controller grasp --seed 1000 --n 2000 \
     --noise 0,0.1,0.2,0.3 --out ../training/demos/scripted-s1000-n2000.demos.jsonl.gz
   ```

   Expected: ~1–3 minutes; summary of lifted/failed per noise level.
6. `uv run pytest tests/test_demos.py`: header checks, replay, and the disjointness check
   (no demonstration placement near an evaluation placement, FR-018).

## P2: train, export, run

```bash
cd training
for s in 0 1 2; do uv run python -m reach.imitate --run g1-s$s --seed $s \
  --demos demos/scripted-s1000-n2000.demos.jsonl.gz demos/hand.demos.jsonl.gz --hand-share 0.15; done
uv run python -m reach.imitate select --runs g1-s0 g1-s1 g1-s2   # selection set (seed 1) in Node
uv run python -m reach.export --run final-s1 --grasp-run <chosen>
cd ../web && npm run eval:grasp -- --controller learned-grasp
```

Expected: `shared/policy/grasp.{bin,json}` and `parity.json` v4 written; the eval prints the
learned grasp's success on seed 0 with the release-bar verdict (≥ 80%). Below the bar: stop,
revert the export (`parity.json` without `graspPolicy`), record the result in `validation.md`
(FR-015).

In the browser: "Learned grasp" lifts the cube; Retry after switching to "Scripted grasp" runs
the same placement; the policy view shows 30 inputs and 6 outputs.

## P3: honest comparison and parity

```bash
cd web
npm run eval:grasp -- --controller grasp --check          # scripted re-measured (SC-003)
npm run eval:grasp -- --controller learned-grasp --check
npm run eval -- --controller learned --n 100 --seed 0      # reach numbers unchanged after v4
npx tsx scripts/record-grasp.ts --controller learned-grasp
cd ../training && uv run python -m reach.make_fixtures
cd .. && npm run test:parity
```

Expected: both reports reproduce exactly; parity passes (grasp obs 1e-9, network 1e-5, learned
grasp trajectory 1e-6); info panel rows match the reports; panel line shows demo counts and hand
share.

## Plug-in check (SC-010)

```bash
cd web && npm run eval:grasp -- --controller naive-grasp --n 20 --out /tmp/naive.json
```

Expected: a report is produced; `git diff --stat` for the plug-in commit touches only
`naiveGrasp.ts` and one line of `registry.ts`. `?lab` shows "Naive grasp".

## e2e

```bash
cd web && npx playwright test --grep "@g1|@g2|@g3|@lg1|@lg2|@lg3"
```

Expected: recording mode hidden without `?record`; learned grasp completes an attempt; Retry
restores the placement; mode switch fits 360 px; 10-minute soak without errors (SC-008).
