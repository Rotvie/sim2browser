# Contract: grasp evaluation (`npm run eval:grasp`, `shared/grasp-eval.json`)

Headless evaluation of the scripted grasp on the shipped code path (Node, the same `Session`
the worker runs). Implements spec SC-003/SC-004 and FR-015/FR-016.

## CLI

```text
npm run eval:grasp --workspace web -- [--n 100] [--seed 0] [--out ../shared/grasp-eval.json] [--check]
```

- Placements: `n` cube poses, centre uniform by area in `grasp.region`, yaw uniform in
  [0, π/2), from `mulberry32(seed)` (the 001 generator).
- Each episode: `session.reset()`, `setCube(pose)`, let the cube settle 0.2 s, `setMode("grasp")`,
  step until `done`/`failed` or `grasp.success.timeLimit + 1` s.
- `--check`: compute and compare with the committed file instead of writing; exit non-zero on
  any difference (CI).
- Exit code is 0 even when SC-003/SC-004 are missed: the numbers are reported, not gated.

## Output

```json
{
  "version": 1,
  "parityJsonSha256": "<hex>",
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

`not-graspable` never appears: placements are inside the region by construction.

## Consumers

- Info panel grasp section (fetches the file on first open, like the policy header in 001).
- `specs/002-grasp/validation.md` records each committed result with its date.
- CI: `eval:grasp --check` in the eval job; the deploy needs it.
