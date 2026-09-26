/**
 * Pose joints by dragging arm links (FR-004). Drags on the arm rotate the joint that moves the
 * grabbed link; drags elsewhere fall through to camera orbit.
 *
 * Mapping: the grabbed point rotates about the joint axis. We project a tiny rotation of that
 * point to the screen to get "pixels per radian" in screen space, and convert pointer motion
 * along that direction into an angle change. This works for any camera angle, including joint
 * axes lying in the view plane, where intersecting the rotation plane would be unstable.
 */
import * as THREE from "three";
import type { Snapshot } from "../protocol";

export type Vec3 = [number, number, number];
export type Project = (p: Vec3) => [number, number];

const EPS = 1e-3; // rad, for the finite-difference screen derivative

export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  // Rodrigues' formula; axis is unit length.
  const [x, y, z] = v;
  const [ax, ay, az] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = ax * x + ay * y + az * z;
  return [
    x * c + (ay * z - az * y) * s + ax * dot * (1 - c),
    y * c + (az * x - ax * z) * s + ay * dot * (1 - c),
    z * c + (ax * y - ay * x) * s + az * dot * (1 - c),
  ];
}

/**
 * Angle change (rad) for a pointer move of `mouseDelta` pixels while holding the point
 * `anchor + lever`, rotating about `axis` through `anchor`. Returns 0 when the rotation is
 * (nearly) invisible on screen, e.g. the lever points at the camera.
 */
export function angleDeltaFromDrag(
  project: Project,
  anchor: Vec3,
  axis: Vec3,
  lever: Vec3,
  mouseDelta: [number, number],
): number {
  const p0 = project([anchor[0] + lever[0], anchor[1] + lever[1], anchor[2] + lever[2]]);
  const r = rotateAbout(lever, axis, EPS);
  const p1 = project([anchor[0] + r[0], anchor[1] + r[1], anchor[2] + r[2]]);
  const dx = (p1[0] - p0[0]) / EPS;
  const dy = (p1[1] - p0[1]) / EPS;
  const d2 = dx * dx + dy * dy;
  if (d2 < 400) return 0; // < 20 px per radian: too edge-on to control reliably
  return (mouseDelta[0] * dx + mouseDelta[1] * dy) / d2;
}

export interface JointPickerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  meshes: THREE.Mesh[];
  bodyJoint: Int32Array;
  limits: Float64Array;
  latest: () => Snapshot | null;
  send: (joint: number, angle: number) => void;
  onInteract: () => void;
}

export function attachJointPicker(o: JointPickerOptions): { dispose(): void } {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag: {
    id: number;
    joint: number;
    anchor: Vec3;
    axis: Vec3;
    lever: Vec3;
    start: number;
    acc: number;
    last: [number, number];
  } | null = null;
  let pending: number | null = null;
  let raf = 0;

  const project: Project = (p) => {
    const v = new THREE.Vector3(...p).project(o.camera);
    const rect = o.canvas.getBoundingClientRect();
    return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height];
  };

  const flush = () => {
    raf = 0;
    if (drag && pending !== null) o.send(drag.joint, pending);
    pending = null;
  };

  const onDown = (e: PointerEvent) => {
    o.onInteract();
    if (drag || !e.isPrimary) return;
    const snap = o.latest();
    if (!snap) return;
    const rect = o.canvas.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, o.camera);
    const hit = raycaster.intersectObjects(o.meshes, false)[0];
    if (!hit) return; // empty space: orbit
    const joint = o.bodyJoint[hit.object.userData.body as number];
    if (joint < 0) return; // base: orbit
    e.stopImmediatePropagation(); // keep OrbitControls out of this gesture
    e.preventDefault();
    o.canvas.setPointerCapture(e.pointerId);
    const anchor: Vec3 = [
      snap.jointAnchor[3 * joint],
      snap.jointAnchor[3 * joint + 1],
      snap.jointAnchor[3 * joint + 2],
    ];
    const axis: Vec3 = [
      snap.jointAxis[3 * joint],
      snap.jointAxis[3 * joint + 1],
      snap.jointAxis[3 * joint + 2],
    ];
    drag = {
      id: e.pointerId,
      joint,
      anchor,
      axis,
      lever: [hit.point.x - anchor[0], hit.point.y - anchor[1], hit.point.z - anchor[2]],
      start: snap.ctrl[joint],
      acc: 0,
      last: [e.clientX, e.clientY],
    };
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopImmediatePropagation();
    const md: [number, number] = [e.clientX - drag.last[0], e.clientY - drag.last[1]];
    drag.last = [e.clientX, e.clientY];
    const d = angleDeltaFromDrag(project, drag.anchor, drag.axis, drag.lever, md);
    if (d === 0) return;
    const lo = o.limits[2 * drag.joint];
    const hi = o.limits[2 * drag.joint + 1];
    // Clamp the accumulated angle so dragging back from a limit responds immediately.
    const angle = Math.min(hi, Math.max(lo, drag.start + drag.acc + d));
    const applied = angle - (drag.start + drag.acc);
    drag.acc += applied;
    drag.lever = rotateAbout(drag.lever, drag.axis, applied);
    pending = angle;
    if (!raf) raf = requestAnimationFrame(flush);
  };

  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopImmediatePropagation();
    flush();
    drag = null;
  };

  o.canvas.addEventListener("pointerdown", onDown, { capture: true });
  o.canvas.addEventListener("pointermove", onMove, { capture: true });
  o.canvas.addEventListener("pointerup", onUp, { capture: true });
  o.canvas.addEventListener("pointercancel", onUp, { capture: true });
  return {
    dispose() {
      o.canvas.removeEventListener("pointerdown", onDown, { capture: true });
      o.canvas.removeEventListener("pointermove", onMove, { capture: true });
      o.canvas.removeEventListener("pointerup", onUp, { capture: true });
      o.canvas.removeEventListener("pointercancel", onUp, { capture: true });
    },
  };
}
