import { describe, expect, it } from "vitest";
import { CONTROLLERS, type ControllerDef } from "../../src/control/registry";
import { reachableTargets, runEpisode } from "../../src/sim/eval";
import { createSession } from "../../src/sim/session";
import { loadNodeSim, readShared } from "../node-shared";

describe("controller registry", () => {
  it("has unique ids, labels and descriptions; public ones are the demo's three", () => {
    const ids = CONTROLLERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("manual");
    for (const c of CONTROLLERS) expect(c.label && c.description).toBeTruthy();
    expect(CONTROLLERS.filter((c) => c.public).map((c) => c.id)).toEqual(["baseline", "learned"]);
  });

  it("every registered controller can be created and evaluated headlessly", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace, { read: readShared });
    const [target] = reachableTargets(sim, parity, 1, 11);
    for (const def of s.controllers) {
      await s.ensureController(def.id);
      const r = runEpisode(s, def.id, target);
      expect(r.tipTrace.length, def.id).toBeGreaterThan(0);
      for (const p of r.tipTrace) expect(p.every(Number.isFinite), def.id).toBe(true);
    }
    sim.dispose();
  });

  it("a plug-in controller is a registry entry and nothing else", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    // A do-nothing controller: registered through options, exactly as in registry.ts.
    const hold: ControllerDef = {
      id: "hold",
      label: "Hold",
      description: "Keeps the joint targets where they are.",
      public: false,
      create: () => ({ enter() {}, step() {} }),
    };
    const s = createSession(sim, parity, workspace, { controllers: [...CONTROLLERS, hold] });
    await s.ensureController("hold");
    expect(s.setMode("hold")).toEqual({ mode: "hold", reason: "user" });
    const q = sim.q();
    for (let k = 0; k < 50; k++) s.controlStep();
    sim.q().forEach((v, j) => expect(Math.abs(v - q[j])).toBeLessThan(0.02));
    sim.dispose();
  });

  it("a controller that fails to create falls back to the baseline", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const broken: ControllerDef = {
      id: "broken",
      label: "Broken",
      description: "Always fails.",
      public: false,
      create: async () => {
        throw new Error("nope");
      },
    };
    const s = createSession(sim, parity, workspace, { controllers: [...CONTROLLERS, broken] });
    await expect(s.ensureController("broken")).rejects.toThrow("nope");
    expect(s.controllerFailed("broken")).toBeNull(); // it was never active
    expect(s.modes.mode).toBe("baseline");
    sim.dispose();
  });
});
