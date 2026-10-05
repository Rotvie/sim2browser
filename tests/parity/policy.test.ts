/** Observation builder, normalization and MLP reproduce the training side. */
import { describe, expect, it } from "vitest";
import { loadPolicy } from "../../web/src/control/policy";
import { createArm } from "../../web/src/sim/arm";
import { buildObs, normalize } from "../../web/src/sim/observation";
import { loadNodeSim, readShared } from "../../web/tests/node-shared";
import { loadFixture, maxDiff } from "./fixtures";

describe("policy-recorded.json", () => {
  it("TS observations match Python (≤ 1e-6) and the TS MLP matches SB3 (≤ 1e-5)", async () => {
    const fx = loadFixture("policy-recorded.json");
    const { sim, parity } = await loadNodeSim();
    const policy = await loadPolicy(readShared, parity);
    const norm = parity.observation.normalization!;
    sim.setState(fx.init.qpos, fx.init.qvel, fx.init.ctrl);
    const arm = createArm(sim);
    const ds = parity.action.deltaScale;
    let target = fx.init.target!; // policy fixtures always record a target
    const idx = parity.action.joints.map((j) => parity.joints.indexOf(j));
    const pick = (v: ArrayLike<number>) => idx.map((i) => v[i]);
    let prev = new Array(idx.length).fill(0);
    let worstObs = 0;
    let worstAct = 0;
    fx.steps.forEach((step, k) => {
      const change = fx.targetChanges!.find((c) => c.step === k);
      if (change) target = change.target;
      const obsRaw = buildObs(
        {
          q: pick(sim.q()),
          qd: pick(sim.qd()),
          target,
          tip: sim.sitePos(parity.tipSite),
          prevAction: prev,
        },
        parity,
      );
      const obsNorm = normalize(obsRaw, norm);
      const [dr, ir] = maxDiff(obsRaw, step.obsRaw!);
      const [dn, inn] = maxDiff(obsNorm, step.obsNorm!);
      if (dr > 1e-6)
        expect.fail(`obsRaw[${ir}] diverged by ${dr} at step ${k}`);
      if (dn > 1e-6)
        expect.fail(`obsNorm[${inn}] diverged by ${dn} at step ${k}`);
      const [da, ia] = maxDiff(
        policy.forward(step.obsNorm!),
        step.policyAction!,
      );
      if (da > 1e-5)
        expect.fail(`policy action[${ia}] differs by ${da} at step ${k}`);
      worstObs = Math.max(worstObs, dr, dn);
      worstAct = Math.max(worstAct, da);
      // Replay the recorded action so both sides stay on the same trajectory.
      const delta = new Array(sim.nu).fill(0);
      idx.forEach((j, i) => (delta[j] = step.action[i] * ds));
      arm.applyDelta(delta, ds);
      sim.stepPhysics(parity.substeps);
      prev = step.action;
    });
    expect(worstObs).toBeLessThanOrEqual(1e-6);
    expect(worstAct).toBeLessThanOrEqual(1e-5);
    sim.dispose();
  });
});
