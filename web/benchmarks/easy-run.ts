import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { EASY_POLICY } from "../src/game/ai";
import { runPairs } from "./parallel";
import { summarize } from "./harness";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
   const at = args.indexOf(`--${name}`);
   return at < 0 ? fallback : args[at + 1];
};
const count = Number(option("pairs", "2000"));
const seed = Number(option("seed", "20270221"));
const workers = Number(option("workers", "8"));
const output = option("output", ".local/easy-benchmark.json");
if (
   ![count, seed, workers].every(Number.isInteger) ||
   count < 2 ||
   workers < 1 ||
   workers > 16
)
   throw new Error("Use integer pairs>=2, seed and workers1..16.");
const sourceSha256 = Object.fromEntries(
   await Promise.all(
      [
         "web/src/game/ai.ts",
         "web/src/game/engine.ts",
         "web/src/game/hardest.ts",
         "web/src/game/partner-search.ts",
         "web/src/game/endgame.ts",
         "web/src/game/play-policy.ts",
         "web/benchmarks/pre-strengthening-ai.ts",
         "web/benchmarks/pre-strengthening-play-policy.ts",
         "web/benchmarks/pre-strengthening-endgame.ts",
         "web/benchmarks/easy-run.ts",
         "web/benchmarks/worker.ts",
         "web/benchmarks/parallel.ts",
         "web/benchmarks/harness.ts",
      ].map(async (file) => [
         file,
         createHash("sha256")
            .update(await readFile(file))
            .digest("hex"),
      ])
   )
);
const report = {
   mode: "matches",
   partners: "medium",
   seed,
   pairsPerComparison: count,
   workers,
   easyPolicy: EASY_POLICY,
   sourceSha256,
   generatedAt: new Date().toISOString(),
   results: [] as unknown[],
};
for (const previous of args.includes("--current-only")
   ? [false]
   : [false, true]) {
   const samples = await runPairs(
      {
         seed,
         count,
         candidate: "easy",
         opponent: "medium",
         oldOpponent: false,
         preStrengtheningCandidate: previous,
         mixed: true,
         matches: true,
      },
      workers,
      () => {}
   );
   const result = {
      comparison: previous ? "previous easy vs medium" : "easy vs medium",
      partners: "medium",
      ...summarize(samples),
      pairResults: samples.map((legs, index) => ({
         seed: (seed + Math.imul(index, 2654435761)) >>> 0,
         legs: legs.map(({ won, points, decisions, redeals }) => ({
            won,
            points,
            decisions,
            redeals,
         })),
      })),
   };
   report.results.push(result);
   await mkdir(path.dirname(output), { recursive: true });
   await writeFile(output, JSON.stringify(report, null, 2) + "\n");
   console.log(
      `${result.comparison}: ${(100 * result.scoreShare).toFixed(2)}% wins, ${
         result.games
      } matches`
   );
}
console.log(`Saved ${output}`);
