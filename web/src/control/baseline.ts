/**
 * Classical baseline (research R6): damped-least-squares differential IK on the tip position.
 * Reactive, no trajectory planning. Every parameter comes from parity.json `baseline`.
 *
 *   Δq = J⁺ · gain · e / Hz + (I − J⁺J) · nullspaceGain · (neutral − q) / Hz,
 *   J⁺ = Jᵀ (J Jᵀ + λ² I)⁻¹,  e = target − tip
 *
 * Δq is added to the joint targets, capped at maxJointSpeed / Hz per joint and clipped to limits.
 * Integrating into the targets (rather than q + Δq) removes the servos' steady-state sag.
 *
 * Out-of-reach targets are replaced by the nearest point the arm should aim at: behind the base
 * (outside the front workspace) they move onto its front boundary, and farther than
 * maxReach − reachStandoff from the shoulder they move to that distance in their direction. The
 * arm then stretches toward them and stops. Aiming at the true
 * target would drive the arm into its stretched-out singularity, where the integrating targets,
 * servo lag and null-space pull settle into a ~1 cm limit cycle.
 */
import type { Arm } from "../sim/arm";
import type { Sim } from "../sim/mujoco";
import type { Parity } from "../sim/parity";
import type { Controller } from "./modes";

/** Inverse of a symmetric positive-definite 3x3 matrix (row-major). */
function inv3(a: Float64Array): Float64Array {
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
  const c0 = a4 * a8 - a5 * a7;
  const c1 = a5 * a6 - a3 * a8;
  const c2 = a3 * a7 - a4 * a6;
  const det = a0 * c0 + a1 * c1 + a2 * c2;
  const d = 1 / det;
  return Float64Array.from([
    c0 * d,
    (a2 * a7 - a1 * a8) * d,
    (a1 * a5 - a2 * a4) * d,
    c1 * d,
    (a0 * a8 - a2 * a6) * d,
    (a2 * a3 - a0 * a5) * d,
    c2 * d,
    (a1 * a6 - a0 * a7) * d,
    (a0 * a4 - a1 * a3) * d,
  ]);
}

/** One DLS step: joint change (n) for Jacobian J (3 x n), error e, and null-space bias b (n). */
export function dlsStep(
  J: Float64Array,
  n: number,
  e: ArrayLike<number>,
  bias: ArrayLike<number>,
  damping: number,
): Float64Array {
  // A = J Jᵀ + λ² I
  const A = new Float64Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      let s = r === c ? damping * damping : 0;
      for (let k = 0; k < n; k++) s += J[r * n + k] * J[c * n + k];
      A[r * 3 + c] = s;
    }
  const Ai = inv3(A);
  // J⁺ = Jᵀ A⁻¹ (n x 3)
  const Jp = new Float64Array(n * 3);
  for (let k = 0; k < n; k++)
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let r = 0; r < 3; r++) s += J[r * n + k] * Ai[r * 3 + c];
      Jp[k * 3 + c] = s;
    }
  // Task term J⁺ e, plus null-space term (I − J⁺J) b = b − J⁺ (J b).
  const Jb = [0, 0, 0];
  for (let r = 0; r < 3; r++) for (let k = 0; k < n; k++) Jb[r] += J[r * n + k] * bias[k];
  const dq = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let task = 0;
    let proj = 0;
    for (let c = 0; c < 3; c++) {
      task += Jp[k * 3 + c] * e[c];
      proj += Jp[k * 3 + c] * Jb[c];
    }
    dq[k] = task + bias[k] - proj;
  }
  return dq;
}

export function createBaselineController(opts: {
  sim: Pick<Sim, "q" | "sitePos" | "jacSiteJoints" | "nu">;
  arm: Arm;
  parity: Parity;
  target: () => ArrayLike<number>;
}): Controller {
  const { sim, arm, parity } = opts;
  const { damping, gain, maxJointSpeed, nullspaceGain, reachStandoff, neutralPose } =
    parity.baseline;
  const reachable = parity.reach.maxReach - reachStandoff;
  const frontY = parity.reach.baseAxisXY[1] - parity.reach.frontMargin;
  const hz = parity.controlHz;
  const n = sim.nu;
  return {
    enter() {},
    step() {
      const tip = sim.sitePos(parity.tipSite);
      const target = Array.from(opts.target());
      // Behind the base is outside the demo workspace: aim at the front boundary instead.
      target[1] = Math.min(target[1], frontY);
      const sh = sim.sitePos(parity.shoulderSite);
      const r = Math.hypot(target[0] - sh[0], target[1] - sh[1], target[2] - sh[2]);
      if (r > reachable)
        for (let i = 0; i < 3; i++) target[i] = sh[i] + ((target[i] - sh[i]) * reachable) / r;
      const q = sim.q();
      const e = [0, 1, 2].map((i) => (gain * (target[i] - tip[i])) / hz);
      const bias = new Float64Array(n);
      for (let i = 0; i < n; i++) bias[i] = (nullspaceGain * (neutralPose[i] - q[i])) / hz;
      const dq = dlsStep(sim.jacSiteJoints(parity.tipSite), n, e, bias, damping);
      arm.applyDelta(dq, maxJointSpeed / hz);
    },
  };
}
