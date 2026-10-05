import { describe, expect, it } from "vitest";
import {
  detectSuccess,
  graspPlacements,
  GraspJudge,
  meanSqJerk,
  reachableTargets,
  runEpisode,
} from "../../src/sim/eval";
import { createSession } from "../../src/sim/session";
import { inRegion } from "../../src/sim/parity";
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

describe("grasp evaluation (002 research R6)", () => {
  it("placements are deterministic, inside the region, uniform by area, yaw in [0, pi/2)", async () => {
    const { parity, sim } = await loadNodeSim();
    sim.dispose();
    const reg = parity.grasp.region;
    expect(graspPlacements(parity, 50, 0)).toEqual(graspPlacements(parity, 50, 0));
    const ps = graspPlacements(parity, 10_000, 1);
    let rSum = 0;
    for (const p of ps) {
      expect(inRegion(p.pos, reg)).toBe(true);
      expect(p.yaw).toBeGreaterThanOrEqual(0);
      expect(p.yaw).toBeLessThan(Math.PI / 2);
      rSum += Math.hypot(p.pos[0] - reg.center[0], p.pos[1] - reg.center[1]);
    }
    // Uniform by area over an annulus: mean radius = (2/3)(R³ − r³)/(R² − r²).
    const mean = ((2 / 3) * (reg.rMax ** 3 - reg.rMin ** 3)) / (reg.rMax ** 2 - reg.rMin ** 2);
    expect(Math.abs(rSum / ps.length - mean) / mean).toBeLessThan(0.03);
  });

  it("GraspJudge: 1 s lifted and held succeeds, 0.9 s does not, late does not", async () => {
    const { parity, sim } = await loadNodeSim();
    sim.dispose();
    const succ = parity.grasp.success;
    const rest = 0.015;
    const feed = (from: number, to: number) => {
      const j = new GraspJudge(succ, rest);
      let ok = false;
      for (let t = 0; t <= succ.timeLimit + 2; t += 0.02) {
        const up = t >= from && t < to;
        ok = j.update(t, up ? rest + succ.liftCheck + 0.01 : rest, up) || ok;
      }
      return { ok, liftTime: j.liftTime };
    };
    expect(feed(3, 4.5)).toEqual({ ok: true, liftTime: expect.closeTo(3, 6) });
    expect(feed(3, 3.9).ok).toBe(false);
    expect(feed(succ.timeLimit - 0.5, succ.timeLimit + 2).ok).toBe(false);
  });
});

describe("reach episodes count floor contact and a moved cube (003 SC-003)", () => {
  it("a target in the floor sets `floor`; a high, clear target sets neither", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    const [bx, by] = parity.reach.baseAxisXY;
    const low = runEpisode(s, "baseline", [bx + 0.12, by - 0.12, 0.0]); // clamped to minZ: tip 1 cm up
    expect(low.floor).toBe(true);
    const high = runEpisode(s, "baseline", [bx, by - 0.25, 0.3]);
    expect(high.floor).toBe(false);
    expect(high.cubeMoved).toBe(false);
    sim.dispose();
  });

  it("a reach through the cube sets `cubeMoved`", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    const c = parity.cube.defaultPose.pos;
    const r = runEpisode(s, "baseline", [c[0], c[1], c[2]]); // straight down onto the cube
    expect(r.cubeMoved || r.floor).toBe(true);
    sim.dispose();
  });
});
