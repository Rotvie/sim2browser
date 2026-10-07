/**
 * Grasp status chip (002 contracts/ui.md): the scripted grasp's phase while it is in charge,
 * the result when it ends, and "Grasp again". Hidden in every other mode.
 */
import type { GraspFailure, GraspPhase, GraspState } from "../control/modes";

const PHASE: Record<Exclude<GraspPhase, "failed">, string> = {
  approach: "Approaching",
  descend: "Descending",
  close: "Closing",
  lift: "Lifting",
  hold: "Holding",
  running: "Running",
  done: "Lifted ✓",
};

const FAILURE: Record<GraspFailure, string> = {
  "not-graspable": "cube out of reach",
  missed: "missed the cube",
  slipped: "cube slipped",
  knocked: "knocked the cube",
  timeout: "took too long",
  cancelled: "cancelled (cube moved)",
};

export interface GraspStatus {
  /** From each snapshot: the grasp state, or undefined when the grasp is not in charge. */
  show(state: GraspState | undefined): void;
}

export function createGraspStatus(
  root: HTMLElement,
  onRegrasp: () => void,
  onRetry: () => void,
): GraspStatus {
  const el = document.createElement("div");
  el.className = "grasp-status";
  el.setAttribute("role", "status");
  el.hidden = true;
  const text = document.createElement("span");
  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn small";
  again.textContent = "Grasp again";
  again.hidden = true;
  again.addEventListener("click", onRegrasp);
  // 004: the same placement again (after switching between the scripted and learned grasp).
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn small";
  retry.textContent = "Retry";
  retry.title = "Same cube placement, arm reset";
  retry.hidden = true;
  retry.addEventListener("click", onRetry);
  el.append(text, again, retry);
  root.appendChild(el);
  let last = "";
  return {
    show(state) {
      const key = state
        ? `${state.controller}:${state.phase}:${state.outcome}:${state.failure}`
        : "";
      if (key === last) return;
      last = key;
      el.hidden = !state;
      if (!state) return;
      const ended = state.outcome !== "running";
      text.textContent =
        state.outcome === "failed" || state.outcome === "cancelled"
          ? `Failed: ${FAILURE[state.failure!]}`
          : state.outcome === "done"
            ? PHASE.done
            : PHASE[state.phase as Exclude<GraspPhase, "failed">];
      el.dataset.phase =
        state.outcome === "done" ? "done" : state.outcome === "running" ? state.phase : "failed";
      again.hidden = !ended;
      retry.hidden = !ended;
    },
  };
}
