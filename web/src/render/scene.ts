/** three.js scene in MuJoCo's frame (z up, meters). */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /**
   * Pixels at the bottom of the canvas covered by UI (e.g. a bottom sheet). The view is centred
   * in the uncovered part, so the arm stays visible above the sheet.
   */
  setBottomInset(px: number): void;
  render(): void;
}

export function createScene(canvas: HTMLCanvasElement): Scene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xeef1f4);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(0.6, -0.8, 1.5);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 96),
    new THREE.MeshBasicMaterial({ color: 0xe4e8ed }),
  );
  scene.add(ground);
  const grid = new THREE.GridHelper(1.0, 20, 0xc9ced6, 0xd6dbe1);
  grid.rotation.x = Math.PI / 2; // GridHelper lies in XZ; MuJoCo ground is XY.
  grid.position.z = 0.0005;
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 20);
  camera.up.set(0, 0, 1);
  /** The working area to keep in view: arm, base and the reachable space in front of it. */
  const focus = new THREE.Sphere(new THREE.Vector3(0, -0.2, 0.14), 0.32);
  const viewDir = new THREE.Vector3(0.42, -0.42, 0.22).normalize();

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(focus.center);
  controls.enableDamping = true;
  controls.minDistance = 0.25;
  controls.maxDistance = 2.5;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the ground

  // Frame the working area for the current aspect ratio (portrait phones need to back off
  // further), until the visitor takes over the camera.
  let userMovedCamera = false;
  controls.addEventListener("start", () => (userMovedCamera = true));
  const frame = () => {
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = focus.radius / Math.sin(Math.min(vfov, hfov) / 2);
    camera.position.copy(focus.center).addScaledVector(viewDir, dist);
    controls.target.copy(focus.center);
  };
  frame();
  controls.update();

  let size = { w: 0, h: 0, inset: 0 };
  let inset = 0;
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w === size.w && h === size.h && inset === size.inset) return;
    if (w !== size.w || h !== size.h) renderer.setSize(w, h, false);
    size = { w, h, inset };
    // Project for the visible area (h - inset) and draw it into the full canvas: the extra rows
    // at the bottom continue the same view underneath the covering UI.
    const visible = Math.max(1, h - inset);
    camera.aspect = w / visible;
    if (inset > 0) camera.setViewOffset(w, visible, 0, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (!userMovedCamera) frame();
  };

  return {
    renderer,
    scene,
    camera,
    controls,
    setBottomInset(px) {
      inset = Math.max(0, Math.round(px));
    },
    render() {
      resize();
      controls.update();
      renderer.render(scene, camera);
    },
  };
}
