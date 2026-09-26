import { describe, expect, it } from "vitest";
import { angleDeltaFromDrag, rotateAbout, type Project, type Vec3 } from "../../src/render/picking";

// Orthographic top-down view: screen x = world x, screen y = -world y, 1 m = 1000 px.
const topDown: Project = ([x, y]) => [x * 1000, -y * 1000];
// Side view looking along +y: screen x = world x, screen y = -world z.
const side: Project = ([x, , z]) => [x * 1000, -z * 1000];

describe("joint drag mapping", () => {
  it("dragging along the rotation direction gives a positive angle (axis z, top view)", () => {
    // Lever along +x; +rotation about +z moves the point toward +y, i.e. screen up (−y).
    const d = angleDeltaFromDrag(topDown, [0, 0, 0], [0, 0, 1], [0.1, 0, 0], [0, -10]);
    expect(d).toBeCloseTo(0.1, 3);
    expect(angleDeltaFromDrag(topDown, [0, 0, 0], [0, 0, 1], [0.1, 0, 0], [0, 10])).toBeCloseTo(
      -0.1,
      3,
    );
  });

  it("works for axes along x and y (side view)", () => {
    const ax: Vec3 = [1, 0, 0];
    // Lever along +y rotates about +x toward +z: screen up.
    const dx = angleDeltaFromDrag(side, [0, 0, 0], ax, [0, 0.1, 0.05], [0, -10]);
    expect(dx).toBeGreaterThan(0);
    const ay: Vec3 = [0, 1, 0];
    // Lever along +z rotates about +y toward +x: screen right.
    expect(angleDeltaFromDrag(side, [0, 0, 0], ay, [0, 0, 0.1], [10, 0])).toBeCloseTo(0.1, 3);
  });

  it("ignores rotations that are invisible on screen", () => {
    // Axis x viewed top-down with the lever along x: the point does not move.
    expect(angleDeltaFromDrag(topDown, [0, 0, 0], [1, 0, 0], [0.1, 0, 0], [10, 10])).toBe(0);
  });

  it("stays continuous across ±π when following a full circle", () => {
    let lever: Vec3 = [0.1, 0, 0];
    let total = 0;
    let maxStep = 0;
    for (let i = 0; i < 400; i++) {
      // Move the pointer along the circle's screen tangent.
      const before = topDown(lever);
      const after = topDown(rotateAbout(lever, [0, 0, 1], (2 * Math.PI) / 400));
      const d = angleDeltaFromDrag(topDown, [0, 0, 0], [0, 0, 1], lever, [
        after[0] - before[0],
        after[1] - before[1],
      ]);
      maxStep = Math.max(maxStep, Math.abs(d));
      total += d;
      lever = rotateAbout(lever, [0, 0, 1], d);
    }
    expect(total).toBeCloseTo(2 * Math.PI, 2);
    expect(maxStep).toBeLessThan(0.02);
  });
});
