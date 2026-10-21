import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "./AuthContext";
import { GameProvider, useGame } from "./GameContext";
import { readResults } from "@/lib/persistence";

vi.mock("./AuthContext", () => ({ useAuth: vi.fn() }));
let user: ReturnType<typeof useAuth>["user"];
beforeEach(() => {
   user = { id: "alice", name: "Alice" };
   vi.mocked(useAuth).mockImplementation(
      () => ({ user } as ReturnType<typeof useAuth>)
   );
});
describe("Game ownership", () => {
   it("records an authenticated player's completed game once", () => {
      const { result } = renderHook(useGame, { wrapper: GameProvider });
      act(() => result.current.start("easy", "Alice"));
      act(() => result.current.concedeGame());
      act(() => result.current.concedeGame());
      expect(readResults("alice")).toHaveLength(1);
   });
   it("always calls guests You and never records their games", () => {
      user = null;
      const { result } = renderHook(useGame, { wrapper: GameProvider });
      act(() => result.current.start("easy", "Old guest name"));
      expect(result.current.game?.playerName).toBe("You");
      act(() => result.current.concedeGame());
      expect(readResults()).toEqual([]);
      expect(readResults("alice")).toEqual([]);
   });
   it("does not transfer a guest game into statistics when someone signs in", () => {
      user = null;
      const { result, rerender } = renderHook(useGame, {
         wrapper: GameProvider,
      });
      act(() => result.current.start("easy", "You"));
      user = { id: "alice", name: "Alice" };
      rerender();
      act(() => result.current.concedeGame());
      expect(readResults("alice")).toEqual([]);
   });
   it("does not record a game for a different account or a signed-out player", () => {
      const { result, rerender } = renderHook(useGame, {
         wrapper: GameProvider,
      });
      act(() => result.current.start("easy", "Alice"));
      user = { id: "bob", name: "Bob" };
      rerender();
      act(() => result.current.concedeGame());
      expect(readResults("alice")).toEqual([]);
      expect(readResults("bob")).toEqual([]);
      act(() => result.current.start("easy", "Bob"));
      user = null;
      rerender();
      expect(result.current.game?.playerName).toBe("You");
      act(() => result.current.concedeGame());
      expect(readResults("bob")).toEqual([]);
   });
});
