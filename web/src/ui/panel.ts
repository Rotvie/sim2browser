/**
 * "What the policy sees" panel (FR-014, contracts/ui.md): the live observation, grouped and
 * labelled from parity.json, and the policy's outputs (one per parity.json `action.joints`). Collapsed by default; a bottom sheet on
 * narrow screens. In other modes it keeps showing what the policy would do, greyed out.
 */
import type { PolicyStep } from "../control/learned";
import type { ObsField } from "../sim/parity";
import { createTimeline, stripsFor, type Timeline } from "./timeline";

/** Strips shown by default in the timeline (the rest are one click away). */
const DEFAULT_STRIPS = ["q", "jaw", "tipToTarget", "cubeToTip", "output"];

const fmt = (v: number) => (Math.abs(v) < 0.0005 ? "0.000" : v.toFixed(3));

export interface ObservePanel {
  /** `t`: simulation time of the step (the timeline's clock). */
  update(step: PolicyStep | undefined, active: boolean, t: number): void;
  /** The panel element, or null while it is closed. */
  openElement(): HTMLElement | null;
  /** Only where the current task has a learned policy (004); hiding also closes it. */
  setAvailable(on: boolean): void;
}

export interface PolicyLayout {
  fields: ObsField[];
  /** Output labels, in output order. */
  outputs: string[];
  /** Joint names for per-joint observation fields. */
  joints: string[];
  /** The panel title while this policy is shown, e.g. "What the PPO policy sees". */
  title: string;
}

const axis = ["x", "y", "z"];
const barFields = new Set(["q", "prevAction"]);

function buildView(fields: ObsField[], outputs: string[], joints: string[]) {
  const el = document.createElement("div");
  el.className = "obs-view";
  const cells: { value: HTMLElement; bar: HTMLElement | null }[] = [];
  const jointLabel = (i: number) => joints[i]?.replace("_", " ") ?? `output ${i + 1}`;
  for (const f of fields) {
    const group = document.createElement("div");
    group.className = "obs-group";
    const h = document.createElement("h3");
    h.textContent = f.unit ? `${f.label} (${f.unit})` : f.label;
    group.appendChild(h);
    for (let i = 0; i < f.size; i++) {
      const row = document.createElement("div");
      row.className = "obs-row";
      const name = document.createElement("span");
      name.textContent =
        f.size === 3
          ? axis[i]
          : f.size === 2
            ? ["sin", "cos"][i]
            : f.size === 1
              ? ""
              : jointLabel(i);
      const bar = barFields.has(f.name) ? document.createElement("span") : null;
      if (bar) bar.className = "bar";
      const value = document.createElement("span");
      value.className = "num";
      row.append(name, ...(bar ? [bar] : []), value);
      group.appendChild(row);
      cells.push({ value, bar });
    }
    el.appendChild(group);
  }
  const outGroup = document.createElement("div");
  outGroup.className = "obs-group output";
  outGroup.innerHTML = `<h3>Output: joint target change per step (−1…+1)</h3>`;
  const outs: { bar: HTMLElement; value: HTMLElement }[] = [];
  for (const label of outputs) {
    const row = document.createElement("div");
    row.className = "obs-row";
    const name = document.createElement("span");
    name.textContent = label;
    const bar = document.createElement("span");
    bar.className = "bar signed";
    const value = document.createElement("span");
    value.className = "num";
    row.append(name, bar, value);
    outGroup.appendChild(row);
    outs.push({ bar, value });
  }
  el.appendChild(outGroup);
  const size = fields.reduce((n, f) => n + f.size, 0);
  return { el, cells, outs, size };
}

export function createObservePanel(
  root: HTMLElement,
  toolbar: HTMLElement,
  layouts: PolicyLayout[],
): ObservePanel {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = "Policy view";
  button.dataset.short = "Policy";
  button.setAttribute("aria-expanded", "false");
  toolbar.appendChild(button);

  const panel = document.createElement("section");
  panel.className = "panel observe";
  panel.hidden = true;
  panel.setAttribute("aria-label", "What the policy sees");
  const head = document.createElement("header");
  head.innerHTML = `<h2>What the policy sees</h2><button type="button" class="close" aria-label="Close">×</button>`;
  const heading = head.querySelector("h2")!;
  const status = document.createElement("p");
  status.className = "note";
  const normToggle = document.createElement("button");
  normToggle.type = "button";
  normToggle.className = "link";
  normToggle.textContent = "Show normalized values";
  normToggle.setAttribute("aria-pressed", "false");
  let showNorm = false;
  normToggle.addEventListener("click", () => {
    showNorm = !showNorm;
    normToggle.setAttribute("aria-pressed", String(showNorm));
    normToggle.textContent = showNorm ? "Show raw values" : "Show normalized values";
  });
  // Timeline (default) or Numbers (the table view: every value as text).
  const viewSwitch = document.createElement("div");
  viewSwitch.className = "tl-seg view-switch";
  viewSwitch.setAttribute("role", "group");
  viewSwitch.setAttribute("aria-label", "View");
  let timelineView = true;
  for (const [label, tl] of [
    ["Timeline", true],
    ["Numbers", false],
  ] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(tl === timelineView));
    b.addEventListener("click", () => {
      timelineView = tl;
      for (const x of viewSwitch.querySelectorAll("button"))
        x.setAttribute("aria-pressed", String(x === b));
    });
    viewSwitch.appendChild(b);
  }
  panel.append(head, status, viewSwitch, normToggle);

  // One layout per policy (reach, and the grasp policy if shipped): observation rows grouped by
  // field, then the outputs. The step's observation size says which policy it came from.
  const views = layouts.map((l) => buildView(l.fields, l.outputs, l.joints));
  for (const v of views) panel.appendChild(v.el);
  const timelines: Timeline[] = layouts.map((l) =>
    createTimeline(stripsFor(l.fields, l.outputs, l.joints), DEFAULT_STRIPS),
  );
  for (const tl of timelines) panel.appendChild(tl.el);
  // 004: the panel is the dock's drawer, directly above the controls (one control panel).
  if (toolbar.parentElement?.classList.contains("dock")) toolbar.before(panel);
  else root.appendChild(panel);

  const set = (open: boolean) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", () => set(panel.hidden !== false));
  head.querySelector(".close")!.addEventListener("click", () => set(false));

  const setBar = (bar: HTMLElement, v: number) => {
    // Signed bar centred at 50%: width and side from the value in [-1, 1].
    const c = Math.max(-1, Math.min(1, v));
    bar.style.setProperty("--from", `${50 + Math.min(0, c) * 50}%`);
    bar.style.setProperty("--to", `${50 + Math.max(0, c) * 50}%`);
  };

  return {
    openElement: () => (panel.hidden ? null : panel),
    setAvailable(on) {
      button.hidden = !on;
      if (!on) set(false);
    },
    update(step, active, t) {
      // Every step feeds its policy's timeline, also while the panel is closed, so opening it
      // shows the last seconds at once.
      const which = step ? views.findIndex((v) => v.size === step.obsRaw.length) : -1;
      if (step && which >= 0) timelines[which].push(t, step);
      if (panel.hidden) return;
      if (!step) {
        status.textContent = "Select Learned to load the policy.";
        panel.classList.add("inactive");
        return;
      }
      panel.classList.toggle("inactive", !active);
      status.textContent = active
        ? "Live: what the policy observes and outputs every 20 ms."
        : "Not in control. Showing what the policy would output right now.";
      views.forEach((v, i) => (v.el.hidden = timelineView || i !== which));
      timelines.forEach((tl, i) => (tl.el.hidden = !timelineView || i !== which));
      if (which < 0) return;
      heading.textContent = layouts[which].title;
      if (timelineView) {
        timelines[which].draw(showNorm);
        return;
      }
      const { cells, outs } = views[which];
      for (let i = 0; i < cells.length; i++) {
        cells[i].value.textContent = fmt(showNorm ? step.obsNorm[i] : step.obsRaw[i]);
        if (cells[i].bar) setBar(cells[i].bar!, step.obsNorm[i] / 3);
      }
      for (let i = 0; i < outs.length; i++) {
        setBar(outs[i].bar, step.action[i]);
        outs[i].value.textContent = fmt(step.action[i]);
      }
    },
  };
}
