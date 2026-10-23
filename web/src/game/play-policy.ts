import {
   DECK,
   SUITS,
   effectiveSuit,
   legalCards,
   nextActive,
   strength,
   team,
   trickWinner,
   type Card,
   type Play,
   type Seat,
   type Suit,
} from "./engine";

export type PlayKnowledge = {
   seen: Set<Card>;
   voids: Set<Suit>[];
   counts: number[];
};

// This policy sees the acting player's hand and public facts only. In particular,
// a rollout must not pass its sampled opponents' hands as strategic knowledge.
export function strategicPlay(
   hand: Card[],
   trick: Play[],
   trump: Suit,
   seat: Seat,
   maker: Seat,
   sittingOut: Seat | null,
   knowledge: PlayKnowledge
): Card {
   const legal = legalCards(hand, trick, trump);
   if (legal.length === 1) return legal[0];
   const unseen = DECK.filter(
      (c) => !hand.includes(c) && !knowledge.seen.has(c)
   );
   const suit = (c: Card) => effectiveSuit(c, trump);
   const ranks: Record<Suit, number[]> = { c: [], d: [], s: [], h: [] };
   const lengths: Record<Suit, number> = { c: 0, d: 0, s: 0, h: 0 };
   for (const c of unseen) ranks[suit(c)].push(strength(c, trump));
   for (const c of hand) lengths[suit(c)]++;
   const poolSizes = knowledge.voids.map((voids) =>
      SUITS.reduce((sum, s) => sum + (voids.has(s) ? 0 : ranks[s].length), 0)
   );
   const master = (c: Card) =>
      !ranks[suit(c)].some((rank) => rank > strength(c, trump));
   const cost = (c: Card) => {
      const s = suit(c);
      const singleton = lengths[s] === 1;
      return s === trump
         ? 0.8 + strength(c, trump) / 35 + (master(c) ? 0.35 : 0)
         : strength(c, trump) / 12 +
              (master(c) ? 0.65 : 0) -
              (singleton ? 0.12 : 0);
   };
   // Hypergeometric P(no cards from a group), including the unobserved kitty.
   const avoid = (total: number, group: number, count: number) => {
      let p = 1;
      for (let i = 0; i < count; i++) {
         if (total - group - i <= 0) return 0;
         p *= (total - group - i) / (total - i);
      }
      return p;
   };
   const survival = (winningCard: Card, led: Suit, remaining: Seat[]) => {
      let p = 1;
      for (const other of remaining) {
         if (team(other) === team(seat)) continue;
         const poolSize = poolSizes[other];
         const count = Math.min(knowledge.counts[other], poolSize);
         const ledRanks = knowledge.voids[other].has(led) ? [] : ranks[led];
         const trumpRanks = knowledge.voids[other].has(trump)
            ? []
            : ranks[trump];
         const ledCount = ledRanks.length;
         const higherLed =
            suit(winningCard) === led
               ? ledRanks.filter((rank) => rank > strength(winningCard, trump))
                    .length
               : 0;
         const trumpThreats = trumpRanks.filter(
            (rank) =>
               suit(winningCard) !== trump ||
               rank > strength(winningCard, trump)
         ).length;
         const threat =
            led === trump
               ? 1 - avoid(poolSize, trumpThreats, count)
               : 1 -
                 avoid(poolSize, higherLed, count) +
                 avoid(poolSize, ledCount, count) -
                 avoid(poolSize, ledCount + trumpThreats, count);
         p *= 1 - Math.min(1, Math.max(0, threat));
      }
      return p;
   };
   const remaining: Seat[] = [];
   let next = nextActive(seat, sittingOut);
   for (let i = trick.length + 1; i < (sittingOut === null ? 4 : 3); i++) {
      remaining.push(next);
      next = nextActive(next, sittingOut);
   }
   if (trick.length) {
      const led = suit(trick[0].card);
      let best = legal[0],
         bestValue = -Infinity;
      for (const card of legal) {
         const plays = [...trick, { seat, card }];
         const winner = trickWinner(plays, trump);
         const winningCard = plays.find((p) => p.seat === winner)!.card;
         const value =
            (team(winner) === team(seat)
               ? 5 * survival(winningCard, led, remaining)
               : 0) - cost(card);
         if (value > bestValue) {
            best = card;
            bestValue = value;
         }
      }
      return best;
   }
   const trumps = hand.filter((c) => suit(c) === trump);
   const enemiesMayHaveTrump =
      [0, 1, 2, 3].some(
         (s) =>
            s !== sittingOut &&
            team(s as Seat) !== team(seat) &&
            knowledge.counts[s] > 0 &&
            !knowledge.voids[s].has(trump)
      ) && ranks[trump].length > 0;
   // Draw opposing trump with control, rather than blindly cashing trump when
   // the opponents are already out or the lead only strips our partner.
   if (
      team(seat) === team(maker) &&
      trumps.length >= 2 &&
      enemiesMayHaveTrump
   ) {
      const top = [...trumps].sort(
         (a, b) => strength(b, trump) - strength(a, trump)
      )[0];
      if (master(top)) return top;
   }
   let best = legal[0],
      bestValue = -Infinity;
   for (const card of legal) {
      const s = suit(card);
      const length = lengths[s];
      const value =
         3 * survival(card, s, remaining) -
         cost(card) * 0.4 +
         (master(card) ? 0.6 : 0) +
         (s !== trump && length === 1 ? 0.15 : 0) -
         (s === trump && team(seat) !== team(maker) ? 0.45 : 0);
      if (value > bestValue) {
         best = card;
         bestValue = value;
      }
   }
   return best;
}

export function recordPlay(
   knowledge: PlayKnowledge,
   trick: Play[],
   play: Play,
   trump: Suit
): void {
   if (trick.length) {
      const led = effectiveSuit(trick[0].card, trump);
      if (effectiveSuit(play.card, trump) !== led)
         knowledge.voids[play.seat].add(led);
   }
   knowledge.seen.add(play.card);
   knowledge.counts[play.seat]--;
}
