/// <reference lib="webworker" />
/** Sim worker: a thin adapter between messages and the Session (contracts/worker-protocol.md). */
import type { FromWorker, ToWorker } from "./protocol";
import { createSim, getMujoco } from "./sim/mujoco";
import { loadShared, ParityError, type ReadBytes } from "./sim/parity";
import { servedPath } from "./sim/served";
import { createSession, type ModeChange, type Session } from "./sim/session";

declare const self: DedicatedWorkerGlobalScope;

let session: Session | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let read: ReadBytes | null = null;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function postModeChange(change: ModeChange | null) {
  if (change) post({ type: "modeChanged", ...change });
}

function postSnapshot(s: Session) {
  const snap = s.snapshot();
  post({ type: "snapshot", ...snap }, [snap.bodyPos.buffer, snap.bodyQuat.buffer]);
}

/** Select a controller, creating it on first use (it may load assets, e.g. the policy). */
async function selectController(s: Session, id: string) {
  if (s.modes.available(id)) return postModeChange(s.setMode(id));
  try {
    await s.ensureController(id);
    if (session === s) postModeChange(s.setMode(id));
  } catch (err) {
    post({
      type: "controllerError",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
    postModeChange(s.controllerFailed(id));
  }
}

async function init(baseUrl: string) {
  read = async (path: string) => {
    const res = await fetch(new URL(`shared/${servedPath(path)}`, baseUrl));
    if (!res.ok) throw Object.assign(new Error(`${path}: HTTP ${res.status}`), { assetLoad: true });
    return new Uint8Array(await res.arrayBuffer());
  };
  try {
    // Download the engine and the robot files in parallel.
    const mjPromise = getMujoco();
    const [mj, { parity, modelFiles, workspace }] = await Promise.all([
      mjPromise,
      loadShared(
        read!,
        mjPromise.then((m) => m.mj_versionString()),
      ),
    ]);
    const sim = createSim(mj, parity, modelFiles);
    session?.sim.dispose();
    session = createSession(sim, parity, workspace, { read: read! });
    post({
      type: "ready",
      joints: parity.joints,
      limits: sim.limits,
      bodyJoint: sim.bodyJoint,
      bodyNames: sim.bodyNames,
      bodyParent: sim.bodyParent,
      // Collision geoms (group 3) are never drawn: do not copy them to the main thread.
      geoms: sim.geoms().filter((g) => g.group !== 3),
      neutralPose: parity.baseline.neutralPose,
      maxReach: parity.reach.maxReach,
      baseline: parity.baseline,
      policyJoints: parity.action.joints,
      observation: parity.observation.fields,
      gripper: parity.gripper,
      cube: { size: parity.cube.size, body: parity.cube.body },
      graspRegion: parity.grasp.region,
      controllers: session.controllers.map(({ id, label, description, public: pub }) => ({
        id,
        label,
        description,
        public: pub,
      })),
    });
    postSnapshot(session);
    clearInterval(timer);
    timer = setInterval(() => {
      if (session && session.tick(performance.now()) > 0) postSnapshot(session);
    }, 1000 / parity.controlHz);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof ParityError) post({ type: "error", code: err.code, message });
    else if (err instanceof TypeError || (err as { assetLoad?: boolean }).assetLoad)
      post({ type: "error", code: "asset-load", message });
    else post({ type: "error", code: "internal", message });
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "init") {
    void init(msg.baseUrl);
    return;
  }
  if (!session) return;
  switch (msg.type) {
    case "dragJoint":
      postModeChange(session.dragJoint(msg.joint, msg.angle));
      break;
    case "setTarget":
      postModeChange(session.setTarget(msg.pos));
      break;
    case "setMode":
      void selectController(session, msg.mode);
      break;
    case "setGripper":
      postModeChange(session.setGripper(msg.command));
      break;
    case "regrasp":
      session.regrasp();
      break;
    case "setCube":
      session.setCube(msg.pos);
      postSnapshot(session);
      break;
    case "reset":
      session.reset();
      postSnapshot(session);
      break;
    case "visibility":
      session.setHidden(msg.hidden, performance.now());
      break;
  }
};
