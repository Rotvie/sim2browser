# Contract: `shared/parity.json`

The single source of truth for every value parity depends on (constitution Principle II).
**Written only by training** (`training/reach/export.py`); the browser, the evaluation, and the
parity tests only read it. Nothing in it is hand-copied into code.

```json
{
  "version": 1,
  "mujocoVersion": "3.14.0",
  "model": { "path": "robot/so100_reach.xml", "sha256": "<hex>",
             "files": ["robot/so100_reach.xml", "robot/assets/..."] },
  "timestep": 0.002,
  "substeps": 10,
  "controlHz": 50,
  "joints": ["Rotation", "Pitch", "Elbow", "Wrist_Pitch", "Wrist_Roll"],
  "tipSite": "tip",
  "shoulderSite": "shoulder",
  "action": { "size": 5, "low": -1.0, "high": 1.0, "deltaScale": 0.05 },
  "observation": {
    "size": 21,
    "fields": [
      { "name": "q",           "size": 5, "label": "Joint angles",     "unit": "rad" },
      { "name": "qd",          "size": 5, "label": "Joint speeds",     "unit": "rad/s" },
      { "name": "target",      "size": 3, "label": "Target position",  "unit": "m" },
      { "name": "tipToTarget", "size": 3, "label": "Tip → target",     "unit": "m" },
      { "name": "prevAction",  "size": 5, "label": "Previous command", "unit": "" }
    ],
    "normalization": { "mean": [/* 21 */], "std": [/* 21 */], "clip": 10.0, "eps": 1e-8 }
  },
  "reach": { "maxReach": 0.0, "margin": 0.01, "hysteresis": 0.005, "minZ": 0.01,
             "frontMargin": 0.02, "baseAxisXY": [x, y], "baseExclusionRadius": 0.05,
             "workspace": { "path": "workspace.bin", "sha256": "<hex>", "origin": [x, y, z],
                            "voxel": 0.01, "dims": [nx, ny, nz] } },
  "success": { "tolerance": 0.01, "maxTipSpeed": 0.02, "hold": 0.2, "timeLimit": 2.0 },
  "baseline": { "damping": 0.05, "gain": 5.0, "maxJointSpeed": 2.5, "nullspaceGain": 0.5,
                "reachStandoff": 0.02,
                "neutralPose": [/* 5 */] },
  "policy": { "path": "policy/reach.bin", "header": "policy/reach.json", "sha256": "<hex>" }
}
```

(Joint names follow the Menagerie SO-ARM100 model; confirm against the derived XML. `maxReach`
is measured from forward-kinematics sampling at export, not guessed.)

## Rules

- `model.sha256` is the SHA-256 over every file in `model.files` (the XML and every asset it
  references), concatenated in sorted path order as `path\0bytes\0`. Any asset change (e.g. mesh
  decimation) changes the hash, so parity tests must be re-run.
- The derived XML MUST give every body an explicit `<inertial>`, so mass and inertia never depend
  on mesh geometry. Visual meshes can then change without changing the physics; they still
  change the hash, which is intended.
- `reach.workspace` is a bit-packed occupancy grid (1 = the tip reaches some point in that voxel,
  within joint limits, in front of the base: y ≤ `baseAxisXY[1] − frontMargin`), built at export
  from forward-kinematics samples, dilated by one voxel and
  then eroded by one voxel to fill gaps between samples. It drives the UI `reachable` indicator.
  `maxReach` is kept only for sampling unreachable training targets.

- `timestep × substeps` MUST equal `1 / controlHz`; the reader asserts this.
- The field order in `observation.fields` IS the vector layout. Any layout change bumps
  `version` and requires re-training and new fixtures.
- `std` is used as `max(std, eps)`; normalized obs = `clip((obs − mean)/std, ±clip)`.
- Action application: `ctrl = clip(ctrl + action·deltaScale, jointLow, jointHigh)` once per control
  step, followed by `substeps` physics steps.
- Baseline parameters live here too, so the baseline shown in the demo matches the one evaluated
  and documented.
- Every reader MUST fail loudly when `mujocoVersion`, `model.sha256`, or `policy.sha256` does not
  match what it loaded.
