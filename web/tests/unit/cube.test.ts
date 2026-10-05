import { describe, expect, it } from "vitest";
import { clampCubePlacement, cubeYaw, isGraspable, isUpright, yawQuat } from "../../src/sim/cube";
import { inRegion } from "../../src/sim/parity";
import { loadNodeSim } from "../node-shared";

const { parity } = await loadNodeSim();
const reg = parity.grasp.region;
const [bx, by] = parity.reach.baseAxisXY;

describe("cube helpers", () => {
  it("reads yaw back from a yaw quaternion", () => {
    for (const yaw of [0, 0.3, -1.2, 2.9]) expect(cubeYaw(yawQuat(yaw))).toBeCloseTo(yaw, 12);
  });

  it("upright = some cube axis within 10 deg of world z", () => {
    expect(isUpright(yawQuat(0.7))).toBe(true);
    const tilt = (a: number) => [Math.cos(a / 2), Math.sin(a / 2), 0, 0];
    expect(isUpright(tilt(0.15))).toBe(true); // 8.6 deg
    expect(isUpright(tilt(0.2))).toBe(false); // 11.5 deg
    expect(isUpright(tilt(Math.PI / 2))).toBe(true); // on its side: another face is down
    expect(isUpright(tilt(Math.PI / 4))).toBe(false); // on an edge
  });

  it("inRegion is an annulus sector in front of the base", () => {
    const mid = (reg.rMin + reg.rMax) / 2;
    expect(inRegion([bx, by - mid], reg)).toBe(true);
    expect(inRegion([bx, by - reg.rMin + 0.005], reg)).toBe(false);
    expect(inRegion([bx, by + mid], reg)).toBe(false); // behind the base
    const a = reg.maxAngle - 0.01;
    expect(inRegion([bx + mid * Math.sin(a), by - mid * Math.cos(a)], reg)).toBe(true);
  });

  it("graspable needs upright, at rest on the floor, and inside the region", () => {
    const half = parity.cube.size / 2;
    const pos = [bx, by - 0.2, half];
    expect(isGraspable({ pos, quat: yawQuat(0.4) }, parity)).toBe(true);
    expect(isGraspable({ pos: [bx, by - 0.2, half + 0.03], quat: yawQuat(0) }, parity)).toBe(false);
    expect(isGraspable({ pos: [bx, by - 0.4, half], quat: yawQuat(0) }, parity)).toBe(false);
    expect(isGraspable({ pos, quat: [Math.cos(0.4), Math.sin(0.4), 0, 0] }, parity)).toBe(false);
  });

  it("clamps placements to the floor in front of the arm, within reach", () => {
    const front = by - parity.reach.frontMargin;
    expect(clampCubePlacement([0, 0.3], parity)[1]).toBeLessThanOrEqual(front);
    const near = clampCubePlacement([bx + 0.001, by - 0.001], parity);
    expect(Math.hypot(near[0] - bx, near[1] - by)).toBeGreaterThanOrEqual(
      parity.reach.baseExclusionRadius + parity.cube.size * Math.SQRT1_2 - 1e-9,
    );
    const far = clampCubePlacement([0, -2], parity);
    expect(Math.hypot(far[0] - bx, far[1] - by)).toBeLessThanOrEqual(parity.reach.maxReach + 1e-9);
    expect(clampCubePlacement([0.05, -0.25], parity)).toEqual([0.05, -0.25]);
  });
});
