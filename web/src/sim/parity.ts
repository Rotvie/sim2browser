/**
 * shared/parity.json: types and a verifying loader (contracts/parity-json.md).
 * Parity-critical values are only ever read from here, never hard-coded.
 */
import { sha256Hex, sha256Model } from "./hash";

export interface ObsField {
  name: string;
  size: number;
  label: string;
  unit: string;
}

export interface Parity {
  version: number;
  mujocoVersion: string;
  model: { path: string; sha256: string; files: string[] };
  timestep: number;
  substeps: number;
  controlHz: number;
  joints: string[];
  tipSite: string;
  shoulderSite: string;
  /** The policy's action: one entry per `action.joints` (a subset of `joints`). */
  action: { size: number; joints: string[]; low: number; high: number; deltaScale: number };
  observation: {
    size: number;
    fields: ObsField[];
    normalization?: { mean: number[]; std: number[]; clip: number; eps: number };
  };
  reach: {
    maxReach: number;
    margin: number;
    hysteresis: number;
    /** Lowest target the visitor can set (clamp). */
    minZ: number;
    /** Lowest target the evaluation (and training) samples; above minZ (002 research R7). */
    evalMinZ: number;
    /** Demo workspace is in front of the base: tip y <= baseAxisXY[1] - frontMargin. */
    frontMargin: number;
    baseAxisXY: [number, number];
    baseExclusionRadius: number;
    workspace: {
      path: string;
      sha256: string;
      origin: [number, number, number];
      voxel: number;
      dims: [number, number, number];
    };
  };
  success: { tolerance: number; maxTipSpeed: number; hold: number; timeLimit: number };
  baseline: {
    damping: number;
    gain: number;
    maxJointSpeed: number;
    nullspaceGain: number;
    /** Far targets are projected to maxReach - reachStandoff from the shoulder. */
    reachStandoff: number;
    neutralPose: number[];
  };
  /** The jaw: binary open/closed command, moved at maxSpeed (rad/s). */
  gripper: {
    joint: string;
    actuator: string;
    open: number;
    closed: number;
    maxSpeed: number;
    default: GripperCommand;
  };
  cube: {
    body: string;
    joint: string;
    /** Edge length (m). */
    size: number;
    defaultPose: { pos: [number, number, number]; yaw: number };
  };
  /** Scripted grasp parameters (research R5); offsets and region computed by export.py. */
  grasp: {
    approachHeight: number;
    descendSpeed: number;
    approachSpeed: number;
    liftHeight: number;
    liftSpeed: number;
    closeSettle: number;
    closeTimeout: number;
    fixedJawOffset: number;
    verticalOffset: number;
    rollOffset: number;
    knockedDistance: number;
    region: GraspRegion;
    success: { liftCheck: number; hold: number; timeLimit: number };
  };
  policy?: { path: string; header: string; sha256: string };
  /** The learned grasp (004 contracts/grasp-policy.md); absent when none is shipped. */
  graspPolicy?: {
    path: string;
    header: string;
    sha256: string;
    observation: {
      size: number;
      fields: { name: string; size: number; label: string; unit: string }[];
      normalization: { mean: number[]; std: number[]; clip: number; eps: number };
    };
    action: {
      size: number;
      joints: string[];
      deltaScale: number;
      gripperIndex: number;
      gripperThreshold: number;
    };
  };
}

export type GripperCommand = "open" | "closed";

/** Floor annulus sector around the base axis, opening toward -y (in front of the arm). */
export interface GraspRegion {
  center: [number, number];
  rMin: number;
  rMax: number;
  maxAngle: number;
}

/** Same test as training/reach/spec.py in_region. */
export function inRegion(xy: ArrayLike<number>, reg: GraspRegion): boolean {
  const dx = xy[0] - reg.center[0];
  const dy = xy[1] - reg.center[1];
  const r = Math.hypot(dx, dy);
  return reg.rMin <= r && r <= reg.rMax && Math.abs(Math.atan2(dx, -dy)) <= reg.maxAngle;
}

export const PARITY_VERSION = 4;

export type ParityErrorCode = "version-mismatch" | "hash-mismatch" | "invalid";

export class ParityError extends Error {
  constructor(
    readonly code: ParityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ParityError";
  }
}

/** Reads a file relative to shared/. */
export type ReadBytes = (path: string) => Promise<Uint8Array>;

export interface LoadedShared {
  parity: Parity;
  /** Model XML and assets, keyed by path relative to shared/. */
  modelFiles: Map<string, Uint8Array>;
  workspace: Uint8Array;
}

export function validateParity(p: Parity, mujocoVersion: string): void {
  if (p.version !== PARITY_VERSION) {
    throw new ParityError(
      "version-mismatch",
      `parity.json version ${p.version} != ${PARITY_VERSION}`,
    );
  }
  if (p.mujocoVersion !== mujocoVersion) {
    throw new ParityError(
      "version-mismatch",
      `parity.json was written with MuJoCo ${p.mujocoVersion}, loaded ${mujocoVersion}`,
    );
  }
  if (Math.abs(p.timestep * p.substeps - 1 / p.controlHz) > 1e-12) {
    throw new ParityError("invalid", "timestep * substeps must equal 1 / controlHz");
  }
  const fieldSum = p.observation.fields.reduce((n, f) => n + f.size, 0);
  if (fieldSum !== p.observation.size) {
    throw new ParityError("invalid", "observation.size must equal the sum of field sizes");
  }
  if (!p.action.joints.every((j) => p.joints.includes(j))) {
    throw new ParityError("invalid", "action.joints must be a subset of joints");
  }
  if (p.action.size !== p.action.joints.length) {
    throw new ParityError("invalid", "action.size must equal the number of action.joints");
  }
  if (!(p.gripper.closed < p.gripper.open)) {
    throw new ParityError("invalid", "gripper.closed must be below gripper.open");
  }
  const reg = p.grasp.region;
  if (!(0 <= reg.rMin && reg.rMin < reg.rMax && reg.rMax <= p.reach.maxReach)) {
    throw new ParityError("invalid", "grasp.region needs 0 <= rMin < rMax <= reach.maxReach");
  }
  if (!(0 < reg.maxAngle && reg.maxAngle <= Math.PI / 2)) {
    throw new ParityError("invalid", "grasp.region.maxAngle must be in (0, pi/2]");
  }
  if (!inRegion(p.cube.defaultPose.pos, reg)) {
    throw new ParityError("invalid", "cube.defaultPose must be inside grasp.region");
  }
  if (p.graspPolicy) validateGraspPolicy(p, p.graspPolicy);
}

/** 004 contracts/grasp-policy.md (same rules as training/reach/spec.py). */
function validateGraspPolicy(p: Parity, gp: NonNullable<Parity["graspPolicy"]>): void {
  const { observation: obs, action: act } = gp;
  if (obs.fields.reduce((n, f) => n + f.size, 0) !== obs.size) {
    throw new ParityError(
      "invalid",
      "graspPolicy.observation.size must equal the sum of field sizes",
    );
  }
  if (obs.normalization.mean.length !== obs.size || obs.normalization.std.length !== obs.size) {
    throw new ParityError(
      "invalid",
      "graspPolicy normalization must have observation.size entries",
    );
  }
  if (!act.joints.every((j) => p.joints.includes(j))) {
    throw new ParityError("invalid", "graspPolicy.action.joints must be a subset of joints");
  }
  if (act.size !== act.joints.length + 1 || act.gripperIndex !== act.joints.length) {
    throw new ParityError("invalid", "graspPolicy.action: one output per joint, then the gripper");
  }
  if (Math.abs(act.deltaScale - p.baseline.maxJointSpeed / p.controlHz) > 1e-12) {
    throw new ParityError(
      "invalid",
      "graspPolicy.action.deltaScale must equal maxJointSpeed / controlHz",
    );
  }
}

/**
 * Fetch and verify parity.json, the model files and the workspace grid. `mujocoVersion` may be a
 * promise so the files download while the engine is still loading.
 */
export async function loadShared(
  read: ReadBytes,
  mujocoVersion: string | Promise<string>,
): Promise<LoadedShared> {
  const parity = JSON.parse(new TextDecoder().decode(await read("parity.json"))) as Parity;
  validateParity(parity, parity.mujocoVersion);

  // Fetch everything at once; verify after.
  const modelFiles = new Map<string, Uint8Array>();
  const [workspace] = await Promise.all([
    read(parity.reach.workspace.path),
    ...parity.model.files.map(async (path) => modelFiles.set(path, await read(path))),
  ]);
  if ((await sha256Model(modelFiles)) !== parity.model.sha256) {
    throw new ParityError("hash-mismatch", "robot model files do not match parity.json");
  }
  if ((await sha256Hex(workspace)) !== parity.reach.workspace.sha256) {
    throw new ParityError("hash-mismatch", "workspace.bin does not match parity.json");
  }
  validateParity(parity, await mujocoVersion);
  return { parity, modelFiles, workspace };
}
