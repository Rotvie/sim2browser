/** Main thread <-> sim worker messages (contracts/worker-protocol.md). */
import type { ControlMode, ModeChangeReason } from "./control/modes";
import type { GraspRegion, GripperCommand, Parity, ParityErrorCode } from "./sim/parity";

export type ToWorker =
  /** `record`: the page was opened with ?record (004 recording mode). */
  | { type: "init"; baseUrl: string; record?: boolean }
  | { type: "dragJoint"; joint: number; angle: number }
  | { type: "setTarget"; pos: [number, number, number] }
  | { type: "setMode"; mode: ControlMode }
  | { type: "setGripper"; command: GripperCommand }
  /** Place the cube on the floor at (x, y); ignored while it is held. */
  | { type: "setCube"; pos: [number, number] }
  /** In grasp mode: start a new attempt from the current state. */
  | { type: "regrasp" }
  /** In grasp mode: same cube placement as the last attempt, arm reset (004 FR-010). */
  | { type: "retry" }
  | { type: "reset" }
  | { type: "visibility"; hidden: boolean }
  /** Recording mode only (004 contracts/ui.md). */
  | { type: "record"; action: "start" | "stop" | "keep" | "discard" | "save" };

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
  /** Jaw joint position (rad) and the gripper command. */
  jaw: number;
  gripper: GripperCommand;
  cube: { pos: Float64Array; quat: Float64Array; held: boolean; graspable: boolean };
  mode: ControlMode;
  /** The scripted grasp's progress, while it is in charge. */
  grasp?: import("./control/modes").GraspState;
  /** From a controller that can be inspected (the learned policy), once it is loaded. */
  policyStep?: import("./control/learned").PolicyStep;
  /** True when policyStep comes from the controller in charge (not a what-if). */
  policyStepActive: boolean;
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
  /** Automatic controllers this build offers (Manual is always available). */
  controllers: {
    id: string;
    label: string;
    short: string;
    description: string;
    public: boolean;
    task: import("./control/registry").ControllerTask;
    kind: "engineered" | "learned";
  }[];
  /** Baseline design parameters, shown in the info panel (parity.json `baseline`). */
  baseline: import("./sim/parity").Parity["baseline"];
  /** Joints the policy observes and commands (parity.json `action.joints`). */
  policyJoints: string[];
  /** Observation fields (labels for the panel). */
  observation: import("./sim/parity").Parity["observation"]["fields"];
  gripper: Parity["gripper"];
  /** Grasp policy input fields (labels for the policy view), if one is shipped (004). */
  graspObservation: Parity["observation"]["fields"] | null;
  cube: { size: number; body: string };
  graspRegion: GraspRegion;
}

export type ErrorCode = ParityErrorCode | "asset-load" | "internal";

export type FromWorker =
  | ({ type: "ready" } & ReadyInfo)
  | ({ type: "snapshot" } & Snapshot)
  | { type: "modeChanged"; mode: ControlMode; reason: ModeChangeReason }
  | { type: "error"; code: ErrorCode; message: string }
  /** A controller could not be created (e.g. policy failed verification); the page keeps running. */
  | { type: "controllerError"; id: string; message: string }
  | ({ type: "record-status" } & import("./sim/recordingMode").RecordStatus)
  /** The saved demonstration file, gzipped. */
  | { type: "record-file"; bytes: ArrayBuffer };
