/** 002 P2: the scripted grasp (spec User Story 2, contracts/ui.md "Grasp status chip"). */
import { collectConsoleErrors, dragCube, dragTarget, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

const state = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const s = window.__sim2browser.snapshot!;
    return {
      mode: s.mode,
      gripper: s.gripper,
      phase: s.grasp?.phase ?? null,
      cube: [...s.cube.pos],
    };
  });

test.describe("002 P2: scripted grasp @g2", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("./");
    await waitReady(page);
    await page.waitForTimeout(300);
  });

  test("the mode switch offers Scripted grasp; it lifts the cube and says so", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectConsoleErrors(page);
    const modes = page.getByRole("group", { name: "Controller" }).getByRole("button");
    // Grouped by task (004): Reach, then Grasp; inside a group the short name is shown.
    await expect(modes).toHaveText(["Manual", "Baseline", "Learned", "Scripted"]);
    await expect(page.getByRole("group", { name: "Grasp" })).toBeVisible();
    await page.getByRole("button", { name: "Scripted grasp", exact: true }).click();
    const chip = page.getByRole("status");
    await expect(chip).toContainText(/Approaching|Descending/, { timeout: 5000 });
    await expect(chip).toContainText("Lifted ✓", { timeout: 20_000 });
    expect((await state(page)).cube[2]).toBeGreaterThan(0.06);
    await expect(page.getByRole("button", { name: "Grasp again" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("grasps a cube moved elsewhere; refuses one out of reach", async ({ page }) => {
    test.setTimeout(60_000);
    await dragCube(page, 0.07, -0.2);
    await page.getByRole("button", { name: "Scripted grasp", exact: true }).click();
    const chip = page.getByRole("status");
    await expect(chip).toContainText("Lifted ✓", { timeout: 20_000 });

    await page.getByRole("button", { name: "Reset" }).click(); // cube back; a new attempt starts
    await page.getByRole("button", { name: "Baseline" }).click();
    await dragCube(page, 0.0, -0.36); // beyond the graspable region
    await page.getByRole("button", { name: "Scripted grasp", exact: true }).click();
    await expect(chip).toContainText("Failed: cube out of reach", { timeout: 5000 });
  });

  // Data model: leaving the grasp keeps the gripper command. The grasp itself may still change
  // it before the drag reaches the worker (slow runners), so compare across the handover itself.
  test("dragging the target mid-grasp hands over to the baseline, gripper unchanged", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scripted grasp", exact: true }).click();
    await expect.poll(async () => (await state(page)).phase, { timeout: 5000 }).toBe("approach");
    // Record, frame by frame, the gripper in the last grasp snapshot and the first baseline one.
    await page.evaluate(() => {
      const w = window as unknown as { __handover: { last?: string; first?: string } };
      w.__handover = {};
      const rec = () => {
        const s = window.__sim2browser.snapshot!;
        if (s.mode === "grasp") w.__handover.last = s.gripper;
        else if (s.mode === "baseline" && w.__handover.first === undefined) {
          w.__handover.first = s.gripper;
          return;
        }
        requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
    });
    await dragTarget(page, 40, -30);
    await expect.poll(async () => (await state(page)).mode).toBe("baseline");
    await page.waitForTimeout(1000);
    const h = await page.evaluate(
      () => (window as unknown as { __handover: { last?: string; first?: string } }).__handover,
    );
    expect(h.first).toBe(h.last);
    expect((await state(page)).gripper).toBe(h.first);
    await expect(page.getByRole("status")).toBeHidden();
  });
});
