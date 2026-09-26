import { describe, expect, it } from "vitest";
import { reachableTargets } from "../../src/sim/eval";
import { createSession } from "../../src/sim/session";
import { loadNodeSim } from "../node-shared";

const dist = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("baseline (DLS IK)", () => {
  it("reaches 20 seeded reachable targets within 1 cm in <= 2 s, within the joint-speed limit", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    expect(s.modes.mode).toBe("baseline");
    const maxPerStep = parity.baseline.maxJointSpeed / parity.controlHz;
    const steps = parity.success.timeLimit * parity.controlHz;
    for (const target of reachableTargets(sim, parity, 20, 7)) {
      s.reset();
      s.setTarget(target);
      let reached = false;
      let prev = sim.ctrl();
      for (let k = 0; k < steps; k++) {
        s.controlStep();
        const c = sim.ctrl();
        for (let j = 0; j < c.length; j++)
          expect(Math.abs(c[j] - prev[j])).toBeLessThanOrEqual(maxPerStep + 1e-12);
        prev = c;
        if (dist(sim.sitePos(parity.tipSite), s.target.pos) <= 0.01) reached = true;
      }
      expect(reached, `target ${Array.from(target)}`).toBe(true);
    }
    sim.dispose();
  });

  it("an out-of-reach target: stays finite and within limits, and settles without oscillating", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    const home = sim.sitePos(parity.tipSite);
    const [bx, by] = parity.reach.baseAxisXY;
    const dir = [home[0] - bx, home[1] - by];
    const n = Math.hypot(dir[0], dir[1]);
    s.setTarget([
      bx + (dir[0] / n) * 2 * parity.reach.maxReach,
      by + (dir[1] / n) * 2 * parity.reach.maxReach,
      0.15,
    ]);
    expect(s.target.reachable).toBe(false);
    const tips: Float64Array[] = [];
    for (let k = 0; k < 3 * parity.controlHz; k++) {
      s.controlStep();
      tips.push(sim.sitePos(parity.tipSite));
      const q = sim.q();
      sim.ctrl().forEach((c) => expect(Number.isFinite(c)).toBe(true));
      q.forEach((v, j) => {
        expect(v).toBeGreaterThanOrEqual(sim.limits[2 * j] - 0.01);
        expect(v).toBeLessThanOrEqual(sim.limits[2 * j + 1] + 0.01);
      });
    }
    const last = tips.slice(-0.5 * parity.controlHz);
    const spread = Math.max(...last.map((p) => dist(p, last[0])));
    expect(spread).toBeLessThan(0.001);
    sim.dispose();
  });

  it("a target behind the base: marked out of reach, and the arm comes to rest", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    const [bx, by] = parity.reach.baseAxisXY;
    for (const t of [
      [bx + 0.15, by + 0.2, 0.2],
      [bx - 0.1, by + 0.1, 0.4],
      [bx, by + 0.25, 0.1],
    ]) {
      s.reset();
      s.setTarget(t);
      expect(s.target.reachable).toBe(false);
      const tips: Float64Array[] = [];
      for (let k = 0; k < 4 * parity.controlHz; k++) {
        s.controlStep();
        tips.push(sim.sitePos(parity.tipSite));
      }
      const last = tips.slice(-0.5 * parity.controlHz);
      expect(Math.max(...last.map((p) => dist(p, last[0])))).toBeLessThan(0.002);
    }
    sim.dispose();
  });

  it("no NaN when started fully stretched (singular pose)", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    sim.resetToPose([0, 0, 0, 0, 0]);
    s.setTarget([0.1, -0.2, 0.2]);
    for (let k = 0; k < 100; k++) s.controlStep();
    for (const v of [...sim.q(), ...sim.ctrl()]) expect(Number.isFinite(v)).toBe(true);
    sim.dispose();
  });
});
