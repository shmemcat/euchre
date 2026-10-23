import { describe, it, expect } from "vitest";
import {
   applyAction,
   BOT_NAMES,
   concede,
   DECK,
   effectiveSuit,
   isGame,
   legalActions,
   legalCards,
   newGame,
   nextActive,
   nextSeat,
   observe,
   partner,
   scoreHand,
   seatName,
   suitOf,
   trickWinner,
   type Card,
   type Game,
   type Seat,
   type Suit,
} from "./engine";
import {
   chooseAction,
   inferredVoids,
   observationActions,
   sampleHands,
   SIMULATIONS,
} from "./ai";
function rng(seed: number) {
   return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
   };
}
function makePlayGame(alone = false): Game {
   let game = newGame("medium", "You", rng(5));
   game = applyAction(game, { type: "call", suit: suitOf(game.upCard), alone });
   return applyAction(game, {
      type: "discard",
      card: game.hands[game.dealer][0],
   });
}
describe("Bicycle Euchre rules", () => {
   it("keeps three distinct Hearts bot names across hands", () => {
      let game = newGame("easy", "Emily", rng(12));
      const names = game.seatNames!;
      expect(names[0]).toBe("Emily");
      expect(new Set(names).size).toBe(4);
      expect(names.slice(1).every((name) =>
         BOT_NAMES.some((candidate) => candidate === name)
      )).toBe(true);
      expect(game.message).toContain(`${seatName(game, game.dealer)} deals.`);
      for (let i = 0; i < 8; i++) game = applyAction(game, { type: "pass" });
      game = applyAction(game, { type: "advance" }, rng(13));
      expect(game.seatNames).toEqual(names);
      expect(seatName({ ...game, playerName: "You" }, 0)).toBe("You");
   });

   it("deals all 24 cards once, five to each seat and four to the kitty", () => {
      const game = newGame("easy", "You", rng(12));
      expect(game.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
      expect(new Set([...game.hands.flat(), ...game.kitty])).toEqual(
         new Set(DECK)
      );
      expect(game.turn).toBe(nextSeat(game.dealer));
      expect(game.upCard).toBe(game.kitty[0]);
      expect(isGame(game)).toBe(true);
   });
   it.each(["c", "d", "h", "s"] as Suit[])(
      "treats the same-color jack as trump for %s",
      (trump) => {
         const opposite = { c: "s", s: "c", d: "h", h: "d" }[trump];
         expect(effectiveSuit(`J${opposite}` as Card, trump)).toBe(trump);
      }
   );
   it("requires the left bower when following trump, and excludes it from its printed suit", () => {
      expect(
         legalCards(["Jc", "Ac", "9h"], [{ seat: 1, card: "As" }], "s")
      ).toEqual(["Jc"]);
      expect(
         legalCards(["Jc", "Ac", "9h"], [{ seat: 1, card: "9c" }], "s")
      ).toEqual(["Ac"]);
      expect(legalCards(["Jc", "Ah"], [{ seat: 1, card: "9c" }], "s")).toEqual([
         "Jc",
         "Ah",
      ]);
   });
   it("ranks right bower above left bower, left above ace, and trump above the led ace", () => {
      expect(
         trickWinner(
            [
               { seat: 0, card: "As" },
               { seat: 1, card: "Jc" },
               { seat: 2, card: "Js" },
               { seat: 3, card: "Ks" },
            ],
            "s"
         )
      ).toBe(2);
      expect(
         trickWinner(
            [
               { seat: 0, card: "Ah" },
               { seat: 1, card: "9s" },
               { seat: 2, card: "Kh" },
               { seat: 3, card: "Ad" },
            ],
            "s"
         )
      ).toBe(1);
      expect(
         trickWinner(
            [
               { seat: 0, card: "9h" },
               { seat: 1, card: "As" },
               { seat: 2, card: "Kh" },
               { seat: 3, card: "Qh" },
            ],
            "d"
         )
      ).toBe(2);
   });
   it("opens a second bidding round and forbids the rejected suit", () => {
      let game = newGame("easy", "You", rng(3));
      for (let i = 0; i < 4; i++) game = applyAction(game, { type: "pass" });
      expect(game.phase).toBe("bidding2");
      expect(game.turn).toBe(nextSeat(game.dealer));
      expect(() =>
         applyAction(game, {
            type: "call",
            suit: suitOf(game.upCard),
            alone: false,
         })
      ).toThrow();
   });
   it.each([0, 1, 2, 3] as Seat[])(
      "gives dealer %i one redeal, then passes the deal clockwise, without scoring",
      (dealer) => {
         const random = rng(3);
         let game = newGame("easy", "You", random);
         game = { ...game, dealer, turn: nextSeat(dealer), scores: [3, 5] };
         for (let hand = 0; hand < 4; hand++) {
            const before = structuredClone(game);
            for (let i = 0; i < 8; i++)
               game = applyAction(game, { type: "pass" }, random);
            expect(game.phase).toBe("round_complete");
            expect(game.message).toBe(
               hand % 2 ? "No calls — Pass" : "No calls — Re-deal"
            );
            expect(game.dealer).toBe(before.dealer);
            expect(game.handNumber).toBe(before.handNumber);
            expect(game.hands).toEqual(before.hands);
            expect(game.scores).toEqual([3, 5]);
            expect(game.results).toEqual([]);
            expect(legalActions(game)).toEqual([{ type: "advance" }]);
            expect(isGame(game)).toBe(true);
            const summary = game;
            game = applyAction(game, { type: "advance" }, random);
            expect(game.phase).toBe("bidding1");
            expect(game.dealer).toBe(
               hand % 2 ? nextSeat(before.dealer) : before.dealer
            );
            expect(game.turn).toBe(nextSeat(game.dealer));
            expect(game.consecutivePassOuts).toBe(hand % 2 ? 0 : 1);
            expect(game.handNumber).toBe(before.handNumber + 1);
            expect(game.id).toBe(before.id);
            expect(game.scores).toEqual(before.scores);
            expect(game.results).toEqual(before.results);
            expect(game.hands).not.toEqual(before.hands);
            expect(game.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
            expect(isGame(game)).toBe(true);
            expect(summary.hands).toEqual(before.hands);
         }
      }
   );
   it.each([
      [1, false],
      [1, true],
      [2, false],
      [2, true],
   ] as const)(
      "resets the pass-out count after a round %i call, alone=%s",
      (round, alone) => {
         let game = newGame("easy", "You", rng(3));
         for (let i = 0; i < 8; i++) game = applyAction(game, { type: "pass" });
         game = applyAction(game, { type: "advance" });
         const dealer = game.dealer;
         if (round === 2)
            for (let i = 0; i < 4; i++)
               game = applyAction(game, { type: "pass" });
         game = applyAction(
            game,
            legalActions(game).find(
               (a) => a.type === "call" && a.alone === alone
            )!
         );
         expect(game.consecutivePassOuts).toBe(0);
         while (game.phase !== "round_complete")
            game = applyAction(game, legalActions(game)[0]);
         game = applyAction(game, { type: "advance" });
         expect(game.dealer).toBe(nextSeat(dealer));
         for (let i = 0; i < 8; i++) game = applyAction(game, { type: "pass" });
         expect(game.message).toBe("No calls — Re-deal");
         game = applyAction(game, { type: "advance" });
         expect(game.dealer).toBe(nextSeat(dealer));
         expect(isGame(game)).toBe(true);
      }
   );
   it("makes the dealer take the upcard and discard before play", () => {
      let game = newGame("easy", "You", rng(11));
      const original = structuredClone(game);
      game = applyAction(game, {
         type: "call",
         suit: suitOf(game.upCard),
         alone: false,
      });
      expect(game.phase).toBe("discard");
      expect(game.turn).toBe(game.dealer);
      expect(game.hands[game.dealer]).toHaveLength(6);
      expect(game.hands[game.dealer]).toContain(game.upCard);
      expect(isGame(game)).toBe(true);
      game = applyAction(game, {
         type: "discard",
         card: game.hands[game.dealer][0],
      });
      expect(game.phase).toBe("playing");
      expect(game.turn).toBe(nextSeat(game.dealer));
      expect(game.hands[game.dealer]).toHaveLength(5);
      expect(original.hands[original.dealer]).toHaveLength(5);
      expect(isGame(game)).toBe(true);
   });
   it("skips the lone maker's partner, including on opening lead", () => {
      const game = makePlayGame(true);
      expect(game.sittingOut).toBe(partner(game.maker!));
      expect(game.turn).toBe(nextActive(game.dealer, game.sittingOut));
      let current = game;
      for (let i = 0; i < 3; i++) {
         expect(current.turn).not.toBe(current.sittingOut);
         current = applyAction(current, legalActions(current)[0]);
      }
      expect(current.phase).toBe("trick_complete");
      expect(current.trick).toHaveLength(3);
      expect(isGame(current)).toBe(true);
   });
   it("lets a second-round maker call alone without a dealer pickup", () => {
      let game = newGame("easy", "You", rng(8));
      for (let i = 0; i < 4; i++) game = applyAction(game, { type: "pass" });
      const action = legalActions(game).find(
         (a) => a.type === "call" && a.alone
      )!;
      game = applyAction(game, action);
      expect(game.phase).toBe("playing");
      expect(game.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
      expect(isGame(game)).toBe(true);
   });
   it.each([
      [3, false, 1],
      [4, false, 1],
      [5, false, 2],
      [3, true, 1],
      [4, true, 1],
      [5, true, 4],
   ] as const)(
      "scores %i maker tricks, alone=%s, as %i",
      (tricks, alone, points) => {
         expect(scoreHand(0, tricks, alone)).toEqual([points, 0]);
         expect(scoreHand(1, tricks, alone)).toEqual([0, points]);
      }
   );
   it.each([0, 1, 2])("awards defenders two for %i maker tricks", (tricks) => {
      expect(scoreHand(0, tricks, true)).toEqual([0, 2]);
      expect(scoreHand(1, tricks, false)).toEqual([2, 0]);
   });
   it("rejects playing out of phase or playing a card not in the hand", () => {
      expect(() =>
         applyAction(newGame(), { type: "play", card: "As" })
      ).toThrow();
      const game = makePlayGame();
      const missing = DECK.find((c) => !game.hands[game.turn].includes(c))!;
      expect(() =>
         applyAction(game, { type: "play", card: missing })
      ).toThrow();
   });
   it("accepts semantically valid actions regardless of property order", () => {
      const game = newGame();
      expect(
         applyAction(game, {
            alone: false,
            suit: suitOf(game.upCard),
            type: "call",
         }).phase
      ).toBe("discard");
   });
   it("allows a conceded game to be restored before bidding and during a partial trick", () => {
      expect(isGame(concede(newGame()))).toBe(true);
      let game = makePlayGame();
      game = applyAction(game, legalActions(game)[0]);
      expect(isGame(concede(game))).toBe(true);
   });
   it("rejects corrupted, duplicate, and incomplete persisted games", () => {
      expect(isGame(null)).toBe(false);
      expect(isGame({ version: 1 })).toBe(false);
      const game = newGame();
      game.hands[0][0] = game.hands[0][1];
      expect(isGame(game)).toBe(false);
   });
   it("completes seeded games with valid states, legal moves, and a winner at ten", () => {
      for (let seed = 1; seed <= 12; seed++) {
         const random = rng(seed);
         let game = newGame(seed % 2 ? "easy" : "medium", "You", random);
         let moves = 0;
         while (game.phase !== "game_over" && moves++ < 3000) {
            expect(isGame(game), `seed ${seed}, ${game.phase}`).toBe(true);
            game = applyAction(
               game,
               ["trick_complete", "round_complete"].includes(game.phase)
                  ? { type: "advance" }
                  : chooseAction(observe(game), random),
               random
            );
         }
         expect(game.phase).toBe("game_over");
         expect(game.scores.some((s) => s >= 10)).toBe(true);
         expect(isGame(game)).toBe(true);
      }
   });
});

describe("Bots and hidden information", () => {
   it("provides three distinct increasing simulation budgets", () => {
      expect(SIMULATIONS.hard).toBeLessThan(SIMULATIONS.harder);
      expect(SIMULATIONS.harder).toBeLessThan(SIMULATIONS.hardest);
   });
   it("never exposes the actual other hands or the kitty to bots", () => {
      const game = makePlayGame();
      const o = observe(game);
      expect(o).not.toHaveProperty("hands");
      expect(o).not.toHaveProperty("kitty");
      expect(o.hand).toEqual(game.hands[game.turn]);
   });
   it("infers voids from off-suit play using effective suits", () => {
      const o = observe(makePlayGame());
      o.trump = "s";
      o.trick = [
         { seat: 0, card: "Jc" },
         { seat: 1, card: "Ah" },
      ];
      expect(inferredVoids(o)[1].has("s")).toBe(true);
      expect(inferredVoids(o)[1].has("c")).toBe(false);
   });
   it("samples hands with the right counts, unique cards, and public voids", () => {
      let game = makePlayGame();
      const random = rng(91);
      for (let i = 0; i < 8; i++) {
         if (game.phase === "trick_complete")
            game = applyAction(game, { type: "advance" });
         else game = applyAction(game, chooseAction(observe(game), random));
      }
      const o = observe(game);
      const voids = inferredVoids(o);
      for (let i = 0; i < 20; i++) {
         const sampled = sampleHands(o, random)!;
         expect(sampled).not.toBeNull();
         expect(sampled.map((h) => h.length)).toEqual(o.counts);
         expect(new Set(sampled.flat()).size).toBe(sampled.flat().length);
         sampled.forEach((hand, s) =>
            hand.forEach((c) => {
               expect(voids[s].has(effectiveSuit(c, o.trump))).toBe(false);
            })
         );
         expect(sampled[o.seat]).toEqual(o.hand);
      }
   });
   it.each(["hard", "harder", "hardest"] as const)(
      "makes legal Monte Carlo bids, discards, and plays on %s",
      (difficulty) => {
         const random = rng(22);
         let game = newGame(difficulty, "You", random);
         let o = observe(game);
         expect(observationActions(o)).toContainEqual(chooseAction(o, random));
         game = applyAction(game, {
            type: "call",
            suit: suitOf(game.upCard),
            alone: false,
         });
         o = observe(game);
         const discard = chooseAction(o, random);
         expect(observationActions(o)).toContainEqual(discard);
         game = applyAction(game, discard);
         o = observe(game);
         expect(observationActions(o)).toContainEqual(chooseAction(o, random));
      }
   );
});
