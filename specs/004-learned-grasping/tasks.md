---

description: "Task list for 004-learned-grasping"
---

# Tasks: Learned Grasping

**Input**: Design documents from `specs/004-learned-grasping/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. Parity tests are a release gate (constitution Principle II), and the spec's
success criteria are checked by headless evaluations, pytest and Playwright, as in 001–003. Test
tasks come before the implementation they verify and are expected to fail first.

**Analysis fixes (2026-10-06)**: `/speckit-analyze` findings I1–I5, F1, U1, U2, A1, A2 are folded into spec.md (US1/US2 scenarios, edge case, FR-015, SC-002), research.md (R6, R9, Risks), contracts/demo-file.md (replay rule) and T004, T009, T012, T013, T018, T034, T036, T037, T043, T045, T046.

**Organization**: Phase 2 builds the grasp plug-in surface (task field, attempt monitor,
per-controller evaluation) that every story uses. Then one phase per user story (US1 record →
US2 learned grasp → US3 comparison). US1 and US3 each end in a public deploy; US2 deploys only if
the release bar (≥ 80%, FR-015) is met. Measurements go to
`specs/004-learned-grasping/validation.md` (created in T001), same style as 002/003.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1 = record demonstrations, US2 = learned grasp live, US3 = honest comparison

## Path Conventions (from plan.md)

- `web/` shipped app; `training/` offline Python; `shared/` single source of truth;
  `tests/parity/` cross-side parity tests
- `web/src/sim/` and `web/src/control/` MUST NOT import DOM or worker APIs (001 rule), so Node
  scripts (`demos.ts`, `eval-grasp.ts`, `record-grasp.ts`) and tests import them
- `training/` is the only writer of `shared/parity.json`
- e2e tags for this feature: `@lg1`, `@lg2`, `@lg3` (002 keeps `@g1`–`@g3`)
- Do not switch git branches while a training run is going (stages re-import code)

---

## Phase 1: Setup

- [X] T001 Create `specs/004-learned-grasping/validation.md` with sections "Risk checks", "Measurements", "Decisions", and record the planning probe from research.md R1 ("100 scripted grasps headless in 3.5 s, development laptop, 2026-10-06") as the first entry
- [X] T002 [P] Create `training/demos/` with a `README.md` (one paragraph: hand demonstrations are committed, scripted ones are regenerated with `npm run demos`, format in `specs/004-learned-grasping/contracts/demo-file.md`) and add `training/demos/scripted-*.demos.jsonl.gz` to `.gitignore`
- [X] T003 [P] Add e2e tags `@lg1|@lg2|@lg3` to the grep in the e2e job of `.github/workflows/ci.yml` and to the tag list in `web/playwright.config.ts`

---

## Phase 2: Foundational — grasp plug-in surface (Blocking Prerequisites)

**Purpose**: Any `task: "grasp"` controller is selected, judged, evaluated and recordable the same
way (research R7, R11; contracts/grasp-controller-plugin.md). The scripted grasp's numbers must
come out identical.

### Tests first

- [X] T004 [P] Write failing tests in `web/tests/unit/graspAttempt.test.ts` for the attempt monitor (data-model "Grasp attempt"): a stub grasp controller that does nothing → outcome `failed`/`missed` at `grasp.success.timeLimit`; a stub that pushes the cube > `knockedDistance` without holding → `knocked`; a non-graspable start pose (cube outside `grasp.region`) → `failed`/`not-graspable` and the stub's `step()` is never called; a controller-reported early failure (`graspState().phase === "failed"`) ends the attempt with that reason; success is judged by `GraspJudge` with 002's definition ("cube at least 5 cm up, held for 1 s, within 10 s") and `liftTime` equals the judge's; target drag / joint grab / mode switch / cube move (`setCube`) ends the attempt as `cancelled`
- [X] T005 [P] Write failing tests in `web/tests/unit/eval.test.ts`: `runGraspEpisode(session, placement, "grasp")` gives the same `{success, timeToLift, failure}` as before this feature for the first 10 placements of seed 0 (values from `shared/grasp-eval.json`); calling it with a reach controller id throws `"not a grasp controller"`

### Implementation

- [X] T006 Add `task?: "reach" | "grasp"` (default `"reach"`) to `ControllerDef` in `web/src/control/registry.ts`, set `task: "grasp"` on the scripted `grasp` def, relabel it `"Scripted grasp"` (id stays `grasp`), and export `controllerTask(id)`; update the header comment with the grasp plug-in steps from contracts/grasp-controller-plugin.md
- [X] T007 Create `web/src/sim/graspAttempt.ts`: `createGraspAttempt(sim, parity, cube)` with `start(controllerId)` (records `startPose`, `startTime`, refuses non-graspable placements via `isGraspable`), `update(controllerState?)` each control step (feeds `GraspJudge`; tracks `heldEver`, horizontal cube travel), `cancel()`, and `state()` → `{controller, phase, outcome: "running" | "done" | "failed" | "cancelled", failure, liftTime, startPose}`; failure classification exactly as research R7: "never held and cube moved > `knockedDistance` → `knocked`; never held → `missed`; held at some point → `slipped`; still held but not lifted at the time limit → `timeout`"; a controller-reported failure wins. T004 passes
- [X] T008 Update `web/src/control/modes.ts`: `GraspState` gains `controller: string` and `outcome`; keep `GraspPhase` and `GraspFailure` (add `"cancelled"` to `GraspFailure`)
- [X] T009 Update `web/src/sim/session.ts`: replace every `modes.mode === GRASP` check (target-drag handover, gripper press, `regrasp`, `snapshot().grasp`) with `controllerTask(modes.mode) === "grasp"`; own one `GraspAttempt`, start it whenever a grasp controller is entered (`setMode`, `regrasp`), call `update()` after each controller step, skip the controller's `step()` while the attempt is `failed`/`not-graspable`, cancel it on target drag, joint grab, mode switch and cube move; `snapshot().grasp` = the attempt state merged with the controller's own `graspState()` phase if any
- [X] T010 Remove the scripted grasp's own `isGraspable` branch from `web/src/control/grasp.ts` (`begin()` "not-graspable" path and the `step()` early return): the monitor owns it now (plan Constitution Check V, "prefer deleting"); update `web/tests/unit/grasp.test.ts` accordingly
- [X] T011 Update `web/src/sim/eval.ts`: `runGraspEpisode(session, placement, controllerId = "grasp")` selects the controller by id, rejects non-grasp ids (`"not a grasp controller"`), and reads the outcome from `snapshot().grasp` (`outcome` `done`/`failed`) instead of the scripted phases. T005 passes
- [X] T012 Update `web/scripts/eval-grasp.ts` per contracts/grasp-eval.md: `--controller <id>` (default `grasp`), default `--out ../shared/grasp-eval/<id>.json`, output format version 2 with `controller`, `task`, `policySha256` (`null` unless the controller loads a policy), `--shared <dir>` (default the repo's `shared/`; add the matching parameter to `loadNodeSim`/`readShared` in `web/tests/node-shared.ts`) so model selection can evaluate a candidate exported to a temporary directory, verdict line per controller (scripted: "≥ 90%, ≤ 6 s"; `learned-grasp`: "≥ 80%, median ≤ 8 s"), exit 2 with a message for unknown or reach ids, exit 0 otherwise
- [X] T013 Move `shared/grasp-eval.json` → `shared/grasp-eval/grasp.json` (git mv), regenerate it with `npm run eval:grasp --workspace web -- --controller grasp`; it must still read 100% and median 4.46 s (only `version`, `controller`, `task`, `policySha256` added). Update every reference to the old path: `web/src/ui/infoPanel.ts`, `web/src/app.ts`, `web/tests/e2e/grasp-p3.spec.ts` (fetch `grasp-eval/grasp.json`), and the CI eval job in `.github/workflows/ci.yml` to `eval:grasp -- --controller grasp --check`. Record the re-measure in `validation.md` (SC-003)
- [X] T014 [P] Create the SC-010 example `web/src/control/naiveGrasp.ts` (~40 lines, lab-only, `id: "naive-grasp"`, `task: "grasp"`, `public: false`): top-down grasp over the cube centre without wrist alignment (approach above, descend, close, lift using `dlsStep` from `baseline.ts`, Wrist_Roll held), and add it to `CONTROLLERS` in `web/src/control/registry.ts` in a commit that touches only those two files
- [X] T015 [P] Write `web/tests/unit/naiveGrasp.test.ts`: runs `runGraspEpisode` for `naive-grasp` on 20 placements of seed 0 and checks every episode returns an outcome (success or a classified failure); record its success rate in `validation.md` ("plug-in check, not a target")
- [X] T016 Run `npm test --workspace web`, `npm run test:parity`, `npm run build --workspace web`, `npm run eval:grasp --workspace web -- --controller grasp --check` and the 002 e2e suite (`npx playwright test --grep "@g1|@g2|@g3"` in `web/`); the 002 page behaves as before apart from the "Scripted grasp" label

**Checkpoint**: grasp controllers plug in by task; scripted numbers reproduced.

---

## Phase 3: User Story 1 - Record grasp demonstrations (Priority: P1) 🎯 MVP

**Goal**: The demonstrator records hand and scripted grasps in the browser (`?record`) and saves
one file; bulk scripted demonstrations are generated headless; every episode replays in Python.

**Independent Test**: quickstart "P1": record hand and scripted grasps, save, run
`python -m reach.demos check`; every replay has the recorded outcome (SC-005); without `?record`
nothing is recorded.

### Tests for User Story 1

- [X] T017 [P] [US1] Write failing tests in `web/tests/unit/recorder.test.ts` for `web/src/sim/recorder.ts`: recording a scripted grasp gives an episode with `start` = state after the 0.2 s settle, one `steps[k]` per control step with `ctrl` (6), `grip` (0/1), `qpos` (13), `qvel` (12); `intent` present only when noise > 0 and equal to the controller's clipped joint delta divided by `baseline.maxJointSpeed / controlHz`; the episode ends 0.5 s after the lift (or at the time limit: 10 s scripted, 60 s hand, or on stop); the written file is gzip JSON Lines whose header has `kind: "sim2browser-demos"`, `format: 1`, `simSha256`, `sizes`, `counts`; replaying `start` + `ctrl` in the TS sim reproduces `qpos`/`qvel` exactly
- [X] T018 [P] [US1] Write failing tests in `training/tests/test_demos.py`: reading the committed fixture `training/tests/data/tiny.demos.jsonl.gz` (3 scripted episodes, one with noise 0.2, made by `npm run demos --workspace web -- --seed 1000 --n 3 --noise 0,0.2 --out ../training/tests/data/tiny.demos.jsonl.gz` once T022 exists; the CI training job runs only uv, no `npm ci`, so the test must not call Node; until T022 the test is marked xfail); header rejection on wrong `kind`, `format` or `simSha256` with a message naming the field (FR-006); replay of every episode matches stored states within 1e-6 and the same outcome; `simSha256` computed in Python equals the TS value for the current `parity.json` ("sha256 of the canonical JSON (sorted keys, no whitespace) of `{model.sha256, mujocoVersion, timestep, substeps, controlHz, gripper, cube}`"); disjointness check (FR-018): an episode whose start placement is within 2 mm and 0.02 rad (mod π/2) of an evaluation placement (seed 0, n 100) is reported
- [X] T019 [P] [US1] Write `web/tests/e2e/learned-grasp-p1.spec.ts` tagged `@lg1`: without `?record` there is no recording card and no `record` message is ever sent; with `?record`: Start places the cube at placement #0 of seed 2000, a scripted grasp started from the card ends, Keep increments "scripted 1 lifted", Save triggers a download named `hand-*.demos.jsonl.gz` whose first line parses as the header

### Implementation for User Story 1

- [X] T020 [US1] Create `web/src/sim/recorder.ts` per contracts/demo-file.md: `createRecorder(session)` with `begin({source, placement, noise})`, `afterStep()` (captures `ctrl`, gripper command, `qpos`, `qvel`, optional `intent`), `end(outcome)`, `episodes()`, and `writeFile(episodes, header)` → gzipped bytes (`CompressionStream("gzip")` in the browser, `node:zlib` `gzipSync` in Node, chosen by a small injected `gzip` function so the module stays DOM-free); `simSha256(parity)` helper; `intent` captured by wrapping `Arm.applyDelta` while recording (intended delta clipped to ±per-step limit, divided by it). T017 passes
- [X] T021 [US1] Hook the recorder into `web/src/sim/session.ts`: optional `recorder` in `SessionOptions`; `controlStep()` calls `recorder.afterStep()` while recording; attempt end (monitor `done` + 0.5 s, `failed`, time limit 60 s for hand episodes, or stop) calls `recorder.end(outcome)`; a `noise` option perturbs applied joint deltas with Gaussian noise σ = `noise × maxJointSpeed / controlHz` (seeded `mulberry32`, Box–Muller) while the label stays the intended delta; the gripper is never perturbed (research R2)
- [X] T022 [US1] Create `web/scripts/demos.ts` (`npm run demos` in `web/package.json`): `--controller grasp --seed 1000 --n 2000 --noise 0,0.1,0.2,0.3 --out <path>`; placement i from `graspPlacements(parity, 1, seed + i)`, noise level cycling through the list; runs headless on the same Session; writes `scripted-s<seed>-n<n>.demos.jsonl.gz`; prints lifted/failed per noise level and elapsed time; record the 2,000-episode run in `validation.md`
- [X] T023 [US1] Add worker protocol messages per contracts/ui.md "Worker protocol additions" in `web/src/protocol.ts` and `web/src/worker.ts`: main → worker `{type: "record", action: "start" | "stop" | "keep" | "discard" | "save"}`; worker → main `{type: "record-status", ...}` and `{type: "record-file", bytes}` (transferred); the worker creates a recorder only when started with `record: true`; Start places the cube at the next placement of seed 2000 (index = kept + discarded count)
- [X] T024 [US1] Create `web/src/ui/recordPanel.ts` per contracts/ui.md "Recording mode": card with placement counter, Start / Stop, last outcome with Keep / Discard, kept counts by source and outcome, Save file (Blob download `hand-YYYYMMDD-HHMM.demos.jsonl.gz`), the note "Kept episodes are lost on reload"; mount it in `web/src/app.ts` only when the URL has `?record` and pass `record: true` to the worker. T019 passes
- [X] T025 [US1] Create `training/reach/demos.py`: `read(path)` (gzip JSONL, header checks per contracts/demo-file.md), `sim_sha256(parity)`, `replay(model, episode)` → max |Δqpos|, |Δqvel| and the replayed outcome (Python `GraspJudge` equivalent: "cube centre ≥ rest + `liftCheck`, both jaws touching, for `hold` s, within the attempt time limit"), `check` CLI (`python -m reach.demos check <file>`: per-episode table, flags > 1e-6, exits 1 on any outcome mismatch), and `disjoint(episodes, eval_placements)` (FR-018). T018 passes
- [ ] T026 [US1] Record ≥ 20 kept hand demonstrations (aim 30) at `http://localhost:5173/?record`, plus 2 scripted ones from the card, time the session (SC-004: 20 in < 30 min), save to `training/demos/hand.demos.jsonl.gz`, run `uv run python -m reach.demos check demos/hand.demos.jsonl.gz` and the disjointness check; record counts, time, max replay difference and any outcome mismatch in `validation.md`. If replays mismatch, stop and investigate before training (SC-005)
- [X] T027 [US1] Generate the scripted set with `npm run demos --workspace web -- --seed 1000 --n 2000 --noise 0,0.1,0.2,0.3 --out ../training/demos/scripted-s1000-n2000.demos.jsonl.gz`; run `reach.demos check` on it (SC-005 for scripted episodes) and record results in `validation.md`
- [X] T028 [US1] Deploy P1: `npm test --workspace web`, `npm run test:parity`, `(cd training && uv run pytest)`, `npx playwright test --grep "@g1|@g2|@g3|@lg1"`; push to main; confirm on the public URL that the page shows "Scripted grasp", no recording card without `?record`, and the card with it

**Checkpoint**: P1 live; hand and scripted demonstrations on disk and verified.

---

## Phase 4: User Story 2 - Learned grasp, live (Priority: P2)

**Goal**: A behavior-cloned grasp policy runs in the browser next to the scripted grasp; Retry
compares both on one placement. Ships only at ≥ 80% on the evaluation placements.

**Independent Test**: quickstart "P2": train, select, export, `eval:grasp --controller
learned-grasp` ≥ 80%; in the browser Learned grasp lifts the cube and Retry repeats the placement
under the scripted grasp.

### Tests for User Story 2

- [X] T029 [P] [US2] Write failing tests in `web/tests/unit/observation.test.ts` for the grasp observation (research R5, contracts/grasp-policy.md): field order and sizes from `parity.graspPolicy.observation.fields` (30 values: `q` 5, `qd` 5, `jaw` 1, `tip` 3, `cube` 3, `cubeToTip` 3, `cubeYaw4` 2, `relYaw4` 2, `prevAction` 6); `cubeYaw4` is identical for yaw ψ and ψ + π/2; `relYaw4` uses gripper yaw = `q[0] + q[4] − grasp.rollOffset`; the reach observation is unchanged
- [X] T030 [P] [US2] Write failing tests in `training/tests/test_imitate.py`: Python grasp observation equals the TS fixture values for 5 stored states (1e-9); labels use `intent` when present, else applied Δctrl / `deltaScale` clipped to [-1, 1], gripper label ±1; only lifted episodes and steps up to 0.5 s after the lift are used; hand samples make up `--hand-share` of each batch (± 2% over 1,000 batches); a 2-epoch training run on a tiny demo file writes a run directory; `export.py --grasp-run` writes `grasp.{bin,json}` and a `parity.json` v4 that passes `spec.validate`
- [X] T031 [P] [US2] Write failing tests in `web/tests/unit/learnedGrasp.test.ts`: with a stub policy (fixed outputs), one `step()` applies `action[0..4] × deltaScale` through `arm.applyDelta` and sets the gripper `closed` iff `action[5] > gripperThreshold`; `enter()` zeroes `prevAction`; `available()` is false when `parity.graspPolicy` is absent
- [X] T032 [P] [US2] Write `web/tests/e2e/learned-grasp-p2.spec.ts` tagged `@lg2`: Learned grasp button present (when `graspPolicy` exists); an attempt on the default cube ends with an outcome shown in the status card; Retry after switching to Scripted grasp restores the cube to the attempt's start pose (within 1 mm, 0.01 rad) and starts the scripted grasp; target drag during a learned grasp hands over to the Baseline without reset; policy view lists 30 inputs and 6 outputs; mode switch has no horizontal scroll at 360 px

### Implementation for User Story 2

- [X] T033 [US2] Generalize `web/src/sim/observation.ts`: field builders keyed by name (existing reach fields plus the grasp fields of T029) and `buildObsFrom(fields, size, inputs)`; `buildObs` for reach keeps its signature. T029 passes
- [X] T034 [US2] Move to parity.json v4 in one change (no broken intermediate state): update `training/reach/spec.py` and `web/src/sim/parity.ts` (`PARITY_VERSION = 4`, optional `graspPolicy` with validation "`graspPolicy.observation.size` = sum of field sizes = first layer `in`; `action.size` = last layer `out`; sha256 of `grasp.bin` matches", and `deltaScale == baseline.maxJointSpeed / controlHz`), `tests/parity/versions.test.ts` to v4, and in the same commit re-export `uv run python -m reach.export --run final-s1` (v4 without `graspPolicy`, `reach.json` `parityVersion: 4`, same weights hash) and run T046's regeneration; all suites green. Demo files stay valid (`simSha256` unchanged, contracts/demo-file.md)
- [X] T035 [US2] Add the grasp observation and dataset to `training/reach/demos.py` (`grasp_obs(model, parity, qpos, qvel, prev_action)` mirroring T033) and create `training/reach/imitate.py`: load demo files, build (obs, label) pairs per research R4/R6, normalization stats from training samples (clip 10, eps 1e-8), tanh MLP 30→256→256→6 (`--hidden 256 --layers 2`), MSE loss, Adam, `--epochs`, `--seed`, `--hand-share` (weighted sampler), `--run g1-s<seed>` into `training/runs/` (gitignored); log train/val loss. T030 passes (training part)
- [X] T036 [US2] Add `select` to `training/reach/imitate.py`: for each given run, copy `shared/` to a temporary directory, export the run into it, and call `npm run eval:grasp --workspace web -- --controller learned-grasp --seed 1 --n 100 --shared <tmp> --out <tmp>/sel.json` (the `--shared` option from T012) (selection placements, never seed 0), print a table of selection success per run, and pick the best; document in the module docstring that selection uses seed 1 only (FR-022)
- [X] T037 [US2] Extend `training/reach/export.py` with `--grasp-run <run>`: write `shared/policy/grasp.{bin,json}` (header per contracts/grasp-policy.md: `algo: "BC+DART"`, `trainedWith.demos` counts, hand share, noise list), `parity.json` `graspPolicy` (fields, normalization, action layout, sha256), on top of the v4 file from T034 (`reach.json` already re-exported ). T030 passes (export part)
- [X] T038 [US2] Update `web/src/control/policy.ts`: `loadPolicy(read, parity, section: "policy" | "graspPolicy")` verifying version and sha256 for either; reach call sites pass `"policy"`
- [X] T039 [US2] Create `web/src/control/learnedGrasp.ts` per contracts/grasp-policy.md "Runtime behavior" and register `learnedGrasp` in `web/src/control/registry.ts` (`id: "learned-grasp"`, label `"Learned grasp"`, `task: "grasp"`, `public: true`, `available: (p) => !!p.graspPolicy`, policy loaded on first selection). T031 passes
- [X] T040 [US2] Add Retry (data-model "Retry"): `session.retry()` in `web/src/sim/session.ts` (reset arm and gripper, cube to the last attempt's `startPose`, settle 0.2 s, start the selected grasp controller), protocol message `{type: "retry"}` in `web/src/protocol.ts`/`web/src/worker.ts`, Retry button in `web/src/ui/graspStatus.ts` shown after an outcome; status card shows "Running" then the outcome for controllers without phases
- [X] T041 [P] [US2] Update `web/src/ui/panel.ts` (policy view) to render the grasp policy's inputs grouped by field labels from `parity.json` and outputs as "Joint changes" ×5 plus "Gripper: open/close" while Learned grasp is active
- [X] T042 [P] [US2] Update `web/src/ui/modeSwitch.ts` for the new order "Manual · Baseline · Learned · Scripted grasp · Learned grasp"; if it overflows 360 px, use the short labels "Grasp: script" / "Grasp: learned" (contracts/ui.md)
- [X] T042a [US2] DAgger infrastructure (research R2b, 2026-10-07): extract `planTopDown`/`topDownDelta` from `web/src/control/grasp.ts` (pure refactor, `eval:grasp --controller grasp --check` reproduces); add the reactive expert `web/src/control/reactiveGrasp.ts` (lab grasp controller, `reactiveAction` for labels); DAgger rollouts `web/src/sim/dagger.ts` + `npm run dagger` (`web/scripts/dagger.ts`); recorder `labeler` option and `gripIntent`/`action` step fields (contracts/demo-file.md); `training/reach/demos.py` labels from them; `python -m reach.imitate dagger` rounds; tests in `web/tests/unit/dagger.test.ts`
- [ ] T043 [US2] Train: pilot one seed with `--hand-share 0.15` on the T026/T027 data to check loss and a seed-1 selection score; then tune on the selection set only (research R2/R4/R6): noise mix (generator rerun if needed), hand share ∈ {0.10, 0.15, 0.25} (0 is not a candidate: FR-007; it is only the T044 ablation), hidden 2×256 vs 3×256; record every configuration and its selection success in `validation.md`
- [ ] T044 [US2] Final training: 3 seeds of the chosen configuration (`g1-s0..2`), `imitate select` on seed 1, export the chosen run with `uv run python -m reach.export --run final-s1 --grasp-run <chosen>`; also train the scripted-only ablation (hand share 0) with the same seed and record its selection success (research R6)
- [ ] T045 [US2] Evaluate on the evaluation set (budget: at most 3 candidates over the whole feature are ever evaluated on seed 0, each logged in `validation.md` with its date, even if discarded; every change between candidates is chosen on seed 1 only): `npm run eval:grasp --workspace web -- --controller learned-grasp` (seed 0, n 100) and record success, median time to lift and failures in `validation.md`. **Decision** (FR-015): ≥ 80% → continue to T046; < 80% → record "004 closes without a grasp policy", restore `parity.json` to the T034 state (v4 without `graspPolicy`; delete `grasp.{bin,json}`), run T046 (the hash changed back), skip T047 and go to US3 with the scripted grasp only
- [ ] T046 [US2] Regenerate everything that hashes `parity.json` (run after T034, and again after every later `parity.json` change, on both T045 paths): `eval:grasp -- --controller grasp`, `eval -- --controller baseline/learned --n 100 --seed 0`, `eval:compare`, and the 002/003 parity fixtures (`uv run python -m reach.make_fixtures --run final-s1`); every number must reproduce exactly (reach weights unchanged); record in `validation.md`
- [ ] T047 [US2] Deploy P2: unit, parity, pytest, `npx playwright test --grep "@g1|@g2|@g3|@lg1|@lg2"`; push; on the public URL run Learned grasp and Retry with Scripted grasp on two placements

**Checkpoint**: learned grasp live (or the closing decision recorded).

---

## Phase 5: User Story 3 - Honest comparison (Priority: P3)

**Goal**: The info panel compares both grasps on the same placements with demo counts; parity
tests cover the grasp policy; CI reproduces every number.

**Independent Test**: quickstart "P3": both `eval:grasp --check` pass; panel rows equal the
reports; `npm run test:parity` passes with the grasp fixtures.

### Tests for User Story 3

- [ ] T048 [P] [US3] Add the grasp observation + network fixture to `tests/parity/policy.test.ts`: load `shared/parity/grasp-policy-recorded.json`, rebuild observations from the stored states in TS (≤ 1e-9) and run the exported network (≤ 1e-5) (skip with a clear message when `graspPolicy` is absent, i.e. 004 closed)
- [ ] T049 [P] [US3] Add `learned-grasp-recorded.json` to `tests/parity/trajectory.test.ts` as a ctrl-kind fixture: full `qpos` (13) and `qvel` (12) at ≤ 1e-6 (same skip rule)
- [ ] T050 [P] [US3] Write `web/tests/e2e/learned-grasp-p3.spec.ts` tagged `@lg3`: info panel grasp table has one row per public grasp controller with a report, values equal to `shared/grasp-eval/<id>.json` (success %, n, median, main failures); the demo line shows N scripted, M hand and the hand share from `grasp.json`

### Implementation for User Story 3

- [ ] T051 [US3] Generalize `web/scripts/record-grasp.ts` with `--controller <id>` writing `shared/parity/<id>-actions.json` (keep `grasp-actions.json` for `grasp`); add `grasp_policy_recorded()` and `learned_grasp_recorded()` to `training/reach/make_fixtures.py` (states from one recorded learned grasp, Python observations and network outputs; Python replay of `learned-grasp-actions.json`); generate both and run `npm run test:parity`; record max differences in `validation.md`. T048, T049 pass
- [ ] T052 [US3] Update `web/src/ui/infoPanel.ts` per contracts/ui.md "Info panel, grasp section": table controller · success (n) · median time to lift · main failures from `shared/grasp-eval/<id>.json` for every public grasp controller; the line "Learned grasp: behavior cloning from N scripted and M hand demonstrations (hand share X%); 3 training runs, the shipped one chosen on separate placements" from `grasp.json`; if 004 closed, one sentence saying a learned grasp was trained and did not reach the bar, linking `validation.md`. T050 passes
- [ ] T053 [US3] Copy the evaluation numbers into `grasp.json` `metrics` through `export.py` (never by hand: read `shared/grasp-eval/learned-grasp.json`), re-export, and add `eval:grasp -- --controller learned-grasp --check` to the CI eval job in `.github/workflows/ci.yml` (only when `graspPolicy` exists)
- [ ] T054 [US3] Deploy P3: full CI-equivalent run locally (lint, unit, build, size, evals with `--check`, pytest, parity, e2e `@g1|@g2|@g3|@lg1|@lg2|@lg3`); push; confirm the panel on the public URL matches the reports

**Checkpoint**: comparison live and CI-reproducible.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T055 [P] Extend `web/tests/e2e/soak.spec.ts` with learned grasps, scripted grasps, Retry, cancellations, cube moves and controller switches for 10 minutes; zero page errors, no cube leaving the scene (SC-008)
- [ ] T056 [P] Measure load and smoothness on the shipped build (SC-006): interactive time, frame rate and max stall during a learned grasp on desktop and mobile Chromium/WebKit projects; record in `validation.md` (CI tolerance 150 ms on mobile WebKit per the 002 open item)
- [ ] T057 [P] Update `README.md`: results table gains the learned grasp row (or the honest "not shipped" line), a short "Record demonstrations" section (`?record`, `npm run demos`, demo file format link), and "Plug in your own grasp controller" next to the reach plug-in guide (contracts/grasp-controller-plugin.md)
- [ ] T058 [P] Update `docs/ROADMAP.md`: status for 004 (date, numbers or closing decision), fix the stale "Status (2026-10-04)" header and "How to resume" (still says 002), carry open items (behavior cloning failure modes, 45° wrist-roll ambiguity, hand-demo effect from the ablation)
- [ ] T059 Run the quickstart top to bottom from a clean clone (`specs/004-learned-grasping/quickstart.md`) and fix any step that does not work as written
- [ ] T060 Minimality pass (Principle V): remove dead code left by the generalization (e.g. unused `GRASP` constant, old `grasp-eval.json` references), check `git diff --stat` of the plug-in commit (T014) touched only two files, and record the final constitution check in `validation.md`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks all stories. Order: T004/T005 (tests) → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014/T015 → T016.
- **US1 (Phase 3)**: after Phase 2 (recorder needs the attempt monitor for outcomes). T026/T027 (data) gate US2 training.
- **US2 (Phase 4)**: after US1's data (T026, T027); T033–T042 can start right after Phase 2 in parallel with US1. T045 is the release decision; T046 runs on both paths, T047 only if the bar is met.
- **US3 (Phase 5)**: after T045 (needs the decision; with no grasp policy, US3 ships the scripted-only comparison and skips fixture tasks T048/T049/T051 via their skip rule).
- **Polish (Phase 6)**: after US3.

### Story dependencies

- US1 → independent after Phase 2 (MVP: recording + plug-in surface + re-measured scripted grasp).
- US2 → needs US1's demonstration files; its code needs only Phase 2.
- US3 → needs US2's decision (T045).

### Within each story

Tests first (expected to fail), then implementation, then measure, then deploy.

## Parallel Opportunities

- Setup: T002, T003 together.
- Phase 2: T004, T005 together; T014, T015 together after T011.
- US1: T017, T018, T019 together; T022 (Node generator) in parallel with T023–T024 (browser UI) once T020–T021 are done; T025 (Python) in parallel with T020–T024.
- US2: T029, T030, T031, T032 together; T033/T034/T038 in parallel; T041, T042 in parallel with T039–T040.
- US3: T048, T049, T050 together.
- Polish: T055–T058 together.

### Parallel example: User Story 1

```text
Task: "T017 Recorder unit tests in web/tests/unit/recorder.test.ts"
Task: "T018 Demo file tests in training/tests/test_demos.py"
Task: "T019 e2e learned-grasp-p1.spec.ts tagged @lg1"
# then
Task: "T020/T021 Recorder in web/src/sim/recorder.ts + session hook"
Task: "T025 Python reader/replay in training/reach/demos.py"
# then
Task: "T022 Headless generator web/scripts/demos.ts"
Task: "T023/T024 Worker messages + recording card"
```

### Parallel example: User Story 2

```text
Task: "T029 Grasp observation tests (web)"
Task: "T030 Imitation + export tests (training)"
Task: "T031 Learned grasp controller tests"
Task: "T032 e2e learned-grasp-p2.spec.ts tagged @lg2"
# then
Task: "T033 observation.ts"  Task: "T034 parity v4"  Task: "T038 policy.ts loader"
```

## Implementation Strategy

### MVP first (Phase 2 + US1)

1. Phase 1 + Phase 2 → grasp plug-in surface; scripted grasp re-measured identical (T013, T016).
2. Phase 3 → recording mode, headless generator, Python replay; data recorded and verified.
3. **Stop and validate**: quickstart "P1" and the plug-in check; deploy P1.

### Incremental delivery

1. P1 live → recording mode (hidden), plug-in surface, per-controller evaluation.
2. P2 live (only at ≥ 80%) → learned grasp next to the scripted one, Retry.
3. P3 live → comparison in the panel, grasp parity, CI checks. If P2 missed the bar: P3 ships the
   scripted-only panel plus the honest "did not reach the bar" line (as 003).

## Notes

- Every number shown in the page comes from a committed report regenerated by a script; never typed in.
- Selection and tuning use placement seed 1 only; at most 3 candidates are ever evaluated on seed 0, all logged (T045).
- Commit after each task or logical group; deploy at each checkpoint.
