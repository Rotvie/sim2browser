import { describe, expect, it } from "vitest";
import { buildObs, normalize } from "../../src/sim/observation";
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
