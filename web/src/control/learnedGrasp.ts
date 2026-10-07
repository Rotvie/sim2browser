/**
 * Learned grasp (004 contracts/grasp-policy.md "Runtime behavior"): observation → normalize →
 * MLP → joint-target changes for every arm joint and a gripper command, exactly as the training
 * labels were made (training/reach/imitate.py). Same network runtime as the reach policy.
 */
import type { Arm } from "../sim/arm";
import type { CubePose } from "../sim/cube";
import type { Gripper } from "../sim/gripper";
import type { Sim } from "../sim/mujoco";
import { buildGraspObs, normalize } from "../sim/observation";
import type { Parity } from "../sim/parity";
import type { PolicyStep } from "./learned";
import type { Controller } from "./modes";
import type { Policy } from "./policy";

export function createLearnedGraspController(opts: {
  sim: Pick<Sim, "q" | "qd" | "jaw" | "sitePos" | "nu">;
  arm: Arm;
  parity: Parity;
  gripper: Pick<Gripper, "set">;
  cube: { pose(): CubePose };
  policy: Policy;
}): Controller {
  const { sim, arm, parity, gripper, cube, policy } = opts;
  const gp = parity.graspPolicy;
  if (!gp) throw new Error("parity.json has no graspPolicy");
  const { deltaScale, gripperIndex, gripperThreshold } = gp.action;
  const idx = gp.action.joints.map((j) => parity.joints.indexOf(j));
  let prevAction = new Float64Array(gp.action.size);
  let last: PolicyStep | null = null;

  const evaluate = (): PolicyStep => {
    const pose = cube.pose();
    const obsRaw = buildGraspObs(
      {
        q: sim.q(),
        qd: sim.qd(),
        jaw: sim.jaw(),
        tip: sim.sitePos(parity.tipSite),
        cubePos: pose.pos,
        cubeQuat: pose.quat,
        prevAction,
      },
      gp.observation.fields,
      { rollOffset: parity.grasp.rollOffset, baseAxisXY: parity.reach.baseAxisXY },
    );
    const obsNorm = normalize(obsRaw, gp.observation.normalization);
    return {
      obsRaw,
      obsNorm,
      action: policy.forward(obsNorm),
      prevAction: Float64Array.from(prevAction),
    };
  };

  return {
    enter() {
      prevAction = new Float64Array(gp.action.size);
      last = null;
    },
    step() {
      const s = evaluate();
      const delta = new Float64Array(sim.nu);
      idx.forEach((j, i) => (delta[j] = s.action[i] * deltaScale));
      arm.applyDelta(delta, deltaScale);
      gripper.set(s.action[gripperIndex] > gripperThreshold ? "closed" : "open");
      prevAction = Float64Array.from(s.action);
      last = s;
    },
    inspect: (active) => (active ? last : null) ?? evaluate(),
  };
}
