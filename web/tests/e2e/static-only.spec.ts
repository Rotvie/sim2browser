/** SC-008 / constitution gate 3: every request is a static GET under the page's own path. */
import { dragLink, waitReady } from "./helpers";
import { expect, test } from "./fixtures";

const STATIC = /\.(html|js|css|wasm|xml|stl|obj|json|bin)$/;

test("only static same-origin GETs, no backend @p1 @p2 @p3", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const bad: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    const ok =
      req.method() === "GET" &&
      url.origin === origin &&
      url.pathname.startsWith("/web-robot/") &&
      (url.pathname === "/web-robot/" || STATIC.test(url.pathname));
    if (!ok) bad.push(`${req.method()} ${req.url()}`);
  });
  await page.goto("./");
  await waitReady(page);
  await dragLink(page, "Upper_Arm", 60, 20, 10);
  await page.getByRole("button", { name: "Reset" }).click();
  // Later rungs: target dragging (P2) and a Learned switch (P3) are added here.
  await page.waitForTimeout(500);
  expect(bad).toEqual([]);
});
