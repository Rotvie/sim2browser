/**
 * Recording mode (004 US1, contracts/ui.md "Recording mode"): the demonstrator's start / stop /
 * keep / discard / save on top of the recorder. Placements come from seed 2000 in order (research
 * R8), so recorded episodes never start at an evaluation placement. No DOM: the worker hosts it.
 */
import { MANUAL } from "../control/modes";
import { yawQuat } from "./cube";
import { graspPlacements } from "./eval";
import type { Parity } from "./parity";
import {
  createRecorder,
  demoHeader,
  demoLines,
  simSha256,
  type DemoEpisode,
  type DemoOutcome,
  type DemoSource,
} from "./recorder";
import type { Session } from "./session";

export const HAND_SEED = 2000;

export type Counts = Record<"hand" | "scripted", { lifted: number; failed: number }>;

export interface RecordStatus {
  recording: boolean;
  /** Seconds recorded in the current episode. */
  elapsed: number;
  /** Index (seed 2000) of the placement being recorded, or the one the next Start uses. */
  next: number;
  /** The last ended episode, awaiting Keep / Discard. */
  last: { source: DemoSource; outcome: DemoOutcome; seconds: number } | null;
  kept: Counts;
}

export interface RecordingMode {
  start(): void;
  stop(): void;
  keep(): void;
  discard(): void;
  /** The cube is about to be teleported (reset, cube drag): end the episode as cancelled. */
  interrupt(): void;
  status(): RecordStatus;
  /** The kept episodes as file lines (uncompressed); null when nothing is kept. */
  fileLines(): Promise<string[] | null>;
}

export function createRecordingMode(
  session: Session,
  parity: Parity,
  onChange: () => void,
): RecordingMode {
  const kept: DemoEpisode[] = [];
  let discarded = 0;
  let last: DemoEpisode | null = null;
  const recorder = createRecorder(session, parity, (e) => {
    last = e;
    onChange();
  });
  const next = () => kept.length + discarded + (last ? 1 : 0);

  const counts = (): Counts => {
    const c: Counts = { hand: { lifted: 0, failed: 0 }, scripted: { lifted: 0, failed: 0 } };
    for (const e of kept)
      if (e.source !== "dagger") c[e.source][e.outcome.success ? "lifted" : "failed"]++;
    return c;
  };

  return {
    start() {
      if (last) {
        discarded++; // starting again without reviewing discards the last episode
        last = null;
      }
      recorder.stop();
      const index = next();
      const p = graspPlacements(parity, index + 1, HAND_SEED)[index];
      // Same start as the evaluation: reset, cube placed and settled 0.2 s, then the controller
      // that was selected (a grasp controller starts its attempt now).
      const mode = session.modes.mode;
      session.setMode(MANUAL);
      session.reset();
      session.sim.setCubePose([p.pos[0], p.pos[1], parity.cube.size / 2], yawQuat(p.yaw));
      for (let k = 0; k < 0.2 * parity.controlHz; k++) session.controlStep();
      session.setMode(mode);
      recorder.begin({
        id: `rec-${String(index).padStart(4, "0")}`,
        placement: { pos: [p.pos[0], p.pos[1]], yaw: p.yaw, seed: HAND_SEED, index },
      });
      onChange();
    },
    stop() {
      const e = recorder.stop();
      if (e) last = e;
      onChange();
    },
    keep() {
      if (last) kept.push(last);
      last = null;
      onChange();
    },
    discard() {
      if (last) discarded++;
      last = null;
      onChange();
    },
    interrupt() {
      if (recorder.recording) this.stop();
    },
    status: () => ({
      recording: recorder.recording,
      elapsed: recorder.elapsed(),
      next: next(),
      last: last && {
        source: last.source,
        outcome: last.outcome,
        seconds: last.steps.length / parity.controlHz,
      },
      kept: counts(),
    }),
    async fileLines() {
      if (!kept.length) return null;
      const header = demoHeader(parity, await simSha256(parity), kept, "record-mode");
      return demoLines(header, kept);
    },
  };
}
