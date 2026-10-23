import {
   useCallback,
   useEffect,
   useLayoutEffect,
   useRef,
   useState,
} from "react";
import { useSound } from "@/context/SoundContext";
import type { Action, Game } from "@/game/engine";
import { shouldAnimateDeal } from "@/lib/dealAnimation";
import {
   OPENING_DEAL_MS,
   openingSteps,
   type OpeningStep,
} from "./useOpeningSequence";

type Sequence = {
   target: Game;
   steps: OpeningStep[];
   index: number;
   trump?: boolean;
};
type Playback = { game: Game | null; sequence: Sequence | null };
const handKey = (game: Game | null) =>
   game ? `${game.id}:${game.handNumber}` : null;

function initialPlayback(game: Game | null): Playback {
   return {
      game,
      sequence:
         game?.phase === "bidding1" && game.passes === 0 && shouldAnimateDeal()
            ? {
                 target: game,
                 steps: [{ kind: "deal", duration: OPENING_DEAL_MS }],
                 index: 0,
              }
            : null,
   };
}

function transition(
   before: Game,
   after: Game
): { sequence: Sequence | null; passed: boolean } {
   let action: Action | { type: "discard"; card: null } | undefined;
   if (before.phase === "bidding1" || before.phase === "bidding2") {
      if (after.maker !== null && after.trump !== null) {
         action = { type: "call", suit: after.trump, alone: after.alone };
         before = { ...before, turn: after.maker };
      } else if (
         (after.phase === before.phase && after.passes === before.passes + 1) ||
         (before.phase === "bidding1" && after.phase === "bidding2") ||
         (before.phase === "bidding2" &&
            after.phase === "round_complete" &&
            after.maker === null)
      )
         action = { type: "pass" };
   } else if (before.phase === "discard" && after.phase !== "discard") {
      // Other players' cards are null in server snapshots. Their discard flies
      // face down; only the local dealer's discarded card can be identified.
      action = {
         type: "discard",
         card:
            before.turn === 0
               ? before.hands[0].find(
                    (card) => !after.hands[0].includes(card)
                 ) ?? null
               : null,
      };
   }
   const steps = action ? openingSteps(before, action) : [];
   return {
      sequence: steps.length
         ? { target: after, steps, index: 0, trump: action?.type === "call" }
         : null,
      passed: action?.type === "pass",
   };
}

/** Play confirmed opening actions without delaying or replaying server commands. */
export function useMultiplayerOpeningSequence(
   game: Game | null,
   act: (action: Action) => void,
   paused: boolean,
   disabled: boolean
) {
   const { play } = useSound();
   const [playback, setPlayback] = useState(() => initialPlayback(game));
   const pending = useRef(playback);
   const received = useRef(game);
   const queue = useRef<Game[]>([]);
   const latest = useRef({ game, act, paused, disabled, play });
   latest.current = { game, act, paused, disabled, play };
   const countdown = useRef({ step: null as OpeningStep | null, remaining: 0 });
   const announced = useRef(game?.trump ? handKey(game) : null);
   const update = useCallback((next: Playback) => {
      pending.current = next;
      setPlayback(next);
   }, []);
   const drain = useCallback(
      (current: Playback) => {
         while (!current.sequence && current.game && queue.current.length) {
            const target = queue.current.shift()!;
            const { sequence, passed } = transition(current.game, target);
            if (passed) latest.current.play("pass");
            current = { game: sequence ? current.game : target, sequence };
         }
         update(current);
      },
      [update]
   );

   useLayoutEffect(() => {
      if (game === received.current) return;
      const previous = received.current;
      received.current = game;
      if (
         !game ||
         !previous ||
         game.id !== previous.id ||
         game.handNumber !== previous.handNumber ||
         game.phase === "game_over"
      ) {
         queue.current = [];
         update(initialPlayback(game));
      } else {
         queue.current.push(game);
         if (!pending.current.sequence) drain(pending.current);
      }
   }, [game, drain, update]);

   const sequence = playback.sequence;
   const step = sequence?.steps[sequence.index] ?? null;
   useEffect(() => {
      const key = handKey(playback.game);
      if (
         key &&
         (sequence?.trump || playback.game?.trump) &&
         announced.current !== key
      ) {
         announced.current = key;
         latest.current.play("trump");
      }
   }, [playback.game, sequence?.trump]);
   useEffect(() => {
      if (!sequence || !step) return;
      if (countdown.current.step !== step)
         countdown.current = { step, remaining: step.duration };
      if (paused) return;
      const started = performance.now();
      const timer = window.setTimeout(() => {
         if (pending.current.sequence !== sequence) return;
         const index = sequence.index + 1;
         const next = sequence.steps[index];
         if (next)
            update({
               game:
                  next.kind === "receive"
                     ? sequence.target
                     : pending.current.game,
               sequence: { ...sequence, index },
            });
         else drain({ game: sequence.target, sequence: null });
      }, countdown.current.remaining);
      return () => {
         clearTimeout(timer);
         countdown.current.remaining = Math.max(
            0,
            countdown.current.remaining - (performance.now() - started)
         );
      };
   }, [sequence, step, paused, drain, update]);

   const perform = useCallback((action: Action) => {
      const current = latest.current;
      if (
         !current.game ||
         current.paused ||
         current.disabled ||
         pending.current.sequence ||
         queue.current.length ||
         pending.current.game !== current.game
      )
         return;
      current.act(action);
   }, []);

   return {
      game: playback.game,
      step,
      busy: disabled || sequence !== null,
      perform,
   };
}
