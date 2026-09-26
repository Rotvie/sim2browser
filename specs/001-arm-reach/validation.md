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

## P3
