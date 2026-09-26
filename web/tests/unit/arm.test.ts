import { describe, expect, it } from "vitest";
import { createArm } from "../../src/sim/arm";

function fakeSim() {
  let ctrl = new Float64Array([0, 0]);
  return {
    nu: 2,
    limits: new Float64Array([-1, 1, 0, 2]),
    ctrl: () => Float64Array.from(ctrl),
    setCtrl: (c: ArrayLike<number>) => (ctrl = Float64Array.from(c)),
    get raw() {
      return ctrl;
    },
  };
}

describe("arm", () => {
  it("clips joint targets at both limits (FR-005)", () => {
    const sim = fakeSim();
    const arm = createArm(sim);
    arm.setJointTarget(0, 5);
    arm.setJointTarget(1, -3);
    expect(Array.from(sim.raw)).toEqual([1, 0]);
    arm.setJointTarget(0, -5);
    expect(sim.raw[0]).toBe(-1);
  });

  it("bounds per-step change and still clips to limits", () => {
    const sim = fakeSim();
    const arm = createArm(sim);
    arm.applyDelta([0.5, 0.5], 0.05);
    expect(sim.raw[0]).toBeCloseTo(0.05);
    expect(sim.raw[1]).toBeCloseTo(0.05);
    for (let i = 0; i < 100; i++) arm.applyDelta([1, 1], 0.05);
    expect(Array.from(sim.raw)).toEqual([1, 2]);
  });
});
