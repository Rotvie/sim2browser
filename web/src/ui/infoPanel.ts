/**
 * "About the controllers" panel (research R6 honesty note). Values come from parity.json, so the
 * panel describes exactly the baseline that runs and gets evaluated.
 */
import type { Parity } from "../sim/parity";

export function createInfoPanel(
  root: HTMLElement,
  toolbar: HTMLElement,
  baseline: Parity["baseline"],
): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn icon";
  button.textContent = "i";
  button.setAttribute("aria-label", "About the controllers");
  button.setAttribute("aria-expanded", "false");
  toolbar.appendChild(button);

  const panel = document.createElement("section");
  panel.className = "panel info";
  panel.hidden = true;
  panel.setAttribute("aria-label", "About the controllers");
  const fmt = (v: number) => String(Number(v.toFixed(3)));
  panel.innerHTML = `
    <header>
      <h2>About the controllers</h2>
      <button type="button" class="close" aria-label="Close">×</button>
    </header>
    <h3>Baseline design</h3>
    <p>Damped least-squares inverse kinematics on the tip position: every 20 ms it measures how far
      the tip is from the target and turns the joints to shrink that error.</p>
    <p>Tracks the target directly, with no trajectory planning.</p>
    <dl>
      <dt>Gain</dt><dd>${fmt(baseline.gain)} /s</dd>
      <dt>Damping</dt><dd>${fmt(baseline.damping)}</dd>
      <dt>Max joint speed</dt><dd>${fmt(baseline.maxJointSpeed)} rad/s</dd>
      <dt>Null-space gain</dt><dd>${fmt(baseline.nullspaceGain)} /s</dd>
    </dl>
    <p class="note">A controller that plans a smooth trajectory ahead of time would also move
      smoothly; this demo compares reactive controllers.</p>
    <p class="note">The arm works in front of its base. Targets it cannot reach are shown in orange;
      it stretches toward them and stops.</p>`;
  root.appendChild(panel);

  const set = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => set(panel.hidden !== false));
  panel.querySelector(".close")!.addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") set(false);
  });
}
