import { collectConsoleErrors, dragLink, startQTrace, stopQTrace, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

// SC-001 / SC-002 are about visitors' devices. CI runners have no GPU and few cores, so there the
// timings are recorded (annotations) but not asserted; they are gated locally and on real phones.
const assertPerf = !process.env.CI;

test.describe("P1: see and pose the arm @p1", () => {
  test("arm is interactive within 3 s on a 4G-like connection (SC-001)", async ({
    page,
    browserName,
  }, info) => {
    test.skip(browserName !== "chromium", "network throttling needs CDP");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: (12 * 1024 * 1024) / 8,
      uploadThroughput: (4 * 1024 * 1024) / 8,
    });
    const t0 = Date.now();
    await page.goto("./");
    await waitReady(page, 15_000);
    const ms = Date.now() - t0;
    info.annotations.push({ type: "time-to-interactive-ms", description: String(ms) });
    if (assertPerf) expect(ms).toBeLessThanOrEqual(3000);
  });

  test("orbit, pose, limits, smoothness", async ({ page }, info) => {
    // Long scenario (10 s of continuous posing plus setup); slow CI runners with the 4× mobile CPU
    // throttle need more than the default 60 s.
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    await page.goto("./");
    await waitReady(page);
    await page.waitForTimeout(500);

    // (b) dragging empty space orbits the camera
    const cam0 = await page.evaluate(() => window.__sim2browser.camera());
    await page.mouse.move(60, 200);
    await page.mouse.down();
    await page.mouse.move(160, 240, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const cam1 = await page.evaluate(() => window.__sim2browser.camera());
    expect(cam0.some((v, i) => Math.abs(v - cam1[i]) > 1e-3)).toBe(true);

    // Reset the view angle influence: reload for a known camera.
    await page.reload();
    await waitReady(page);
    await page.waitForTimeout(500);
    const limits = await page.evaluate(() => window.__sim2browser.limits());

    // (c) dragging the upper arm moves its joint (Pitch, index 1)
    const qBefore = await page.evaluate(() => Array.from(window.__sim2browser.snapshot!.q));
    await dragLink(page, "Upper_Arm", 40, 0, 10);
    await page.waitForTimeout(600);
    const qAfter = await page.evaluate(() => Array.from(window.__sim2browser.snapshot!.q));
    expect(Math.abs(qAfter[1] - qBefore[1])).toBeGreaterThan(0.05);

    // (d) dragging far past a limit holds the joint at its limit, with no teleports: joint speed
    // stays near the shared 2.5 rad/s joint-speed limit
    await startQTrace(page);
    await dragLink(page, "Upper_Arm", 600, 200, 40);
    await page.waitForTimeout(1500);
    await dragLink(page, "Upper_Arm", -600, -200, 40);
    await page.waitForTimeout(1500);
    const trace = await stopQTrace(page);
    expect(trace.length).toBeGreaterThan(30);
    let maxSpeed = 0;
    for (let k = 0; k < trace.length; k++) {
      const q = trace[k].q;
      for (let j = 0; j < q.length; j++) {
        expect(q[j]).toBeGreaterThanOrEqual(limits[2 * j] - 0.01);
        expect(q[j]).toBeLessThanOrEqual(limits[2 * j + 1] + 0.01);
        if (k > 0) {
          const dt = trace[k].t - trace[k - 1].t;
          maxSpeed = Math.max(maxSpeed, Math.abs(q[j] - trace[k - 1].q[j]) / dt);
        }
      }
    }
    info.annotations.push({ type: "max-joint-speed-rad-s", description: maxSpeed.toFixed(2) });
    expect(maxSpeed).toBeLessThanOrEqual(4);

    // (e) 10 s of continuous posing stays smooth (SC-002)
    await page.evaluate(() => window.__sim2browser.resetFrameStats());
    const pt = await page.evaluate(() => window.__sim2browser.linkScreenPoint("Lower_Arm"));
    await page.mouse.move(pt![0], pt![1]);
    await page.mouse.down();
    const tEnd = Date.now() + 10_000;
    let i = 0;
    while (Date.now() < tEnd) {
      const a = (i++ / 60) * Math.PI;
      await page.mouse.move(pt![0] + 60 * Math.sin(a), pt![1] + 40 * Math.sin(2 * a));
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    const { fps, maxFrameGapMs } = await page.evaluate(() => ({
      fps: window.__sim2browser.fps,
      maxFrameGapMs: window.__sim2browser.maxFrameGapMs,
    }));
    info.annotations.push({ type: "fps", description: fps.toFixed(1) });
    info.annotations.push({ type: "max-frame-gap-ms", description: maxFrameGapMs.toFixed(1) });
    if (assertPerf && info.project.name !== "mobile-webkit") {
      expect(fps).toBeGreaterThanOrEqual(30);
      expect(maxFrameGapMs).toBeLessThanOrEqual(100);
    }

    // (f) no console errors
    expect(errors).toEqual([]);
  });

  test("reset returns to the starting pose", async ({ page }) => {
    await page.goto("./");
    await waitReady(page);
    await page.waitForTimeout(300);
    const q0 = await page.evaluate(() => Array.from(window.__sim2browser.snapshot!.q));
    await dragLink(page, "Upper_Arm", 80, 0, 10);
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Reset" }).click();
    await page.waitForTimeout(300);
    const q1 = await page.evaluate(() => Array.from(window.__sim2browser.snapshot!.q));
    q1.forEach((v, j) => expect(Math.abs(v - q0[j])).toBeLessThan(0.02));
  });
});
