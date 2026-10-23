import {
   SUITS,
   effectiveSuit,
   legalCards,
   nextActive,
   nextSeat,
   partner,
   scoreHand,
   shuffle,
   suitOf,
   team,
   trickWinner,
   type Action,
   type Card,
   type Observation,
   type Play,
   type Seat,
   type Suit,
} from "./engine";
import { strategicPlay, recordPlay, type PlayKnowledge } from "./play-policy";
import { settledScore, solveEndgame } from "./endgame";

// Publicly recorded model assumptions; none supplies real hidden cards.
export const HARDEST_STRATEGY = {
   objective: "approximate match-win probability",
   partnerBasicPrior: 0.75,
   opponentBasicPrior: 0.15,
   priorWeight: 0.35,
   evidenceWeight: 0.65,
   likelihoodTemperature: 0.5,
   tacticalWeight: 0.25,
   informationWeight: 0.75,
   informationTricks: 3,
   minInformationParticles: 12,
} as const;

type Call = Extract<Action, { type: "call" }>;
export type HardestPolicies = {
   forecast?: (
      o: Observation,
      action: Action,
      hands: Card[][],
      style: Style
   ) => number;
   actions: (o: Observation) => Action[];
   basic: (o: Observation) => Action;
   discard: (hand: Card[], trump: Suit) => Card;
   quality: (hand: Card[], trump: Suit) => number;
   sample: (o: Observation, rng: () => number) => Card[][] | null;
   heuristic: (
      hand: Card[],
      trick: Play[],
      trump: Suit,
      seat: Seat,
      maker: Seat,
      sittingOut: Seat | null
   ) => Card;
   auction: (
      o: Observation,
      hands: Card[][]
   ) => {
      seat: Seat;
      phase: "bidding1" | "bidding2";
      action: Call;
   } | null;
};

// Neutral future-hand approximation, not a claim that future hands are solved.
// Terminal match wins/losses are exact. This distinguishes making one at nine
// from risking the match for a sweep or four-point loner that is no longer useful.
const equity = new Map<string, number>();
export function matchEquity(ours: number, theirs: number): number {
   if (ours >= 10) return 1;
   if (theirs >= 10) return 0;
   const key = `${ours},${theirs}`;
   const cached = equity.get(key);
   if (cached !== undefined) return cached;
   let value = 0;
   for (const [points, probability] of [
      [1, 0.6],
      [2, 0.35],
      [4, 0.05],
   ])
      value +=
         probability *
         0.5 *
         (matchEquity(ours + points, theirs) +
            matchEquity(ours, theirs + points));
   equity.set(key, value);
   return value;
}

export function matchValue(o: Observation, teamZeroDelta: number): number {
   const delta = team(o.seat) === 0 ? teamZeroDelta : -teamZeroDelta;
   return matchEquity(
      o.scores[team(o.seat)] + Math.max(0, delta),
      o.scores[1 - team(o.seat)] + Math.max(0, -delta)
   );
}

type Style = "basic" | "strategic";
export type Particle = {
   hands: Card[][];
   initialHands?: Card[][];
   styles: Style[];
   weight: number;
};

// Other players' private deal order is unknown. Sample one consistent original
// order for the public-history likelihood and the remaining policy hand. Medium
// leads its first ace, so appending played aces after unplayed ones is biased.
export function orderedHypothesis(
   o: Observation,
   input: Card[][],
   rng: () => number
) {
   const plays = [
      ...o.completedTricks.flatMap((trick) => trick.plays),
      ...o.trick,
   ];
   const initialHands = input.map((hand, seat) => {
      const original = [
         ...hand,
         ...plays.filter((play) => play.seat === seat).map((play) => play.card),
      ];
      if (seat === o.seat) return original;
      const orderedUp =
         o.pickedUp && seat === o.dealer && original.includes(o.upCard);
      const ordered = shuffle(
         orderedUp ? original.filter((card) => card !== o.upCard) : original,
         rng
      );
      if (orderedUp) ordered.push(o.upCard);
      return ordered;
   });
   const publicCards = new Set(plays.map((play) => play.card));
   const hands = initialHands.map((hand, seat) =>
      seat === o.seat
         ? [...input[seat]]
         : hand.filter((card) => !publicCards.has(card))
   );
   return { hands, initialHands };
}
type World = {
   hands: Card[][];
   styles: Style[];
   weight: number;
   trump: Suit;
   maker: Seat;
   alone: boolean;
   sittingOut: Seat | null;
   turn: Seat;
   trick: Play[];
   taken: [number, number];
   knowledge: PlayKnowledge;
   dead: Card[][];
   history: string;
   terminal?: number;
};

const logistic = (value: number) => 0.04 + 0.92 / (1 + Math.exp(-value));

// Infer only auctions implied by public facts: earlier seats passed; a second-
// round contract means every seat passed round one. No actual hidden hand enters.
export function publicAuction(o: Observation): {
   seat: Seat;
   first: boolean;
   suit?: Suit;
   alone?: boolean;
}[] {
   const order: Seat[] = [];
   for (let seat = nextSeat(o.dealer), i = 0; i < 4; i++, seat = nextSeat(seat))
      order.push(seat);
   const bidding = o.phase === "bidding1" || o.phase === "bidding2";
   const stop = bidding ? o.seat : o.maker;
   if (stop === null) return [];
   const first = bidding
      ? o.phase === "bidding1"
      : o.trump === suitOf(o.upCard);
   const events: ReturnType<typeof publicAuction> = first
      ? []
      : order.map((seat) => ({ seat, first: true }));
   for (const seat of order) {
      if (seat === stop) break;
      events.push({ seat, first });
   }
   if (!bidding)
      events.push({ seat: stop, first, suit: o.trump!, alone: o.alone });
   return events;
}

export function particleLikelihood(
   o: Observation,
   particle: Particle,
   policies: HardestPolicies
): number {
   const hands = (particle.initialHands ?? particle.hands).map((hand) => [
      ...hand,
   ]);
   const allPlays = [...o.completedTricks.map((trick) => trick.plays), o.trick];
   if (!particle.initialHands)
      for (const plays of allPlays)
         for (const play of plays) hands[play.seat].push(play.card);
   let log = 0;
   if (
      o.pickedUp &&
      o.dealer !== o.seat &&
      !hands[o.dealer].includes(o.upCard) &&
      !allPlays.some((plays) => plays.some((play) => play.card === o.upCard))
   ) {
      // An ordered-up trump can legally be discarded, but a plausible dealer
      // usually keeps it. Account for that choice instead of treating it as a
      // random kitty card. The dealer's actual discard is never supplied here.
      const six = [...hands[o.dealer], o.upCard];
      log += Math.log(
         policies.discard(six, o.trump!) === o.upCard ? 0.9 : 0.06
      );
   }
   for (const event of publicAuction(o)) {
      if (event.seat === o.seat) continue;
      // The dealer's pre-pickup hand includes an unknown discarded card. Do not
      // pretend their current five cards reveal that original first-round hand.
      if (o.pickedUp && event.seat === o.dealer) continue;
      const suits = event.first
         ? [suitOf(o.upCard)]
         : SUITS.filter((s) => s !== suitOf(o.upCard));
      const quality = (suit: Suit) => {
         let hand = hands[event.seat];
         if (event.first && event.seat === o.dealer) {
            hand = [...hand, o.upCard];
            const discard = policies.discard(hand, suit);
            hand = hand.filter((card) => card !== discard);
         }
         return (
            policies.quality(hand, suit) +
            (event.first && o.dealer === partner(event.seat) ? 0.25 : 0) -
            (event.first && team(o.dealer) !== team(event.seat) ? 0.2 : 0)
         );
      };
      const value = event.suit
         ? quality(event.suit)
         : Math.max(...suits.map(quality));
      const call = logistic((value - 2.65) * 1.8);
      let probability = event.suit ? call : 1 - call;
      if (event.suit) {
         const lone = logistic((value - 5) * 1.6);
         probability *= event.alone ? lone : 1 - lone;
      }
      log += Math.log(probability);
   }
   if (!o.trump) return Math.exp(log * HARDEST_STRATEGY.likelihoodTemperature);
   const knowledge: PlayKnowledge = {
      seen: new Set(o.pickedUp ? [] : [o.upCard]),
      voids: Array.from({ length: 4 }, () => new Set<Suit>()),
      counts: hands.map((hand) => hand.length),
   };
   for (const plays of allPlays) {
      const trick: Play[] = [];
      for (const play of plays) {
         const legal = legalCards(hands[play.seat], trick, o.trump);
         if (play.seat !== o.seat && legal.length > 1) {
            const predicted = policyCard(
               hands[play.seat],
               trick,
               o.trump,
               play.seat,
               o.maker!,
               o.sittingOut,
               knowledge,
               particle.styles[play.seat],
               policies
            );
            // Soft evidence: a human or a searching bot can choose another legal
            // card. Never turn a modeled preference into a supposedly certain void.
            log += Math.log(
               0.45 / legal.length + (predicted === play.card ? 0.55 : 0)
            );
         }
         hands[play.seat] = hands[play.seat].filter(
            (card) => card !== play.card
         );
         recordPlay(knowledge, trick, play, o.trump);
         trick.push(play);
      }
   }
   return Math.exp(log * HARDEST_STRATEGY.likelihoodTemperature);
}

function policyCard(
   hand: Card[],
   trick: Play[],
   trump: Suit,
   seat: Seat,
   maker: Seat,
   sittingOut: Seat | null,
   knowledge: PlayKnowledge,
   style: Style,
   policies: HardestPolicies
): Card {
   return style === "basic"
      ? policies.heuristic(hand, trick, trump, seat, maker, sittingOut)
      : strategicPlay(hand, trick, trump, seat, maker, sittingOut, knowledge);
}

function clone(world: World): World {
   return {
      ...world,
      hands: world.hands.map((hand) => [...hand]),
      trick: [...world.trick],
      taken: [...world.taken],
      knowledge: {
         seen: new Set(world.knowledge.seen),
         voids: world.knowledge.voids.map((voids) => new Set(voids)),
         counts: [...world.knowledge.counts],
      },
   };
}

function play(world: World, card: Card): void {
   const seat = world.turn;
   const move = { seat, card };
   world.hands[seat] = world.hands[seat].filter((value) => value !== card);
   recordPlay(world.knowledge, world.trick, move, world.trump);
   world.trick.push(move);
   world.history += `/${seat}:${card}`;
   world.turn = nextActive(seat, world.sittingOut);
   complete(world);
}

function complete(world: World): void {
   if (world.trick.length === (world.alone ? 3 : 4)) {
      world.turn = trickWinner(world.trick, world.trump);
      world.taken[team(world.turn)]++;
      world.trick = [];
   }
   const settled = settledScore(world.maker, world.alone, world.taken);
   if (settled !== null) world.terminal = settled;
}

function choosePolicy(
   world: World,
   root: Seat,
   policies: HardestPolicies
): Card {
   if (
      world.turn !== root &&
      team(world.turn) !== team(root) &&
      world.styles[world.turn] === "strategic" &&
      world.hands.every(
         (hand, seat) => seat === world.sittingOut || hand.length <= 2
      )
   ) {
      const choices = legalCards(
         world.hands[world.turn],
         world.trick,
         world.trump
      );
      if (choices.length > 1) {
         const maximizing = team(world.turn) === 0;
         let best = choices[0],
            bestValue = maximizing ? -Infinity : Infinity;
         for (const card of choices) {
            const hands = world.hands.map((hand) => [...hand]);
            hands[world.turn] = hands[world.turn].filter(
               (value) => value !== card
            );
            const value = solveEndgame(
               hands,
               world.trump,
               world.maker,
               world.alone,
               nextActive(world.turn, world.sittingOut),
               [...world.trick, { seat: world.turn, card }],
               world.taken
            );
            if (maximizing ? value > bestValue : value < bestValue) {
               best = card;
               bestValue = value;
            }
         }
         return best;
      }
   }
   const knowledge = world.dead[world.turn].length
      ? {
           ...world.knowledge,
           seen: new Set([...world.knowledge.seen, ...world.dead[world.turn]]),
        }
      : world.knowledge;
   return policyCard(
      world.hands[world.turn],
      world.trick,
      world.trump,
      world.turn,
      world.maker,
      world.sittingOut,
      knowledge,
      world.turn === root ? "strategic" : world.styles[world.turn],
      policies
   );
}

function prepare(
   o: Observation,
   action: Action,
   particle: Particle,
   policies: HardestPolicies
): World {
   const world: World = {
      hands: particle.hands.map((hand) => [...hand]),
      styles: particle.styles,
      weight: particle.weight,
      trump: o.trump!,
      maker: o.maker!,
      alone: o.alone,
      sittingOut: o.sittingOut,
      turn: o.seat,
      trick: [...o.trick],
      taken: [...o.tricks],
      knowledge: {
         seen: new Set([
            ...o.completedTricks.flatMap((trick) =>
               trick.plays.map((p) => p.card)
            ),
            ...o.trick.map((p) => p.card),
         ]),
         voids: Array.from({ length: 4 }, () => new Set<Suit>()),
         counts: [...o.counts],
      },
      dead: Array.from({ length: 4 }, () => []),
      history: "",
   };
   if (!o.pickedUp) world.dead.forEach((cards) => cards.push(o.upCard));
   if (o.knownDiscard) world.dead[o.seat].push(o.knownDiscard);
   let caller = o.seat;
   let first = o.phase === "bidding1";
   if (action.type === "pass") {
      const continuation = policies.auction(o, world.hands);
      if (!continuation) {
         world.terminal = 0;
         return world;
      }
      action = continuation.action;
      caller = continuation.seat;
      first = continuation.phase === "bidding1";
   }
   if (action.type === "call") {
      world.trump = action.suit;
      world.maker = caller;
      world.alone = action.alone;
      world.sittingOut = action.alone ? partner(caller) : null;
      if (first) {
         world.dead.forEach((cards) => cards.splice(0));
         world.hands[o.dealer].push(o.upCard);
         const discard = policies.discard(world.hands[o.dealer], world.trump);
         world.hands[o.dealer] = world.hands[o.dealer].filter(
            (card) => card !== discard
         );
         world.dead[o.dealer].push(discard);
      }
      world.turn = nextActive(o.dealer, world.sittingOut);
      world.trick = [];
   } else if (action.type === "discard") {
      world.hands[o.seat] = world.hands[o.seat].filter(
         (card) => card !== action.card
      );
      world.dead[o.seat].push(action.card);
      world.turn = nextActive(o.dealer, world.sittingOut);
   }
   world.knowledge.counts = world.hands.map((hand) => hand.length);
   // Reconstruct effective-suit voids without using any private sampled cards.
   for (const plays of [
      ...o.completedTricks.map((trick) => trick.plays),
      o.trick,
   ]) {
      if (!plays.length) continue;
      const led = effectiveSuit(plays[0].card, world.trump);
      for (const move of plays.slice(1))
         if (effectiveSuit(move.card, world.trump) !== led)
            world.knowledge.voids[move.seat].add(led);
   }
   if (action.type === "play") play(world, action.card);
   else complete(world);
   return world;
}

function publicKey(world: World, root: Seat): string {
   return (
      `${world.trump}:${world.maker}:${world.alone}:${world.turn}:${world.taken}:` +
      `${world.hands[root].join(",")}:${world.history}`
   );
}

function groups(worlds: World[], root: Seat): World[][] {
   const result = new Map<string, World[]>();
   for (const world of worlds) {
      const key = publicKey(world, root);
      const existing = result.get(key);
      if (existing) existing.push(world);
      else result.set(key, [world]);
   }
   return [...result.values()];
}

// Policy-based information-set search. Our future action must be shared by all
// worlds with the same observed play and own hand. Partner models see only their
// hand and public knowledge. Strong opponent forecasts include tactical replies
// from a solved hypothetical two-trick ending, not knowledge of the actual deal.
// Sparse branches fall back to the public policy instead of treating one sampled
// allocation as knowledge of the actual deal.
function search(
   worlds: World[],
   o: Observation,
   policies: HardestPolicies
): number {
   let value = 0;
   const active: World[] = [];
   for (const world of worlds) {
      if (world.terminal !== undefined)
         value += world.weight * matchValue(o, world.terminal);
      else active.push(world);
   }
   if (!active.length) return value;
   for (const group of groups(active, o.seat)) {
      // Public histories only split as play continues. A sparse group cannot
      // become large enough to search later, so finish its policy paths directly.
      if (group.length < HARDEST_STRATEGY.minInformationParticles) {
         for (const world of group) {
            while (world.terminal === undefined)
               play(world, choosePolicy(world, o.seat, policies));
            value += world.weight * matchValue(o, world.terminal);
         }
         continue;
      }
      const first = group[0];
      const choices = legalCards(
         first.hands[first.turn],
         first.trick,
         first.trump
      );
      if (
         first.turn === o.seat &&
         choices.length > 1 &&
         group.length >= HARDEST_STRATEGY.minInformationParticles
      ) {
         let best = -Infinity;
         for (const card of choices) {
            const next = group.map((world) => {
               const copy = clone(world);
               play(copy, card);
               return copy;
            });
            best = Math.max(best, search(next, o, policies));
         }
         value += best;
      } else {
         for (const world of group)
            play(world, choosePolicy(world, o.seat, policies));
         value += search(group, o, policies);
      }
   }
   return value;
}

export function hardestAction(
   o: Observation,
   rng: () => number,
   budget: number,
   policies: HardestPolicies
): Action {
   const actions = policies.actions(o);
   if (actions.length === 1) return actions[0];
   // Every legal continuation has the same score once a contract is settled.
   // Preserve the normal tie choice without sampling an already decided hand.
   if (
      o.phase === "playing" &&
      settledScore(o.maker!, o.alone, o.tricks) !== null
   )
      return actions[0];
   const particles: Particle[] = [];
   for (let index = 0; index < budget; index++) {
      const hands = policies.sample(o, rng);
      if (!hands) continue;
      const particle: Particle = {
         ...orderedHypothesis(o, hands, rng),
         weight: 0,
         // Carry a partner who may play simply; don't rely on opponents missing
         // a tactical reply. Public play subsequently updates these soft models.
         styles: Array.from({ length: 4 }, (_, seat) =>
            rng() <
            (team(seat as Seat) === team(o.seat)
               ? HARDEST_STRATEGY.partnerBasicPrior
               : HARDEST_STRATEGY.opponentBasicPrior)
               ? "basic"
               : "strategic"
         ),
      };
      particle.weight = particleLikelihood(o, particle, policies);
      particles.push(particle);
   }
   if (!particles.length) return policies.basic(o);
   const total = particles.reduce((sum, particle) => sum + particle.weight, 0);
   for (const particle of particles)
      particle.weight =
         HARDEST_STRATEGY.priorWeight / particles.length +
         (HARDEST_STRATEGY.evidenceWeight * particle.weight) / total;
   let best = actions[0],
      bestValue = -Infinity;
   for (const action of actions) {
      const information = beliefActionValue(o, action, particles, policies);
      const tactical = policies.forecast
         ? particles.reduce(
              (sum, particle) =>
                 sum +
                 particle.weight *
                    matchValue(
                       o,
                       team(o.seat) === 0
                          ? policies.forecast!(
                               o,
                               action,
                               particle.hands,
                               particle.styles[partner(o.seat)]
                            )
                          : -policies.forecast!(
                               o,
                               action,
                               particle.hands,
                               particle.styles[partner(o.seat)]
                            )
                    ),
              0
           )
         : information;
      // Blend conservative tactical replies with a continuation whose own future
      // decisions share public information. Neither forecast sees real hidden cards.
      const value =
         HARDEST_STRATEGY.tacticalWeight * tactical +
         HARDEST_STRATEGY.informationWeight * information;
      if (value > bestValue + 1e-12) {
         best = action;
         bestValue = value;
      }
   }
   return best;
}

// Also exposed for tactical audits against an independent rules-engine oracle.
export function beliefActionValue(
   o: Observation,
   action: Action,
   particles: Particle[],
   policies: HardestPolicies
): number {
   const worlds = particles.map((particle) =>
      prepare(o, action, particle, policies)
   );
   for (const world of worlds) {
      while (
         world.terminal === undefined &&
         world.hands.some(
            (hand, seat) =>
               seat !== world.sittingOut &&
               hand.length > HARDEST_STRATEGY.informationTricks
         )
      )
         play(world, choosePolicy(world, o.seat, policies));
   }
   return search(worlds, o, policies);
}
