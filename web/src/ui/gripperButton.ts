/**
 * Open / close the gripper (002 contracts/ui.md). An action button: its label says what a click
 * does, and follows the worker's command (also when the grasp controller drives the gripper).
 * Key G does the same.
 */
import type { GripperCommand } from "../sim/parity";

export interface GripperButton {
  /** Reflect the command from the latest snapshot. */
  show(command: GripperCommand): void;
  /** Only the Grasp task uses the gripper (004); key G is ignored while hidden. */
  setVisible(on: boolean): void;
}

export function createGripperButton(
  toolbar: HTMLElement,
  onSet: (command: GripperCommand) => void,
): GripperButton {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  let current: GripperCommand | null = null;
  const toggle = () => onSet(current === "open" ? "closed" : "open");
  button.addEventListener("click", toggle);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "g" && e.key !== "G") return;
    if (button.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable]")) return;
    toggle();
  });
  toolbar.appendChild(button);
  const api: GripperButton = {
    setVisible(on) {
      button.hidden = !on;
    },
    show(command) {
      if (command === current) return;
      current = command;
      const open = command === "open";
      button.textContent = open ? "Close gripper" : "Open gripper";
      button.dataset.short = open ? "Close" : "Open";
      button.title = `${button.textContent} (G)`;
      button.dataset.gripper = command;
    },
  };
  api.show("closed");
  return api;
}
