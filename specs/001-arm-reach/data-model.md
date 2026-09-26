# Data Model: Arm Reach

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

The runtime state lives in memory; the only persisted data are static build artifacts.

## Runtime entities

### Arm

| Field | Type | Notes |
|-------|------|-------|
| `q` | float[7] | joint positions (rad), read from MuJoCo `qpos` |
| `qd` | float[7] | joint velocities (rad/s), from `qvel` |
| `ctrl` | float[7] | position-actuator targets; the only thing controllers write |
| `limits` | [min,max][7] | from `panda_reach.xml` joint ranges |
| `tip` | float[3] | tip site world position (m) |

**Rules**: `ctrl[i]` is always clipped to `limits[i]` (FR-005). `q` stays within the limits
because of joint range enforcement in the model.

### Target

| Field | Type | Notes |
|-------|------|-------|
| `pos` | float[3] | world position (m) |
| `reachable` | bool | derived: distance to shoulder ≤ max reach − 2 cm and z ≥ ground clearance; hysteresis 1 cm |
| `dragging` | bool | true while the visitor holds it |

**Rules**: `pos` is clamped to z ≥ 0.02 m and outside a 0.12 m radius around the base axis. Not a
physics body (visual only, no collision).

### ControlMode (state machine)

States: `Manual`, `Baseline`, `Learned` (the latter is available only once the policy has loaded).

| From | Event | To |
|------|-------|----|
| any | select mode in the UI | selected mode |
| `Baseline` / `Learned` | visitor grabs a joint | `Manual` |
| any | Reset | keep the current mode; arm and target return to their defaults |
| `Learned` | policy load fails | `Baseline`, and an error is shown |

**Rules**: A switch never touches `q`, `qd`, or `Target.pos` (FR-012). Entering `Learned` resets
`prevAction` to zeros. Initial mode is `Baseline` from P2 onward and `Manual` in P1.

### PolicyStep (shown in the panel)

| Field | Type | Notes |
|-------|------|-------|
| `obsRaw` | float[31] | observation as defined in [env-spec](./contracts/env-spec.md) |
| `obsNorm` | float[31] | `clip((obsRaw − mean)/std, ±10)` |
| `action` | float[7] | MLP output in [-1, 1] |
| `prevAction` | float[7] | action from the previous step |

Updated at 50 Hz and shown in the panel at display rate. Each field has a label from
`env-spec.json`.

### EvalReport (evaluation output, not shipped)

| Field | Type |
|-------|------|
| `controller` | `"baseline"` \| `"learned"` |
| `seed`, `n` | int |
| `successRate` | float |
| `settleTimeP50`, `settleTimeP95` | float (s) |
| `meanSqTipJerk` | float (m²/s⁶) |
| `perTarget` | array of `{target, success, settleTime}` |

## Static artifacts (single source of truth)

| Artifact | Path | Producer | Consumers |
|----------|------|----------|-----------|
| Robot model | `shared/robot/panda_reach.xml` + `meshes/` | derived once from Menagerie | train, web, parity |
| Env spec | `shared/env-spec.json` | hand-written layout + stats exported by `train/export.py` | train, web, parity |
| Policy weights | `shared/policy/reach.bin` + `reach.json` | `train/export.py` | web, parity |
| Parity fixtures | `shared/parity/*.json` | `train/make_fixtures.py` | web parity tests |

Relationships: `env-spec.json` records the SHA-256 of `panda_reach.xml` and of `reach.bin`; a
mismatch anywhere fails the parity tests.
