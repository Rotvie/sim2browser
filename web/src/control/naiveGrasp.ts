/**
 * Example grasp plug-in (004 SC-010): a top-down grasp that ignores the cube's turn. It goes
 * above the cube centre, opens, descends, closes and lifts, driving the tip with the baseline's
 * damped least-squares step while Wrist_Pitch keeps the fingers down and Wrist_Roll stays where
 * it is. Turned cubes end up between the jaws edge-first, which is the point: compare it with the
 * scripted grasp (`npm run eval:grasp -- --controller naive-grasp`).
 *
 * A grasp controller needs nothing else: `task: "grasp"` makes the session judge its attempts.
 * Registered in registry.ts as a lab controller (`?lab` in the URL).
 */
import { dlsStep } from "./baseline";
import type { ControllerDef } from "./registry";

export const naiveGrasp: ControllerDef = {
  id: "naive-grasp",
  label: "Naive grasp",
  short: "Naive",
  description:
    "Example grasp plug-in: top-down grasp at the cube centre that never turns the wrist to the cube.",
  task: "grasp",
  public: false,
  create({ sim, arm, parity, gripper, cube }) {
    const hz = parity.controlHz;
    const { damping, gain, maxJointSpeed } = parity.baseline;
    const { approachHeight, liftHeight, verticalOffset } = parity.grasp;
    let k = 0; // control steps since enter
    let goal = [0, 0, 0];
    return {
      enter() {
        k = 0;
      },
      step() {
        const c = cube.pose().pos;
        const s = k++ / hz; // open + approach 2 s, descend 1.5 s, close 1 s, then lift
        const z = s < 2 ? approachHeight : s < 5.5 ? 0 : liftHeight;
        if (s < 4.5) goal = [c[0], c[1], c[2] + z];
        else goal[2] = parity.cube.size / 2 + z;
        gripper.set(s < 4.5 ? "open" : "closed");
        const tip = sim.sitePos(parity.tipSite);
        const J = sim.jacSiteJoints(parity.tipSite);
        const n = sim.nu;
        const J3 = new Float64Array(9); // Rotation, Pitch - Wrist_Pitch, Elbow - Wrist_Pitch
        for (let r = 0; r < 3; r++)
          [J3[3 * r], J3[3 * r + 1], J3[3 * r + 2]] = [
            J[r * n],
            J[r * n + 1] - J[r * n + 3],
            J[r * n + 2] - J[r * n + 3],
          ];
        const e = [0, 1, 2].map((i) => (gain * (goal[i] - tip[i])) / hz);
        const d = dlsStep(J3, 3, e, [0, 0, 0], damping);
        const q = sim.ctrl();
        const delta = new Float64Array(n);
        [delta[0], delta[1], delta[2]] = d;
        delta[3] = verticalOffset - (q[1] + d[1]) - (q[2] + d[2]) - q[3];
        arm.applyDelta(delta, maxJointSpeed / hz);
      },
    };
  },
};
