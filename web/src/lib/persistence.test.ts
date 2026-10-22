import { describe, it, expect, vi } from "vitest";
import { applyAction, concede, newGame, nextSeat } from "@/game/engine";
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
   it("gives older saved games stable bot names without changing the hand", () => {
      const legacy = newGame();
      delete legacy.seatNames;
      saveGame(legacy);
      const restored = loadGame()!;
      expect(restored.seatNames).toHaveLength(4);
      expect({ ...restored, seatNames: undefined }).toEqual(legacy);
      expect(loadGame()).toEqual(restored);
   });
   it("recovers from invalid and older saved data", () => {
      localStorage.setItem(GAME_KEY, '{"version":0}');
      expect(loadGame()).toBeNull();
      expect(localStorage.getItem(GAME_KEY)).toBeNull();
      localStorage.setItem(GAME_KEY, "broken");
      expect(loadGame()).toBeNull();
   });
   it("preserves the redeal count and pending summary across reloads", () => {
      let game = newGame();
      const dealer = game.dealer;
      for (let hand = 0; hand < 2; hand++) {
         for (let i = 0; i < 8; i++) game = applyAction(game, { type: "pass" });
         saveGame(game);
         game = loadGame()!;
         expect(game.message).toBe(
            hand ? "No calls — Pass" : "No calls — Re-deal"
         );
         game = applyAction(game, { type: "advance" });
         expect(game.dealer).toBe(hand ? nextSeat(dealer) : dealer);
         saveGame(game);
         game = loadGame()!;
      }
   });
   it("restores games saved before the redeal counter was added", () => {
      const legacy = newGame();
      delete legacy.consecutivePassOuts;
      saveGame(legacy);
      let game = loadGame()!;
      expect(game).toEqual(legacy);
      for (let i = 0; i < 8; i++) game = applyAction(game, { type: "pass" });
      expect(game.message).toBe("No calls — Re-deal");
      game = applyAction(game, { type: "advance" });
      expect(game.dealer).toBe(legacy.dealer);
      expect(game.consecutivePassOuts).toBe(1);
   });
   it.each([-1, 2, 0.5, "1", null])(
      "rejects a corrupt redeal counter: %s",
      (counter) => {
         writeStorage(GAME_KEY, { ...newGame(), consecutivePassOuts: counter });
         expect(loadGame()).toBeNull();
      }
   );
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
