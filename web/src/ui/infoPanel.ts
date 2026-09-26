/**
 * "About the controllers" panel (research R6 honesty note). Values come from parity.json, so the
 * panel describes exactly the baseline that runs and gets evaluated.
 */
import type { PolicyHeader } from "../control/policy";
import type { Parity } from "../sim/parity";

export function createInfoPanel(
  root: HTMLElement,
  toolbar: HTMLElement,
  baseline: Parity["baseline"],
  observed: string[],
  policyHeaderUrl: string | null,
  labControllers: { label: string; description: string }[] = [],
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
      it stretches toward them and stops.</p>
    <div class="learned-info" hidden></div>
    ${
      labControllers.length
        ? `<h3>Lab controllers</h3>` +
          labControllers
            .map((c) => `<p><strong>${c.label}</strong>: ${c.description}</p>`)
            .join("") +
          `<p class="note">Add your own in <code>web/src/control/registry.ts</code>.</p>`
        : ""
    }`;
  root.appendChild(panel);

  // The learned-policy section loads its facts from the shipped policy header on first open, so
  // the numbers shown are exactly the measured ones (research R12), even when below target.
  const learnedInfo = panel.querySelector<HTMLElement>(".learned-info")!;
  let loaded = false;
  const loadLearned = async () => {
    if (loaded || !policyHeaderUrl) return;
    loaded = true;
    try {
      const h = (await (await fetch(policyHeaderUrl)).json()) as PolicyHeader;
      const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
      const m = h.metrics;
      const results = m
        ? `<dl>
            <dt>Reached target</dt><dd>${pct(m.successRate)} <span class="${m.successRate >= 0.95 ? "ok" : "miss"}">(target ≥ 95%)</span></dd>
            <dt>Tip jerk vs baseline</dt><dd>${(m.jerkRatioVsBaseline * 100).toFixed(0)}% <span class="${m.jerkRatioVsBaseline <= 0.7 ? "ok" : "miss"}">(target ≤ 70%)</span></dd>
          </dl>
          <p class="note">Measured on ${m.n ?? 100} random reachable targets, 1 cm tolerance,
            within 2 s. Numbers are shown as measured, including any shortfall.</p>`
        : `<p class="note">Not measured yet.</p>`;
      learnedInfo.innerHTML = `
        <h3>Learned policy</h3>
        <p>A neural network (${h.layers.length - 1} hidden layers of ${h.layers[0].out}) trained with
          PPO reinforcement learning in the same simulation. Every 20 ms it sees
          ${observed.join(", ").toLowerCase()} and outputs a change for each joint target.</p>
        <p>Its training reward: get the tip close to the target (with a bonus for settling), while
          penalizing sudden changes in its commands and jerky tip motion. Smoothness is learned,
          not scripted.</p>
        <h3>Measured results</h3>${results}`;
      learnedInfo.hidden = false;
    } catch {
      loaded = false;
    }
  };

  const set = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => {
    set(panel.hidden !== false);
    if (!panel.hidden) void loadLearned();
  });
  panel.querySelector(".close")!.addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") set(false);
  });
}
