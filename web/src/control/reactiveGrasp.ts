/**
 * Reactive grasp (004 DAgger expert): the scripted grasp's motion as a function of the current
 * state only (cube pose, tip, jaw, gripper command), with no phases, timers or moving goal point.
 * The scripted grasp (grasp.ts) stays the shipped baseline; this one exists so that any state the
 * learned grasp visits has a label (`reactiveAction`), which DAgger needs. Registered as a lab
 * grasp controller, so it is evaluated like any plug-in.
 *
 *   gripper closed, cube held, jaw target closed  → lift to liftHeight
 *   gripper closed, jaw shut on nothing           → open (missed), back to the approach point
 *   gripper closed otherwise                      → keep closing at the grasp point
 *   gripper open, at the grasp point, aligned     → close
 *   gripper open, above the grasp point, aligned  → descend
 *   otherwise                                     → go to the approach point, turn the wrist, open
 *
 * Speeds match the scripted grasp's: the goal leads the tip by speed / gain, the steady-state lag
 * of the scripted grasp's moving goal under the same DLS gain.
 */
import type { CubePose } from "../sim/cube";
import type { Gripper } from "../sim/gripper";
import type { Sim } from "../sim/mujoco";
import type { GripperCommand, Parity } from "../sim/parity";
import { planTopDown, topDownDelta } from "./grasp";
import type { ControllerDef } from "./registry";

/** Tip within this of the grasp point: close (m), as the scripted grasp's AT_GOAL. */
const AT_GOAL = 0.005;
/** Above the grasp point within this horizontally: descend (m). */
const ABOVE = 0.015;
/** Wrist roll within this of its target counts as aligned (rad). */
const ROLL_OK = 0.01;

export interface ReactiveState {
  sim: Pick<Sim, "ctrl" | "sitePos" | "jacSiteJoints" | "nu" | "limits" | "jaw" | "jawTarget">;
  parity: Parity;
  gripper: Pick<Gripper, "command">;
  cube: { pose(): CubePose; held(): boolean };
}

/** The expert's joint-target change and gripper command for the current state. */
export function reactiveAction({ sim, parity, gripper, cube }: ReactiveState): {
  delta: Float64Array;
  grip: GripperCommand;
} {
  const g = parity.grasp;
  const { open, closed } = parity.gripper;
  const restZ = parity.cube.size / 2;
  const pose = cube.pose();
  // Plan on the cube's resting pose (it may be in the jaws, above the floor).
  const plan = planTopDown({ pos: [pose.pos[0], pose.pos[1], restZ], quat: pose.quat }, parity, [
    sim.limits[8],
    sim.limits[9],
  ]);
  const tip = sim.sitePos(parity.tipSite);
  const jaw = sim.jaw();
  const roll = sim.ctrl()[4];
  let dest: ArrayLike<number> = plan.approachPt;
  let speed = g.approachSpeed;
  let grip: GripperCommand = "open";

  if (gripper.command === "closed") {
    grip = "closed";
    if (cube.held()) {
      if (sim.jawTarget() <= closed + 1e-9) {
        dest = [plan.graspPt[0], plan.graspPt[1], restZ + g.liftHeight];
        speed = g.liftSpeed;
      } else dest = tip; // still squeezing
    } else if (jaw <= closed + 0.05) {
      grip = "open"; // shut on nothing: missed
    } else {
      dest = plan.graspPt;
      speed = g.descendSpeed;
    }
  } else {
    const aligned = jaw > open - 0.1 && Math.abs(roll - plan.roll) < ROLL_OK;
    const d = Math.hypot(
      tip[0] - plan.graspPt[0],
      tip[1] - plan.graspPt[1],
      tip[2] - plan.graspPt[2],
    );
    const dxy = Math.hypot(tip[0] - plan.graspPt[0], tip[1] - plan.graspPt[1]);
    if (aligned && d < AT_GOAL) {
      grip = "closed";
      dest = plan.graspPt;
      speed = g.descendSpeed;
    } else if (aligned && dxy < ABOVE && tip[2] <= plan.approachPt[2] + 0.01) {
      dest = plan.graspPt;
      speed = g.descendSpeed;
    }
  }

  // The goal leads the tip by speed / gain toward dest (the scripted grasp's steady-state lag).
  const e = [0, 1, 2].map((i) => dest[i] - tip[i]);
  const len = Math.hypot(e[0], e[1], e[2]);
  const lead = speed / parity.baseline.gain;
  const k = len > lead ? lead / len : 1;
  const goal = [0, 1, 2].map((i) => tip[i] + e[i] * k);
  return { delta: topDownDelta(sim, parity, goal, plan.roll), grip };
}

export const reactiveGrasp: ControllerDef = {
  id: "reactive-grasp",
  label: "Reactive grasp",
  short: "Reactive script",
  description:
    "The scripted grasp as a function of the current state only (no phases or timers): the expert that labels the learned grasp's training data (DAgger).",
  task: "grasp",
  public: false,
  create: ({ sim, arm, parity, gripper, cube }) => {
    const maxPerStep = parity.baseline.maxJointSpeed / parity.controlHz;
    return {
      enter() {},
      step() {
        const { delta, grip } = reactiveAction({ sim, parity, gripper, cube });
        arm.applyDelta(delta, maxPerStep);
        gripper.set(grip);
      },
    };
  },
};
