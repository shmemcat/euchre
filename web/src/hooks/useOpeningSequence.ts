import {
   useCallback,
   useEffect,
   useLayoutEffect,
   useRef,
   useState,
} from "react";
import { useSound } from "@/context/SoundContext";
import {
   SUIT_NAMES,
   type Action,
   type Card,
   type Game,
   type Seat,
   type Suit,
} from "@/game/engine";

export type OpeningStep =
   | { kind: "deal"; duration: number }
   | { kind: "bid"; duration: number; seat: Seat; text: string; suit?: Suit }
   | { kind: "turn-down"; duration: number }
   | {
        kind: "pickup" | "receive";
        duration: number;
        seat: Seat;
        card: Card;
        suit: Suit;
     }
   | { kind: "discard"; duration: number; seat: Seat; card: Card | null };

type Sequence = {
   game: Game;
   steps: OpeningStep[];
   index: number;
   action?: Action;
   committed: boolean;
};

const OPENING_PAUSE_MS = 150;
export const OPENING_BOT_DELAY_MS = 850 + OPENING_PAUSE_MS;
export const OPENING_DEAL_MS = 1050 + OPENING_PAUSE_MS;

export function openingSteps(
   game: Game,
   action: Action | { type: "discard"; card: null }
): OpeningStep[] {
   const steps: OpeningStep[] = [];
   if (action.type === "pass" || action.type === "call") {
      if (game.turn !== 0)
         steps.push({
            kind: "bid",
            duration: 1100 + OPENING_PAUSE_MS,
            seat: game.turn,
            text:
               action.type === "pass"
                  ? "Passed"
                  : game.phase === "bidding1"
                  ? "Ordered Up"
                  : SUIT_NAMES[action.suit],
            suit:
               action.type === "call" && game.phase === "bidding2"
                  ? action.suit
                  : undefined,
         });
      if (
         action.type === "pass" &&
         game.phase === "bidding1" &&
         game.passes === 3
      )
         steps.push({ kind: "turn-down", duration: 800 });
      if (action.type === "call" && game.phase === "bidding1") {
         steps.push({
            kind: "pickup",
            duration: 550,
            seat: game.dealer,
            card: game.upCard,
            suit: action.suit,
         });
         if (game.dealer === 0)
            steps.push({
               kind: "receive",
               duration: 100,
               seat: 0,
               card: game.upCard,
               suit: action.suit,
            });
      }
   } else if (action.type === "discard") {
      steps.push({
         kind: "discard",
         duration: 400,
         seat: game.turn,
         card: action.card,
      });
   }
   return steps;
}

const handKey = (game: Game | null) =>
   game ? `${game.id}:${game.handNumber}` : "";
function dealSequence(game: Game | null): Sequence | null {
   return game?.phase === "bidding1" && game.passes === 0
      ? {
           game,
           steps: [{ kind: "deal", duration: OPENING_DEAL_MS }],
           index: 0,
           committed: false,
        }
      : null;
}

/** Keep the rules state in place until each visible opening action finishes. */
export function useOpeningSequence(
   game: Game | null,
   act: (action: Action) => void,
   paused: boolean
) {
   const { play } = useSound();
   const [sequence, setSequence] = useState<Sequence | null>(() =>
      dealSequence(game)
   );
   const pending = useRef(sequence);
   const latest = useRef({ game, act, paused, play });
   latest.current = { game, act, paused, play };
   const previousHand = useRef(handKey(game));
   const countdown = useRef({ step: null as OpeningStep | null, remaining: 0 });
   const update = useCallback((next: Sequence | null) => {
      pending.current = next;
      setSequence(next);
   }, []);

   useLayoutEffect(() => {
      const key = handKey(game);
      if (key !== previousHand.current) {
         previousHand.current = key;
         update(dealSequence(game));
      } else if (
         sequence &&
         (!game ||
            game.phase === "game_over" ||
            (!sequence.committed && sequence.game !== game) ||
            (sequence.committed && game.phase !== "discard"))
      )
         update(null);
   }, [game, sequence, update]);

   const step = sequence?.steps[sequence.index] ?? null;
   useEffect(() => {
      if (!sequence || !step) return;
      if (countdown.current.step !== step)
         countdown.current = { step, remaining: step.duration };
      if (paused) return;
      const started = performance.now();
      const timer = window.setTimeout(() => {
         const current = latest.current;
         if (
            !current.game ||
            handKey(current.game) !== handKey(sequence.game) ||
            (!sequence.committed && current.game !== sequence.game)
         ) {
            update(null);
            return;
         }
         const nextIndex = sequence.index + 1;
         const next = sequence.steps[nextIndex];
         // The upcard enters the real hand before its raised-card settle.
         const commit =
            !sequence.committed &&
            sequence.action &&
            (!next || next.kind === "receive");
         update(
            next
               ? {
                    ...sequence,
                    index: nextIndex,
                    committed: sequence.committed || !!commit,
                 }
               : null
         );
         if (commit) current.act(sequence.action!);
      }, countdown.current.remaining);
      return () => {
         clearTimeout(timer);
         countdown.current.remaining = Math.max(
            0,
            countdown.current.remaining - (performance.now() - started)
         );
      };
   }, [sequence, step, paused, update]);

   const perform = useCallback(
      (action: Action) => {
         const { game, act, paused, play } = latest.current;
         if (!game || paused || pending.current) return;
         if (action.type === "call") play("trump");
         const steps = openingSteps(game, action);
         if (steps.length)
            update({ game, steps, index: 0, action, committed: false });
         else act(action);
      },
      [update]
   );

   return { step, busy: sequence !== null, perform };
}
