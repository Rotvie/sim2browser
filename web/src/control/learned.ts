/**
 * Learned controller: observation → normalize → MLP → joint-target change, exactly as in training
 * (training/reach/env.py step).
 */
import type { Arm } from "../sim/arm";
import type { Sim } from "../sim/mujoco";
import { buildObs, normalize } from "../sim/observation";
import type { Parity } from "../sim/parity";
import type { Controller } from "./modes";
import type { Policy } from "./policy";

export interface PolicyStep {
  obsRaw: Float64Array;
  obsNorm: Float64Array;
  action: Float64Array;
  prevAction: Float64Array;
}

export interface LearnedController extends Controller {
  /** The step the policy took last (while active). */
  last(): PolicyStep | null;
  /** What the policy would do now, without acting (for display in other modes). */
  peek(): PolicyStep;
}

export function createLearnedController(opts: {
  sim: Pick<Sim, "q" | "qd" | "sitePos" | "nu">;
  arm: Arm;
  parity: Parity;
  policy: Policy;
  target: () => ArrayLike<number>;
}): LearnedController {
  const { sim, arm, parity, policy } = opts;
  const norm = parity.observation.normalization;
  if (!norm) throw new Error("parity.json has no observation normalization");
  const deltaScale = parity.action.deltaScale;
  let prevAction = new Float64Array(sim.nu);
  let last: PolicyStep | null = null;

  const evaluate = (): PolicyStep => {
    const obsRaw = buildObs(
      {
        q: sim.q(),
        qd: sim.qd(),
        target: opts.target(),
        tip: sim.sitePos(parity.tipSite),
        prevAction,
      },
      parity,
    );
    const obsNorm = normalize(obsRaw, norm);
    return {
      obsRaw,
      obsNorm,
      action: policy.forward(obsNorm),
      prevAction: Float64Array.from(prevAction),
    };
  };

  return {
    enter() {
      prevAction = new Float64Array(sim.nu);
      last = null;
    },
    step() {
      const s = evaluate();
      const delta = s.action.map((a) => a * deltaScale);
      arm.applyDelta(delta, deltaScale);
      prevAction = Float64Array.from(s.action);
      last = s;
    },
    last: () => last,
    peek: evaluate,
  };
}
