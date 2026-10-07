/**
 * The learned policy: a small MLP run in plain TypeScript on the CPU (research R7,
 * contracts/policy-artifact.md). No inference library.
 */
import { sha256Hex } from "../sim/hash";
import { ParityError, type Parity, type ReadBytes } from "../sim/parity";

export interface PolicyHeader {
  format: number;
  parityVersion: number;
  activation: "tanh";
  outputActivation: "clip";
  layers: { in: number; out: number }[];
  dtype: "float32-le";
  sha256: string;
  trainedWith: {
    algo: string;
    steps?: number;
    epochs?: number;
    seed: number;
    run?: string;
    reward?: Record<string, number>;
    /** Grasp policy (004): demonstrations it learned from. */
    demos?: { scripted: number; hand: number; dagger?: number; handShare: number; noise: number[] };
  };
  metrics?: {
    successRate: number;
    /** Reach policy only. */
    jerkRatioVsBaseline: number;
    n?: number;
    seed?: number;
    /** 003: fractions of evaluation episodes touching the floor / moving the cube. */
    floorContactRate?: number;
    cubeMovedRate?: number;
    /** Grasp policy (004). */
    medianTimeToLift?: number | null;
    selectionSuccessRate?: number;
  };
}

export interface Policy {
  header: PolicyHeader;
  forward(obsNorm: ArrayLike<number>): Float64Array;
}

interface Layer {
  in: number;
  out: number;
  w: Float32Array;
  b: Float32Array;
}

export function createPolicy(header: PolicyHeader, bin: Uint8Array): Policy {
  const floats = header.layers.reduce((n, l) => n + l.out * l.in + l.out, 0);
  if (bin.byteLength !== floats * 4) {
    throw new ParityError(
      "hash-mismatch",
      `policy weights: ${bin.byteLength} bytes, expected ${floats * 4}`,
    );
  }
  // Copy into an aligned little-endian buffer.
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const all = new Float32Array(floats);
  for (let i = 0; i < floats; i++) all[i] = view.getFloat32(4 * i, true);
  const layers: Layer[] = [];
  let off = 0;
  for (const l of header.layers) {
    layers.push({
      ...l,
      w: all.subarray(off, off + l.out * l.in),
      b: all.subarray(off + l.out * l.in, off + l.out * l.in + l.out),
    });
    off += l.out * l.in + l.out;
  }

  return {
    header,
    forward(x) {
      let h: ArrayLike<number> = x;
      for (let k = 0; k < layers.length; k++) {
        const { in: nIn, out: nOut, w, b } = layers[k];
        if (h.length !== nIn) throw new Error(`policy layer ${k}: input ${h.length} != ${nIn}`);
        const y = new Float64Array(nOut);
        for (let o = 0; o < nOut; o++) {
          let s = b[o];
          const row = o * nIn;
          for (let i = 0; i < nIn; i++) s += w[row + i] * h[i];
          y[o] = k < layers.length - 1 ? Math.tanh(s) : Math.min(1, Math.max(-1, s));
        }
        h = y;
      }
      return h as Float64Array;
    },
  };
}

/**
 * Fetch and verify a policy: parity.json `policy` (shared/policy/reach.*, the default) or
 * `graspPolicy` (shared/policy/grasp.*). Throws ParityError on any mismatch.
 */
export async function loadPolicy(
  read: ReadBytes,
  parity: Parity,
  section: "policy" | "graspPolicy" = "policy",
): Promise<Policy> {
  const entry = parity[section];
  if (!entry) throw new ParityError("invalid", `parity.json has no ${section}`);
  const [headerBytes, bin] = await Promise.all([read(entry.header), read(entry.path)]);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as PolicyHeader;
  if (header.parityVersion !== parity.version) {
    throw new ParityError(
      "version-mismatch",
      `policy was exported for parity.json v${header.parityVersion}`,
    );
  }
  if ((await sha256Hex(bin)) !== entry.sha256) {
    throw new ParityError("hash-mismatch", `${section} weights do not match parity.json`);
  }
  const policy = createPolicy(header, bin);
  const io = section === "graspPolicy" ? parity.graspPolicy! : parity;
  const [first, last] = [header.layers[0], header.layers[header.layers.length - 1]];
  if (first.in !== io.observation.size || last.out !== io.action.size) {
    throw new ParityError("invalid", `${section} layers do not match parity.json sizes`);
  }
  return policy;
}
