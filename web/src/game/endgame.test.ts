import { describe, expect, it } from "vitest";
import {
   applyAction,
   legalActions,
   newGame,
   observe,
   suitOf,
   team,
   type Game,
} from "./engine";
import { mediumAction } from "./ai";
import { settledScore, solveEndgame } from "./endgame";
import { seeded } from "../../benchmarks/harness";

// Independent oracle: enumerate continuations through the real rules engine.
function exhaustive(game: Game): number {
   if (game.phase === "round_complete") return game.scores[0] - game.scores[1];
   const values = legalActions(game).map((a) =>
      exhaustive(applyAction(game, a))
   );
   return team(game.turn) === 0 ? Math.max(...values) : Math.min(...values);
}

describe("Hypothetical endgame search", () => {
   it("only stops early when the hand's points are fixed", () => {
      expect(settledScore(0, false, [3, 0])).toBeNull();
      expect(settledScore(0, false, [2, 2])).toBeNull();
      expect(settledScore(0, false, [3, 1])).toBe(1);
      expect(settledScore(0, false, [1, 3])).toBe(-2);
      expect(settledScore(1, true, [0, 5])).toBe(-4);
   });
   it.each([false, true])(
      "matches exhaustive engine play, alone=%s",
      (alone) => {
         for (const seed of [1, 789, 54321, 20261021, 0x80000000, 0xfffffff0]) {
            const random = seeded(seed);
            let game = newGame("medium", "Test", random);
            game = applyAction(game, {
               type: "call",
               suit: suitOf(game.upCard),
               alone,
            });
            while (game.phase !== "round_complete") {
               if (
                  game.phase === "playing" &&
                  game.completedTricks.length >= 2 &&
                  game.trick.length <= 1
               ) {
                  const before = structuredClone(game);
                  expect(
                     solveEndgame(
                        game.hands,
                        game.trump!,
                        game.maker!,
                        game.alone,
                        game.turn,
                        game.trick,
                        game.tricks
                     ),
                     `seed ${seed}, trick ${game.completedTricks.length}`
                  ).toBe(exhaustive(game));
                  expect(game).toEqual(before);
               }
               game = applyAction(
                  game,
                  game.phase === "trick_complete"
                     ? { type: "advance" }
                     : mediumAction(observe(game)),
                  random
               );
            }
         }
      }
   );
});
