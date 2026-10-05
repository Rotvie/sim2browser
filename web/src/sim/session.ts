/**
 * One running demo: sim + arm + control modes + real-time clock. No DOM or worker imports, so
 * Node tests and evaluation drive exactly the code the worker runs.
 */
import { createManualController } from "../control/manual";
import { MANUAL, ModeMachine, type ControlMode, type ModeChangeReason } from "../control/modes";
import { CONTROLLERS, type ControllerContext, type ControllerDef } from "../control/registry";
import type { Snapshot } from "../protocol";
import { createArm, type Arm } from "./arm";
import { createClock, type Clock } from "./clock";
import { clampCubePlacement, cubeYaw, isGraspable, yawQuat } from "./cube";
import { createGripper, type Gripper } from "./gripper";
import type { Sim } from "./mujoco";
import type { GripperCommand, Parity, ReadBytes } from "./parity";
import { createWorkspace, Target } from "./target";

export interface ModeChange {
  mode: ControlMode;
  reason: ModeChangeReason;
}

export interface SessionOptions {
  /** Controller registry (default: control/registry.ts CONTROLLERS). */
  controllers?: ControllerDef[];
  /** Reads files from shared/, for controllers that load assets (e.g. the policy). */
  read?: ReadBytes;
}

/** Where a controller falls back to when it fails, and the default mode. */
const DEFAULT_MODE = "baseline";

export interface Session {
  readonly sim: Sim;
  readonly arm: Arm;
  readonly parity: Parity;
  readonly modes: ModeMachine;
  readonly target: Target;
  readonly gripper: Gripper;
  /** Controllers this build offers (registry entries available for this parity.json). */
  readonly controllers: ControllerDef[];
  /** Create and register a controller if needed (may load assets). Throws on failure. */
  ensureController(id: ControlMode): Promise<void>;
  /** A controller failed to load: drop it, falling back to the default if it was active. */
  controllerFailed(id: ControlMode): ModeChange | null;
  dragJoint(i: number, angle: number): ModeChange | null;
  setMode(mode: ControlMode): ModeChange | null;
  /** Visitor's target drag; in grasp mode it hands over to the baseline first. */
  setTarget(pos: ArrayLike<number>): ModeChange | null;
  /** Visitor's gripper command; works in every mode (in grasp mode: baseline takes over first). */
  setGripper(command: GripperCommand): ModeChange | null;
  /** In grasp mode: start a new attempt from the current state. */
  regrasp(): void;
  /** Both jaws touch the cube. */
  cubeHeld(): boolean;
  /**
   * Visitor's cube drop at floor position (x, y), clamped (cube.ts). Refused (false) while the
   * cube is held or where it would overlap the arm.
   */
  setCube(xy: ArrayLike<number>): boolean;
  reset(): void;
  setHidden(hidden: boolean, nowMs: number): void;
  /** Advance in real time; returns the number of control steps taken. */
  tick(nowMs: number): number;
  /** One control step: active controller, then `substeps` physics steps. */
  controlStep(): void;
  snapshot(): Snapshot;
}

export function createSession(
  sim: Sim,
  parity: Parity,
  workspace: Uint8Array,
  opts: SessionOptions = {},
): Session {
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
  const gripper = createGripper(sim, parity);
  const modes = new ModeMachine(manual);
  const GRASP = "grasp";
  const clock: Clock = createClock({ controlHz: parity.controlHz });

  const controllers = (opts.controllers ?? CONTROLLERS).filter(
    (d) => d.available?.(parity) ?? true,
  );
  const ctx: ControllerContext = {
    sim,
    arm,
    parity,
    target: () => target.pos,
    read: opts.read ?? (() => Promise.reject(new Error("this session has no file reader"))),
    gripper,
    cube: { pose: () => sim.cubePose(), held: () => cubeHeld() },
  };
  for (const def of controllers.filter((d) => d.preload)) {
    const c = def.create(ctx);
    if (c instanceof Promise) throw new Error(`preloaded controller ${def.id} must be synchronous`);
    modes.register(def.id, c);
  }
  modes.setMode(DEFAULT_MODE);
  const pending = new Map<ControlMode, Promise<void>>();

  /** Leaving the grasp: keep the arm where it is (the next controller aims at the tip). */
  const leaveGrasp = (mode: ControlMode, reason: ModeChange["reason"]): ModeChange | null => {
    if (!modes.setMode(mode)) return null;
    return { mode, reason };
  };

  const controlStep = () => {
    modes.controller.step();
    gripper.step();
    sim.stepPhysics(parity.substeps);
  };
  const cubeHeld = () =>
    sim.bodiesInContact(parity.cube.body, "Fixed_Jaw") &&
    sim.bodiesInContact(parity.cube.body, "Moving_Jaw");

  return {
    sim,
    arm,
    parity,
    modes,
    target,
    gripper,
    controllers,
    cubeHeld,
    ensureController(id) {
      if (modes.available(id)) return Promise.resolve();
      const def = controllers.find((d) => d.id === id);
      if (!def) return Promise.reject(new Error(`unknown controller "${id}"`));
      let p = pending.get(id);
      if (!p) {
        p = Promise.resolve(def.create(ctx)).then((c) => modes.register(id, c));
        p.finally(() => pending.delete(id)).catch(() => {});
        pending.set(id, p);
      }
      return p;
    },
    controllerFailed(id) {
      return modes.controllerFailed(id, DEFAULT_MODE)
        ? { mode: modes.mode, reason: "controller-failed" }
        : null;
    },
    dragJoint(i, angle) {
      const change = modes.jointGrab() ? { mode: modes.mode, reason: "joint-grab" as const } : null;
      manual.setGoal(i, angle);
      return change;
    },
    setMode(mode) {
      if (modes.mode === GRASP && mode !== GRASP) target.set(sim.sitePos(parity.tipSite));
      return modes.setMode(mode) ? { mode, reason: "user" } : null;
    },
    setTarget(pos) {
      const change = modes.mode === GRASP ? leaveGrasp(DEFAULT_MODE, "target-drag") : null;
      target.set(pos);
      return change;
    },
    setGripper(command) {
      let change: ModeChange | null = null;
      if (modes.mode === GRASP) {
        target.set(sim.sitePos(parity.tipSite));
        change = leaveGrasp(DEFAULT_MODE, "user");
      }
      gripper.set(command);
      return change;
    },
    regrasp() {
      if (modes.mode === GRASP) modes.controller.enter();
    },
    setCube(xy) {
      if (cubeHeld()) return false;
      const before = sim.cubePose();
      const [x, y] = clampCubePlacement(xy, parity);
      sim.setCubePose([x, y, parity.cube.size / 2], yawQuat(cubeYaw(before.quat)));
      if (sim.armBodies.some((b) => sim.bodiesInContact(parity.cube.body, b))) {
        sim.setCubePose(before.pos, before.quat);
        return false;
      }
      return true;
    },
    reset() {
      sim.resetToPose(neutral);
      gripper.reset();
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
      const cube = sim.cubePose();
      const frames = sim.jointFrames();
      // Policy view: the active controller if it can be inspected, else the first one that can.
      let policyStep;
      let policyStepActive = false;
      const active = modes.controller;
      if (active.inspect) {
        policyStep = active.inspect(true) ?? undefined;
        policyStepActive = true;
      } else {
        for (const [id, c] of modes.entries()) {
          if (id !== MANUAL && c.inspect) {
            policyStep = c.inspect(false) ?? undefined;
            break;
          }
        }
      }
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
        jaw: sim.jaw(),
        gripper: gripper.command,
        cube: { ...cube, held: cubeHeld(), graspable: isGraspable(cube, parity) },
        mode: modes.mode,
        grasp: modes.mode === GRASP ? modes.controller.graspState?.() : undefined,
        policyStep,
        policyStepActive,
      };
    },
  };
}
