/** Lab controllers (registry `public: false`) appear only with ?lab, and run like any other. */
import { dragTarget, tipToTarget, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

test("lab controllers are hidden on the public page and usable with ?lab @p3", async ({ page }) => {
  await page.goto("./");
  await waitReady(page);
  await expect(page.getByRole("button", { name: "Jacobian T" })).toHaveCount(0);

  await page.goto("./?lab");
  await waitReady(page);
  await page.getByRole("button", { name: "Jacobian T" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__webRobot.snapshot!.mode))
    .toBe("jacobian-transpose");
  await dragTarget(page, 60, 30);
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => window.__webRobot.snapshot!);
  expect(tipToTarget(s)).toBeLessThan(0.05);
  await page.getByRole("button", { name: "About the controllers" }).click();
  await expect(page.getByRole("region", { name: "About the controllers" })).toContainText(
    "Lab controllers",
  );
});
