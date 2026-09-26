/** three.js scene in MuJoCo's frame (z up, meters). */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
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
  camera.position.set(0.42, -0.62, 0.36);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.2, 0.14);
  controls.enableDamping = true;
  controls.minDistance = 0.25;
  controls.maxDistance = 2.5;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the ground
  controls.update();

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    }
  };

  return {
    renderer,
    scene,
    camera,
    controls,
    render() {
      resize();
      controls.update();
      renderer.render(scene, camera);
    },
  };
}
