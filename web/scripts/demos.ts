/**
 * Headless grasp demonstrations for training (004 research R1/R2, contracts/demo-file.md): runs a
 * grasp controller on the same Session the worker uses and records every episode, with DART noise
 * levels cycled over the episodes.
 *
 *   npm run demos -- [--controller grasp] [--seed 1000] [--n 2000] [--noise 0,0.1,0.2,0.3]
 *                    [--out ../training/demos/scripted-s<seed>-n<n>.demos.jsonl.gz]
 *
 * Episode i uses placement graspPlacements(parity, 1, seed + i) and noise level i mod #levels.
 */
import { once } from "node:events";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { createGzip } from "node:zlib";
import { CONTROLLERS } from "../src/control/registry";
import { graspPlacements } from "../src/sim/eval";
import { demoHeader, demoLines, recordGraspEpisode, simSha256 } from "../src/sim/recorder";
import { createSession } from "../src/sim/session";
import { loadNodeSim, readShared, SHARED_DIR } from "../tests/node-shared";

const { values } = parseArgs({
  options: {
    controller: { type: "string", default: "grasp" },
    seed: { type: "string", default: "1000" },
    n: { type: "string", default: "2000" },
    noise: { type: "string", default: "0,0.1,0.2,0.3" },
    out: { type: "string" },
  },
});
const id = values.controller!;
const seed = Number(values.seed);
const n = Number(values.n);
const levels = values.noise!.split(",").map(Number);
const out = values.out ?? `${SHARED_DIR}../training/demos/scripted-s${seed}-n${n}.demos.jsonl.gz`;
if (CONTROLLERS.find((d) => d.id === id)?.task !== "grasp") {
  console.error(`"${id}" is not a grasp controller`);
  process.exit(2);
}

const t0 = performance.now();
const { sim, parity, workspace } = await loadNodeSim();
const session = createSession(sim, parity, workspace, { read: readShared });
await session.ensureController(id);
const simSha = await simSha256(parity);

// The header needs the counts, so episodes are recorded first (they are kept compact in memory
// as JSON lines), then streamed through gzip.
const lines: string[] = [];
const counts = new Map(levels.map((l) => [l, { lifted: 0, failed: 0 }]));
const episodes = [];
for (let i = 0; i < n; i++) {
  const [p] = graspPlacements(parity, 1, seed + i);
  const noise = levels[i % levels.length];
  const ep = recordGraspEpisode(session, {
    id: `${id}-${seed + i}`,
    controller: id,
    placement: { ...p, seed: seed + i, index: 0 },
    noise,
  });
  counts.get(noise)![ep.outcome.success ? "lifted" : "failed"]++;
  lines.push(demoLines(demoHeader(parity, simSha, [], ""), [ep])[1]);
  episodes.push({ source: ep.source, outcome: ep.outcome }); // for the header counts
  if ((i + 1) % 200 === 0) console.log(`${i + 1}/${n} episodes`);
}
sim.dispose();

const header = demoHeader(
  parity,
  simSha,
  episodes as never,
  `demos.ts --controller ${id} --seed ${seed} --n ${n} --noise ${levels.join(",")}`,
);
mkdirSync(dirname(out), { recursive: true });
const gz = createGzip({ level: 6 });
const file = gz.pipe(createWriteStream(out));
gz.write(JSON.stringify(header) + "\n");
for (const line of lines) if (!gz.write(line)) await once(gz, "drain");
gz.end();
await once(file, "finish");

for (const [l, c] of counts) console.log(`noise ${l}: ${c.lifted} lifted, ${c.failed} failed`);
console.log(`wrote ${out} (${n} episodes) in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
