# Validation log: 001-arm-reach

Measurements and manual checks recorded during implementation. Newest entries at the bottom of
each section.

## Risk checks

### T002: MuJoCo version pin (2026-09-25)

- `@mujoco/mujoco` on npm: latest 3.14.0. PyPI `mujoco`: latest 3.14.0, with cp312 wheels for
  macOS arm64, Linux x86_64 and Linux aarch64. Pinned: `shared/MUJOCO_VERSION` = `3.14.0`.
- The official WASM bindings load `so100_reach.xml` with all 13 STL meshes from an `MjVFS` under
  Node 26 (`mj_loadXML`), step (5,000 steps in 29 ms) and expose `mj_jacSite`.
- Cross-check: 5,000 steps from the default state give identical `qpos` and tip position in Python
  and WASM (to printed precision). Formal 1e-6 trajectory parity tests come in P3.
- No fallback to `zalo/mujoco_wasm` needed.

### T030: load budget (2026-09-25)

`npm run build && npm run size`, all files fetched before the arm is interactive:

| | Compressed |
|---|---|
| MuJoCo WASM | 1.86 MB brotli / 2.52 MB gzip (10.07 MB raw) |
| App JS (three.js + UI) | 113 KB brotli |
| Worker JS | 32 KB brotli |
| Robot meshes (13 STL) | 0.67 MB brotli |
| **Total** | **2.62 MB brotli, 3.45 MB gzip** (budget 4 MB) |

Within budget with no mesh decimation. GitHub Pages serves
gzip only, so 3.45 MB is the number that matters there. It is about 2.3 s of transfer at
12 Mbit/s, which leaves little headroom for SC-001's 3 s; the P1 e2e load test is the real
check.

### T041: SC-001 load time and mesh decimation (2026-09-26)

With gzip on the local preview server (matching a compressing static host), time to interactive
at 12 Mbit/s + 40 ms latency, cold cache, was 3.0–3.7 s at first. Mitigations, in order:

| Change | Time to interactive (desktop / mobile-chromium 4× CPU) |
|---|---|
| Baseline (engine, then robot files, sequentially) | 3.73 / 3.84 s |
| Engine and robot files download in parallel | 3.56 / 3.71 s |
| Visual meshes decimated to 40% of faces | 3.03 / 3.07 s |
| Boot script starts the worker before three.js loads | **2.78–2.81 / 2.84–2.90 s** (3 runs) |

The final payload is 2.40 MB brotli / 3.09 MB gzip. Decimation left physics bit-identical (2,000-step
randomized trajectory, explicit inertials). The perforated base plate looks slightly coarser.
Headroom against 3 s is only 100–200 ms: anything added before interactive must be measured.

**Open for the public deploy**: GitHub Pages serves gzip; confirm it actually compresses
`.wasm` and `.stl` responses. Without compression the payload is about 12.7 MB (roughly 9 s at
12 Mbit/s).

## P1

### Automated (2026-09-26), local production build (`vite preview`, gzip)

| Check | desktop-chromium | mobile-chromium (Pixel 7, 4× CPU) | mobile-webkit (iPhone 14) |
|---|---|---|---|
| Time to interactive, 12 Mbit/s + 40 ms (SC-001, ≤ 3 s) | 2.81 s ✓ | 2.85 s ✓ | n/a (no CDP throttling) |
| fps / max frame gap, 10 s of posing (SC-002) | 60.0 / 16.8 ms ✓ | 47.9 / 66.8 ms ✓ | 60.0 / 25.0 ms (recorded) |
| Orbit, pose, limits, reset, no console errors | ✓ | ✓ | ✓ |
| Static-only requests (SC-008, gate 3) | ✓ | ✓ | ✓ |

Soak (SC-005), desktop Chromium, 10 min: **first run failed**. Wrist_Pitch reached 1.68 rad
against its 1.66 limit: instant manual joint targets slammed joints into MuJoCo's soft limits,
overshooting by up to 0.1 rad. Fix: Manual mode now moves joint targets at the shared 2.5 rad/s
joint-speed limit (overshoot ≤ 0.002 rad in simulation; covered by a new unit test). **Rerun
passed**: 601 s, 817 actions, max snapshot gap 66.7 ms, no limit breach, NaN or console error.

### Manual

- [ ] Real phone over LAN (`npm run build && npm run preview -- --host`): orbit, pinch-zoom, pose
  every joint; record device, load time, observations.
- [ ] Public deploy (GitHub Pages) once a remote exists; the rung is complete only then
  (constitution gate 4).

## P2

### Baseline evaluation (SC-003), `npm run eval -- --controller baseline --n 100`

| Seed | Success (≥ 99%) | Settle p50 | Settle p95 | Mean squared tip jerk |
|---|---|---|---|---|
| 0 | **100%** | 1.14 s | 1.52 s | 278.3 m²/s⁶ |
| 1 | **100%** | 1.16 s | 1.52 s | 278.2 m²/s⁶ |
| 2 | **100%** | 1.18 s | 1.52 s | 279.7 m²/s⁶ |

The jerk figure is the reference for SC-009 in P3 (learned must be ≤ 70% of it).

### Findings and decisions during P2 (2026-09-26)

- **Workspace**: over the full reachable set the baseline settled on only 77/100. Every failure was
  behind the base, where the arm must fold back over itself (a local minimum for reactive IK).
  Decision (user): the demo workspace is the **front of the base**, for the UI, evaluation and
  training. The workspace grid excludes y > base − 2 cm.
- **Out-of-reach limit cycle**: aiming at a far target drove the stretched arm into its
  singularity, giving a 1.4 cm oscillation. Fix: the baseline aims at the nearest point it should
  reach (front-workspace boundary, then the sphere at maxReach − 2 cm). Oscillation dropped to 0.13 mm,
  with success unchanged. More damping also fixed it but cut success to 16–60%.
- **Phone framing**: in portrait the default camera put the target off-screen (found by the
  two-finger e2e test). The camera now fits the working area to any aspect ratio until the visitor
  moves it.

### Automated (2026-09-26), local production build

| Check | desktop-chromium | mobile-chromium (4× CPU) | mobile-webkit |
|---|---|---|---|
| Time to interactive, 12 Mbit/s + 40 ms (SC-001) | 2.85–2.94 s ✓ | 2.92–2.95 s ✓ | n/a |
| P1 suite (posing, limits, reset, fps) | ✓ | ✓ | ✓ |
| Baseline mode by default; settles ≤ 1 cm within 2 s | ✓ | ✓ | ✓ |
| 3 s circular drag followed (< 5 cm after 0.5 s, no stall) | ✓ | ✓ | ✓ |
| Out of reach marked, arm still (< 1 mm), resumes after | ✓ (wheel) | ✓ (two-finger depth) | skipped (no multi-touch in WebKit) |
| Joint grab → Manual; switch back to Baseline | ✓ | ✓ | ✓ |
| Info panel shows the parity.json baseline values | ✓ | ✓ | ✓ |
| Static-only requests (gate 3), now with target drag | ✓ | ✓ | ✓ |

**Load-time headroom is now 50–80 ms** (P1: 150–200 ms). The payload is unchanged (3.08 MB gzip);
parallelizing the workspace fetch did not help measurably, since transfer and WASM compile
dominate. Treat any addition before interactive as needing a matching saving.

Soak (SC-005), desktop Chromium, 10 min. The first P2 run passed but did not drag the target
(action list gap). Target drags were added and it ran again: 602 s, 787 actions (131 target drags,
about 30% of them far out of reach), max snapshot gap 68.5 ms, no limit breach, NaN or console
error.

### Manual

- [ ] Real phone over LAN: drag the target (one finger), change depth (two fingers), watch the
  baseline follow, check out-of-reach, open the info panel.
- [ ] Public deploy once a remote exists (gate 4).

## P3

### Training log (T064; at most 5 tuning rounds, baseline never changed)

Proxy numbers from `training/reach/evaluate.py` (Python, 100 front-workspace targets, same
success protocol). The number of record is the web evaluation below.

| Run | Change | Steps | Success | Jerk ratio | Notes |
|---|---|---|---|---|---|
| r1 | reward as planned (R5), full penalties from start | 3.5M (stopped) | — | — | mean distance stuck at 0.30 m: exploration jerk made the penalties dominate, so the policy learned to stay still |
| r2a / r2b | penalty curriculum / penalties ÷10 | 2.4M each (stopped) | — | — | distance stuck around 0.19 m in both. A sanity run (no penalties, one target, fixed start) did learn (60% within 1 cm at 2M), so no bug, just a hard, slow task |
| **r3** (round 1) | + precision term w·(1 − tanh(d/2 cm)), curriculum over 50%, 12 envs | 40M | 74% | 0.58 | 80% end within 1 cm, 15% stall at 1–2 cm: needs a sharper precision signal. Wrist_Roll spins at 1.1 rad/s on average (the tip cannot see it) |
| r4 (round 2) | resume r3; precision weight 1.0, scale 1 cm; full penalties | +30M | 95% | 0.65 | 5M: 90%, 10M: 89%, 15M: 85%, 20M: 86%, 25M: 94%, 30M: 96%. Both targets met on the proxy, narrowly. Wrist_Roll still spins at 1.06 rad/s |
| r5 (round 3) | resume r4; + joint-speed penalty 0.005·‖q̇‖² | +20M | 92% | 0.71 | 5M: 97%/0.68, 10M: 96%/0.63, 15M: 96%/0.67, 20M: 92%/0.71. Wrist_Roll unchanged (1.02 rad/s); the penalty is too weak to matter. Trace: the roll command gets no reward signal, so it saturates early and then drifts to the limit |
| r6 (round 4) | resume r4; joint speed 0.005 + posture 0.01·‖q − neutral‖² + effort 0.01·‖a‖² | +20M | 92% | 0.77 | 5M: 97%/0.70, 10M: 98%/0.75, 15M: 93%/0.75, 20M: 92%/0.77. Roll drift halved (ends near 1.6 instead of 2.8 rad) but still opens with full wrist commands: the resumed policy keeps its round-1 habit |
| r7 (round 5, last) | from scratch with the complete reward (precision 1 cm, joint speed, posture, effort; curriculum 50%) | 60M | 0% | 0.21 | never learned to reach: with posture and effort present from the start, staying near the neutral pose was optimal (the same failure mode as r1). Jerk is low because the arm barely moves |

**Selection** (all 5 rounds used). Candidates were compared on a fresh set of 300 targets
(Python proxy, seed 999) that is not used for reporting: r4 final 94% / 0.62, r5@5M 93% / 0.66,
r5@10M 92% / 0.58, r6@5M 94% / 0.68. **Chosen: r4-sharper (round 2 final)**, tied for best
success and with the best jerk ratio among those that pass SC-009.

### Result of record (web evaluation: shipped TypeScript policy on the WASM sim)

| Targets | Learned success (SC-004 ≥ 95%) | Jerk ratio (SC-009 ≤ 0.70) | Settle p50 learned / baseline |
|---|---|---|---|
| 100 (seed 0, the SC definition, CI) | **96.0% PASS** | **0.653 PASS** | 1.12 s / 1.14 s |
| 300 (seed 0, larger sample) | **94.7% MISS** (284/300) | **0.672 PASS** | 1.14 s / 1.12 s |
| 100 (seed 1) / 100 (seed 2) | 92% / 92% | 0.612 / 0.629 | |

**Honest summary**: smoothness (SC-009) is met robustly: the learned tip jerk is 61–67% of the
baseline's on every target set. Success (SC-004) is met on the 100-target set the spec defines
but is about 94–95% on larger samples, i.e. at the threshold rather than clearly above it. The
info panel shows the 300-target numbers (94.7%, 67%), including the miss. The baseline was
never changed (FR-018).

**Known artifact**: the policy moves Wrist_Roll (mean 1.0 rad/s), a joint that does not move the
tip, so neither the reward nor the metrics see it. Rounds 3–5 tried joint-speed, posture and
effort penalties: resuming could not unlearn it, and training from scratch with them failed to
reach. Visually the gripper rotates while reaching. Candidate fix for a later feature: remove
Wrist_Roll from the policy's action space (hold it at neutral, as the baseline effectively does).
That changes the parity contract (action size 4), so it needs retraining and new fixtures.

### Parity with the final policy

`npm run test:parity`: 6/6 pass (versions and hashes, 3 trajectory replays ≤ 1e-6, observation
≤ 1e-6 and policy ≤ 1e-5). Measured with r3: trajectories 1.4e-14, observations 5.8e-15, actions
2.8e-7.

Web evaluation of r4 (number of record for the current fallback): seed 0: 96% / 0.653, seed 1:
92% / 0.612, seed 2: 92% / 0.629; pooled over 300 targets: **93.3%** success. SC-004 passes on
seed 0 only.

Web evaluation of r3 (TypeScript policy on WASM, the number of record): success 79%, jerk ratio
0.564, settle p50 1.22 s (baseline 1.14 s).

### Parity (Principle II, release gate)

With the r3 export: `npm run test:parity`, 6/6 pass. Measured worst-case differences:
trajectory replays |Δqpos, qvel| ≤ 1.4e-14 (tolerance 1e-6); observations 5.8e-15 (1e-6);
policy actions 2.8e-7 (1e-5; float32 weights).

### Automated (final policy)

- Unit 38/38, training 14/14, parity 6/6, lint and format clean.
- E2E P1+P2+P3 and static-only: 40 passed, 2 skipped (WebKit: no CDP throttling, no multi-touch)
  on desktop Chromium, mobile Chromium (4× CPU) and mobile WebKit. P3 covers: learned settles
  ≤ 1 cm within 2 s; switching mid-reach keeps the target and moves joints no faster than the
  2.5 rad/s limit allows in the elapsed sim time; the policy view updates live; measured results
  are shown; a corrupted `reach.bin` falls back to Baseline with a notice.
- Load budget unchanged: 2.40 MB brotli / 3.09 MB gzip before interactive (the policy, 80 KB,
  loads only when Learned is first selected).
- Soak, 10 min with Learned in the mode rotation: 601 s, 718 actions (169 target drags), max
  snapshot gap 123.8 ms, no limit breach, NaN or console error.
- Phone layout fixes found while testing P3: the policy view is a bottom sheet above the toolbar,
  and the 3D view shifts up (camera view offset) so the arm stays visible above it; the toolbar is
  2 rows on narrow screens; the view now updates on height-only resizes.

### Manual (P3)

- [ ] Real phone over LAN: switch Learned ↔ Baseline mid-drag, open "Policy view" (bottom sheet,
  arm stays visible above it), open the info panel and check the measured results.
- [ ] 5-visitor test for SC-006 / SC-007 (T081), after the public deploy.
- [ ] Public deploy once a remote exists (gate 4).

## CI note (2026-09-26)

GitHub-hosted runners have no GPU and few cores, so the SC-001 (load time) and SC-002 (fps)
assertions run in record-only mode when `CI` is set: the numbers are attached to the test
report but do not block deploy. All functional e2e checks, parity, unit tests, evaluation and
the size budget still gate the deploy. SC-001/SC-002 are verified locally (numbers above) and on
a real phone (manual checks).

First public CI runs: 42/43 e2e passed each time, with one hardware-bound failure per run:
(1) the P1 posing scenario ran past the 60 s timeout under the 4× mobile throttle (now 180 s);
(2) the circular-drag lag reached 5.3 cm against 5 cm on mobile Chromium, because the sim runs
slower than real time on the runner while the drag follows the wall clock. CI now allows 8 cm;
local and real-device runs keep 5 cm. (3) A third run failed the snapshot-gap check (0.12 s vs
0.10 s) in the same project: the page samples snapshots once per rendered frame, and frames were
that slow. Root cause for all three: the 4× CPU throttle stacked on an already slow runner.
The mobile-chromium throttle is now applied on development machines only (where it is
calibrated); in CI that project checks viewport, touch and layout.
(4) Later, mobile-webkit (never throttled) failed the policy-view check with 6 distinct panel
states against 8: the test sampled a fixed 10 times at 40 ms, but the panel refreshes once per
rendered frame and frames on the GPU-less runner were slower than 40 ms. The test now drags until
it sees 8 distinct states (at most 40 moves), so it checks live updates, not frame rate.

## Public deploy (2026-09-26): https://rotvie.github.io/sim2browser/

Constitution gate 4 is met for P1–P3 (public URL). CI: all jobs green (web, training, parity,
e2e, deploy) after the three runner-only fixes above.

Live measurement, cold cache, 12 Mbit/s + 40 ms latency (the SC-001 profile):

| Run | Time to interactive |
|---|---|
| desktop, 1st load after deploy (CDN cold) | 3.09 s |
| desktop, 2nd / 3rd | 2.76 s / 2.60 s |
| phone profile (Pixel 7, 4× CPU) | 2.68 s |

Found on the live site and fixed: GitHub Pages served the `.stl` meshes uncompressed (MIME type
`application/vnd.ms-pki.stl`), so time to interactive was 3.58 s. They are now served as `.stl.bin`
(octet-stream, gzipped; Base mesh 177 KB → 73 KB) with identical bytes, so hashes and parity are
unchanged. The WASM (2.58 MB gzip) was compressed from the start.
