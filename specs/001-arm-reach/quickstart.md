# Quickstart & Validation: Arm Reach

How to prove each release rung works. Contracts: [env-spec](./contracts/env-spec.md),
[policy](./contracts/policy-artifact.md), [parity](./contracts/parity-fixture.md),
[ui](./contracts/ui.md). Thresholds: [research R11](./research.md#r11-committed-thresholds-spec-asked-the-plan-to-fix-these).

## Prerequisites

- Node.js 22 LTS, npm
- Python 3.12, `uv` (or pip + venv)
- Playwright browsers: `npx playwright install chromium webkit`

## Setup

```bash
cd web && npm ci
cd ../train && uv sync
```

## Rung P1 — See and pose the arm

```bash
cd web
npm run dev                    # open http://localhost:5173
npm test                       # unit tests
npm run test:e2e -- --grep @p1 # load time, posing, joint limits, fps (desktop + mobile emulation)
npm run build && npm run size  # checks the load budget (≤ 4 MB compressed before interactive)
```

Expected: arm visible and interactive in ≤ 3 s (throttled-4G profile); dragging past a limit
holds the joint at its limit; fps ≥ 30 with no frame gap > 100 ms.

Manual check: open the deployed URL on a real phone; orbit, pinch-zoom, pose each joint.

## Rung P2 — Baseline reaches the target

```bash
cd web
npm run eval -- --controller baseline --n 100 --seed 0   # prints EvalReport JSON
npm run test:e2e -- --grep @p2
```

Expected: `successRate ≥ 0.99`, settle within 2.0 s at 1 cm; e2e shows an unreachable target
marked and the arm stopped at its limit without oscillating; a continuous drag is followed without
stalls.

## Rung P3 — Learned policy vs. baseline

```bash
cd train
uv run python -m reach.train --seed 0            # CPU; writes checkpoints
uv run python -m reach.export                    # writes shared/env-spec.json stats + shared/policy/*
uv run python -m reach.make_fixtures             # writes shared/parity/*.json
uv run pytest

cd ../web
npm run test:parity                              # MUST pass (release gate 1)
npm run eval -- --controller learned  --n 100 --seed 0
npm run eval -- --controller baseline --n 100 --seed 0
npm run eval:compare                             # SC-004 + SC-009 verdict
npm run test:e2e -- --grep @p3
npm run test:e2e -- --grep @soak                 # 10-minute random-drag soak (SC-005)
```

Expected: parity passes; learned `successRate ≥ 0.90`; learned `meanSqTipJerk ≤ 0.5 ×` baseline;
switching mode mid-reach keeps pose and target; panel values change every frame while moving;
no requests other than static assets (SC-008).

## Release (every rung)

```bash
cd web && npm run build && npm run preview   # final smoke check on the production build
# push to main → CI runs unit, parity, eval, e2e → deploys web/dist to GitHub Pages
```

A rung is done when the public URL is live and all four constitution release gates are green.
Then run the informal 5-visitor test for SC-006 and SC-007 and record the results in
`specs/001-arm-reach/validation.md`.
