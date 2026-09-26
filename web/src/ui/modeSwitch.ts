/** Segmented control for the active controller (FR-010). The active mode is always visible. */
import type { ControlMode } from "../control/modes";

export interface ModeOption {
  id: ControlMode;
  label: string;
}

export interface ModeSwitch {
  /** Reflect the worker's mode (from snapshots or modeChanged). */
  show(mode: ControlMode): void;
  /** A controller is being created (spinner) or failed to load (disabled with a reason). */
  setState(id: ControlMode, state: "idle" | "loading" | "failed", reason?: string): void;
}

export function createModeSwitch(
  toolbar: HTMLElement,
  options: ModeOption[],
  onSelect: (mode: ControlMode) => void,
): ModeSwitch {
  const group = document.createElement("div");
  group.className = "segmented";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Controller");
  const buttons = new Map<ControlMode, HTMLButtonElement>();
  for (const { id, label } of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.dataset.mode = id;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => onSelect(id));
    buttons.set(id, b);
    group.appendChild(b);
  }
  toolbar.prepend(group);
  let current: ControlMode | null = null;
  const api: ModeSwitch = {
    show(mode) {
      if (mode === current) return;
      current = mode;
      for (const [m, b] of buttons) b.setAttribute("aria-pressed", String(m === mode));
      api.setState(mode, "idle");
    },
    setState(id, state, reason) {
      const b = buttons.get(id);
      if (!b) return;
      b.classList.toggle("loading", state === "loading");
      b.setAttribute("aria-busy", String(state === "loading"));
      b.disabled = state === "failed";
      b.title = state === "failed" ? `${b.textContent} could not be loaded: ${reason ?? ""}` : "";
    },
  };
  return api;
}
