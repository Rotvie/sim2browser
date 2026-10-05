# Contract: main thread ↔ sim worker messages

Delta against [001's contract](../../001-arm-reach/contracts/worker-protocol.md). Unlisted
messages are unchanged.

## Main → worker (added)

| `type` | Payload | Effect |
|--------|---------|--------|
| `setGripper` | `{ command: "open" \| "closed" }` | set the gripper command; works in every mode; no mode change |
| `setCube` | `{ pos: [x, y], yaw?: number }` | place the cube on the floor (clamped, zero velocity); ignored while the cube is held |
| `regrasp` | `{}` | in `grasp` mode: start a new attempt from the current state |

## Main → worker (changed)

| `type` | Change |
|--------|--------|
| `setTarget` | in `grasp` mode, switches to `baseline` first (reason `target-drag`) |
| `setMode` | `"grasp"` starts an attempt |
| `reset` | also restores the gripper command (`gripper.default`) and the cube (`cube.defaultPose`) |

## Worker → main (changed)

| `type` | Added fields |
|--------|--------------|
| `ready` | `gripper` (parity.json section), `cube` (`size`, `body`), `graspRegion`; `geoms` entries gain `type`, `size` and `group` so the renderer can draw the cube box and skip collision geoms (group 3) |
| `snapshot` | `jaw`, `gripper` (command), `cube: { pos, quat, held, graspable }`, `grasp?: { phase, failure }` (present in `grasp` mode) |
| `modeChanged` | new reason `"target-drag"` |
