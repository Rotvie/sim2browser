/**
 * Task first, then who does it (004 contracts/ui.md "Task and controller"). Tabs choose the task
 * (Reach, Grasp); the toolbar then offers that task's slots: You (by hand), the engineered
 * controller, the learned one, and lab plug-ins with ?lab. Slots come from the registry (`task`,
 * `kind`, `public`), so a new controller appears in its task without UI changes.
 *
 * A slot names a worker mode. "You" is Manual for reaching (pose the joints) and the Baseline for
 * grasping (drag the target, open and close the gripper: 002 grasping by hand). When the worker
 * changes mode on its own (a target drag or gripper press hands a grasp over to the Baseline, a
 * joint grab to Manual), the task stays and "You" lights up.
 */
import type { ControlMode } from "../control/modes";
import { MANUAL } from "../control/modes";
import type { ControllerTask } from "../control/registry";

export interface ControllerInfo {
  id: ControlMode;
  label: string;
  short: string;
  description: string;
  public: boolean;
  task: ControllerTask;
  kind: "engineered" | "learned";
}

interface Slot {
  key: string;
  mode: ControlMode;
  task: ControllerTask;
  role: string;
  name: string;
  /** Accessible name (the controller's full name). */
  label: string;
  tip: string;
}

export const TASKS: {
  id: ControllerTask;
  label: string;
  subtitle: (learned: boolean) => string;
}[] = [
  {
    id: "reach",
    label: "Reach",
    subtitle: () => "Drag the blue target — the arm follows it.",
  },
  {
    id: "grasp",
    label: "Grasp",
    subtitle: (learned) =>
      learned
        ? "Pick up the cube: by hand, with the scripted grasp, or the learned one."
        : "Pick up the cube: by hand or with the scripted grasp.",
  },
];

/** The worker mode a task's "You" slot uses. */
const HAND_MODE: Record<ControllerTask, ControlMode> = { reach: MANUAL, grasp: "baseline" };

export interface TaskControls {
  readonly task: ControllerTask;
  /** Reflect the worker's mode (from snapshots or modeChanged). */
  show(mode: ControlMode): void;
  /** A controller is being created (spinner) or failed to load (disabled with a reason). */
  setState(id: ControlMode, state: "idle" | "loading" | "failed", reason?: string): void;
  /** True when the "You" slot of the current task is active. */
  byHand(): boolean;
}

export function createTaskControls(opts: {
  tabsRoot: HTMLElement;
  toolbar: HTMLElement;
  controllers: ControllerInfo[];
  initialTask: ControllerTask;
  /** The visitor picked a slot (or a task, which picks its default slot). */
  onSelect: (mode: ControlMode) => void;
  onTask: (task: ControllerTask) => void;
}): TaskControls {
  const slots: Slot[] = [];
  for (const t of TASKS) {
    slots.push({
      key: `${t.id}:hand`,
      mode: HAND_MODE[t.id],
      task: t.id,
      role: "You",
      name: t.id === "reach" ? "Pose joints" : "By hand",
      label: t.id === "reach" ? "Manual" : "By hand",
      tip:
        t.id === "reach"
          ? "You: drag the arm's joints to pose it."
          : "You: drag the target to move the arm, open and close the gripper (G).",
    });
    for (const c of opts.controllers.filter((c) => c.task === t.id)) {
      const role = !c.public ? "Lab" : c.kind === "learned" ? "Learned" : "Engineered";
      slots.push({
        key: `${t.id}:${c.id}`,
        mode: c.id,
        task: t.id,
        role,
        name: c.short,
        label: c.label,
        tip: `${c.label}: ${c.description}`,
      });
    }
  }
  const tasks = TASKS.filter((t) => slots.some((s) => s.task === t.id && s.role !== "You"));

  // Tabs.
  const tabs = document.createElement("div");
  tabs.className = "task-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Task");
  const tabButtons = new Map<ControllerTask, HTMLButtonElement>();
  for (const t of tasks) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.textContent = t.label;
    b.addEventListener("click", () => setTask(t.id, true));
    tabButtons.set(t.id, b);
    tabs.appendChild(b);
  }
  opts.tabsRoot.appendChild(tabs);

  // Slots, one segmented control (only the current task's slots are shown).
  const root = document.createElement("div");
  root.className = "segmented slots";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Controller");
  const buttons = new Map<string, HTMLButtonElement>();
  for (const s of slots) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "slot";
    b.dataset.mode = s.mode;
    b.dataset.role = s.role.toLowerCase();
    b.setAttribute("aria-label", s.label);
    b.setAttribute("aria-pressed", "false");
    b.title = s.tip;
    b.innerHTML = `<span class="slot-role"></span><span class="slot-name"></span>`;
    b.querySelector(".slot-role")!.textContent = s.role;
    b.querySelector(".slot-name")!.textContent = s.name;
    b.addEventListener("click", () => opts.onSelect(s.mode));
    buttons.set(s.key, b);
    root.appendChild(b);
  }
  opts.toolbar.prepend(root);

  let task: ControllerTask = tasks.some((t) => t.id === opts.initialTask)
    ? opts.initialTask
    : "reach";
  let mode: ControlMode | null = null;

  /** The slot of the current task that the worker's mode corresponds to. */
  const slotFor = (m: ControlMode): Slot | undefined =>
    slots.find((s) => s.task === task && s.mode === m && s.role !== "You") ??
    slots.find((s) => s.task === task && s.role === "You");

  const render = () => {
    for (const [t, b] of tabButtons) b.setAttribute("aria-selected", String(t === task));
    const active = mode === null ? undefined : slotFor(mode);
    for (const s of slots) {
      const b = buttons.get(s.key)!;
      b.hidden = s.task !== task;
      b.setAttribute("aria-pressed", String(s === active));
    }
  };

  const setTask = (t: ControllerTask, user: boolean) => {
    if (t === task && !user) return;
    task = t;
    render();
    opts.onTask(t);
    if (user) {
      // Each task opens on its engineered controller (the baseline it is compared against).
      const first = slots.find((s) => s.task === t && s.role === "Engineered");
      opts.onSelect((first ?? slots.find((s) => s.task === t)!).mode);
    }
  };

  render();
  return {
    get task() {
      return task;
    },
    show(m) {
      mode = m;
      // A grasp controller running while Reach is shown (e.g. started by recording mode).
      const own = slots.find((s) => s.mode === m && s.role !== "You");
      if (own && own.task !== task && own.task === "grasp") setTask("grasp", false);
      render();
      this.setState(m, "idle");
    },
    setState(id, state, reason) {
      for (const s of slots.filter((s) => s.mode === id && s.role !== "You")) {
        const b = buttons.get(s.key)!;
        b.classList.toggle("loading", state === "loading");
        b.setAttribute("aria-busy", String(state === "loading"));
        b.disabled = state === "failed";
        b.title = state === "failed" ? `${s.label} could not be loaded: ${reason ?? ""}` : s.tip;
      }
    },
    byHand() {
      return mode !== null && slotFor(mode)?.role === "You";
    },
  };
}
