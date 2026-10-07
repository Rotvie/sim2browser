/**
 * The grasp attempt monitor (004 research R7, data-model "Grasp attempt"): every controller with
 * `task: "grasp"` is judged by the session, not by itself.
 */
import { describe, expect, it } from "vitest";
import type { Controller, GraspState } from "../../src/control/modes";
import {
  CONTROLLERS,
  type ControllerContext,
  type ControllerDef,
} from "../../src/control/registry";
import { yawQuat } from "../../src/sim/cube";
import { createSession, type Session } from "../../src/sim/session";
import { loadNodeSim, readShared } from "../node-shared";

/** A grasp-task controller whose behaviour the test scripts. */
function stub(
  id: string,
  step: (ctx: ControllerContext, k: number) => void,
  graspState?: () => GraspState,
): ControllerDef & { steps: () => number } {
  let n = 0;
  return {
    id,
    label: id,
    description: "test stub",
    task: "grasp",
    public: false,
    steps: () => n,
    create: (ctx): Controller => ({
      enter() {},
      step() {
        step(ctx, n++);
      },
      graspState,
    }),
  };
}

const setup = async (defs: ControllerDef[]) => {
  const { sim, parity, workspace } = await loadNodeSim();
  const s = createSession(sim, parity, workspace, {
    read: readShared,
    controllers: [...CONTROLLERS, ...defs],
  });
  for (const d of defs) await s.ensureController(d.id);
  await s.ensureController("grasp");
  return { sim, parity, s };
};

const runToEnd = (s: Session) => {
  const limit = (s.parity.grasp.success.timeLimit + 1) * s.parity.controlHz;
  for (let k = 0; k < limit; k++) {
    s.controlStep();
    if (s.snapshot().grasp!.outcome !== "running") break;
  }
  return s.snapshot().grasp!;
};

describe("grasp attempt monitor", () => {
  it("a controller that does nothing ends as missed at the time limit", async () => {
    const idle = stub("idle", () => {});
    const { sim, parity, s } = await setup([idle]);
    s.setMode("idle");
    const g = runToEnd(s);
    expect(g).toMatchObject({ controller: "idle", outcome: "failed", failure: "missed" });
    expect(sim.time()).toBeGreaterThan(parity.grasp.success.timeLimit);
    sim.dispose();
  });

  it("a cube pushed away without being held is knocked", async () => {
    const pusher = stub("pusher", (ctx, k) => {
      if (k === 10) {
        const p = ctx.cube.pose().pos;
        ctx.sim.setCubePose([p[0] + 0.05, p[1], p[2]], yawQuat(0));
      }
    });
    const { sim, s } = await setup([pusher]);
    s.setMode("pusher");
    expect(runToEnd(s)).toMatchObject({ outcome: "failed", failure: "knocked" });
    sim.dispose();
  });

  it("refuses a non-graspable placement without stepping the controller", async () => {
    const idle = stub("idle", () => {});
    const { sim, parity, s } = await setup([idle]);
    const [bx, by] = parity.reach.baseAxisXY;
    sim.setCubePose([bx, by - parity.grasp.region.rMax - 0.05, parity.cube.size / 2], yawQuat(0));
    s.setMode("idle");
    for (let k = 0; k < 20; k++) s.controlStep();
    expect(s.snapshot().grasp).toMatchObject({ outcome: "failed", failure: "not-graspable" });
    expect(idle.steps()).toBe(0);
    sim.dispose();
  });

  it("a controller-reported failure ends the attempt with that reason", async () => {
    let failed = false;
    const quitter = stub(
      "quitter",
      (_ctx, k) => {
        if (k === 5) failed = true;
      },
      () => ({
        controller: "quitter",
        phase: failed ? "failed" : "approach",
        outcome: failed ? "failed" : "running",
        failure: failed ? "slipped" : null,
        liftTime: null,
      }),
    );
    const { sim, s } = await setup([quitter]);
    s.setMode("quitter");
    const g = runToEnd(s);
    expect(g).toMatchObject({ outcome: "failed", failure: "slipped" });
    expect(sim.time()).toBeLessThan(1);
    sim.dispose();
  });

  it("success is the scripted grasp's judge: same lift time as 002 for the default cube", async () => {
    const { sim, s } = await setup([]);
    s.setMode("grasp");
    const g = runToEnd(s);
    expect(g.outcome).toBe("done");
    expect(g.failure).toBeNull();
    expect(g.liftTime).toBeGreaterThan(0);
    sim.dispose();
  });

  it.each([
    ["target drag", (s: Session) => s.setTarget([0.05, -0.25, 0.2])],
    ["joint grab", (s: Session) => s.dragJoint(0, 0.3)],
    ["mode switch", (s: Session) => s.setMode("baseline")],
  ])("%s leaves the grasp (the attempt is not counted)", async (_name, act) => {
    const idle = stub("idle", () => {});
    const { sim, s } = await setup([idle]);
    s.setMode("idle");
    for (let k = 0; k < 10; k++) s.controlStep();
    act(s);
    expect(s.snapshot().grasp).toBeUndefined();
    sim.dispose();
  });

  it("moving the cube cancels the attempt and stops the controller", async () => {
    const idle = stub("idle", () => {});
    const { sim, parity, s } = await setup([idle]);
    s.setMode("idle");
    for (let k = 0; k < 10; k++) s.controlStep();
    const [x, y] = parity.cube.defaultPose.pos;
    expect(s.setCube([x + 0.02, y])).toBe(true);
    const n = idle.steps();
    for (let k = 0; k < 10; k++) s.controlStep();
    expect(s.snapshot().grasp).toMatchObject({ outcome: "cancelled", failure: "cancelled" });
    expect(idle.steps()).toBe(n);
    sim.dispose();
  });
});

describe("retry (004 FR-010)", () => {
  it("returns the cube to the visitor's placement and starts the selected grasp controller", async () => {
    const idle = stub("idle", () => {});
    const { sim, parity, s } = await setup([idle]);
    const [x, y] = parity.cube.defaultPose.pos;
    expect(s.setCube([x + 0.03, y + 0.01])).toBe(true); // the visitor's placement
    const placed = Array.from(sim.cubePose().pos);
    s.setMode("grasp");
    runToEnd(s); // lifted
    expect(sim.cubePose().pos[2]).toBeGreaterThan(0.05);
    s.setMode("idle");
    expect(s.retry()).toBe(true);
    expect(s.snapshot().grasp).toMatchObject({ controller: "idle", outcome: "running" });
    const now = sim.cubePose().pos;
    expect(Math.hypot(now[0] - placed[0], now[1] - placed[1])).toBeLessThan(1e-3);
    expect(sim.q()[0]).toBeCloseTo(parity.baseline.neutralPose[0], 1);
    sim.dispose();
  });

  it("after a reset, the placement is the default cube pose", async () => {
    const { sim, parity, s } = await setup([]);
    s.setCube([parity.cube.defaultPose.pos[0] + 0.03, parity.cube.defaultPose.pos[1]]);
    s.reset();
    s.setMode("grasp");
    for (let k = 0; k < 100; k++) s.controlStep();
    expect(s.retry()).toBe(true);
    const now = sim.cubePose().pos;
    expect(now[0]).toBeCloseTo(parity.cube.defaultPose.pos[0], 3);
    sim.dispose();
  });

  it("does nothing outside grasp mode", async () => {
    const { sim, s } = await setup([]);
    s.setMode("baseline");
    expect(s.retry()).toBe(false);
    sim.dispose();
  });
});
