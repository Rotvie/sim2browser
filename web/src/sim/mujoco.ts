/**
 * Thin wrapper over @mujoco/mujoco. No DOM or worker APIs: runs in the sim worker and in Node
 * (parity tests, evaluation).
 */
import loadMujoco from "@mujoco/mujoco";
import type { MainModule, MjData, MjModel } from "@mujoco/mujoco";
import type { Parity } from "./parity";

export type Mujoco = MainModule;

let modulePromise: Promise<Mujoco> | undefined;

export function getMujoco(): Promise<Mujoco> {
  modulePromise ??= loadMujoco() as Promise<Mujoco>;
  return modulePromise;
}

export interface MeshData {
  vert: Float32Array;
  face: Int32Array;
}

export interface GeomInfo {
  body: number;
  mesh: MeshData | null;
  pos: Float64Array;
  quat: Float64Array;
  rgba: Float32Array;
}

export interface Sim {
  readonly mj: Mujoco;
  readonly model: MjModel;
  readonly data: MjData;
  readonly nu: number;
  readonly nbody: number;
  /** [min, max] per controlled joint, in parity.joints order. */
  readonly limits: Float64Array;
  /** Joint index (in parity.joints order) that moves each body, or -1 (base / welded). */
  readonly bodyJoint: Int32Array;
  readonly bodyNames: string[];
  readonly bodyParent: Int32Array;
  time(): number;
  q(): Float64Array;
  qd(): Float64Array;
  ctrl(): Float64Array;
  setCtrl(ctrl: ArrayLike<number>): void;
  stepPhysics(n: number): void;
  sitePos(name: string): Float64Array;
  /** Body world positions (nbody*3) and quaternions (nbody*4, w-first), copied. */
  bodyPoses(): { pos: Float64Array; quat: Float64Array };
  /** World anchors and axes of the controlled joints (n*3 each), from the current state. */
  jointFrames(): { anchor: Float64Array; axis: Float64Array };
  /** Translational site Jacobian (3 x nv, row-major), current state. */
  jacSite(name: string): Float64Array;
  /** Set joint positions, zero velocities, ctrl = q; recompute derived quantities. */
  resetToPose(q: ArrayLike<number>): void;
  geoms(): GeomInfo[];
  dispose(): void;
}

export function createSim(mj: Mujoco, parity: Parity, files: ReadonlyMap<string, Uint8Array>): Sim {
  const vfs = new mj.MjVFS();
  const modelDir = parity.model.path.slice(0, parity.model.path.lastIndexOf("/") + 1);
  for (const [path, bytes] of files) {
    // MuJoCo resolves meshdir="assets/" relative to the XML's directory.
    vfs.addBuffer(path.startsWith(modelDir) ? path.slice(modelDir.length) : path, bytes);
  }
  const model = mj.MjModel.mj_loadXML(parity.model.path.slice(modelDir.length), vfs);
  vfs.delete();
  const data = new mj.MjData(model);

  if (model.opt.timestep !== parity.timestep) {
    throw new Error(`model timestep ${model.opt.timestep} != parity.json ${parity.timestep}`);
  }
  const n = parity.joints.length;
  if (model.nu !== n) throw new Error(`model has ${model.nu} actuators, parity.json ${n} joints`);

  const qposAdr = new Int32Array(n);
  const dofAdr = new Int32Array(n);
  const jointIds = new Int32Array(n);
  const limits = new Float64Array(2 * n);
  parity.joints.forEach((name, i) => {
    const acc = model.jnt(name);
    const id = acc.id;
    acc.delete();
    jointIds[i] = id;
    qposAdr[i] = model.jnt_qposadr[id];
    dofAdr[i] = model.jnt_dofadr[id];
    limits[2 * i] = model.jnt_range[2 * id];
    limits[2 * i + 1] = model.jnt_range[2 * id + 1];
  });

  const bodyJoint = new Int32Array(model.nbody).fill(-1);
  for (let i = 0; i < n; i++) bodyJoint[model.jnt_bodyid[jointIds[i]]] = i;
  const bodyNames: string[] = [];
  for (let b = 0; b < model.nbody; b++) {
    const acc = model.body(b);
    bodyNames.push(acc.name);
    acc.delete();
  }
  const bodyParent = Int32Array.from(model.body_parentid as Int32Array);

  const siteIds = new Map<string, number>();
  const siteId = (name: string) => {
    let id = siteIds.get(name);
    if (id === undefined) {
      const acc = model.site(name);
      id = acc.id;
      acc.delete();
      siteIds.set(name, id);
    }
    return id;
  };
  const jac = new mj.DoubleBuffer(3 * model.nv);

  const gather = (src: Float64Array, adr: Int32Array) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = src[adr[i]];
    return out;
  };

  return {
    mj,
    model,
    data,
    nu: n,
    nbody: model.nbody,
    limits,
    bodyJoint,
    bodyNames,
    bodyParent,
    time: () => data.time,
    q: () => gather(data.qpos, qposAdr),
    qd: () => gather(data.qvel, dofAdr),
    ctrl: () => Float64Array.from(data.ctrl as Float64Array),
    setCtrl(ctrl) {
      const c = data.ctrl as Float64Array;
      for (let i = 0; i < n; i++) c[i] = ctrl[i];
    },
    stepPhysics(k) {
      for (let i = 0; i < k; i++) mj.mj_step(model, data);
    },
    sitePos(name) {
      const id = siteId(name);
      return Float64Array.from((data.site_xpos as Float64Array).subarray(3 * id, 3 * id + 3));
    },
    bodyPoses: () => ({
      pos: Float64Array.from(data.xpos as Float64Array),
      quat: Float64Array.from(data.xquat as Float64Array),
    }),
    jointFrames() {
      const anchor = new Float64Array(3 * n);
      const axis = new Float64Array(3 * n);
      const xa = data.xanchor as Float64Array;
      const xx = data.xaxis as Float64Array;
      for (let i = 0; i < n; i++) {
        const id = jointIds[i];
        anchor.set(xa.subarray(3 * id, 3 * id + 3), 3 * i);
        axis.set(xx.subarray(3 * id, 3 * id + 3), 3 * i);
      }
      return { anchor, axis };
    },
    jacSite(name) {
      mj.mj_jacSite(model, data, jac, null, siteId(name));
      return Float64Array.from(jac.GetView() as Float64Array);
    },
    resetToPose(q) {
      const qpos = data.qpos as Float64Array;
      (data.qvel as Float64Array).fill(0);
      for (let i = 0; i < n; i++) qpos[qposAdr[i]] = q[i];
      this.setCtrl(q);
      mj.mj_forward(model, data);
    },
    geoms() {
      const out: GeomInfo[] = [];
      for (let g = 0; g < model.ngeom; g++) {
        const meshId = model.geom_dataid[g];
        let mesh: MeshData | null = null;
        if (model.geom_type[g] === mj.mjtGeom.mjGEOM_MESH.value && meshId >= 0) {
          const va = model.mesh_vertadr[meshId];
          const vn = model.mesh_vertnum[meshId];
          const fa = model.mesh_faceadr[meshId];
          const fn = model.mesh_facenum[meshId];
          mesh = {
            vert: Float32Array.from(
              (model.mesh_vert as Float32Array).subarray(3 * va, 3 * (va + vn)),
            ),
            face: Int32Array.from((model.mesh_face as Int32Array).subarray(3 * fa, 3 * (fa + fn))),
          };
        }
        const mat = model.geom_matid[g];
        out.push({
          body: model.geom_bodyid[g],
          mesh,
          pos: Float64Array.from((model.geom_pos as Float64Array).subarray(3 * g, 3 * g + 3)),
          quat: Float64Array.from((model.geom_quat as Float64Array).subarray(4 * g, 4 * g + 4)),
          rgba: Float32Array.from(
            mat >= 0
              ? (model.mat_rgba as Float32Array).subarray(4 * mat, 4 * mat + 4)
              : (model.geom_rgba as Float32Array).subarray(4 * g, 4 * g + 4),
          ),
        });
      }
      return out;
    },
    dispose() {
      jac.delete();
      data.delete();
      model.delete();
    },
  };
}
