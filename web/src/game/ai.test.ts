import { describe, expect, it } from "vitest";
import {
   auctionAfterPass,
   chooseAction,
   evaluateSample,
   SWITCH_MARGIN,
} from "./ai";
import {
   DECK,
   applyAction,
   newGame,
   observe,
   suitOf,
   type Card,
   type Observation,
} from "./engine";
import { strategicPlay, recordPlay, type PlayKnowledge } from "./play-policy";
import { seeded } from "../../benchmarks/harness";

function knowledge(hand: Card[], unknown: Card[]): PlayKnowledge {
   return {
      seen: new Set(
         DECK.filter((c) => !hand.includes(c) && !unknown.includes(c))
      ),
      voids: [new Set(), new Set(), new Set(), new Set()],
      counts: [5, 5, 5, 5],
   };
}

describe("Public-information simulated play", () => {
   it("covers a vulnerable partner when the last opponent can beat it", () => {
      const hand: Card[] = ["Ah", "10h"];
      const k = knowledge(hand, ["Kh", "Jh", "9c", "10c", "Qc"]);
      k.voids[3].add("s");
      expect(
         strategicPlay(
            hand,
            [
               { seat: 0, card: "Qh" },
               { seat: 1, card: "9h" },
            ],
            "s",
            2,
            0,
            null,
            k
         )
      ).toBe("Ah");
   });
   it("saves the right bower when partner's left bower is secure", () => {
      const hand: Card[] = ["Js", "9s", "Ah"];
      const k = knowledge(hand, ["Ks", "Qs", "10s", "Kh", "Qh"]);
      expect(
         strategicPlay(
            hand,
            [
               { seat: 0, card: "Jc" },
               { seat: 1, card: "As" },
            ],
            "s",
            2,
            0,
            null,
            k
         )
      ).toBe("9s");
   });
   it("cashes an established king instead of drawing trump after opposing trump is gone", () => {
      const hand: Card[] = ["Js", "Ks", "Kc", "9h"];
      const k = knowledge(hand, [
         "Qc",
         "10c",
         "9c",
         "Kh",
         "Qh",
         "Jh",
         "10h",
         "Ad",
         "Kd",
      ]);
      expect(strategicPlay(hand, [], "s", 0, 0, null, k)).toBe("Kc");
   });
   it("draws outstanding trump when the maker has control", () => {
      const hand: Card[] = ["Js", "Ks", "Ac", "9h"];
      const k = knowledge(hand, ["Jc", "As", "9s", "Kh", "Qh", "Ad", "Kd"]);
      expect(strategicPlay(hand, [], "s", 0, 0, null, k)).toBe("Js");
   });
   it("updates public voids correctly for the left bower", () => {
      const k = knowledge([], DECK);
      recordPlay(k, [{ seat: 0, card: "Jc" }], { seat: 1, card: "Ah" }, "s");
      expect(k.voids[1]).toEqual(new Set(["s"]));
      expect(k.seen.has("Ah")).toBe(true);
      expect(k.counts[1]).toBe(4);
   });
});

const sampled: Card[][] = [
   ["As", "Ks", "Qs", "10s", "Js"],
   ["9h", "10h", "10c", "Qc", "9s"],
   ["Jh", "Jd", "Ah", "Kh", "Qh"],
   ["Ac", "Kc", "Jc", "9d", "Ad"],
];
function auction(): Observation {
   return {
      ...observe(newGame("hard", "Test", seeded(11))),
      phase: "bidding2",
      dealer: 3,
      seat: 0,
      upCard: "9c",
      hand: [...sampled[0]],
      counts: [5, 5, 5, 5],
      trump: null,
      maker: null,
      sittingOut: null,
      completedTricks: [],
      trick: [],
      tricks: [0, 0],
      pickedUp: false,
      knownDiscard: null,
   };
}
describe("Call versus pass", () => {
   it("values passing to a partner's loner above making its own profitable call", () => {
      const o = auction();
      expect(auctionAfterPass(o, sampled)).toEqual({
         seat: 2,
         phase: "bidding2",
         action: { type: "call", suit: "h", alone: true },
      });
      expect(evaluateSample(o, { type: "pass" }, sampled)).toBe(4);
      expect(
         evaluateSample(o, { type: "call", suit: "s", alone: false }, sampled)
      ).toBeGreaterThan(0);
      expect(
         evaluateSample(o, { type: "call", suit: "s", alone: false }, sampled)
      ).toBeLessThan(4);
   });
   it("continues into the second round after the dealer turns down the upcard", () => {
      const o = {
         ...auction(),
         phase: "bidding1" as const,
         seat: 3 as const,
         hand: sampled[3],
      };
      expect(auctionAfterPass(o, sampled)).toEqual({
         seat: 0,
         phase: "bidding2",
         action: { type: "call", suit: "s", alone: true },
      });
   });
   it("ends the auction for zero points after the eighth pass", () => {
      const o = { ...auction(), seat: 3 as const, hand: sampled[3] };
      expect(auctionAfterPass(o, sampled)).toBeNull();
      expect(evaluateSample(o, { type: "pass" }, sampled)).toBe(0);
   });
   it("counts an opponent's successful call against the passing side", () => {
      const o = { ...auction(), seat: 1 as const, hand: sampled[1] };
      expect(evaluateSample(o, { type: "pass" }, sampled)).toBe(-4);
   });
   it("lets the original passer call another suit when round two comes back", () => {
      const hands: Card[][] = [
         ["Jd", "Jh", "Ad", "Kd", "Qd"],
         ["Js", "9d", "10d", "10c", "9h"],
         ["10h", "Qh", "Kh", "Ah", "Qc"],
         ["9s", "10s", "Qs", "Ks", "As"],
      ];
      const o = { ...auction(), phase: "bidding1" as const, hand: hands[0] };
      expect(auctionAfterPass(o, hands)).toEqual({
         seat: 0,
         phase: "bidding2",
         action: { type: "call", suit: "d", alone: true },
      });
   });
   it("can follow a first-round pass with an order-up and dealer discard", () => {
      const o = {
         ...auction(),
         phase: "bidding1" as const,
         upCard: "9h" as const,
      };
      const hands = sampled.map((h) => [...h]);
      hands[1] = ["9c", "10h", "10c", "Qc", "9s"];
      expect(auctionAfterPass(o, hands)?.phase).toBe("bidding1");
      const before = structuredClone(hands);
      expect(evaluateSample(o, { type: "pass" }, hands)).toBe(4);
      expect(hands).toEqual(before);
   });
   it("keeps progressively smaller margins between Medium and each search setting", () => {
      expect(SWITCH_MARGIN.hard).toBeGreaterThan(SWITCH_MARGIN.harder);
      expect(SWITCH_MARGIN.harder).toBeGreaterThan(SWITCH_MARGIN.hardest);
   });
   it.each(["hard", "harder", "hardest"] as const)(
      "plays complete seeded hands legally on %s",
      (difficulty) => {
         const random = seeded(87);
         let game = newGame(difficulty, "Test", random);
         game = applyAction(game, {
            type: "call",
            suit: suitOf(game.upCard),
            alone: true,
         });
         while (game.phase !== "round_complete") {
            game = applyAction(
               game,
               game.phase === "trick_complete"
                  ? { type: "advance" }
                  : chooseAction(observe(game), random),
               random
            );
         }
         expect(game.completedTricks).toHaveLength(5);
      }
   );
});
