import type { Page } from "@playwright/test";
import { collectConsoleErrors, dragTarget, tipToTarget, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

const mode = (page: Page) => page.evaluate(() => window.__webRobot.snapshot!.mode);
const selectLearned = async (page: Page) => {
  await page.getByRole("button", { name: "Learned" }).click();
  await expect.poll(() => mode(page), { timeout: 10_000 }).toBe("learned");
};

test.describe("P3: learned policy vs. baseline @p3", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("./");
    await waitReady(page);
    await page.waitForTimeout(300);
  });

  test("the learned policy settles on a reachable target within 2 s", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await selectLearned(page);
    await dragTarget(page, 70, 50);
    expect(await page.evaluate(() => window.__webRobot.snapshot!.reachable)).toBe(true);
    const reached = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const end = performance.now() + 2000;
          const check = () => {
            const s = window.__webRobot.snapshot!;
            const d = Math.hypot(
              s.tip[0] - s.target[0],
              s.tip[1] - s.target[1],
              s.tip[2] - s.target[2],
            );
            if (d <= 0.01) return resolve(true);
            if (performance.now() > end) return resolve(false);
            requestAnimationFrame(check);
          };
          check();
        }),
    );
    expect(reached).toBe(true);
    expect(errors).toEqual([]);
  });

  test("switching controllers mid-reach keeps the arm and the target (FR-012)", async ({
    page,
  }) => {
    await selectLearned(page);
    await dragTarget(page, 90, 40);
    await page.waitForTimeout(150); // mid-reach
    for (const next of ["Baseline", "Learned", "Baseline"]) {
      const before = await page.evaluate(() => {
        const s = window.__webRobot.snapshot!;
        return { t: s.t, q: [...s.q], target: [...s.target] };
      });
      await page.getByRole("button", { name: next }).click();
      await expect.poll(() => mode(page)).toBe(next.toLowerCase());
      const after = await page.evaluate(() => {
        const s = window.__webRobot.snapshot!;
        return { t: s.t, q: [...s.q], target: [...s.target] };
      });
      expect(after.target).toEqual(before.target);
      // No reset or jump: each joint moved no more than the 2.5 rad/s joint-speed limit allows in
      // the simulated time that passed (plus servo overshoot).
      const dt = after.t - before.t;
      after.q.forEach((v, j) => expect(Math.abs(v - before.q[j])).toBeLessThan(2.6 * dt + 0.02));
    }
    expect(tipToTarget(await page.evaluate(() => window.__webRobot.snapshot!))).toBeLessThan(0.5);
  });

  test("the policy view updates live while dragging", async ({ page }) => {
    await selectLearned(page);
    await page.getByRole("button", { name: "Policy view" }).click();
    const panel = page.getByRole("region", { name: "What the policy sees" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Joint angles");
    await expect(panel).toContainText("joint 5 command");
    const pt = (await page.evaluate(() => window.__webRobot.targetScreenPoint()))!;
    await page.mouse.move(pt[0], pt[1]);
    await page.mouse.down();
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(pt[0] + i * 8, pt[1] + i * 4);
      await page.waitForTimeout(40);
      seen.add(await panel.innerText());
    }
    await page.mouse.up();
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  test("the info panel shows the measured results", async ({ page }) => {
    await page.getByRole("button", { name: "About the controllers" }).click();
    const panel = page.getByRole("region", { name: "About the controllers" });
    await expect(panel).toContainText("Learned policy");
    await expect(panel).toContainText("Measured results");
    await expect(panel).toContainText("Reached target");
    await expect(panel).toContainText("Tip jerk vs baseline");
  });

  test("a corrupted policy falls back to Baseline with a notice", async ({ page }) => {
    await page.route("**/shared/policy/reach.bin", async (route) => {
      const res = await route.fetch();
      const body = Buffer.from(await res.body());
      body[100] ^= 0xff;
      await route.fulfill({ response: res, body });
    });
    await page.getByRole("button", { name: "Learned" }).click();
    await expect(page.getByRole("alert")).toContainText("Learned could not be loaded");
    await expect(page.getByRole("button", { name: "Learned" })).toBeDisabled();
    expect(await mode(page)).toBe("baseline");
  });
});
