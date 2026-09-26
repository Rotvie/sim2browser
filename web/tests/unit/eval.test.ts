import { describe, expect, it } from "vitest";
import { detectSuccess, meanSqJerk, reachableTargets } from "../../src/sim/eval";
import { loadNodeSim } from "../node-shared";

const success = { tolerance: 0.01, maxTipSpeed: 0.02, hold: 0.2, timeLimit: 2.0 };
const hz = 50;

describe("success detector", () => {
  it("requires distance AND low speed held for `hold` seconds within the time limit", () => {
    const target = [0, 0, 0];
    // At the target from step 20 on, standing still.
    const still = Array.from({ length: 150 }, (_, k) =>
      Float64Array.from(k < 20 ? [0.05, 0, 0] : [0.005, 0, 0]),
    );
    const r = detectSuccess(still, target, success, hz);
    expect(r.success).toBe(true);
    // Sample 20 still has the jump in it (fast); the hold starts at sample 21, time 22/hz.
    expect(r.settleTime).toBeCloseTo(22 / hz, 9);

    // Close enough but moving fast (oscillating 8 mm each step): never settles.
    const moving = Array.from({ length: 150 }, (_, k) =>
      Float64Array.from([k % 2 ? 0.004 : -0.004, 0, 0]),
    );
    expect(detectSuccess(moving, target, success, hz).success).toBe(false);

    // Settles only at 1.9 s: the hold would end after the 2 s limit.
    const late = Array.from({ length: 150 }, (_, k) =>
      Float64Array.from(k < 95 ? [0.05, 0, 0] : [0, 0, 0]),
    );
    expect(detectSuccess(late, target, success, hz).success).toBe(false);
  });
});

describe("mean squared jerk", () => {
  it("is 36 for x(t) = t^3 (jerk 6 at every interior point)", () => {
    const trace = Array.from({ length: 50 }, (_, k) => Float64Array.from([(k / hz) ** 3, 0, 0]));
    expect(meanSqJerk(trace, hz)).toBeCloseTo(36, 6);
  });
});

describe("seeded reachable targets", () => {
  it("are deterministic for a seed and respect minZ, the base exclusion radius and the front workspace", async () => {
    const { sim, parity } = await loadNodeSim();
    const a = reachableTargets(sim, parity, 30, 3);
    const b = reachableTargets(sim, parity, 30, 3);
    expect(a.map((p) => Array.from(p))).toEqual(b.map((p) => Array.from(p)));
    const [bx, by] = parity.reach.baseAxisXY;
    for (const p of a) {
      expect(p[2]).toBeGreaterThanOrEqual(parity.reach.minZ);
      expect(Math.hypot(p[0] - bx, p[1] - by)).toBeGreaterThanOrEqual(
        parity.reach.baseExclusionRadius,
      );
      expect(p[1]).toBeLessThanOrEqual(by - parity.reach.frontMargin);
    }
    expect(reachableTargets(sim, parity, 30, 4).map((p) => Array.from(p))).not.toEqual(
      a.map((p) => Array.from(p)),
    );
    sim.dispose();
  });
});
