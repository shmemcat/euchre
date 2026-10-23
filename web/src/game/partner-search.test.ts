import { describe, expect, it } from "vitest";
import {
   applyAction,
   legalActions,
   newGame,
   observe,
   suitOf,
   team,
   type Game,
   type Seat,
} from "./engine";
import { heuristicPlay, inferredVoids, mediumAction } from "./ai";
import { solvePartnerEndgame } from "./partner-search";
import { seeded } from "../../benchmarks/harness";
import { strategicPlay } from "./play-policy";

function knowledgeFrom(game: Game) {
   const o = observe(game);
   return {
      seen: new Set([
         ...o.completedTricks.flatMap((trick) =>
            trick.plays.map((play) => play.card)
         ),
         ...o.trick.map((play) => play.card),
      ]),
      counts: [...o.counts],
      voids: inferredVoids(o),
   };
}

function exhaustive(
   game: Game,
   modeledPartner: Seat,
   style: "basic" | "strategic"
): number {
   if (game.phase === "round_complete") return game.scores[0] - game.scores[1];
   const o = observe(game);
   const actions =
      game.phase === "playing" && game.turn === modeledPartner
         ? [
              style === "basic"
                 ? mediumAction(o)
                 : {
                      type: "play" as const,
                      card: strategicPlay(
                         o.hand,
                         o.trick,
                         o.trump!,
                         o.seat,
                         o.maker!,
                         o.sittingOut,
                         knowledgeFrom(game)
                      ),
                   },
           ]
         : legalActions(game);
   const values = actions.map((action) =>
      exhaustive(applyAction(game, action), modeledPartner, style)
   );
   return team(game.turn) === 0 ? Math.max(...values) : Math.min(...values);
}

describe("Tactical search with a public-information partner policy", () => {
   it.each([
      [false, "basic"],
      [false, "strategic"],
      [true, "basic"],
      [true, "strategic"],
   ] as const)(
      "matches exhaustive engine continuations, alone=%s, policy=%s",
      (alone, style) => {
         for (const seed of [1, 13, 99, 153, 54321, 789]) {
            const random = seeded(seed);
            let game = newGame("medium", "Test", random);
            game = applyAction(game, {
               type: "call",
               suit: suitOf(game.upCard),
               alone,
            });
            while (
               game.completedTricks.length <
                  (seed === 1 || seed === 13 ? 1 : 2) ||
               game.phase !== "playing" ||
               game.trick.length < (seed === 13 ? 2 : 0)
            )
               game = applyAction(
                  game,
                  game.phase === "trick_complete"
                     ? { type: "advance" }
                     : mediumAction(observe(game)),
                  random
               );
            const o = observe(game);
            const knowledge = knowledgeFrom(game);
            for (const seat of [0, 1, 2, 3] as Seat[]) {
               const before = structuredClone({ game, knowledge });
               expect(
                  solvePartnerEndgame(
                     game.hands,
                     o.trump!,
                     o.maker!,
                     o.alone,
                     o.seat,
                     o.trick,
                     o.tricks,
                     seat,
                     knowledge,
                     (hand, plays, publicKnowledge) =>
                        style === "basic"
                           ? heuristicPlay(
                                hand,
                                plays,
                                o.trump!,
                                seat,
                                o.maker!,
                                o.sittingOut
                             )
                           : strategicPlay(
                                hand,
                                plays,
                                o.trump!,
                                seat,
                                o.maker!,
                                o.sittingOut,
                                publicKnowledge
                             )
                  )
               ).toBe(exhaustive(game, seat, style));
               expect({ game, knowledge }).toEqual(before);
            }
         }
      },
      15000
   );
});
