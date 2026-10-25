import {
   sameColor,
   type Card,
   type Game,
   type Suit,
   type Seat,
} from "@/game/engine";

export type AchievementEvidence = {
   unlocks: string[];
   calledSuits: Suit[];
   startedAt?: string;
   utcOffsetMinutes?: number;
   partnerKey?: string;
};

/** Completed hands contain only cards already played publicly. */
export function gameAchievementEvidence(
   game: Game,
   seat: Seat = 0
): AchievementEvidence {
   const evidence: AchievementEvidence = {
      unlocks: [],
      calledSuits: [],
      startedAt: game.startedAt,
      utcOffsetMinutes: game.utcOffsetMinutes,
   };
   if (game.conceded || game.phase !== "game_over") return evidence;
   const unlocked = new Set<string>();
   const side = seat % 2,
      other = 1 - side,
      partner = (seat + 2) % 4;
   const rounds = game.results;
   const won = game.scores[side] >= 10;
   const calls = rounds.filter((r) => r.maker === seat);
   const loneSweeps = calls.filter(
      (r) => r.alone && r.tricks[side] === 5
   ).length;
   if (loneSweeps >= 2) unlocked.add("double_feature");
   if (loneSweeps >= 3) unlocked.add("hat_trick");
   if (calls.length >= 3 && calls.every((r) => r.tricks[side] >= 3))
      unlocked.add("called_it");
   evidence.calledSuits = [
      ...new Set(calls.filter((r) => r.tricks[side] >= 3).map((r) => r.trump)),
   ];
   if (won) {
      if (game.scores[other] === 0) unlocked.add("skunk_works");
      if (game.scores[side] === 10 && game.scores[other] === 9)
         unlocked.add("photo_finish");
      if (rounds.some((r) => r.scores[side] === 0 && r.scores[other] >= 8))
         unlocked.add("back_from_brink");
      if (rounds.some((r) => r.scores[side] <= 5 && r.scores[other] === 9))
         unlocked.add("nine_lives");
      const last = rounds[rounds.length - 1];
      if (last && last.maker % 2 === other && last.tricks[other] < 3)
         unlocked.add("walk_off_euchre");
      if (rounds.length > 0 && rounds.length <= 4) unlocked.add("speed_demon");
      if (
         rounds.length > 0 &&
         !rounds.some((r) => r.maker % 2 === side && r.tricks[side] < 3)
      )
         unlocked.add("untouchable");
   }
   if (rounds.length >= 15) unlocked.add("marathon");
   for (const r of rounds) {
      if (!r.completedTricks || r.completedTricks.length !== 5) continue;
      const tricks = r.completedTricks;
      const mine = tricks.filter((t) => t.winner === seat).length;
      const partners = tricks.filter((t) => t.winner === partner).length;
      const cards = tricks.flatMap((t) =>
         t.plays.filter((p) => p.seat === seat).map((p) => p.card)
      );
      const right = `J${r.trump}` as Card,
         left = `J${sameColor(r.trump)}` as Card;
      const made = r.tricks[side] >= 3;
      if (r.maker === seat && made) {
         if (cards.includes(right) && cards.includes(left))
            unlocked.add("jackpot");
         if (mine === 0 && partners === r.tricks[side])
            unlocked.add("trust_fall");
         if (r.upCard && r.upCard.slice(-1) !== r.trump) {
            unlocked.add("second_thoughts");
            unlocked.add(
               sameColor(r.upCard.slice(-1) as Suit) === r.trump
                  ? "next_of_kin"
                  : "change_of_heart"
            );
         }
         if (
            r.alone &&
            mine === 5 &&
            !cards.includes(right) &&
            !cards.includes(left)
         )
            unlocked.add("no_jack_required");
      }
      if (r.maker === partner && !r.alone && mine === 5)
         unlocked.add("carry_the_team");
      if (
         r.maker % 2 === side &&
         !r.alone &&
         r.tricks[side] === 5 &&
         mine >= 2 &&
         partners >= 2
      )
         unlocked.add("shared_custody");
      if (r.maker % 2 === other && r.alone) {
         if (mine > 0) unlocked.add("party_pooper");
         if (r.tricks[other] < 3) unlocked.add("lone_wolf_hunter");
      }
      for (const t of tricks.filter((t) => t.winner === seat)) {
         const winningCard = t.plays.find((p) => p.seat === seat)?.card;
         if (winningCard === `9${r.trump}`) unlocked.add("little_trump");
         if (
            winningCard === left &&
            t.plays.some(
               (p) => p.seat % 2 === other && p.card === `A${r.trump}`
            )
         )
            unlocked.add("left_handed_compliment");
      }
   }
   evidence.unlocks = [...unlocked].sort();
   return evidence;
}
