/** The interactive app: rendering, input and UI. Loaded after the sim worker has started. */
import * as THREE from "three";
import type { FromWorker, ReadyInfo, Snapshot, ToWorker } from "./protocol";
import { createArmView } from "./render/arm";
import { PoseInterpolator } from "./render/interp";
import { attachCubeDrag } from "./render/cubeDrag";
import { attachJointPicker } from "./render/picking";
import { createScene } from "./render/scene";
import { createTargetView, type TargetView } from "./render/target";
import { createGraspStatus } from "./ui/graspStatus";
import { createGripperButton, type GripperButton } from "./ui/gripperButton";
import { createHint } from "./ui/hint";
import { createInfoPanel } from "./ui/infoPanel";
import type { Messages } from "./ui/messages";
import { createTaskControls, TASKS, type TaskControls } from "./ui/taskControls";
import { createObservePanel, type ObservePanel } from "./ui/panel";
import { createRecordPanel, type RecordPanel } from "./ui/recordPanel";
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
  // Panels sit above the toolbar, whose height changes when it wraps on narrow screens.
  new ResizeObserver(() =>
    document.documentElement.style.setProperty("--toolbar-h", `${toolbar.offsetHeight}px`),
  ).observe(toolbar);
  const send = (msg: ToWorker) => worker.postMessage(msg);
  const interp = new PoseInterpolator();
  const stats = new FrameStats();
  const hint = createHint(app, "Drag the target");
  // Second hint (002): once the visitor has moved the target, point at the cube.
  const cubeHint = createHint(app, "Open the gripper (G) and pick up the cube", "sim2browser:cube");
  let latest: Snapshot | null = null;
  let ready: ReadyInfo | null = null;
  let arm: ReturnType<typeof createArmView> | null = null;
  let target: TargetView | null = null;
  let modeSwitch: TaskControls | null = null;
  const subtitle = document.querySelector<HTMLElement>(".brand p");
  const urlTask = new URLSearchParams(location.search).get("task") === "grasp" ? "grasp" : "reach";
  let reachObs = 0;
  let graspObs = 0;
  let observe: ObservePanel | null = null;
  let gripperButton: GripperButton | null = null;
  const graspStatus = createGraspStatus(
    app,
    () => send({ type: "regrasp" }),
    () => send({ type: "retry" }),
  );
  // 004 recording mode: only with ?record (not linked anywhere).
  const recordPanel: RecordPanel | null = new URLSearchParams(location.search).has("record")
    ? createRecordPanel(app, (action) => send({ type: "record", action }))
    : null;
  /** Modes the worker has run at least once (already created: no loading spinner). */
  const used = new Set<string>();

  /** The page follows the task: subtitle, gripper button (Grasp only). */
  /** Tasks whose learned controller this build ships. */
  const learnedIn = new Set<string>();
  const applyTask = (task: "reach" | "grasp") => {
    if (subtitle)
      subtitle.textContent = TASKS.find((t) => t.id === task)!.subtitle(learnedIn.has(task));
    gripperButton?.setVisible(task === "grasp");
    observe?.setAvailable(learnedIn.has(task));
  };
  const size = (fields: { size: number }[] | null) =>
    (fields ?? []).reduce((n, f) => n + f.size, 0);

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
        const cubeBody = bodyIndex(msg.cube.body);
        // Registered before the joint picker: grabbing the target takes priority, then the cube.
        target = createTargetView({
          canvas,
          camera: view.camera,
          scene: view.scene,
          overlay: app,
          latest: () => latest,
          send: (pos) => send({ type: "setTarget", pos }),
          onInteract: () => hint.dismiss(),
        });
        attachCubeDrag({
          canvas,
          camera: view.camera,
          scene: view.scene,
          meshes: arm.meshes.filter((m) => m.userData.body === cubeBody),
          region: msg.graspRegion,
          latest: () => latest,
          send: (pos) => send({ type: "setCube", pos }),
          onInteract: () => {
            hint.dismiss();
            cubeHint.dismiss();
          },
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
        // Public controllers always; lab controllers (registry `public: false`) with ?lab.
        const lab = new URLSearchParams(location.search).has("lab");
        const shown = msg.controllers.filter((c) => c.public || lab);
        modeSwitch = createTaskControls({
          tabsRoot: app.querySelector(".brand")!,
          toolbar,
          controllers: shown,
          initialTask: urlTask,
          onSelect: (mode) => {
            // Controllers are created on first use; show a spinner until the worker confirms.
            if (mode !== latest?.mode && !used.has(mode)) modeSwitch?.setState(mode, "loading");
            send({ type: "setMode", mode });
          },
          onTask: (task) => applyTask(task),
        });
        gripperButton = createGripperButton(toolbar, (command) => {
          cubeHint.dismiss();
          send({ type: "setGripper", command });
        });
        for (const c of shown) if (c.kind === "learned") learnedIn.add(c.task);
        reachObs = size(msg.observation);
        graspObs = size(msg.graspObservation);
        const hasPolicy = shown.some((c) => c.id === "learned");
        const hasGraspPolicy = shown.some((c) => c.id === "learned-grasp") && msg.graspObservation;
        const layouts = [
          ...(hasPolicy
            ? [
                {
                  fields: msg.observation,
                  outputs: msg.policyJoints.map((j) => j.replace("_", " ")),
                  joints: msg.policyJoints,
                },
              ]
            : []),
          ...(hasGraspPolicy
            ? [
                {
                  fields: msg.graspObservation!,
                  outputs: [...msg.joints.map((j) => j.replace("_", " ")), "Gripper (> 0 closes)"],
                  joints: msg.joints,
                },
              ]
            : []),
        ];
        if (layouts.length) observe = createObservePanel(app, toolbar, layouts);
        applyTask(modeSwitch.task);
        // A ?task=grasp link opens grasping on its engineered controller.
        if (modeSwitch.task === "grasp" && msg.controllers.some((c) => c.id === "grasp"))
          send({ type: "setMode", mode: "grasp" });

        createInfoPanel(
          app,
          toolbar,
          msg.baseline,
          msg.observation.map((f) => f.label),
          hasPolicy ? new URL("shared/policy/reach.json", document.baseURI).href : null,
          shown.filter((c) => !c.public),
          shown.filter((c) => c.task === "grasp"),
          (path) => new URL(`shared/${path}`, document.baseURI).href,
        );
        messages.hide();
        break;
      }
      case "snapshot":
        latest = msg;
        used.add(msg.mode);
        modeSwitch?.show(msg.mode);
        gripperButton?.show(msg.gripper);
        graspStatus.show(msg.grasp);
        interp.push({ pos: msg.bodyPos, quat: msg.bodyQuat }, performance.now());
        break;
      case "modeChanged":
        modeSwitch?.show(msg.mode);
        break;
      case "record-status":
        recordPanel?.show(msg);
        break;
      case "record-file":
        recordPanel?.download(msg.bytes);
        break;
      case "controllerError": {
        modeSwitch?.setState(msg.id, "failed", msg.message);
        const label = ready?.controllers.find((c) => c.id === msg.id)?.label ?? msg.id;
        messages.toast(`${label} could not be loaded, so the baseline stays in control.`);
        break;
      }
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
    const task = modeSwitch?.task ?? "reach";
    const byHand = modeSwitch?.byHand() ?? false;
    // The target is the Reach task's, and the handle for grasping by hand.
    target?.setEnabled(task === "reach" || byHand);
    target?.update();
    if (latest) {
      // The policy view shows the current task's policy (or says how to load it).
      const step = latest.policyStep;
      const want = task === "grasp" ? graspObs : reachObs;
      const mine = step && step.obsRaw.length === want ? step : undefined;
      observe?.update(mine, !!mine && latest.policyStepActive);
    }
    // On narrow screens the policy panel is a bottom sheet: keep the arm above it.
    const sheet = window.innerWidth < 700 ? observe?.openElement() : null;
    view.setBottomInset(sheet ? canvas.clientHeight - sheet.getBoundingClientRect().top : 0);
    hint.place(task === "reach" ? (target?.screenPoint() ?? null) : null);
    const cubeAt = latest?.cube.pos;
    cubeHint.place(
      task === "grasp" && byHand && cubeAt
        ? toScreen(new THREE.Vector3(cubeAt[0], cubeAt[1], cubeAt[2]))
        : null,
    );
    view.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Read-only test hooks (contracts/ui.md); not a public API.
  Object.defineProperty(window, "__sim2browser", {
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
      cubeScreenPoint: () => {
        const c = latest?.cube.pos;
        return c ? toScreen(new THREE.Vector3(c[0], c[1], c[2])) : null;
      },
      worldToScreen: (p: [number, number, number]) => toScreen(new THREE.Vector3(...p)),
      limits: () => (ready ? Array.from(ready.limits) : []),
    }),
  });
}
