/**
 * Policy observations, in exactly the parity.json field order (mirrors training/reach/env.py
 * build_obs for the reach policy and training/reach/demos.py grasp_obs for the grasp policy).
 * Field slices come from parity.json, never hard-coded.
 */
import { cubeYaw } from "./cube";
import type { Parity } from "./parity";

export interface ObsInputs {
  q: ArrayLike<number>;
  qd: ArrayLike<number>;
  target: ArrayLike<number>;
  tip: ArrayLike<number>;
  prevAction: ArrayLike<number>;
}

type Field = { name: string; size: number };

/** Concatenate named values in field order, checking each size. */
function assemble(
  fields: readonly Field[],
  values: Record<string, ArrayLike<number>>,
): Float64Array {
  const out = new Float64Array(fields.reduce((n, f) => n + f.size, 0));
  let off = 0;
  for (const f of fields) {
    const v = values[f.name];
    if (!v || v.length !== f.size) throw new Error(`observation field ${f.name}: bad size`);
    for (let i = 0; i < f.size; i++) out[off + i] = v[i];
    off += f.size;
  }
  return out;
}

/** The reach policy's observation (001). */
export function buildObs(x: ObsInputs, parity: Pick<Parity, "observation">): Float64Array {
  const out = assemble(parity.observation.fields, {
    q: x.q,
    qd: x.qd,
    target: x.target,
    tipToTarget: [x.target[0] - x.tip[0], x.target[1] - x.tip[1], x.target[2] - x.tip[2]],
    prevAction: x.prevAction,
  });
  if (out.length !== parity.observation.size) throw new Error("observation size mismatch");
  return out;
}

export interface GraspObsInputs {
  /** All arm joints (parity.joints order) and their speeds. */
  q: ArrayLike<number>;
  qd: ArrayLike<number>;
  jaw: number;
  tip: ArrayLike<number>;
  cubePos: ArrayLike<number>;
  cubeQuat: ArrayLike<number>;
  prevAction: ArrayLike<number>;
}

/**
 * The grasp policy's observation (004 research R5). The cube looks the same every quarter turn,
 * so its yaw enters as sin/cos of 4 × yaw, absolute and relative to the jaws' closing axis
 * (gripper yaw = Rotation + Wrist_Roll − rollOffset, parity.json grasp.rollOffset), and relative
 * to where the jaws will point once the arm faces the cube (Rotation = the cube's bearing from
 * the base axis): zero there means the wrist roll is right for a top-down grasp.
 */
export function buildGraspObs(
  x: GraspObsInputs,
  fields: readonly Field[],
  geom: { rollOffset: number; baseAxisXY: ArrayLike<number> },
): Float64Array {
  const yaw = cubeYaw(x.cubeQuat);
  const rel = yaw - (x.q[0] + x.q[4] - geom.rollOffset);
  const bearing = Math.atan2(
    x.cubePos[0] - geom.baseAxisXY[0],
    -(x.cubePos[1] - geom.baseAxisXY[1]),
  );
  const face = yaw - (bearing + x.q[4] - geom.rollOffset);
  return assemble(fields, {
    q: x.q,
    qd: x.qd,
    jaw: [x.jaw],
    tip: x.tip,
    cube: x.cubePos,
    cubeToTip: [x.tip[0] - x.cubePos[0], x.tip[1] - x.cubePos[1], x.tip[2] - x.cubePos[2]],
    cubeYaw4: [Math.sin(4 * yaw), Math.cos(4 * yaw)],
    relYaw4: [Math.sin(4 * rel), Math.cos(4 * rel)],
    faceYaw4: [Math.sin(4 * face), Math.cos(4 * face)],
    prevAction: x.prevAction,
  });
}

export type Normalization = NonNullable<Parity["observation"]["normalization"]>;

/** clip((obs − mean) / max(std, eps), ±clip), as SB3 VecNormalize. */
export function normalize(
  obs: ArrayLike<number>,
  norm: Pick<Normalization, "mean" | "std" | "clip" | "eps">,
): Float64Array {
  const out = new Float64Array(obs.length);
  for (let i = 0; i < obs.length; i++) {
    const z = (obs[i] - norm.mean[i]) / Math.max(norm.std[i], norm.eps);
    out[i] = Math.min(norm.clip, Math.max(-norm.clip, z));
  }
  return out;
}
