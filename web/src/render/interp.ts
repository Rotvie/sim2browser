/**
 * Smooth display of 50 Hz snapshots at any frame rate: render one control period behind the
 * latest snapshot, interpolating body positions (lerp) and quaternions (normalized nlerp).
 */
export interface Pose {
  pos: Float64Array;
  quat: Float64Array;
}

interface Stamped extends Pose {
  at: number;
}

export class PoseInterpolator {
  private prev: Stamped | null = null;
  private cur: Stamped | null = null;

  push(pose: Pose, atMs: number): void {
    this.prev = this.cur;
    this.cur = { ...pose, at: atMs };
  }

  /** Interpolated pose for display time `nowMs`, or null before the first snapshot. */
  sample(nowMs: number): Pose | null {
    const { prev, cur } = this;
    if (!cur) return null;
    if (!prev || cur.at <= prev.at) return { pos: cur.pos, quat: cur.quat };
    const period = cur.at - prev.at;
    const a = Math.min(1, Math.max(0, (nowMs - cur.at) / period));
    return lerpPose(prev, cur, a);
  }
}

export function lerpPose(p: Pose, c: Pose, a: number): Pose {
  const pos = new Float64Array(c.pos.length);
  for (let i = 0; i < pos.length; i++) pos[i] = p.pos[i] + (c.pos[i] - p.pos[i]) * a;
  const quat = new Float64Array(c.quat.length);
  for (let b = 0; b < quat.length; b += 4) {
    // Take the shortest path, then normalize (nlerp; accurate enough at 50 Hz).
    const dot =
      p.quat[b] * c.quat[b] +
      p.quat[b + 1] * c.quat[b + 1] +
      p.quat[b + 2] * c.quat[b + 2] +
      p.quat[b + 3] * c.quat[b + 3];
    const s = dot < 0 ? -1 : 1;
    let norm = 0;
    for (let k = 0; k < 4; k++) {
      quat[b + k] = p.quat[b + k] + (s * c.quat[b + k] - p.quat[b + k]) * a;
      norm += quat[b + k] * quat[b + k];
    }
    norm = Math.sqrt(norm) || 1;
    for (let k = 0; k < 4; k++) quat[b + k] /= norm;
  }
  return { pos, quat };
}
