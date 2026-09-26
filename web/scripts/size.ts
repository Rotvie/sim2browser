/**
 * Load budget check (SC-001, research R10): compressed bytes the page fetches before the arm is
 * interactive must stay at or under 4 MB. Checked for brotli and for gzip (GitHub Pages serves
 * gzip only). The policy (loaded lazily in P3) is excluded.
 *
 *   npm run build && npm run size
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const BUDGET = 4 * 1024 * 1024;
const DIST = new URL("../dist/", import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const parity = JSON.parse(readFileSync(join(DIST, "shared/parity.json"), "utf8"));
const fetchedShared = new Set<string>([
  "shared/parity.json",
  `shared/${parity.reach.workspace.path}`,
  ...parity.model.files.map((f: string) => `shared/${f}`),
]);

const rows = walk(DIST)
  .map((p) => relative(DIST, p))
  .filter((rel) => (rel.startsWith("shared/") ? fetchedShared.has(rel) : !rel.endsWith(".map")))
  .map((rel) => {
    const raw = readFileSync(join(DIST, rel));
    const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
    const gz = gzipSync(raw, { level: 9 }).length;
    return { rel, raw: raw.length, br, gz };
  })
  .sort((a, b) => b.br - a.br);

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`.padStart(11);
console.log(`${"brotli".padStart(11)}  ${"gzip".padStart(11)}  ${"raw".padStart(11)}  file`);
for (const r of rows) console.log(`${kb(r.br)}  ${kb(r.gz)}  ${kb(r.raw)}  ${r.rel}`);
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const br = rows.reduce((n, r) => n + r.br, 0);
const gz = rows.reduce((n, r) => n + r.gz, 0);
console.log(`\ntotal before interactive: brotli ${mb(br)}, gzip ${mb(gz)} (budget 4.00 MB)`);
if (Math.max(br, gz) > BUDGET) {
  console.error("over the 4 MB load budget");
  process.exit(1);
}
