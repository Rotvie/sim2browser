/** SHA-256 helpers matching training/reach/spec.py (browser, worker and Node 22+). */

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** SHA-256 over sorted `path\0bytes\0` records, as in contracts/parity-json.md. */
export async function sha256Model(files: ReadonlyMap<string, Uint8Array>): Promise<string> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const path of [...files.keys()].sort()) {
    parts.push(enc.encode(path), new Uint8Array([0]), files.get(path)!, new Uint8Array([0]));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return sha256Hex(all);
}
