"""Decimate the visual meshes for download size (research R10 mitigation, tasks T040).

Reads the original Menagerie STL files (never already-decimated ones, so runs are reproducible)
and writes decimated binary STL into shared/robot/assets/. Mass and inertia are unaffected:
every moving body has an explicit <inertial>. Link collision uses hulls of these decimated meshes
(scripts/make_hulls.py), so rerun that script after decimating.

    uv run --group tools python scripts/decimate_meshes.py --src <menagerie>/trs_so_arm100/assets
"""

from __future__ import annotations

import argparse
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh

DEST = Path(__file__).resolve().parents[2] / "shared" / "robot" / "assets"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True, help="original Menagerie assets directory")
    ap.add_argument("--keep", type=float, default=0.4, help="fraction of faces to keep")
    args = ap.parse_args()

    total_in = total_out = 0
    for dest in sorted(DEST.glob("*.stl")):
        # Collision meshes (Menagerie's jaw meshes, our precomputed hulls) are not decimated.
        if "_Collision_" in dest.stem or dest.stem.endswith("_Hull"):
            continue
        mesh = trimesh.load_mesh(args.src / dest.name, process=True)
        verts, faces = fast_simplification.simplify(
            mesh.vertices.astype(np.float32), mesh.faces, target_reduction=1 - args.keep
        )
        out = trimesh.Trimesh(verts, faces, process=True)
        out.export(dest, file_type="stl")
        total_in += len(mesh.faces)
        total_out += len(out.faces)
        print(f"{dest.name:28} {len(mesh.faces):6} -> {len(out.faces):6} faces")
    print(f"total {total_in} -> {total_out} faces ({total_out / total_in:.0%})")


if __name__ == "__main__":
    main()
