/**
 * A controller vs. the baseline, from web/eval/{baseline,<id>}.json (run `npm run eval` for both
 * first). The thresholds are the learned policy's success criteria (SC-004, SC-009); for other
 * controllers they are shown as a reference.
 *
 *   npm run eval:compare [-- --controller <id>] [--write-metrics]
 *
 * --write-metrics (learned only) records the numbers in shared/policy/reach.json for the info
 * panel. Always exits 0: shortfalls are reported, never hidden (research R12).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const SUCCESS_TARGET = 0.95; // SC-004
const JERK_RATIO_TARGET = 0.7; // SC-009: learned mean squared tip jerk at least 30% lower
const FLOOR_TARGET = 0.01; // 003 SC-003: at most 1% of episodes touch the floor
const CUBE_TARGET = 0.02; // 003 SC-003: at most 2% of episodes move the cube > 1 cm

const { values } = parseArgs({
  options: {
    controller: { type: "string", default: "learned" },
    "write-metrics": { type: "boolean", default: false },
  },
});
const id = values.controller!;
const evalDir = new URL("../eval/", import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(`${name}.json`, evalDir), "utf8"));
const baseline = load("baseline");
const learned = load(id);
if (baseline.seed !== learned.seed || baseline.n !== learned.n) {
  throw new Error(
    `reports use different targets: baseline seed ${baseline.seed} n ${baseline.n}, ` +
      `learned seed ${learned.seed} n ${learned.n}`,
  );
}

const jerkRatio = learned.meanSqTipJerk / baseline.meanSqTipJerk;
const verdict = (ok: boolean) => (ok ? "PASS" : "MISS");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`targets: ${learned.n} (seed ${learned.seed})`);
console.log(
  `SC-004 ${id} success ${pct(learned.successRate)} (target ≥ ${pct(SUCCESS_TARGET)}): ` +
    verdict(learned.successRate >= SUCCESS_TARGET),
);
console.log(
  `SC-009 jerk ratio ${id}/baseline ${jerkRatio.toFixed(3)} (target ≤ ${JERK_RATIO_TARGET}): ` +
    verdict(jerkRatio <= JERK_RATIO_TARGET),
);
if (learned.floorContactRate !== undefined) {
  console.log(
    `SC-003 (003) ${id} floor contact ${pct(learned.floorContactRate)} (target ≤ ${pct(FLOOR_TARGET)}): ` +
      `${verdict(learned.floorContactRate <= FLOOR_TARGET)}, cube moved ${pct(learned.cubeMovedRate)} ` +
      `(target ≤ ${pct(CUBE_TARGET)}): ${verdict(learned.cubeMovedRate <= CUBE_TARGET)}; ` +
      `baseline floor ${pct(baseline.floorContactRate)}, cube ${pct(baseline.cubeMovedRate)}`,
  );
}
console.log(
  `settle p50 ${id} ${learned.settleTimeP50?.toFixed(2)} s vs baseline ${baseline.settleTimeP50?.toFixed(2)} s; ` +
    `baseline success ${pct(baseline.successRate)}`,
);

if (values["write-metrics"]) {
  if (id !== "learned") throw new Error("--write-metrics applies to the learned policy only");
  const path = new URL("../../shared/policy/reach.json", import.meta.url);
  const header = JSON.parse(readFileSync(path, "utf8"));
  header.metrics = {
    successRate: learned.successRate,
    jerkRatioVsBaseline: Number(jerkRatio.toFixed(4)),
    baselineSuccessRate: baseline.successRate,
    floorContactRate: learned.floorContactRate,
    cubeMovedRate: learned.cubeMovedRate,
    n: learned.n,
    seed: learned.seed,
  };
  writeFileSync(path, JSON.stringify(header, null, 2) + "\n");
  console.log("wrote metrics to shared/policy/reach.json");
}
