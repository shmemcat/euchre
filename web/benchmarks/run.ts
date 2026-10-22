import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { SIMULATIONS, SWITCH_MARGIN, ENDGAME_TRICKS } from "../src/game/ai";
import { summarize } from "./harness";
import { HARDEST_STRATEGY } from "../src/game/hardest";
import {
   SIMULATIONS as PREVIOUS_SIMULATIONS,
   SWITCH_MARGIN as PREVIOUS_MARGIN,
   ENDGAME_TRICKS as PREVIOUS_ENDGAME,
} from "./pre-strengthening-ai";
import { runPairs } from "./parallel";
import type { Difficulty } from "../src/game/engine";

const args = process.argv.slice(2);
if (args.includes("--help")) {
   console.log(
      "AI benchmark: --pairs 100 --seed 20261021 --suite all|regression|ladder|strengthening|controls " +
         "--partners both|teams|mixed --mode hands|matches --comparison NAME --levels hard,harder,hardest --workers 1 --details --output PATH"
   );
   process.exit(0);
}
function option(name: string, fallback: string) {
   const index = args.indexOf(`--${name}`);
   return index < 0 ? fallback : args[index + 1];
}
const count = Number(option("pairs", "100"));
const seed = Number(option("seed", "20261021"));
const suite = option("suite", "all");
const mode = option("mode", "hands");
const partners = option("partners", "both");
const comparisonFilter = option("comparison", "");
const output = option("output", ".local/ai-benchmark.json");
const concurrency = Number(option("workers", "1"));
const levels = option("levels", "hard,harder,hardest").split(",");
const details = args.includes("--details");
if (
   !Number.isInteger(count) ||
   count < 2 ||
   !Number.isInteger(seed) ||
   !["all", "regression", "ladder", "strengthening", "controls"].includes(
      suite
   ) ||
   !["hands", "matches"].includes(mode) ||
   !["both", "teams", "mixed"].includes(partners) ||
   !Number.isInteger(concurrency) ||
   concurrency < 1 ||
   concurrency > 32 ||
   levels.some((level) => !["hard", "harder", "hardest"].includes(level))
) {
   throw new Error(
      "Use --pairs INTEGER>=2 --seed INTEGER --suite all|regression|ladder|strengthening|controls --mode hands|matches --partners both|teams|mixed --workers 1..32 --levels hard,harder,hardest."
   );
}
const comparisons: {
   name: string;
   candidate: Difficulty;
   opponent: Difficulty;
   oldOpponent: boolean;
   preStrengtheningOpponent?: boolean;
   preStrengtheningCandidate?: boolean;
}[] = [];
if (suite === "controls") {
   comparisons.push({
      name: "pre-strengthening hardest vs harder",
      candidate: "hardest",
      opponent: "harder",
      oldOpponent: false,
      preStrengtheningCandidate: true,
   });
}
if (suite === "strengthening") {
   comparisons.push({
      name: "hardest vs pre-strengthening hardest",
      candidate: "hardest",
      opponent: "hardest",
      oldOpponent: false,
      preStrengtheningOpponent: true,
   });
   comparisons.push({
      name: "hardest vs harder",
      candidate: "hardest",
      opponent: "harder",
      oldOpponent: false,
   });
}
if (suite === "all" || suite === "regression") {
   for (const level of ["hard", "harder", "hardest"] as const)
      if (levels.includes(level))
         comparisons.push({
            name: `${level} vs previous ${level}`,
            candidate: level,
            opponent: level,
            oldOpponent: true,
         });
}
if (suite === "all" || suite === "ladder") {
   for (const [candidate, opponent] of [
      ["hard", "medium"],
      ["harder", "hard"],
      ["hardest", "harder"],
   ] as const)
      if (levels.includes(candidate))
         comparisons.push({
            name: `${candidate} vs ${opponent}`,
            candidate,
            opponent,
            oldOpponent: false,
         });
}
console.log(
   `${count} duplicate-deal pairs per comparison; seed ${seed}; ${mode}.`
);
const report: Record<string, unknown> = {
   suite,
   seed,
   mode,
   workers: concurrency,
   bootstrapResamples: 10000,
   sourceSha256: Object.fromEntries(
      await Promise.all(
         [
            "web/src/game/ai.ts",
            "web/src/game/hardest.ts",
            "web/src/game/partner-search.ts",
            "web/src/game/play-policy.ts",
            "web/src/game/endgame.ts",
            "web/src/game/engine.ts",
            "web/benchmarks/legacy-ai.ts",
            "web/benchmarks/pre-strengthening-ai.ts",
            "web/benchmarks/pre-strengthening-play-policy.ts",
            "web/benchmarks/pre-strengthening-endgame.ts",
         ].map(async (file) => [
            file,
            createHash("sha256")
               .update(await readFile(file))
               .digest("hex"),
         ])
      )
   ),
   pairsPerComparison: count,
   legacySourceReference:
      "9247a0df4dfc188692189fd14a31a6c16b6a041e (AI frozen before upgrade)",
   generatedAt: new Date().toISOString(),
   runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
   },
   settings: {
      simulations: SIMULATIONS,
      hardestStrategy: HARDEST_STRATEGY,
      switchMargin: SWITCH_MARGIN,
      endgameTricks: ENDGAME_TRICKS,
   },
   preStrengtheningSettings: {
      simulations: PREVIOUS_SIMULATIONS,
      switchMargin: PREVIOUS_MARGIN,
      endgameTricks: PREVIOUS_ENDGAME,
   },
   results: [],
};
const rows: unknown[] = [];
if (comparisonFilter && !comparisons.some((c) => c.name === comparisonFilter))
   throw new Error(`Unknown comparison: ${comparisonFilter}`);
for (const comparison of comparisons) {
   if (comparisonFilter && comparison.name !== comparisonFilter) continue;
   for (const mixed of partners === "teams"
      ? [false]
      : partners === "mixed"
      ? [true]
      : [false, true]) {
      const label = `${comparison.name} (${
         mixed ? "Medium partners" : "whole teams"
      })`;
      const progressEvery = Math.max(1, Math.min(25, Math.floor(count / 4)));
      const samples = await runPairs(
         {
            seed,
            count,
            candidate: comparison.candidate,
            opponent: comparison.opponent,
            oldOpponent: comparison.oldOpponent,
            preStrengtheningOpponent: comparison.preStrengtheningOpponent,
            preStrengtheningCandidate: comparison.preStrengtheningCandidate,
            mixed,
            matches: mode === "matches",
         },
         concurrency,
         (completed) => {
            if (completed % progressEvery === 0 || completed === count)
               console.log(`  ${label}: ${completed}/${count} pairs`);
         }
      );
      const summary = summarize(samples);
      rows.push({
         comparison: comparison.name,
         partners: mixed ? "medium" : "same bot",
         candidateVersion: comparison.preStrengtheningCandidate
            ? "pre-strengthening"
            : "current",
         opponentVersion: comparison.oldOpponent
            ? "legacy"
            : comparison.preStrengtheningOpponent
            ? "pre-strengthening"
            : "current",
         ...summary,
         ...(details
            ? {
                 pairResults: samples.map((legs, index) => ({
                    seed: (seed + Math.imul(index, 2654435761)) >>> 0,
                    legs,
                 })),
              }
            : {}),
      });
      console.log(
         `${label}: ${(100 * summary.scoreShare).toFixed(1)}% ${
            mode === "matches" ? "wins" : "scoring share"
         }; ` +
            `${summary.pointMargin.toFixed(3)} points/game [${summary.margin95
               .map((x) => x.toFixed(3))
               .join(", ")}]; ` +
            `${summary.meanDecisionMs.toFixed(
               1
            )} ms/decision (max ${summary.maxDecisionMs.toFixed(1)})`
      );
      report.results = rows;
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2) + "\n");
   }
}
console.log(`Saved ${output}`);
