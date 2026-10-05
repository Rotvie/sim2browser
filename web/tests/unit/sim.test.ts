/** The sim on the v3 model: arm joints, gripper and cube (002-grasp data-model.md). */
import { describe, expect, it } from "vitest";
import { loadNodeSim } from "../node-shared";

describe("sim (v3 model)", () => {
  it("separates the 5 arm joints from the gripper actuator", async () => {
    const { sim, parity } = await loadNodeSim();
    expect(sim.nu).toBe(parity.joints.length);
    expect(sim.model.nu).toBe(parity.joints.length + 1);
    expect(sim.q()).toHaveLength(5);
    expect(sim.qd()).toHaveLength(5);
    expect(sim.ctrl()).toHaveLength(5);
    sim.dispose();
  });

  it("resets the jaw closed and the cube to its default pose", async () => {
    const { sim, parity } = await loadNodeSim();
    sim.resetToPose(parity.baseline.neutralPose);
    expect(sim.jaw()).toBe(parity.gripper.closed);
    expect(sim.jawTarget()).toBe(parity.gripper.closed);
    const { pos, quat } = sim.cubePose();
    expect(Array.from(pos)).toEqual(parity.cube.defaultPose.pos);
    expect(Array.from(quat)).toEqual([1, 0, 0, 0]);
    sim.dispose();
  });

  it("clips the jaw target to the jaw range and leaves the arm alone", async () => {
    const { sim } = await loadNodeSim();
    const arm = sim.ctrl();
    sim.setJawTarget(99);
    expect(sim.jawTarget()).toBe(1.75);
    sim.setJawTarget(-99);
    expect(sim.jawTarget()).toBe(-0.174);
    expect(Array.from(sim.ctrl())).toEqual(Array.from(arm));
    sim.dispose();
  });

  it("places the cube with zero velocity", async () => {
    const { sim } = await loadNodeSim();
    sim.stepPhysics(10);
    sim.setCubePose([0.05, -0.25, 0.015], [Math.cos(0.2), 0, 0, Math.sin(0.2)]);
    const { pos, quat } = sim.cubePose();
    expect(Array.from(pos)).toEqual([0.05, -0.25, 0.015]);
    expect(quat[0]).toBeCloseTo(Math.cos(0.2), 12);
    const dof = sim.model.jnt_dofadr[sim.model.njnt - 1]; // the cube's free joint is last
    const v = (sim.data.qvel as Float64Array).subarray(dof, dof + 6);
    expect(Array.from(v).every((x) => x === 0)).toBe(true);
    sim.dispose();
  });

  it("reports body contacts (cube resting on the floor, not touching the jaws)", async () => {
    const { sim } = await loadNodeSim();
    sim.stepPhysics(50);
    expect(sim.bodiesInContact("cube", "world")).toBe(true);
    expect(sim.bodiesInContact("cube", "Fixed_Jaw")).toBe(false);
    sim.dispose();
  });

  it("round-trips the full state", async () => {
    const { sim } = await loadNodeSim();
    sim.stepPhysics(20);
    const qpos = Float64Array.from(sim.data.qpos as Float64Array);
    const qvel = Float64Array.from(sim.data.qvel as Float64Array);
    const ctrl = Float64Array.from(sim.data.ctrl as Float64Array);
    sim.stepPhysics(20);
    sim.setState(qpos, qvel, ctrl);
    expect(Array.from(sim.data.qpos as Float64Array)).toEqual(Array.from(qpos));
    expect(Array.from(sim.data.qvel as Float64Array)).toEqual(Array.from(qvel));
    expect(Array.from(sim.data.ctrl as Float64Array)).toEqual(Array.from(ctrl));
    sim.dispose();
  });

  it("describes geoms for rendering: cube box visible, floor and collision hidden", async () => {
    const { sim } = await loadNodeSim();
    const geoms = sim.geoms();
    const cube = geoms.find((g) => g.type === "box" && g.group === 2)!;
    expect(Array.from(cube.size)).toEqual([0.015, 0.015, 0.015]);
    expect(geoms.some((g) => g.type === "plane" && g.group === 3)).toBe(true);
    expect(geoms.filter((g) => g.group === 3).length).toBeGreaterThan(10);
    sim.dispose();
  });
});
