/** Versions and hashes agree everywhere (Principle II). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256Hex, sha256Model } from "../../web/src/sim/hash";
import {
  loadNodeSim,
  readShared,
  SHARED_DIR,
} from "../../web/tests/node-shared";
import { FIXTURES, loadFixture } from "./fixtures";

describe("versions and hashes", () => {
  it("MuJoCo version, model, workspace, parity.json and policy hashes all match", async () => {
    const { mj, parity, sim } = await loadNodeSim();
    sim.dispose();
    expect(parity.version).toBe(4);
    expect(parity.model.path).toBe("robot/so100.xml");
    const pinned = readFileSync(`${SHARED_DIR}MUJOCO_VERSION`, "utf8").trim();
    expect(mj.mj_versionString()).toBe(pinned);
    expect(parity.mujocoVersion).toBe(pinned);

    const files = new Map<string, Uint8Array>();
    for (const f of parity.model.files) files.set(f, await readShared(f));
    const modelHash = await sha256Model(files);
    expect(modelHash).toBe(parity.model.sha256);
    expect(await sha256Hex(await readShared(parity.reach.workspace.path))).toBe(
      parity.reach.workspace.sha256,
    );
    expect(parity.policy, "parity.json has no policy").toBeTruthy();
    expect(await sha256Hex(await readShared(parity.policy!.path))).toBe(
      parity.policy!.sha256,
    );

    const parityHash = await sha256Hex(await readShared("parity.json"));
    for (const name of FIXTURES) {
      const fx = loadFixture(name);
      expect(fx.mujocoVersion, name).toBe(pinned);
      expect(fx.modelSha256, name).toBe(modelHash);
      expect(
        fx.parityJsonSha256,
        `${name}: regenerate fixtures after export`,
      ).toBe(parityHash);
    }
  });
});
