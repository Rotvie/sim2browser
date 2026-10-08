/**
 * Policy timeline (004): what the policy saw and did over a moving time window, as small
 * multiples, one strip per observation field plus the outputs. Each strip has its own y-axis
 * (never two scales on one plot), at most 6 lines, a legend with names, and a shared crosshair
 * whose tooltip lists every line's value at that moment. Colors follow the entity: joint i has
 * the same color in every strip; x, y, z take the first three slots; the gripper its own.
 *
 * Palette: the dataviz reference categorical order, light mode, validated as a 6-slot set
 * (adjacent CVD ΔE ≥ 9.1, normal-vision ≥ 19.6). Three slots sit below 3:1 on the surface, so
 * every line is named in its strip's legend and the Numbers view is the table equivalent.
 */
import type { PolicyStep } from "../control/learned";
import type { ObsField } from "../sim/parity";

const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const GRIPPER = SERIES[5];
const WINDOWS = [5, 10, 20];
/** Samples kept: the longest window at the 50 Hz control rate. */
const CAPACITY = 20 * 50;

export interface Strip {
  key: string;
  title: string;
  /** Slice of the observation (obs) or of the action vector (out). */
  source: "obs" | "out";
  offset: number;
  names: string[];
  colors: string[];
  /** Fixed y range (outputs are clipped to ±1); otherwise from the visible data. */
  range?: [number, number];
}

/** Strips for one policy: its observation fields, then its outputs. */
export function stripsFor(fields: ObsField[], outputs: string[], joints: string[]): Strip[] {
  const strips: Strip[] = [];
  let off = 0;
  const jointName = (i: number) => joints[i]?.replace("_", " ") ?? `#${i + 1}`;
  for (const f of fields) {
    const names =
      f.size === 3
        ? ["x", "y", "z"]
        : f.size === 2
          ? ["sin", "cos"]
          : f.size === 1
            ? [f.label]
            : Array.from({ length: f.size }, (_, i) =>
                f.name === "prevAction" &&
                i === outputs.length - 1 &&
                outputs.length > joints.length
                  ? "Gripper"
                  : jointName(i),
              );
    strips.push({
      key: f.name,
      title: f.unit ? `${f.label} (${f.unit})` : f.label,
      source: "obs",
      offset: off,
      names,
      colors: names.map((n, i) => (n === "Gripper" ? GRIPPER : SERIES[i % SERIES.length])),
      range: f.name === "prevAction" ? [-1, 1] : undefined,
    });
    off += f.size;
  }
  strips.push({
    key: "output",
    title: "Output (−1…+1)",
    source: "out",
    offset: 0,
    names: outputs,
    colors: outputs.map((n, i) => (/gripper/i.test(n) ? GRIPPER : SERIES[i % SERIES.length])),
    range: [-1, 1],
  });
  return strips;
}

/** Ring buffer of steps with their simulation time. */
class History {
  t = new Float64Array(CAPACITY);
  raw: Float64Array[] = [];
  norm: Float64Array[] = [];
  out: Float64Array[] = [];
  start = 0;
  size = 0;
  push(t: number, s: PolicyStep) {
    if (this.size && t <= this.t[(this.start + this.size - 1) % CAPACITY]) return; // same step
    const i = (this.start + this.size) % CAPACITY;
    this.t[i] = t;
    this.raw[i] = Float64Array.from(s.obsRaw);
    this.norm[i] = Float64Array.from(s.obsNorm);
    this.out[i] = Float64Array.from(s.action);
    if (this.size < CAPACITY) this.size++;
    else this.start = (this.start + 1) % CAPACITY;
  }
  clear() {
    this.size = 0;
    this.start = 0;
  }
  at(k: number) {
    return (this.start + k) % CAPACITY;
  }
}

export interface Timeline {
  readonly el: HTMLElement;
  push(t: number, step: PolicyStep): void;
  clear(): void;
  /** Called every frame while visible. */
  draw(normalized: boolean): void;
}

export function createTimeline(strips: Strip[], defaults: string[]): Timeline {
  const el = document.createElement("div");
  el.className = "timeline";
  const hist = new History();
  let windowS = WINDOWS[0];
  let paused = false;
  const shown = new Set(defaults.filter((k) => strips.some((s) => s.key === k)));

  // Controls: one row above the strips.
  const controls = document.createElement("div");
  controls.className = "tl-controls";
  const win = document.createElement("div");
  win.className = "tl-seg";
  win.setAttribute("role", "group");
  win.setAttribute("aria-label", "Time window");
  for (const w of WINDOWS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${w} s`;
    b.setAttribute("aria-pressed", String(w === windowS));
    b.addEventListener("click", () => {
      windowS = w;
      for (const x of win.querySelectorAll("button"))
        x.setAttribute("aria-pressed", String(x === b));
    });
    win.appendChild(b);
  }
  const pause = document.createElement("button");
  pause.type = "button";
  pause.className = "tl-pause";
  pause.textContent = "Pause";
  pause.setAttribute("aria-pressed", "false");
  pause.addEventListener("click", () => {
    paused = !paused;
    pause.textContent = paused ? "Resume" : "Pause";
    pause.setAttribute("aria-pressed", String(paused));
  });
  const chips = document.createElement("div");
  chips.className = "tl-chips";
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Shown variables");
  controls.append(win, pause, chips);
  el.appendChild(controls);

  // Strips.
  const body = document.createElement("div");
  body.className = "tl-strips";
  el.appendChild(body);
  const tip = document.createElement("div");
  tip.className = "tl-tip";
  tip.hidden = true;
  el.appendChild(tip);

  interface View {
    s: Strip;
    box: HTMLElement;
    canvas: HTMLCanvasElement;
    lo: HTMLElement;
    hi: HTMLElement;
  }
  const views: View[] = [];
  let hoverX: number | null = null; // fraction of the plot width, shared by all strips

  for (const s of strips) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = s.title.replace(/ \(.*\)$/, "");
    chip.setAttribute("aria-pressed", String(shown.has(s.key)));
    chip.addEventListener("click", () => {
      if (shown.has(s.key)) shown.delete(s.key);
      else shown.add(s.key);
      chip.setAttribute("aria-pressed", String(shown.has(s.key)));
      layout();
    });
    chips.appendChild(chip);

    const box = document.createElement("figure");
    box.className = "tl-strip";
    const head = document.createElement("figcaption");
    const title = document.createElement("span");
    title.className = "tl-title";
    title.textContent = s.title;
    const legend = document.createElement("span");
    legend.className = "tl-legend";
    s.names.forEach((n, i) => {
      const item = document.createElement("span");
      const key = document.createElement("i");
      key.style.background = s.colors[i];
      item.append(key, document.createTextNode(n));
      legend.appendChild(item);
    });
    // One line needs no legend: the title names it.
    head.append(title, ...(s.names.length > 1 ? [legend] : []));
    const plot = document.createElement("div");
    plot.className = "tl-plot";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${s.title} over the last seconds`);
    const hi = document.createElement("span");
    hi.className = "tl-axis hi";
    const lo = document.createElement("span");
    lo.className = "tl-axis lo";
    plot.append(canvas, hi, lo);
    box.append(head, plot);
    body.appendChild(box);
    views.push({ s, box, canvas, lo, hi });

    // Hover with a mouse; tap or drag along the strip with a finger (no hover on touch).
    const point = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      hoverX = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      showTip(s, e.clientX, e.clientY);
    };
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" || e.buttons) point(e);
    });
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      point(e);
    });
    canvas.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return; // a tap leaves the readout up
      hoverX = null;
      tip.hidden = true;
    });
  }
  const timeAxis = document.createElement("div");
  timeAxis.className = "tl-time";
  body.appendChild(timeAxis);

  const layout = () => {
    for (const v of views) v.box.hidden = !shown.has(v.s.key);
  };
  layout();

  /** Indices of the samples inside the window, oldest first. */
  const visible = () => {
    const n = hist.size;
    if (!n) return { from: 0, to: 0, tEnd: 0 };
    const tEnd = hist.t[hist.at(n - 1)];
    let from = n - 1;
    while (from > 0 && hist.t[hist.at(from - 1)] >= tEnd - windowS) from--;
    return { from, to: n, tEnd };
  };

  let normalized = false;
  const value = (s: Strip, idx: number, j: number) =>
    s.source === "out"
      ? hist.out[idx][s.offset + j]
      : (normalized ? hist.norm : hist.raw)[idx][s.offset + j];

  const fmt = (v: number) => (Math.abs(v) < 0.0005 ? "0.000" : v.toFixed(3));

  function showTip(s: Strip, x: number, y: number) {
    const { from, to, tEnd } = visible();
    if (to === from || hoverX === null) return;
    const t = tEnd - windowS + hoverX * windowS;
    let k = from;
    while (k < to - 1 && hist.t[hist.at(k + 1)] <= t) k++;
    const idx = hist.at(k);
    tip.replaceChildren();
    const when = document.createElement("div");
    when.className = "tl-tip-time";
    when.textContent = `${s.title} · ${(hist.t[idx] - tEnd).toFixed(2)} s`;
    tip.appendChild(when);
    s.names.forEach((n, j) => {
      const row = document.createElement("div");
      const key = document.createElement("i");
      key.style.background = s.colors[j];
      const val = document.createElement("strong");
      val.textContent = fmt(value(s, idx, j));
      const name = document.createElement("span");
      name.textContent = n;
      row.append(key, val, name);
      tip.appendChild(row);
    });
    const r = el.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${Math.min(x - r.left + 12, r.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${y - r.top + 12}px`;
  }

  /** A readable axis bound: rounded outward to 2 significant digits. */
  const nice = (v: number) => {
    if (v === 0) return 0;
    const p = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
    return (v > 0 ? Math.ceil(v / p) : Math.floor(v / p)) * p;
  };

  return {
    el,
    push(t, step) {
      if (!paused) hist.push(t, step);
    },
    clear: () => hist.clear(),
    draw(norm) {
      normalized = norm;
      const { from, to, tEnd } = visible();
      timeAxis.textContent = "";
      const left = document.createElement("span");
      left.textContent = `−${windowS} s`;
      const right = document.createElement("span");
      right.textContent = paused ? "paused" : "now";
      timeAxis.append(left, right);
      for (const v of views) {
        if (v.box.hidden) continue;
        const { s, canvas } = v;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        let [lo, hi] = s.range ?? [Infinity, -Infinity];
        if (!s.range) {
          for (let k = from; k < to; k++)
            for (let j = 0; j < s.names.length; j++) {
              const y = value(s, hist.at(k), j);
              if (y < lo) lo = y;
              if (y > hi) hi = y;
            }
          if (!Number.isFinite(lo)) [lo, hi] = [-1, 1];
          if (hi - lo < 1e-6) [lo, hi] = [lo - 0.5, hi + 0.5];
          const pad = (hi - lo) * 0.08;
          [lo, hi] = [nice(lo - pad), nice(hi + pad)];
        }
        v.hi.textContent = fmt(hi).replace(/\.?0+$/, "") || "0";
        v.lo.textContent = fmt(lo).replace(/\.?0+$/, "") || "0";
        const X = (t: number) => ((t - (tEnd - windowS)) / windowS) * w;
        const Y = (y: number) => h - 3 - ((y - lo) / (hi - lo)) * (h - 6);
        // Recessive zero line.
        if (lo < 0 && hi > 0) {
          ctx.strokeStyle = "rgba(29, 35, 43, 0.15)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, Math.round(Y(0)) + 0.5);
          ctx.lineTo(w, Math.round(Y(0)) + 0.5);
          ctx.stroke();
        }
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (let j = 0; j < s.names.length; j++) {
          ctx.strokeStyle = s.colors[j];
          ctx.beginPath();
          for (let k = from; k < to; k++) {
            const idx = hist.at(k);
            const px = X(hist.t[idx]);
            const py = Y(value(s, idx, j));
            if (k === from) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        if (hoverX !== null) {
          ctx.strokeStyle = "rgba(29, 35, 43, 0.45)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(hoverX * w) + 0.5, 0);
          ctx.lineTo(Math.round(hoverX * w) + 0.5, h);
          ctx.stroke();
        }
      }
    },
  };
}
