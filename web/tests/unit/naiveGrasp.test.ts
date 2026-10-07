/**
 * 004 SC-010: a grasp plug-in written as one file plus one registry line is judged and evaluated
 * like the scripted grasp, with no other change.
 */
import { describe, expect, it } from "vitest";
import { graspPlacements, runGraspEpisode } from "../../src/sim/eval";
import { createSession } from "../../src/sim/session";
import { loadNodeSim, readShared } from "../node-shared";

describe("naive grasp plug-in", () => {
  it("runs 20 evaluation placements, each ending in a judged outcome", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace, { read: readShared });
    await s.ensureController("naive-grasp");
    const results = graspPlacements(parity, 20, 0).map((p) => runGraspEpisode(s, p, "naive-grasp"));
    for (const r of results) {
      expect(r.success).toBe(r.failure === null);
      expect(r.success).toBe(r.timeToLift !== null);
    }
    console.log(`naive-grasp: ${results.filter((r) => r.success).length}/20 lifted`);
    sim.dispose();
  });
});
