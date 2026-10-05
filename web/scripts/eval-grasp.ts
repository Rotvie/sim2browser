/**
 * Headless evaluation of the scripted grasp on the shipped code path (002 SC-003, SC-004,
 * contracts/grasp-eval.md). Writes the GraspEvalReport the info panel shows.
 *
 *   npm run eval:grasp -- [--n 100] [--seed 0] [--out ../shared/grasp-eval.json] [--check]
 *
 * --check recomputes and exits non-zero if the result differs from the committed file (CI).
 * Otherwise always exits 0: shortfalls are reported, never hidden.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { sha256Hex } from "../src/sim/hash";
import { graspPlacements, runGraspEpisode } from "../src/sim/eval";
import { createSession } from "../src/sim/session";
import { loadNodeSim, readShared, SHARED_DIR } from "../tests/node-shared";

const SUCCESS_TARGET = 0.9; // SC-003
const TIME_TARGET = 6; // SC-004, seconds

const { values } = parseArgs({
  options: {
    n: { type: "string", default: "100" },
    seed: { type: "string", default: "0" },
    out: { type: "string", default: `${SHARED_DIR}grasp-eval.json` },
    check: { type: "boolean", default: false },
  },
});
const n = Number(values.n);
const seed = Number(values.seed);

const { sim, parity, workspace } = await loadNodeSim();
const session = createSession(sim, parity, workspace, { read: readShared });
await session.ensureController("grasp");
const placements = graspPlacements(parity, n, seed).map((p) => ({
  ...p,
  ...runGraspEpisode(session, p),
}));
sim.dispose();

const times = placements.flatMap((p) => (p.success ? [p.timeToLift!] : [])).sort((a, b) => a - b);
const median = times.length
  ? times.length % 2
    ? times[(times.length - 1) / 2]
    : (times[times.length / 2 - 1] + times[times.length / 2]) / 2
  : null;
const failures: Record<string, number> = { missed: 0, slipped: 0, knocked: 0, timeout: 0 };
for (const p of placements) if (p.failure) failures[p.failure] = (failures[p.failure] ?? 0) + 1;
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const report = {
  version: 1,
  parityJsonSha256: await sha256Hex(await readShared("parity.json")),
  n,
  seed,
  successRate: placements.filter((p) => p.success).length / n,
  medianTimeToLift: median === null ? null : round(median),
  failures,
  placements: placements.map((p) => ({
    pos: [round(p.pos[0]), round(p.pos[1])],
    yaw: round(p.yaw),
    success: p.success,
    timeToLift: p.timeToLift === null ? null : round(p.timeToLift),
    failure: p.failure,
  })),
};
const text = JSON.stringify(report, null, 2) + "\n";
const verdict = (ok: boolean) => (ok ? "PASS" : "MISS");
console.log(
  `grasp: ${(report.successRate * 100).toFixed(1)}% of ${n} (seed ${seed}) ` +
    `[${verdict(report.successRate >= SUCCESS_TARGET)} ≥ ${SUCCESS_TARGET * 100}%], ` +
    `median time to lift ${median?.toFixed(2) ?? "–"} s ` +
    `[${verdict(median !== null && median <= TIME_TARGET)} ≤ ${TIME_TARGET} s], ` +
    `failures ${JSON.stringify(failures)}`,
);
if (values.check) {
  const committed = readFileSync(values.out!, "utf8");
  if (committed !== text) {
    console.error(`${values.out} differs from this run: re-run npm run eval:grasp and commit it`);
    process.exit(1);
  }
  console.log(`${values.out} reproduced exactly`);
} else {
  writeFileSync(values.out!, text);
  console.log(`wrote ${values.out}`);
}
