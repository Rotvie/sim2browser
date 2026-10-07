/** The demonstration recorder (004 research R1–R3, contracts/demo-file.md) on the worker's Session. */
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { graspPlacements } from "../../src/sim/eval";
import {
  createRecorder,
  demoHeader,
  demoLines,
  recordGraspEpisode,
  simSha256,
  type DemoEpisode,
} from "../../src/sim/recorder";
import { createSession } from "../../src/sim/session";
import { loadNodeSim, readShared } from "../node-shared";

const setup = async () => {
  const { sim, parity, workspace } = await loadNodeSim();
  const s = createSession(sim, parity, workspace, { read: readShared });
  await s.ensureController("grasp");
  return { sim, parity, s };
};

const placement = (parity: Parameters<typeof graspPlacements>[0], seed: number) => {
  const [p] = graspPlacements(parity, 1, seed);
  return { ...p, seed, index: 0 };
};

describe("recording a scripted grasp", () => {
  it("records start state, one step per control step, and the judged outcome", async () => {
    const { sim, parity, s } = await setup();
    const ep = recordGraspEpisode(s, {
      id: "scripted-1000",
      controller: "grasp",
      placement: placement(parity, 1000),
      noise: 0,
    });
    expect(ep.source).toBe("scripted");
    expect(ep.controller).toBe("grasp");
    expect(ep.start.qpos).toHaveLength(13);
    expect(ep.start.qvel).toHaveLength(12);
    expect(ep.start.ctrl).toHaveLength(6);
    expect(ep.outcome.success).toBe(true);
    expect(ep.outcome.failure).toBeNull();
    // Ends 0.5 s after the lift was judged successful (lift time + hold + 0.5 s).
    const end = ep.steps.length / parity.controlHz;
    const doneAt = ep.outcome.timeToLift! + parity.grasp.success.hold;
    expect(end).toBeGreaterThanOrEqual(doneAt + 0.5 - 1e-9);
    expect(end).toBeLessThan(doneAt + 0.5 + 2 / parity.controlHz);
    for (const st of ep.steps) {
      expect(st.ctrl).toHaveLength(6);
      expect(st.qpos).toHaveLength(13);
      expect(st.qvel).toHaveLength(12);
      expect([0, 1]).toContain(st.grip);
      expect(st.intent).toBeUndefined(); // noise 0: the label is the applied change
    }
    sim.dispose();
  });

  it("matches the evaluation's outcome and lift time for the same placement", async () => {
    const { sim, parity, s } = await setup();
    const { runGraspEpisode } = await import("../../src/sim/eval");
    const p = placement(parity, 1001);
    const ev = runGraspEpisode(s, p, "grasp");
    const ep = recordGraspEpisode(s, { id: "x", controller: "grasp", placement: p, noise: 0 });
    expect(ep.outcome).toEqual({
      success: ev.success,
      timeToLift: ev.timeToLift,
      failure: ev.failure,
    });
    sim.dispose();
  });

  it("with noise, records the controller's intended change in [-1, 1] and perturbs the applied one", async () => {
    const { sim, parity, s } = await setup();
    const ep = recordGraspEpisode(s, {
      id: "n",
      controller: "grasp",
      placement: placement(parity, 1002),
      noise: 0.3,
    });
    const lim = parity.baseline.maxJointSpeed / parity.controlHz;
    let differs = 0;
    let prev = ep.start.ctrl;
    for (const st of ep.steps) {
      expect(st.intent).toHaveLength(5);
      for (let j = 0; j < 5; j++) {
        expect(Math.abs(st.intent![j])).toBeLessThanOrEqual(1);
        const applied = (st.ctrl[j] - prev[j]) / lim;
        if (Math.abs(applied - st.intent![j]) > 1e-6) differs++;
      }
      prev = st.ctrl;
    }
    expect(differs).toBeGreaterThan(ep.steps.length); // most joint changes were perturbed
    sim.dispose();
  });

  it("replaying start + ctrl reproduces the recorded states (same engine, < 1e-9)", async () => {
    const { sim, parity, s } = await setup();
    const ep = recordGraspEpisode(s, {
      id: "r",
      controller: "grasp",
      placement: placement(parity, 1003),
      noise: 0.2,
    });
    sim.setState(ep.start.qpos, ep.start.qvel, ep.start.ctrl);
    let max = 0;
    for (const st of ep.steps) {
      sim.data.ctrl.set(st.ctrl);
      sim.stepPhysics(parity.substeps);
      for (let i = 0; i < 13; i++) max = Math.max(max, Math.abs(sim.data.qpos[i] - st.qpos[i]));
      for (let i = 0; i < 12; i++) max = Math.max(max, Math.abs(sim.data.qvel[i] - st.qvel[i]));
    }
    // Not bit-exact: the solver's warm start is not part of the recorded state (contract: 1e-6).
    expect(max).toBeLessThan(1e-9);
    sim.dispose();
  });
});

describe("hand-driven recording", () => {
  it("is a hand episode with a 60 s limit; stop ends it as cancelled", async () => {
    const { sim, parity, s } = await setup();
    s.setMode("baseline");
    const ended: DemoEpisode[] = [];
    const rec = createRecorder(s, parity, (e) => ended.push(e));
    rec.begin({ id: "hand-0000", placement: placement(parity, 2000) });
    for (let k = 0; k < 30 * parity.controlHz; k++) s.controlStep(); // well past 10 s
    expect(rec.recording).toBe(true);
    const ep = rec.stop()!;
    expect(ep.source).toBe("hand");
    expect(ep.outcome.failure).toBe("cancelled");
    expect(ep.steps).toHaveLength(30 * parity.controlHz);
    expect(ended).toHaveLength(0);
    sim.dispose();
  });

  it("records nothing while the tab is hidden (no control steps)", async () => {
    const { sim, parity, s } = await setup();
    const rec = createRecorder(s, parity, () => {});
    rec.begin({ id: "h", placement: placement(parity, 2000) });
    s.tick(0);
    s.tick(100);
    s.setHidden(true, 100);
    s.tick(5000);
    const n = rec.stop()!.steps.length;
    expect(n).toBeLessThanOrEqual(6);
    sim.dispose();
  });
});

describe("demonstration file", () => {
  it("is gzip JSON Lines: header (kind, format, simSha256, sizes, counts), then one episode per line", async () => {
    const { sim, parity, s } = await setup();
    const ep = recordGraspEpisode(s, {
      id: "f",
      controller: "grasp",
      placement: placement(parity, 1004),
      noise: 0,
    });
    const header = demoHeader(parity, await simSha256(parity), [ep], "test");
    const bytes = gzipSync(demoLines(header, [ep]).join(""));
    const lines = gunzipSync(bytes).toString("utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const h = JSON.parse(lines[0]);
    expect(h).toMatchObject({
      kind: "sim2browser-demos",
      format: 1,
      parityVersion: parity.version,
      mujocoVersion: parity.mujocoVersion,
      controlHz: parity.controlHz,
      sizes: { nq: 13, nv: 12, nu: 6 },
      counts: { hand: { lifted: 0, failed: 0 }, scripted: { lifted: 1, failed: 0 } },
      generator: "test",
    });
    expect(h.simSha256).toMatch(/^[0-9a-f]{64}$/);
    const e = JSON.parse(lines[1]);
    expect(e.steps[3].qpos).toEqual(ep.steps[3].qpos); // full float64 precision
    sim.dispose();
  });

  it("simSha256 ignores policy sections and changes with the physics", async () => {
    const { sim, parity } = await setup();
    const a = await simSha256(parity);
    expect(await simSha256({ ...parity, policy: undefined, version: 99 })).toBe(a);
    expect(await simSha256({ ...parity, timestep: 0.001 })).not.toBe(a);
    sim.dispose();
  });
});
