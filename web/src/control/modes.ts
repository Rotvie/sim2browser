/**
 * Control-mode state machine (data-model.md ControlMode). A mode switch only changes which
 * controller writes ctrl; it never touches q, qd or the target (FR-012).
 *
 * Modes are controller ids: "manual" is built in; every other id comes from the controller
 * registry (control/registry.ts).
 */
import type { PolicyStep } from "./learned";

export type GraspPhase =
  "approach" | "descend" | "close" | "lift" | "hold" | "running" | "done" | "failed";
export type GraspFailure =
  "not-graspable" | "missed" | "slipped" | "knocked" | "timeout" | "cancelled";
export type GraspOutcome = "running" | "done" | "failed" | "cancelled";
export interface GraspState {
  /** The grasp controller in charge. */
  controller: string;
  /** Its own phase if it reports one (the scripted grasp), else "running" / "done" / "failed". */
  phase: GraspPhase;
  /** Decided by the session's attempt monitor (sim/graspAttempt.ts), never by the controller. */
  outcome: GraspOutcome;
  failure: GraspFailure | null;
  /** Seconds from the attempt's start to the start of the successful hold. */
  liftTime: number | null;
}

export type ControlMode = string;

export type ModeChangeReason = "user" | "joint-grab" | "controller-failed" | "target-drag";

export interface Controller {
  /** Called when the controller becomes active. */
  enter(): void;
  /** One control step: write joint targets through the Arm. */
  step(): void;
  /**
   * Optional: what the controller observes and outputs, for the "Policy view" panel. `active`
   * says whether it is the controller in charge right now.
   */
  inspect?(active: boolean): PolicyStep | null;
  /**
   * Optional, grasp controllers: their own phase and an early failure, for display. The session's
   * attempt monitor decides the outcome.
   */
  graspState?(): GraspState;
}

export const MANUAL = "manual";

export class ModeMachine {
  private controllers = new Map<ControlMode, Controller>();
  private current: ControlMode = MANUAL;

  constructor(manual: Controller) {
    this.controllers.set(MANUAL, manual);
    manual.enter();
  }

  get mode(): ControlMode {
    return this.current;
  }

  get controller(): Controller {
    return this.controllers.get(this.current)!;
  }

  available(mode: ControlMode): boolean {
    return this.controllers.has(mode);
  }

  register(mode: ControlMode, controller: Controller): void {
    this.controllers.set(mode, controller);
  }

  entries(): IterableIterator<[ControlMode, Controller]> {
    return this.controllers.entries();
  }

  /** Returns true when the mode changed. Unavailable modes are ignored. */
  setMode(mode: ControlMode): boolean {
    if (mode === this.current || !this.controllers.has(mode)) return false;
    this.current = mode;
    this.controller.enter();
    return true;
  }

  /** Visitor grabbed a joint: automatic controllers yield to manual posing. */
  jointGrab(): boolean {
    return this.setMode(MANUAL);
  }

  /**
   * A controller could not be created (e.g. its policy failed verification): drop it and, if it
   * was active, fall back to `fallback` (or manual).
   */
  controllerFailed(mode: ControlMode, fallback: ControlMode): boolean {
    if (mode === MANUAL) return false;
    this.controllers.delete(mode);
    if (this.current !== mode) return false;
    this.current = this.controllers.has(fallback) ? fallback : MANUAL;
    this.controller.enter();
    return true;
  }
}
