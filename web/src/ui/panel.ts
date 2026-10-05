/**
 * "What the policy sees" panel (FR-014, contracts/ui.md): the live observation, grouped and
 * labelled from parity.json, and the policy's outputs (one per parity.json `action.joints`). Collapsed by default; a bottom sheet on
 * narrow screens. In other modes it keeps showing what the policy would do, greyed out.
 */
import type { PolicyStep } from "../control/learned";
import type { ObsField } from "../sim/parity";

const fmt = (v: number) => (Math.abs(v) < 0.0005 ? "0.000" : v.toFixed(3));

export interface ObservePanel {
  update(step: PolicyStep | undefined, active: boolean): void;
  /** The panel element, or null while it is closed. */
  openElement(): HTMLElement | null;
}

export function createObservePanel(
  root: HTMLElement,
  toolbar: HTMLElement,
  fields: ObsField[],
  joints: string[],
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
  panel.append(head, status, normToggle);

  // Observation rows: one per value, grouped by field.
  const cells: { value: HTMLElement; bar: HTMLElement | null }[] = [];
  const barFields = new Set(["q", "prevAction"]);
  const jointLabel = (i: number) => joints[i]?.replace("_", " ") ?? `joint ${i + 1}`;
  const axis = ["x", "y", "z"];
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
      name.textContent = f.size === 3 ? axis[i] : jointLabel(i);
      const bar = barFields.has(f.name) ? document.createElement("span") : null;
      if (bar) bar.className = "bar";
      const value = document.createElement("span");
      value.className = "num";
      row.append(name, ...(bar ? [bar] : []), value);
      group.appendChild(row);
      cells.push({ value, bar });
    }
    panel.appendChild(group);
  }

  const outGroup = document.createElement("div");
  outGroup.className = "obs-group output";
  outGroup.innerHTML = `<h3>Output: joint target change per step (−1…+1)</h3>`;
  const outs: { bar: HTMLElement; value: HTMLElement }[] = [];
  for (let i = 0; i < joints.length; i++) {
    const row = document.createElement("div");
    row.className = "obs-row";
    const name = document.createElement("span");
    name.textContent = jointLabel(i);
    const bar = document.createElement("span");
    bar.className = "bar signed";
    const value = document.createElement("span");
    value.className = "num";
    row.append(name, bar, value);
    outGroup.appendChild(row);
    outs.push({ bar, value });
  }
  panel.appendChild(outGroup);
  root.appendChild(panel);

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
    update(step, active) {
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
