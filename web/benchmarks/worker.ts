import { parentPort, workerData } from "node:worker_threads";
import { chooseAction } from "../src/game/ai";
import { chooseAction as legacy } from "./legacy-ai";
import { chooseAction as beforeStrengthening } from "./pre-strengthening-ai";
import { pair, type Bot } from "./harness";
import type { Difficulty } from "../src/game/engine";
import type { BenchmarkJob } from "./parallel";

const job = workerData as BenchmarkJob;
const bot =
   (difficulty: Difficulty, old = false, before = false): Bot =>
   (o, random) =>
      (before ? beforeStrengthening : old ? legacy : chooseAction)(
         { ...o, difficulty },
         random
      );
const candidate = bot(job.candidate, false, job.preStrengtheningCandidate);
const opponent = bot(
   job.opponent,
   job.oldOpponent,
   job.preStrengtheningOpponent
);
const partner = job.mixed ? bot("medium") : undefined;
for (let index = job.start; index < job.start + job.count; index++) {
   const result = pair(
      (job.seed + Math.imul(index, 2654435761)) >>> 0,
      candidate,
      opponent,
      partner,
      job.matches
   );
   parentPort!.postMessage({ index, result });
}
