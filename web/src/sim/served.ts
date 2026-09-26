/**
 * Where a shared/ file is served from. GitHub Pages compresses by MIME type and serves .stl as
 * application/vnd.ms-pki.stl, uncompressed (about 0.5 MB extra before interactive). As .stl.bin it
 * is application/octet-stream and gets gzipped. The bytes are identical, so hashes and parity are
 * unchanged; MuJoCo still sees the original .stl names. Used by the build, the dev server, the
 * worker and the size check.
 */
export function servedPath(path: string): string {
  return path.endsWith(".stl") ? `${path}.bin` : path;
}
