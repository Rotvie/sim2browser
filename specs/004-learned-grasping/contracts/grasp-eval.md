# Contract: grasp evaluation v2 (`shared/grasp-eval/<id>.json`)

Replaces 002's `shared/grasp-eval.json` (moved to `shared/grasp-eval/grasp.json`). Spec FR-016,
FR-017, SC-001–SC-003.

## CLI

```text
npm run eval:grasp --workspace web -- --controller <id> [--n 100] [--seed 0] [--out <path>] [--check]
```

- Default `--controller grasp`, default `--out ../shared/grasp-eval/<id>.json`.
- Placements: `graspPlacements(parity, n, seed)` (002, unchanged).
- Episode: `setMode(manual)`, reset, place cube, settle 0.2 s, `setMode(<id>)`, step until the
  attempt monitor reports `done`/`failed` or `timeLimit + 1` s.
- `--check`: recompute and compare with the committed file; non-zero on any difference (CI).
- Verdict line per controller: scripted vs. 002 targets (≥ 90%, ≤ 6 s); `learned-grasp` vs. the
  release bar (≥ 80%). Exit 0 regardless (numbers reported, not hidden); the release decision is
  made in `validation.md`, and the learned grasp ships only if it is met (FR-015).

## Output

```json
{
  "version": 2,
  "controller": "learned-grasp",
  "task": "grasp",
  "parityJsonSha256": "<hex>",
  "policySha256": "<hex or null>",
  "n": 100,
  "seed": 0,
  "successRate": 0.0,
  "medianTimeToLift": 0.0,
  "failures": { "missed": 0, "slipped": 0, "knocked": 0, "timeout": 0 },
  "placements": [
    { "pos": [x, y], "yaw": 0.0, "success": true, "timeToLift": 0.0, "failure": null }
  ]
}
```

## Consumers

- Info panel grasp section: one row per public grasp controller with a report.
- `export.py --grasp-run` copies `learned-grasp.json`'s numbers into `grasp.json` `metrics`.
- CI eval job: `--check` for `grasp` and (if shipped) `learned-grasp`.
- `specs/004-learned-grasping/validation.md`: every committed result with its date.
