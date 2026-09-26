import type { Page } from "@playwright/test";

export interface Hook {
  ready: boolean;
  snapshot: {
    t: number;
    q: Float64Array;
    tip: Float64Array;
    target: Float64Array;
    reachable: boolean;
    mode: string;
    policyStep?: { obsRaw: Float64Array; action: Float64Array };
  } | null;
  fps: number;
  maxFrameGapMs: number;
  resetFrameStats(): void;
  camera(): number[];
  linkScreenPoint(name: string): [number, number] | null;
  limits(): number[];
  targetScreenPoint(): [number, number] | null;
  worldToScreen(p: [number, number, number]): [number, number];
}

declare global {
  interface Window {
    __webRobot: Hook;
    __qTrace?: { stop: boolean; rows: { t: number; q: number[] }[] };
  }
}

export async function waitReady(page: Page, timeout = 20_000) {
  await page.waitForFunction(
    () => window.__webRobot?.ready && window.__webRobot.snapshot !== null,
    null,
    {
      timeout,
    },
  );
}

/** Record each new snapshot's sim time and q, checked once per animation frame. */
export async function startQTrace(page: Page) {
  await page.evaluate(() => {
    const trace = { stop: false, rows: [] as { t: number; q: number[] }[] };
    window.__qTrace = trace;
    const rec = () => {
      if (trace.stop) return;
      const s = window.__webRobot.snapshot as unknown as { t: number; q: Float64Array } | null;
      const last = trace.rows[trace.rows.length - 1];
      if (s && (!last || s.t !== last.t)) trace.rows.push({ t: s.t, q: Array.from(s.q) });
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  });
}

export async function stopQTrace(page: Page): Promise<{ t: number; q: number[] }[]> {
  return page.evaluate(() => {
    const trace = window.__qTrace!;
    trace.stop = true;
    return trace.rows;
  });
}

/** Drag from the middle of a link with small mouse steps, one per frame. */
export async function dragLink(page: Page, link: string, dx: number, dy: number, steps: number) {
  const pt = await page.evaluate((l) => window.__webRobot.linkScreenPoint(l), link);
  if (!pt) throw new Error(`no screen point for ${link}`);
  await page.mouse.move(pt[0], pt[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(pt[0] + (dx * i) / steps, pt[1] + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Drag the target by (dx, dy) pixels with one mouse step per frame. */
export async function dragTarget(page: Page, dx: number, dy: number, steps = 20) {
  const pt = await page.evaluate(() => window.__webRobot.targetScreenPoint());
  if (!pt) throw new Error("no target on screen");
  await page.mouse.move(pt[0], pt[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(pt[0] + (dx * i) / steps, pt[1] + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

export function tipToTarget(s: { tip: ArrayLike<number>; target: ArrayLike<number> }): number {
  return Math.hypot(s.tip[0] - s.target[0], s.tip[1] - s.target[1], s.tip[2] - s.target[2]);
}
