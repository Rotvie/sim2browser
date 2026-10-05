/** 002 P3: the info panel shows the release evaluation's grasp numbers (spec User Story 3). */
import { readFileSync } from "node:fs";
import { waitReady } from "./helpers";
import { expect, test } from "./fixtures";

const committed = JSON.parse(
  readFileSync(new URL("../../../shared/grasp-eval.json", import.meta.url), "utf8"),
) as { n: number; successRate: number; medianTimeToLift: number | null };

test.describe("002 P3: honest grasp metrics @g3", () => {
  test("the info panel shows exactly the committed grasp evaluation", async ({ page }) => {
    await page.goto("./");
    await waitReady(page);
    await page.getByRole("button", { name: "About the controllers" }).click();
    const section = page.locator(".grasp-info");
    await expect(section).toBeVisible();
    await expect(section).toContainText("Scripted grasp");
    await expect(section).toContainText(`${(committed.successRate * 100).toFixed(1)}%`);
    await expect(section).toContainText(`${committed.medianTimeToLift!.toFixed(1)} s`);
    await expect(section).toContainText(`${committed.n} random cube placements`);
    const success = section.locator("dd").first().locator("span");
    await expect(success).toHaveClass(committed.successRate >= 0.9 ? "ok" : "miss");
  });
});
