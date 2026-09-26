import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";

const BASE = "/sim2browser/";
const SHARED = resolve(import.meta.dirname, "../shared");
/** Runtime assets served to the page. Parity fixtures and tooling files stay out of the build. */
const SHIPPED = ["parity.json", "workspace.bin", "robot", "policy"];

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".xml": "application/xml",
  ".stl": "model/stl",
  ".bin": "application/octet-stream",
};
const COMPRESSIBLE = new Set(Object.keys(MIME));

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

function shippedFiles(): string[] {
  return SHIPPED.flatMap((entry) => {
    const p = join(SHARED, entry);
    try {
      return statSync(p).isDirectory() ? listFiles(p) : [p];
    } catch {
      return [];
    }
  }).filter((p) => !p.endsWith(".gitkeep"));
}

/** Serves ../shared at <base>shared/ in dev and copies it into dist/shared/ on build. */
function sharedAssets(): Plugin {
  return {
    name: "sim2browser-shared",
    configureServer(server) {
      server.middlewares.use(`${BASE}shared/`, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const file = resolve(SHARED, rel);
        const inShipped = SHIPPED.some(
          (e) => file === join(SHARED, e) || file.startsWith(join(SHARED, e) + "/"),
        );
        if (!inShipped) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        createReadStream(file).pipe(res);
      });
    },
    // `vite preview` is the local deploy: gzip responses like a typical static host (GitHub Pages
    // serves gzip), so load-time tests measure realistic transfer sizes.
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) return next();
        const file = join(
          server.config.build.outDir,
          (req.url ?? "").split("?")[0].replace(BASE, "/"),
        );
        if (!COMPRESSIBLE.has(extname(file))) return next();
        let body: Buffer;
        try {
          body = gzipSync(readFileSync(file), { level: 6 });
        } catch {
          return next();
        }
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        res.setHeader("Content-Length", body.length);
        res.setHeader("Vary", "Accept-Encoding");
        res.end(body);
      });
    },
    generateBundle() {
      for (const file of shippedFiles()) {
        this.emitFile({
          type: "asset",
          fileName: `shared/${relative(SHARED, file)}`,
          source: readFileSync(file),
        });
      }
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [sharedAssets()],
  worker: { format: "es" },
  build: { target: "es2022" },
  server: { fs: { allow: [".."] } },
});
