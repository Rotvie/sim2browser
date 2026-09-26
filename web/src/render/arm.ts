/**
 * Arm meshes built from the compiled MuJoCo model (one geometry source, no second loader),
 * posed from body poses each frame.
 */
import * as THREE from "three";
import type { GeomInfo } from "../sim/mujoco";
import type { Pose } from "./interp";

export interface ArmView {
  root: THREE.Group;
  /** Pickable meshes; `userData.body` is the MuJoCo body id. */
  meshes: THREE.Mesh[];
  setPose(pose: Pose): void;
}

// MuJoCo quaternions are (w, x, y, z); three.js takes (x, y, z, w).
const toQuat = (q: ArrayLike<number>, o = 0) =>
  new THREE.Quaternion(q[o + 1], q[o + 2], q[o + 3], q[o]);

export function createArmView(geoms: GeomInfo[], nbody: number): ArmView {
  const root = new THREE.Group();
  const bodies: THREE.Group[] = [];
  for (let b = 0; b < nbody; b++) {
    const g = new THREE.Group();
    g.matrixAutoUpdate = true;
    bodies.push(g);
    root.add(g);
  }

  const meshes: THREE.Mesh[] = [];
  for (const geom of geoms) {
    if (!geom.mesh) continue;
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute("position", new THREE.BufferAttribute(geom.mesh.vert, 3));
    indexed.setIndex(new THREE.BufferAttribute(Uint32Array.from(geom.mesh.face), 1));
    // CAD meshes have sharp edges: per-face normals avoid smoothing artifacts across them.
    const geometry = indexed.toNonIndexed();
    indexed.dispose();
    geometry.computeVertexNormals();
    const [r, g, b, a] = geom.rgba;
    const dark = r + g + b < 1;
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(r, g, b),
      opacity: a,
      transparent: a < 1,
      roughness: dark ? 0.55 : 0.75,
      metalness: dark ? 0.2 : 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(geom.pos[0], geom.pos[1], geom.pos[2]);
    mesh.quaternion.copy(toQuat(geom.quat));
    mesh.userData.body = geom.body;
    bodies[geom.body].add(mesh);
    meshes.push(mesh);
  }

  return {
    root,
    meshes,
    setPose(pose) {
      for (let b = 0; b < nbody; b++) {
        bodies[b].position.set(pose.pos[3 * b], pose.pos[3 * b + 1], pose.pos[3 * b + 2]);
        bodies[b].quaternion.copy(toQuat(pose.quat, 4 * b));
      }
    },
  };
}
