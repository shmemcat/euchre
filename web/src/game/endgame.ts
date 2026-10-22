import {
   legalCards,
   nextActive,
   partner,
   scoreHand,
   team,
   trickWinner,
   type Card,
   type Play,
   type Seat,
   type Suit,
} from "./engine";

// Returns the team-zero point difference once the hand's score cannot change.
export function settledScore(
   maker: Seat,
   alone: boolean,
   taken: [number, number]
): number | null {
   const makers = taken[team(maker)],
      defenders = taken[1 - team(maker)];
   if (
      makers + defenders < 5 &&
      defenders < 3 &&
      !(makers >= 3 && defenders > 0)
   )
      return null;
   const points = scoreHand(team(maker), makers, alone);
   return points[0] - points[1];
}

// Double-dummy search of ONE hypothetical deal, not access to the real deal.
// This improves late tactical forecasts but assumes perfect play with that
// allocation; averaging sampled deals still approximates imperfect information.
export function solveEndgame(
   input: Card[][],
   trump: Suit,
   maker: Seat,
   alone: boolean,
   turn: Seat,
   trick: Play[],
   takenInput: [number, number]
): number {
   const hands = input.map((h) => [...h]);
   const taken: [number, number] = [...takenInput];
   const sittingOut = alone ? partner(maker) : null;
   const size = alone ? 3 : 4;
   const search = (
      seat: Seat,
      plays: Play[],
      alpha: number,
      beta: number
   ): number => {
      if (plays.length === size) {
         const winner = trickWinner(plays, trump);
         const winningTeam = team(winner);
         taken[winningTeam]++;
         const value = search(winner, [], alpha, beta);
         taken[winningTeam]--;
         return value;
      }
      const settled = settledScore(maker, alone, taken);
      if (settled !== null) return settled;
      const legal = legalCards(hands[seat], plays, trump);
      if (!legal.length) throw new Error("Incomplete hypothetical endgame.");
      const maximizing = team(seat) === 0;
      let best = maximizing ? -Infinity : Infinity;
      for (const card of legal) {
         const index = hands[seat].indexOf(card);
         hands[seat].splice(index, 1);
         const value = search(
            nextActive(seat, sittingOut),
            [...plays, { seat, card }],
            alpha,
            beta
         );
         hands[seat].splice(index, 0, card);
         best = maximizing ? Math.max(best, value) : Math.min(best, value);
         if (maximizing) alpha = Math.max(alpha, best);
         else beta = Math.min(beta, best);
         if (alpha >= beta) break;
      }
      return best;
   };
   return search(turn, trick, -Infinity, Infinity);
}
