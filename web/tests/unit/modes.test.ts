import { describe, expect, it, vi, type Mock } from "vitest";
import { MANUAL, ModeMachine, type Controller } from "../../src/control/modes";

const ctl = (): Controller & { enter: Mock<() => void> } => ({
  enter: vi.fn<() => void>(),
  step: vi.fn<() => void>(),
});

describe("ModeMachine", () => {
  it("starts in manual; other controllers are registered by id", () => {
    const m = new ModeMachine(ctl());
    expect(m.mode).toBe(MANUAL);
    expect(m.available("baseline")).toBe(false);
    m.register("baseline", ctl());
    expect(m.available("baseline")).toBe(true);
  });

  it("switches to available modes and ignores unavailable ones", () => {
    const b = ctl();
    const m = new ModeMachine(ctl());
    m.register("baseline", b);
    expect(m.setMode("baseline")).toBe(true);
    expect(m.setMode("learned")).toBe(false);
    expect(m.mode).toBe("baseline");
    expect(m.setMode(MANUAL)).toBe(true);
    expect(m.setMode("baseline")).toBe(true);
    expect(b.enter).toHaveBeenCalledTimes(2);
  });

  it("joint grab moves automatic modes to manual", () => {
    const m = new ModeMachine(ctl());
    m.register("baseline", ctl());
    m.setMode("baseline");
    expect(m.jointGrab()).toBe(true);
    expect(m.mode).toBe(MANUAL);
    expect(m.jointGrab()).toBe(false);
  });

  it("a failed controller is removed and, if active, falls back", () => {
    const m = new ModeMachine(ctl());
    m.register("baseline", ctl());
    m.register("learned", ctl());
    m.setMode("learned");
    expect(m.controllerFailed("learned", "baseline")).toBe(true);
    expect(m.mode).toBe("baseline");
    expect(m.available("learned")).toBe(false);
    expect(m.controllerFailed(MANUAL, "baseline")).toBe(false); // manual cannot be removed
  });
});
