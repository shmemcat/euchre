import type { Difficulty } from "@/game/engine";
import type {
   LeaderboardEntry,
   AchievementLeaderboardEntry,
} from "@/components/LeaderboardColumn";
import { accountApiBase, createAccountClient } from "./account";
import { gameApiBase } from "./gameApi";
import {
   markResultsSynced,
   readResults,
   readSyncedResultIds,
   type StoredResult,
} from "./persistence";

export type LeaderboardCategory = Difficulty | "multiplayer" | "achievements";
export type LeaderboardData = {
   monthly: LeaderboardEntry[];
   all_time: (LeaderboardEntry | AchievementLeaderboardEntry)[];
};
const empty: LeaderboardData = { monthly: [], all_time: [] };

export function createLeaderboardClient(
   base: string,
   fetcher: typeof fetch = fetch
) {
   const url = gameApiBase(base);
   const account = createAccountClient(base, fetcher);
   const read = async (response: Response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok)
         throw new Error(
            typeof data?.error === "string"
               ? data.error
               : "Unable to load the leaderboard. Please try again."
         );
      return data;
   };
   return {
      async load(
         category: LeaderboardCategory,
         signal?: AbortSignal
      ): Promise<LeaderboardData> {
         const data = await read(
            await fetcher(
               `${url}/leaderboard?category=${encodeURIComponent(category)}`,
               {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                  cache: "no-store",
                  signal,
               }
            )
         );
         const validEntries = (value: unknown): boolean =>
            Array.isArray(value) &&
            value.every(
               (entry) =>
                  entry &&
                  Number.isInteger(entry.rank) &&
                  entry.rank > 0 &&
                  typeof entry.username === "string" &&
                  Number.isInteger(
                     entry[
                        category === "achievements"
                           ? "achievement_count"
                           : "games_won"
                     ]
                  ) &&
                  entry[
                     category === "achievements"
                        ? "achievement_count"
                        : "games_won"
                  ] > 0 &&
                  (entry.profile_icon === undefined ||
                     entry.profile_icon === null ||
                     typeof entry.profile_icon === "string")
            );
         if (
            !data ||
            !validEntries(data.monthly) ||
            !validEntries(data.all_time)
         )
            throw new Error("The leaderboard returned an unexpected response.");
         return data;
      },
      async save(
         userId: string,
         results: StoredResult[],
         onSaved: (ids: string[]) => void
      ) {
         if (!results.length) return;
         const session = await account.session();
         if (session.user?.id !== userId)
            throw new Error(
               "Your account changed. Sign in again to save your results."
            );
         for (let index = 0; index < results.length; index += 40) {
            const chunk = results.slice(index, index + 40);
            const data = await read(
               await fetcher(`${url}/results`, {
                  method: "POST",
                  credentials: "include",
                  headers: {
                     "Content-Type": "application/json",
                     "X-CSRF-Token": session.csrf_token,
                  },
                  body: JSON.stringify({ results: chunk }),
               })
            );
            if (
               !Array.isArray(data?.saved_ids) ||
               data.saved_ids.length !== chunk.length ||
               !chunk.every((result) => data.saved_ids.includes(result.id))
            )
               throw new Error(
                  "The account service could not confirm your saved results."
               );
            onSaved(data.saved_ids);
            window.dispatchEvent(new Event("euchre:achievements"));
         }
      },
   };
}

const syncing = new Map<string, Promise<void>>();
export function syncLeaderboardResults(userId: string): Promise<void> {
   const base = accountApiBase();
   if (!base) return Promise.resolve();
   const existing = syncing.get(userId);
   if (existing) return existing;
   const task = (async () => {
      const client = createLeaderboardClient(base);
      // Only account-scoped v2 results are eligible. Never read the guest/legacy key.
      while (true) {
         const synced = new Set(readSyncedResultIds(userId));
         const pending = readResults(userId).filter(
            (result) => !synced.has(result.id)
         );
         if (!pending.length) return;
         let acknowledged = false;
         await client.save(userId, pending, (ids) => {
            markResultsSynced(userId, ids);
            acknowledged = true;
         });
         // Storage can be disabled. The server deduplicates a later retry.
         if (
            !acknowledged ||
            pending.some(
               (result) => !readSyncedResultIds(userId).includes(result.id)
            )
         )
            return;
      }
   })().finally(() => syncing.delete(userId));
   syncing.set(userId, task);
   return task;
}

export function fetchLeaderboard(
   category: LeaderboardCategory,
   signal?: AbortSignal
) {
   const base = accountApiBase();
   return base
      ? createLeaderboardClient(base).load(category, signal)
      : Promise.resolve(empty);
}
