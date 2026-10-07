# Contract: grasp controller plug-in interface

Spec FR-023, FR-024, SC-010; research R7, R11. Extends 001's controller registry
(`web/src/control/registry.ts`).

## Registering a grasp controller

```ts
export const myGrasp: ControllerDef = {
  id: "my-grasp",
  label: "My grasp",
  description: "One or two sentences for the info panel.",
  task: "grasp",          // new; default "reach"
  public: false,          // lab-only until it has numbers
  create: (ctx) => createMyGrasp(ctx),
};
// registry.ts
export const CONTROLLERS = [baseline, learned, grasp, learnedGrasp, jacobianTranspose, naiveGrasp, myGrasp];
```

That is the whole integration. Nothing else in the page, session, recorder or evaluation changes.

## What a grasp controller gets (`ControllerContext`, unchanged)

`sim`, `arm` (joint targets, clipped), `parity`, `target()`, `read`, `gripper` (open/closed),
`cube.pose()`, `cube.held()`.

## What it must do (`Controller`)

- `enter()`: an attempt starts from the current state (cube already placed and graspable).
- `step()`: one 50 Hz control step; write joint targets only via `arm`, the jaw only via
  `gripper`.
- Optional `graspState()`: its own phase and an early failure (`{phase, failure, liftTime}`), for
  display. It does not decide the outcome.
- Optional `inspect()`: inputs/outputs for the policy view.

## What the session does for every `task: "grasp"` controller

- Attempt monitor (research R7): refuses non-graspable placements (`not-graspable`, controller
  not stepped), judges success with `GraspJudge` (002's definition), classifies failures, ends
  the attempt at the time limit. `snapshot().grasp` = `{controller, phase, outcome, failure,
  liftTime}`.
- Target drag or gripper press: Baseline takes over from the current state (002 behavior, now by
  task instead of id).
- Retry: same placement, reset arm, start the selected grasp controller.

## Evaluation

```text
npm run eval:grasp --workspace web -- --controller <id> [--n 100] [--seed 0] [--check]
```

Runs any registered grasp controller on the placement set; writes
`shared/grasp-eval/<id>.json` ([grasp-eval.md](./grasp-eval.md)). Unknown id or a reach
controller → exit 2 with a message.

## Recording

Any grasp controller can drive a recorded episode (`npm run demos -- --controller <id>`), so a
future controller can also serve as a demonstrator.

## Proof (SC-010)

`web/src/control/naiveGrasp.ts`: lab-only, ~40 lines, top-down grasp without wrist alignment
(the scripted grasp minus the Wrist_Roll step). A unit test registers it, runs `eval:grasp
--controller naive-grasp --n 20`, and checks a report is produced; a review check confirms the
change touched only that file and one registry line.
