/**
 * Drag the cube over the floor (002 FR-006, contracts/ui.md "Cube"). While dragging, a ring on
 * the floor shows the graspable region; it turns orange when the cube is outside it. The worker
 * clamps every placement and refuses it while the cube is held or where it would overlap the
 * arm, so the cube shown is always where the simulation put it.
 *
 * Priority: the target first (registered before), then the cube, then joint posing and orbit.
 */
import * as THREE from "three";
import type { Snapshot } from "../protocol";
import { inRegion, type GraspRegion } from "../sim/parity";

const COLOR_IN = 0x16a34a;
const COLOR_OUT = 0xea580c;

export interface CubeDragOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  /** The cube's rendered meshes (hit test). */
  meshes: THREE.Object3D[];
  region: GraspRegion;
  latest: () => Snapshot | null;
  send: (xy: [number, number]) => void;
  onInteract: () => void;
}

export function attachCubeDrag(o: CubeDragOptions): void {
  const { region } = o;
  const material = new THREE.MeshBasicMaterial({
    color: COLOR_IN,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // RingGeometry lies in the XY plane (MuJoCo's floor); angle t is measured from +x. The region's
  // angle is measured from -y (t = -pi/2) toward +x.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(
      region.rMin,
      region.rMax,
      64,
      1,
      -Math.PI / 2 - region.maxAngle,
      2 * region.maxAngle,
    ),
    material,
  );
  ring.position.set(region.center[0], region.center[1], 0.0008);
  ring.visible = false;
  o.scene.add(ring);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  let drag: { id: number; offset: [number, number] } | null = null;
  let pending: [number, number] | null = null;
  let raf = 0;

  const rayAt = (clientX: number, clientY: number) => {
    const rect = o.canvas.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, o.camera);
    return raycaster;
  };
  const onFloor = (clientX: number, clientY: number) =>
    rayAt(clientX, clientY).ray.intersectPlane(floor, new THREE.Vector3());
  const show = (xy: [number, number]) => {
    material.color.setHex(inRegion(xy, region) ? COLOR_IN : COLOR_OUT);
  };
  const queue = (xy: [number, number]) => {
    pending = xy;
    show(xy);
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pending) o.send(pending);
        pending = null;
      });
  };

  const onDown = (e: PointerEvent) => {
    if (drag || !e.isPrimary) return;
    const s = o.latest();
    if (!s || s.cube.held) return;
    if (!rayAt(e.clientX, e.clientY).intersectObjects(o.meshes, false).length) return;
    const p = onFloor(e.clientX, e.clientY);
    if (!p) return;
    o.onInteract();
    e.stopImmediatePropagation();
    e.preventDefault();
    o.canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, offset: [s.cube.pos[0] - p.x, s.cube.pos[1] - p.y] };
    o.canvas.style.cursor = "grabbing";
    ring.visible = true;
    show([s.cube.pos[0], s.cube.pos[1]]);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) {
      // Hover feedback: the cube can be grabbed.
      const s = o.latest();
      const over =
        e.pointerType === "mouse" &&
        !!s &&
        !s.cube.held &&
        rayAt(e.clientX, e.clientY).intersectObjects(o.meshes, false).length > 0;
      if (over) o.canvas.style.cursor = "grab";
      else if (o.canvas.style.cursor === "grab") o.canvas.style.cursor = "";
      return;
    }
    if (e.pointerId !== drag.id) return;
    e.stopImmediatePropagation();
    const p = onFloor(e.clientX, e.clientY);
    if (p) queue([p.x + drag.offset[0], p.y + drag.offset[1]]);
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopImmediatePropagation();
    drag = null;
    ring.visible = false;
    o.canvas.style.cursor = "";
  };

  o.canvas.addEventListener("pointerdown", onDown, { capture: true });
  o.canvas.addEventListener("pointermove", onMove, { capture: true });
  o.canvas.addEventListener("pointerup", onUp, { capture: true });
  o.canvas.addEventListener("pointercancel", onUp, { capture: true });
}
