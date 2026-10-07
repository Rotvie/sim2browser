/**
 * Headless evaluation of a grasp controller on the shipped code path (002 SC-003/SC-004, 004
 * contracts/grasp-eval.md). Writes the GraspEvalReport (format 2) the info panel shows.
 *
 *   npm run eval:grasp -- [--controller grasp] [--n 100] [--seed 0] [--shared <dir>]
 *                         [--out ../shared/grasp-eval/<id>.json] [--check]
 *
 * Any controller with `task: "grasp"` in the registry works. --shared evaluates a candidate
 * exported to another shared/-shaped directory (model selection). --check recomputes and exits
 * non-zero if the result differs from the committed file (CI). Otherwise always exits 0:
 * shortfalls are reported, never hidden. Unknown or non-grasp controllers exit 2.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { CONTROLLERS } from "../src/control/registry";
import { sha256Hex } from "../src/sim/hash";
import { graspPlacements, runGraspEpisode } from "../src/sim/eval";
import { createSession } from "../src/sim/session";
import { loadNodeSim, SHARED_DIR, sharedReader } from "../tests/node-shared";

/** Targets per controller: [success rate, median time to lift (s)]. */
const TARGETS: Record<string, [number, number]> = {
  grasp: [0.9, 6], // 002 SC-003, SC-004
  "learned-grasp": [0.8, 8], // 004 FR-015 (release bar), SC-002
};

const { values } = parseArgs({
  options: {
    controller: { type: "string", default: "grasp" },
    n: { type: "string", default: "100" },
    seed: { type: "string", default: "0" },
    shared: { type: "string", default: SHARED_DIR },
    out: { type: "string" },
    check: { type: "boolean", default: false },
  },
});
const id = values.controller!;
const n = Number(values.n);
const seed = Number(values.seed);
const out = values.out ?? `${SHARED_DIR}grasp-eval/${id}.json`;

const def = CONTROLLERS.find((d) => d.id === id);
if (def?.task !== "grasp") {
  const grasps = CONTROLLERS.filter((d) => d.task === "grasp").map((d) => d.id);
  console.error(`"${id}" is not a grasp controller (grasp controllers: ${grasps.join(", ")})`);
  process.exit(2);
}

const read = sharedReader(values.shared);
const { sim, parity, workspace } = await loadNodeSim(read);
const session = createSession(sim, parity, workspace, { read });
await session.ensureController(id);
const placements = graspPlacements(parity, n, seed).map((p) => ({
  ...p,
  ...runGraspEpisode(session, p, id),
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
const policy = id === "learned-grasp" ? parity.graspPolicy : undefined;
const report = {
  version: 2,
  controller: id,
  task: "grasp",
  parityJsonSha256: await sha256Hex(await read("parity.json")),
  policySha256: policy?.sha256 ?? null,
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
const target = TARGETS[id];
console.log(
  `${id}: ${(report.successRate * 100).toFixed(1)}% of ${n} (seed ${seed})` +
    (target ? ` [${verdict(report.successRate >= target[0])} ≥ ${target[0] * 100}%]` : "") +
    `, median time to lift ${median?.toFixed(2) ?? "–"} s` +
    (target ? ` [${verdict(median !== null && median <= target[1])} ≤ ${target[1]} s]` : "") +
    `, failures ${JSON.stringify(failures)}`,
);
if (values.check) {
  const committed = readFileSync(out, "utf8");
  if (committed !== text) {
    console.error(`${out} differs from this run: re-run npm run eval:grasp and commit it`);
    process.exit(1);
  }
  console.log(`${out} reproduced exactly`);
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
