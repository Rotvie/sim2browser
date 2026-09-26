import { describe, expect, it, vi, type Mock } from "vitest";
import { ModeMachine, type Controller } from "../../src/control/modes";

const ctl = (): Controller & { enter: Mock<() => void> } => ({
  enter: vi.fn<() => void>(),
  step: vi.fn<() => void>(),
});

describe("ModeMachine", () => {
  it("starts in manual when only manual exists (P1)", () => {
    expect(new ModeMachine({ manual: ctl() }).mode).toBe("manual");
  });

  it("starts in baseline once a baseline exists (P2 on)", () => {
    expect(new ModeMachine({ manual: ctl(), baseline: ctl() }).mode).toBe("baseline");
  });

  it("switches to requested available modes and ignores unavailable ones", () => {
    const b = ctl();
    const m = new ModeMachine({ manual: ctl(), baseline: b });
    expect(m.setMode("manual")).toBe(true);
    expect(m.setMode("learned")).toBe(false);
    expect(m.mode).toBe("manual");
    expect(m.setMode("baseline")).toBe(true);
    expect(b.enter).toHaveBeenCalledTimes(2); // initial + switch
  });

  it("joint grab moves automatic modes to manual", () => {
    const m = new ModeMachine({ manual: ctl(), baseline: ctl() });
    expect(m.jointGrab()).toBe(true);
    expect(m.mode).toBe("manual");
    expect(m.jointGrab()).toBe(false);
  });

  it("policy load failure falls back from learned to baseline and removes learned", () => {
    const m = new ModeMachine({ manual: ctl(), baseline: ctl(), learned: ctl() });
    m.setMode("learned");
    expect(m.policyLoadFailed()).toBe(true);
    expect(m.mode).toBe("baseline");
    expect(m.available("learned")).toBe(false);
  });
});
