# Validation log: 004-learned-grasping

Measurements, manual checks and decisions recorded during implementation. Newest entries at the
bottom of each section.

## Risk checks

### Planning probe (2026-10-06, planning probe)

- **Headless demo generation cost**: `npm run eval:grasp` runs 100 scripted grasps (seed 0) in
  **3.5 s** wall time on the development laptop (Node, MuJoCo WASM), so 2,000 scripted
  demonstrations take about 1–2 minutes (research R1).

## Measurements

### Scripted grasp through the attempt monitor (T013, SC-003, 2026-10-07)

`npm run eval:grasp -- --controller grasp` after moving the judgement into the session's attempt
monitor: **100% of 100 (seed 0), median time to lift 4.46 s**, no failures. The regenerated
`shared/grasp-eval/grasp.json` differs from 002's `grasp-eval.json` only in the four new header
fields (`version: 2`, `controller`, `task`, `policySha256`); all 100 placements are identical.

### Plug-in check: naive grasp (T014/T015, SC-010, not a target)

`naiveGrasp.ts` (one file + one registry line): **26% of 100 (seed 0)**, median 5.74 s,
failures: knocked 55, slipped 19. Without turning the wrist to the cube, the jaws come down on
edges; the scripted grasp's wrist alignment is what makes it reach 100%.

### DART noise and scripted demonstrations (T022/T027, 2026-10-07)

First run with noise on all 5 arm joints: every noisy episode failed (`missed`): the scripted grasp
waits for Wrist_Roll to equal its target exactly (`|ctrl − roll| < 1e-6`) before descending, which
per-step noise prevents. Noise now goes on Rotation, Pitch, Elbow and Wrist_Pitch only (see
Decisions). `npm run demos -- --seed 1000 --n 2000 --noise 0,0.1,0.2,0.3`, 81.7 s, 177 MB gzipped:

| Noise (× per-step limit) | Lifted | Failed |
|---|---|---|
| 0 | 500 | 0 |
| 0.1 | 479 | 21 |
| 0.2 | 403 | 97 |
| 0.3 | 243 | 257 |
| **total** | **1625** | **375** |

Median time to lift (200-episode pilot): 4.52 s (noise 0), 4.62 s (0.1), 4.90 s (0.2), 5.86 s (0.3).

### Replay in Python (T025/T027, SC-005)

`uv run python -m reach.demos check demos/scripted-s1000-n2000.demos.jsonl.gz` (48 s): **lifted
or not agrees in 2000 of 2000 episodes**. 1961 replay within 1e-6 (typically 1e-11 to 1e-10);
**39 (2.0%) exceed 1e-6**, where a contact switches on in one engine and not the other and the
difference jumps from below 1e-9 past 1e-6 in a single step (e.g. cube orientation at step 396
of grasp-1159). In 1 episode (grasp-2650, noise 0.2) this shifts the lift time: 4.56 s in the
browser, 4.64 s in Python, both lifted. Training reads the recorded browser states, so the training
data is unaffected; the shipped policy runs on the browser engine it was recorded on.
Same-engine replay (WASM → WASM) differs by up to 7.6e-11: the solver's warm start is not part of
the recorded state.

### parity.json v4 (T034, 2026-10-07)

`PARITY_VERSION = 4` on both sides, `uv run python -m reach.export --run final-s1`: parity.json
differs from v3 only in `version` (workspace, region, offsets reproduced); `reach.json` only in
`parityVersion` after `eval:compare --write-metrics` re-measured its metrics on 300 targets
(baseline 100%, learned 94.7%, jerk ratio 0.931, floor 0.7%: identical to the v3 values). Grasp
evaluation regenerated: still 100% / 4.46 s. Parity fixtures regenerated: only their
`parityJsonSha256` changed, except `policy-recorded.json`, whose content also changed: the
committed copy predated 003's `env.py` change (generation is deterministic: two runs, identical
bytes). Demonstration files stay valid (`simSha256` excludes the version).

### Pilot behavior cloning, scripted demonstrations only (2026-10-07, not shipping candidates)

Pipeline check before the hand demonstrations exist (hand share 0, which is the ablation
configuration). Selection placements only (seed 1, n 100, Node/WASM evaluation); seed 0 untouched.

| Run | Change | Train / val loss | Seed-1 lifted | Main failures |
|---|---|---|---|---|
| pilot-s0 | 30 inputs, roll never perturbed, 2×256, 20k steps | 0.0025 / 0.0025 | **0%** | missed 96 |
| pilot2-s0 | roll perturbed on 30% of steps; limit-aware intent | 0.0026 / 0.0031 | **4%** | missed 78, knocked 13 |
| pilot3-s0 | + `faceYaw4` input (32 inputs) | – | **12%** | missed 67, knocked 13 |
| pilot4-3x256 | as pilot3, 3×256, 60k steps | 0.0008 / 0.0018 | **11%** | missed 40, knocked 24, timeout 13 |

Python and TypeScript observations agree to 1.1e-16 on recorded states (not a mismatch).
Offline fit is good (pilot-s0 per-joint RMSE 0.004–0.006 of the per-step limit for Rotation,
Pitch, Elbow; gripper sign 99.8%). Closed-loop traces: pilot-s0 never turned the wrist roll to its
target (no roll recoveries in the data); pilot3 reaches the approach point about 2 cm off and then
rises instead of descending: the scripted grasp's descent starts on hidden conditions (its moving
goal point, "within 5 mm and roll exactly aligned"), so states slightly off its path have no
consistent label. More capacity (pilot4) lowers the loss but not the failure rate: the gap is
distribution shift, not fit.

- **2026-10-07, attempt monitor placement**: the session wraps every `task: "grasp"` controller
  (`monitorGrasp` in `web/src/sim/graspAttempt.ts`) and feeds the judge before the controller's
  step, with the same time origin the scripted grasp used; this is what keeps its lift times
  identical (checked by `eval:grasp --check` and `tests/unit/eval.test.ts`).
- **2026-10-07, build fix found in T013**: `web/vite.config.ts` listed `grasp-eval.json` among
  the shipped files; now ships the `grasp-eval/` directory (otherwise the deployed info panel
  would have lost its grasp numbers).
- **2026-10-07, DART noise on four joints**: Wrist_Roll is not perturbed (`PERTURBED = 4` in
  `web/src/sim/recorder.ts`). The alternative, loosening the scripted grasp's exact roll check,
  would change the baseline's behavior and its measured numbers (FR-014 of 002).
- **2026-10-07, replay rule (SC-005, contract updated)**: the hard check is "lifted or not"; state
  differences above 1e-6 and lift-time shifts are reported per file. The analysis-time rule
  "scripted episodes within 1e-6" did not survive measurement (2% of noisy episodes cross it
  through contact events).
- **2026-10-07, time in control steps**: the attempt judge (monitor and recorder) counts time as
  k / controlHz instead of subtracting simulation times, so Python's replay judge gets identical
  floats; episodes record their `timeLimit` (contract updated). Scripted evaluation unchanged
  (`eval:grasp --check` passes).
- **2026-10-07, Wrist_Roll noise on 30% of steps** (`ROLL_NOISE_SHARE`), replacing "never": with
  no roll perturbation the learner had no roll correction to copy (pilot-s0). The scripted grasp
  corrects a perturbed roll on the next clean step, so it still passes its exact-roll check.
- **2026-10-07, intent respects joint limits**: the recorded label is the change the controller
  would have made after the speed and joint limits, so noisy and clean episodes agree at a limit.
- **2026-10-07, `faceYaw4` input** (research R5 updated, 32 inputs): the target wrist roll depends
  on the Rotation that faces the cube (its bearing from the base axis), not the current one.
- **2026-10-07, Retry returns to the visitor's placement**, not the last attempt's start:
  selecting a grasp controller starts an attempt at once (002 behavior), from wherever the previous
  grasp left the cube, so "last attempt" was usually the knocked cube (found by the @lg2 e2e test;
  data-model and contracts/ui.md updated).

