/**
 * 002 P1: gripper and cube by hand (spec User Story 1, contracts/ui.md). The physics of grasping
 * by hand (lift, hold, drop, hold across switches, refusals) is tested on the worker's Session in
 * tests/unit/byHand.test.ts; this covers the page: cube, gripper button and key, cube drag, reset.
 */
import { openGraspByHand, collectConsoleErrors, dragCube } from "./helpers";
import { expect, test } from "./fixtures";

const snap = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = window.__sim2browser.snapshot!;
    return { gripper: s.gripper, jaw: s.jaw, cube: [...s.cube.pos], held: s.cube.held };
  });

test.describe("002 P1: gripper and cube by hand @g1", () => {
  test.beforeEach(async ({ page }) => {
    await openGraspByHand(page); // 004: grasping by hand lives in the Grasp task
  });

  test("the cube rests in front of the arm; the gripper button and G toggle the jaw", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    const s0 = await snap(page);
    expect(s0.cube[1]).toBeCloseTo(-0.265, 2);
    expect(s0.cube[2]).toBeCloseTo(0.015, 3);
    expect(s0.gripper).toBe("closed");

    await page.getByRole("button", { name: "Open gripper" }).click();
    await expect(page.getByRole("button", { name: "Close gripper" })).toBeVisible();
    await expect.poll(async () => (await snap(page)).jaw, { timeout: 3000 }).toBeGreaterThan(0.9);

    await page.keyboard.press("g");
    await expect(page.getByRole("button", { name: "Open gripper" })).toBeVisible();
    await expect.poll(async () => (await snap(page)).jaw, { timeout: 3000 }).toBeLessThan(0);
    expect(errors).toEqual([]);
  });

  test("dragging the cube moves it over the floor; reset puts it back", async ({ page }) => {
    const goal = [0.06, -0.22];
    await dragCube(page, goal[0], goal[1]);
    await page.waitForTimeout(100);
    const moved = (await snap(page)).cube;
    expect(Math.hypot(moved[0] - goal[0], moved[1] - goal[1])).toBeLessThan(0.015);
    expect(moved[2]).toBeCloseTo(0.015, 3);

    await page.getByRole("button", { name: "Reset" }).click();
    await page.waitForTimeout(200);
    const back = await snap(page);
    expect(back.cube[0]).toBeCloseTo(0, 3);
    expect(back.cube[1]).toBeCloseTo(-0.265, 3);
    expect(back.gripper).toBe("closed");
  });
});
