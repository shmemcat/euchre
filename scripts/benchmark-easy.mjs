import { build } from "../web/node_modules/esbuild/lib/main.js";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".local", `easy-benchmark-${process.pid}`);
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: {
    "easy-run": path.join(root, "web/benchmarks/easy-run.ts"),
    worker: path.join(root, "web/benchmarks/worker.ts"),
  },
  outdir: output,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
process.chdir(root);
await import(pathToFileURL(path.join(output, "easy-run.mjs")).href);
