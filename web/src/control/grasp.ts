/**
 * Scripted top-down grasp (002 research R5, data-model "GraspAttempt"): no learning. Built on the
 * 001 baseline's damped least-squares step, with every parameter in parity.json `grasp`.
 *
 *   approach → descend → close → lift → hold → done
 *   (any phase → failed: knocked, missed, slipped, timeout; not-graspable is the session's)
 *
 * Arm motion: a goal point moves along a straight line at the phase's speed; the DLS step drives
 * the tip to it with Rotation, Pitch and Elbow. Pitch, Elbow and Wrist_Pitch turn about parallel
 * axes, so Wrist_Pitch = verticalOffset - Pitch - Elbow keeps the fingers pointing down (clipped
 * to its limits by the Arm, which tilts the fingers slightly at some approach points), and
 * Wrist_Roll = rollOffset + cubeYaw - Rotation (+ k·π/2) lines the jaws up with two cube faces.
 * Only one jaw moves: the goal is the cube centre shifted by fixedJawOffset along the closing
 * axis, so the fixed jaw comes down just outside its face and closing pushes the cube onto it.
 */
import type { Arm } from "../sim/arm";
import { cubeYaw, type CubePose } from "../sim/cube";
import { GraspJudge } from "../sim/eval";
import type { Gripper } from "../sim/gripper";
import type { Sim } from "../sim/mujoco";
import type { Parity } from "../sim/parity";
import { dlsStep } from "./baseline";
import type { Controller, GraspFailure, GraspPhase, GraspState } from "./modes";

/** Close counts as settled when the jaw moves slower than this (rad/s). */
const JAW_STILL = 0.05;
/** A goal counts as reached when the tip is this close (m). */
const AT_GOAL = 0.005;

export interface GraspContext {
  sim: Pick<Sim, "q" | "ctrl" | "sitePos" | "jacSiteJoints" | "nu" | "limits" | "time" | "jaw">;
  arm: Arm;
  parity: Parity;
  gripper: Pick<Gripper, "set" | "command">;
  cube: { pose(): CubePose; held(): boolean };
}

type V3 = [number, number, number];
const dist = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface TopDownPlan {
  /** Wrist_Roll that lines the jaws up with two cube faces. */
  roll: number;
  graspPt: V3;
  approachPt: V3;
  liftPt: V3;
}

/**
 * Plan a top-down grasp from the cube pose: roll, closing axis, grasp/approach/lift points.
 * Shared by the scripted grasp and the reactive expert (004 DAgger labels).
 */
export function planTopDown(
  pose: CubePose,
  parity: Parity,
  rollLim: ArrayLike<number>,
): TopDownPlan {
  const g = parity.grasp;
  const [bx, by] = parity.reach.baseAxisXY;
  const c = pose.pos;
  // Rotation that faces the cube: the arm plane passes through the base axis, pointing -y at 0.
  const rot = Math.atan2(c[0] - bx, -(c[1] - by));
  const yaw = cubeYaw(pose.quat);
  // Wrist_Roll = rollOffset + yaw - Rotation + k·π/2: the face pair needing the least roll.
  let best = Infinity;
  let k0 = 0;
  for (let k = -4; k <= 4; k++) {
    const r = g.rollOffset + yaw - rot + (k * Math.PI) / 2;
    if (r < rollLim[0] || r > rollLim[1] || Math.abs(r) >= Math.abs(best)) continue;
    best = r;
    k0 = k;
  }
  // The closing axis (Fixed_Jaw +x) then has world yaw = yaw + k·π/2.
  const axis = yaw + (k0 * Math.PI) / 2;
  const graspPt: V3 = [
    c[0] + g.fixedJawOffset * Math.cos(axis),
    c[1] + g.fixedJawOffset * Math.sin(axis),
    c[2],
  ];
  return {
    roll: best,
    graspPt,
    approachPt: [graspPt[0], graspPt[1], graspPt[2] + g.approachHeight],
    liftPt: [graspPt[0], graspPt[1], graspPt[2] + g.liftHeight],
  };
}

/**
 * Joint-target change that drives the tip toward `goal` (DLS on Rotation, Pitch, Elbow) with the
 * fingers down (Wrist_Pitch follows Pitch and Elbow) and Wrist_Roll at `roll`.
 */
export function topDownDelta(
  sim: Pick<Sim, "ctrl" | "sitePos" | "jacSiteJoints" | "nu">,
  parity: Parity,
  goal: ArrayLike<number>,
  roll: number,
): Float64Array {
  const hz = parity.controlHz;
  const { damping, gain, maxJointSpeed } = parity.baseline;
  const maxPerStep = maxJointSpeed / hz;
  const tip = sim.sitePos(parity.tipSite);
  const J = sim.jacSiteJoints(parity.tipSite); // 3 x n, n = 5 arm joints
  const n = sim.nu;
  // Wrist_Pitch follows Pitch and Elbow: effective columns P - W, E - W.
  const J3 = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    J3[r * 3] = J[r * n];
    J3[r * 3 + 1] = J[r * n + 1] - J[r * n + 3];
    J3[r * 3 + 2] = J[r * n + 2] - J[r * n + 3];
  }
  const e = [0, 1, 2].map((i) => (gain * (goal[i] - tip[i])) / hz);
  const d3 = dlsStep(J3, 3, e, [0, 0, 0], damping);
  const c = sim.ctrl();
  const delta = new Float64Array(n);
  delta[0] = d3[0];
  delta[1] = d3[1];
  delta[2] = d3[2];
  const p = c[1] + Math.max(-maxPerStep, Math.min(maxPerStep, d3[1]));
  const el = c[2] + Math.max(-maxPerStep, Math.min(maxPerStep, d3[2]));
  delta[3] = parity.grasp.verticalOffset - p - el - c[3];
  delta[4] = roll - c[4];
  return delta;
}

export function createGraspController(ctx: GraspContext): Controller {
  const { sim, arm, parity, gripper, cube } = ctx;
  const g = parity.grasp;
  const hz = parity.controlHz;
  const rollLim = [sim.limits[8], sim.limits[9]];
  const maxPerStep = parity.baseline.maxJointSpeed / hz;

  let phase: GraspPhase = "failed";
  let failure: GraspFailure | null = null;
  let start = 0;
  let cubeStart: V3 = [0, 0, 0];
  let restZ = 0;
  let roll = 0;
  let approachPt: V3 = [0, 0, 0];
  let graspPt: V3 = [0, 0, 0];
  let liftPt: V3 = [0, 0, 0];
  /** The moving goal and where it is heading, at what speed (m/s). */
  let goal: V3 = [0, 0, 0];
  let dest: V3 = [0, 0, 0];
  let speed = 0;
  let phaseStart = 0;
  let stillSince: number | null = null;
  let lastJaw = 0;
  let judge: GraspJudge | null = null;

  const now = () => sim.time() - start;
  const moveTo = (p: V3, v: number) => {
    dest = p;
    speed = v;
  };
  const enterPhase = (p: GraspPhase) => {
    phase = p;
    phaseStart = now();
  };
  const fail = (reason: GraspFailure) => {
    phase = "failed";
    failure = reason;
    gripper.set("open");
    moveTo(approachPt, g.approachSpeed);
  };

  const plan = (pose: CubePose) => {
    ({ roll, graspPt, approachPt, liftPt } = planTopDown(pose, parity, rollLim));
  };

  const begin = () => {
    start = sim.time();
    failure = null;
    stillSince = null;
    const pose = cube.pose();
    cubeStart = [pose.pos[0], pose.pos[1], pose.pos[2]];
    restZ = parity.cube.size / 2;
    judge = new GraspJudge(g.success, restZ);
    const tip = sim.sitePos(parity.tipSite);
    goal = [tip[0], tip[1], tip[2]];
    // The session's attempt monitor refuses non-graspable placements before this runs.
    plan(pose);
    gripper.set("open");
    enterPhase("approach");
    moveTo(approachPt, g.approachSpeed);
  };

  /** Advance the goal toward dest by at most speed/hz; true once it is there. */
  const advanceGoal = () => {
    const d = dist(goal, dest);
    const stepLen = speed / hz;
    if (d <= stepLen) goal = [...dest];
    else for (let i = 0; i < 3; i++) goal[i] += ((dest[i] - goal[i]) * stepLen) / d;
    return goal[0] === dest[0] && goal[1] === dest[1] && goal[2] === dest[2];
  };

  const driveArm = () => {
    const delta = topDownDelta(sim, parity, goal, roll);
    arm.applyDelta(delta, maxPerStep);
  };

  const step = () => {
    const t = now();
    const pose = cube.pose();
    const held = cube.held();
    const atDest = advanceGoal();
    driveArm();
    if (phase === "done" || phase === "failed") return;

    if (t > g.success.timeLimit) return fail("timeout");
    if (
      (phase === "approach" || phase === "descend") &&
      Math.hypot(pose.pos[0] - cubeStart[0], pose.pos[1] - cubeStart[1]) > g.knockedDistance
    )
      return fail("knocked");
    const tip = sim.sitePos(parity.tipSite);
    const jaw = sim.jaw();
    const jawSpeed = Math.abs(jaw - lastJaw) * hz;
    lastJaw = jaw;

    switch (phase) {
      case "approach": {
        const rolled = Math.abs(sim.ctrl()[4] - roll) < 1e-6;
        const opened = jaw > parity.gripper.open - 0.1;
        if (atDest && dist(tip, approachPt) < AT_GOAL && rolled && opened) {
          enterPhase("descend");
          moveTo(graspPt, g.descendSpeed);
        }
        break;
      }
      case "descend":
        if (atDest && dist(tip, graspPt) < AT_GOAL) {
          enterPhase("close");
          gripper.set("closed");
          stillSince = null;
        }
        break;
      case "close": {
        if (jawSpeed < JAW_STILL) stillSince ??= t;
        else stillSince = null;
        const settled = stillSince !== null && t - stillSince >= g.closeSettle;
        if (settled || t - phaseStart >= g.closeTimeout) {
          if (!held) return fail("missed");
          enterPhase("lift");
          moveTo(liftPt, g.liftSpeed);
        }
        break;
      }
      case "lift":
      case "hold": {
        // The success hold may begin during the lift, as soon as the cube is high enough.
        if (judge!.update(t, pose.pos[2], held)) {
          phase = "done";
          break;
        }
        if (!held) return fail("slipped");
        if (phase === "lift" && atDest) enterPhase("hold");
        break;
      }
    }
  };

  return {
    enter: begin,
    step,
    graspState: (): GraspState => ({
      controller: "grasp",
      phase,
      outcome: phase === "done" ? "done" : phase === "failed" ? "failed" : "running",
      failure,
      liftTime: judge?.liftTime ?? null,
    }),
  };
}
