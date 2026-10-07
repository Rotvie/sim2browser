# Contract: UI changes

Spec US1–US3; research R7, R12. Builds on 002's `contracts/ui.md`.

## Mode switch

- Grouped by task (2026-10-07): a "Reach" group (Manual · Baseline · Learned · lab reach
  controllers) and a "Grasp" group (Scripted · Learned · lab grasp controllers), each a segmented
  control with a small group label; the group comes from the registry's `task`, so a new
  controller lands in its group without UI changes. Inside a group a button shows the registry's
  `short` name ("Scripted"); its accessible name is the full label ("Scripted grasp") and its
  tooltip the registry description. The 002 "Grasp" button is now "Scripted grasp" (id `grasp`).
  On narrow screens each group is one row, wrapping if needed.
- "Learned grasp" appears only if `parity.json` has `graspPolicy` (else the page is 002's).
- Must fit a 360 px wide viewport without horizontal scroll (e2e check); if it does not, the two
  grasp buttons shorten to "Grasp: script" / "Grasp: learned".

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
