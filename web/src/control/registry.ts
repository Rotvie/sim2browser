/**
 * The controller registry: every automatic controller the demo can run.
 *
 * To add your own: write a file exporting a ControllerDef (see jacobianTranspose.ts for a
 * complete ~40-line example) and add it to CONTROLLERS below. It then appears in the mode switch
 * (public ones always, the others with `?lab` in the URL) and in the headless evaluation:
 *
 *   npm run eval -- --controller <id>
 *   npm run eval:compare -- --controller <id>
 */
import type { Arm } from "../sim/arm";
import type { CubePose } from "../sim/cube";
import type { Gripper } from "../sim/gripper";
import type { Sim } from "../sim/mujoco";
import type { Parity, ReadBytes } from "../sim/parity";
import { createBaselineController } from "./baseline";
import { createGraspController } from "./grasp";
import { jacobianTranspose } from "./jacobianTranspose";
import { createLearnedController } from "./learned";
import type { Controller } from "./modes";
import { loadPolicy } from "./policy";

/** Everything a controller may use. Joint targets are written only through `arm`. */
export interface ControllerContext {
  sim: Sim;
  /** Joint targets: `arm.applyDelta(delta, maxPerStep)` clips to speed and joint limits. */
  arm: Arm;
  /** shared/parity.json: rates, limits, joint names, observation layout, baseline gains. */
  parity: Parity;
  /** The target the visitor drags (world frame, meters). */
  target(): ArrayLike<number>;
  /** Read a file from shared/ (e.g. policy weights). */
  read: ReadBytes;
  /** The gripper command (open / closed); reaching controllers leave it to the visitor. */
  gripper: Gripper;
  /** The cube's pose, and whether both jaws hold it. */
  cube: { pose(): CubePose; held(): boolean };
}

export interface ControllerDef {
  /** Stable id: used in the URL-free mode switch, eval CLI and reports. */
  id: string;
  /** Short label for the mode switch. */
  label: string;
  /** One or two sentences for the info panel. */
  description: string;
  /** Shown on the public page; otherwise only with `?lab` in the URL. */
  public: boolean;
  /** Create at startup (must then be synchronous). Otherwise created on first selection. */
  preload?: boolean;
  /** Whether this build can offer it (e.g. a policy was exported). Default: yes. */
  available?(parity: Parity): boolean;
  create(ctx: ControllerContext): Controller | Promise<Controller>;
}

export const baseline: ControllerDef = {
  id: "baseline",
  label: "Baseline",
  description:
    "Damped least-squares inverse kinematics: a classical reactive controller with no learning.",
  public: true,
  preload: true,
  create: ({ sim, arm, parity, target }) => createBaselineController({ sim, arm, parity, target }),
};

export const learned: ControllerDef = {
  id: "learned",
  label: "Learned",
  description: "A PPO policy trained in the same simulation, rewarded for reaching smoothly.",
  public: true,
  available: (parity) => !!parity.policy,
  // Loads and hash-verifies the policy on first use; it is not needed before interactive.
  create: async ({ sim, arm, parity, target, read }) =>
    createLearnedController({ sim, arm, parity, target, policy: await loadPolicy(read, parity) }),
};

export const grasp: ControllerDef = {
  id: "grasp",
  label: "Grasp",
  description:
    "Scripted top-down grasp built on the baseline: approach, descend, close, lift. No learning.",
  public: true,
  create: ({ sim, arm, parity, gripper, cube }) =>
    createGraspController({ sim, arm, parity, gripper, cube }),
};

/** Order = order in the mode switch (after Manual). */
export const CONTROLLERS: ControllerDef[] = [baseline, learned, grasp, jacobianTranspose];
