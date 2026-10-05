/** The scripted grasp (002 research R5, data-model "GraspAttempt") on the worker's Session. */
import { describe, expect, it } from "vitest";
import { yawQuat } from "../../src/sim/cube";
import { createSession, type Session } from "../../src/sim/session";
import { loadNodeSim, readShared } from "../node-shared";

const setup = async () => {
  const { sim, parity, workspace } = await loadNodeSim();
  const s = createSession(sim, parity, workspace, { read: readShared });
  await s.ensureController("grasp");
  return { sim, parity, s };
};

/** Run until the attempt ends (done/failed) or `maxSeconds`; returns the phases seen, in order. */
function runAttempt(s: Session, maxSeconds: number, each?: (k: number) => void): string[] {
  const phases: string[] = [];
  for (let k = 0; k < maxSeconds * s.parity.controlHz; k++) {
    s.controlStep();
    each?.(k);
    const g = s.snapshot().grasp!;
    if (phases[phases.length - 1] !== g.phase) phases.push(g.phase);
    if (g.phase === "done" || g.phase === "failed") break;
  }
  return phases;
}

const placeCube = (s: Session, x: number, y: number, yaw: number) => {
  s.sim.setCubePose([x, y, s.parity.cube.size / 2], yawQuat(yaw));
};

describe("scripted grasp", () => {
  it("lifts the cube from its default pose, through every phase in order", async () => {
    const { sim, parity, s } = await setup();
    const rest = parity.cube.defaultPose.pos[2];
    s.setMode("grasp");
    const phases = runAttempt(s, parity.grasp.success.timeLimit + 1);
    expect(phases).toEqual(["approach", "descend", "close", "lift", "hold", "done"]);
    expect(s.cubeHeld()).toBe(true);
    expect(sim.cubePose().pos[2]).toBeGreaterThan(rest + parity.grasp.success.liftCheck);
    const g = s.snapshot().grasp!;
    expect(g.failure).toBeNull();
    expect(g.liftTime).toBeGreaterThan(0);
    expect(g.liftTime!).toBeLessThan(parity.grasp.success.timeLimit);
    sim.dispose();
  });

  it.each([0, Math.PI / 4, 1.2])("lifts a cube turned by %f rad", async (yaw) => {
    const { sim, parity, s } = await setup();
    const [x, y] = parity.cube.defaultPose.pos;
    placeCube(s, x + 0.03, y + 0.02, yaw);
    s.setMode("grasp");
    const phases = runAttempt(s, parity.grasp.success.timeLimit + 1);
    expect(phases[phases.length - 1]).toBe("done");
    sim.dispose();
  });

  // At the approach point the wrist may sit at its limit (research: <= 0.2 rad tilt allowed there);
  // where the jaws close, the fingers point down (<= 0.03 rad in the region computation).
  it("points the jaws down when closing (within 2 deg), within 0.2 rad on the way down", async () => {
    const { sim, parity, s } = await setup();
    s.setMode("grasp");
    const fj = sim.bodyNames.indexOf("Fixed_Jaw");
    const tilt = () => {
      // Finger direction = -y axis of Fixed_Jaw; its world z component is -(2(yz + wx)).
      const [w, x, y, z] = (sim.data.xquat as Float64Array).subarray(4 * fj, 4 * fj + 4);
      return Math.acos(Math.min(1, 2 * (y * z + w * x)));
    };
    let worstDescend = 0;
    let atClose: number | null = null;
    runAttempt(s, parity.grasp.success.timeLimit + 1, () => {
      const phase = s.snapshot().grasp!.phase;
      if (phase === "descend") worstDescend = Math.max(worstDescend, tilt());
      if (phase === "close" && atClose === null) atClose = tilt();
    });
    expect(worstDescend).toBeLessThan(0.2);
    expect(atClose!).toBeLessThan((2 * Math.PI) / 180);
    sim.dispose();
  });

  it("refuses a cube outside the graspable region without moving", async () => {
    const { sim, parity, s } = await setup();
    const [bx, by] = parity.reach.baseAxisXY;
    placeCube(s, bx, by - parity.grasp.region.rMax - 0.05, 0);
    const before = Array.from(sim.ctrl());
    s.setMode("grasp");
    for (let k = 0; k < 25; k++) s.controlStep();
    const g = s.snapshot().grasp!;
    expect(g.phase).toBe("failed");
    expect(g.failure).toBe("not-graspable");
    expect(Array.from(sim.ctrl())).toEqual(before);
    sim.dispose();
  });

  it("reports a knocked cube, opens and backs off to the approach point", async () => {
    const { sim, parity, s } = await setup();
    const [x, y] = parity.cube.defaultPose.pos;
    s.setMode("grasp");
    let moved = false;
    const phases = runAttempt(s, parity.grasp.success.timeLimit + 1, () => {
      if (!moved && s.snapshot().grasp!.phase === "descend") {
        placeCube(s, x + 0.05, y, 0);
        moved = true;
      }
    });
    expect(phases[phases.length - 1]).toBe("failed");
    expect(s.snapshot().grasp!.failure).toBe("knocked");
    for (let k = 0; k < 2 * parity.controlHz; k++) s.controlStep();
    expect(s.gripper.command).toBe("open");
    const tip = sim.sitePos(parity.tipSite);
    expect(tip[2]).toBeGreaterThan(parity.cube.size / 2 + parity.grasp.approachHeight - 0.02);
    sim.dispose();
  });

  it("reports a miss when the cube is gone while closing", async () => {
    const { sim, parity, s } = await setup();
    s.setMode("grasp");
    let gone = false;
    const phases = runAttempt(s, parity.grasp.success.timeLimit + 1, () => {
      if (!gone && s.snapshot().grasp!.phase === "close") {
        placeCube(s, 0.15, -0.3, 0); // out from between the jaws
        gone = true;
      }
    });
    expect(phases[phases.length - 1]).toBe("failed");
    expect(s.snapshot().grasp!.failure).toBe("missed");
    sim.dispose();
  });
});

describe("leaving and restarting the grasp (data-model ControlMode)", () => {
  it("a target drag hands over to the baseline (reason target-drag)", async () => {
    const { sim, s } = await setup();
    s.setMode("grasp");
    for (let k = 0; k < 20; k++) s.controlStep();
    expect(s.setTarget([0.05, -0.25, 0.2])).toEqual({ mode: "baseline", reason: "target-drag" });
    expect(s.modes.mode).toBe("baseline");
    expect(s.setTarget([0.05, -0.25, 0.25])).toBeNull(); // already in baseline
    sim.dispose();
  });

  it("a joint grab hands over to manual (joint-grab)", async () => {
    const { sim, s } = await setup();
    s.setMode("grasp");
    expect(s.dragJoint(0, 0.3)).toEqual({ mode: "manual", reason: "joint-grab" });
    sim.dispose();
  });

  it("the gripper button cancels the grasp (user), then applies; the command survives", async () => {
    const { sim, s } = await setup();
    s.setMode("grasp");
    for (let k = 0; k < 20; k++) s.controlStep(); // approach: the grasp has opened the gripper
    expect(s.gripper.command).toBe("open");
    expect(s.setGripper("closed")).toEqual({ mode: "baseline", reason: "user" });
    expect(s.gripper.command).toBe("closed");
    s.setGripper("open");
    expect(s.gripper.command).toBe("open");
    sim.dispose();
  });

  it("leaving by the mode switch keeps the arm where it is (target moves to the tip)", async () => {
    const { sim, parity, s } = await setup();
    s.setMode("grasp");
    runAttempt(s, parity.grasp.success.timeLimit + 1);
    const tip = sim.sitePos(parity.tipSite);
    s.setMode("baseline");
    expect(s.gripper.command).toBe("closed"); // still holding
    expect(Math.hypot(...[0, 1, 2].map((i) => s.target.pos[i] - tip[i]))).toBeLessThan(1e-9);
    for (let k = 0; k < 50; k++) s.controlStep();
    expect(s.cubeHeld()).toBe(true);
    sim.dispose();
  });

  it("regrasp starts a new attempt", async () => {
    const { sim, parity, s } = await setup();
    s.setMode("grasp");
    runAttempt(s, parity.grasp.success.timeLimit + 1);
    s.setGripper("open"); // drop it (switches to baseline)
    for (let k = 0; k < 50; k++) s.controlStep();
    s.setMode("grasp");
    expect(s.snapshot().grasp!.phase).not.toBe("done");
    s.regrasp();
    expect(s.snapshot().grasp!.phase).toBe("approach");
    sim.dispose();
  });
});
