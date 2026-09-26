/** Smoke test: the WASM engine runs the shared model under Node with parity.json settings. */
import { describe, expect, it } from "vitest";
import { loadNodeSim } from "../../web/tests/node-shared";

describe("engine", () => {
  it("steps the shared model from the neutral pose without NaN", async () => {
    const { sim, parity, mj } = await loadNodeSim();
    expect(mj.mj_versionString()).toBe(parity.mujocoVersion);
    expect(sim.model.opt.timestep).toBe(0.002);
    expect(sim.model.opt.timestep).toBe(parity.timestep);
    sim.resetToPose(parity.baseline.neutralPose);
    sim.stepPhysics(100);
    for (const v of [...sim.q(), ...sim.qd(), ...sim.sitePos(parity.tipSite)]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    sim.dispose();
  });
});
