# Implementation Plan: Contact-Robust Training

**Branch**: `003-contact-training` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-contact-training/spec.md`

## Summary

Make the reach training work on the v3 model (floor and cube) and retrain the policy so the 001
targets hold again. Three training-side changes, all in `training/reach/`: collision-free episode
setup with the cube at random positions (research R2), a capped jerk term plus explicit floor and
cube contact penalties (R3), and a performance-gated penalty ramp that removes 001's seed-2 local
optimum (R4). A 10 M-step pilot gates the full 3-seed recipe (R5). The evaluation gains two
counters (floor contact, cube moved) on both sides; the jerk metric is unchanged (R6). The browser
ships only a new policy artifact and its numbers.

## Technical Context

**Language/Version**: Python 3.12 via uv (training); TypeScript 6.x (evaluation counters).

**Primary Dependencies**: Unchanged (MuJoCo 3.14.0, Gymnasium, Stable-Baselines3; browser as 002).

**Storage**: N/A. Training runs in `training/runs/` (gitignored); shipped artifacts in `shared/`.

**Testing**: pytest (env reset, reward terms, gated ramp), Vitest (evaluation counters), parity
suite, Playwright e2e (unchanged suites must pass), `eval` / `eval:compare` / `eval:grasp --check`.

**Target Platform**: Training on the developer's Mac (14 cores); browser as 002.

**Project Type**: Static web app plus offline training pipeline. Unchanged.

**Performance Goals**: Training ≈ 12,000 env steps/s per seed with 3 seeds in parallel; full
recipe ≈ 2.3 h. No browser performance change (same network size).

**Constraints**: Observation/action layout fixed (FR-007); smoothness metric fixed (FR-009);
parity 1e-6 / 1e-5 unchanged; no policy worse than `final-s1` ships (FR-010).

**Scale/Scope**: One policy, 3 seeds, one pilot. Targets: SC-001 ≥ 95%, SC-002 ≤ 0.70, SC-003
floor ≤ 1% and cube moved ≤ 2% of 300 episodes, SC-004 3/3 seeds ≥ 80% training-side success.

No NEEDS CLARIFICATION remain.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Pre-research | Post-design | Evidence |
|-----------|--------------|-------------|----------|
| I. Browser-Only Runtime | PASS | PASS | Only a new policy file and numbers ship; inference unchanged. |
| II. Sim Parity | PASS | PASS | Same model and `parity.json` layout; the new run re-exports normalization and hashes; `policy-recorded.json` regenerated; parity suite gates release. Reward changes are training-only (`config.py`), as in 001. |
| III. Every Rung Shippable | PASS | PASS | One rung: the retrained policy live with its measured numbers. |
| IV. Learned vs. Engineered Visible | PASS | PASS | Baseline unchanged and switchable; the comparison is the point of the feature. |
| V. Minimal | PASS | PASS | No new dependencies, files only where reused by 004 (`collision_free_reset`). The ramp replaces the fixed ramp rather than adding a second mechanism. |

## Project Structure

### Documentation (this feature)

```text
specs/003-contact-training/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/     # training-config, eval-report (deltas)
├── checklists/requirements.md
└── tasks.md       # /speckit-tasks
```

### Source Code (changes)

```text
training/reach/
├── config.py          # RewardWeights: jerk_cap, floor, cube; Sampling: cube placement
├── env.py             # collision_free_reset (cube, start pose, target); contact flags; reward terms
├── train.py           # PerformanceGatedRamp replaces PenaltyCurriculum for stage a
├── evaluate.py        # proxy: floor-contact and cube-moved counts
└── export.py          # unchanged (writes the new run's policy)
training/scripts/train_final.sh   # stage a uses the gated ramp
training/tests/test_env.py        # reset never penetrates; target not in cube; reward caps
training/tests/test_train.py      # gated ramp behaviour (new)

web/src/sim/eval.ts               # runEpisode: floorContact, cubeMoved per episode
web/scripts/eval.ts, eval-compare.ts   # report and print the counts (SC-003)
shared/policy/reach.{bin,json}, shared/parity.json, shared/parity/policy-recorded.json
```

**Structure Decision**: training-side changes stay in `training/reach/`; the browser changes only
in evaluation code, so the shipped page differs by its policy artifact alone.

## Phasing

1. Env and reward changes with tests; pilot (10 M, 3 seeds); go/no-go (R5).
2. Full recipe, 3 seeds; proxy evaluation; selection (R6).
3. Export, fixtures, release evaluation (with SC-003 counters), panel numbers, deploy.

## Risks

| Risk | Signal | Response |
|------|--------|----------|
| Pilot still diverges | jerk² ≫ 5,000 or distance not falling at 10 M | Inspect contact rates; adjust `w_floor`/`jerk_cap` in `config.py`, re-pilot (logged) |
| Gate never opens for a seed | penalty scale stuck < 1 at end of stage a | Report the seed; raise the gate distance one notch, re-run that seed (logged) |
| Policy avoids the floor by hovering (misses low targets) | Success on targets < 8 cm drops | Per-height breakdown in the evaluation; tune `w_floor` |
| Better than `final-s1` but short of SC-001/002 | Release evaluation | Ship with misses shown (FR-010) |
| Training time | ≈ 2.3 h per full run | Pilot first; run unattended in the background |

## Complexity Tracking

None: no constitution deviations.
