import { isGame, singlePlayerSeatNames, type Difficulty, type Game } from "@/game/engine";
import { readStorage, removeStorage, writeStorage } from "./storage";

export const GAME_KEY = "euchre.game.v1";
const resultsKey = (userId: string) =>
   `euchre.results.v2:${encodeURIComponent(userId)}`;
const syncedKey = (userId: string) =>
   `euchre.synced-results.v1:${encodeURIComponent(userId)}`;
export const clearResults = (userId: string) => {
   removeStorage(resultsKey(userId));
   removeStorage(syncedKey(userId));
};
export function readSyncedResultIds(userId: string): string[] {
   const value = readStorage<unknown>(syncedKey(userId), []);
   return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
}
export function markResultsSynced(userId: string, ids: string[]) {
   writeStorage(syncedKey(userId), [
      ...new Set([...readSyncedResultIds(userId), ...ids]),
   ]);
}
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
   if (isGame(value)) {
      if (!value.seatNames) {
         value.seatNames = singlePlayerSeatNames(value.playerName);
         saveGame(value);
      }
      return value;
   }
   if (value !== null) removeStorage(GAME_KEY);
   return null;
}
export const saveGame = (game: Game): boolean => writeStorage(GAME_KEY, game);
export function readResults(userId?: string | null): StoredResult[] {
   if (!userId) return [];
   const value = readStorage<unknown>(resultsKey(userId), []);
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
export function recordResult(game: Game, userId?: string | null): boolean {
   if (!userId) return true;
   if (game.phase !== "game_over" || !game.finishedAt) return true;
   const results = readResults(userId);
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
   return writeStorage(resultsKey(userId), results);
}
