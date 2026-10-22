import { describe, it, expect } from "vitest";
import {
   orderedHypothesis,
   particleLikelihood,
   type Particle,
   type HardestPolicies,
} from "./hardest";
import {
   auctionAfterPass,
   discardChoice,
   heuristicPlay,
   mediumAction,
   observationActions,
   sampleHands,
} from "./ai";
import {
   applyAction,
   newGame,
   observe,
   suitOf,
   type Card,
   type Observation,
} from "./engine";
import { seeded } from "../../benchmarks/harness";

function fixture(): { o: Observation; hands: Card[][]; initial: Card[][] } {
   const hands: Card[][] = [
      ["Ac", "Kc", "10c", "9c", "Js"],
      ["Ad", "9d", "9s", "Qs"],
      ["Kd", "10s", "As", "Qc"],
      ["Kh", "Qd", "10d", "Ks"],
   ];
   const initial: Card[][] = [
      hands[0],
      ["Ah", ...hands[1]],
      ["Qh", ...hands[2]],
      ["10h", ...hands[3]],
   ];
   const o: Observation = {
      ...observe(newGame("hardest", "Test", seeded(1))),
      phase: "playing",
      seat: 0,
      dealer: 0,
      hand: hands[0],
      counts: hands.map((hand) => hand.length),
      trump: "c",
      maker: 0,
      alone: false,
      sittingOut: null,
      upCard: "Jd",
      pickedUp: false,
      knownDiscard: null,
      trick: [
         { seat: 1, card: "Ah" },
         { seat: 2, card: "Qh" },
         { seat: 3, card: "10h" },
      ],
      completedTricks: [],
      tricks: [0, 0],
      scores: [0, 0],
   };
   return { o, hands, initial };
}
const policies: HardestPolicies = {
   actions: observationActions,
   basic: mediumAction,
   sample: sampleHands,
   discard: discardChoice,
   heuristic: heuristicPlay,
   auction: auctionAfterPass,
   quality: () => 2.65,
};

describe("Latent private hand order", () => {
   it("preserves own order, every holding, and public ownership without mutating inputs", () => {
      const { o, hands } = fixture();
      const original = structuredClone({ o, hands });
      for (const seed of [1, 13, 99, 153]) {
         const result = orderedHypothesis(o, hands, seeded(seed));
         expect(result.hands[0]).toEqual(hands[0]);
         for (let seat = 0; seat < 4; seat++) {
            expect([...result.hands[seat]].sort()).toEqual(
               [...hands[seat]].sort()
            );
            const played = o.trick
               .filter((play) => play.seat === seat)
               .map((play) => play.card);
            expect([...result.initialHands[seat]].sort()).toEqual(
               [...hands[seat], ...played].sort()
            );
         }
      }
      expect({ o, hands }).toEqual(original);
   });

   it("uses original order to evaluate a first-ace lead, including an unplayed ace", () => {
      const { o, hands, initial } = fixture();
      const good: Particle = {
         hands,
         initialHands: initial,
         styles: ["basic", "basic", "basic", "basic"],
         weight: 1,
      };
      const bad = structuredClone(good);
      bad.initialHands![1] = ["Ad", "Ah", "9d", "9s", "Qs"];
      expect(heuristicPlay(initial[1], [], "c", 1, 0, null)).toBe("Ah");
      expect(heuristicPlay(bad.initialHands![1], [], "c", 1, 0, null)).toBe(
         "Ad"
      );
      expect(particleLikelihood(o, good, policies)).toBeGreaterThan(
         particleLikelihood(o, bad, policies)
      );
   });

   it("keeps a retained ordered-up card last in the hypothetical dealer order", () => {
      const random = seeded(42);
      let game = newGame("hardest", "Test", random);
      game = applyAction(game, {
         type: "call",
         suit: suitOf(game.upCard),
         alone: false,
      });
      game = applyAction(game, mediumAction(observe(game)));
      const o = observe(game);
      expect(game.hands[o.dealer]).toContain(o.upCard);
      const result = orderedHypothesis(o, game.hands, seeded(99));
      expect(result.initialHands[o.dealer].at(-1)).toBe(o.upCard);
      expect(result.hands[o.dealer].at(-1)).toBe(o.upCard);
      expect(result.hands[o.seat]).toEqual(o.hand);
   });
});
