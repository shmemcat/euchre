import { Worker } from "node:worker_threads";
import type { Difficulty } from "../src/game/engine";
import type { Result } from "./harness";

export type BenchmarkJob = {
   seed: number;
   start: number;
   count: number;
   candidate: Difficulty;
   opponent: Difficulty;
   oldOpponent: boolean;
   preStrengtheningOpponent?: boolean;
   preStrengtheningCandidate?: boolean;
   mixed: boolean;
   matches: boolean;
};

export async function runPairs(
   job: Omit<BenchmarkJob, "start">,
   concurrency: number,
   onProgress: (completed: number) => void
): Promise<Result[][]> {
   const workers: Worker[] = [];
   const results: Result[][] = Array(job.count);
   const count = Math.min(job.count, concurrency);
   let completed = 0;
   try {
      await Promise.all(
         Array.from(
            { length: count },
            (_, index) =>
               new Promise<void>((resolve, reject) => {
                  const start = Math.floor((index * job.count) / count);
                  const end = Math.floor(((index + 1) * job.count) / count);
                  const worker = new Worker(
                     new URL("./worker.mjs", import.meta.url),
                     {
                        workerData: {
                           ...job,
                           start,
                           count: end - start,
                        } satisfies BenchmarkJob,
                     }
                  );
                  workers.push(worker);
                  worker.on(
                     "message",
                     (message: { index: number; result: Result[] }) => {
                        results[message.index] = message.result;
                        onProgress(++completed);
                     }
                  );
                  worker.once("error", reject);
                  worker.once("exit", (code) =>
                     code === 0
                        ? resolve()
                        : reject(new Error(`Benchmark worker exited ${code}`))
                  );
               })
         )
      );
      if (completed !== job.count)
         throw new Error("Benchmark workers returned incomplete results.");
      return results;
   } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
   }
}
