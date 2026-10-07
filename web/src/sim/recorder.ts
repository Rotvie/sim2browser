/**
 * Grasp demonstration recorder (004 research R1–R3, contracts/demo-file.md). Records whatever
 * drives the session, step by step, as raw simulator state: hand-driven episodes in the browser's
 * recording mode (`?record`) and scripted ones headless (`npm run demos`). The file it produces
 * holds no policy observations, so any learner can read it.
 *
 * Noise injection (DART, research R2): with `noise` > 0 the arm's joint-target changes are
 * perturbed by Gaussian noise (σ = noise × the per-step joint limit; Wrist_Roll on a random share
 * of steps only, see ROLL_NOISE_SHARE) while the recorded label (`intent`) is the controller's own
 * change, as the joint limits would have let it happen. The gripper is never perturbed.
 *
 * No DOM or worker imports: the worker, Node scripts and tests share it. Compression is the
 * caller's (CompressionStream in the worker, zlib in Node).
 */
import type { GraspFailure } from "../control/modes";
import { MANUAL } from "../control/modes";
import { yawQuat } from "./cube";
import { mulberry32 } from "./eval";
import { createAttemptJudge, type AttemptJudge } from "./graspAttempt";
import { sha256Hex } from "./hash";
import type { Parity } from "./parity";
import type { Session } from "./session";

/** Time limit for an episode not driven by a grasp controller (s). */
export const HAND_TIME_LIMIT = 60;
/**
 * Wrist_Roll (the last arm joint) is perturbed on this share of steps only. The scripted grasp
 * waits for it to reach its set point exactly before descending: noise on every step stalls it
 * in its approach phase, no noise at all leaves the learner without a single roll correction to
 * copy (validation.md, 2026-10-07). It corrects a perturbed roll on the next clean step.
 */
const ROLL_NOISE_SHARE = 0.3;
/** Recording continues this long after a successful lift (s). */
export const AFTER_LIFT = 0.5;

export interface DemoStep {
  /** Actuator targets applied for this step (arm joints, then jaw). */
  ctrl: number[];
  /** Gripper command during the step: 1 closed, 0 open. */
  grip: 0 | 1;
  /**
   * The label for the arm joints: the driving controller's joint-target change / per-step limit
   * (noise-injected episodes), or an expert's for this state (DAgger episodes).
   */
  intent?: number[];
  /** DAgger episodes: the expert's gripper command for this state (1 closed, 0 open). */
  gripIntent?: 0 | 1;
  /** DAgger episodes: the driving policy's own output (its next `prevAction`). */
  action?: number[];
  /** State after the step. */
  qpos: number[];
  qvel: number[];
}

export type DemoSource = "hand" | "scripted" | "dagger";

/** A DAgger episode's labels for the coming step (computed before the policy acts). */
export interface StepLabel {
  intent: number[];
  gripIntent: 0 | 1;
}

export interface DemoPlacement {
  pos: [number, number];
  yaw: number;
  /** `graspPlacements` seed and index, or null when the demonstrator moved the cube. */
  seed: number | null;
  index: number | null;
}

export interface DemoOutcome {
  success: boolean;
  timeToLift: number | null;
  failure: GraspFailure | null;
}

export interface DemoEpisode {
  id: string;
  /** "dagger": a learned policy drove, an expert labelled every state (004 DAgger). */
  source: DemoSource;
  /** Controller in charge at the start (hand episodes may switch). */
  controller: string;
  placement: DemoPlacement;
  noise: number;
  /** Attempt time limit (s): the grasp limit if a grasp controller was in charge at the start. */
  timeLimit: number;
  start: { qpos: number[]; qvel: number[]; ctrl: number[] };
  steps: DemoStep[];
  outcome: DemoOutcome;
}

export interface DemoHeader {
  kind: "sim2browser-demos";
  format: 1;
  simSha256: string;
  parityVersion: number;
  mujocoVersion: string;
  controlHz: number;
  sizes: { nq: number; nv: number; nu: number };
  counts: Record<string, { lifted: number; failed: number }>;
  created: string;
  generator: string;
}

/** JSON with sorted keys and no whitespace (same bytes as Python's sort_keys + compact). */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(",")}]`;
  if (x && typeof x === "object")
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(x);
}

/** Identity of the physics demonstrations depend on; policy and evaluation sections excluded. */
export function simSha256(parity: Parity): Promise<string> {
  const { model, mujocoVersion, timestep, substeps, controlHz, gripper, cube } = parity;
  const subset = {
    model: { sha256: model.sha256 },
    mujocoVersion,
    timestep,
    substeps,
    controlHz,
    gripper,
    cube,
  };
  return sha256Hex(new TextEncoder().encode(canonicalJson(subset)));
}

export function demoHeader(
  parity: Parity,
  simSha: string,
  episodes: DemoEpisode[],
  generator: string,
  sizes = { nq: 13, nv: 12, nu: 6 },
): DemoHeader {
  const counts: Record<string, { lifted: number; failed: number }> = {
    hand: { lifted: 0, failed: 0 },
    scripted: { lifted: 0, failed: 0 },
  };
  for (const e of episodes) {
    counts[e.source] ??= { lifted: 0, failed: 0 };
    counts[e.source][e.outcome.success ? "lifted" : "failed"]++;
  }
  return {
    kind: "sim2browser-demos",
    format: 1,
    simSha256: simSha,
    parityVersion: parity.version,
    mujocoVersion: parity.mujocoVersion,
    controlHz: parity.controlHz,
    sizes,
    counts,
    created: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    generator,
  };
}

/** The file's lines (newline-terminated), uncompressed. */
export function demoLines(header: DemoHeader, episodes: DemoEpisode[]): string[] {
  return [header, ...episodes].map((x) => JSON.stringify(x) + "\n");
}

export interface Recorder {
  readonly recording: boolean;
  /**
   * Start an episode from the current state (the start state is captured now). With `labeler`,
   * a DAgger episode: `labeler.label()` returns the expert's label for the step just taken (the
   * caller computes it from the state before the step).
   */
  begin(opts: {
    id: string;
    placement: DemoPlacement;
    noise?: number;
    labeler?: { label(): StepLabel };
  }): void;
  /** End the current episode now (outcome so far, or "cancelled"); null when not recording. */
  stop(): DemoEpisode | null;
  /** Seconds recorded so far in the current episode. */
  elapsed(): number;
  dispose(): void;
}

/**
 * Records the session's control steps. An episode ends by itself `AFTER_LIFT` s after a
 * successful lift, or when the attempt fails (time limit: the grasp limit when a grasp controller
 * is in charge at the start, else HAND_TIME_LIMIT; or a failure the grasp controller reports),
 * and is then passed to `onEnd`. `stop()` ends it at once.
 */
export function createRecorder(
  session: Session,
  parity: Parity,
  onEnd: (episode: DemoEpisode) => void,
): Recorder {
  const { sim, arm, gripper } = session;
  const n = arm.n;
  const maxStep = parity.baseline.maxJointSpeed / parity.controlHz;
  const copy = (a: ArrayLike<number>) => Array.from(a);
  const cube = { pose: () => sim.cubePose(), held: () => session.cubeHeld() };

  let ep: DemoEpisode | null = null;
  let judge: AttemptJudge | null = null;
  let handSteps = 0;
  let intent: Float64Array | null = null;
  let gauss: (() => number) | null = null;
  let rand: (() => number) | null = null;
  let labeler: { label(): StepLabel } | null = null;
  const applyDelta = arm.applyDelta;

  /** Joint-target changes: record the intended change, apply it with noise (if any). */
  const noisyApplyDelta = (noise: number) => (delta: ArrayLike<number>, maxPerStep: number) => {
    const c = sim.ctrl();
    const d = new Float64Array(n);
    const rollNoise = rand!() < ROLL_NOISE_SHARE;
    for (let j = 0; j < n; j++) {
      // The change the controller would have made (speed limit, then joint limits).
      const step = Math.min(maxPerStep, Math.max(-maxPerStep, delta[j]));
      const to = Math.min(arm.limits[2 * j + 1], Math.max(arm.limits[2 * j], c[j] + step));
      intent![j] += to - c[j];
      d[j] = step + (j < n - 1 || rollNoise ? noise * maxStep * gauss!() : 0);
    }
    applyDelta.call(arm, d, maxPerStep);
  };

  const outcome = (cancelled: boolean): DemoOutcome => {
    const j = judge!.state();
    if (j.outcome === "done") return { success: true, timeToLift: j.liftTime, failure: null };
    return { success: false, timeToLift: null, failure: cancelled ? "cancelled" : j.failure };
  };

  const finish = (cancelled: boolean): DemoEpisode => {
    const e = ep!;
    e.outcome = outcome(cancelled);
    e.source = labeler ? "dagger" : handSteps > 0 ? "hand" : "scripted";
    ep = null;
    judge = null;
    arm.applyDelta = applyDelta;
    return e;
  };

  const afterStep = () => {
    if (!ep) return;
    const step: DemoStep = {
      ctrl: copy(sim.data.ctrl),
      grip: gripper.command === "closed" ? 1 : 0,
      qpos: copy(sim.data.qpos),
      qvel: copy(sim.data.qvel),
    };
    if (intent) {
      step.intent = Array.from(intent, (v) => Math.min(1, Math.max(-1, v / maxStep)));
      intent.fill(0);
    }
    if (labeler) {
      const l = labeler.label();
      step.intent = l.intent;
      step.gripIntent = l.gripIntent;
      const own = session.modes.controller.inspect?.(true);
      if (own) step.action = Array.from(own.action);
    }
    ep.steps.push(step);
    const inGrasp = session.inGrasp();
    if (!inGrasp) handSteps++;
    const own = inGrasp ? session.modes.controller.graspState?.() : undefined;
    const t = ep.steps.length / parity.controlHz;
    judge!.update(t, own?.phase === "failed" ? own.failure : null);
    const j = judge!.state();
    if (j.outcome === "failed" || (j.doneAt !== null && t >= j.doneAt + AFTER_LIFT - 1e-9))
      onEnd(finish(false));
  };
  const unsubscribe = session.onStep(afterStep);

  return {
    get recording() {
      return ep !== null;
    },
    begin({ id, placement, noise = 0, labeler: l }) {
      if (ep) finish(true);
      labeler = l ?? null;
      const limit = session.inGrasp() ? parity.grasp.success.timeLimit : HAND_TIME_LIMIT;
      judge = createAttemptJudge(parity, cube, limit);
      handSteps = 0;
      ep = {
        id,
        source: "scripted",
        controller: session.modes.mode,
        placement,
        noise,
        timeLimit: limit,
        start: { qpos: copy(sim.data.qpos), qvel: copy(sim.data.qvel), ctrl: copy(sim.data.ctrl) },
        steps: [],
        outcome: { success: false, timeToLift: null, failure: null },
      };
      if (noise > 0) {
        const r = mulberry32((placement.seed ?? 0) * 7919 + 17);
        rand = r;
        gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
        intent = new Float64Array(n);
        arm.applyDelta = noisyApplyDelta(noise);
      } else {
        gauss = null;
        intent = null;
      }
    },
    stop: () => (ep ? finish(true) : null),
    elapsed: () => (ep ? ep.steps.length / parity.controlHz : 0),
    dispose() {
      if (ep) finish(true);
      unsubscribe();
    },
  };
}

/**
 * Headless: from the reset state, place the cube, let it settle 0.2 s, select `controller` and
 * record one episode until it ends (as the evaluation runs an attempt).
 */
export function recordGraspEpisode(
  session: Session,
  opts: { id: string; controller: string; placement: DemoPlacement; noise: number },
): DemoEpisode {
  const { sim, parity } = session;
  session.setMode(MANUAL);
  session.reset();
  const { pos, yaw } = opts.placement;
  sim.setCubePose([pos[0], pos[1], parity.cube.size / 2], yawQuat(yaw));
  for (let k = 0; k < 0.2 * parity.controlHz; k++) session.controlStep();
  if (!session.setMode(opts.controller)) throw new Error(`"${opts.controller}" is not available`);
  let done: DemoEpisode | null = null;
  const rec = createRecorder(session, parity, (e) => (done = e));
  rec.begin(opts);
  const max = (HAND_TIME_LIMIT + 1) * parity.controlHz;
  for (let k = 0; k < max && !done; k++) session.controlStep();
  rec.dispose();
  if (!done) throw new Error("the episode did not end");
  return done;
}
