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
  action: { size: number; low: number; high: number; deltaScale: number };
  observation: {
    size: number;
    fields: ObsField[];
    normalization?: { mean: number[]; std: number[]; clip: number; eps: number };
  };
  reach: {
    maxReach: number;
    margin: number;
    hysteresis: number;
    minZ: number;
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
  policy?: { path: string; header: string; sha256: string };
}

export const PARITY_VERSION = 1;

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
  if (p.action.size !== p.joints.length) {
    throw new ParityError("invalid", "action.size must equal the number of joints");
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
