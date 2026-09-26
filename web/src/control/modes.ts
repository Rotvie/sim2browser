/**
 * Control-mode state machine (data-model.md ControlMode). A mode switch only changes which
 * controller writes ctrl; it never touches q, qd or the target (FR-012).
 */
export type ControlMode = "manual" | "baseline" | "learned";

export type ModeChangeReason = "user" | "joint-grab" | "policy-load-failed";

export interface Controller {
  /** Called when the controller becomes active. */
  enter(): void;
  /** One control step: write joint targets through the Arm. */
  step(): void;
}

export class ModeMachine {
  private controllers = new Map<ControlMode, Controller>();
  private current: ControlMode = "manual";

  constructor(controllers: Partial<Record<ControlMode, Controller>>) {
    for (const [mode, c] of Object.entries(controllers)) {
      if (c) this.controllers.set(mode as ControlMode, c);
    }
    if (!this.controllers.has("manual")) throw new Error("manual controller is required");
    // Initial mode: baseline once it exists (P2 on), manual otherwise (P1).
    this.current = this.controllers.has("baseline") ? "baseline" : "manual";
    this.controller.enter();
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

  /** Returns true when the mode changed. Unavailable modes are ignored. */
  setMode(mode: ControlMode): boolean {
    if (mode === this.current || !this.controllers.has(mode)) return false;
    this.current = mode;
    this.controller.enter();
    return true;
  }

  /** Visitor grabbed a joint: automatic controllers yield to manual posing. */
  jointGrab(): boolean {
    return this.setMode("manual");
  }

  /** The learned policy could not be loaded or verified. */
  policyLoadFailed(): boolean {
    this.controllers.delete("learned");
    if (this.current !== "learned") return false;
    this.current = "baseline";
    this.controller.enter();
    return true;
  }
}
