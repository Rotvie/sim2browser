/**
 * Record one scripted grasp's commands for the contact parity fixture (002
 * contracts/parity-fixture.md): cube at its default position, turned 0.3 rad, the grasp from the
 * reset state through `done` + 0.5 s. Writes shared/parity/grasp-actions.json (input only); then
 * `uv run python -m reach.make_fixtures` replays it in Python to write grasp-recorded.json.
 *
 *   npx tsx scripts/record-grasp.ts
 */
import { writeFileSync } from "node:fs";
import { yawQuat } from "../src/sim/cube";
import { createSession } from "../src/sim/session";
import { loadNodeSim, readShared, SHARED_DIR } from "../tests/node-shared";

const YAW = 0.3;
const { sim, parity, workspace } = await loadNodeSim();
const s = createSession(sim, parity, workspace, { read: readShared });
await s.ensureController("grasp");
const [x, y, z] = parity.cube.defaultPose.pos;
sim.setCubePose([x, y, z], yawQuat(YAW));
for (let k = 0; k < 0.2 * parity.controlHz; k++) s.controlStep(); // let the cube settle
const copy = (a: unknown) => Array.from(a as Float64Array);
const init = { qpos: copy(sim.data.qpos), qvel: copy(sim.data.qvel), ctrl: copy(sim.data.ctrl) };
s.setMode("grasp");
const steps: { ctrl: number[] }[] = [];
let after = -1;
for (let k = 0; k < (parity.grasp.success.timeLimit + 1) * parity.controlHz; k++) {
  s.controlStep();
  steps.push({ ctrl: copy(sim.data.ctrl) });
  if (after < 0 && s.snapshot().grasp!.phase === "done") after = 0.5 * parity.controlHz;
  if (after >= 0 && after-- === 0) break;
}
const state = s.snapshot().grasp!;
if (state.phase !== "done") {
  console.error(`the recorded grasp did not succeed (${state.phase}, ${state.failure})`);
  process.exit(1);
}
const out = `${SHARED_DIR}parity/grasp-actions.json`;
writeFileSync(out, JSON.stringify({ kind: "ctrl-input", cubeYaw: YAW, init, steps }) + "\n");
console.log(`wrote ${out}: ${steps.length} steps, lifted at ${state.liftTime?.toFixed(2)} s`);
sim.dispose();
