import { describe, expect, it } from "vitest";
import { chooseAction, mediumAction } from "./ai";
import { newGame, observe, type Observation } from "./engine";
import { seeded } from "../../benchmarks/harness";

const random = (...values: number[]) => {
   let index = 0;
   return () => values[Math.min(index++, values.length - 1)];
};
function playing(): Observation {
   return {
      ...observe(newGame("easy", "Test", seeded(1))),
      phase: "playing",
      seat: 2,
      hand: ["Js", "9s", "Ah", "10h", "Kd"],
      trump: "s",
      maker: 0,
      alone: false,
      sittingOut: null,
      trick: [
         { seat: 0, card: "Jc" },
         { seat: 1, card: "As" },
      ],
      counts: [4, 4, 5, 5],
   };
}

describe("Easy's beginner-friendly card play", () => {
   it("can preserve the right bower when its partner already holds the trick", () => {
      const o = playing();
      const before = structuredClone(o);
      expect(chooseAction(o, random(0))).toEqual({ type: "play", card: "9s" });
      expect(o).toEqual(before);
   });

   it("still sometimes spends a valuable winner unnecessarily", () => {
      expect(chooseAction(playing(), random(0.999, 0))).toEqual({
         type: "play",
         card: "Js",
      });
   });

   it("can discard a weak plain card, while retaining occasional beginner discards", () => {
      const o: Observation = {
         ...playing(),
         phase: "discard",
         seat: 0,
         dealer: 0,
         hand: ["Js", "Jc", "As", "Ac", "9h", "Kh"],
         trick: [],
      };
      expect(chooseAction(o, random(0))).toEqual({
         type: "discard",
         card: "9h",
      });
      expect(chooseAction(o, random(0.999, 0))).toEqual({
         type: "discard",
         card: "Js",
      });
   });

   it("keeps normal calls instead of attempting Medium's strong lone hand", () => {
      const o: Observation = {
         ...playing(),
         phase: "bidding1",
         seat: 0,
         dealer: 0,
         hand: ["Js", "Jc", "As", "Ks", "Qs"],
         upCard: "9s",
         trump: null,
         maker: null,
         trick: [],
      };
      expect(mediumAction(o)).toEqual({ type: "call", suit: "s", alone: true });
      expect(chooseAction(o, random(0))).toEqual({
         type: "call",
         suit: "s",
         alone: false,
      });
   });

   it("retains occasional loose calls and passes with a weak hand", () => {
      const o: Observation = {
         ...playing(),
         phase: "bidding1",
         seat: 0,
         dealer: 3,
         hand: ["9c", "10c", "Qd", "9h", "10h"],
         upCard: "As",
         trump: null,
         maker: null,
         trick: [],
      };
      expect(chooseAction(o, random(0.05, 0))).toEqual({
         type: "call",
         suit: "s",
         alone: false,
      });
      expect(chooseAction(o, random(0.99))).toEqual({ type: "pass" });
   });
});
