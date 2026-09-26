import { collectConsoleErrors, dragLink, dragTarget, tipToTarget, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

type Snap = { t: number; tip: number[]; target: number[]; reachable: boolean; mode: string };
const snap = (page: import("@playwright/test").Page) =>
  page.evaluate((): Snap => {
    const s = window.__webRobot.snapshot!;
    return { t: s.t, tip: [...s.tip], target: [...s.target], reachable: s.reachable, mode: s.mode };
  });

/** Poll snapshots for `ms`, returning them all. */
async function watch(page: import("@playwright/test").Page, ms: number): Promise<Snap[]> {
  return page.evaluate(
    (ms) =>
      new Promise<Snap[]>((resolve) => {
        const out: Snap[] = [];
        const end = performance.now() + ms;
        const rec = () => {
          const s = window.__webRobot.snapshot!;
          if (!out.length || out[out.length - 1].t !== s.t)
            out.push({
              t: s.t,
              tip: [...s.tip],
              target: [...s.target],
              reachable: s.reachable,
              mode: s.mode,
            });
          if (performance.now() < end) requestAnimationFrame(rec);
          else resolve(out);
        };
        requestAnimationFrame(rec);
      }),
    ms,
  );
}

test.describe("P2: baseline reaches the target @p2", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("./");
    await waitReady(page);
    await page.waitForTimeout(300);
  });

  test("starts in Baseline and settles on a reachable target within 2 s", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    expect((await snap(page)).mode).toBe("baseline");
    await expect(page.getByRole("button", { name: "Baseline" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await dragTarget(page, 70, 50);
    const after = await snap(page);
    expect(after.reachable).toBe(true);
    const trace = await watch(page, 2000);
    expect(trace.some((s) => tipToTarget(s) <= 0.01)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("follows a continuous circular drag without stalls", async ({ page }) => {
    const pt = (await page.evaluate(() => window.__webRobot.targetScreenPoint()))!;
    // Start the circle on a reachable point a little toward the base.
    await dragTarget(page, 60, 30);
    await page.waitForTimeout(1500);
    const c = (await page.evaluate(() => window.__webRobot.targetScreenPoint()))!;
    await page.mouse.move(c[0], c[1]);
    await page.mouse.down();
    const recording = watch(page, 3000);
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const a = ((Date.now() - start) / 3000) * 2 * Math.PI;
      await page.mouse.move(c[0] + 40 * Math.sin(a), c[1] - 30 + 30 * Math.cos(a));
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    const trace = await recording;
    expect(pt).not.toBeNull();
    const t0 = trace[0].t;
    for (const s of trace.filter((s) => s.t - t0 > 0.5)) expect(tipToTarget(s)).toBeLessThan(0.05);
    const gaps = trace.slice(1).map((s, i) => s.t - trace[i].t);
    // Sim time between consecutive snapshots seen by the page: at most 5 control steps (100 ms).
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  test("out of reach: marked, arm stops stretched, then resumes when back in reach", async ({
    page,
  }, info) => {
    // Push the target away from the camera until it is out of reach. It keeps its screen position,
    // so this works on any viewport: the wheel on desktop, the two-finger depth gesture on touch.
    test.skip(
      info.project.name === "mobile-webkit",
      "WebKit has no multi-touch or wheel emulation",
    );
    const touch =
      info.project.name === "mobile-chromium" ? await page.context().newCDPSession(page) : null;
    for (let i = 0; i < 30 && (await snap(page)).reachable; i++) {
      const [x, y] = (await page.evaluate(() => window.__webRobot.targetScreenPoint()))!;
      if (!touch) {
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, -120);
      } else {
        const f2 = { x: x + 80, y: y + 120 };
        const pts = (dy: number) => [
          { x, y, id: 1 },
          { x: f2.x, y: f2.y - dy, id: 2 },
        ];
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y, id: 1 }],
        });
        await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(0) });
        for (let k = 1; k <= 10; k++)
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: pts(k * 6),
          });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      }
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(2500);
    const out = await snap(page);
    expect(out.reachable).toBe(false);
    await expect(page.getByText("Out of reach")).toBeVisible();
    const trace = await watch(page, 500);
    const spread = Math.max(
      ...trace.map((s) => Math.hypot(...s.tip.map((v, i) => v - trace[0].tip[i]))),
    );
    expect(spread).toBeLessThan(0.001);

    await page.getByRole("button", { name: "Reset" }).click();
    await page.waitForTimeout(300);
    await dragTarget(page, 60, 40);
    const back = await snap(page);
    expect(back.reachable).toBe(true);
    await expect(page.getByText("Out of reach")).toBeHidden();
    const t2 = await watch(page, 2000);
    expect(t2.some((s) => tipToTarget(s) <= 0.01)).toBe(true);
  });

  test("grabbing a joint switches to Manual; the mode switch returns to Baseline", async ({
    page,
  }) => {
    await dragLink(page, "Lower_Arm", 40, 20, 10);
    await expect.poll(async () => (await snap(page)).mode).toBe("manual");
    await expect(page.getByRole("button", { name: "Manual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Baseline" }).click();
    await expect.poll(async () => (await snap(page)).mode).toBe("baseline");
  });

  test("the info panel describes the baseline with values from parity.json", async ({
    page,
    request,
  }) => {
    const parity = await (await request.get("shared/parity.json")).json();
    await page.getByRole("button", { name: "About the controllers" }).click();
    const panel = page.getByRole("region", { name: "About the controllers" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/damped least-squares/i);
    await expect(panel).toContainText("Tracks the target directly, with no trajectory planning");
    await expect(panel).toContainText(`${parity.baseline.gain} /s`);
    await expect(panel).toContainText(`${parity.baseline.maxJointSpeed} rad/s`);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
});
