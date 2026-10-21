import { afterEach, describe, expect, it, vi } from "vitest";
import { createLeaderboardClient, syncLeaderboardResults } from "./leaderboard";
import { readSyncedResultIds, type StoredResult } from "./persistence";

const session = { user: { id: "alice", name: "Alice" }, csrf_token: "csrf" };
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const stored = (id: string): StoredResult => ({
   id,
   difficulty: "easy",
   won: true,
   conceded: false,
   scores: [10, 5],
   finishedAt: "2026-10-21T11:00:00Z",
   marches: 0,
   loners: 0,
   euchres: 0,
});
afterEach(() => {
   vi.unstubAllEnvs();
   vi.unstubAllGlobals();
});

describe("Shared Euchre leaderboards", () => {
   it("reads public account rankings without storing credentials", async () => {
      const data = {
         monthly: [
            { rank: 1, username: "Alice", games_won: 2, profile_icon: "cat" },
         ],
         all_time: [],
      };
      const fetcher = vi.fn().mockResolvedValue(response(data));
      expect(
         await createLeaderboardClient("/api/account/", fetcher).load("hardest")
      ).toEqual(data);
      expect(fetcher).toHaveBeenCalledWith(
         "/api/account/euchre/leaderboard?category=hardest",
         expect.objectContaining({ credentials: "include", cache: "no-store" })
      );
      expect(localStorage.length).toBe(0);
   });
   it("sends account-owned results in bounded batches with CSRF", async () => {
      const fetcher = vi.fn().mockImplementation(async (url, options) =>
         url.endsWith("/session")
            ? response(session)
            : response({
                 saved_ids: JSON.parse(options.body).results.map(
                    (game: StoredResult) => game.id
                 ),
              })
      );
      const acknowledged: string[] = [];
      await createLeaderboardClient("/api/account", fetcher).save(
         "alice",
         Array.from({ length: 81 }, (_, i) => stored(`game-${i}`)),
         (ids) => acknowledged.push(...ids)
      );
      const posts = fetcher.mock.calls.filter(
         (call) => call[1]?.method === "POST"
      );
      expect(
         posts.map((call) => JSON.parse(call[1].body).results.length)
      ).toEqual([40, 40, 1]);
      expect(posts[0][1]).toMatchObject({
         credentials: "include",
         headers: { "X-CSRF-Token": "csrf" },
      });
      expect(acknowledged).toHaveLength(81);
   });
   it("never submits another account's results after a session change", async () => {
      const fetcher = vi
         .fn()
         .mockResolvedValue(
            response({ ...session, user: { id: "bob", name: "Bob" } })
         );
      await expect(
         createLeaderboardClient("/api/account", fetcher).save(
            "alice",
            [stored("g1")],
            vi.fn()
         )
      ).rejects.toThrow("account changed");
      expect(fetcher).toHaveBeenCalledTimes(1);
   });
   it("excludes guest, unassigned, and other-account browser data from synchronization", async () => {
      vi.stubEnv("VITE_ACCOUNT_API_URL", "/api/account");
      const fetcher = vi.fn().mockImplementation(async (url, options) =>
         url.endsWith("/session")
            ? response(session)
            : response({
                 saved_ids: JSON.parse(options.body).results.map(
                    (game: StoredResult) => game.id
                 ),
              })
      );
      vi.stubGlobal("fetch", fetcher);
      localStorage.setItem(
         "euchre.results.v1",
         JSON.stringify([stored("guest-win")])
      );
      localStorage.setItem(
         "euchre.results.v2:bob",
         JSON.stringify([stored("bob-win")])
      );
      await syncLeaderboardResults("alice");
      expect(fetcher).not.toHaveBeenCalled();
      localStorage.setItem(
         "euchre.results.v2:alice",
         JSON.stringify([stored("alice-win")])
      );
      await syncLeaderboardResults("alice");
      const uploaded = JSON.parse(fetcher.mock.calls[1][1].body).results;
      expect(uploaded.map((game: StoredResult) => game.id)).toEqual([
         "alice-win",
      ]);
      expect(readSyncedResultIds("alice")).toEqual(["alice-win"]);
      await syncLeaderboardResults("alice");
      expect(fetcher).toHaveBeenCalledTimes(2);
   });
   it("retries failed uploads and only marks confirmed results as saved", async () => {
      vi.stubEnv("VITE_ACCOUNT_API_URL", "/api/account");
      localStorage.setItem(
         "euchre.results.v2:alice",
         JSON.stringify([stored("g1")])
      );
      const fetcher = vi
         .fn()
         .mockResolvedValueOnce(response(session))
         .mockRejectedValueOnce(new Error("offline"));
      vi.stubGlobal("fetch", fetcher);
      await expect(syncLeaderboardResults("alice")).rejects.toThrow("offline");
      expect(readSyncedResultIds("alice")).toEqual([]);
      fetcher
         .mockResolvedValueOnce(response(session))
         .mockResolvedValueOnce(response({ saved_ids: ["g1"] }));
      await syncLeaderboardResults("alice");
      expect(readSyncedResultIds("alice")).toEqual(["g1"]);
   });
   it("does not fetch multiplayer rankings or accept malformed counts", async () => {
      const fetcher = vi.fn().mockResolvedValue(
         response({
            monthly: [{ rank: 1, username: "Alice", games_won: "2" }],
            all_time: [],
         })
      );
      const client = createLeaderboardClient("/api/account", fetcher);
      expect(await client.load("multiplayer")).toEqual({
         monthly: [],
         all_time: [],
      });
      expect(fetcher).not.toHaveBeenCalled();
      await expect(client.load("easy")).rejects.toThrow("unexpected response");
   });
   it("includes a new completed game while a previous upload is still running", async () => {
      vi.stubEnv("VITE_ACCOUNT_API_URL", "/api/account");
      localStorage.setItem(
         "euchre.results.v2:alice",
         JSON.stringify([stored("g1")])
      );
      let begin!: () => void;
      let finish!: (value: ReturnType<typeof response>) => void;
      const started = new Promise<void>((resolve) => {
         begin = resolve;
      });
      let uploads = 0;
      const fetcher = vi.fn().mockImplementation(async (url, options) => {
         if (url.endsWith("/session")) return response(session);
         uploads++;
         if (uploads === 1) {
            begin();
            return new Promise((resolve) => {
               finish = resolve;
            });
         }
         return response({
            saved_ids: JSON.parse(options.body).results.map(
               (game: StoredResult) => game.id
            ),
         });
      });
      vi.stubGlobal("fetch", fetcher);
      const task = syncLeaderboardResults("alice");
      await started;
      localStorage.setItem(
         "euchre.results.v2:alice",
         JSON.stringify([stored("g1"), stored("g2")])
      );
      expect(syncLeaderboardResults("alice")).toBe(task);
      finish(response({ saved_ids: ["g1"] }));
      await task;
      expect(readSyncedResultIds("alice")).toEqual(["g1", "g2"]);
      expect(uploads).toBe(2);
   });
});
