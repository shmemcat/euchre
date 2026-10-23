// Frozen AI from 9247a0df4dfc188692189fd14a31a6c16b6a041e, before the
// October 21, 2026 upgrade. Keep independent of production policy changes.
import {
   DECK,
   SUITS,
   effectiveSuit,
   legalCards,
   partner,
   rankOf,
   scoreHand,
   shuffle,
   strength,
   suitOf,
   team,
   trickWinner,
   nextActive,
   type Action,
   type Card,
   type Observation,
   type Play,
   type Seat,
   type Suit,
} from "../src/game/engine";

// Each Hard setting evaluates the same information, using a larger sample budget.
export const SIMULATIONS = { hard: 32, harder: 128, hardest: 384 } as const;
export type HardLevel = keyof typeof SIMULATIONS;

export function observationActions(o: Observation): Action[] {
   if (o.phase === "bidding1" || o.phase === "bidding2") {
      const suits =
         o.phase === "bidding1"
            ? [suitOf(o.upCard)]
            : SUITS.filter((s) => s !== suitOf(o.upCard));
      return [
         { type: "pass" },
         ...suits.flatMap((suit) =>
            [false, true].map((alone) => ({
               type: "call" as const,
               suit,
               alone,
            }))
         ),
      ];
   }
   if (o.phase === "discard")
      return o.hand.map((card) => ({ type: "discard", card }));
   if (o.phase === "playing")
      return legalCards(o.hand, o.trick, o.trump).map((card) => ({
         type: "play",
         card,
      }));
   return [];
}

function handValue(hand: Card[], trump: Suit): number {
   const trumps = hand.filter((c) => effectiveSuit(c, trump) === trump);
   let value = trumps.reduce(
      (sum, c) =>
         sum +
         (strength(c, trump) >= 29 ? 1.55 : rankOf(c) === "A" ? 1.1 : 0.55),
      0
   );
   value +=
      hand.filter((c) => effectiveSuit(c, trump) !== trump && rankOf(c) === "A")
         .length * 0.85;
   if (trumps.length >= 3) value += (trumps.length - 2) * 0.4;
   if (trumps.length >= 2)
      value +=
         SUITS.filter(
            (s) =>
               s !== trump && !hand.some((c) => effectiveSuit(c, trump) === s)
         ).length * 0.25;
   return value;
}

export function discardChoice(hand: Card[], trump: Suit): Card {
   return [...hand].sort((a, b) => {
      const value = (c: Card) => {
         const suit = effectiveSuit(c, trump);
         const count = hand.filter(
            (x) => effectiveSuit(x, trump) === suit
         ).length;
         return (
            (suit === trump
               ? 40 + strength(c, trump)
               : rankOf(c) === "A"
               ? 20
               : strength(c, trump)) + (count === 1 && suit !== trump ? -4 : 0)
         );
      };
      return value(a) - value(b);
   })[0];
}

// A cooperative policy: avoid spending a winner when the partner already has the trick.
export function heuristicPlay(
   hand: Card[],
   trick: Play[],
   trump: Suit,
   seat: Seat,
   maker: Seat,
   sittingOut: Seat | null
): Card {
   const legal = legalCards(hand, trick, trump);
   const cheapest = (cards: Card[]) =>
      [...cards].sort((a, b) => strength(a, trump) - strength(b, trump))[0];
   if (trick.length) {
      if (team(trickWinner(trick, trump)) === team(seat))
         return cheapest(legal);
      const winners = legal.filter(
         (card) => trickWinner([...trick, { seat, card }], trump) === seat
      );
      return winners.length ? cheapest(winners) : cheapest(legal);
   }
   const aces = legal.filter(
      (c) => effectiveSuit(c, trump) !== trump && rankOf(c) === "A"
   );
   const trumps = legal.filter((c) => effectiveSuit(c, trump) === trump);
   if (team(seat) === team(maker) && trumps.length >= 2)
      return [...trumps].sort(
         (a, b) => strength(b, trump) - strength(a, trump)
      )[0];
   if (aces.length) return aces[0];
   // With a lone partner, a defender can save trump and lead a plain suit.
   const plain = legal.filter((c) => effectiveSuit(c, trump) !== trump);
   if (sittingOut !== null && plain.length) return cheapest(plain);
   return cheapest(legal);
}

export function mediumAction(
   o: Observation,
   rng: () => number = Math.random
): Action {
   if (o.phase === "playing")
      return {
         type: "play",
         card: heuristicPlay(
            o.hand,
            o.trick,
            o.trump!,
            o.seat,
            o.maker!,
            o.sittingOut
         ),
      };
   if (o.phase === "discard")
      return { type: "discard", card: discardChoice(o.hand, o.trump!) };
   let best: { suit: Suit; value: number } | null = null;
   const suits =
      o.phase === "bidding1"
         ? [suitOf(o.upCard)]
         : SUITS.filter((s) => s !== suitOf(o.upCard));
   for (const suit of suits) {
      let hand = [...o.hand];
      if (o.phase === "bidding1" && o.seat === o.dealer) {
         hand.push(o.upCard);
         const discard = discardChoice(hand, suit);
         hand = hand.filter((c) => c !== discard);
      }
      let value = handValue(hand, suit);
      if (o.phase === "bidding1" && o.dealer === partner(o.seat)) value += 0.25;
      if (o.phase === "bidding1" && team(o.dealer) !== team(o.seat))
         value -= 0.2;
      if (!best || value > best.value) best = { suit, value };
   }
   if (best && best.value >= 2.65)
      return { type: "call", suit: best.suit, alone: best.value >= 5.0 };
   return { type: "pass" };
}

export function inferredVoids(o: Observation): Set<Suit>[] {
   const voids = [
      new Set<Suit>(),
      new Set<Suit>(),
      new Set<Suit>(),
      new Set<Suit>(),
   ];
   const tricks = [...o.completedTricks.map((t) => t.plays), o.trick];
   for (const trick of tricks) {
      if (!trick.length) continue;
      const led = effectiveSuit(trick[0].card, o.trump);
      for (const p of trick.slice(1))
         if (effectiveSuit(p.card, o.trump) !== led) voids[p.seat].add(led);
   }
   return voids;
}

// Sample hidden cards using only the bot's own hand and public play. The caller
// never sends the real opponents' hands to this module or the worker.
export function sampleHands(
   o: Observation,
   rng: () => number = Math.random
): Card[][] | null {
   const played = new Set([
      ...o.completedTricks.flatMap((t) => t.plays.map((p) => p.card)),
      ...o.trick.map((p) => p.card),
   ]);
   const knownDead = new Set<Card>();
   if (!o.pickedUp) knownDead.add(o.upCard);
   if (o.knownDiscard) knownDead.add(o.knownDiscard);
   const unknown = shuffle(
      DECK.filter(
         (c) => !o.hand.includes(c) && !played.has(c) && !knownDead.has(c)
      ),
      rng
   );
   const voids = inferredVoids(o);
   const hands: Card[][] = [[], [], [], []];
   hands[o.seat] = [...o.hand];
   const capacity = o.counts.map((count, s) => (s === o.seat ? 0 : count));
   capacity.push(unknown.length - capacity.reduce((a, b) => a + b, 0)); // The unobserved kitty.
   if (capacity[4] < 0) return null;
   const allowed = (card: Card, slot: number) =>
      slot === 4 ||
      (slot !== o.seat &&
         !voids[slot].has(effectiveSuit(card, o.trump)) &&
         !(o.pickedUp && card === o.upCard && slot !== o.dealer));
   unknown.sort(
      (a, b) =>
         capacity.filter((_, s) => allowed(a, s)).length -
         capacity.filter((_, s) => allowed(b, s)).length
   );
   let attempts = 0;
   const assign = (index: number): boolean => {
      if (index === unknown.length) return true;
      if (++attempts > 6000) return false;
      const card = unknown[index];
      // Capacity weighting avoids making a small kitty as likely as a full hand.
      const slots = shuffle(
         capacity.flatMap((count, slot) =>
            allowed(card, slot) ? (Array(count).fill(slot) as number[]) : []
         ),
         rng
      );
      for (const slot of [...new Set(slots)]) {
         capacity[slot]--;
         if (slot < 4) hands[slot].push(card);
         if (assign(index + 1)) return true;
         if (slot < 4) hands[slot].pop();
         capacity[slot]++;
      }
      return false;
   };
   return assign(0) ? hands : null;
}

function rollout(
   handsInput: Card[][],
   trump: Suit,
   maker: Seat,
   alone: boolean,
   turn: Seat,
   trickInput: Play[],
   takenInput: [number, number],
   rng: () => number
): number {
   const hands = handsInput.map((hand) => [...hand]);
   const sittingOut = alone ? partner(maker) : null;
   let trick = [...trickInput];
   const taken: [number, number] = [...takenInput];
   let safety = 0;
   while (taken[0] + taken[1] < 5 && safety++ < 30) {
      if (trick.length === (alone ? 3 : 4)) {
         turn = trickWinner(trick, trump);
         taken[team(turn)]++;
         trick = [];
         continue;
      }
      if (!hands[turn].length) return 0;
      const legal = legalCards(hands[turn], trick, trump);
      const card =
         rng() < 0.12
            ? legal[Math.floor(rng() * legal.length)]
            : heuristicPlay(hands[turn], trick, trump, turn, maker, sittingOut);
      hands[turn] = hands[turn].filter((c) => c !== card);
      trick.push({ seat: turn, card });
      turn = nextActive(turn, sittingOut);
   }
   const points = scoreHand(team(maker), taken[team(maker)], alone);
   return points[0] - points[1];
}

function evaluate(
   o: Observation,
   action: Action,
   sampled: Card[][],
   rng: () => number
): number {
   const hands = sampled.map((hand) => [...hand]);
   let trump = o.trump;
   let maker = o.maker;
   let alone = o.alone;
   let turn = o.seat;
   let trick = [...o.trick];
   if (action.type === "call") {
      trump = action.suit;
      maker = o.seat;
      alone = action.alone;
      if (o.phase === "bidding1") {
         hands[o.dealer].push(o.upCard);
         const discard = discardChoice(hands[o.dealer], trump);
         hands[o.dealer] = hands[o.dealer].filter((c) => c !== discard);
      }
      turn = nextActive(o.dealer, alone ? partner(maker) : null);
      trick = [];
   } else if (action.type === "discard") {
      hands[o.seat] = hands[o.seat].filter((c) => c !== action.card);
      turn = nextActive(o.dealer, alone ? partner(maker!) : null);
   } else if (action.type === "play") {
      hands[o.seat] = hands[o.seat].filter((c) => c !== action.card);
      trick.push({ seat: o.seat, card: action.card });
      turn = nextActive(o.seat, o.sittingOut);
   }
   const delta = rollout(
      hands,
      trump!,
      maker!,
      alone,
      turn,
      trick,
      o.tricks,
      rng
   );
   return team(o.seat) === 0 ? delta : -delta;
}

export function chooseAction(
   o: Observation,
   rng: () => number = Math.random
): Action {
   const actions = observationActions(o);
   if (!actions.length) throw new Error("No bot action is available.");
   if (o.difficulty === "easy") {
      if (o.phase === "bidding1" || o.phase === "bidding2") {
         // Easy bids loosely but does not choose a lone hand at random.
         const basic = mediumAction(o, rng);
         if (basic.type === "call") return { ...basic, alone: false };
         if (rng() < 0.12) {
            const calls = actions.filter(
               (a): a is Extract<Action, { type: "call" }> =>
                  a.type === "call" && !a.alone
            );
            return calls[Math.floor(rng() * calls.length)];
         }
         return { type: "pass" };
      }
      return actions[Math.floor(rng() * actions.length)];
   }
   if (o.difficulty === "medium" || actions.length === 1)
      return mediumAction(o, rng);
   const budget = SIMULATIONS[o.difficulty];
   const candidates = actions.filter((a) => a.type !== "pass");
   const totals = candidates.map(() => 0);
   let samples = 0;
   // Common sampled deals for all choices make comparisons less noisy.
   for (let i = 0; i < budget; i++) {
      const hands = sampleHands(o, rng);
      if (!hands) continue;
      candidates.forEach((action, index) => {
         totals[index] += evaluate(o, action, hands, rng);
      });
      samples++;
   }
   if (!samples) return mediumAction(o, rng);
   let best = 0;
   for (let i = 1; i < totals.length; i++)
      if (totals[i] > totals[best]) best = i;
   // Passing keeps the option to defend or call later. Avoid marginal calls.
   if (
      (o.phase === "bidding1" || o.phase === "bidding2") &&
      totals[best] / samples < 0.25
   )
      return { type: "pass" };
   return candidates[best];
}

