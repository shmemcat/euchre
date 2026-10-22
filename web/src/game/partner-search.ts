import {
   DECK,
   SUITS,
   effectiveSuit,
   nextActive,
   partner,
   strength,
   team,
   type Card,
   type Play,
   type Seat,
   type Suit,
} from "./engine";
import { settledScore } from "./endgame";
import type { PlayKnowledge } from "./play-policy";

const indices = Object.fromEntries(
   DECK.map((card, index) => [card, index])
) as Record<Card, number>;
const rules = Object.fromEntries(
   SUITS.map((trump) => {
      const suits = DECK.map((card) =>
         SUITS.indexOf(effectiveSuit(card, trump))
      );
      return [
         trump,
         {
            suits,
            ranks: DECK.map((card) => strength(card, trump)),
            suitMasks: SUITS.map((_, suit) =>
               suits.reduce(
                  (mask, value, index) =>
                     value === suit ? mask | (1 << index) : mask,
                  0
               )
            ),
         },
      ];
   })
) as Record<Suit, { suits: number[]; ranks: number[]; suitMasks: number[] }>;

// Same exact hypothetical minimax and public-policy partner as the array solver.
// Card sets use 24-bit masks; callbacks retain the original hand order.
export function solvePartnerEndgame(
   input: Card[][],
   trump: Suit,
   maker: Seat,
   alone: boolean,
   turn: Seat,
   trick: Play[],
   takenInput: [number, number],
   modeledPartner: Seat,
   publicKnowledge: PlayKnowledge,
   policy: (hand: Card[], plays: Play[], knowledge: PlayKnowledge) => Card
): number {
   const { suits, ranks, suitMasks } = rules[trump];
   const hands = input.map((hand) =>
      hand.reduce((mask, card) => mask | (1 << indices[card]), 0)
   );
   const taken: [number, number] = [...takenInput];
   const sittingOut = alone ? partner(maker) : null;
   const next = ([0, 1, 2, 3] as Seat[]).map((seat) =>
      nextActive(seat, sittingOut)
   );
   const size = alone ? 3 : 4;
   const knowledge: PlayKnowledge = {
      seen: new Set(publicKnowledge.seen),
      voids: publicKnowledge.voids.map((voids) => new Set(voids)),
      counts: [...publicKnowledge.counts],
   };
   const cards = new Uint8Array(20),
      seats = new Uint8Array(20);
   for (let i = 0; i < trick.length; i++) {
      cards[i] = indices[trick[i].card];
      seats[i] = trick[i].seat;
   }
   let initialLed = -1,
      initialWinner = turn,
      initialValue = -Infinity;
   for (const play of trick) {
      const index = indices[play.card];
      if (initialLed < 0) initialLed = suits[index];
      const value = ranks[index] + (suits[index] === initialLed ? 10 : 0);
      if (value > initialValue) {
         initialWinner = play.seat;
         initialValue = value;
      }
   }
   function search(
      seat: Seat,
      depth: number,
      count: number,
      led: number,
      winner: Seat,
      winningValue: number,
      alpha: number,
      beta: number
   ): number {
      if (count === size) {
         taken[team(winner)]++;
         const result = search(
            winner,
            depth,
            0,
            -1,
            winner,
            -Infinity,
            alpha,
            beta
         );
         taken[team(winner)]--;
         return result;
      }
      const settled = settledScore(maker, alone, taken);
      if (settled !== null) return settled;
      let choices = hands[seat];
      if (count && choices & suitMasks[led]) choices &= suitMasks[led];
      if (seat === modeledPartner) {
         const hand = input[seat].filter(
            (card) => (hands[seat] & (1 << indices[card])) !== 0
         );
         const plays: Play[] = [];
         for (let i = depth - count; i < depth; i++)
            plays.push({ seat: seats[i] as Seat, card: DECK[cards[i]] });
         const card = policy(hand, plays, knowledge);
         if (indices[card] === undefined)
            throw new Error("Modeled partner made an illegal play.");
         const bit = 1 << indices[card];
         if (!(choices & bit))
            throw new Error("Modeled partner made an illegal play.");
         choices = bit;
      }
      const maximizing = team(seat) === 0;
      let best = maximizing ? -Infinity : Infinity;
      while (choices) {
         let selected = choices & -choices;
         if (seat !== modeledPartner) {
            let remaining = choices,
               bestPriority = -Infinity;
            while (remaining) {
               const bit = remaining & -remaining;
               const index = 31 - Math.clz32(bit);
               const value = ranks[index] + (suits[index] === led ? 10 : 0);
               const win = value > winningValue ? seat : winner;
               const priority = count
                  ? (team(win) === team(seat) ? 40 : 0) - ranks[index]
                  : ranks[index];
               if (priority > bestPriority) {
                  selected = bit;
                  bestPriority = priority;
               }
               remaining ^= bit;
            }
         }
         choices ^= selected;
         const index = 31 - Math.clz32(selected),
            card = DECK[index];
         const newLed = count ? led : suits[index];
         const value = ranks[index] + (suits[index] === newLed ? 10 : 0);
         const newWinner = value > winningValue ? seat : winner;
         const newWinningValue = Math.max(value, winningValue);
         hands[seat] ^= selected;
         knowledge.counts[seat]--;
         knowledge.seen.add(card);
         const voidSuit = count && suits[index] !== led ? SUITS[led] : null;
         const newVoid =
            voidSuit !== null && !knowledge.voids[seat].has(voidSuit);
         if (newVoid) knowledge.voids[seat].add(voidSuit!);
         cards[depth] = index;
         seats[depth] = seat;
         const result = search(
            next[seat],
            depth + 1,
            count + 1,
            newLed,
            newWinner,
            newWinningValue,
            alpha,
            beta
         );
         if (newVoid) knowledge.voids[seat].delete(voidSuit!);
         knowledge.seen.delete(card);
         knowledge.counts[seat]++;
         hands[seat] |= selected;
         best = maximizing ? Math.max(best, result) : Math.min(best, result);
         if (maximizing) alpha = Math.max(alpha, best);
         else beta = Math.min(beta, best);
         if (alpha >= beta) break;
      }
      return best;
   }
   const makersSweep = (team(maker) === 0 ? 1 : -1) * (alone ? 4 : 2);
   const euchred = team(maker) === 0 ? -2 : 2;
   return search(
      turn,
      trick.length,
      trick.length,
      initialLed,
      initialWinner,
      initialValue,
      Math.min(makersSweep, euchred),
      Math.max(makersSweep, euchred)
   );
}
