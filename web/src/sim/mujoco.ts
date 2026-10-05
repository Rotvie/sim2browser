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

export type GeomType = "plane" | "box" | "mesh" | "other";

export interface GeomInfo {
  body: number;
  type: GeomType;
  /** MuJoCo geom size (box: half-extents). */
  size: Float64Array;
  /** 2 = visual, 3 = collision only (never rendered). */
  group: number;
  mesh: MeshData | null;
  pos: Float64Array;
  quat: Float64Array;
  rgba: Float32Array;
}

export interface Sim {
  readonly mj: Mujoco;
  readonly model: MjModel;
  readonly data: MjData;
  /** Arm actuators (parity.joints). The gripper actuator is separate (jaw*, below). */
  readonly nu: number;
  readonly nbody: number;
  /** [min, max] per controlled joint, in parity.joints order. */
  readonly limits: Float64Array;
  /** Joint index (in parity.joints order) that moves each body, or -1 (base / welded). */
  readonly bodyJoint: Int32Array;
  readonly bodyNames: string[];
  readonly bodyParent: Int32Array;
  /** Bodies of the arm that move: every body a joint moves, and the jaw. */
  readonly armBodies: string[];
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
  /** Translational site Jacobian restricted to the controlled joints (3 x n, parity.joints order). */
  jacSiteJoints(name: string): Float64Array;
  /** Site position for joint positions q, computed on scratch data (live state untouched). */
  fkSite(name: string, q: ArrayLike<number>): Float64Array;
  /**
   * Default scene with the arm at q: zero velocities, arm ctrl = q, jaw closed (target too), cube
   * at its default pose; recompute derived quantities.
   */
  resetToPose(q: ArrayLike<number>): void;
  /** Jaw joint position and actuator target (rad). */
  jaw(): number;
  jawTarget(): number;
  /** Clipped to the jaw range. The gripper (sim/gripper.ts) is its only caller at runtime. */
  setJawTarget(v: number): void;
  /** Cube centre (m) and orientation (w, x, y, z), copied. */
  cubePose(): { pos: Float64Array; quat: Float64Array };
  /** Place the cube at rest (zero velocity); recompute derived quantities. */
  setCubePose(pos: ArrayLike<number>, quat: ArrayLike<number>): void;
  /** Any current contact between geoms of the two bodies (body names; "world" = static). */
  bodiesInContact(a: string, b: string): boolean;
  /** Full MuJoCo state (parity fixtures). */
  setState(qpos: ArrayLike<number>, qvel: ArrayLike<number>, ctrl: ArrayLike<number>): void;
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
  if (model.nu !== n + 1) {
    throw new Error(`model has ${model.nu} actuators, expected ${n} arm joints + gripper`);
  }
  const nameId = (type: number, name: string) => {
    const id = mj.mj_name2id(model, type, name);
    if (id < 0) throw new Error(`model has no ${name}`);
    return id;
  };
  const OBJ = mj.mjtObj;
  /** Actuator driving each joint id (transmission target). */
  const actuatorOf = (jointId: number) => {
    for (let a = 0; a < model.nu; a++) if (model.actuator_trnid[2 * a] === jointId) return a;
    throw new Error(`no actuator on joint ${jointId}`);
  };

  const qposAdr = new Int32Array(n);
  const dofAdr = new Int32Array(n);
  const ctrlAdr = new Int32Array(n);
  const jointIds = new Int32Array(n);
  const limits = new Float64Array(2 * n);
  parity.joints.forEach((name, i) => {
    const acc = model.jnt(name);
    const id = acc.id;
    acc.delete();
    jointIds[i] = id;
    ctrlAdr[i] = actuatorOf(id);
    qposAdr[i] = model.jnt_qposadr[id];
    dofAdr[i] = model.jnt_dofadr[id];
    limits[2 * i] = model.jnt_range[2 * id];
    limits[2 * i + 1] = model.jnt_range[2 * id + 1];
  });

  const jawJoint = nameId(OBJ.mjOBJ_JOINT.value, parity.gripper.joint);
  const jawQpos = model.jnt_qposadr[jawJoint];
  const jawCtrl = nameId(OBJ.mjOBJ_ACTUATOR.value, parity.gripper.actuator);
  const jawRange = [model.jnt_range[2 * jawJoint], model.jnt_range[2 * jawJoint + 1]];
  const cubeJoint = nameId(OBJ.mjOBJ_JOINT.value, parity.cube.joint);
  const cubeQpos = model.jnt_qposadr[cubeJoint];
  const cubeDof = model.jnt_dofadr[cubeJoint];

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
  const scratch = new mj.MjData(model);

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
    armBodies: bodyNames.filter((name, b) => bodyJoint[b] >= 0 || name === "Moving_Jaw"),
    time: () => data.time,
    q: () => gather(data.qpos, qposAdr),
    qd: () => gather(data.qvel, dofAdr),
    ctrl: () => gather(data.ctrl as Float64Array, ctrlAdr),
    setCtrl(ctrl) {
      const c = data.ctrl as Float64Array;
      for (let i = 0; i < n; i++) c[ctrlAdr[i]] = ctrl[i];
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
    jacSiteJoints(name) {
      mj.mj_jacSite(model, data, jac, null, siteId(name));
      const full = jac.GetView() as Float64Array;
      const nv = model.nv;
      const out = new Float64Array(3 * n);
      for (let r = 0; r < 3; r++)
        for (let i = 0; i < n; i++) out[r * n + i] = full[r * nv + dofAdr[i]];
      return out;
    },
    fkSite(name, q) {
      const qpos = scratch.qpos as Float64Array;
      for (let i = 0; i < n; i++) qpos[qposAdr[i]] = q[i];
      mj.mj_kinematics(model, scratch);
      const id = siteId(name);
      return Float64Array.from((scratch.site_xpos as Float64Array).subarray(3 * id, 3 * id + 3));
    },
    resetToPose(q) {
      mj.mj_resetData(model, data); // qpos0: cube at its default pose
      const qpos = data.qpos as Float64Array;
      for (let i = 0; i < n; i++) qpos[qposAdr[i]] = q[i];
      qpos[jawQpos] = parity.gripper.closed;
      this.setCtrl(q);
      (data.ctrl as Float64Array)[jawCtrl] = parity.gripper.closed;
      mj.mj_forward(model, data);
    },
    jaw: () => (data.qpos as Float64Array)[jawQpos],
    jawTarget: () => (data.ctrl as Float64Array)[jawCtrl],
    setJawTarget(v) {
      (data.ctrl as Float64Array)[jawCtrl] = Math.min(jawRange[1], Math.max(jawRange[0], v));
    },
    cubePose() {
      const qpos = data.qpos as Float64Array;
      return {
        pos: Float64Array.from(qpos.subarray(cubeQpos, cubeQpos + 3)),
        quat: Float64Array.from(qpos.subarray(cubeQpos + 3, cubeQpos + 7)),
      };
    },
    setCubePose(pos, quat) {
      const qpos = data.qpos as Float64Array;
      for (let i = 0; i < 3; i++) qpos[cubeQpos + i] = pos[i];
      for (let i = 0; i < 4; i++) qpos[cubeQpos + 3 + i] = quat[i];
      (data.qvel as Float64Array).fill(0, cubeDof, cubeDof + 6);
      mj.mj_forward(model, data);
    },
    bodiesInContact(a, b) {
      const ba = nameId(OBJ.mjOBJ_BODY.value, a);
      const bb = nameId(OBJ.mjOBJ_BODY.value, b);
      const gb = model.geom_bodyid as Int32Array;
      const contacts = data.contact;
      let hit = false;
      for (let i = 0; i < data.ncon && !hit; i++) {
        const c = contacts.get(i)!;
        const b1 = gb[c.geom1];
        const b2 = gb[c.geom2];
        c.delete();
        hit = (b1 === ba && b2 === bb) || (b1 === bb && b2 === ba);
      }
      contacts.delete();
      return hit;
    },
    setState(qpos, qvel, ctrl) {
      (data.qpos as Float64Array).set(qpos);
      (data.qvel as Float64Array).set(qvel);
      (data.ctrl as Float64Array).set(ctrl);
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
        const t = model.geom_type[g];
        const G = mj.mjtGeom;
        out.push({
          body: model.geom_bodyid[g],
          type:
            t === G.mjGEOM_PLANE.value
              ? "plane"
              : t === G.mjGEOM_BOX.value
                ? "box"
                : t === G.mjGEOM_MESH.value
                  ? "mesh"
                  : "other",
          size: Float64Array.from((model.geom_size as Float64Array).subarray(3 * g, 3 * g + 3)),
          group: model.geom_group[g],
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
      scratch.delete();
      data.delete();
      model.delete();
    },
  };
}
