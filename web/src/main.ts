/**
 * Boot: start the sim worker first, so the physics engine and robot files download while the
 * rendering code (three.js) is still loading, then load the app.
 */
import type { FromWorker, ToWorker } from "./protocol";
import "./style.css";
import { createMessages } from "./ui/messages";

function missingFeatures(): string[] {
  const missing: string[] = [];
  if (typeof WebAssembly !== "object") missing.push("WebAssembly");
  if (typeof Worker !== "function") missing.push("Web Workers");
  const probe = document.createElement("canvas");
  if (!probe.getContext("webgl2") && !probe.getContext("webgl")) missing.push("WebGL");
  return missing;
}

async function boot() {
  const messages = createMessages(document.getElementById("app")!);
  const missing = missingFeatures();
  if (missing.length) {
    messages.unsupported(missing);
    return;
  }
  messages.loading("Loading the robot…");

  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const early: FromWorker[] = [];
  worker.onmessage = (e: MessageEvent<FromWorker>) => early.push(e.data);
  const init = () =>
    worker.postMessage({
      type: "init",
      baseUrl: new URL(import.meta.env.BASE_URL, location.href).href,
      record: new URLSearchParams(location.search).has("record"),
    } satisfies ToWorker);
  init();

  try {
    const { startApp } = await import("./app");
    startApp({ worker, early, messages, init });
  } catch {
    messages.error("The page could not finish loading.", () => location.reload());
  }
}

void boot();
