/**
 * Real-time control clock (research R13). Returns how many control steps are due; when behind by
 * more than `maxStepsPerTick`, excess time is dropped so the sim slows down instead of taking big
 * steps. Pausing resets the accumulator so resuming never produces a catch-up burst.
 */
export interface Clock {
  tick(nowMs: number): number;
  pause(): void;
  resume(nowMs: number): void;
  readonly paused: boolean;
}

export function createClock(opts: { controlHz: number; maxStepsPerTick?: number }): Clock {
  const periodMs = 1000 / opts.controlHz;
  const maxSteps = opts.maxStepsPerTick ?? 5;
  let last: number | null = null;
  let acc = 0;
  let paused = false;

  return {
    get paused() {
      return paused;
    },
    tick(nowMs) {
      if (paused) return 0;
      if (last === null) {
        last = nowMs;
        return 0;
      }
      acc += Math.max(0, nowMs - last);
      last = nowMs;
      let steps = Math.floor(acc / periodMs);
      if (steps > maxSteps) {
        steps = maxSteps;
        acc = 0;
      } else {
        acc -= steps * periodMs;
      }
      return steps;
    },
    pause() {
      paused = true;
    },
    resume(nowMs) {
      paused = false;
      last = nowMs;
      acc = 0;
    },
  };
}
