import {
   faCardsBlank,
   faTrophy,
   faCalendarCheck,
   faStars,
   faMoon,
   faCrown,
   faShield,
   faTelescope,
   faCircle0,
   faFlagCheckered,
   faArrowTrendUp,
   faCat,
   faFlag,
   faBoltLightning,
   faStopwatch,
   faShieldCheck,
   faClone,
   faHatWizard,
   faBan,
   faPeopleCarryBox,
   faHandsHoldingHeart,
   faPartyHorn,
   faCrosshairs,
   faScaleBalanced,
   faSlotMachine,
   faSeedling,
   faHandPointLeft,
   faRotateLeft,
   faLink,
   faHeartCircleBolt,
   faPalette,
   faBullhorn,
   faUserGroup,
   faHandshake,
   faHouse,
   faFire,
   faSunBright,
   faOwl,
   faVolumeXmark,
   faCalendarDays,
   faChampagneGlasses,
   faCalendarHeart,
   faClover,
   faEgg,
   faSparkles,
   faGhost,
   faTurkey,
   faGift,
} from "@fortawesome/pro-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { StoredResult } from "./persistence";
import { readResults } from "./persistence";
import { readStorage, writeStorage } from "./storage";
import { accountApiBase, createAccountClient } from "./account";
import { gameApiBase } from "./gameApi";

export type AchievementResult = Omit<StoredResult, "difficulty"> & {
   difficulty: StoredResult["difficulty"] | "multiplayer";
};
export type Tier = "bronze" | "silver" | "gold";
type Step = { name: string; target: number };
export type AchievementDef = {
   id: string;
   name: string;
   description: string;
   flavorText?: string;
   icon: IconDefinition;
   secret: boolean;
   tiers?: [Step, Step, Step];
   counter?: "games" | "wins" | "loners" | "marches" | "euchres";
};
export type ComputedAchievement = AchievementDef & {
   earned: boolean;
   tier?: Tier;
   progress?: string;
   unlockId: string;
};
const secret = (
   id: string,
   name: string,
   description: string,
   icon: IconDefinition
): AchievementDef => ({ id, name, description, icon, secret: true });
export const HOLIDAY_IDS = [
   "new_year",
   "lonely_heart",
   "lucky_clover",
   "easter_egg",
   "fireworks",
   "spooky",
   "thankful",
   "christmas_spirit",
];
export const ACHIEVEMENTS: AchievementDef[] = [
   {
      id: "newcomer",
      name: "Newcomer",
      description: "Finish your first game",
      icon: faCardsBlank,
      secret: false,
   },
   {
      id: "first_light",
      name: "First Light",
      description: "Win your first game",
      icon: faTrophy,
      secret: false,
   },
   {
      id: "regular",
      name: "Regular",
      description: "Finish games",
      icon: faCalendarCheck,
      secret: false,
      counter: "games",
      tiers: [
         { name: "Regular", target: 25 },
         { name: "Devoted", target: 100 },
         { name: "Permanent Fixture", target: 500 },
      ],
   },
   {
      id: "written_in_stars",
      name: "Written in the Stars",
      description: "Win games",
      icon: faStars,
      secret: false,
      counter: "wins",
      tiers: [
         { name: "Written in the Stars", target: 10 },
         { name: "Constellation", target: 50 },
         { name: "Galaxy", target: 200 },
      ],
   },
   {
      id: "lone_star",
      name: "Lone Star",
      description: "Personally sweep hands going alone",
      icon: faMoon,
      secret: false,
      counter: "loners",
      tiers: [
         { name: "Lone Star", target: 1 },
         { name: "Supernova", target: 10 },
         { name: "Galactic Legend", target: 50 },
      ],
   },
   {
      id: "clean_sweep",
      name: "A Clean Sweep",
      description: "March with your partner",
      icon: faCrown,
      secret: false,
      counter: "marches",
      tiers: [
         { name: "A Clean Sweep", target: 1 },
         { name: "Grand Marshal", target: 25 },
         { name: "Unstoppable", target: 100 },
      ],
   },
   {
      id: "turn_tables",
      name: "Turn the Tables",
      description: "Euchre the opposing team",
      icon: faShield,
      secret: false,
      counter: "euchres",
      tiers: [
         { name: "Turn the Tables", target: 1 },
         { name: "Gatekeeper", target: 25 },
         { name: "Fortress", target: 100 },
      ],
   },
   {
      id: "stargazer",
      name: "Stargazer",
      description: "Win on Hardest",
      icon: faTelescope,
      secret: false,
   },
   secret(
      "skunk_works",
      "Skunk Works",
      "Win while the opposing team has zero points",
      faCircle0
   ),
   secret("photo_finish", "Photo Finish", "Win 10–9", faFlagCheckered),
   secret(
      "back_from_brink",
      "Back from the Brink",
      "Win after trailing 0–8 or 0–9",
      faArrowTrendUp
   ),
   secret(
      "nine_lives",
      "Nine Lives",
      "Win after opponents reach nine while your team has five or fewer",
      faCat
   ),
   secret(
      "walk_off_euchre",
      "Walk-Off Euchre",
      "Win the game by euchring the opponents",
      faFlag
   ),
   secret(
      "speed_demon",
      "Speed Demon",
      "Win in four scoring hands or fewer",
      faBoltLightning
   ),
   secret(
      "marathon",
      "Marathon",
      "Finish a game lasting at least 15 scoring hands",
      faStopwatch
   ),
   secret(
      "untouchable",
      "Untouchable",
      "Win without your team being euchred once",
      faShieldCheck
   ),
   secret(
      "double_feature",
      "Double Feature",
      "Personally sweep alone twice in one game",
      faClone
   ),
   secret(
      "hat_trick",
      "Hat Trick",
      "Personally sweep alone three times in one game",
      faHatWizard
   ),
   secret(
      "no_jack_required",
      "No Jack Required",
      "Sweep alone without either bower in your hand",
      faBan
   ),
   secret(
      "carry_the_team",
      "Carry the Team",
      "Personally take all five tricks after your partner calls trump",
      faPeopleCarryBox
   ),
   secret(
      "trust_fall",
      "Trust Fall",
      "Call trump successfully while your partner takes every trick your team wins",
      faHandsHoldingHeart
   ),
   secret(
      "party_pooper",
      "Party Pooper",
      "Personally take a trick against an opponent going alone",
      faPartyHorn
   ),
   secret(
      "lone_wolf_hunter",
      "Lone Wolf Hunter",
      "Euchre an opponent who went alone",
      faCrosshairs
   ),
   secret(
      "shared_custody",
      "Shared Custody",
      "March with your partner, each taking at least two tricks",
      faScaleBalanced
   ),
   secret(
      "jackpot",
      "Jackpot",
      "Hold both bowers and win the hand as the caller",
      faSlotMachine
   ),
   secret(
      "little_trump",
      "The Little Trump That Could",
      "Win a trick with the nine of trump",
      faSeedling
   ),
   secret(
      "left_handed_compliment",
      "Left-Handed Compliment",
      "Capture an opponent’s ace of trump with the left bower",
      faHandPointLeft
   ),
   secret(
      "second_thoughts",
      "Second Thoughts",
      "Pass in the first bidding round, then call trump successfully in the second",
      faRotateLeft
   ),
   secret(
      "next_of_kin",
      "Next of Kin",
      "Successfully call the other suit of the same color as the turned-down card",
      faLink
   ),
   secret(
      "change_of_heart",
      "Change of Heart",
      "Successfully call a suit of the opposite color from the turned-down card",
      faHeartCircleBolt
   ),
   secret(
      "well_suited",
      "Well Suited",
      "Successfully call trump in all four suits across your games",
      faPalette
   ),
   secret(
      "called_it",
      "Called It",
      "Personally call trump at least three times in one game without being euchred on any call",
      faBullhorn
   ),
   secret(
      "better_with_friends",
      "Better with Friends",
      "Finish a multiplayer game",
      faUserGroup
   ),
   secret(
      "dream_team",
      "Dream Team",
      "Win ten multiplayer games with the same human partner",
      faHandshake
   ),
   secret(
      "full_house",
      "Full House",
      "Finish a game with four human players",
      faHouse
   ),
   secret("hot_streak", "Hot Streak", "Win five games in a row", faFire),
   secret(
      "early_bird",
      "Early Bird",
      "Finish a game that began between 5 and 8 a.m.",
      faSunBright
   ),
   secret(
      "night_owl",
      "Night Owl",
      "Finish a game that began between midnight and 5 a.m.",
      faOwl
   ),
   {
      ...secret("geezer", "Locked in", "Turn the music off", faVolumeXmark),
      flavorText: "Gotta turn the music down to see better",
   },
   secret(
      "all_year_round",
      "All Year Round",
      "Collect all eight holiday achievements across any number of years",
      faCalendarDays
   ),
   secret(
      "new_year",
      "Auld Lang Syne",
      "Play a game on New Year’s Day",
      faChampagneGlasses
   ),
   secret(
      "lonely_heart",
      "Lonely Heart",
      "Play a game on Valentine’s Day",
      faCalendarHeart
   ),
   secret(
      "lucky_clover",
      "Lucky Clover",
      "Play a game on St. Patrick’s Day",
      faClover
   ),
   secret("easter_egg", "Easter Egg", "Play a game on Easter", faEgg),
   secret(
      "fireworks",
      "Fireworks",
      "Play a game on the 4th of July",
      faSparkles
   ),
   secret("spooky", "Spooky", "Play a game on Halloween", faGhost),
   secret("thankful", "Thankful", "Play a game on Thanksgiving", faTurkey),
   secret(
      "christmas_spirit",
      "Christmas Spirit",
      "Play a game on Christmas",
      faGift
   ),
];

export function easterDate(year: number): [number, number] {
   const a = year % 19,
      b = Math.floor(year / 100),
      c = year % 100;
   const d = Math.floor(b / 4),
      e = b % 4,
      f = Math.floor((b + 8) / 25);
   const g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30;
   const i = Math.floor(c / 4),
      k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7;
   const m = Math.floor((a + 11 * h + 22 * l) / 451),
      n = h + l - 7 * m + 114;
   return [Math.floor(n / 31), (n % 31) + 1];
}

export function calendarAchievements(
   startedAt?: string,
   offset?: number
): string[] {
   if (
      !startedAt ||
      offset === undefined ||
      !Number.isInteger(offset) ||
      Math.abs(offset) > 840
   )
      return [];
   const date = new Date(Date.parse(startedAt) - offset * 60000);
   if (!Number.isFinite(date.getTime())) return [];
   const year = date.getUTCFullYear(),
      month = date.getUTCMonth() + 1,
      day = date.getUTCDate(),
      hour = date.getUTCHours();
   const [em, ed] = easterDate(year);
   const thanksgiving =
      1 + ((4 - new Date(Date.UTC(year, 10, 1)).getUTCDay() + 7) % 7) + 21;
   return [
      hour < 5 && "night_owl",
      hour >= 5 && hour < 8 && "early_bird",
      month === 1 && day === 1 && "new_year",
      month === 2 && day === 14 && "lonely_heart",
      month === 3 && day === 17 && "lucky_clover",
      month === em && day === ed && "easter_egg",
      month === 7 && day === 4 && "fireworks",
      month === 10 && day === 31 && "spooky",
      month === 11 && day === thanksgiving && "thankful",
      month === 12 && day === 25 && "christmas_spirit",
   ].filter((id): id is string => typeof id === "string");
}

export function computeAchievements(
   input: AchievementResult[],
   extras: string[] = []
): ComputedAchievement[] {
   const results = [...new Map(input.map((r) => [r.id, r])).values()].sort(
      (a, b) =>
         Date.parse(a.finishedAt) - Date.parse(b.finishedAt) ||
         a.id.localeCompare(b.id)
   );
   const unlocked = new Set(extras),
      suits = new Set<string>(),
      partners = new Map<string, number>();
   const counts = {
      games: results.filter((r) => !r.conceded).length,
      wins: 0,
      loners: 0,
      marches: 0,
      euchres: 0,
   };
   let streak = 0;
   for (const r of results) {
      counts.loners += r.loners;
      counts.marches += r.marches;
      counts.euchres += r.euchres;
      if (r.conceded) continue;
      if (r.won) {
         counts.wins++;
         streak++;
      } else streak = 0;
      if (streak >= 5) unlocked.add("hot_streak");
      if (r.won && r.difficulty === "hardest")
         unlocked.add("stargazer");
      if (r.won && r.scores[1] === 0) unlocked.add("skunk_works");
      if (r.won && r.scores[0] === 10 && r.scores[1] === 9)
         unlocked.add("photo_finish");
      for (const id of r.achievementData?.unlocks ?? []) unlocked.add(id);
      for (const suit of r.achievementData?.calledSuits ?? []) suits.add(suit);
      for (const id of calendarAchievements(
         r.achievementData?.startedAt,
         r.achievementData?.utcOffsetMinutes
      ))
         unlocked.add(id);
      if (r.difficulty === "multiplayer") {
         unlocked.add("better_with_friends");
         const key = r.achievementData?.partnerKey;
         if (r.won && key) partners.set(key, (partners.get(key) ?? 0) + 1);
      }
   }
   if (counts.games > 0) unlocked.add("newcomer");
   if (counts.wins > 0) unlocked.add("first_light");
   if (suits.size === 4) unlocked.add("well_suited");
   if ([...partners.values()].some((count) => count >= 10))
      unlocked.add("dream_team");
   if (HOLIDAY_IDS.every((id) => unlocked.has(id)))
      unlocked.add("all_year_round");
   return ACHIEVEMENTS.map((def) => {
      if (!def.tiers || !def.counter)
         return { ...def, earned: unlocked.has(def.id), unlockId: def.id };
      const count = counts[def.counter];
      const index = def.tiers.filter((step) => count >= step.target).length - 1;
      const step = def.tiers[Math.max(0, index)],
         next = def.tiers[Math.min(2, index + 1)];
      const tier =
         index >= 0
            ? (["bronze", "silver", "gold"] as Tier[])[index]
            : undefined;
      return {
         ...def,
         name: step.name,
         description: `${def.description}: ${step.target}`,
         earned: index >= 0,
         tier,
         progress:
            index < 2
               ? `${count} / ${next.target} · Next: ${next.name}`
               : `${count} · Gold`,
         unlockId: `${def.id}_${tier ?? "locked"}`,
      };
   });
}

const settingsKey = (userId: string) =>
   `euchre.achievement-settings.v1:${encodeURIComponent(userId)}`;
export const ACHIEVEMENT_EVENT = "euchre:achievements";
export function settingsAchievements(userId: string): string[] {
   return readStorage<unknown>(settingsKey(userId), false) === true
      ? ["geezer"]
      : [];
}
export function recordMusicOff(userId: string): void {
   writeStorage(settingsKey(userId), true);
   window.dispatchEvent(new Event(ACHIEVEMENT_EVENT));
   void syncMusicAchievement(userId).catch(() => {});
}
export async function syncMusicAchievement(userId: string): Promise<void> {
   const base = accountApiBase();
   if (!base || !settingsAchievements(userId).length) return;
   const session = await createAccountClient(base).session();
   if (session.user?.id !== userId) return;
   const response = await fetch(`${gameApiBase(base)}/achievements`, {
      method: "POST",
      credentials: "include",
      headers: {
         "Content-Type": "application/json",
         "X-CSRF-Token": session.csrf_token,
      },
      body: JSON.stringify({ id: "geezer" }),
   });
   if (!response.ok)
      throw new Error("Your music achievement could not be saved.");
}
export async function loadAchievements(
   userId: string,
   signal?: AbortSignal
): Promise<{ results: AchievementResult[]; unlocks: string[] }> {
   const base = accountApiBase();
   if (!base)
      return {
         results: readResults(userId),
         unlocks: settingsAchievements(userId),
      };
   const response = await fetch(`${gameApiBase(base)}/achievements`, {
      credentials: "include",
      cache: "no-store",
      signal,
   });
   const data = await response.json();
   if (
      !response.ok ||
      !Array.isArray(data.results) ||
      !Array.isArray(data.unlocks)
   )
      throw new Error("Your achievements couldn’t be loaded.");
   // Local results may be waiting for upload; server copies restore other devices.
   const results = [
      ...new Map(
         [...readResults(userId), ...data.results].map((r) => [r.id, r])
      ).values(),
   ] as AchievementResult[];
   return {
      results,
      unlocks: [...data.unlocks, ...settingsAchievements(userId)],
   };
}
