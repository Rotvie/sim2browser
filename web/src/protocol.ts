/** Main thread <-> sim worker messages (contracts/worker-protocol.md). */
import type { ControlMode, ModeChangeReason } from "./control/modes";
import type { ParityErrorCode } from "./sim/parity";

export type ToWorker =
  | { type: "init"; baseUrl: string }
  | { type: "dragJoint"; joint: number; angle: number }
  | { type: "setTarget"; pos: [number, number, number] }
  | { type: "setMode"; mode: ControlMode }
  | { type: "reset" }
  | { type: "visibility"; hidden: boolean };

export interface Snapshot {
  /** Simulation time (s). */
  t: number;
  bodyPos: Float64Array;
  bodyQuat: Float64Array;
  q: Float64Array;
  qd: Float64Array;
  ctrl: Float64Array;
  tip: Float64Array;
  /** World anchor and axis of each controlled joint (n*3 each). */
  jointAnchor: Float64Array;
  jointAxis: Float64Array;
  target: Float64Array;
  reachable: boolean;
  mode: ControlMode;
}

export interface ReadyInfo {
  joints: string[];
  limits: Float64Array;
  /** Joint index (parity.joints order) that moves each body, or -1. */
  bodyJoint: Int32Array;
  bodyNames: string[];
  bodyParent: Int32Array;
  geoms: import("./sim/mujoco").GeomInfo[];
  neutralPose: number[];
  maxReach: number;
  modes: ControlMode[];
  /** Baseline design parameters, shown in the info panel (parity.json `baseline`). */
  baseline: import("./sim/parity").Parity["baseline"];
}

export type ErrorCode = ParityErrorCode | "asset-load" | "internal";

export type FromWorker =
  | ({ type: "ready" } & ReadyInfo)
  | ({ type: "snapshot" } & Snapshot)
  | { type: "modeChanged"; mode: ControlMode; reason: ModeChangeReason }
  | { type: "error"; code: ErrorCode; message: string };
