import { expect, it, vi } from "vitest";
import { newGame } from "@/game/engine";
import { createSavedGameClient, SaveConflict } from "./savedGame";

it("binds reads and writes to the expected account as well as the shared session", async () => {
   const game = newGame("easy", "Alice");
   const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
         if (String(input).endsWith("/session"))
            return new Response(
               JSON.stringify({
                  user: { id: "alice", name: "Alice" },
                  csrf_token: "csrf",
               })
            );
         expect(new Headers(init?.headers).get("X-Euchre-User")).toBe("alice");
         expect(init?.credentials).toBe("include");
         if (init?.method === "PUT")
            expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf");
         return new Response(JSON.stringify({ game, revision: 2 }));
      }
   );
   const client = createSavedGameClient("/api/account", fetcher);
   expect((await client.load("alice")).game?.id).toBe(game.id);
   await client.save("alice", game, 1);
   expect(fetcher).toHaveBeenCalledWith(
      "/api/euchre/saved-game",
      expect.objectContaining({ method: "PUT" })
   );
});

it("refuses a changed account before sending a snapshot", async () => {
   const fetcher = vi.fn(
      async () =>
         new Response(
            JSON.stringify({
               user: { id: "bob", name: "Bob" },
               csrf_token: "csrf",
            })
         )
   );
   const client = createSavedGameClient("/api/account", fetcher);
   await expect(
      client.save("alice", newGame("easy", "Alice"), 0)
   ).rejects.toThrow("account changed");
   expect(fetcher).toHaveBeenCalledTimes(1);
});

it("only accepts a valid newer game in a conflict response", async () => {
   const game = newGame("medium", "Alice");
   const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/session")
         ? new Response(
              JSON.stringify({
                 user: { id: "alice", name: "Alice" },
                 csrf_token: "csrf",
              })
           )
         : new Response(
              JSON.stringify({
                 game,
                 revision: 4,
                 error: "Newer progress",
                 code: "SAVE_CONFLICT",
              }),
              { status: 409 }
           )
   );
   await expect(
      createSavedGameClient("/api/account", fetcher).save("alice", game, 2)
   ).rejects.toBeInstanceOf(SaveConflict);
});
