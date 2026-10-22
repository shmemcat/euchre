import {
   applyAction,
   newGame,
   observe,
   team,
   type Action,
   type Observation,
   type Seat,
} from "../src/game/engine";

export type Bot = (observation: Observation, random: () => number) => Action;
export function seeded(seed: number): () => number {
   return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
   };
}

export type Result = {
   points: number;
   won: number;
   redeals: number;
   decisions: number;
   milliseconds: number;
   maxMilliseconds: number;
};

// Deal randomness is independent of how much randomness any bot consumes.
// Both legs use the identical deal and dealer, then swap the tested teams.
export function playLeg(
   seed: number,
   bots: [Bot, Bot, Bot, Bot],
   candidateTeam: 0 | 1,
   matches = false
): Result {
   let game = newGame("medium", "Benchmark", seeded(seed));
   const decisionCounts = [0, 0, 0, 0];
   let decisions = 0,
      milliseconds = 0,
      maxMilliseconds = 0,
      redeals = 0;
   for (let moves = 0; moves < 5000; moves++) {
      if (game.phase === "round_complete" && game.maker === null) redeals++;
      if (
         (game.phase === "round_complete" && !matches) ||
         game.phase === "game_over"
      ) {
         const points =
            game.scores[candidateTeam] - game.scores[1 - candidateTeam];
         return {
            points,
            won: points > 0 ? 1 : points < 0 ? 0 : 0.5,
            redeals,
            decisions,
            milliseconds,
            maxMilliseconds,
         };
      }
      const oldHand = game.handNumber;
      const wasBidding = game.phase === "bidding1" || game.phase === "bidding2";
      if (game.phase === "trick_complete" || game.phase === "round_complete") {
         game = applyAction(
            game,
            { type: "advance" },
            seeded(seed + game.handNumber * 104729)
         );
      } else {
         const seat = game.turn;
         const random = seeded(
            seed ^
               Math.imul(seat + 1, 73856093) ^
               Math.imul(++decisionCounts[seat], 19349663)
         );
         const start = performance.now();
         const action = bots[seat](observe(game), random);
         const elapsed = performance.now() - start;
         if (team(seat) === candidateTeam) {
            decisions++;
            milliseconds += elapsed;
            maxMilliseconds = Math.max(maxMilliseconds, elapsed);
         }
         game = applyAction(
            game,
            action,
            seeded(seed + game.handNumber * 104729)
         );
      }
      if (game.handNumber !== oldHand && wasBidding) {
         redeals++;
         if (!matches)
            return {
               points: 0,
               won: 0.5,
               redeals,
               decisions,
               milliseconds,
               maxMilliseconds,
            };
      }
   }
   throw new Error(`Benchmark did not terminate (seed ${seed}).`);
}

export function pair(
   seed: number,
   candidate: Bot,
   opponent: Bot,
   partner?: Bot,
   matches = false
): Result[] {
   return [
      playLeg(
         seed,
         [candidate, opponent, partner ?? candidate, partner ?? opponent],
         0,
         matches
      ),
      playLeg(
         seed,
         [opponent, candidate, partner ?? opponent, partner ?? candidate],
         1,
         matches
      ),
   ];
}

export function summarize(pairs: Result[][], resamples = 10000) {
   const results = pairs.flat();
   const margins = pairs.map(
      (legs) => legs.reduce((sum, r) => sum + r.points, 0) / legs.length
   );
   const margin = margins.reduce((a, b) => a + b, 0) / margins.length;
   const shares = pairs.map(
      (legs) => legs.reduce((sum, r) => sum + r.won, 0) / legs.length
   );
   // Bootstrap whole duplicate-deal pairs, not the correlated individual legs.
   const random = seeded(816713);
   const bootstrap: number[] = [],
      shareBootstrap: number[] = [];
   for (let repeat = 0; repeat < resamples; repeat++) {
      let total = 0,
         share = 0;
      for (let i = 0; i < margins.length; i++) {
         const index = Math.floor(random() * margins.length);
         total += margins[index];
         share += shares[index];
      }
      bootstrap.push(total / margins.length);
      shareBootstrap.push(share / margins.length);
   }
   bootstrap.sort((a, b) => a - b);
   shareBootstrap.sort((a, b) => a - b);
   const interval = (values: number[], confidence: number) => {
      const tail = (1 - confidence) / 2;
      return [
         values[Math.max(0, Math.ceil(tail * resamples) - 1)],
         values[Math.min(resamples - 1, Math.ceil((1 - tail) * resamples) - 1)],
      ];
   };
   const decisions = results.reduce((sum, r) => sum + r.decisions, 0);
   return {
      pairs: pairs.length,
      games: results.length,
      scoreShare: results.reduce((sum, r) => sum + r.won, 0) / results.length,
      pointMargin: margin,
      margin95: interval(bootstrap, 0.95),
      margin975: interval(bootstrap, 0.975),
      share95: interval(shareBootstrap, 0.95),
      share975: interval(shareBootstrap, 0.975),
      redeals: results.reduce((sum, r) => sum + r.redeals, 0),
      decisions,
      meanDecisionMs:
         results.reduce((sum, r) => sum + r.milliseconds, 0) / decisions,
      maxDecisionMs: Math.max(...results.map((r) => r.maxMilliseconds)),
   };
}
