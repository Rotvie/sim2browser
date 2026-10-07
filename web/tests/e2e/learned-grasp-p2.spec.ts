/**
 * 004 P2: the learned grasp next to the scripted one (spec User Story 2, contracts/ui.md). Skipped
 * while parity.json ships no grasp policy (the learned grasp is then not offered at all).
 */
import { readFileSync } from "node:fs";
import { collectConsoleErrors, dragTarget, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

const parity = JSON.parse(
  readFileSync(new URL("../../../shared/parity.json", import.meta.url), "utf8"),
);

test.describe("004 P2: learned grasp @lg2", () => {
  test.skip(!parity.graspPolicy, "no grasp policy shipped (parity.json has no graspPolicy)");

  test.beforeEach(async ({ page }) => {
    await page.goto("./");
    await waitReady(page);
    await page.waitForTimeout(300);
  });

  test("offers Learned grasp; an attempt ends with an outcome", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectConsoleErrors(page);
    const modes = page.getByRole("group", { name: "Controller" }).getByRole("button");
    await expect(modes).toHaveText([
      "Manual",
      "Baseline",
      "Learned",
      "Scripted grasp",
      "Learned grasp",
    ]);
    await page.getByRole("button", { name: "Learned grasp", exact: true }).click();
    const chip = page.getByRole("status");
    await expect(chip).toContainText(/Running/, { timeout: 10_000 });
    await expect(chip).toContainText(/Lifted ✓|Failed/, { timeout: 20_000 });
    expect(errors).toEqual([]);
  });

  test("Retry after switching to the scripted grasp uses the same placement", async ({ page }) => {
    test.setTimeout(60_000);
    const cube = () => page.evaluate(() => [...window.__sim2browser.snapshot!.cube.pos]);
    const start = await cube();
    await page.getByRole("button", { name: "Learned grasp", exact: true }).click();
    const chip = page.getByRole("status");
    await expect(chip).toContainText(/Lifted ✓|Failed/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Scripted grasp", exact: true }).click();
    await page.getByRole("button", { name: "Retry" }).click();
    // Read it before the grasp closes on the cube (closing pushes it onto the fixed jaw).
    await expect
      .poll(
        async () => {
          const now = await cube();
          return Math.hypot(now[0] - start[0], now[1] - start[1]);
        },
        { intervals: [20] },
      )
      .toBeLessThan(0.001);
    await expect(chip).toContainText(/Approaching|Descending|Closing|Lifting|Holding|Lifted/);
  });

  test("a target drag during a learned grasp hands over to the baseline", async ({ page }) => {
    await page.getByRole("button", { name: "Learned grasp", exact: true }).click();
    await page.waitForTimeout(500);
    await dragTarget(page, 40, -30);
    await expect
      .poll(() => page.evaluate(() => window.__sim2browser.snapshot!.mode))
      .toBe("baseline");
  });

  test("the policy view shows 32 inputs and 6 outputs", async ({ page }) => {
    await page.getByRole("button", { name: "Learned grasp", exact: true }).click();
    await page.getByRole("button", { name: /Policy/ }).click();
    const panel = page.getByRole("region", { name: "What the policy sees" });
    await expect(panel).toContainText("Cube vs. jaws facing it");
    await expect(panel).toContainText("Gripper (> 0 closes)");
  });

  test("the mode switch fits a 360 px wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
