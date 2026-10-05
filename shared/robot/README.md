# so100 robot model

Derived from MuJoCo Menagerie `trs_so_arm100/so_arm100.xml`
(https://github.com/google-deepmind/mujoco_menagerie, commit
`c96a32d28fb5da84da38c1da4d749e7a13212855`), licensed Apache-2.0 (see `LICENSE`).

This file is parity-critical: training (Python `mujoco`) and the browser (`@mujoco/mujoco`) load
exactly these bytes. Its hash, together with every file in `assets/`, is recorded in
`shared/parity.json`.

## Modifications

Restored from Menagerie in 002-grasp (001 had removed them; reach had no contacts):

- `Jaw` joint (`range="-0.174 1.75"`) and its position actuator.
- Collision geoms (class `collision`, group 3, never rendered), plus the eight `finger_collision`
  pads. The collision meshes are convex hulls inlined in the XML by
  `training/scripts/make_hulls.py`: the links use MuJoCo's hull of their decimated visual mesh,
  capped at 32 vertices (they only meet the floor and the cube); the jaws use the full hulls of
  Menagerie's five jaw collision meshes. No collision mesh files ship (load time, see
  `specs/002-grasp/validation.md`).
- `<contact><exclude body1="Base" body2="Rotation_Pitch"/>`.
- `<option cone="elliptic" impratio="10"/>` (Menagerie's grasping settings).

Changed or added in this repo:

- `<option timestep="0.002"/>`.
- Collision geoms use `contype="2" conaffinity="1"`: the arm collides with the floor and the
  cube but not with itself (as in 001). Mesh-vs-mesh self-contacts broke Python/WASM parity in
  degenerate flat-face cases (`specs/002-grasp/validation.md`).
- A `floor` plane at z = 0 (group 3: the page draws its own ground).
- A `cube` body with a free joint: 30 mm box, 30 g, pad friction, orange. Its default pose is
  `parity.json` `cube.defaultPose`.
- Every moving body keeps its explicit `<inertial>` from Menagerie, so mass and inertia never
  depend on mesh geometry.
- Added site `shoulder` at the Pitch joint origin (Upper_Arm body) and site `tip` between the jaw
  tips (Fixed_Jaw body, `pos="0 -0.1 0"`).
- Keyframe `home`: 5 arm joints, jaw closed (−0.174), cube at its default pose; keyframe `rest`
  removed.
- Visual meshes decimated to 40% of their faces (60,682 → 24,262) for download size, with
  `training/scripts/decimate_meshes.py` run on the original Menagerie STL files. Rerun
  `make_hulls.py` after decimating.

Arm joints, in order: `Rotation`, `Pitch`, `Elbow`, `Wrist_Pitch`, `Wrist_Roll`; the gripper joint
`Jaw` is described by `parity.json` `gripper`.
