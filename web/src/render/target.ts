/**
 * The draggable target (FR-007, FR-009, contracts/ui.md). Dragging moves it in the plane through
 * the target facing the camera; the wheel over it, shift-drag, or a second finger moves it toward
 * or away from the camera. It takes priority over joint picking and orbit when grabbed.
 *
 * The displayed position always comes from the worker's snapshot (clamped there), so what the
 * visitor sees is what the controller aims at.
 */
import * as THREE from "three";
import type { Snapshot } from "../protocol";

const COLOR_OK = new THREE.Color(0x2563eb);
const COLOR_OUT = new THREE.Color(0xea580c);
const RADIUS = 0.012;
const HIT_RADIUS = 0.04; // generous grab area for fingers
/** UI bounds for dragging (the worker applies the parity.json clamps on top). */
const MAX_XY = 0.6;
const MAX_Z = 0.8;
const DEPTH_PER_PX = 0.002; // m per pixel for shift-drag / two-finger depth
const DEPTH_PER_WHEEL = 0.0004; // m per wheel delta unit

export interface TargetViewOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  overlay: HTMLElement;
  latest: () => Snapshot | null;
  send: (pos: [number, number, number]) => void;
  onInteract: () => void;
}

export interface TargetView {
  /** Per frame: sync with the latest snapshot and place the label. */
  update(): void;
  screenPoint(): [number, number] | null;
  /** Shown and draggable only when the task uses it (004: Reach, or grasping by hand). */
  setEnabled(on: boolean): void;
}

export function createTargetView(o: TargetViewOptions): TargetView {
  let enabled = true;
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: COLOR_OK,
    emissive: COLOR_OK,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 32, 16), material);
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(HIT_RADIUS, 12, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RADIUS * 2.1, RADIUS * 0.18, 8, 48),
    new THREE.MeshBasicMaterial({ color: COLOR_OUT }),
  );
  ring.visible = false;
  group.add(ball, hit, ring);
  o.scene.add(group);

  // Depth cues: a stem down to the ground and a shadow dot.
  const stemGeom = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(6), 3),
  );
  const stem = new THREE.Line(
    stemGeom,
    new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.01, gapSize: 0.008 }),
  );
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(RADIUS * 0.9, 24),
    new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.35 }),
  );
  dot.position.z = 0.001;
  o.scene.add(stem, dot);

  const label = document.createElement("div");
  label.className = "target-label";
  label.textContent = "Out of reach";
  label.hidden = true;
  o.overlay.appendChild(label);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const tmp = new THREE.Vector3();

  let drag: {
    id: number;
    pos: THREE.Vector3;
    offset: THREE.Vector3;
    lastY: number;
    depthPointer: number | null;
  } | null = null;
  let pending: THREE.Vector3 | null = null;
  let raf = 0;

  const rayAt = (clientX: number, clientY: number) => {
    const rect = o.canvas.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, o.camera);
    return raycaster.ray;
  };
  const clampUi = (p: THREE.Vector3) => {
    const r = Math.hypot(p.x, p.y);
    if (r > MAX_XY) {
      p.x *= MAX_XY / r;
      p.y *= MAX_XY / r;
    }
    p.z = Math.min(MAX_Z, Math.max(0, p.z));
    return p;
  };
  const queue = (p: THREE.Vector3) => {
    pending = clampUi(p.clone());
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pending) o.send([pending.x, pending.y, pending.z]);
        pending = null;
      });
  };
  const hitsTarget = (clientX: number, clientY: number) =>
    group.visible &&
    rayAt(clientX, clientY).intersectsSphere(new THREE.Sphere(group.position, HIT_RADIUS));
  const viewDir = () => tmp.subVectors(group.position, o.camera.position).normalize().clone();

  const moveDepth = (dist: number) => {
    if (!drag) return;
    drag.pos.addScaledVector(viewDir(), dist);
    queue(drag.pos);
  };

  const onDown = (e: PointerEvent) => {
    if (drag) {
      // A second finger while dragging switches to depth control.
      if (e.pointerType === "touch" && drag.depthPointer === null) {
        drag.depthPointer = e.pointerId;
        drag.lastY = e.clientY;
        e.stopImmediatePropagation();
      }
      return;
    }
    if (!e.isPrimary || !hitsTarget(e.clientX, e.clientY)) return;
    o.onInteract();
    e.stopImmediatePropagation();
    e.preventDefault();
    o.canvas.setPointerCapture(e.pointerId);
    const pos = group.position.clone();
    plane.setFromNormalAndCoplanarPoint(o.camera.getWorldDirection(tmp).clone(), pos);
    const onPlane =
      rayAt(e.clientX, e.clientY).intersectPlane(plane, new THREE.Vector3()) ?? pos.clone();
    drag = {
      id: e.pointerId,
      pos,
      offset: pos.clone().sub(onPlane),
      lastY: e.clientY,
      depthPointer: null,
    };
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    if (e.pointerId === drag.depthPointer) {
      e.stopImmediatePropagation();
      moveDepth((drag.lastY - e.clientY) * DEPTH_PER_PX);
      drag.lastY = e.clientY;
      return;
    }
    if (e.pointerId !== drag.id) return;
    e.stopImmediatePropagation();
    if (e.shiftKey) {
      moveDepth((drag.lastY - e.clientY) * DEPTH_PER_PX);
      drag.lastY = e.clientY;
      return;
    }
    drag.lastY = e.clientY;
    if (drag.depthPointer !== null) return; // two fingers: depth only
    plane.setFromNormalAndCoplanarPoint(o.camera.getWorldDirection(tmp).clone(), drag.pos);
    const p = rayAt(e.clientX, e.clientY).intersectPlane(plane, new THREE.Vector3());
    if (!p) return;
    drag.pos.copy(p.add(drag.offset));
    queue(drag.pos);
  };

  const onUp = (e: PointerEvent) => {
    if (!drag) return;
    if (e.pointerId === drag.depthPointer) {
      drag.depthPointer = null;
      e.stopImmediatePropagation();
      return;
    }
    if (e.pointerId !== drag.id) return;
    e.stopImmediatePropagation();
    drag = null;
  };

  const onWheel = (e: WheelEvent) => {
    if (!hitsTarget(e.clientX, e.clientY)) return;
    o.onInteract();
    e.preventDefault();
    e.stopImmediatePropagation(); // keep OrbitControls from zooming
    const pos = group.position.clone().addScaledVector(viewDir(), -e.deltaY * DEPTH_PER_WHEEL);
    queue(pos);
  };

  o.canvas.addEventListener("pointerdown", onDown, { capture: true });
  o.canvas.addEventListener("pointermove", onMove, { capture: true });
  o.canvas.addEventListener("pointerup", onUp, { capture: true });
  o.canvas.addEventListener("pointercancel", onUp, { capture: true });
  o.canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });

  const toScreen = (p: THREE.Vector3): [number, number] => {
    const v = p.clone().project(o.camera);
    return [((v.x + 1) / 2) * o.canvas.clientWidth, ((1 - v.y) / 2) * o.canvas.clientHeight];
  };

  return {
    setEnabled(on) {
      enabled = on;
    },
    update() {
      const s = enabled ? o.latest() : null;
      group.visible = !!s;
      stem.visible = dot.visible = !!s;
      if (!s) {
        label.hidden = true;
        return;
      }
      group.position.set(s.target[0], s.target[1], s.target[2]);
      ring.visible = !s.reachable;
      ring.quaternion.copy(o.camera.quaternion); // face the camera
      const c = s.reachable ? COLOR_OK : COLOR_OUT;
      material.color.copy(c);
      material.emissive.copy(c);
      const attr = stemGeom.getAttribute("position") as THREE.BufferAttribute;
      attr.setXYZ(0, s.target[0], s.target[1], s.target[2] - RADIUS);
      attr.setXYZ(1, s.target[0], s.target[1], 0);
      attr.needsUpdate = true;
      stem.computeLineDistances();
      dot.position.set(s.target[0], s.target[1], 0.001);
      label.hidden = s.reachable;
      if (!s.reachable) {
        const [x, y] = toScreen(group.position);
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
      }
    },
    screenPoint() {
      const s = o.latest();
      return s ? toScreen(new THREE.Vector3(s.target[0], s.target[1], s.target[2])) : null;
    },
  };
}
