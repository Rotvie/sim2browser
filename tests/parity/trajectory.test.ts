/**
 * Replaying the same actions gives the same trajectory in WASM as in Python (≤ 1e-6), including
 * contacts with the floor, the cube and the gripper (002: full qpos/qvel, arm + jaw + cube).
 */
import { describe, expect, it } from "vitest";
import { createArm } from "../../web/src/sim/arm";
import { loadNodeSim } from "../../web/tests/node-shared";
import { loadFixture, maxDiff } from "./fixtures";

const TOL = 1e-6;

describe.each([
  "trajectory-random.json",
  "trajectory-limits.json",
  "policy-recorded.json",
  "contact-random.json",
  "grasp-recorded.json",
])("trajectory %s", (name) => {
  it("qpos and qvel match Python at every step", async () => {
    const fx = loadFixture(name);
    const { sim, parity } = await loadNodeSim();
    sim.setState(fx.init.qpos, fx.init.qvel, fx.init.ctrl);
    const arm = createArm(sim);
    const ds = parity.action.deltaScale;
    // Policy fixtures record one action per action.joints; trajectory fixtures one per joint.
    const idx =
      fx.kind === "policy"
        ? parity.action.joints.map((j) => parity.joints.indexOf(j))
        : parity.joints.map((_, i) => i);
    let worst = 0;
    fx.steps.forEach((step, k) => {
      if (fx.kind === "ctrl") {
        (sim.data.ctrl as Float64Array).set(step.ctrl!);
      } else {
        const delta = new Array(sim.nu).fill(0);
        idx.forEach((j, i) => (delta[j] = step.action[i] * ds));
        arm.applyDelta(delta, ds);
      }
      sim.stepPhysics(parity.substeps);
      const [dq, iq] = maxDiff(sim.data.qpos as Float64Array, step.qpos);
      const [dv, iv] = maxDiff(sim.data.qvel as Float64Array, step.qvel);
      if (dq > TOL)
        expect.fail(`${name}: qpos[${iq}] diverged by ${dq} at step ${k}`);
      if (dv > TOL)
        expect.fail(`${name}: qvel[${iv}] diverged by ${dv} at step ${k}`);
      worst = Math.max(worst, dq, dv);
    });
    expect(worst).toBeLessThanOrEqual(TOL);
    sim.dispose();
  });
});

describe("grasp-recorded.json", () => {
  it("the cube ends lifted in WASM, as in Python", async () => {
    const fx = loadFixture("grasp-recorded.json");
    const { sim, parity } = await loadNodeSim();
    sim.setState(fx.init.qpos, fx.init.qvel, fx.init.ctrl);
    for (const step of fx.steps) {
      (sim.data.ctrl as Float64Array).set(step.ctrl!);
      sim.stepPhysics(parity.substeps);
    }
    const lifted = parity.cube.size / 2 + parity.grasp.success.liftCheck;
    const zPython =
      fx.steps[fx.steps.length - 1].qpos[
        sim.model.jnt_qposadr[sim.model.njnt - 1] + 2
      ];
    expect(sim.cubePose().pos[2]).toBeGreaterThan(lifted);
    expect(zPython).toBeGreaterThan(lifted);
    sim.dispose();
  });
});
