/**
 * Headless evaluation of the shipped controllers (SC-003, SC-004, SC-009). No DOM: runs in Node on
 * the same Session the worker uses.
 */
import type { ControlMode } from "../control/modes";
import type { Sim } from "./mujoco";
import type { Parity } from "./parity";
import type { Session } from "./session";

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reachable by construction: the tip position of a uniform random joint configuration within
 * limits, rejecting points below minZ, inside the base exclusion radius, or outside the front
 * workspace (behind the base).
 */
export function reachableTargets(
  sim: Pick<Sim, "limits" | "nu" | "fkSite">,
  parity: Parity,
  n: number,
  seed: number,
): Float64Array[] {
  const rand = mulberry32(seed);
  const [bx, by] = parity.reach.baseAxisXY;
  const out: Float64Array[] = [];
  while (out.length < n) {
    const q = Array.from({ length: sim.nu }, (_, j) => {
      const lo = sim.limits[2 * j];
      return lo + (sim.limits[2 * j + 1] - lo) * rand();
    });
    const p = sim.fkSite(parity.tipSite, q);
    if (p[2] < parity.reach.minZ) continue;
    if (p[1] > by - parity.reach.frontMargin) continue;
    if (Math.hypot(p[0] - bx, p[1] - by) < parity.reach.baseExclusionRadius) continue;
    out.push(p);
  }
  return out;
}

/**
 * Settled = within `tolerance` of the target AND tip speed < `maxTipSpeed`, continuously for
 * `hold` seconds, with the hold complete by `timeLimit`. `trace[k]` is the tip after control
 * step k+1 (time (k+1)/hz); settleTime is the time of the first sample of the successful hold.
 * Speed is the displacement from the previous sample, so a jump onto the target does not count.
 */
export function detectSuccess(
  trace: ArrayLike<number>[],
  target: ArrayLike<number>,
  success: Parity["success"],
  hz: number,
): { success: boolean; settleTime: number | null } {
  const need = Math.round(success.hold * hz);
  let run = 0;
  for (let k = 0; k < trace.length; k++) {
    const p = trace[k];
    const d = Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
    const prev = k > 0 ? trace[k - 1] : p;
    const speed = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) * hz;
    run = d <= success.tolerance && speed < success.maxTipSpeed ? run + 1 : 0;
    if (run >= need) {
      // The hold ends at sample k (time (k+1)/hz); it began at sample k - need + 1.
      if ((k + 1) / hz > success.timeLimit + 1e-9) return { success: false, settleTime: null };
      return { success: true, settleTime: (k - need + 2) / hz };
    }
  }
  return { success: false, settleTime: null };
}

/** Mean over interior samples of ‖third finite difference / dt³‖² (m²/s⁶). */
export function meanSqJerk(trace: ArrayLike<number>[], hz: number): number {
  const dt3 = 1 / hz ** 3;
  let sum = 0;
  let count = 0;
  for (let k = 3; k < trace.length; k++) {
    let sq = 0;
    for (let a = 0; a < 3; a++) {
      const j = (trace[k][a] - 3 * trace[k - 1][a] + 3 * trace[k - 2][a] - trace[k - 3][a]) / dt3;
      sq += j * j;
    }
    sum += sq;
    count++;
  }
  return count ? sum / count : 0;
}

export interface EpisodeResult {
  success: boolean;
  settleTime: number | null;
  tipTrace: Float64Array[];
}

/** From the neutral pose, set the target and run timeLimit + 1 s under the given controller. */
export function runEpisode(
  session: Session,
  mode: ControlMode,
  target: ArrayLike<number>,
): EpisodeResult {
  const { parity, sim } = session;
  session.reset();
  if (session.modes.mode !== mode && !session.setMode(mode)) {
    throw new Error(`controller "${mode}" is not available`);
  }
  session.setTarget(target);
  const steps = Math.round((parity.success.timeLimit + 1) * parity.controlHz);
  const tipTrace: Float64Array[] = [];
  for (let k = 0; k < steps; k++) {
    session.controlStep();
    tipTrace.push(sim.sitePos(parity.tipSite));
  }
  const r = detectSuccess(tipTrace, session.target.pos, parity.success, parity.controlHz);
  return { ...r, tipTrace };
}
