# Contract: UI changes

Spec US1–US3; research R7, R12. Builds on 002's `contracts/ui.md`.

## Task and controller (2026-10-08, replaces the flat mode switch)

- **Task tabs** under the title: Reach | Grasp (role `tablist`, name "Task"). A first visit opens
  on Reach; `?task=grasp` opens Grasp. Choosing a tab selects that task's engineered controller
  (Grasp: the scripted grasp starts).
- **Slots** in the toolbar, only the current task's (group "Controller"): You · Engineered ·
  Learned (· Lab with `?lab`). Each shows its role and a short name (registry `kind`, `public`,
  `short`); its accessible name is the controller's full name, its tooltip the description.
  - Reach: You = "Manual" (pose the joints), Engineered = Baseline, Learned = RL policy.
  - Grasp: You = "By hand" (the Baseline follows the target, gripper by button or G),
    Engineered = Scripted grasp, Learned = Learned grasp (only when a grasp policy is shipped).
  - A new controller appears in its task from its registry entry alone.
- **The scene follows the task**: the target is shown and draggable in Reach and in Grasp by hand
  only (hidden while a grasp controller runs; taking over is the "By hand" slot, or a joint grab);
  the gripper button (and key G) only in Grasp; "Policy view" only where the task has a learned
  policy, showing that task's policy; the subtitle names the task.
- When the worker changes mode itself (gripper press or joint grab during a grasp), the task stays
  and the "You" slot lights up.
- Narrow screens: tabs under the title, slots one row (two-line buttons).

## Grasp status card (002, extended)

- Shown while a grasp controller is selected. Title = controller label.
- Phase line: scripted shows its phases; learned shows "Running" then the outcome.
- Outcome: "Lifted in 4.6 s" or "Failed: <reason>" (same wording as 002).
- New **Retry** button (after an outcome): the visitor's cube placement (default after a reset, or
  the last cube drag), arm reset, starts the selected grasp controller. Switching between Scripted and Learned grasp then Retry = side-by-side
  comparison on one placement (FR-010).

## Policy view

- With Learned grasp active: the 32 grasp inputs grouped by field labels from `parity.json`, and
  the 6 outputs ("Joint changes" ×5, "Gripper" shown as open/close).

## Info panel, grasp section

- Table: controller · lifted · median time to lift · failures, one row per grasp controller on
  the page that has a committed report (`shared/grasp-eval/<id>.json`); lab controllers (with
  `?lab`) are tagged "lab". Measuring a new grasp controller is all it takes to get a row.
- Line under the table: "Learned grasp: behavior cloning from N scripted and M hand
  demonstrations (hand share X%); 3 training runs, the shipped one chosen on separate
  placements." Values from `grasp.json trainedWith` and `metrics`.
- If the learned grasp is weaker, the gap stays visible (no hiding behind the better number).

## Recording mode (`?record`, not linked anywhere)

Card in the panel area:

```text
Recording  ·  next placement #7 (seed 2000)
[Start]  [Stop]
Last: lifted in 18.2 s (hand)      [Keep] [Discard]
Kept: hand 6 lifted / 1 failed · scripted 2 lifted
[Save file]           Kept episodes are lost on reload.
```

- Start: cube to the next placement, attempt starts; the demonstrator drives (drag target,
  gripper button, joint grabs) or presses "Scripted grasp" to record a scripted episode.
- Ends on lift held 1 s (+0.5 s), 60 s, or Stop; then Keep / Discard.
- Save: downloads `hand-YYYYMMDD-HHMM.demos.jsonl.gz`.
- Without `?record`: no recording card, no recording code path active (US1 scenario 5).

## Worker protocol additions

Main → worker: `{type: "record", action: "start" | "stop" | "keep" | "discard" | "save"}`,
`{type: "retry"}`. Worker → main: `{type: "record-status", ...counts, last}`,
`{type: "record-file", bytes: ArrayBuffer}` (gzipped, transferred).
