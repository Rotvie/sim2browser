/** DAgger rollouts (004): the learner drives, the reactive expert labels every visited state. */
import { describe, expect, it } from "vitest";
import { graspPlacements } from "../../src/sim/eval";
import { recordDaggerEpisode } from "../../src/sim/dagger";
import { createSession } from "../../src/sim/session";
import { loadNodeSim, readShared } from "../node-shared";

describe("DAgger episodes", () => {
  it("with the expert itself driving, its labels are the changes it applied", async () => {
    const { sim, parity, workspace } = await loadNodeSim();
    const s = createSession(sim, parity, workspace, { read: readShared });
    await s.ensureController("reactive-grasp");
    const [p] = graspPlacements(parity, 1, 3000);
    const ep = recordDaggerEpisode(s, {
      id: "d",
      learner: "reactive-grasp",
      placement: { ...p, seed: 3000, index: 0 },
    });
    expect(ep.source).toBe("dagger");
    expect(ep.outcome.success).toBe(true);
    const lim = parity.baseline.maxJointSpeed / parity.controlHz;
    let prev = ep.start.ctrl;
    for (const st of ep.steps) {
      for (let j = 0; j < 5; j++)
        expect(st.intent![j]).toBeCloseTo((st.ctrl[j] - prev[j]) / lim, 9);
      expect(st.gripIntent).toBe(st.grip);
      prev = st.ctrl;
    }
    sim.dispose();
  });
});
