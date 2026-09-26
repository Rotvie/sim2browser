/** The interactive app: rendering, input and UI. Loaded after the sim worker has started. */
import * as THREE from "three";
import type { FromWorker, ReadyInfo, Snapshot, ToWorker } from "./protocol";
import { createArmView } from "./render/arm";
import { PoseInterpolator } from "./render/interp";
import { attachJointPicker } from "./render/picking";
import { createScene } from "./render/scene";
import { createTargetView, type TargetView } from "./render/target";
import { createHint } from "./ui/hint";
import { createInfoPanel } from "./ui/infoPanel";
import type { Messages } from "./ui/messages";
import { createModeSwitch, type ModeSwitch } from "./ui/modeSwitch";
import { createResetButton } from "./ui/resetButton";

export interface AppContext {
  worker: Worker;
  /** Messages the worker sent before the app loaded, in order. */
  early: FromWorker[];
  messages: Messages;
  init: () => void;
}

/** Frame timing over a rolling 2 s window (SC-002). */
class FrameStats {
  private times: number[] = [];
  maxGapMs = 0;
  frame(now: number) {
    const last = this.times[this.times.length - 1];
    if (last !== undefined) this.maxGapMs = Math.max(this.maxGapMs, now - last);
    this.times.push(now);
    while (this.times.length > 2 && now - this.times[0] > 2000) this.times.shift();
  }
  get fps() {
    const n = this.times.length;
    if (n < 2) return 0;
    return ((n - 1) * 1000) / (this.times[n - 1] - this.times[0]);
  }
  reset() {
    this.times = [];
    this.maxGapMs = 0;
  }
}

export function startApp({ worker, early, messages, init }: AppContext) {
  const app = document.getElementById("app")!;
  const canvas = document.getElementById("view") as HTMLCanvasElement;
  const toolbar = document.getElementById("toolbar")!;
  const view = createScene(canvas);
  const send = (msg: ToWorker) => worker.postMessage(msg);
  const interp = new PoseInterpolator();
  const stats = new FrameStats();
  const hint = createHint(app, "Drag the target");
  let latest: Snapshot | null = null;
  let ready: ReadyInfo | null = null;
  let arm: ReturnType<typeof createArmView> | null = null;
  let target: TargetView | null = null;
  let modeSwitch: ModeSwitch | null = null;

  const bodyIndex = (name: string) => ready?.bodyNames.indexOf(name) ?? -1;
  const bodyPos = (b: number): THREE.Vector3 | null =>
    latest && b >= 0
      ? new THREE.Vector3(
          latest.bodyPos[3 * b],
          latest.bodyPos[3 * b + 1],
          latest.bodyPos[3 * b + 2],
        )
      : null;
  /** Middle of the link that starts at `name` (between the body and its first child). */
  const linkMid = (name: string): THREE.Vector3 | null => {
    const b = bodyIndex(name);
    if (!ready || b < 0) return null;
    const child = ready.bodyParent.findIndex((p, i) => p === b && i !== b);
    const a = bodyPos(b);
    const c = child >= 0 ? bodyPos(child) : null;
    return a && c ? a.add(c).multiplyScalar(0.5) : a;
  };
  const toScreen = (p: THREE.Vector3): [number, number] => {
    const v = p.clone().project(view.camera);
    return [((v.x + 1) / 2) * canvas.clientWidth, ((1 - v.y) / 2) * canvas.clientHeight];
  };

  const handle = (msg: FromWorker) => {
    switch (msg.type) {
      case "ready": {
        ready = msg;
        arm = createArmView(msg.geoms, msg.bodyNames.length);
        view.scene.add(arm.root);
        // Registered before the joint picker: grabbing the target takes priority.
        target = createTargetView({
          canvas,
          camera: view.camera,
          scene: view.scene,
          overlay: app,
          latest: () => latest,
          send: (pos) => send({ type: "setTarget", pos }),
          onInteract: () => hint.dismiss(),
        });
        attachJointPicker({
          canvas,
          camera: view.camera,
          meshes: arm.meshes,
          bodyJoint: msg.bodyJoint,
          limits: msg.limits,
          latest: () => latest,
          send: (joint, angle) => send({ type: "dragJoint", joint, angle }),
          onInteract: () => hint.dismiss(),
        });
        modeSwitch = createModeSwitch(toolbar, msg.modes, (mode) =>
          send({ type: "setMode", mode }),
        );
        createInfoPanel(app, toolbar, msg.baseline);
        messages.hide();
        break;
      }
      case "snapshot":
        latest = msg;
        modeSwitch?.show(msg.mode);
        interp.push({ pos: msg.bodyPos, quat: msg.bodyQuat }, performance.now());
        break;
      case "modeChanged":
        modeSwitch?.show(msg.mode);
        break;
      case "error":
        messages.error(msg.message, () => {
          messages.loading("Loading the robot…");
          init();
        });
        break;
    }
  };
  for (const msg of early.splice(0)) handle(msg);
  worker.onmessage = (e: MessageEvent<FromWorker>) => handle(e.data);
  worker.onerror = (e) =>
    messages.error(e.message || "The simulation stopped unexpectedly.", () => location.reload());

  canvas.addEventListener("pointerdown", () => hint.dismiss());
  canvas.addEventListener("wheel", () => hint.dismiss(), { passive: true });
  createResetButton(toolbar, () => send({ type: "reset" }));
  document.addEventListener("visibilitychange", () =>
    send({ type: "visibility", hidden: document.hidden }),
  );

  const loop = (now: number) => {
    stats.frame(now);
    const pose = interp.sample(now);
    if (arm && pose) arm.setPose(pose);
    target?.update();
    hint.place(target?.screenPoint() ?? null);
    view.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Read-only test hooks (contracts/ui.md); not a public API.
  Object.defineProperty(window, "__webRobot", {
    value: Object.freeze({
      get snapshot() {
        return latest;
      },
      get ready() {
        return ready !== null;
      },
      get fps() {
        return stats.fps;
      },
      get maxFrameGapMs() {
        return stats.maxGapMs;
      },
      resetFrameStats: () => stats.reset(),
      camera: () => view.camera.position.toArray(),
      linkScreenPoint: (name: string) => {
        const m = linkMid(name);
        return m ? toScreen(m) : null;
      },
      bodyNames: () => ready?.bodyNames ?? [],
      targetScreenPoint: () => target?.screenPoint() ?? null,
      worldToScreen: (p: [number, number, number]) => toScreen(new THREE.Vector3(...p)),
      limits: () => (ready ? Array.from(ready.limits) : []),
    }),
  });
}
