import { describe, expect, it } from "vitest";
import {
   ACHIEVEMENTS,
   HOLIDAY_IDS,
   calendarAchievements,
   computeAchievements,
   easterDate,
   settingsAchievements,
   type AchievementResult,
} from "./achievements";
import { gameAchievementEvidence } from "./achievementEvents";
import {
   newGame,
   type Card,
   type Game,
   type RoundResult,
   type Seat,
} from "@/game/engine";
import { writeStorage } from "./storage";

function result(
   id = "one",
   changes: Partial<AchievementResult> = {}
): AchievementResult {
   return {
      id,
      difficulty: "easy",
      won: true,
      conceded: false,
      scores: [10, 5],
      finishedAt: "2026-01-01T12:00:00Z",
      loners: 0,
      marches: 0,
      euchres: 0,
      ...changes,
   };
}
const earned = (results: AchievementResult[], extras: string[] = []) =>
   computeAchievements(results, extras)
      .filter((a) => a.earned)
      .map((a) => a.id);
function round(
   changes: Partial<RoundResult> = {},
   winners: Seat[] = [0, 0, 0, 2, 2],
   cards: Card[] = ["Js", "Jc", "As", "Ks", "9s"]
): RoundResult {
   return {
      hand: 1,
      maker: 0,
      trump: "s",
      alone: false,
      tricks: [5, 0],
      points: [2, 0],
      scores: [10, 0],
      upCard: "9c",
      completedTricks: winners.map((winner, i) => ({
         winner,
         plays: [
            { seat: 0, card: cards[i] },
            { seat: 1, card: "Ah" },
            { seat: 2, card: "Kh" },
            { seat: 3, card: "Qh" },
         ],
      })),
      ...changes,
   };
}
function evidence(
   rounds: RoundResult[],
   changes: Partial<Game> = {},
   seat: Seat = 0
) {
   return gameAchievementEvidence(
      {
         ...newGame(),
         phase: "game_over",
         scores: [10, 0],
         results: rounds,
         ...changes,
      },
      seat
   );
}

describe("Achievement catalog and progression", () => {
   it("contains the full catalog, all holidays, and five tiered tracks", () => {
      expect(ACHIEVEMENTS).toHaveLength(48);
      expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(48);
      expect(
         new Set(ACHIEVEMENTS.map((a) => `${a.icon.prefix}:${a.icon.iconName}`))
            .size
      ).toBe(48);
      expect(ACHIEVEMENTS.filter((a) => a.secret)).toHaveLength(40);
      expect(ACHIEVEMENTS.filter((a) => a.tiers)).toHaveLength(5);
      expect(
         HOLIDAY_IDS.every((id) =>
            ACHIEVEMENTS.some((a) => a.id === id && a.secret)
         )
      ).toBe(true);
   });
   for (const def of ACHIEVEMENTS.filter((a) => a.tiers)) {
      it(`checks every ${def.id} tier boundary`, () => {
         def.tiers!.forEach((step, index) => {
            for (const value of [step.target - 1, step.target]) {
               const results =
                  def.counter === "games" || def.counter === "wins"
                     ? Array.from({ length: value }, (_, i) =>
                          result(String(i))
                       )
                     : [result("one", { [def.counter!]: value })];
               const actual = computeAchievements(results).find(
                  (a) => a.id === def.id
               )!;
               expect(actual.tier).toBe(
                  value === step.target
                     ? ["bronze", "silver", "gold"][index]
                     : index
                     ? ["bronze", "silver"][index - 1]
                     : undefined
               );
               if (value === step.target) expect(actual.name).toBe(step.name);
            }
         });
      });
   }
   it("retains existing badges from legacy records and deduplicates server/local copies", () => {
      const legacy = result("one", {
         difficulty: "hardest",
         loners: 1,
         marches: 1,
         euchres: 1,
      });
      expect(earned([legacy, legacy])).toEqual(
         expect.arrayContaining([
            "newcomer",
            "first_light",
            "lone_star",
            "clean_sweep",
            "turn_tables",
            "stargazer",
         ])
      );
      expect(
         computeAchievements([legacy, legacy]).find(
            (a) => a.id === "written_in_stars"
         )?.earned
      ).toBe(false);
   });
   it("earns and retains a five-win streak, ignoring concessions and breaking on completed losses", () => {
      const games = Array.from({ length: 6 }, (_, i) =>
         result(String(i), { finishedAt: `2026-01-0${i + 1}T12:00:00Z` })
      );
      expect(earned([...games].reverse())).toContain("hot_streak");
      expect(
         earned(
            games.map((r, i) =>
               i === 2 ? { ...r, conceded: true, won: false } : r
            )
         )
      ).toContain("hot_streak");
      expect(
         earned(games.map((r, i) => (i === 2 ? { ...r, won: false } : r)))
      ).not.toContain("hot_streak");
      expect(
         earned([
            ...games,
            result("loss", { won: false, finishedAt: "2026-02-01T12:00:00Z" }),
         ])
      ).toContain("hot_streak");
   });
   it("excludes concessions from the first-game badge and games-finished tiers", () => {
      const concessions = Array.from({ length: 100 }, (_, i) =>
         result(`conceded-${i}`, { conceded: true, won: false })
      );
      expect(earned(concessions)).not.toContain("newcomer");
      expect(earned(concessions)).not.toContain("regular");
      const completed = Array.from({ length: 24 }, (_, i) =>
         result(`finished-${i}`, { won: false })
      );
      expect(earned([...completed, ...concessions])).toContain("newcomer");
      expect(earned([...completed, ...concessions])).not.toContain("regular");
      expect(
         earned([...completed, ...concessions, result("twenty-fifth")])
      ).toContain("regular");
   });
   it("collects suits and ten wins with a particular human partner", () => {
      const games = Array.from({ length: 10 }, (_, i) =>
         result(String(i), {
            difficulty: "multiplayer",
            achievementData: {
               unlocks: ["full_house"],
               calledSuits: [(["c", "d", "s", "h"] as const)[i % 4]],
               partnerKey: "same-human",
            },
         })
      );
      expect(earned(games)).toEqual(
         expect.arrayContaining([
            "well_suited",
            "dream_team",
            "full_house",
            "better_with_friends",
         ])
      );
      expect(earned(games.slice(0, 9))).not.toContain("dream_team");
      expect(
         earned(
            games.map((r, i) => ({
               ...r,
               achievementData: {
                  ...r.achievementData!,
                  partnerKey: String(i),
               },
            }))
         )
      ).not.toContain("dream_team");
   });
   it("keeps settings achievements scoped to their account", () => {
      writeStorage("euchre.achievement-settings.v1:alice", true);
      expect(settingsAchievements("alice")).toEqual(["geezer"]);
      expect(settingsAchievements("bob")).toEqual([]);
   });
});

describe("Local start dates and holidays", () => {
   it.each([
      ["01-01", "new_year"],
      ["02-14", "lonely_heart"],
      ["03-17", "lucky_clover"],
      ["04-05", "easter_egg"],
      ["07-04", "fireworks"],
      ["10-31", "spooky"],
      ["11-26", "thankful"],
      ["12-25", "christmas_spirit"],
   ])("unlocks %s and excludes an ordinary adjacent day", (day, id) => {
      const date = new Date(`2026-${day}T12:00:00Z`);
      expect(calendarAchievements(date.toISOString(), 0)).toContain(id);
      expect(
         calendarAchievements(
            new Date(date.getTime() + 86400000).toISOString(),
            0
         )
      ).not.toContain(id);
   });
   it("uses the local start date, including both sides of the date line", () => {
      expect(calendarAchievements("2026-10-31T06:59:00Z", 420)).not.toContain(
         "spooky"
      );
      expect(calendarAchievements("2026-10-31T07:00:00Z", 420)).toContain(
         "spooky"
      );
      expect(calendarAchievements("2026-12-31T10:00:00Z", -840)).toContain(
         "new_year"
      );
      expect(calendarAchievements(undefined, 0)).toEqual([]);
      expect(calendarAchievements("bad", 0)).toEqual([]);
      expect(calendarAchievements("2026-01-01T00:00:00Z", undefined)).toEqual(
         []
      );
   });
   it("computes movable Easter dates across years", () => {
      expect(easterDate(2025)).toEqual([4, 20]);
      expect(easterDate(2026)).toEqual([4, 5]);
      expect(easterDate(2027)).toEqual([3, 28]);
   });
   it.each([
      ["04:59", "night_owl"],
      ["05:00", "early_bird"],
      ["07:59", "early_bird"],
      ["08:00", null],
   ])("checks time boundary %s", (time, id) => {
      const flags = calendarAchievements(`2026-06-01T${time}:00Z`, 0);
      expect(
         flags.filter((f) => ["night_owl", "early_bird"].includes(f))
      ).toEqual(id ? [id] : []);
   });
   it("collects all holidays across years and excludes conceded games", () => {
      const days = [
         "01-01",
         "02-14",
         "03-17",
         "04-05",
         "07-04",
         "10-31",
         "11-26",
         "12-25",
      ];
      const games = days.map((d, i) =>
         result(String(i), {
            achievementData: {
               unlocks: [],
               calledSuits: [],
               startedAt: `2026-${d}T12:00:00Z`,
               utcOffsetMinutes: 0,
            },
         })
      );
      expect(earned(games)).toContain("all_year_round");
      expect(
         earned(games.map((r) => ({ ...r, conceded: true, won: false })))
      ).not.toContain("new_year");
   });
});

describe("Game and card evidence", () => {
   it("recognizes comebacks, the final euchre, fast games, and clean calling", () => {
      const rounds = [
         round({ maker: 1, tricks: [0, 5], scores: [0, 8] }),
         round({ maker: 1, tricks: [2, 3], scores: [4, 9] }),
         round({ maker: 1, tricks: [3, 2], scores: [10, 9] }),
      ];
      expect(evidence(rounds, { scores: [10, 9] }).unlocks).toEqual(
         expect.arrayContaining([
            "photo_finish",
            "back_from_brink",
            "nine_lives",
            "walk_off_euchre",
            "speed_demon",
            "untouchable",
         ])
      );
      expect(evidence([round({ tricks: [2, 3] })]).unlocks).not.toContain(
         "untouchable"
      );
      expect(evidence([]).unlocks).not.toContain("speed_demon");
      expect(
         evidence(Array.from({ length: 15 }, () => round())).unlocks
      ).toContain("marathon");
   });
   it("credits personal lone sweeps and never gives them to the sitting-out partner", () => {
      const rounds = Array.from({ length: 3 }, () =>
         round(
            { alone: true },
            [0, 0, 0, 0, 0],
            ["As", "Ks", "Qs", "10s", "9s"]
         )
      );
      expect(evidence(rounds).unlocks).toEqual(
         expect.arrayContaining([
            "double_feature",
            "hat_trick",
            "no_jack_required",
            "called_it",
         ])
      );
      expect(evidence(rounds, {}, 2).unlocks).not.toContain("double_feature");
      expect(
         evidence([round({ alone: true }, [0, 0, 0, 0, 0])]).unlocks
      ).not.toContain("no_jack_required");
   });
   it("recognizes successful second-round calls and partnership tricks", () => {
      expect(evidence([round()]).unlocks).toEqual(
         expect.arrayContaining([
            "jackpot",
            "shared_custody",
            "second_thoughts",
            "next_of_kin",
         ])
      );
      expect(evidence([round({ upCard: "9h" })]).unlocks).toContain(
         "change_of_heart"
      );
      expect(evidence([round({ upCard: "9s" })]).unlocks).not.toContain(
         "second_thoughts"
      );
      expect(
         evidence([round({ maker: 2 }, [0, 0, 0, 0, 0])]).unlocks
      ).toContain("carry_the_team");
      expect(
         evidence([round({ tricks: [3, 2] }, [2, 2, 2, 1, 3])]).unlocks
      ).toContain("trust_fall");
      expect(
         evidence([round({ tricks: [2, 3] }, [2, 2, 1, 1, 3])]).unlocks
      ).not.toContain("trust_fall");
   });
   it("recognizes stopping a loner, winning with low trump, and capturing the ace", () => {
      const r = round(
         { maker: 1, alone: true, tricks: [3, 2] },
         [0, 0, 0, 1, 1],
         ["9s", "Jc", "As", "Ks", "Qs"]
      );
      r.completedTricks![1].plays[1].card = "As";
      expect(evidence([r]).unlocks).toEqual(
         expect.arrayContaining([
            "party_pooper",
            "lone_wolf_hunter",
            "little_trump",
            "left_handed_compliment",
         ])
      );
      r.completedTricks![1].plays[1].seat = 2;
      expect(evidence([r]).unlocks).not.toContain("left_handed_compliment");
   });
   it("ignores unfinished and conceded games, and handles legacy rounds", () => {
      expect(evidence([round()], { phase: "playing" }).unlocks).toEqual([]);
      expect(evidence([round()], { conceded: true }).calledSuits).toEqual([]);
      const old = round();
      delete old.completedTricks;
      delete old.upCard;
      expect(evidence([old]).unlocks).not.toContain("jackpot");
   });
});
