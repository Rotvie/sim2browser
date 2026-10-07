/** Test helper: load shared/ from disk and build a sim in Node (the same modules the worker runs). */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSim, getMujoco } from "../src/sim/mujoco";
import { loadShared, type ReadBytes } from "../src/sim/parity";

export const SHARED_DIR = fileURLToPath(new URL("../../shared/", import.meta.url));

/** A reader for a shared/-shaped directory (default: the repo's shared/). */
export const sharedReader =
  (dir: string = SHARED_DIR): ReadBytes =>
  async (path) =>
    new Uint8Array(await readFile(dir.replace(/\/?$/, "/") + path));

export const readShared: ReadBytes = sharedReader();

export async function loadNodeSim(read: ReadBytes = readShared) {
  const mj = await getMujoco();
  const shared = await loadShared(read, mj.mj_versionString());
  const sim = createSim(mj, shared.parity, shared.modelFiles);
  return { mj, sim, ...shared };
}
