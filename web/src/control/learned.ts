/**
 * Learned controller: observation → normalize → MLP → joint-target change, exactly as in training
 * (training/reach/env.py step). The policy observes and moves only parity.json `action.joints`;
 * the other joints (Wrist_Roll) keep their targets.
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
  const idx = parity.action.joints.map((j) => parity.joints.indexOf(j));
  const pick = (v: ArrayLike<number>) => idx.map((i) => v[i]);
  let prevAction = new Float64Array(idx.length);
  let last: PolicyStep | null = null;

  const evaluate = (): PolicyStep => {
    const obsRaw = buildObs(
      {
        q: pick(sim.q()),
        qd: pick(sim.qd()),
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
      prevAction = new Float64Array(idx.length);
      last = null;
    },
    step() {
      const s = evaluate();
      const delta = new Float64Array(sim.nu);
      idx.forEach((j, i) => (delta[j] = s.action[i] * deltaScale));
      arm.applyDelta(delta, deltaScale);
      prevAction = Float64Array.from(s.action);
      last = s;
    },
    last: () => last,
    peek: evaluate,
    inspect: (active) => (active ? last : null) ?? evaluate(),
  };
}
