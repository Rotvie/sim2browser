/**
 * The target the visitor drags (data-model.md Target). Visual only: it never collides and is not
 * a policy input beyond its position.
 */
import type { Parity } from "./parity";

type Reach = Parity["reach"];

export interface Workspace {
  /** True when the tip can reach some point in the voxel containing p. */
  has(p: ArrayLike<number>): boolean;
}

/** Bit-packed occupancy grid from shared/workspace.bin (x fastest, little-endian bits). */
export function createWorkspace(bytes: Uint8Array, ws: Reach["workspace"]): Workspace {
  const [nx, ny, nz] = ws.dims;
  const [ox, oy, oz] = ws.origin;
  return {
    has(p) {
      const i = Math.floor((p[0] - ox) / ws.voxel);
      const j = Math.floor((p[1] - oy) / ws.voxel);
      const k = Math.floor((p[2] - oz) / ws.voxel);
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return false;
      const bit = i + nx * (j + ny * k);
      return ((bytes[bit >> 3] >> (bit & 7)) & 1) === 1;
    },
  };
}

/** Clamp to z >= minZ and push out of the base exclusion cylinder, radially. */
export function clampTarget(p: ArrayLike<number>, reach: Reach): Float64Array {
  const out = Float64Array.from([p[0], p[1], Math.max(reach.minZ, p[2])]);
  const [bx, by] = reach.baseAxisXY;
  const dx = out[0] - bx;
  const dy = out[1] - by;
  const r = Math.hypot(dx, dy);
  if (r < reach.baseExclusionRadius) {
    // Exactly on the axis there is no radial direction; push toward the arm's front (−y).
    const [ux, uy] = r > 1e-9 ? [dx / r, dy / r] : [0, -1];
    out[0] = bx + ux * reach.baseExclusionRadius;
    out[1] = by + uy * reach.baseExclusionRadius;
  }
  return out;
}

const PROBES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export class Target {
  pos: Float64Array;
  reachable = true;

  constructor(
    private readonly reach: Reach,
    private readonly workspace: Workspace,
    private readonly home: ArrayLike<number>,
  ) {
    this.pos = clampTarget(home, reach);
    this.reachable = this.inside(this.pos);
  }

  set(p: ArrayLike<number>): void {
    this.pos = clampTarget(p, this.reach);
    // Hysteresis: the flag flips only once the point and every probe `hysteresis` away from it
    // agree, i.e. the point is at least that far past the grid boundary.
    const h = this.reach.hysteresis;
    const around = PROBES.map((d) => [
      this.pos[0] + d[0] * h,
      this.pos[1] + d[1] * h,
      this.pos[2] + d[2] * h,
    ]);
    const here = this.inside(this.pos);
    if (this.reachable && !here && around.every((q) => !this.inside(q))) this.reachable = false;
    else if (!this.reachable && here && around.every((q) => this.inside(q))) this.reachable = true;
  }

  reset(): void {
    this.pos = clampTarget(this.home, this.reach);
    this.reachable = this.inside(this.pos);
  }

  private inside(p: ArrayLike<number>): boolean {
    return p[2] >= this.reach.minZ && this.workspace.has(p);
  }
}
