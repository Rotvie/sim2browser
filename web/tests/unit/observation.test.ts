import { describe, expect, it } from "vitest";
import { yawQuat } from "../../src/sim/cube";
import { buildGraspObs, buildObs, normalize } from "../../src/sim/observation";
import type { Parity } from "../../src/sim/parity";

const parity = {
  observation: {
    size: 21,
    fields: [
      { name: "q", size: 5, label: "", unit: "" },
      { name: "qd", size: 5, label: "", unit: "" },
      { name: "target", size: 3, label: "", unit: "" },
      { name: "tipToTarget", size: 3, label: "", unit: "" },
      { name: "prevAction", size: 5, label: "", unit: "" },
    ],
  },
} as unknown as Parity;

describe("buildObs", () => {
  it("follows the parity.json field order and sizes", () => {
    const o = buildObs(
      {
        q: [1, 2, 3, 4, 5],
        qd: [6, 7, 8, 9, 10],
        target: [0.1, 0.2, 0.3],
        tip: [0.05, 0.1, 0.4],
        prevAction: [-1, -0.5, 0, 0.5, 1],
      },
      parity,
    );
    expect(Array.from(o.subarray(0, 10))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(Array.from(o.subarray(10, 13))).toEqual([0.1, 0.2, 0.3]);
    expect(o[13]).toBeCloseTo(0.05, 15);
    expect(o[14]).toBeCloseTo(0.1, 15);
    expect(o[15]).toBeCloseTo(-0.1, 15);
    expect(Array.from(o.subarray(16))).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it("reorders when the fields are reordered (slices come from parity.json)", () => {
    const swapped = {
      observation: { size: 21, fields: [...parity.observation.fields].reverse() },
    } as unknown as Parity;
    const o = buildObs(
      {
        q: [1, 1, 1, 1, 1],
        qd: [2, 2, 2, 2, 2],
        target: [0, 0, 0],
        tip: [0, 0, 0],
        prevAction: [3, 3, 3, 3, 3],
      },
      swapped,
    );
    expect(o[0]).toBe(3);
    expect(o[20]).toBe(1);
  });
});

describe("normalize", () => {
  it("standardizes, clips at ±clip and guards std below eps", () => {
    const norm = { mean: [0, 1, 0], std: [2, 1, 0], clip: 10, eps: 1e-8 };
    const z = normalize([4, 1, 1e-9], norm);
    expect(z[0]).toBe(2);
    expect(z[1]).toBe(0);
    expect(z[2]).toBeCloseTo(0.1, 12); // 1e-9 / max(0, 1e-8)
    expect(normalize([100, -100, 0], norm).slice(0, 2)).toEqual(new Float64Array([10, -10]));
  });
});

/** 004 research R5 / contracts/grasp-policy.md: the layout export.py writes. */
const GRASP_FIELDS = [
  { name: "q", size: 5, label: "", unit: "" },
  { name: "qd", size: 5, label: "", unit: "" },
  { name: "jaw", size: 1, label: "", unit: "" },
  { name: "tip", size: 3, label: "", unit: "" },
  { name: "cube", size: 3, label: "", unit: "" },
  { name: "cubeToTip", size: 3, label: "", unit: "" },
  { name: "cubeYaw4", size: 2, label: "", unit: "" },
  { name: "relYaw4", size: 2, label: "", unit: "" },
  { name: "faceYaw4", size: 2, label: "", unit: "" },
  { name: "prevAction", size: 6, label: "", unit: "" },
];

describe("grasp observation", () => {
  const ROLL_OFFSET = -1.57079;
  const GEOM = { rollOffset: ROLL_OFFSET, baseAxisXY: [0, -0.0452] };
  const inputs = (yaw: number) => ({
    q: [0.1, -1.2, 1.4, 0.3, 0.5],
    qd: [1, 2, 3, 4, 5],
    jaw: 0.7,
    tip: [0.02, -0.2, 0.1],
    cubePos: [0.01, -0.25, 0.015],
    cubeQuat: yawQuat(yaw),
    prevAction: [0.1, 0.2, 0.3, 0.4, 0.5, -1],
  });

  it("follows the field order (32 values)", () => {
    const o = buildGraspObs(inputs(0.3), GRASP_FIELDS, GEOM);
    expect(o).toHaveLength(32);
    expect(Array.from(o.subarray(0, 11))).toEqual([0.1, -1.2, 1.4, 0.3, 0.5, 1, 2, 3, 4, 5, 0.7]);
    expect(Array.from(o.subarray(11, 17))).toEqual([0.02, -0.2, 0.1, 0.01, -0.25, 0.015]);
    expect(o[17]).toBeCloseTo(0.01, 12); // cubeToTip = tip − cube
    expect(o[18]).toBeCloseTo(0.05, 12);
    expect(o[19]).toBeCloseTo(0.085, 12);
    expect(o[20]).toBeCloseTo(Math.sin(1.2), 12); // cubeYaw4 = sin, cos of 4 × yaw
    expect(o[21]).toBeCloseTo(Math.cos(1.2), 12);
    const rel = 4 * (0.3 - (0.1 + 0.5 - ROLL_OFFSET)); // gripper yaw = Rotation + Wrist_Roll − rollOffset
    expect(o[22]).toBeCloseTo(Math.sin(rel), 12);
    expect(o[23]).toBeCloseTo(Math.cos(rel), 12);
    // faceYaw4: the jaws' yaw once Rotation faces the cube (its bearing from the base axis).
    const bearing = Math.atan2(0.01 - 0, -(-0.25 + 0.0452));
    const face = 4 * (0.3 - (bearing + 0.5 - ROLL_OFFSET));
    expect(o[24]).toBeCloseTo(Math.sin(face), 12);
    expect(o[25]).toBeCloseTo(Math.cos(face), 12);
    expect(Array.from(o.subarray(26))).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, -1]);
  });

  it("sees a cube turned by a quarter turn as the same cube", () => {
    const a = buildGraspObs(inputs(0.3), GRASP_FIELDS, GEOM);
    const b = buildGraspObs(inputs(0.3 + Math.PI / 2), GRASP_FIELDS, GEOM);
    for (let i = 0; i < 32; i++) expect(b[i]).toBeCloseTo(a[i], 9);
  });

  it("rejects a field of the wrong size", () => {
    const bad = GRASP_FIELDS.map((f) => (f.name === "jaw" ? { ...f, size: 2 } : f));
    expect(() => buildGraspObs(inputs(0), bad, GEOM)).toThrow("jaw");
  });
});
