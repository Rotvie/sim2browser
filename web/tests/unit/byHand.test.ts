/**
 * Spec P1 (002-grasp): a visitor grasps the cube by hand, with the same messages the page sends
 * (setTarget, setGripper, setCube, setMode) on the worker's Session.
 */
import { describe, expect, it } from "vitest";
import { createSession, type Session } from "../../src/sim/session";
import { loadNodeSim, readShared } from "../node-shared";

const setup = async () => {
  const { sim, parity, workspace } = await loadNodeSim();
  const s = createSession(sim, parity, workspace, { read: readShared });
  const c = parity.cube.defaultPose.pos;
  const half = parity.cube.size / 2;
  return { sim, parity, s, c, half };
};
const run = (s: Session, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds * s.parity.controlHz; i++) {
    s.controlStep();
    each?.();
  }
};
/** Aim beside the cube, toward the base, so it sits between the open jaws; lower; close; lift. */
function pickUp(s: Session, c: number[]) {
  const aim = (z: number) => s.setTarget([c[0], c[1] + 0.015, c[2] + z]);
  s.setGripper("open");
  aim(0.08);
  run(s, 2);
  aim(0);
  run(s, 2);
  s.setGripper("closed");
  run(s, 1);
  aim(0.08);
  run(s, 2);
}

describe("grasping the cube by hand (P1)", () => {
  it("lifts, holds, drops; nothing sinks into the floor", async () => {
    const { sim, s, c, half } = await setup();
    let lowest = Infinity;
    const track = () => (lowest = Math.min(lowest, sim.cubePose().pos[2]));
    s.setGripper("open");
    s.setTarget([c[0], c[1], c[2] + 0.08]);
    run(s, 2, track);
    s.setTarget([c[0], c[1], c[2]]); // straight down onto the cube: presses it
    run(s, 2, track);
    expect(lowest).toBeGreaterThan(half - 0.0005); // < 0.5 mm into the floor
    s.reset();
    pickUp(s, c);
    expect(s.cubeHeld()).toBe(true);
    expect(sim.cubePose().pos[2]).toBeGreaterThan(c[2] + 0.05);
    s.setGripper("open");
    run(s, 1.5);
    expect(s.cubeHeld()).toBe(false);
    expect(sim.cubePose().pos[2]).toBeCloseTo(half, 2);
    sim.dispose();
  });

  it("keeps holding across controller switches and with the target out of reach", async () => {
    const { sim, s, c } = await setup();
    await s.ensureController("learned");
    pickUp(s, c);
    s.setMode("learned");
    run(s, 1);
    expect(s.cubeHeld()).toBe(true);
    s.setMode("baseline");
    s.setTarget([0, -0.9, 0.3]); // far out of reach
    run(s, 2);
    expect(s.cubeHeld()).toBe(true);
    expect(s.gripper.command).toBe("closed");
    sim.dispose();
  });

  it("moves the cube on the floor, refuses while held or onto the arm, and resets", async () => {
    const { sim, parity, s, c, half } = await setup();
    expect(s.setCube([0.05, -0.2])).toBe(true);
    expect(Array.from(sim.cubePose().pos)).toEqual([0.05, -0.2, half]);
    // The arm in its neutral pose reaches down in front of the base: find a spot it covers.
    const tip = sim.sitePos(parity.tipSite);
    s.setGripper("open");
    s.setTarget([tip[0], tip[1], 0.03]);
    run(s, 2);
    const t = sim.sitePos(parity.tipSite);
    const before = Array.from(sim.cubePose().pos);
    expect(s.setCube([t[0], t[1] - 0.01])).toBe(false);
    expect(Array.from(sim.cubePose().pos)).toEqual(before);
    s.reset();
    pickUp(s, c);
    const held = Array.from(sim.cubePose().pos);
    expect(s.setCube([0.1, -0.2])).toBe(false);
    expect(Array.from(sim.cubePose().pos)).toEqual(held);
    s.reset();
    expect(Array.from(sim.cubePose().pos)).toEqual(parity.cube.defaultPose.pos);
    expect(s.gripper.command).toBe(parity.gripper.default);
    sim.dispose();
  });
});
