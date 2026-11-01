import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { applyAction, legalActions, newGame, type Game } from "@/game/engine";
import { GAME_KEY, readResults } from "@/lib/persistence";
import { GameProvider, useGame } from "./GameContext";
import { SaveConflict } from "@/lib/savedGame";

const mocks = vi.hoisted(() => ({
   user: { id: "alice", name: "Alice" } as { id: string; name: string } | null,
   load: vi.fn(),
   save: vi.fn(),
}));
vi.mock("./AuthContext", () => ({
   useAuth: () => ({ user: mocks.user, loading: false }),
}));
vi.mock("@/lib/account", async (original) => ({
   ...(await original<object>()),
   accountApiBase: () => "/api/account",
}));
vi.mock("@/lib/leaderboard", () => ({
   syncLeaderboardResults: vi.fn(async () => {}),
}));
vi.mock("@/lib/savedGame", async (original) => ({
   ...(await original<object>()),
   createSavedGameClient: () => ({ load: mocks.load, save: mocks.save }),
}));
beforeEach(() => {
   mocks.user = { id: "alice", name: "Alice" };
   mocks.load.mockReset().mockResolvedValue({ game: null, revision: 0 });
   mocks.save
      .mockReset()
      .mockImplementation(
         async (_uid: string, game: Game, revision: number) => ({
            game,
            revision: revision + 1,
         })
      );
});

it("keeps the selected game when the server refuses a new game at the limit", async () => {
   const existing = newGame("easy", "Alice");
   mocks.load.mockResolvedValue({ game: existing, revision: 3 });
   const { result } = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() => expect(result.current.game?.id).toBe(existing.id));
   mocks.save.mockRejectedValue(
      new Error(
         "You have 20 games in progress. Finish or concede one to make room."
      )
   );
   await act(async () => {
      await expect(result.current.start("easy", "Alice")).rejects.toThrow(
         "20 games in progress"
      );
   });
   expect(result.current.game?.id).toBe(existing.id);
   expect(result.current.saved).toBe(true);
});

it("restores an account's bot game on a fresh browser without uploading a blank or stale state", async () => {
   const game = newGame("medium", "Alice");
   mocks.load.mockResolvedValue({ game, revision: 7 });
   const { result } = renderHook(useGame, { wrapper: GameProvider });
   expect(result.current.loading).toBe(true);
   await waitFor(() => expect(result.current.game?.id).toBe(game.id));
   expect(mocks.save).not.toHaveBeenCalled();
   act(() => result.current.act(legalActions(game)[0]));
   await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("alice", expect.anything(), 7)
   );
   await waitFor(() => expect(result.current.saved).toBe(true));
});

it("opens the selected older game and concedes another save without replacing the selected game", async () => {
   const older = newGame("easy", "Alice"),
      newer = newGame("medium", "Alice");
   mocks.load.mockImplementation(async (_owner: string, id?: string) => ({
      game: id === older.id ? older : newer,
      revision: id === older.id ? 3 : 8,
   }));
   const { result } = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() => expect(result.current.game?.id).toBe(newer.id));
   await act(async () => result.current.resumeSaved(older.id));
   expect(result.current.game?.id).toBe(older.id);
   expect(mocks.load).toHaveBeenLastCalledWith("alice", older.id);
   await act(async () => result.current.concedeSaved(newer.id));
   expect(mocks.save).toHaveBeenLastCalledWith(
      "alice",
      expect.objectContaining({ id: newer.id, conceded: true }),
      8
   );
   expect(result.current.game?.id).toBe(older.id);
   expect(result.current.game?.conceded).toBe(false);
   expect(readResults("alice")).toHaveLength(1);
   act(() => result.current.act(legalActions(older)[0]));
   await waitFor(() =>
      expect(mocks.save).toHaveBeenLastCalledWith(
         "alice",
         expect.objectContaining({ id: older.id }),
         3
      )
   );
});

it("imports an existing save only for its recorded owner and removes the legacy copy after acknowledgement", async () => {
   const game = newGame("easy", "Alice");
   localStorage.setItem(GAME_KEY, JSON.stringify(game));
   localStorage.setItem(
      "euchre.game-owner.v1",
      JSON.stringify({ gameId: game.id, userId: "alice" })
   );
   const { result, unmount } = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("alice", game, 0)
   );
   await waitFor(() => expect(result.current.saved).toBe(true));
   expect(localStorage.getItem(GAME_KEY)).toBeNull();
   unmount();
   mocks.user = { id: "bob", name: "Bob" };
   mocks.save.mockClear();
   const other = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() => expect(other.result.current.loading).toBe(false));
   expect(other.result.current.game).toBeNull();
   expect(mocks.save).not.toHaveBeenCalled();
});

it("serializes saves and uses the acknowledged revision for the next move", async () => {
   let acknowledge: (value: {
      game: Game;
      revision: number;
   }) => void = () => {};
   mocks.save
      .mockImplementationOnce(async (_uid: string, game: Game) => ({
         game,
         revision: 1,
      }))
      .mockImplementationOnce(
         () =>
            new Promise((resolve) => {
               acknowledge = resolve;
            })
      );
   const { result } = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() => expect(result.current.loading).toBe(false));
   await act(async () => result.current.start("easy", "Alice"));
   const first = result.current.game!;
   act(() => result.current.act(legalActions(first)[0]));
   expect(mocks.save).toHaveBeenCalledTimes(2);
   expect(() => act(() => result.current.start("hard", "Alice"))).toThrow(
      "finish saving"
   );
   await act(async () => acknowledge({ game: first, revision: 1 }));
   await waitFor(() => expect(result.current.saved).toBe(true));
   expect(mocks.save.mock.calls[1][2]).toBe(1);
   await waitFor(() => expect(result.current.saved).toBe(true));
});

it("loads newer progress after a conflict and does not record the rejected concession", async () => {
   const game = newGame("easy", "Alice");
   const newer = applyAction(game, legalActions(game)[0]);
   mocks.load.mockResolvedValue({ game, revision: 1 });
   mocks.save.mockRejectedValue(
      new SaveConflict(
         { game: newer, revision: 2 },
         "Another device saved newer progress."
      )
   );
   const { result } = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() => expect(result.current.game?.id).toBe(game.id));
   act(() => result.current.concedeGame());
   await waitFor(() =>
      expect(result.current.error).toContain("newer progress")
   );
   expect(result.current.game?.phase).toBe(newer.phase);
   expect(result.current.game?.conceded).toBe(false);
   expect(readResults("alice")).toEqual([]);
});

it("retries an offline save after reconnecting and recovers an unacknowledged save after reload", async () => {
   const first = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() => expect(first.result.current.loading).toBe(false));
   await act(async () => first.result.current.start("easy", "Alice"));
   mocks.save.mockRejectedValue(new Error("Offline"));
   act(() =>
      first.result.current.act(legalActions(first.result.current.game!)[0])
   );
   const game = first.result.current.game!;
   await waitFor(() => expect(first.result.current.error).toBe("Offline"));
   expect(first.result.current.saved).toBe(false);
   first.unmount();
   mocks.save.mockResolvedValue({ game, revision: 1 });
   const recovered = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() => expect(recovered.result.current.game?.id).toBe(game.id));
   await waitFor(() => expect(recovered.result.current.saved).toBe(true));
   expect(mocks.save).toHaveBeenLastCalledWith("alice", game, 1);
});

it("ignores an old account's late responses and never exposes its cached game after sign-out", async () => {
   let resolveAlice: (value: {
      game: Game;
      revision: number;
   }) => void = () => {};
   const alice = newGame("easy", "Alice"),
      bob = newGame("medium", "Bob");
   mocks.load
      .mockImplementationOnce(
         () =>
            new Promise((resolve) => {
               resolveAlice = resolve;
            })
      )
      .mockResolvedValue({ game: bob, revision: 2 });
   const { result, rerender } = renderHook(useGame, { wrapper: GameProvider });
   mocks.user = { id: "bob", name: "Bob" };
   rerender();
   await waitFor(() => expect(result.current.game?.id).toBe(bob.id));
   await act(async () => resolveAlice({ game: alice, revision: 1 }));
   expect(result.current.game?.id).toBe(bob.id);
   mocks.user = null;
   rerender();
   expect(result.current.game).toBeNull();
   expect(localStorage.getItem(GAME_KEY)).toBeNull();
   expect(localStorage.getItem("euchre.guest-games.v1") ?? "").not.toContain(
      bob.id
   );
});

it("keeps pending offline progress when the first load fails and retries it on reconnect", async () => {
   const game = newGame("easy", "Alice");
   localStorage.setItem(
      "euchre.saved-game.v1:alice",
      JSON.stringify({ game, revision: 3, pending: true })
   );
   mocks.load
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ game: null, revision: 0 });
   const { result } = renderHook(useGame, { wrapper: GameProvider });
   await waitFor(() => expect(result.current.error).toBe("Offline"));
   expect(result.current.game?.id).toBe(game.id);
   act(() => window.dispatchEvent(new Event("online")));
   await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith("alice", game, 3)
   );
   await waitFor(() => expect(result.current.saved).toBe(true));
});
