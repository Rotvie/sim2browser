/**
 * Joint targets for the position actuators. Every controller writes ctrl only through here, so
 * "ctrl[i] is always clipped to limits[i]" (FR-005) holds for every mode.
 */
import type { Sim } from "./mujoco";

export interface Arm {
  readonly n: number;
  readonly limits: Float64Array;
  setJointTarget(i: number, angle: number): void;
  /** ctrl = clip(ctrl + clip(delta, ±maxPerStep), min, max) */
  applyDelta(delta: ArrayLike<number>, maxPerStep: number): void;
  setTargets(q: ArrayLike<number>): void;
}

const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createArm(sim: Pick<Sim, "nu" | "limits" | "ctrl" | "setCtrl">): Arm {
  const { nu: n, limits } = sim;
  const clipJoint = (i: number, v: number) => clip(v, limits[2 * i], limits[2 * i + 1]);

  return {
    n,
    limits,
    setJointTarget(i, angle) {
      const c = sim.ctrl();
      c[i] = clipJoint(i, angle);
      sim.setCtrl(c);
    },
    applyDelta(delta, maxPerStep) {
      const c = sim.ctrl();
      for (let i = 0; i < n; i++)
        c[i] = clipJoint(i, c[i] + clip(delta[i], -maxPerStep, maxPerStep));
      sim.setCtrl(c);
    },
    setTargets(q) {
      const c = new Float64Array(n);
      for (let i = 0; i < n; i++) c[i] = clipJoint(i, q[i]);
      sim.setCtrl(c);
    },
  };
}
