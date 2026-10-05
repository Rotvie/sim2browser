import { describe, expect, it } from "vitest";
import { createLearnedController } from "../../src/control/learned";
import { createPolicy, loadPolicy, type Policy, type PolicyHeader } from "../../src/control/policy";
import { sha256Hex } from "../../src/sim/hash";
import type { Parity } from "../../src/sim/parity";

// 2 → 2 (tanh) → 1 (clip). W1 = [[1, 0], [0, 2]], b1 = [0, 0.5]; W2 = [[1, -1]], b2 = [0.25].
const weights = new Float32Array([1, 0, 0, 2, 0, 0.5, 1, -1, 0.25]);
const bin = new Uint8Array(weights.buffer.slice(0));
const header: PolicyHeader = {
  format: 1,
  parityVersion: 2,
  activation: "tanh",
  outputActivation: "clip",
  layers: [
    { in: 2, out: 2 },
    { in: 2, out: 1 },
  ],
  dtype: "float32-le",
  sha256: "",
  trainedWith: { algo: "test", steps: 0, seed: 0 },
};

describe("policy MLP", () => {
  it("computes tanh hidden layers and a clipped linear output", () => {
    const p = createPolicy(header, bin);
    const x = [0.3, -0.2];
    const h = [Math.tanh(0.3), Math.tanh(2 * -0.2 + 0.5)];
    expect(p.forward(x)[0]).toBeCloseTo(h[0] - h[1] + 0.25, 6);
    expect(p.forward([10, -10])[0]).toBe(1); // 1 + 1 + 0.25 clipped
  });

  it("rejects a wrong byte length", () => {
    expect(() => createPolicy(header, bin.subarray(0, 32))).toThrow(/bytes/);
  });

  it("rejects weights whose hash does not match parity.json", async () => {
    const files: Record<string, Uint8Array> = {
      "policy/reach.json": new TextEncoder().encode(JSON.stringify(header)),
      "policy/reach.bin": bin,
    };
    const read = async (path: string) => files[path];
    const parity = {
      version: 2,
      policy: {
        path: "policy/reach.bin",
        header: "policy/reach.json",
        sha256: await sha256Hex(bin),
      },
    } as unknown as Parity;
    await expect(loadPolicy(read, parity)).resolves.toBeTruthy();
    const bad = { ...parity, policy: { ...parity.policy!, sha256: "0".repeat(64) } } as Parity;
    await expect(loadPolicy(read, bad)).rejects.toMatchObject({ code: "hash-mismatch" });
  });
});

describe("learned controller", () => {
  it("observes and moves only action.joints; the others keep their targets", () => {
    const parity = {
      joints: ["a", "roll", "b"],
      tipSite: "tip",
      action: { size: 2, joints: ["a", "b"], low: -1, high: 1, deltaScale: 0.1 },
      observation: {
        size: 10,
        fields: [
          { name: "q", size: 2, label: "", unit: "" },
          { name: "qd", size: 2, label: "", unit: "" },
          { name: "target", size: 3, label: "", unit: "" },
          { name: "tipToTarget", size: 3, label: "", unit: "" },
        ],
        normalization: { mean: Array(10).fill(0), std: Array(10).fill(1), clip: 10, eps: 1e-8 },
      },
    } as unknown as Parity;
    const seen: number[][] = [];
    const policy = {
      forward: (x: ArrayLike<number>) => (seen.push(Array.from(x)), Float64Array.of(1, -1)),
    } as unknown as Policy;
    let applied: number[] = [];
    const c = createLearnedController({
      sim: {
        nu: 3,
        q: () => Float64Array.of(1, 2, 3),
        qd: () => Float64Array.of(4, 5, 6),
        sitePos: () => Float64Array.of(0, 0, 0),
      },
      arm: { applyDelta: (d: ArrayLike<number>) => (applied = Array.from(d)) } as never,
      parity,
      policy,
      target: () => [0, 0, 0],
    });
    c.enter();
    c.step();
    expect(seen[0].slice(0, 4)).toEqual([1, 3, 4, 6]);
    expect(applied).toEqual([0.1, 0, -0.1]);
  });
});
