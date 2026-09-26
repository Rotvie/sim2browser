import type { Arm } from "../sim/arm";
import type { Controller } from "./modes";

export interface ManualController extends Controller {
  /** Joint target requested by the visitor (clipped to limits by the Arm on the way to ctrl). */
  setGoal(i: number, angle: number): void;
  resetGoal(q: ArrayLike<number>): void;
}

/**
 * Manual mode: joint targets move toward the visitor's requested angles at no more than the shared
 * joint-speed limit, like every other controller. Instant jumps would slam joints into their
 * (soft) limits and overshoot them by up to 0.1 rad.
 */
export function createManualController(
  arm: Arm,
  ctrl: () => Float64Array,
  maxPerStep: number,
): ManualController {
  const goal = Float64Array.from(ctrl());
  return {
    enter() {
      goal.set(ctrl());
    },
    step() {
      const c = ctrl();
      const delta = new Float64Array(goal.length);
      for (let i = 0; i < goal.length; i++) delta[i] = goal[i] - c[i];
      arm.applyDelta(delta, maxPerStep);
    },
    setGoal(i, angle) {
      goal[i] = Math.min(arm.limits[2 * i + 1], Math.max(arm.limits[2 * i], angle));
    },
    resetGoal(q) {
      goal.set(q);
    },
  };
}
