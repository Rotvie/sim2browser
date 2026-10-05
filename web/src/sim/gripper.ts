/**
 * The gripper: a binary command (open / closed) that moves the jaw target toward its setpoint at
 * `gripper.maxSpeed`. The only writer of the jaw target (data-model "Gripper command"). Closing
 * on the cube makes the position servo squeeze it (research R3).
 */
import type { Sim } from "./mujoco";
import type { GripperCommand, Parity } from "./parity";

export interface Gripper {
  readonly command: GripperCommand;
  set(command: GripperCommand): void;
  /** One control step: move the jaw target toward the command. */
  step(): void;
  reset(): void;
}

export function createGripper(
  sim: Pick<Sim, "jawTarget" | "setJawTarget">,
  parity: Parity,
): Gripper {
  const g = parity.gripper;
  const maxPerStep = g.maxSpeed / parity.controlHz;
  let command: GripperCommand = g.default;
  return {
    get command() {
      return command;
    },
    set(c) {
      command = c;
    },
    step() {
      const goal = command === "open" ? g.open : g.closed;
      const cur = sim.jawTarget();
      sim.setJawTarget(cur + Math.min(maxPerStep, Math.max(-maxPerStep, goal - cur)));
    },
    reset() {
      command = g.default;
    },
  };
}
