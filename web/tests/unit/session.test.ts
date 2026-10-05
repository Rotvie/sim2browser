import { describe, expect, it } from "vitest";
import { createSession } from "../../src/sim/session";
import { loadNodeSim } from "../node-shared";

describe("session", () => {
  it("mode switches never touch q or qd (FR-012)", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    for (let i = 0; i < 10; i++) s.controlStep();
    const q = sim.q();
    const qd = sim.qd();
    s.setMode("manual");
    s.setMode("learned"); // not created yet (created on first selection): ignored
    s.setMode("baseline");
    expect(Array.from(sim.q())).toEqual(Array.from(q));
    expect(Array.from(sim.qd())).toEqual(Array.from(qd));
    sim.dispose();
  });

  it("dragJoint clips to limits and the joint settles there", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    s.dragJoint(0, 99);
    const maxPerStep = parity.baseline.maxJointSpeed / parity.controlHz;
    let prev = sim.ctrl()[0];
    for (let i = 0; i < 150; i++) {
      s.controlStep();
      const c = sim.ctrl()[0];
      expect(c - prev).toBeLessThanOrEqual(maxPerStep + 1e-12); // shared joint-speed limit
      prev = c;
    }
    const hi = sim.limits[1];
    expect(sim.ctrl()[0]).toBe(hi);
    expect(sim.q()[0]).toBeLessThanOrEqual(hi + 0.01);
    expect(sim.q()[0]).toBeGreaterThan(hi - 0.05);
    s.reset();
    expect(Array.from(sim.q())).toEqual(parity.baseline.neutralPose);
    sim.dispose();
  });
});

describe("joint limits under abrupt manual commands (FR-005)", () => {
  // MuJoCo joint limits are soft. Free: overshoot < 0.01 rad. With the arm pressed into the floor
  // (002: the floor collides), floor and limit push against each other: < 0.02 rad (measured
  // 0.016, Elbow, arm stretched flat; specs/002-grasp/validation.md).
  it("slamming every joint between its limits never exceeds them by more than 0.01 rad (0.02 against the floor)", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace);
    const links = [
      "Rotation_Pitch",
      "Upper_Arm",
      "Lower_Arm",
      "Wrist_Pitch_Roll",
      "Fixed_Jaw",
      "Moving_Jaw",
    ];
    let worstFree = 0;
    let worstFloor = 0;
    for (let k = 0; k < 12; k++) {
      for (let j = 0; j < sim.nu; j++) s.dragJoint(j, (k + j) % 2 ? 99 : -99);
      let lastFloor = -99;
      for (let i = 0; i < 100; i++) {
        s.controlStep();
        const q = sim.q();
        let over = 0;
        for (let j = 0; j < sim.nu; j++) {
          over = Math.max(over, q[j] - sim.limits[2 * j + 1], sim.limits[2 * j] - q[j]);
        }
        // The floor's push lingers for a few steps after the contact ends (rebound): 0.1 s.
        if (links.some((b) => sim.bodiesInContact(b, "world"))) lastFloor = i;
        if (i - lastFloor <= 5) worstFloor = Math.max(worstFloor, over);
        else worstFree = Math.max(worstFree, over);
      }
    }
    expect(worstFree).toBeLessThanOrEqual(0.01);
    expect(worstFloor).toBeLessThanOrEqual(0.02);
    sim.dispose();
  });
});
