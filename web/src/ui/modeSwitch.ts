/** Segmented control for the active controller (FR-010). The active mode is always visible. */
import type { ControlMode } from "../control/modes";

const LABELS: Record<ControlMode, string> = {
  manual: "Manual",
  baseline: "Baseline",
  learned: "Learned",
};

export interface ModeSwitch {
  /** Reflect the worker's mode (from snapshots or modeChanged). */
  show(mode: ControlMode): void;
}

export function createModeSwitch(
  toolbar: HTMLElement,
  modes: ControlMode[],
  onSelect: (mode: ControlMode) => void,
): ModeSwitch {
  const group = document.createElement("div");
  group.className = "segmented";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Controller");
  const buttons = new Map<ControlMode, HTMLButtonElement>();
  for (const mode of modes) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = LABELS[mode];
    b.dataset.mode = mode;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => onSelect(mode));
    buttons.set(mode, b);
    group.appendChild(b);
  }
  toolbar.prepend(group);
  let current: ControlMode | null = null;
  return {
    show(mode) {
      if (mode === current) return;
      current = mode;
      for (const [m, b] of buttons) b.setAttribute("aria-pressed", String(m === mode));
    },
  };
}
