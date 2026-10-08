/**
 * SC-005 soak (001) and 002 SC-006: a seeded random walk over the actions this build offers, for
 * 10 minutes: target and joint drags, camera, reset, mode switches (including Grasp), and from
 * 002 gripper toggles (also closing on nothing), cube drags, "Grasp again" and tab hide/show.
 * Actions are discovered from the page (mode buttons appear from P2 on), so the same spec is the
 * release check for every rung. Run: npm run test:e2e -- --grep @soak --project desktop-chromium
 */
import { collectConsoleErrors, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

const DURATION_MS = Number(process.env.SOAK_MS ?? 10 * 60_000);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("soak: random interaction stays healthy @soak", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "soak runs on desktop Chromium only");
  test.setTimeout(DURATION_MS + 120_000);
  const errors = collectConsoleErrors(page);
  await page.goto("./");
  await waitReady(page);

  // Watchdog inside the page: every frame, check the latest snapshot.
  await page.evaluate(() => {
    const w = window as unknown as {
      __soak: { bad: string[]; lastT: number; lastAt: number; maxGap: number };
    };
    w.__soak = { bad: [], lastT: -1, lastAt: performance.now(), maxGap: 0 };
    const limits = window.__sim2browser.limits();
    // A hidden tab pauses the simulation (001 edge case): do not count that as a stall.
    document.addEventListener("visibilitychange", () => {
      w.__soak.lastT = -1;
      w.__soak.lastAt = performance.now();
    });
    const check = () => {
      const s = window.__sim2browser.snapshot as unknown as {
        t: number;
        q: Float64Array;
        tip: Float64Array;
        cube?: { pos: Float64Array };
      };
      const now = performance.now();
      if (s && s.t !== w.__soak.lastT) {
        if (w.__soak.lastT >= 0 && !document.hidden)
          w.__soak.maxGap = Math.max(w.__soak.maxGap, now - w.__soak.lastAt);
        w.__soak.lastT = s.t;
        w.__soak.lastAt = now;
        const vals = [...s.q, ...s.tip];
        if (vals.some((v) => !Number.isFinite(v))) w.__soak.bad.push(`NaN at t=${s.t}`);
        // Soft limits: < 0.01 rad free, < 0.02 rad with the arm pressed into the floor (002).
        s.q.forEach((v, j) => {
          if (v < limits[2 * j] - 0.02 || v > limits[2 * j + 1] + 0.02)
            w.__soak.bad.push(`joint ${j}=${v} out of limits`);
        });
        const c = s.cube?.pos;
        if (c) {
          if (c[2] < 0.0135) w.__soak.bad.push(`cube ${c[2].toFixed(4)} m: into the floor`);
          if (Math.hypot(c[0], c[1], c[2]) > 2) w.__soak.bad.push(`cube flew off: ${[...c]}`);
        }
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });

  const rand = mulberry32(12345);
  const vp = page.viewportSize()!;
  const links = ["Rotation_Pitch", "Upper_Arm", "Lower_Arm", "Wrist_Pitch_Roll", "Fixed_Jaw"];
  const end = Date.now() + DURATION_MS;
  let nextModeSwitch = Date.now() + 5000 + rand() * 15_000;
  let actions = 0;
  let targetDrags = 0;
  let cubeDrags = 0;
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(x + (dx * i) / 20, y + (dy * i) / 20);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  };
  const onScreen = (pt: [number, number] | null): pt is [number, number] =>
    !!pt && pt[0] > 0 && pt[1] > 0 && pt[0] < vp.width && pt[1] < vp.height;

  while (Date.now() < end) {
    const r = rand();
    if (Date.now() > nextModeSwitch) {
      // 004: a visible controller slot of the current task, or the other task's tab.
      const modeButtons = page.locator('[data-mode]:visible, [role="tab"]');
      const n = await modeButtons.count();
      if (n > 0) await modeButtons.nth(Math.floor(rand() * n)).click();
      nextModeSwitch = Date.now() + 5000 + rand() * 15_000;
    } else if (r < 0.25) {
      // Target drag (P2 on), sometimes far enough to leave the reachable workspace.
      const pt = await page.evaluate(() =>
        "targetScreenPoint" in window.__sim2browser
          ? window.__sim2browser.targetScreenPoint()
          : null,
      );
      if (pt && pt[0] > 0 && pt[1] > 0 && pt[0] < vp.width && pt[1] < vp.height) {
        const far = rand() < 0.3 ? 3 : 1;
        const dx = (rand() - 0.5) * 300 * far;
        const dy = (rand() - 0.5) * 200 * far;
        await page.mouse.move(pt[0], pt[1]);
        await page.mouse.down();
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(pt[0] + (dx * i) / 20, pt[1] + (dy * i) / 20);
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
        targetDrags++;
      }
    } else if (r < 0.4) {
      const pt = await page.evaluate(
        (l) => window.__sim2browser.linkScreenPoint(l),
        links[Math.floor(rand() * links.length)],
      );
      if (pt && pt[0] > 0 && pt[1] > 0 && pt[0] < vp.width && pt[1] < vp.height) {
        await page.mouse.move(pt[0], pt[1]);
        await page.mouse.down();
        const dx = (rand() - 0.5) * 400;
        const dy = (rand() - 0.5) * 400;
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(pt[0] + (dx * i) / 20, pt[1] + (dy * i) / 20);
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
      }
    } else if (r < 0.5) {
      // 002: drag the cube somewhere on the floor (refused while held).
      const pt = await page.evaluate(() => window.__sim2browser.cubeScreenPoint());
      if (onScreen(pt)) {
        await drag(pt[0], pt[1], (rand() - 0.5) * 300, (rand() - 0.5) * 200);
        cubeDrags++;
      }
    } else if (r < 0.58) {
      await page.keyboard.press("g"); // 002: open/close the gripper, around the cube or nothing
    } else if (r < 0.63) {
      const again = page.getByRole("button", { name: "Grasp again" });
      if (await again.isVisible()) await again.click();
    } else if (r < 0.66) {
      // 002: tab hidden for a while (mid-grasp sometimes), then back.
      const setHidden = (hidden: boolean) =>
        page.evaluate((h) => {
          Object.defineProperty(document, "hidden", { value: h, configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        }, hidden);
      await setHidden(true);
      await page.waitForTimeout(500 + rand() * 1500);
      await setHidden(false);
    } else if (r < 0.8) {
      const x = 40 + rand() * 120;
      const y = 120 + rand() * (vp.height - 240);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (rand() - 0.5) * 200, y + (rand() - 0.5) * 100, { steps: 10 });
      await page.mouse.up();
    } else if (r < 0.9) {
      await page.mouse.wheel(0, (rand() - 0.5) * 400);
    } else {
      await page.getByRole("button", { name: "Reset" }).click();
    }
    actions++;
    await page.waitForTimeout(50 + rand() * 400);
  }

  const soak = await page.evaluate(
    () => (window as unknown as { __soak: { bad: string[]; maxGap: number } }).__soak,
  );
  info.annotations.push({ type: "actions", description: String(actions) });
  info.annotations.push({ type: "target-drags", description: String(targetDrags) });
  info.annotations.push({ type: "cube-drags", description: String(cubeDrags) });
  info.annotations.push({ type: "max-snapshot-gap-ms", description: soak.maxGap.toFixed(1) });
  expect(soak.bad.slice(0, 5)).toEqual([]);
  expect(soak.maxGap).toBeLessThanOrEqual(500);
  expect(errors).toEqual([]);
});
