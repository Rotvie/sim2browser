---

description: "Task list for 003-contact-training"
---

# Tasks: Contact-Robust Training

**Input**: Design documents from `specs/003-contact-training/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included (parity is a release gate; training-env behavior is tested as in 001/002).
Tests come before the code they verify.

**Organization**: US1 = training that learns with contacts, US2 = smooth live policy, US3 = honest
reporting. Measurements go to `specs/003-contact-training/validation.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallel-safe (different files, no dependency on incomplete tasks)
- Training runs live in `training/runs/` (gitignored); name prefix `c3`.

---

## Phase 1: Setup

- [ ] T001 Create `specs/003-contact-training/validation.md` (sections "Measurements", "Decisions"), seeded with research.md R1/R3/R4 numbers marked "planning probe, 2026-10-05"
- [ ] T002 [P] Update the proxy baseline constant in `training/reach/evaluate.py`: `BASELINE_JERK` = the v3 baseline's mean squared tip jerk from `npm run eval -- --controller baseline --n 300 --seed 0` (264.8 on 2026-10-05; re-measure and cite the run in the comment)

---

## Phase 2: Foundational (evaluation counters, both sides)

**Purpose**: SC-003 must be measurable before any run is judged.

- [ ] T003 [P] Test first in `web/tests/unit/eval.test.ts`: `runEpisode` returns `floor` (any arm–floor contact during the episode) and `cubeMoved` (cube centre displaced > 0.01 m from its start pose); a target forcing the arm into the floor sets `floor`, a quiet reach sets neither
- [ ] T004 Implement in `web/src/sim/eval.ts` (`runEpisode` → `EpisodeResult` gains `floor`, `cubeMoved`; arm bodies = every body moved by a joint plus `Moving_Jaw`), then `web/scripts/eval.ts` (report `floorContactRate`, `cubeMovedRate`, `perTarget[].floor`, `perTarget[].cubeMoved`) and `web/scripts/eval-compare.ts` (print both with SC-003 verdicts "floor ≤ 1%", "cube ≤ 2%"; `--write-metrics` adds both to the header `metrics`), per `contracts/eval-report.md`
- [ ] T005 [P] Same counters in the Python proxy `training/reach/evaluate.py` (`floor_rate`, `cube_rate`, same definitions), printed with the rest
- [ ] T006 Measure the current policy `final-s1` with the counters (TS release evaluation, 300 targets, seed 0) and record the before numbers in `validation.md`

---

## Phase 3: User Story 1 - A training recipe that learns with contacts (P1) 🎯 MVP

**Goal**: the recipe learns on the v3 model on every seed.

**Independent Test**: pilot (10 M, 3 seeds) meets the R5 go criteria; full recipe: 3/3 seeds ≥ 80% training-side success.

### Tests for User Story 1

- [ ] T007 [P] [US1] In `training/tests/test_env.py`: 2,000 resets with random seeds never start with an arm geom in contact with the floor or the cube at dist < −0.001; the cube is at `cube.defaultPose` in 15–25% of resets and otherwise within r ∈ [0.08, 0.40] m and |angle| ≤ 80°; no target inside the cube's box grown by 0.04 m; reset raises after 100 failed attempts (monkeypatched sampler)
- [ ] T008 [P] [US1] In `training/tests/test_env.py`: reward terms: jerk penalty uses `min(‖jerk‖², jerk_cap)` while `info["jerk_sq_raw"]` is uncapped; `info["floor"]` / `info["cube_contact"]` set on contact steps and each subtracts `w_floor` / `w_cube` (not scaled by `penalty_scale`)
- [ ] T009 [P] [US1] Create `training/tests/test_train.py`: the gated ramp starts at 0, advances by `ramp_step` only after rollouts with mean `dist` ≤ `gate_dist`, never decreases, caps at 1, and 0 → 1 takes ≥ 25% of the stage

### Implementation for User Story 1

- [ ] T010 [US1] `training/reach/config.py`: `RewardWeights` gains `jerk_cap: float = 5000.0`, `floor: float = 1.0`, `cube: float = 0.5`; `Sampling` gains `p_cube_default: float = 0.2`, `cube_r: tuple[float, float] = (0.08, 0.40)`, `cube_max_angle: float = 1.396`, `target_cube_margin: float = 0.04` (contracts/training-config.md)
- [ ] T011 [US1] `training/reach/env.py`: `collision_free_reset(env, rng)` (general helper, reused by 004): place the cube (data-model "Episode setup"), sample the start pose until no arm–floor/cube contact with dist < −0.001 (`mj_forward`, check `data.contact`), sample the target until outside the grown cube box; max 100 attempts per field, else `RuntimeError`; `ReachEnv.reset` uses it; `sample_target`'s retargets during the episode also avoid the cube box
- [ ] T012 [US1] `training/reach/env.py` `step`: per-step contact flags (any arm geom vs floor, vs cube) over the substeps; reward per data-model "Reward terms"; `info` gains `floor`, `cube_contact`, `jerk_sq_raw`; `jerk_sq` stays the capped value used in the reward
- [ ] T013 [US1] `training/reach/train.py`: `PerformanceGatedRamp` callback (data-model "Penalty ramp"; `gate_dist` 0.15; `ramp_step` = rollout steps / (0.25 · total steps)); `--ramp gated|<fraction>` and `--gate_dist`; `Stats` logs `floor_rate`, `cube_rate`, `jerk_sq_raw`, and `penalty_scale` (contracts/training-config.md)
- [ ] T014 [US1] `training/scripts/train_final.sh`: stage a `--ramp gated`; header records "recipe 003"; stages b/c unchanged
- [ ] T015 [US1] Run `uv run pytest` and `uv run ruff check reach tests` in `training/`; all pass
- [ ] T016 [US1] Pilot: 3 seeds × 10 M steps (`--ramp gated --name c3-pilot-s<seed>`), in the background; record dist, `jerk_sq_raw`, `floor_rate`, `penalty_scale` at 10 M per seed in `validation.md`; go/no-go per research R5. On no-go: adjust only `config.py` weights, document why, re-pilot
- [ ] T017 [US1] Full recipe: `scripts/train_final.sh <seed> c3` for seeds 0, 1, 2 in the background; when done, `uv run python -m reach.evaluate --run c3-s<seed> --n 300 --seed 999` per seed; record every seed (success, jerk ratio, floor and cube rates) in `validation.md` (SC-004)

**Checkpoint**: a recipe that learns with contacts, reusable by 004.

---

## Phase 4: User Story 2 - The live policy is smooth again (P2)

**Goal**: ship the selected policy; SC-001/002/003 measured on the shipped code path.

**Independent Test**: quickstart §4.

- [ ] T018 [US2] Select per research R6 (best proxy success among seeds with proxy jerk ratio ≤ 0.70); if none qualifies, the best proxy success overall only if its release numbers beat `final-s1` (FR-010); record the decision in `validation.md`
- [ ] T019 [US2] `uv run python -m reach.export --run <selected>` and `uv run python -m reach.make_fixtures --run <selected>`; then `npm run test:parity` (root): all pass; only `policy-recorded.json` and the policy hashes/normalization may change among the shared artifacts (check with `git diff --stat shared/`)
- [ ] T020 [US2] Release evaluation in `web/`: `npm run eval -- --controller baseline --n 300 --seed 0`, `--controller learned --n 300 --seed 0`, `npm run eval:compare`; record SC-001, SC-002, SC-003 with a per-height breakdown (targets < 8 cm vs ≥ 8 cm) in `validation.md`
- [ ] T021 [US2] `npm run eval:grasp` in `web/` (parity.json's hash changed), confirm the grasp numbers are identical apart from `parityJsonSha256`, commit `shared/grasp-eval.json`; `npm test`, `npm run lint`, full e2e `npx playwright test --grep "@p1|@p2|@p3|@g1|@g2|@g3"` (SC-005)
- [ ] T022 [US2] Watch the learned policy on the page with the cube in 5 places (front, sides, near the base, under a low target); note any visible floor or cube contact in `validation.md`

**Checkpoint**: P2 ready to deploy.

---

## Phase 5: User Story 3 - Honest reporting (P3)

- [ ] T023 [US3] `npm run eval:compare -- --write-metrics` in `web/`: header `metrics` gain the floor and cube rates; update `web/src/ui/infoPanel.ts` learned section to show "Touched the floor" and "Moved the cube" rates with their targets (≤ 1%, ≤ 2%) in ok/miss style; extend `web/tests/e2e/p3.spec.ts` to check those rows (SC-006)
- [ ] T024 [US3] `validation.md`: before/after table on the same 300 targets (`final-s1` vs selected), every seed's result, the selection; README results paragraph and `docs/ROADMAP.md` open items updated with the measured numbers

---

## Phase 6: Polish

- [ ] T025 [P] 10-minute soak (`npx playwright test --grep "@soak" --project desktop-chromium` in `web/`) with the new policy; record in `validation.md`
- [ ] T026 [P] Minimality pass (Principle V): remove `--ramp <fraction>` only if nothing documents reproducing 001 with it (README references the 001 recipe: keep and say so); lint clean on both sides
- [ ] T027 Commit on `003-contact-training`, push, CI green, fast-forward `main` after 002 is deployed (deploys)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → US1 → US2 → US3 → Polish. Within US1: T007–T009 (tests) → T010–T014 → T015 → T016 (pilot gate) → T017.
- US2 needs US1's runs; US3 needs US2's selection.
- 002 must be deployed to `main` before T027 (this branch builds on `002-grasp`).

## Parallel Opportunities

- T002 with T001; T003 and T005 together; T007, T008, T009 together.
- While T016/T017 train (background, hours): T023's panel code (without numbers), T025 can wait.

## Implementation Strategy

MVP = US1 (a recipe that learns with contacts): it is the part 004 reuses. Then ship the policy
(US2) and its numbers (US3) as one deploy.
