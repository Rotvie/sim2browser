# Contract: main thread ↔ sim worker messages

The worker owns MuJoCo, the controllers, and the policy. The main thread owns rendering, input,
and UI (research R8). All messages are `postMessage` with a `type` field. Arrays travel as
transferable `Float64Array`s.

## Main → worker

| `type` | Payload | Effect |
|--------|---------|--------|
| `init` | `{ baseUrl }` | load the engine and, in parallel, `parity.json`, XML, meshes and workspace grid; verify; create the sim; reply `ready` or `error`. Sent by the boot script before the app chunk (three.js) loads |
| `setTarget` | `{ pos: [x,y,z] }` | clamp and set the target position |
| `dragJoint` | `{ joint: i, angle }` | switch to Manual; set `ctrl[i]` = angle clipped to limits |
| `setMode` | `{ mode: "manual" \| "baseline" \| "learned" }` | switch controller; no state reset |
| `reset` | `{}` | default pose and target; keep the mode |
| `visibility` | `{ hidden: bool }` | pause/resume; reset the clock |

## Worker → main

| `type` | Payload | Rate |
|--------|---------|------|
| `ready` | `{ joints, limits, bodyJoint, bodyNames, bodyParent, geoms, neutralPose, maxReach, modes }` (geoms carry mesh vertices/faces from the compiled model for rendering) | once |
| `snapshot` | `{ t, bodyPos: Float64Array, bodyQuat: Float64Array, q, qd, ctrl, tip, jointAnchor, jointAxis, mode, target?, reachable?, policyStep? }` (target fields from P2) | each control step (50 Hz), coalesced to the latest if the main thread lags |
| `modeChanged` | `{ mode, reason? }` | on change (e.g. `"joint-grab"`, `"policy-load-failed"`) |
| `error` | `{ code, message }` | on failure (`asset-load`, `version-mismatch`, `hash-mismatch`) |

`policyStep` = `{ obsRaw, obsNorm, action, prevAction }`, sent while Learned is active (and computed
for display in other modes, see ui.md).

## Rules

- The worker never waits on the main thread; the main thread renders the latest snapshot and
  interpolates between the last two.
- Sim and control modules do not import any worker or DOM API; `worker.ts` is a thin adapter.
  This lets tests and evaluation run the same modules in Node.
