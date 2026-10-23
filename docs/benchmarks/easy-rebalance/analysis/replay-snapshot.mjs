import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  build,
  version,
} from "../../../../web/node_modules/esbuild/lib/main.js";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const archive = JSON.parse(
  gunzipSync(
    await readFile(new URL("../source-snapshot.json.gz", import.meta.url))
  )
);
const root = path.join(repository, ".local", `easy-replay-${process.pid}`);
const compiled = path.join(root, "compiled");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const [relative, file] of Object.entries(archive.sourceFiles)) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep))
    throw new Error("Invalid archive path");
  const bytes = Buffer.from(file.base64, "base64");
  if (sha256(bytes) !== file.sha256)
    throw new Error(`Corrupt source: ${relative}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
if (version !== archive.build.esbuild)
  console.log(`Compiler ${version}; study used ${archive.build.esbuild}`);
const result = await build({
  absWorkingDir: root,
  entryPoints: {
    "easy-run": path.join(root, "web/benchmarks/easy-run.ts"),
    worker: path.join(root, "web/benchmarks/worker.ts"),
  },
  outdir: compiled,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  write: false,
});
await mkdir(compiled, { recursive: true });
for (const output of result.outputFiles) {
  const name = path.basename(output.path);
  const expected = archive.compiledFiles[name];
  if (!expected || sha256(output.contents) !== expected.sha256)
    throw new Error(`Compiled bytes differ: ${name}`);
  if (sha256(Buffer.from(expected.base64, "base64")) !== expected.sha256)
    throw new Error(`Corrupt compiled archive: ${name}`);
  await writeFile(output.path, output.contents);
}
console.log("Both compiled entries reproduce the study byte for byte.");
if (process.argv.includes("--run")) {
  const output = path.join(root, "results.json");
  const execution = spawnSync(
    process.execPath,
    [
      path.join(compiled, "easy-run.mjs"),
      "--pairs",
      "2000",
      "--seed",
      "20270221",
      "--workers",
      "8",
      "--output",
      output,
    ],
    { cwd: root, stdio: "inherit" }
  );
  process.exitCode = execution.status ?? 1;
}
