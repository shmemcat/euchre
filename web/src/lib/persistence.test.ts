import { describe, it, expect, vi } from "vitest";
import { concede, newGame } from "@/game/engine";
import {
   GAME_KEY,
   loadGame,
   readResults,
   recordResult,
   saveGame,
} from "./persistence";
import { writeStorage } from "./storage";
describe("Local game persistence", () => {
   it("restores exactly the saved game", () => {
      const game = newGame();
      expect(saveGame(game)).toBe(true);
      expect(loadGame()).toEqual(game);
   });
   it("recovers from invalid and older saved data", () => {
      localStorage.setItem(GAME_KEY, '{"version":0}');
      expect(loadGame()).toBeNull();
      expect(localStorage.getItem(GAME_KEY)).toBeNull();
      localStorage.setItem(GAME_KEY, "broken");
      expect(loadGame()).toBeNull();
   });
   it("counts a finished game once even after reloading", () => {
      const game = concede(newGame());
      recordResult(game, "alice");
      recordResult(game, "alice");
      expect(readResults("alice")).toHaveLength(1);
      expect(readResults("alice")[0].conceded).toBe(true);
      expect(readResults("alice")[0].won).toBe(false);
   });
   it("does not count unfinished or abandoned games", () => {
      recordResult(newGame(), "alice");
      expect(readResults("alice")).toEqual([]);
   });
   it("keeps guest games and legacy browser results out of account statistics", () => {
      recordResult(concede(newGame()));
      localStorage.setItem(
         "euchre.results.v1",
         JSON.stringify([{ won: true }])
      );
      expect(readResults()).toEqual([]);
      expect(readResults("alice")).toEqual([]);
      expect(localStorage.getItem("euchre.results.v2:alice")).toBeNull();
   });
   it("isolates results for accounts sharing the same browser", () => {
      recordResult(concede(newGame()), "alice");
      expect(readResults("alice")).toHaveLength(1);
      expect(readResults("bob")).toEqual([]);
   });
   it("reports disabled storage without crashing", () => {
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
         throw new Error("quota");
      });
      expect(writeStorage("test", {})).toBe(false);
      expect(saveGame(newGame())).toBe(false);
   });
});
