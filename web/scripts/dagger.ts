/**
 * DAgger data (004): roll out the learned grasp exported in a shared/-shaped directory and label
 * every visited state with the reactive expert (src/sim/dagger.ts).
 *
 *   npm run dagger -- --shared <dir> [--seed 3000] [--n 400] --out <file.demos.jsonl.gz>
 *
 * Episode i uses placement graspPlacements(parity, 1, seed + i).
 */
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { parseArgs } from "node:util";
import { createGzip } from "node:zlib";
import { recordDaggerEpisode } from "../src/sim/dagger";
import { graspPlacements } from "../src/sim/eval";
import { demoHeader, demoLines, simSha256 } from "../src/sim/recorder";
import { createSession } from "../src/sim/session";
import { loadNodeSim, sharedReader } from "../tests/node-shared";

const { values } = parseArgs({
  options: {
    shared: { type: "string" },
    seed: { type: "string", default: "3000" },
    n: { type: "string", default: "400" },
    out: { type: "string" },
  },
});
if (!values.shared || !values.out) {
  console.error("pass --shared <dir with the learned grasp exported> and --out <file>");
  process.exit(2);
}
const seed = Number(values.seed);
const n = Number(values.n);
const t0 = performance.now();
const read = sharedReader(values.shared);
const { sim, parity, workspace } = await loadNodeSim(read);
const session = createSession(sim, parity, workspace, { read });
await session.ensureController("learned-grasp");
const simSha = await simSha256(parity);

const lines: string[] = [];
const summary: { source: "dagger"; outcome: { success: boolean } }[] = [];
let steps = 0;
for (let i = 0; i < n; i++) {
  const [p] = graspPlacements(parity, 1, seed + i);
  const ep = recordDaggerEpisode(session, {
    id: `dagger-${seed + i}`,
    learner: "learned-grasp",
    placement: { ...p, seed: seed + i, index: 0 },
  });
  steps += ep.steps.length;
  summary.push({ source: "dagger", outcome: ep.outcome });
  lines.push(demoLines(demoHeader(parity, simSha, [], ""), [ep])[1]);
}
sim.dispose();
const header = demoHeader(
  parity,
  simSha,
  summary as never,
  `dagger.ts --shared ${values.shared} --seed ${seed} --n ${n} (policy ${parity.graspPolicy?.sha256.slice(0, 12)})`,
);
const gz = createGzip({ level: 6 });
const file = gz.pipe(createWriteStream(values.out));
gz.write(JSON.stringify(header) + "\n");
for (const line of lines) if (!gz.write(line)) await once(gz, "drain");
gz.end();
await once(file, "finish");
const lifted = summary.filter((s) => s.outcome.success).length;
console.log(
  `dagger: ${n} episodes (${steps} labelled steps), the learner lifted ${lifted} ` +
    `(${((100 * lifted) / n).toFixed(0)}%) → ${values.out} in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
);
