# Contract: evaluation report additions (SC-003)

Delta against 001's `EvalReport` (`web/scripts/eval.ts`, data-model 001).

```json
{
  "controller": "learned",
  "n": 300,
  "seed": 0,
  "successRate": 0.0,
  "meanSqTipJerk": 0.0,
  "floorContactRate": 0.0,
  "cubeMovedRate": 0.0,
  "perTarget": [{ "target": [0, 0, 0], "success": true, "settleTime": 1.1, "floor": false, "cubeMoved": false }]
}
```

- `floor`: any contact between an arm body (every body moved by a joint, plus `Moving_Jaw`) and the
  floor during the episode.
- `cubeMoved`: cube centre displaced > 0.01 m (horizontal or vertical) from its pose at the start.
- `eval:compare` prints both rates with SC-003 verdicts (floor ≤ 1%, cube ≤ 2%) and, with
  `--write-metrics`, adds them to the policy header's `metrics`. Never fails the build.
- The Python proxy (`reach/evaluate.py`) reports the same two rates with the same definitions.
