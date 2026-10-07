/**
 * DAgger rollouts (004): a learned grasp drives; for every state it visits, the reactive expert
 * (control/reactiveGrasp.ts) says what it would have done. The recorded episode keeps the learned
 * policy's own trajectory and output (`action`) with the expert's labels (`intent`, `gripIntent`),
 * so the next policy learns to recover from its own mistakes. No DOM: Node scripts use it.
 */
import { MANUAL } from "../control/modes";
import { reactiveAction } from "../control/reactiveGrasp";
import { isUpright, yawQuat } from "./cube";
import { createRecorder, type DemoEpisode, type DemoPlacement, type StepLabel } from "./recorder";
import type { Session } from "./session";

/**
 * From the reset state with the cube placed and settled, run `learner` and record one DAgger
 * episode. It ends as recorded episodes do (lift + 0.5 s, or the time limit), or as soon as the
 * cube is knocked over (no top-down label exists for a cube on its edge).
 */
export function recordDaggerEpisode(
  session: Session,
  opts: { id: string; learner: string; placement: DemoPlacement },
): DemoEpisode {
  const { sim, parity, arm, gripper } = session;
  const maxStep = parity.baseline.maxJointSpeed / parity.controlHz;
  session.setMode(MANUAL);
  session.reset();
  const { pos, yaw } = opts.placement;
  sim.setCubePose([pos[0], pos[1], parity.cube.size / 2], yawQuat(yaw));
  for (let k = 0; k < 0.2 * parity.controlHz; k++) session.controlStep();
  if (!session.setMode(opts.learner)) throw new Error(`"${opts.learner}" is not available`);

  const cube = { pose: () => sim.cubePose(), held: () => session.cubeHeld() };
  let label: StepLabel = { intent: [0, 0, 0, 0, 0], gripIntent: 0 };
  let done: DemoEpisode | null = null;
  const rec = createRecorder(session, parity, (e) => (done = e));
  rec.begin({ id: opts.id, placement: opts.placement, labeler: { label: () => label } });
  const max = (parity.grasp.success.timeLimit + 1) * parity.controlHz;
  for (let k = 0; k < max && !done; k++) {
    // The expert's label for the state this step starts from, as the recorder's intent is made:
    // the change after the speed and joint limits, over the per-step limit.
    const { delta, grip } = reactiveAction({ sim, parity, gripper, cube });
    const c = sim.ctrl();
    label = {
      intent: Array.from({ length: arm.n }, (_, j) => {
        const step = Math.min(maxStep, Math.max(-maxStep, delta[j]));
        const to = Math.min(arm.limits[2 * j + 1], Math.max(arm.limits[2 * j], c[j] + step));
        return (to - c[j]) / maxStep;
      }),
      gripIntent: grip === "closed" ? 1 : 0,
    };
    session.controlStep();
    if (!done && !isUpright(sim.cubePose().quat)) done = rec.stop();
  }
  rec.dispose();
  if (!done) throw new Error("the episode did not end");
  return done;
}
