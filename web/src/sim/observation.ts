/**
 * Policy observation, in exactly the parity.json `observation.fields` order (mirrors
 * training/reach/env.py build_obs). Field slices come from parity.json, never hard-coded.
 */
import type { Parity } from "./parity";

export interface ObsInputs {
  q: ArrayLike<number>;
  qd: ArrayLike<number>;
  target: ArrayLike<number>;
  tip: ArrayLike<number>;
  prevAction: ArrayLike<number>;
}

export function buildObs(x: ObsInputs, parity: Pick<Parity, "observation">): Float64Array {
  const values: Record<string, ArrayLike<number>> = {
    q: x.q,
    qd: x.qd,
    target: x.target,
    tipToTarget: [x.target[0] - x.tip[0], x.target[1] - x.tip[1], x.target[2] - x.tip[2]],
    prevAction: x.prevAction,
  };
  const out = new Float64Array(parity.observation.size);
  let off = 0;
  for (const f of parity.observation.fields) {
    const v = values[f.name];
    if (!v || v.length !== f.size) throw new Error(`observation field ${f.name}: bad size`);
    for (let i = 0; i < f.size; i++) out[off + i] = v[i];
    off += f.size;
  }
  return out;
}

export type Normalization = NonNullable<Parity["observation"]["normalization"]>;

/** clip((obs − mean) / max(std, eps), ±clip), as SB3 VecNormalize. */
export function normalize(obs: ArrayLike<number>, norm: Normalization): Float64Array {
  const out = new Float64Array(obs.length);
  for (let i = 0; i < obs.length; i++) {
    const z = (obs[i] - norm.mean[i]) / Math.max(norm.std[i], norm.eps);
    out[i] = Math.min(norm.clip, Math.max(-norm.clip, z));
  }
  return out;
}
