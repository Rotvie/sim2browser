/**
 * One running demo: sim + arm + control modes + real-time clock. No DOM or worker imports, so
 * Node tests and evaluation drive exactly the code the worker runs.
 */
import { createBaselineController } from "../control/baseline";
import { createManualController } from "../control/manual";
import { ModeMachine, type ControlMode, type ModeChangeReason } from "../control/modes";
import type { Snapshot } from "../protocol";
import { createArm, type Arm } from "./arm";
import { createClock, type Clock } from "./clock";
import type { Sim } from "./mujoco";
import type { Parity } from "./parity";
import { createWorkspace, Target } from "./target";

export interface ModeChange {
  mode: ControlMode;
  reason: ModeChangeReason;
}

export interface Session {
  readonly sim: Sim;
  readonly arm: Arm;
  readonly parity: Parity;
  readonly modes: ModeMachine;
  readonly target: Target;
  dragJoint(i: number, angle: number): ModeChange | null;
  setMode(mode: ControlMode): ModeChange | null;
  setTarget(pos: ArrayLike<number>): void;
  reset(): void;
  setHidden(hidden: boolean, nowMs: number): void;
  /** Advance in real time; returns the number of control steps taken. */
  tick(nowMs: number): number;
  /** One control step: active controller, then `substeps` physics steps. */
  controlStep(): void;
  snapshot(): Snapshot;
}

export function createSession(sim: Sim, parity: Parity, workspace: Uint8Array): Session {
  const arm = createArm(sim);
  const neutral = parity.baseline.neutralPose;
  sim.resetToPose(neutral);
  // One joint-speed limit for every controller (research R3).
  const maxPerStep = parity.baseline.maxJointSpeed / parity.controlHz;
  const manual = createManualController(arm, () => sim.ctrl(), maxPerStep);
  const target = new Target(
    parity.reach,
    createWorkspace(workspace, parity.reach.workspace),
    sim.fkSite(parity.tipSite, neutral),
  );
  const baseline = createBaselineController({ sim, arm, parity, target: () => target.pos });
  const modes = new ModeMachine({ manual, baseline });
  const clock: Clock = createClock({ controlHz: parity.controlHz });

  const controlStep = () => {
    modes.controller.step();
    sim.stepPhysics(parity.substeps);
  };

  return {
    sim,
    arm,
    parity,
    modes,
    target,
    dragJoint(i, angle) {
      const change = modes.jointGrab() ? { mode: modes.mode, reason: "joint-grab" as const } : null;
      manual.setGoal(i, angle);
      return change;
    },
    setMode(mode) {
      return modes.setMode(mode) ? { mode, reason: "user" } : null;
    },
    setTarget(pos) {
      target.set(pos);
    },
    reset() {
      sim.resetToPose(neutral);
      target.reset();
      manual.resetGoal(neutral);
      modes.controller.enter();
    },
    setHidden(hidden, nowMs) {
      if (hidden) clock.pause();
      else clock.resume(nowMs);
    },
    tick(nowMs) {
      const n = clock.tick(nowMs);
      for (let i = 0; i < n; i++) controlStep();
      return n;
    },
    controlStep,
    snapshot() {
      const { pos, quat } = sim.bodyPoses();
      const frames = sim.jointFrames();
      return {
        t: sim.time(),
        bodyPos: pos,
        bodyQuat: quat,
        q: sim.q(),
        qd: sim.qd(),
        ctrl: sim.ctrl(),
        tip: sim.sitePos(parity.tipSite),
        jointAnchor: frames.anchor,
        jointAxis: frames.axis,
        target: Float64Array.from(target.pos),
        reachable: target.reachable,
        mode: modes.mode,
      };
    },
  };
}
