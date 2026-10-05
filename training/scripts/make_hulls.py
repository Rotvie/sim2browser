"""Collision hulls for so100.xml, inlined as vertex lists (002-grasp).

MuJoCo collides a mesh through its convex hull. Shipping the collision meshes as files cost the
page ten extra requests and, for the link meshes, ~20 ms of hull computation per load. Instead,
this script computes each hull once (with MuJoCo itself, `mesh_graph`) and writes its vertices
and faces into `<mesh name="..._Hull" vertex="..." face="..."/>` in so100.xml; MuJoCo's hull
of those points is the same shape. Sources: the five decimated link meshes in
shared/robot/assets/ and Menagerie's five jaw collision meshes (`--src`, the original
trs_so_arm100/assets directory).

    uv run --group tools python scripts/make_hulls.py --src <menagerie>/trs_so_arm100/assets
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import mujoco
import numpy as np

ROBOT = Path(__file__).resolve().parents[2] / "shared" / "robot"
ASSETS = ROBOT / "assets"
LINKS = ["Base", "Rotation_Pitch", "Upper_Arm", "Lower_Arm", "Wrist_Pitch_Roll"]
# Link hulls only meet the floor and the cube: MuJoCo's maxhullvert keeps them small (fewer
# numbers to parse, less collision setup per load). Jaw hulls, which do the grasping, stay full.
LINK_MAX_HULL_VERT = 32
JAWS = [
    "Fixed_Jaw_Collision_1",
    "Fixed_Jaw_Collision_2",
    "Moving_Jaw_Collision_1",
    "Moving_Jaw_Collision_2",
    "Moving_Jaw_Collision_3",
]


def _compile(**mesh) -> mujoco.MjModel:
    spec = mujoco.MjSpec()
    spec.add_mesh(name="m", **mesh)
    spec.worldbody.add_geom(type=mujoco.mjtGeom.mjGEOM_MESH, meshname="m")
    return spec.compile()


def hull(m: mujoco.MjModel) -> tuple[np.ndarray, np.ndarray]:
    """MuJoCo's hull of mesh 0: vertices (source frame) and triangles (indices into them)."""
    va, vn = m.mesh_vertadr[0], m.mesh_vertnum[0]
    g = m.mesh_graph[m.mesh_graphadr[0] :]
    nv, nf = int(g[0]), int(g[1])
    ids = g[2 + nv : 2 + 2 * nv]
    faces = g[2 + 3 * nv + 3 * nf : 2 + 3 * nv + 6 * nf].reshape(nf, 3)
    local = {int(gid): i for i, gid in enumerate(ids)}
    faces = np.vectorize(local.__getitem__)(faces)
    vert = m.mesh_vert[va : va + vn][ids]
    # MuJoCo moved the mesh to its own frame (centroid, principal axes): move it back.
    rot = np.zeros(9)
    mujoco.mju_quat2Mat(rot, m.mesh_quat[0])
    return vert @ rot.reshape(3, 3).T + m.mesh_pos[0], faces


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True, help="original Menagerie assets directory")
    args = ap.parse_args()
    xml_path = ROBOT / "so100.xml"
    xml = xml_path.read_text()
    sources = [(name, ASSETS / f"{name}.stl") for name in LINKS]
    sources += [(name, args.src / f"{name}.stl") for name in JAWS]
    for name, path in sources:
        extra = {"maxhullvert": LINK_MAX_HULL_VERT} if name in LINKS else {}
        v, f = hull(_compile(file=str(path), **extra))
        text = " ".join(f"{x:.8g}" for x in v.ravel())
        ftext = " ".join(str(i) for i in f.ravel())
        # Same hull back from the written mesh (to float32 precision).
        again, _ = hull(
            _compile(uservert=[float(x) for x in text.split()], userface=f.ravel().tolist())
        )
        assert len(again) == len(v), name
        assert max(np.linalg.norm(again - p, axis=1).min() for p in v) < 1e-6, name
        name_ = f"{name}_Hull" if name in LINKS else name
        pattern = rf'<mesh name="{name_}"[^>]*/>'
        if not re.search(pattern, xml):
            raise SystemExit(f'so100.xml has no <mesh name="{name_}" .../>')
        xml = re.sub(pattern, f'<mesh name="{name_}" vertex="{text}" face="{ftext}"/>', xml)
        print(f"{name_:24} {len(v):4} hull vertices, {len(f):4} faces")
    xml_path.write_text(xml)


if __name__ == "__main__":
    main()
