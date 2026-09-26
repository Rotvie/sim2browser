import { describe, expect, it } from "vitest";
import { loadShared, ParityError, validateParity, type Parity } from "../../src/sim/parity";
import { readShared } from "../node-shared";

const base = async () =>
  JSON.parse(new TextDecoder().decode(await readShared("parity.json"))) as Parity;

describe("parity.json loader", () => {
  it("loads and verifies the real shared/ files", async () => {
    const { parity, modelFiles } = await loadShared(readShared, "3.14.0");
    expect(parity.joints).toHaveLength(5);
    expect(modelFiles.size).toBe(parity.model.files.length);
  });

  it("rejects a different MuJoCo version", async () => {
    await expect(loadShared(readShared, "3.13.0")).rejects.toMatchObject({
      code: "version-mismatch",
    });
  });

  it("rejects modified model bytes", async () => {
    const tampered = async (path: string) => {
      const b = await readShared(path);
      return path.endsWith(".xml") ? new Uint8Array([...b, 32]) : b;
    };
    await expect(loadShared(tampered, "3.14.0")).rejects.toMatchObject({ code: "hash-mismatch" });
  });

  it("rejects a timestep/substeps product that is not 1/controlHz", async () => {
    const p = await base();
    p.substeps = 7;
    expect(() => validateParity(p, "3.14.0")).toThrow(ParityError);
  });
});
