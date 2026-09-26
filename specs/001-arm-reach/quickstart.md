# Quickstart & Validation: Arm Reach

How to prove each rung works. Contracts: [parity.json](./contracts/parity-json.md),
[policy](./contracts/policy-artifact.md), [fixtures](./contracts/parity-fixture.md),
[worker](./contracts/worker-protocol.md), [ui](./contracts/ui.md).
Thresholds: [research R12](./research.md#r12-committed-thresholds).

## Prerequisites

- Node.js 22 LTS, npm
- Python 3.12, `uv`
- Playwright browsers: `npx playwright install chromium webkit`

## Setup

```bash
cd web && npm ci
cd ../training && uv sync
uv run python -m reach.export --no-policy   # writes shared/parity.json (no training needed)
```

## Rung P1 — See and pose the arm (web only)

```bash
cd web
npm run dev                         # http://localhost:5173
npm test                            # unit
npm run test:e2e -- --grep @p1      # load time, posing, joint limits, fps; desktop + mobile emulation
npm run build && npm run size       # ≤ 4 MB compressed before interactive
```

Expected: arm interactive in ≤ 3 s (throttled-4G profile); dragging past a limit holds the joint;
≥ 30 fps, no frame gap > 100 ms. Manual check: deployed URL on a real phone.

## Rung P2 — Baseline reaches the target (web only)

```bash
cd web
npm run eval -- --controller baseline --n 100 --seed 0
npm run test:e2e -- --grep @p2
```

Expected: `successRate ≥ 0.99` (1 cm, 2 s); an unreachable target is marked and the arm stops at
its limit without oscillating; continuous drags are followed without stalls; the info panel shows
the baseline design.

## Rung P3 — Learned policy vs. baseline

```bash
cd training
uv run python -m reach.train --seed 0     # CPU PPO
uv run python -m reach.export             # parity.json (with normalization) + shared/policy/*
uv run python -m reach.make_fixtures      # shared/parity/*.json
uv run pytest

cd ..
npx vitest run tests/parity               # release gate: trajectories ≤ 1e-6, policy ≤ 1e-5
cd web
npm run eval -- --controller baseline --n 100 --seed 0
npm run eval -- --controller learned  --n 100 --seed 0
npm run eval:compare -- --write-metrics   # SC-004 + SC-009 verdict; writes metrics into reach.json
npm run test:e2e -- --grep @p3
npm run test:e2e -- --grep @soak          # 10-minute soak (SC-005)
```

Expected: parity passes; learned `successRate ≥ 0.95`; jerk ratio ≤ 0.70; a mid-reach switch keeps
pose and target; the panel updates live; the info panel shows the measured metrics. If the
thresholds are missed, the metrics are still shown as measured and the shortfall is recorded in
`validation.md`. Never weaken the baseline.

## Release (every rung)

Push to `main` → GitHub Actions runs unit, parity, eval, and e2e → deploys `web/dist` to GitHub
Pages. Deployment is blocked if parity fails. A rung is done when the public URL is live and all
constitution release gates are green. Then run the 5-visitor test (SC-006/SC-007) and record the
results in `specs/001-arm-reach/validation.md`.
