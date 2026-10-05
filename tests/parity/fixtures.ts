/** Shared helpers for the parity tests (contracts/parity-fixture.md). */
import { readFileSync } from "node:fs";
import { SHARED_DIR } from "../../web/tests/node-shared";

export interface FixtureStep {
  /** trajectory/policy kinds: per-joint deltas (scaled by deltaScale). */
  action: number[];
  /** ctrl kind: absolute targets for every actuator, model order. */
  ctrl?: number[];
  qpos: number[];
  qvel: number[];
  obsRaw?: number[];
  obsNorm?: number[];
  policyAction?: number[];
}

export interface Fixture {
  fixtureVersion: number;
  parityJsonSha256: string;
  modelSha256: string;
  mujocoVersion: string;
  kind: "trajectory" | "policy" | "ctrl";
  init: { qpos: number[]; qvel: number[]; ctrl: number[]; target?: number[] };
  targetChanges?: { step: number; target: number[] }[];
  steps: FixtureStep[];
}

export const FIXTURES = [
  "trajectory-random.json",
  "trajectory-limits.json",
  "policy-recorded.json",
  "contact-random.json",
  "grasp-recorded.json",
];

export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(`${SHARED_DIR}parity/${name}`, "utf8"));
}

/** Max abs difference and its index. */
export function maxDiff(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): [number, number] {
  if (a.length !== b.length)
    throw new Error(`length ${a.length} != ${b.length}`);
  let worst = 0;
  let at = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (!(d <= worst)) {
      worst = d;
      at = i;
    }
  }
  return [worst, at];
}
