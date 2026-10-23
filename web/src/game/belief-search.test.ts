import { describe, expect, it } from "vitest";
import {
   auctionAfterPass,
   discardChoice,
   heuristicPlay,
   inferredVoids,
   mediumAction,
   observationActions,
   sampleHands,
} from "./ai";
import {
   beliefActionValue,
   hardestAction,
   matchValue,
   type HardestPolicies,
   type Particle,
} from "./hardest";
import {
   applyAction,
   effectiveSuit,
   legalActions,
   newGame,
   observe,
   suitOf,
   type Game,
   type Observation,
   type Seat,
} from "./engine";
import { seeded } from "../../benchmarks/harness";
import { settledScore } from "./endgame";

const policies: HardestPolicies = {
   actions: observationActions,
   basic: mediumAction,
   discard: discardChoice,
   quality: () => 2.65,
   sample: sampleHands,
   heuristic: heuristicPlay,
   auction: auctionAfterPass,
};

// Independent oracle: use real engine transitions. Optimize a SINGLE future
// action for all states with the same observation; the other seats play Medium.
// This differs from solving each hidden state separately and averaging optima.
function oracle(
   states: { game: Game; weight: number }[],
   root: Observation
): number {
   let result = 0;
   const groups = new Map<string, typeof states>();
   for (const state of states) {
      let game = state.game;
      if (game.phase === "trick_complete")
         game = applyAction(game, { type: "advance" });
      if (game.phase === "round_complete" || game.phase === "game_over") {
         const delta =
            game.scores[0] - root.scores[0] - (game.scores[1] - root.scores[1]);
         result += state.weight * matchValue(root, delta);
         continue;
      }
      const key = JSON.stringify([
         game.phase,
         game.turn,
         game.hands[root.seat],
         game.trick,
         game.completedTricks,
         game.tricks,
      ]);
      const group = groups.get(key) ?? [];
      group.push({ game, weight: state.weight });
      groups.set(key, group);
   }
   for (const group of groups.values()) {
      if (group[0].game.turn === root.seat) {
         result += Math.max(
            ...legalActions(group[0].game).map((action) =>
               oracle(
                  group.map(({ game, weight }) => ({
                     game: applyAction(game, action),
                     weight,
                  })),
                  root
               )
            )
         );
      } else {
         result += oracle(
            group.map(({ game, weight }) => ({
               game: applyAction(game, mediumAction(observe(game))),
               weight,
            })),
            root
         );
      }
   }
   return result;
}

function endgame(seed: number): Game {
   const random = seeded(seed);
   let game = newGame("medium", "Test", random);
   game = applyAction(game, {
      type: "call",
      suit: suitOf(game.upCard),
      alone: false,
   });
   while (
      game.completedTricks.length < 2 ||
      game.phase !== "playing" ||
      game.trick.length
   ) {
      game = applyAction(
         game,
         game.phase === "trick_complete"
            ? { type: "advance" }
            : mediumAction(observe(game)),
         random
      );
   }
   return game;
}

function alternative(game: Game): Game {
   const o = observe(game);
   const voids = inferredVoids(o);
   for (const seat of [0, 1, 2, 3] as Seat[]) {
      if (seat === o.seat) continue;
      for (const other of [0, 1, 2, 3] as Seat[]) {
         if (other === seat || other === o.seat) continue;
         for (const card of game.hands[seat])
            for (const swap of game.hands[other]) {
               if (
                  card === o.upCard ||
                  swap === o.upCard ||
                  voids[seat].has(effectiveSuit(swap, o.trump)) ||
                  voids[other].has(effectiveSuit(card, o.trump))
               )
                  continue;
               const copy = structuredClone(game);
               copy.hands[seat] = copy.hands[seat].map((value) =>
                  value === card ? swap : value
               );
               copy.hands[other] = copy.hands[other].map((value) =>
                  value === swap ? card : value
               );
               return copy;
            }
      }
   }
   throw new Error("No compatible hidden-hand swap in the test fixture.");
}

describe("Public-information endgame search", () => {
   it("skips sampling only when every legal continuation has the same score", () => {
      for (let seed = 1; seed <= 40; seed++) {
         let game = endgame(seed);
         while (
            game.completedTricks.length < 3 ||
            game.phase !== "playing" ||
            game.trick.length
         )
            game = applyAction(
               game,
               game.phase === "trick_complete"
                  ? { type: "advance" }
                  : mediumAction(observe(game))
            );
         const o = observe(game);
         const score = settledScore(o.maker!, o.alone, o.tricks);
         const actions = observationActions(o);
         if (score === null || actions.length < 2) continue;
         for (const action of actions)
            expect(
               oracle([{ game: applyAction(game, action), weight: 1 }], o)
            ).toBeCloseTo(matchValue(o, score), 12);
         expect(
            hardestAction(o, seeded(9), 384, {
               ...policies,
               sample: () => {
                  throw new Error("A settled hand needs no samples.");
               },
            })
         ).toEqual(actions[0]);
         return;
      }
      throw new Error("No settled two-choice hand found in the fixtures.");
   });
   it.each([1, 13, 99, 153, 54321])(
      "matches exhaustive information-set engine play, seed %s",
      (seed) => {
         const game = endgame(seed);
         const other = alternative(game);
         const o = observe(game);
         expect(observe(other)).toEqual(o);
         const particles: Particle[] = [game, other]
            .flatMap((state) =>
               Array.from({ length: 12 }, () => ({
                  hands: state.hands,
                  styles: ["basic", "basic", "basic", "basic"] as const,
                  weight: 1 / 24,
               }))
            )
            .map((particle) => ({ ...particle, styles: [...particle.styles] }));
         const before = structuredClone(particles);
         for (const action of observationActions(o)) {
            const expected = oracle(
               [game, other].map((state) => ({
                  game: applyAction(state, action),
                  weight: 0.5,
               })),
               o
            );
            expect(
               beliefActionValue(o, action, particles, policies)
            ).toBeCloseTo(expected, 10);
         }
         expect(particles).toEqual(before);
      }
   );

   it("shares the fixed hidden-deal budget across every root choice", () => {
      const o = observe(endgame(1));
      let samples = 0;
      hardestAction(o, seeded(7), 19, {
         ...policies,
         sample: (observation, random) => {
            samples++;
            return sampleHands(observation, random);
         },
      });
      expect(samples).toBe(19);
   });
});
