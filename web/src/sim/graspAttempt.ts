/**
 * Grasp attempt monitor (004 research R7, data-model "Grasp attempt"). The session wraps every
 * controller with `task: "grasp"` in one, so every grasp (scripted, learned, a plug-in) is judged
 * the same way and none grades itself:
 *
 * - a non-graspable start placement is refused (`not-graspable`); the controller never runs;
 * - success is 002's GraspJudge (cube lifted and held for `hold` s within the time limit);
 * - a failure the controller reports itself (the scripted grasp's) ends the attempt with that
 *   reason; otherwise, at the time limit: never held and the cube moved → knocked, never held →
 *   missed, still held → timeout, held earlier → slipped;
 * - moving the cube cancels the attempt and stops the controller.
 *
 * The judge sees the state each control step starts from, before the controller acts: exactly
 * what the 002 scripted grasp fed its own judge, so its numbers are unchanged. Time is counted in
 * control steps (k / controlHz), so a replay elsewhere (training/reach/demos.py) gets the same
 * floats. The demonstration recorder uses the same judge (createAttemptJudge).
 */
import type { Controller, GraspFailure, GraspOutcome, GraspState } from "../control/modes";
import { isGraspable, type CubePose } from "./cube";
import { GraspJudge } from "./eval";
import type { Parity } from "./parity";

export interface AttemptJudgement {
  outcome: Exclude<GraspOutcome, "cancelled">;
  failure: GraspFailure | null;
  /** Start of the successful hold (s since the attempt started). */
  liftTime: number | null;
  /** When success was decided (s since the attempt started). */
  doneAt: number | null;
}

/** Success and failure classification of one attempt, fed once per control step. */
export interface AttemptJudge {
  /** Feed the state at `t` s since the attempt started; `reported` = a controller's own failure. */
  update(t: number, reported?: GraspFailure | null): void;
  state(): AttemptJudgement;
}

export function createAttemptJudge(
  parity: Parity,
  cube: { pose(): CubePose; held(): boolean },
  timeLimit = parity.grasp.success.timeLimit,
): AttemptJudge {
  const success = { ...parity.grasp.success, timeLimit };
  const judge = new GraspJudge(success, parity.cube.size / 2);
  const p0 = cube.pose().pos;
  const [x0, y0] = [p0[0], p0[1]];
  let heldEver = false;
  let maxTravel = 0;
  let failure: GraspFailure | null = null;
  let doneAt: number | null = null;
  return {
    update(t, reported = null) {
      if (failure !== null || doneAt !== null) return;
      const p = cube.pose().pos;
      const held = cube.held();
      heldEver ||= held;
      maxTravel = Math.max(maxTravel, Math.hypot(p[0] - x0, p[1] - y0));
      if (reported) {
        failure = reported;
      } else if (judge.update(t, p[2], held)) {
        doneAt = t;
      } else if (t > timeLimit + 1e-9) {
        failure = held
          ? "timeout"
          : heldEver
            ? "slipped"
            : maxTravel > parity.grasp.knockedDistance
              ? "knocked"
              : "missed";
      }
    },
    state: () => ({
      outcome: doneAt !== null ? "done" : failure ? "failed" : "running",
      failure,
      liftTime: doneAt !== null ? judge.liftTime : null,
      doneAt,
    }),
  };
}

export interface MonitoredGrasp extends Controller {
  graspState(): GraspState;
  /** The cube was moved by the visitor: end the attempt, stop the controller. */
  cancel(): void;
  /** The cube pose the current attempt started from (for Retry). */
  startPose(): CubePose | null;
}

export function monitorGrasp(
  id: string,
  inner: Controller,
  parity: Parity,
  cube: { pose(): CubePose; held(): boolean },
): MonitoredGrasp {
  let k = 0; // control steps since the attempt started
  let pose0: CubePose | null = null;
  let judge = createAttemptJudge(parity, cube);
  let refused = false;
  let cancelled = false;

  const reported = (): GraspFailure | null => {
    const s = inner.graspState?.();
    return s?.phase === "failed" ? s.failure : null;
  };

  const state = (): GraspState => {
    if (refused)
      return {
        controller: id,
        phase: "failed",
        outcome: "failed",
        failure: "not-graspable",
        liftTime: null,
      };
    const j = judge.state();
    // A failure the controller reports in this very step counts at once (002 timing).
    const failure = j.outcome === "running" ? reported() : j.failure;
    const outcome: GraspOutcome = cancelled
      ? "cancelled"
      : j.outcome === "done"
        ? "done"
        : failure
          ? "failed"
          : "running";
    const phase =
      inner.graspState?.().phase ??
      (outcome === "done" ? "done" : outcome === "running" ? "running" : "failed");
    return {
      controller: id,
      phase,
      outcome,
      failure: cancelled ? "cancelled" : outcome === "done" ? null : failure,
      liftTime: outcome === "done" ? j.liftTime : null,
    };
  };

  return {
    enter() {
      k = 0;
      const p = cube.pose();
      pose0 = { pos: Array.from(p.pos), quat: Array.from(p.quat) };
      judge = createAttemptJudge(parity, cube);
      refused = !isGraspable(p, parity);
      cancelled = false;
      if (!refused) inner.enter();
    },
    step() {
      if (refused || cancelled) return;
      judge.update(k++ / parity.controlHz, reported());
      inner.step();
    },
    inspect: inner.inspect?.bind(inner),
    graspState: state,
    cancel() {
      cancelled = true;
    },
    startPose: () => pose0,
  };
}
