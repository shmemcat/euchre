// Four-player partnership Euchre, following Bicycle's rules without rubbers.
export const SUITS = ["c", "d", "s", "h"] as const;
export const RANKS = ["9", "10", "J", "Q", "K", "A"] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type Card = `${Rank}${Suit}`;
export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;
export type Difficulty = "easy" | "medium" | "hard" | "harder" | "hardest";
export type Phase =
   | "bidding1"
   | "bidding2"
   | "discard"
   | "playing"
   | "trick_complete"
   | "round_complete"
   | "game_over";
export type Play = { seat: Seat; card: Card };
export type Trick = { plays: Play[]; winner: Seat };
export type RoundResult = {
   hand: number;
   maker: Seat;
   trump: Suit;
   alone: boolean;
   tricks: [number, number];
   points: [number, number];
   scores: [number, number];
};
export type Action =
   | { type: "pass" }
   | { type: "call"; suit: Suit; alone: boolean }
   | { type: "discard"; card: Card }
   | { type: "play"; card: Card }
   | { type: "advance" };
export type Game = {
   version: 1;
   id: string;
   difficulty: Difficulty;
   playerName: string;
   phase: Phase;
   handNumber: number;
   dealer: Seat;
   turn: Seat;
   hands: Card[][];
   kitty: Card[];
   upCard: Card;
   trump: Suit | null;
   maker: Seat | null;
   alone: boolean;
   sittingOut: Seat | null;
   passes: number;
   trick: Play[];
   completedTricks: Trick[];
   tricks: [number, number];
   scores: [number, number];
   results: RoundResult[];
   target: 10;
   message: string;
   finishedAt: string | null;
   conceded: boolean;
   seatNames?: string[];
   seatIcons?: string[];
   humanSeats?: boolean[];
   teamNames?: string[];
};
export const SUIT_NAMES: Record<Suit, string> = {
   c: "clubs",
   d: "diamonds",
   s: "spades",
   h: "hearts",
};
export const SUIT_SYMBOLS: Record<Suit, string> = {
   c: "♣",
   d: "♦",
   s: "♠",
   h: "♥",
};
export const DECK: Card[] = SUITS.flatMap((suit) =>
   RANKS.map((rank) => `${rank}${suit}` as Card)
);
export const nextSeat = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;
export const partner = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;
export const team = (seat: Seat): Team => (seat % 2) as Team;
export const suitOf = (card: Card): Suit => card.slice(-1) as Suit;
export const rankOf = (card: Card): Rank => card.slice(0, -1) as Rank;
export const sameColor = (suit: Suit): Suit =>
   (({ c: "s", s: "c", d: "h", h: "d" } as const)[suit]);
export const isCard = (value: unknown): value is Card =>
   typeof value === "string" && DECK.includes(value as Card);
export const cardName = (card: Card): string =>
   `${
      (
         { J: "Jack", Q: "Queen", K: "King", A: "Ace" } as Record<
            string,
            string
         >
      )[rankOf(card)] ?? rankOf(card)
   } of ${SUIT_NAMES[suitOf(card)]}`;

export function effectiveSuit(card: Card, trump: Suit | null): Suit {
   return trump && rankOf(card) === "J" && suitOf(card) === sameColor(trump)
      ? trump
      : suitOf(card);
}

export function strength(card: Card, trump: Suit | null): number {
   if (trump && effectiveSuit(card, trump) === trump) {
      if (rankOf(card) === "J") return suitOf(card) === trump ? 30 : 29;
      return 20 + RANKS.indexOf(rankOf(card));
   }
   return RANKS.indexOf(rankOf(card));
}

export function legalCards(
   hand: Card[],
   trick: Play[],
   trump: Suit | null
): Card[] {
   if (!trick.length) return [...hand];
   const led = effectiveSuit(trick[0].card, trump);
   const matching = hand.filter((card) => effectiveSuit(card, trump) === led);
   return matching.length ? matching : [...hand];
}

export function trickWinner(plays: Play[], trump: Suit | null): Seat {
   if (!plays.length) throw new Error("A trick needs a card.");
   const led = effectiveSuit(plays[0].card, trump);
   const value = (card: Card) =>
      strength(card, trump) + (effectiveSuit(card, trump) === led ? 10 : 0);
   return plays.reduce((best, play) =>
      value(play.card) > value(best.card) ? play : best
   ).seat;
}

export function scoreHand(
   makerTeam: Team,
   makerTricks: number,
   alone: boolean
): [number, number] {
   const result: [number, number] = [0, 0];
   const winner = makerTricks < 3 ? ((1 - makerTeam) as Team) : makerTeam;
   result[winner] =
      makerTricks < 3 ? 2 : makerTricks === 5 ? (alone ? 4 : 2) : 1;
   return result;
}

export function shuffle<T>(
   cards: readonly T[],
   rng: () => number = Math.random
): T[] {
   const shuffled = [...cards];
   for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
   }
   return shuffled;
}

export function seatName(game: Pick<Game, "playerName" | "seatNames">, seat: Seat): string {
   if (game.seatNames) return game.seatNames[seat];
   return [game.playerName || "You", "West", "Partner", "East"][seat];
}

function phrase(
   game: Pick<Game, "playerName">,
   seat: Seat,
   verb: string,
   thirdPerson = `${verb}s`
): string {
   const name = seatName(game, seat);
   return `${name} ${name === "You" ? verb : thirdPerson}`;
}

function deal(game: Game, rng: () => number): Game {
   const deck = shuffle(DECK, rng);
   const hands: Card[][] = [[], [], [], []];
   let index = 0;
   // The same 2-then-3 deal is used for all four players.
   for (const count of [2, 3]) {
      let seat = nextSeat(game.dealer);
      for (let i = 0; i < 4; i++, seat = nextSeat(seat)) {
         hands[seat].push(...deck.slice(index, index + count));
         index += count;
      }
   }
   return {
      ...game,
      phase: "bidding1",
      turn: nextSeat(game.dealer),
      hands,
      upCard: deck[20],
      kitty: deck.slice(20),
      trump: null,
      maker: null,
      alone: false,
      sittingOut: null,
      passes: 0,
      trick: [],
      completedTricks: [],
      tricks: [0, 0],
      message: `Hand ${game.handNumber}. ${phrase(game, game.dealer, "deal")}.`,
   };
}

export function newGame(
   difficulty: Difficulty = "easy",
   playerName = "You",
   rng: () => number = Math.random
): Game {
   return deal(
      {
         version: 1,
         id: crypto.randomUUID(),
         difficulty,
         playerName,
         phase: "bidding1",
         handNumber: 1,
         dealer: Math.floor(rng() * 4) as Seat,
         turn: 0,
         hands: [],
         kitty: [],
         upCard: "9c",
         trump: null,
         maker: null,
         alone: false,
         sittingOut: null,
         passes: 0,
         trick: [],
         completedTricks: [],
         tricks: [0, 0],
         scores: [0, 0],
         results: [],
         target: 10,
         message: "",
         finishedAt: null,
         conceded: false,
      },
      rng
   );
}

export function nextActive(seat: Seat, sittingOut: Seat | null): Seat {
   const next = nextSeat(seat);
   return next === sittingOut ? nextSeat(next) : next;
}

function beginPlay(game: Game): void {
   game.phase = "playing";
   game.turn = nextActive(game.dealer, game.sittingOut);
   game.message = `${phrase(game, game.maker!, "call")} ${
      SUIT_NAMES[game.trump!]
   }${game.alone ? " alone" : ""}.`;
}

export function legalActions(game: Game): Action[] {
   if (game.phase === "bidding1" || game.phase === "bidding2") {
      const suits =
         game.phase === "bidding1"
            ? [suitOf(game.upCard)]
            : SUITS.filter((s) => s !== suitOf(game.upCard));
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
   if (game.phase === "discard")
      return game.hands[game.turn].map((card) => ({ type: "discard", card }));
   if (game.phase === "playing")
      return legalCards(game.hands[game.turn], game.trick, game.trump).map(
         (card) => ({ type: "play", card })
      );
   if (game.phase === "trick_complete" || game.phase === "round_complete")
      return [{ type: "advance" }];
   return [];
}

export function applyAction(
   original: Game,
   action: Action,
   rng: () => number = Math.random
): Game {
   const allowed = legalActions(original).some(
      (candidate) =>
         candidate.type === action.type &&
         (candidate.type === "call" && action.type === "call"
            ? candidate.suit === action.suit && candidate.alone === action.alone
            : (candidate.type === "play" || candidate.type === "discard") &&
              (action.type === "play" || action.type === "discard")
            ? candidate.card === action.card
            : true)
   );
   if (!allowed) throw new Error("That action is not legal right now.");
   const game: Game = structuredClone(original);
   const seat = game.turn;
   if (action.type === "pass") {
      game.message = `${phrase(game, seat, "pass", "passes")}.`;
      game.passes++;
      if (game.passes === 4) {
         if (game.phase === "bidding1") {
            game.phase = "bidding2";
            game.passes = 0;
            game.turn = nextSeat(game.dealer);
            game.message =
               "Everyone passed. Choose another trump suit, or pass.";
         } else {
            return {
               ...deal(
                  {
                     ...game,
                     dealer: nextSeat(game.dealer),
                     handNumber: game.handNumber + 1,
                  },
                  rng
               ),
               message:
                  "Everyone passed twice. The next dealer deals a fresh hand.",
            };
         }
      } else game.turn = nextSeat(seat);
   } else if (action.type === "call") {
      game.trump = action.suit;
      game.maker = seat;
      game.alone = action.alone;
      game.sittingOut = action.alone ? partner(seat) : null;
      if (game.phase === "bidding1") {
         game.hands[game.dealer].push(game.upCard);
         game.kitty = game.kitty.filter((card) => card !== game.upCard);
         game.phase = "discard";
         game.turn = game.dealer;
         game.message = `${phrase(game, seat, "order")} up ${
            SUIT_NAMES[action.suit]
         }${action.alone ? " alone" : ""}. ${phrase(
            game,
            game.dealer,
            "discard"
         )}.`;
      } else beginPlay(game);
   } else if (action.type === "discard") {
      game.hands[seat] = game.hands[seat].filter(
         (card) => card !== action.card
      );
      game.kitty.push(action.card);
      beginPlay(game);
   } else if (action.type === "play") {
      game.hands[seat] = game.hands[seat].filter(
         (card) => card !== action.card
      );
      game.trick.push({ seat, card: action.card });
      game.message = `${phrase(game, seat, "play")} the ${cardName(
         action.card
      ).toLowerCase()}.`;
      if (game.trick.length === (game.alone ? 3 : 4)) {
         const winner = trickWinner(game.trick, game.trump);
         game.tricks[team(winner)]++;
         game.completedTricks.push({ plays: [...game.trick], winner });
         game.turn = winner;
         game.phase = "trick_complete";
         game.message = `${phrase(game, winner, "take")} the trick.`;
      } else game.turn = nextActive(seat, game.sittingOut);
   } else if (action.type === "advance") {
      if (game.phase === "round_complete") {
         return deal(
            {
               ...game,
               dealer: nextSeat(game.dealer),
               handNumber: game.handNumber + 1,
            },
            rng
         );
      }
      if (game.completedTricks.length === 5) {
         const makerTeam = team(game.maker!);
         const points = scoreHand(
            makerTeam,
            game.tricks[makerTeam],
            game.alone
         );
         game.scores = [game.scores[0] + points[0], game.scores[1] + points[1]];
         game.results.push({
            hand: game.handNumber,
            maker: game.maker!,
            trump: game.trump!,
            alone: game.alone,
            tricks: [...game.tricks],
            points,
            scores: [...game.scores],
         });
         game.phase = game.scores.some((score) => score >= game.target)
            ? "game_over"
            : "round_complete";
         if (game.phase === "game_over")
            game.finishedAt = new Date().toISOString();
         game.message =
            game.tricks[makerTeam] < 3
               ? `${
                    makerTeam === 0 ? "Your team was" : "Opponents were"
                 } euchred!`
               : game.tricks[makerTeam] === 5
               ? game.alone
                  ? "A lone-hand sweep!"
                  : "Marched! All five tricks!"
               : "Hand complete.";
      } else {
         game.trick = [];
         game.phase = "playing";
      }
   }
   return game;
}

export function concede(game: Game): Game {
   return {
      ...game,
      phase: "game_over",
      conceded: true,
      finishedAt: new Date().toISOString(),
      message: "Game conceded.",
   };
}

// The bot boundary deliberately excludes opponents' hands and the buried cards.
export type Observation = {
   phase: Phase;
   seat: Seat;
   dealer: Seat;
   hand: Card[];
   counts: number[];
   upCard: Card;
   trump: Suit | null;
   maker: Seat | null;
   alone: boolean;
   sittingOut: Seat | null;
   trick: Play[];
   completedTricks: Trick[];
   tricks: [number, number];
   scores: [number, number];
   knownDiscard: Card | null;
   pickedUp: boolean;
   difficulty: Difficulty;
};

export function observe(game: Game): Observation {
   return {
      phase: game.phase,
      seat: game.turn,
      dealer: game.dealer,
      hand: [...game.hands[game.turn]],
      counts: game.hands.map((hand) => hand.length),
      upCard: game.upCard,
      trump: game.trump,
      maker: game.maker,
      alone: game.alone,
      sittingOut: game.sittingOut,
      trick: structuredClone(game.trick),
      completedTricks: structuredClone(game.completedTricks),
      tricks: [...game.tricks],
      scores: [...game.scores],
      difficulty: game.difficulty,
      pickedUp: game.trump === suitOf(game.upCard) && game.maker !== null,
      knownDiscard:
         game.turn === game.dealer &&
         game.kitty.length === 4 &&
         game.maker !== null &&
         game.trump === suitOf(game.upCard)
            ? game.kitty[3]
            : null,
   };
}

export function sortHand(hand: Card[], trump: Suit | null): Card[] {
   const order = trump
      ? [...SUITS.filter((s) => s !== trump), trump]
      : [...SUITS];
   return [...hand].sort(
      (a, b) =>
         order.indexOf(effectiveSuit(a, trump)) -
            order.indexOf(effectiveSuit(b, trump)) ||
         strength(a, trump) - strength(b, trump)
   );
}

// Check persisted input before allowing it into the engine. Never trust browser storage.
export function isGame(value: unknown): value is Game {
   if (!value || typeof value !== "object") return false;
   const g = value as Game;
   const seat = (s: unknown) =>
      Number.isInteger(s) && Number(s) >= 0 && Number(s) < 4;
   const pair = (p: unknown) =>
      Array.isArray(p) &&
      p.length === 2 &&
      p.every((n) => Number.isInteger(n) && n >= 0);
   const play = (p: Play) => p && seat(p.seat) && isCard(p.card);
   if (
      g.version !== 1 ||
      typeof g.id !== "string" ||
      !g.id ||
      !["easy", "medium", "hard", "harder", "hardest"].includes(g.difficulty) ||
      ![
         "bidding1",
         "bidding2",
         "discard",
         "playing",
         "trick_complete",
         "round_complete",
         "game_over",
      ].includes(g.phase) ||
      !seat(g.dealer) ||
      !seat(g.turn) ||
      !isCard(g.upCard) ||
      typeof g.playerName !== "string" ||
      !Number.isInteger(g.handNumber) ||
      g.handNumber < 1 ||
      !Number.isInteger(g.passes) ||
      g.passes < 0 ||
      g.passes > 3 ||
      !Array.isArray(g.hands) ||
      g.hands.length !== 4 ||
      !g.hands.every(
         (h) => Array.isArray(h) && h.length <= 6 && h.every(isCard)
      ) ||
      !Array.isArray(g.kitty) ||
      !g.kitty.every(isCard) ||
      !Array.isArray(g.trick) ||
      !g.trick.every(play) ||
      g.trick.length > 4 ||
      !Array.isArray(g.completedTricks) ||
      g.completedTricks.length > 5 ||
      !g.completedTricks.every(
         (t) =>
            t &&
            seat(t.winner) &&
            Array.isArray(t.plays) &&
            t.plays.every(play) &&
            t.plays.length === (g.alone ? 3 : 4)
      ) ||
      !pair(g.scores) ||
      !pair(g.tricks) ||
      g.tricks[0] + g.tricks[1] !== g.completedTricks.length ||
      !(g.trump === null || SUITS.includes(g.trump)) ||
      !(g.maker === null || seat(g.maker)) ||
      !(g.sittingOut === null || seat(g.sittingOut)) ||
      typeof g.alone !== "boolean" ||
      typeof g.conceded !== "boolean" ||
      typeof g.message !== "string" ||
      g.target !== 10 ||
      !(g.finishedAt === null || typeof g.finishedAt === "string") ||
      !Array.isArray(g.results) ||
      !g.results.every(
         (r) =>
            r &&
            seat(r.maker) &&
            SUITS.includes(r.trump) &&
            typeof r.alone === "boolean" &&
            Number.isInteger(r.hand) &&
            pair(r.tricks) &&
            pair(r.points) &&
            pair(r.scores)
      )
   )
      return false;
   const played = g.completedTricks.flatMap((t) => t.plays.map((p) => p.card));
   // A completed current trick is also recorded in completedTricks.
   const lastTrick = g.completedTricks[g.completedTricks.length - 1];
   const currentIsComplete =
      lastTrick && JSON.stringify(lastTrick.plays) === JSON.stringify(g.trick);
   const current = currentIsComplete ? [] : g.trick.map((p) => p.card);
   const cards = [...g.hands.flat(), ...g.kitty, ...played, ...current];
   return (
      cards.length === 24 &&
      new Set(cards).size === 24 &&
      (g.alone
         ? g.maker !== null && g.sittingOut === partner(g.maker)
         : g.sittingOut === null) &&
      (["bidding1", "bidding2"].includes(g.phase) ||
      (g.conceded && g.maker === null)
         ? g.maker === null && g.trump === null
         : g.maker !== null && g.trump !== null)
   );
}
