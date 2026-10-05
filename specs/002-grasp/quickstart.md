# Quickstart: validating 002-grasp

Runnable checks that prove each story works end to end. Commands run from the repository root
unless noted. Contracts: [parity-json](./contracts/parity-json.md),
[parity-fixture](./contracts/parity-fixture.md), [worker-protocol](./contracts/worker-protocol.md),
[grasp-eval](./contracts/grasp-eval.md), [ui](./contracts/ui.md).

## Prerequisites

```bash
npm install && (cd training && uv sync)
cat shared/MUJOCO_VERSION        # 3.14.0, same for the Python wheel and @mujoco/mujoco
```

## 1. Model and parity.json v3 (P1)

```bash
(cd training && uv run python -m reach.export --run final-s1)   # parity.json v3 + shipped policy
(cd training && uv run python -m reach.make_fixtures --run final-s1)
(cd training && uv run pytest)
npm run test:parity
```

`final-s1` is the shipped run; run directories exist only locally (gitignored).

Expected: `parity.json` has `"version": 3`, `gripper`, `cube`, `grasp` with a non-empty
`grasp.region`; all parity tests pass, including `contact-random.json` at ≤ 1e-6.

## 2. Reach policy on the new model (P1, research R7)

```bash
cd web
npm run eval -- --controller baseline --n 100 --seed 0
npm run eval -- --controller learned --n 300 --seed 0
npm run eval:compare
```

Expected: baseline ≥ 99%. Learned ≥ 91% on 300 targets and jerk ratio ≤ 0.75, otherwise retrain
with `training/scripts/train_final.sh` (R7). Record the numbers in `validation.md` either way.

## 3. Gripper and cube by hand (P1)

```bash
cd web && npm run dev            # open the printed URL
npm run test:e2e -- grasp-p1     # automated version of the steps below
```

Manual: drag the target above the cube; press **Open gripper** (or `G`); lower the target around
the cube; press **Close gripper**; drag the target up. Expected: the cube rises with the gripper;
**Open gripper** drops it; pushing the cube with the arm moves it; nothing passes through the
floor or the cube; **Reset** restores arm, gripper, target and cube.

## 4. Scripted grasp (P2)

```bash
cd web && npm run test:e2e -- grasp-p2
```

Manual: select **Grasp**. Expected: the chip shows Approaching → Descending → Closing → Lifting →
Holding → "Lifted ✓". Drag the cube elsewhere, press **Grasp again**: same result. Drag the
cube out of the region (ring turns orange) and grasp: "Failed: cube out of reach", no attempt.
Drag the target mid-grasp: mode switches to Baseline, gripper state kept.

```bash
cd web && npx tsx scripts/record-grasp.ts                     # rewrite grasp-actions.json
(cd training && uv run python -m reach.make_fixtures --run final-s1)   # grasp-recorded.json
npm run test:parity
```

Expected: `grasp-recorded.json` replays at ≤ 1e-6 and the cube ends lifted in both engines.

## 5. Grasp metrics (P3)

```bash
cd web
npm run eval:grasp -- --n 100 --seed 0          # writes shared/grasp-eval.json
npm run eval:grasp -- --check                   # CI check: identical result
```

Expected: success rate ≥ 0.90 and median time to lift ≤ 6 s (reported as measured if missed);
the info panel's "Scripted grasp" section shows exactly these numbers.

## 6. Release gates

```bash
cd web && npm run build && npm run size && npm test && npm run test:e2e
```

Expected: ≤ 4 MB compressed before interactive; 001 and 002 e2e suites pass, including the
static-only check (no server requests) and perf (≥ 30 fps during a grasp).
