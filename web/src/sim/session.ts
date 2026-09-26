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
import type { Sim } from "./mujoco";
import type { Parity, ReadBytes } from "./parity";
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
  /** Controllers this build offers (registry entries available for this parity.json). */
  readonly controllers: ControllerDef[];
  /** Create and register a controller if needed (may load assets). Throws on failure. */
  ensureController(id: ControlMode): Promise<void>;
  /** A controller failed to load: drop it, falling back to the default if it was active. */
  controllerFailed(id: ControlMode): ModeChange | null;
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
  const modes = new ModeMachine(manual);
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
  };
  for (const def of controllers.filter((d) => d.preload)) {
    const c = def.create(ctx);
    if (c instanceof Promise) throw new Error(`preloaded controller ${def.id} must be synchronous`);
    modes.register(def.id, c);
  }
  modes.setMode(DEFAULT_MODE);
  const pending = new Map<ControlMode, Promise<void>>();

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
    controllers,
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
        mode: modes.mode,
        policyStep,
        policyStepActive,
      };
    },
  };
}
