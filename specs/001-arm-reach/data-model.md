# Data Model: Arm Reach

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Runtime state lives in the sim worker's memory (the main thread holds only the latest snapshot).
The only persisted data are static build artifacts.

## Runtime entities (worker)

### Arm

| Field | Type | Notes |
|-------|------|-------|
| `q` | float[5] | joint positions (rad), from MuJoCo `qpos` |
| `qd` | float[5] | joint velocities (rad/s), from `qvel` |
| `ctrl` | float[5] | position-actuator targets; the only thing controllers write |
| `limits` | [min,max][5] | joint ranges from `so100_reach.xml` |
| `tip` | float[3] | tip site world position (m) |

**Rules**: `ctrl[i]` is always clipped to `limits[i]` (FR-005). Per-step change of `ctrl` is bounded
(policy: `deltaScale`; baseline: `maxJointSpeed / controlHz`).

### Target

| Field | Type | Notes |
|-------|------|-------|
| `pos` | float[3] | world position (m) |
| `reachable` | bool | UI indicator: the target's voxel in the `reach.workspace` grid is occupied and z ≥ `minZ`; hysteresis = must be ≥ `hysteresis` inside or outside the reachable region (by distance to the nearest boundary voxel) before flipping |

**Rules**: `pos` is clamped to z ≥ `minZ` and outside `baseExclusionRadius` around the base axis.
Visual only (no collision). `reachable` is not a policy input.

### ControlMode (state machine)

States: `manual`, `baseline`, `learned` (available once the policy has loaded).

| From | Event | To |
|------|-------|----|
| any | `setMode` | requested mode |
| `baseline` / `learned` | `dragJoint` | `manual` (reason `joint-grab`) |
| any | `reset` | same mode; arm and target return to their defaults |
| `learned` | policy load or hash check fails | `baseline` (reason `policy-load-failed`) |

**Rules**: A switch never changes `q`, `qd`, or `Target.pos` (FR-012). Entering `learned` sets
`prevAction` to zeros. The initial mode is `manual` in P1 and `baseline` from P2 onward.

### PolicyStep (sent in snapshots, shown in the panel)

| Field | Type | Notes |
|-------|------|-------|
| `obsRaw` | float[21] | layout per [parity.json](./contracts/parity-json.md) |
| `obsNorm` | float[21] | `clip((obsRaw − mean)/max(std, eps), ±clip)` |
| `action` | float[5] | MLP output in [-1, 1] |
| `prevAction` | float[5] | previous step's action |

### Snapshot (worker → main)

See [worker-protocol.md](./contracts/worker-protocol.md). Holds body poses for rendering plus the
Arm, Target, mode, and optional PolicyStep, stamped with sim time `t`.

### EvalReport (evaluation output, not shipped)

| Field | Type |
|-------|------|
| `controller` | `"baseline"` \| `"learned"` |
| `seed`, `n` | int |
| `successRate` | float |
| `settleTimeP50`, `settleTimeP95` | float (s) |
| `meanSqTipJerk` | float (m²/s⁶) |
| `perTarget` | array of `{target, success, settleTime}` |

## Static artifacts (single source of truth, `shared/`)

| Artifact | Path | Producer | Consumers |
|----------|------|----------|-----------|
| Robot model | `shared/robot/so100_reach.xml` + `assets/` | derived once from Menagerie | training, web, tests |
| Parity config | `shared/parity.json` | `training/reach/export.py` only | web, tests, evaluation |
| Workspace grid | `shared/workspace.bin` | `training/reach/export.py` (also with `--no-policy`) | web (reachable indicator) |
| Policy | `shared/policy/reach.bin` + `reach.json` | `training/reach/export.py` (P3) | web, tests |
| Parity fixtures | `shared/parity/*.json` | `training/reach/make_fixtures.py` | `tests/parity` |

`parity.json` records the SHA-256 of the robot model (XML plus all assets), of `workspace.bin`, and of `reach.bin`; a mismatch anywhere fails the
parity tests and the browser loader.

For P1 and P2, which need no training, `export.py --no-policy` writes `parity.json` with the
timestep, layout, reach, success and baseline sections. The normalization and policy sections
are added in P3. The browser still never hand-codes these values.
