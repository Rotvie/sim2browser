/** Test helper: load shared/ from disk and build a sim in Node (the same modules the worker runs). */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSim, getMujoco } from "../src/sim/mujoco";
import { loadShared, type ReadBytes } from "../src/sim/parity";

export const SHARED_DIR = fileURLToPath(new URL("../../shared/", import.meta.url));

export const readShared: ReadBytes = async (path) =>
  new Uint8Array(await readFile(SHARED_DIR + path));

export async function loadNodeSim() {
  const mj = await getMujoco();
  const shared = await loadShared(readShared, mj.mj_versionString());
  const sim = createSim(mj, shared.parity, shared.modelFiles);
  return { mj, sim, ...shared };
}
