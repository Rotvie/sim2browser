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
  done: "Lifted ✓",
};

const FAILURE: Record<GraspFailure, string> = {
  "not-graspable": "cube out of reach",
  missed: "missed the cube",
  slipped: "cube slipped",
  knocked: "knocked the cube",
  timeout: "took too long",
};

export interface GraspStatus {
  /** From each snapshot: the grasp state, or undefined when the grasp is not in charge. */
  show(state: GraspState | undefined): void;
}

export function createGraspStatus(root: HTMLElement, onRegrasp: () => void): GraspStatus {
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
  el.append(text, again);
  root.appendChild(el);
  let last = "";
  return {
    show(state) {
      const key = state ? `${state.phase}:${state.failure}` : "";
      if (key === last) return;
      last = key;
      el.hidden = !state;
      if (!state) return;
      const ended = state.phase === "done" || state.phase === "failed";
      text.textContent =
        state.phase === "failed" ? `Failed: ${FAILURE[state.failure!]}` : PHASE[state.phase];
      el.dataset.phase = state.phase;
      again.hidden = !ended;
    },
  };
}
