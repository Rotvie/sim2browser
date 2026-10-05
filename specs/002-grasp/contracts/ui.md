# Contract: UI additions

Delta against [001's UI contract](../../001-arm-reach/contracts/ui.md). Everything there still
holds.

## Toolbar

| Control | Behavior |
|---------|----------|
| Gripper button | Action button: its label says what a click does and follows the command: "Open gripper" when closed, "Close gripper" when open (short labels "Open" / "Close" on narrow screens). Key `G`. No `aria-pressed` (the label already changes). Enabled in every mode; in `grasp` mode a press cancels the attempt (switch to `baseline`, reason `user`) and then applies |
| Mode switch | New public entry "Grasp" after Learned: Manual · Baseline · Learned · Grasp |

## Scene

| Element | Behavior |
|---------|----------|
| Cube | Orange 30 mm box, rendered from the model geom. Pickable when not held: drag moves it on the floor (mouse and one-finger touch), cursor `grab`. While dragging, a ring on the floor shows the grasp region; the ring turns orange when the cube is outside it |
| Collision geoms | Never rendered (group 3) |

## Grasp status chip (visible in `grasp` mode)

| Phase | Text |
|-------|------|
| `approach` / `descend` / `close` / `lift` / `hold` | "Approaching" / "Descending" / "Closing" / "Lifting" / "Holding" |
| `done` | "Lifted ✓" + "Grasp again" |
| `failed` | "Failed: <reason in words>" + "Grasp again" (e.g. "cube slipped", "cube out of reach") |

"Grasp again" sends `regrasp`.

## Info panel

New section "Scripted grasp", loaded from `grasp-eval.json` on first open: how the grasp works
(4 short sentences, phases), success rate with target "(target ≥ 90%)" in ok/miss style as 001,
median time to lift "(target ≤ 6 s)", failure counts by reason, sample size and success
definition. The 001 learned-policy numbers show the re-measured values on the new model.

## Hint

First-visit hint (001) unchanged; after the first target drag, a one-time hint points at the
gripper button: "Close the gripper around the cube".
