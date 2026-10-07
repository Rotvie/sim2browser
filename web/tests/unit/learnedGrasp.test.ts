/** The learned grasp controller (004 contracts/grasp-policy.md "Runtime behavior"). */
import { describe, expect, it } from "vitest";
import { createLearnedGraspController } from "../../src/control/learnedGrasp";
import type { Policy } from "../../src/control/policy";
import { learnedGrasp } from "../../src/control/registry";
import { yawQuat } from "../../src/sim/cube";
import type { Parity } from "../../src/sim/parity";

const fields = [
  ["q", 5],
  ["qd", 5],
  ["jaw", 1],
  ["tip", 3],
  ["cube", 3],
  ["cubeToTip", 3],
  ["cubeYaw4", 2],
  ["relYaw4", 2],
  ["faceYaw4", 2],
  ["prevAction", 6],
].map(([name, size]) => ({ name: name as string, size: size as number, label: "", unit: "" }));

const parity = {
  joints: ["Rotation", "Pitch", "Elbow", "Wrist_Pitch", "Wrist_Roll"],
  tipSite: "tip",
  grasp: { rollOffset: -1.57079 },
  reach: { baseAxisXY: [0, -0.0452] },
  graspPolicy: {
    observation: {
      size: 32,
      fields,
      normalization: { mean: Array(32).fill(0), std: Array(32).fill(1), clip: 10, eps: 1e-8 },
    },
    action: {
      size: 6,
      joints: ["Rotation", "Pitch", "Elbow", "Wrist_Pitch", "Wrist_Roll"],
      deltaScale: 0.05,
      gripperIndex: 5,
      gripperThreshold: 0,
    },
  },
} as unknown as Parity;

function setup(output: number[]) {
  const seen: Float64Array[] = [];
  const policy = {
    forward: (x: ArrayLike<number>) => {
      seen.push(Float64Array.from(x));
      return Float64Array.from(output);
    },
  } as unknown as Policy;
  const applied: { delta: number[]; max: number }[] = [];
  const grip: string[] = [];
  const c = createLearnedGraspController({
    sim: {
      q: () => new Float64Array([0, -1, 1.5, 0, 0]),
      qd: () => new Float64Array(5),
      jaw: () => 0.2,
      sitePos: () => new Float64Array([0, -0.2, 0.1]),
      nu: 5,
    },
    arm: {
      applyDelta: (d: ArrayLike<number>, max: number) =>
        applied.push({ delta: Array.from(d), max }),
    } as never,
    parity,
    gripper: { set: (g) => grip.push(g) },
    cube: { pose: () => ({ pos: [0, -0.25, 0.015], quat: yawQuat(0.2) }) },
    policy,
  });
  return { c, seen, applied, grip };
}

describe("learned grasp controller", () => {
  it("applies the 5 joint outputs × deltaScale and closes the gripper above the threshold", () => {
    const { c, applied, grip } = setup([1, -1, 0.5, 0, -0.2, 0.3]);
    c.enter();
    c.step();
    expect(applied[0].delta).toEqual([0.05, -0.05, 0.025, 0, -0.2 * 0.05]);
    expect(applied[0].max).toBe(0.05);
    expect(grip).toEqual(["closed"]);
  });

  it("opens at or below the threshold", () => {
    const { c, grip } = setup([0, 0, 0, 0, 0, 0]);
    c.enter();
    c.step();
    expect(grip).toEqual(["open"]);
  });

  it("feeds back its previous output; enter() clears it", () => {
    const out = [0.1, 0.2, 0.3, 0.4, 0.5, -1];
    const { c, seen } = setup(out);
    c.enter();
    c.step();
    c.step();
    expect(Array.from(seen[0].subarray(26))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(seen[1].subarray(26))).toEqual(out);
    c.enter();
    c.step();
    expect(Array.from(seen[2].subarray(26))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("is offered only when parity.json has a graspPolicy", () => {
    expect(learnedGrasp.task).toBe("grasp");
    expect(learnedGrasp.available!(parity)).toBe(true);
    expect(learnedGrasp.available!({ ...parity, graspPolicy: undefined })).toBe(false);
  });
});
