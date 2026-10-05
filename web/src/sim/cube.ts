/**
 * The cube: pose helpers, the graspable test and placement clamping (002 data-model "Cube").
 * Quaternions are MuJoCo's (w, x, y, z).
 */
import { inRegion, type Parity } from "./parity";

export interface CubePose {
  pos: ArrayLike<number>;
  quat: ArrayLike<number>;
}

const UPRIGHT_TOL = (10 * Math.PI) / 180;
/** Resting = centre within this of half the edge above the floor (m). */
const REST_TOL = 0.003;

/** Rotation about world z. */
export function yawQuat(yaw: number): [number, number, number, number] {
  return [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)];
}

/** Yaw of the cube's x axis (meaningful when upright; the grasp uses it modulo pi/2). */
export function cubeYaw(q: ArrayLike<number>): number {
  const [w, x, y, z] = [q[0], q[1], q[2], q[3]];
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/** Some cube axis within 10 deg of world z: a face is down. */
export function isUpright(q: ArrayLike<number>): boolean {
  const [w, x, y, z] = [q[0], q[1], q[2], q[3]];
  // World z components of the cube's x, y, z axes (third row of the rotation matrix).
  const zs = [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  return Math.max(...zs.map(Math.abs)) >= Math.cos(UPRIGHT_TOL);
}

export function isGraspable(pose: CubePose, parity: Parity): boolean {
  return (
    isUpright(pose.quat) &&
    Math.abs(pose.pos[2] - parity.cube.size / 2) <= REST_TOL &&
    inRegion(pose.pos, parity.grasp.region)
  );
}

/**
 * A floor position (x, y) for a visitor's cube drag: in front of the base (y <= base y -
 * frontMargin), clear of the base (its half diagonal outside baseExclusionRadius) and within
 * maxReach of the base axis. Positions outside the graspable region are allowed.
 */
export function clampCubePlacement(xy: ArrayLike<number>, parity: Parity): [number, number] {
  const { baseAxisXY: base, frontMargin, baseExclusionRadius, maxReach } = parity.reach;
  let x = xy[0];
  let y = Math.min(xy[1], base[1] - frontMargin);
  const dx = x - base[0];
  const dy = y - base[1];
  const r = Math.hypot(dx, dy);
  const rMin = baseExclusionRadius + parity.cube.size * Math.SQRT1_2;
  const rr = Math.min(maxReach, Math.max(rMin, r));
  if (rr !== r) {
    const [ux, uy] = r > 1e-9 ? [dx / r, dy / r] : [0, -1];
    x = base[0] + ux * rr;
    y = base[1] + uy * rr;
  }
  return [x, y];
}
