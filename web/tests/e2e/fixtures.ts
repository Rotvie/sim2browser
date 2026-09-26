import { test as base, expect } from "@playwright/test";

/**
 * On mobile-chromium, emulate a mid-range phone CPU (4× slowdown) for every test. Not in CI:
 * GitHub runners are already slow 2-core VMs without a GPU, and throttling them 4× more is far
 * below any real phone. There the mobile project checks viewport, touch and layout; the 4× figure
 * is calibrated on development machines (see specs/001-arm-reach/validation.md).
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    if (testInfo.project.name === "mobile-chromium" && !process.env.CI) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await use(page);
  },
});

export { expect };
