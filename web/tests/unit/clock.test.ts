import { describe, expect, it } from "vitest";
import { createClock } from "../../src/sim/clock";

describe("clock", () => {
  it("returns control steps due at 50 Hz", () => {
    const c = createClock({ controlHz: 50 });
    expect(c.tick(0)).toBe(0);
    expect(c.tick(20)).toBe(1);
    expect(c.tick(30)).toBe(0);
    expect(c.tick(60)).toBe(2);
  });

  it("caps at 5 steps per tick and drops the excess time", () => {
    const c = createClock({ controlHz: 50 });
    c.tick(0);
    expect(c.tick(1000)).toBe(5);
    expect(c.tick(1010)).toBe(0); // no leftover backlog
    expect(c.tick(1020)).toBe(1);
  });

  it("does not burst after resume", () => {
    const c = createClock({ controlHz: 50 });
    c.tick(0);
    c.pause();
    expect(c.tick(5000)).toBe(0);
    c.resume(10_000);
    expect(c.tick(10_005)).toBe(0);
    expect(c.tick(10_020)).toBe(1);
  });
});
