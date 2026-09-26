# so100_reach robot model

Derived from MuJoCo Menagerie `trs_so_arm100/so_arm100.xml`
(https://github.com/google-deepmind/mujoco_menagerie, commit
`c96a32d28fb5da84da38c1da4d749e7a13212855`), licensed Apache-2.0 (see `LICENSE`).

This file is parity-critical: training (Python `mujoco`) and the browser (`@mujoco/mujoco`) load
exactly these bytes. Its hash, together with every file in `assets/`, is recorded in
`shared/parity.json`.

## Modifications

- Jaw joint and actuator removed; the moving jaw is welded at joint position 0 (closed).
- All collision geoms, collision-only meshes, finger pads and the contact exclude removed. Only
  visual geoms remain, with `contype="0" conaffinity="0" density="0"`. The reach task has no
  contacts.
- Every moving body keeps its explicit `<inertial>` from Menagerie, so mass and inertia never
  depend on mesh geometry.
- `<option timestep="0.002"/>`; Menagerie's `cone` and `impratio` settings removed (no contacts).
- Added site `shoulder` at the Pitch joint origin (Upper_Arm body) and site `tip` between the jaw
  tips (Fixed_Jaw body, `pos="0 -0.1 0"`, centered between the jaw tips, 6 mm inside them).
- Keyframe `home` reduced to the 5 arm joints; keyframe `rest` removed.
- Visual meshes decimated to 40% of their faces (60,682 → 24,262) for download size, with
  `training/scripts/decimate_meshes.py` run on the original Menagerie STL files. Physics is
  unaffected (explicit inertials, visual-only geoms), verified bit-identical over a 2,000-step
  randomized trajectory.

Controlled joints, in order: `Rotation`, `Pitch`, `Elbow`, `Wrist_Pitch`, `Wrist_Roll`.
