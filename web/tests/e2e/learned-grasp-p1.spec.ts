/** 004 P1: recording demonstrations (spec User Story 1, contracts/ui.md "Recording mode"). */
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { collectConsoleErrors, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

test.describe("004 P1: recording mode @lg1", () => {
  test("without ?record there is no recording card", async ({ page }) => {
    await page.goto("./");
    await waitReady(page);
    await expect(page.getByRole("region", { name: "Recording" })).toHaveCount(0);
  });

  test("records a scripted grasp, keeps it and saves a demonstration file", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectConsoleErrors(page);
    await page.goto("./?record&task=grasp");
    await waitReady(page);
    const card = page.getByRole("region", { name: "Recording" });
    await expect(card).toContainText("next placement #0 (seed 2000)");
    await page.getByRole("button", { name: "Scripted grasp", exact: true }).click();
    await card.getByRole("button", { name: "Start" }).click();
    await expect(card).toContainText("· placement #0");
    await expect(card).toContainText(/Last: lifted in [\d.]+ s \(scripted\)/, { timeout: 30_000 });
    await expect(card).toContainText("next placement #1");
    await card.getByRole("button", { name: "Keep" }).click();
    await expect(card).toContainText("scripted 1 lifted / 0 failed");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      card.getByRole("button", { name: "Save file" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^hand-\d{8}-\d{4}\.demos\.jsonl\.gz$/);
    const lines = gunzipSync(await readFile((await download.path())!))
      .toString()
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    const header = JSON.parse(lines[0]);
    expect(header).toMatchObject({
      kind: "sim2browser-demos",
      format: 1,
      generator: "record-mode",
    });
    const ep = JSON.parse(lines[1]);
    expect(ep).toMatchObject({ source: "scripted", placement: { seed: 2000, index: 0 } });
    expect(errors).toEqual([]);
  });
});
