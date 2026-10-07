/**
 * 002/004 P3: the info panel shows the release evaluation's grasp numbers, one table row per
 * grasp controller with a committed report (spec User Story 3).
 */
import { readFileSync } from "node:fs";
import { waitReady } from "./helpers";
import { expect, test } from "./fixtures";

type Report = { n: number; successRate: number; medianTimeToLift: number | null };
const report = (id: string): Report =>
  JSON.parse(
    readFileSync(new URL(`../../../shared/grasp-eval/${id}.json`, import.meta.url), "utf8"),
  );

test.describe("002 P3: honest grasp metrics @g3", () => {
  test("the info panel shows exactly the committed grasp evaluation", async ({ page }) => {
    const committed = report("grasp");
    await page.goto("./");
    await waitReady(page);
    await page.getByRole("button", { name: "About the controllers" }).click();
    const section = page.locator(".grasp-info");
    await expect(section).toBeVisible();
    const row = section.locator('tr[data-controller="grasp"]');
    await expect(row).toContainText("Scripted grasp");
    await expect(row).toContainText(`${(committed.successRate * 100).toFixed(1)}%`);
    await expect(row).toContainText(`${committed.medianTimeToLift!.toFixed(1)} s`);
    await expect(section).toContainText(`${committed.n} random cube placements`);
    await expect(row.locator("td").first()).toHaveClass(
      committed.successRate >= 0.9 ? "ok" : "miss",
    );
    // Lab grasp controllers only with ?lab.
    await expect(section.locator('tr[data-controller="naive-grasp"]')).toHaveCount(0);
  });

  test("with ?lab, measured lab grasp controllers get a row too", async ({ page }) => {
    await page.goto("./?lab");
    await waitReady(page);
    await page.getByRole("button", { name: "About the controllers" }).click();
    const row = page.locator('.grasp-info tr[data-controller="naive-grasp"]');
    await expect(row).toContainText("Naive grasp");
    await expect(row).toContainText("lab");
    await expect(row).toContainText(`${(report("naive-grasp").successRate * 100).toFixed(1)}%`);
  });
});
