/**
 * Controller picker (FR-010; 004: grouped by task). One segmented control per task ("Reach",
 * "Grasp"), in registry order, so a new controller lands in its task's group on its own. Inside a
 * group a button shows its short name; its accessible name is the full one ("Scripted grasp") and
 * its tooltip the registry description. The active mode is always visible.
 */
import type { ControlMode } from "../control/modes";
import type { ControllerTask } from "../control/registry";

export interface ModeOption {
  id: ControlMode;
  label: string;
  /** Shown inside the group; defaults to `label`. */
  short?: string;
  task: ControllerTask;
  description?: string;
}

export interface ModeSwitch {
  /** Reflect the worker's mode (from snapshots or modeChanged). */
  show(mode: ControlMode): void;
  /** A controller is being created (spinner) or failed to load (disabled with a reason). */
  setState(id: ControlMode, state: "idle" | "loading" | "failed", reason?: string): void;
}

const TASK_LABEL: Record<ControllerTask, string> = { reach: "Reach", grasp: "Grasp" };

export function createModeSwitch(
  toolbar: HTMLElement,
  options: ModeOption[],
  onSelect: (mode: ControlMode) => void,
): ModeSwitch {
  const root = document.createElement("div");
  root.className = "modes";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Controller");
  const buttons = new Map<ControlMode, HTMLButtonElement>();
  const tips = new Map<ControlMode, string>();
  for (const task of Object.keys(TASK_LABEL) as ControllerTask[]) {
    const opts = options.filter((o) => o.task === task);
    if (!opts.length) continue;
    const group = document.createElement("div");
    group.className = "mode-group";
    group.dataset.task = task;
    const label = document.createElement("span");
    label.className = "mode-group-label";
    label.textContent = TASK_LABEL[task];
    label.setAttribute("aria-hidden", "true");
    const seg = document.createElement("div");
    seg.className = "segmented";
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", TASK_LABEL[task]);
    for (const o of opts) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.short ?? o.label;
      if (o.short && o.short !== o.label) b.setAttribute("aria-label", o.label);
      b.dataset.mode = o.id;
      b.setAttribute("aria-pressed", "false");
      const tip = o.description ? `${o.label}: ${o.description}` : o.label;
      tips.set(o.id, tip);
      b.title = tip;
      b.addEventListener("click", () => onSelect(o.id));
      buttons.set(o.id, b);
      seg.appendChild(b);
    }
    group.append(label, seg);
    root.appendChild(group);
  }
  toolbar.prepend(root);
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
      b.title =
        state === "failed"
          ? `${b.getAttribute("aria-label") ?? b.textContent} could not be loaded: ${reason ?? ""}`
          : (tips.get(id) ?? "");
    },
  };
  return api;
}
