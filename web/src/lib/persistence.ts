import { isGame, type Difficulty, type Game } from "@/game/engine";
import { readStorage, removeStorage, writeStorage } from "./storage";

export const GAME_KEY = "euchre.game.v1";
const RESULTS_KEY = "euchre.results.v1";
export type StoredResult = {
   id: string;
   difficulty: Difficulty;
   won: boolean;
   conceded: boolean;
   scores: [number, number];
   finishedAt: string;
   marches: number;
   loners: number;
   euchres: number;
};
export function loadGame(): Game | null {
   const value = readStorage<unknown>(GAME_KEY, null);
   if (isGame(value)) return value;
   if (value !== null) removeStorage(GAME_KEY);
   return null;
}
export const saveGame = (game: Game): boolean => writeStorage(GAME_KEY, game);
export function readResults(): StoredResult[] {
   const value = readStorage<unknown>(RESULTS_KEY, []);
   if (!Array.isArray(value)) return [];
   return value.filter(
      (r): r is StoredResult =>
         r &&
         typeof r.id === "string" &&
         typeof r.won === "boolean" &&
         typeof r.conceded === "boolean" &&
         ["easy", "medium", "hard", "harder", "hardest"].includes(
            r.difficulty
         ) &&
         Array.isArray(r.scores) &&
         r.scores.length === 2 &&
         r.scores.every(
            (n: unknown) =>
               typeof n === "number" && Number.isFinite(n) && n >= 0
         ) &&
         typeof r.finishedAt === "string" &&
         [r.marches, r.loners, r.euchres].every(
            (n) => Number.isInteger(n) && n >= 0
         )
   );
}
export function recordResult(game: Game): boolean {
   if (game.phase !== "game_over" || !game.finishedAt) return true;
   const results = readResults();
   if (results.some((r) => r.id === game.id)) return true;
   results.push({
      id: game.id,
      difficulty: game.difficulty,
      won: !game.conceded && game.scores[0] >= 10,
      conceded: game.conceded,
      scores: [...game.scores],
      finishedAt: game.finishedAt,
      marches: game.results.filter(
         (r) => r.maker % 2 === 0 && !r.alone && r.tricks[0] === 5
      ).length,
      loners: game.results.filter(
         (r) => r.maker === 0 && r.alone && r.tricks[0] === 5
      ).length,
      euchres: game.results.filter((r) => r.maker % 2 === 1 && r.tricks[1] < 3)
         .length,
   });
   return writeStorage(RESULTS_KEY, results);
}
