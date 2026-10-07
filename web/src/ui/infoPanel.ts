/**
 * "About the controllers" panel (research R6 honesty note). Values come from parity.json, so the
 * panel describes exactly the baseline that runs and gets evaluated.
 */
import type { PolicyHeader } from "../control/policy";
import type { Parity } from "../sim/parity";

/** shared/grasp-eval/grasp.json (004 contracts/grasp-eval.md), the fields the panel shows. */
interface GraspEval {
  n: number;
  successRate: number;
  medianTimeToLift: number | null;
  failures: Record<string, number>;
}

const FAILURE_WORDS: Record<string, string> = {
  missed: "missed the cube",
  slipped: "cube slipped",
  knocked: "knocked the cube",
  timeout: "took too long",
};

export function createInfoPanel(
  root: HTMLElement,
  toolbar: HTMLElement,
  baseline: Parity["baseline"],
  observed: string[],
  policyHeaderUrl: string | null,
  labControllers: { label: string; description: string }[] = [],
  /** Grasp controllers on the page, in mode-switch order. */
  grasps: { id: string; label: string; public: boolean }[] = [],
  sharedUrl: (path: string) => string = (p) => p,
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
    <div class="grasp-info" hidden></div>
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
            <dt>Tip jerk vs baseline</dt><dd>${(m.jerkRatioVsBaseline * 100).toFixed(0)}% <span class="${m.jerkRatioVsBaseline <= 0.7 ? "ok" : "miss"}">(target ≤ 70%)</span></dd>${
              m.floorContactRate !== undefined
                ? `<dt>Touched the floor</dt><dd>${pct(m.floorContactRate)} <span class="${m.floorContactRate <= 0.01 ? "ok" : "miss"}">(target ≤ 1%)</span></dd>`
                : ""
            }${
              m.cubeMovedRate !== undefined
                ? `<dt>Moved the cube</dt><dd>${pct(m.cubeMovedRate)} <span class="${m.cubeMovedRate <= 0.02 ? "ok" : "miss"}">(target ≤ 2%)</span></dd>`
                : ""
            }
          </dl>
          <p class="note">Measured on ${m.n ?? 100} random reachable targets (at least 4 cm above the floor), 1 cm tolerance,
            within 2 s. Numbers are shown as measured, including any shortfall.</p>`
        : `<p class="note">Not measured yet.</p>`;
      learnedInfo.innerHTML = `
        <h3>Learned policy</h3>
        <p>A neural network (${h.layers.length - 1} hidden layers of ${h.layers[0].out}) trained with
          PPO reinforcement learning in the same simulation. Every 20 ms it sees
          ${observed.join(", ").toLowerCase()} and outputs a change for each joint target. It
          leaves the wrist roll alone: rolling the wrist does not move the tip.</p>
        <p>Its training reward: get the tip close to the target (with a bonus for settling), while
          penalizing sudden changes in its commands and jerky tip motion. Smoothness is learned,
          not scripted.</p>
        <h3>Measured results</h3>${results}`;
      learnedInfo.hidden = false;
    } catch {
      loaded = false;
    }
  };

  // The grasp section: one row per grasp controller with a committed evaluation report
  // (shared/grasp-eval/<id>.json, written by `npm run eval:grasp`), so a new grasp controller
  // appears here once it has been measured. Numbers are shown as measured.
  const graspInfo = panel.querySelector<HTMLElement>(".grasp-info")!;
  let graspLoaded = false;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const loadGrasp = async () => {
    if (graspLoaded || !grasps.length) return;
    graspLoaded = true;
    const reports = await Promise.all(
      grasps.map(async (c) => {
        try {
          const res = await fetch(sharedUrl(`grasp-eval/${c.id}.json`));
          return res.ok ? { c, r: (await res.json()) as GraspEval } : null;
        } catch {
          return null;
        }
      }),
    );
    const rows = reports.filter((x) => x !== null);
    if (!rows.length) {
      graspLoaded = false;
      return;
    }
    let learned = "";
    if (grasps.some((c) => c.id === "learned-grasp")) {
      try {
        const h = (await (await fetch(sharedUrl("policy/grasp.json"))).json()) as PolicyHeader;
        const d = h.trainedWith.demos;
        learned = `<p><strong>Learned grasp</strong>: a neural network that imitates grasps instead
          of following a script${
            d
              ? `: trained on ${d.scripted} generated and ${d.hand} hand-recorded demonstrations
                 (hand share ${(d.handShare * 100).toFixed(0)}%)${
                   d.dagger
                     ? `, then on ${d.dagger} of its own attempts with every step corrected by an expert (DAgger)`
                     : ""
                 }`
              : ""
          }. It sees the cube's pose, not a camera image.</p>`;
      } catch {
        learned = "";
      }
    }
    const n = rows[0]!.r.n;
    graspInfo.innerHTML = `
      <h3>Grasping the cube</h3>
      <p><strong>Scripted grasp</strong>: no learning. A script built on the baseline moves
        above the cube with the jaws pointing down and turned to match the cube, descends, closes
        the gripper and lifts. Only one jaw moves, so it comes down a little to one side of the
        cube. It reports a failure instead of pretending.</p>
      ${learned}
      <table class="grasp-table">
        <thead><tr><th>Controller</th><th>Lifted</th><th>Median time</th><th>Failures</th></tr></thead>
        <tbody>${rows
          .map(({ c, r }) => {
            const failures = Object.entries(r.failures).filter(([, k]) => k > 0);
            const target = c.id === "grasp" ? 0.9 : c.id === "learned-grasp" ? 0.8 : null;
            const cls = target === null ? "" : r.successRate >= target ? "ok" : "miss";
            return `<tr data-controller="${c.id}">
              <th scope="row">${c.label}${c.public ? "" : ` <span class="tag">lab</span>`}</th>
              <td class="${cls}">${pct(r.successRate)}</td>
              <td>${r.medianTimeToLift === null ? "–" : `${r.medianTimeToLift.toFixed(1)} s`}</td>
              <td>${failures.length ? failures.map(([k, v]) => `${v} ${FAILURE_WORDS[k] ?? k}`).join(", ") : "none"}</td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>
      <p class="note">Measured on the same ${n} random cube placements in the reachable area
        (random turn), from the starting pose. Success: the cube at least 5 cm up, held for 1 s,
        within 10 s. Targets: scripted ≥ 90%; the learned grasp ships only if it lifts ≥ 80%.</p>`;
    graspInfo.hidden = false;
  };

  const set = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => {
    set(panel.hidden !== false);
    if (!panel.hidden) {
      void loadLearned();
      void loadGrasp();
    }
  });
  panel.querySelector(".close")!.addEventListener("click", () => set(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") set(false);
  });
}
