import { describe, expect, it } from "vitest";
import { chooseAction, mediumAction } from "./ai";
import { chooseAction as beforeStrengthening } from "../../benchmarks/pre-strengthening-ai";
import { matchEquity, matchValue, publicAuction } from "./hardest";
import { applyAction, newGame, observe, type Observation } from "./engine";
import { seeded } from "../../benchmarks/harness";

function finalBid(scores: [number, number] = [0, 0]): Observation {
   return {
      ...observe(newGame("hardest", "Test", seeded(79))),
      phase: "bidding2",
      seat: 3,
      dealer: 3,
      scores,
      hand: ["Js", "Jc", "As", "Ks", "Ah"],
      counts: [5, 5, 5, 5],
      upCard: "9c",
      trump: null,
      maker: null,
      alone: false,
      sittingOut: null,
      trick: [],
      completedTricks: [],
      tricks: [0, 0],
      knownDiscard: null,
      pickedUp: false,
   };
}

describe("Hardest match strategy", () => {
   it("values a clinching point exactly as much as four clinching points", () => {
      const o = finalBid([9, 9]);
      expect(matchValue(o, -1)).toBe(1);
      expect(matchValue(o, -4)).toBe(1);
      expect(matchValue(o, 1)).toBe(0);
      expect(matchValue(o, 2)).toBe(0);
      expect(matchEquity(5, 5)).toBeCloseTo(0.5, 12);
      expect(matchEquity(8, 3) + matchEquity(3, 8)).toBeCloseTo(1, 12);
   });

   it("keeps its partner when one guaranteed making hand wins the match", () => {
      expect(chooseAction(finalBid([9, 9]), seeded(234))).toEqual({
         type: "call",
         suit: "s",
         alone: false,
      });
   });

   it("can pursue the same hand's four-point loner when the points still matter", () => {
      expect(chooseAction(finalBid(), seeded(234))).toEqual({
         type: "call",
         suit: "s",
         alone: true,
      });
   });

   it("infers only passes that actually precede the public call", () => {
      const o: Observation = {
         ...finalBid(),
         phase: "playing",
         seat: 0,
         trump: "c",
         maker: 2,
         pickedUp: true,
      };
      expect(publicAuction(o)).toEqual([
         { seat: 0, first: true },
         { seat: 1, first: true },
         { seat: 2, first: true, suit: "c", alone: false },
      ]);
      expect(publicAuction({ ...o, trump: "s", pickedUp: false })).toEqual([
         ...[0, 1, 2, 3].map((seat) => ({ seat, first: true })),
         { seat: 0, first: false },
         { seat: 1, first: false },
         { seat: 2, first: false, suit: "s", alone: false },
      ]);
   });

   it("leaves Medium, Hard, and Harder decisions unchanged", () => {
      const random = seeded(31337);
      let game = newGame("medium", "Test", random);
      let moves = 0;
      while (game.phase !== "round_complete" && moves++ < 40) {
         if (game.phase === "trick_complete") {
            game = applyAction(game, { type: "advance" });
            continue;
         }
         const o = observe(game);
         for (const difficulty of ["medium", "hard", "harder"] as const) {
            expect(
               chooseAction({ ...o, difficulty }, seeded(123 + moves))
            ).toEqual(
               beforeStrengthening({ ...o, difficulty }, seeded(123 + moves))
            );
         }
         game = applyAction(game, mediumAction(o), random);
      }
      expect(game.phase).toBe("round_complete");
   });
});
