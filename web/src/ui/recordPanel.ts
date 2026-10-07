/**
 * Recording card (004 contracts/ui.md "Recording mode"), shown only with ?record. The demonstrator
 * starts an episode (the cube goes to the next placement), grasps by hand or selects "Scripted
 * grasp" first to record a scripted one, then keeps or discards it and saves the kept ones.
 */
import type { RecordStatus } from "../sim/recordingMode";

type Action = "start" | "stop" | "keep" | "discard" | "save";

export interface RecordPanel {
  show(status: RecordStatus): void;
  /** The worker sent the file: download it. */
  download(bytes: ArrayBuffer): void;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function createRecordPanel(root: HTMLElement, send: (action: Action) => void): RecordPanel {
  const el = document.createElement("section");
  el.className = "record-card";
  el.setAttribute("aria-label", "Recording");
  el.innerHTML = `
    <h2>Recording <span class="next"></span></h2>
    <div class="row">
      <button type="button" class="btn small" data-a="start">Start</button>
      <button type="button" class="btn small" data-a="stop">Stop</button>
      <span class="clock" role="timer"></span>
    </div>
    <div class="row last" hidden>
      <span class="last-text"></span>
      <button type="button" class="btn small" data-a="keep">Keep</button>
      <button type="button" class="btn small" data-a="discard">Discard</button>
    </div>
    <p class="kept"></p>
    <div class="row">
      <button type="button" class="btn small" data-a="save">Save file</button>
    </div>
    <p class="note">Select "Scripted grasp" before Start to record a scripted episode.
      Kept episodes are lost on reload.</p>`;
  root.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const btn = (a: Action) => q<HTMLButtonElement>(`[data-a="${a}"]`);
  for (const a of ["start", "stop", "keep", "discard", "save"] as const)
    btn(a).addEventListener("click", () => send(a));

  return {
    show(s) {
      q(".next").textContent = s.recording
        ? `· placement #${s.next} (seed 2000)`
        : `· next placement #${s.next} (seed 2000)`;
      btn("stop").disabled = !s.recording;
      q(".clock").textContent = s.recording ? `● ${s.elapsed.toFixed(1)} s` : "";
      const last = q(".last");
      last.hidden = !s.last;
      if (s.last) {
        const o = s.last.outcome;
        q(".last-text").textContent =
          `Last: ${o.success ? `lifted in ${o.timeToLift!.toFixed(1)} s` : (o.failure ?? "ended")} (${s.last.source})`;
      }
      const k = s.kept;
      q(".kept").textContent =
        `Kept: hand ${k.hand.lifted} lifted / ${k.hand.failed} failed · ` +
        `scripted ${k.scripted.lifted} lifted / ${k.scripted.failed} failed`;
      btn("save").disabled =
        k.hand.lifted + k.hand.failed + k.scripted.lifted + k.scripted.failed === 0;
    },
    download(bytes) {
      const d = new Date();
      const name = `hand-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.demos.jsonl.gz`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/gzip" }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };
}
