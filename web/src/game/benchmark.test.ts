import { describe, expect, it } from "vitest";
import { mediumAction } from "./ai";
import { pair, summarize, type Bot } from "../../benchmarks/harness";

describe("Duplicate-deal benchmark", () => {
   it("reports zero advantage when identical bots swap teams", () => {
      const samples = [17, 35, 83, 99].map((seed) =>
         pair(seed, mediumAction, mediumAction)
      );
      for (const legs of samples) expect(legs[0].points).toBe(-legs[1].points);
      const report = summarize(samples);
      expect(report.pointMargin).toBe(0);
      expect(report.margin95).toEqual([0, 0]);
      expect(report.scoreShare).toBe(0.5);
      expect(report.share95).toEqual([0.5, 0.5]);
      expect(report.margin975).toEqual([0, 0]);
      expect(report.games).toBe(8);
   });
   it("keeps deals independent of bot random-number consumption", () => {
      const wasteful: Bot = (o, random) => {
         const action = mediumAction(o);
         for (let i = 0; i < 100; i++) random();
         return action;
      };
      expect(pair(71, wasteful, mediumAction).map((r) => r.points)).toEqual(
         pair(71, mediumAction, mediumAction).map((r) => r.points)
      );
   });
   it("can benchmark full matches with Medium partners", () => {
      const results = pair(31, mediumAction, mediumAction, mediumAction, true);
      expect(results[0].points).toBe(-results[1].points);
      expect(results.every((r) => r.won === 0 || r.won === 1)).toBe(true);
   });
});
