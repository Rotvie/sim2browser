/**
 * First-visit hint (FR-017): an animated marker on the part to drag, gone after the first
 * interaction and not shown again during the page session.
 */
const KEY = "web-robot:interacted";

function seen(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the hint just reappears.
  }
}

export interface Hint {
  /** Position in CSS pixels relative to the canvas, or null to hide for this frame. */
  place(pos: [number, number] | null): void;
  dismiss(): void;
}

export function createHint(root: HTMLElement, label: string): Hint {
  const el = document.createElement("div");
  el.className = "hint";
  el.setAttribute("aria-hidden", "true");
  const dot = document.createElement("div");
  dot.className = "hint-dot";
  const text = document.createElement("div");
  text.className = "hint-label";
  text.textContent = label;
  el.append(dot, text);
  el.hidden = true;
  root.appendChild(el);
  let active = !seen();

  return {
    place(pos) {
      if (!active || !pos) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.style.left = `${pos[0]}px`;
      el.style.top = `${pos[1]}px`;
    },
    dismiss() {
      if (!active) return;
      active = false;
      remember();
      el.hidden = true;
    },
  };
}
