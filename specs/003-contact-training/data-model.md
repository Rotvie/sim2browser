# Data Model: Contact-Robust Training

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

Training-side entities (Python, not shipped) and the evaluation report additions.

## Episode setup (training env reset)

| Field | Type | Rule |
|-------|------|------|
| `cube` | pose | p = 0.2: `cube.defaultPose`; else yaw ∈ [0, π/2), centre with r ∈ [0.08, 0.40] m from the base axis and \|angle\| ≤ 80° (uniform by area) |
| `startPose` | float[5] | 001 sampling (50% uniform, 50% neutral + N(0, 0.1)); resampled until no arm geom has a contact with dist < −0.001 against the floor or the cube |
| `target` | float[3] | 001 sampling (`evalMinZ` for reachable ones); resampled while inside the cube's box grown by 0.04 m |

**Rules**: at most 100 attempts per field, else raise (a setup bug, never silently accepted).

## Reward terms (per control step)

Unchanged 001 terms, plus:

| Term | Value | Notes |
|------|-------|-------|
| jerk | −w_jerk · min(‖jerk‖², `jerk_cap`) | `jerk_cap` 5,000 (m²/s⁶); scaled by `penalty_scale` as before |
| floor | −w_floor · [any arm geom touches the floor] | `w_floor` 1.0; not scaled by `penalty_scale` |
| cube | −w_cube · [any arm geom touches the cube] | `w_cube` 0.5; not scaled |

Step `info` gains `floor` (bool), `cube_contact` (bool), `jerk_sq_raw` (uncapped, for logging).

## Penalty ramp (stage a)

State: `penalty_scale` ∈ [0, 1], starts at 0. After each rollout: if mean `dist` ≤ `gate_dist`
(0.15 m), `penalty_scale ← min(1, penalty_scale + ramp_step)` with `ramp_step` such that 0 → 1
takes ≥ 25% of stage a; otherwise unchanged. Never decreases. Logged as `reach/penalty_scale`.

## Evaluation report additions (`EvalReport`, both sides)

| Field | Type | Meaning |
|-------|------|---------|
| `floorContactRate` | float | fraction of episodes with any arm–floor contact |
| `cubeMovedRate` | float | fraction of episodes where the cube moved > 0.01 m |
| `perTarget[].floor`, `perTarget[].cubeMoved` | bool | per episode |
