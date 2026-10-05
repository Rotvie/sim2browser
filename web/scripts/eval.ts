/**
 * Headless controller evaluation on the shipped code path (SC-003, SC-004, SC-009). Works for any
 * controller in web/src/control/registry.ts.
 *
 *   npm run eval -- --controller <id> --n 100 --seed 0 [--out path]
 *
 * Writes an EvalReport (data-model.md) to web/eval/<controller>.json and prints a summary.
 * Exits non-zero when the baseline misses SC-003 (successRate < 0.99).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { meanSqJerk, reachableTargets, runEpisode } from "../src/sim/eval";
import { createSession } from "../src/sim/session";
import { loadNodeSim, readShared } from "../tests/node-shared";

const { values } = parseArgs({
  options: {
    controller: { type: "string", default: "baseline" },
    n: { type: "string", default: "100" },
    seed: { type: "string", default: "0" },
    out: { type: "string" },
  },
});
const controller = values.controller!;
const n = Number(values.n);
const seed = Number(values.seed);
const out = values.out ?? new URL(`../eval/${controller}.json`, import.meta.url).pathname;

const { sim, parity, workspace } = await loadNodeSim();
const session = createSession(sim, parity, workspace, { read: readShared });
if (!session.controllers.some((c) => c.id === controller)) {
  const ids = session.controllers.map((c) => c.id).join(", ");
  throw new Error(`unknown controller "${controller}" (available: ${ids})`);
}
await session.ensureController(controller);
const targets = reachableTargets(sim, parity, n, seed);

const perTarget = [];
const settleTimes: number[] = [];
let jerkSum = 0;
for (const target of targets) {
  const r = runEpisode(session, controller, target);
  perTarget.push({
    target: Array.from(target),
    success: r.success,
    settleTime: r.settleTime,
    floor: r.floor,
    cubeMoved: r.cubeMoved,
  });
  jerkSum += meanSqJerk(r.tipTrace, parity.controlHz);
  if (r.settleTime !== null) settleTimes.push(r.settleTime);
}
sim.dispose();

const pct = (xs: number[], p: number) =>
  xs.length
    ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]
    : null;
const report = {
  controller,
  seed,
  n,
  successRate: perTarget.filter((t) => t.success).length / n,
  settleTimeP50: pct(settleTimes, 0.5),
  settleTimeP95: pct(settleTimes, 0.95),
  meanSqTipJerk: jerkSum / n,
  // 003 SC-003: episodes in which the arm touched the floor / moved the cube by more than 1 cm.
  floorContactRate: perTarget.filter((t) => t.floor).length / n,
  cubeMovedRate: perTarget.filter((t) => t.cubeMoved).length / n,
  perTarget,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

console.log(
  `${controller}: success ${(report.successRate * 100).toFixed(1)}% of ${n} (seed ${seed}), ` +
    `settle p50 ${report.settleTimeP50?.toFixed(2)} s, p95 ${report.settleTimeP95?.toFixed(2)} s, ` +
    `mean squared tip jerk ${report.meanSqTipJerk.toFixed(1)} m²/s⁶, ` +
    `floor ${(report.floorContactRate * 100).toFixed(1)}%, cube moved ${(report.cubeMovedRate * 100).toFixed(1)}% → ${out}`,
);
if (controller === "baseline" && report.successRate < 0.99) {
  console.error("SC-003 not met: baseline success rate below 99%");
  process.exit(1);
}
