import { describe, expect, it } from "vitest";
import { createWorkspace, Target } from "../../src/sim/target";
import { loadNodeSim } from "../node-shared";

async function setup() {
  const { sim, parity, workspace } = await loadNodeSim();
  const ws = createWorkspace(workspace, parity.reach.workspace);
  const home = sim.fkSite(parity.tipSite, parity.baseline.neutralPose);
  return { sim, parity, ws, home };
}

describe("Target", () => {
  it("clamps z to >= minZ", async () => {
    const { parity, ws, home } = await setup();
    const t = new Target(parity.reach, ws, home);
    t.set([0.1, -0.2, -0.5]);
    expect(t.pos[2]).toBe(parity.reach.minZ);
  });

  it("pushes positions inside the base exclusion radius out to it", async () => {
    const { parity, ws, home } = await setup();
    const t = new Target(parity.reach, ws, home);
    const [bx, by] = parity.reach.baseAxisXY;
    t.set([bx + 0.01, by, 0.2]);
    expect(Math.hypot(t.pos[0] - bx, t.pos[1] - by)).toBeCloseTo(
      parity.reach.baseExclusionRadius,
      9,
    );
    expect(t.pos[0]).toBeGreaterThan(bx); // pushed radially, same direction
    expect(t.pos[2]).toBe(0.2);
  });

  it("uses the workspace grid, not just distance: a point within maxReach can be unreachable", async () => {
    const { parity, ws, home } = await setup();
    const t = new Target(parity.reach, ws, home);
    expect(t.reachable).toBe(true);
    // Search the ball of radius maxReach around the shoulder for an empty voxel above the ground.
    const sh = [0, -0.076, 0.119];
    let found: number[] | null = null;
    for (let x = -0.4; x <= 0.4 && !found; x += 0.02)
      for (let y = -0.4; y <= 0.4 && !found; y += 0.02)
        for (let z = 0.03; z <= 0.5 && !found; z += 0.02) {
          const p = [x, y, z];
          const d = Math.hypot(x - sh[0], y - sh[1], z - sh[2]);
          const r = Math.hypot(x - parity.reach.baseAxisXY[0], y - parity.reach.baseAxisXY[1]);
          const clear = [-1, 1].every((s) =>
            [0, 1, 2].every((a) => {
              const q = [...p];
              q[a] += s * 0.02;
              return !ws.has(q);
            }),
          );
          if (d < parity.reach.maxReach - 0.05 && r > 0.1 && !ws.has(p) && clear) found = p;
        }
    expect(found).not.toBeNull();
    t.set(found!);
    expect(t.reachable).toBe(false);
  });

  it("flips reachable only after moving hysteresis past the boundary (no flicker)", async () => {
    const { parity, ws, home } = await setup();
    const t = new Target(parity.reach, ws, home);
    // Walk outward from the neutral tip until the grid says empty; that is the boundary.
    const dir = [home[0], home[1] - parity.reach.baseAxisXY[1], 0];
    const norm = Math.hypot(dir[0], dir[1]) || 1;
    const at = (s: number) => [
      home[0] + (dir[0] / norm) * s,
      home[1] + (dir[1] / norm) * s,
      home[2],
    ];
    let edge = 0;
    while (ws.has(at(edge))) edge += 0.001;
    const h = parity.reach.hysteresis;
    // Oscillate within ±(h/2) around the boundary: the flag must not change.
    t.set(at(edge - 0.05));
    expect(t.reachable).toBe(true);
    for (let k = 0; k < 20; k++) {
      t.set(at(edge + (k % 2 ? 0.4 : -0.4) * h));
      expect(t.reachable).toBe(true);
    }
    t.set(at(edge + 3 * h));
    expect(t.reachable).toBe(false);
    for (let k = 0; k < 20; k++) {
      t.set(at(edge + (k % 2 ? 0.4 : -0.4) * h));
      expect(t.reachable).toBe(false);
    }
    t.set(at(edge - 3 * h));
    expect(t.reachable).toBe(true);
  });
});
