import { test as base, expect } from "@playwright/test";

/** On mobile-chromium, emulate a mid-range phone CPU (4× slowdown) for every test. */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (testInfo.project.name === "mobile-chromium") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await use(page);
  },
});

export { expect };
