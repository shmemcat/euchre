import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Card, CardPlaceholder, SuitIcon } from "@/components/Card";
import { useSound } from "@/context/SoundContext";
import { seatName, SUIT_NAMES, type Game, type Seat } from "@/game/engine";

// Match Hearts: hold the completed trick, sweep, then allow a short clear buffer.
const HOLD_MS = 1000;
const SWEEP_MS = 350;
const COLLECT_MS = SWEEP_MS + 100;
const SEATS: Seat[] = [0, 1, 2, 3];

export function Trick({
   game,
   paused,
   onCollected,
}: {
   game: Game;
   paused: boolean;
   onCollected: () => void;
}) {
   const sound = useSound();
   const callbacks = useRef({ onCollected, play: sound.play });
   callbacks.current = { onCollected, play: sound.play };
   const cards = useRef<(HTMLDivElement | null)[]>([]);
   const animations = useRef<Animation[]>([]);
   const countdown = useRef({ key: "", remaining: 0 });
   const [sweepingTrick, setSweepingTrick] = useState<string | null>(null);
   const trickId =
      game.phase === "trick_complete"
         ? `${game.id}:${game.handNumber}:${game.completedTricks.length}`
         : null;
   const collecting = trickId !== null && sweepingTrick === trickId;
   const winner = game.turn;
   const showCards = game.phase === "playing" || trickId !== null;

   useEffect(() => {
      const key = `${trickId}:${collecting}`;
      if (countdown.current.key !== key) {
         countdown.current = {
            key,
            remaining: collecting ? COLLECT_MS : HOLD_MS,
         };
      }
      if (trickId === null || paused) return;

      const started = performance.now();
      const timer = window.setTimeout(() => {
         if (collecting) callbacks.current.onCollected();
         else {
            setSweepingTrick(trickId);
            callbacks.current.play("trick");
         }
      }, countdown.current.remaining);
      return () => {
         clearTimeout(timer);
         countdown.current.remaining = Math.max(
            0,
            countdown.current.remaining - (performance.now() - started)
         );
      };
   }, [trickId, collecting, paused]);

   useLayoutEffect(() => {
      if (!collecting) return;
      const target = cards.current[winner]?.getBoundingClientRect();
      if (!target) return;
      const reducedMotion = window.matchMedia?.(
         "(prefers-reduced-motion: reduce)"
      ).matches;

      for (const card of cards.current) {
         if (!card?.animate) continue;
         const source = card.getBoundingClientRect();
         const x = reducedMotion ? 0 : target.left - source.left;
         const y = reducedMotion ? 0 : target.top - source.top;
         const keyframes: Keyframe[] = [
            { opacity: 1, transform: "translate(0, 0)" },
         ];
         if (x !== 0 && y !== 0) {
            // Adjacent cards arc inward before meeting at the winner's slot.
            const vertical = winner === 0 || winner === 2;
            keyframes.push({
               opacity: 0.5,
               transform: `translate(${x * (vertical ? 0.6 : 0.25)}px, ${
                  y * (vertical ? 0.25 : 0.6)
               }px)`,
               offset: 0.4,
            });
         }
         keyframes.push({ opacity: 0, transform: `translate(${x}px, ${y}px)` });
         animations.current.push(
            card.animate(keyframes, {
               duration: SWEEP_MS,
               easing: "ease-in",
               fill: "forwards",
            })
         );
      }
      return () => {
         animations.current.forEach((animation) => animation.cancel());
         animations.current = [];
      };
   }, [collecting, trickId, winner]);

   useEffect(() => {
      animations.current.forEach((animation) =>
         paused ? animation.pause() : animation.play()
      );
   }, [paused, collecting]);

   return (
      <div
         className={`trick-table${collecting ? " is-collecting" : ""}`}
         role="group"
         aria-label="Current trick"
      >
         {game.trump && (
            <span
               className="table-trump"
               role="img"
               aria-label={`${SUIT_NAMES[game.trump]} trump`}
               title={`${SUIT_NAMES[game.trump]} trump`}
            >
               <SuitIcon suit={game.trump} />
            </span>
         )}
         {SEATS.filter((seat) => seat !== game.sittingOut).map((seat) => {
            const play = showCards
               ? game.trick.find((play) => play.seat === seat)
               : undefined;
            return (
               <div
                  className={`trick-slot trick-slot-${seat}`}
                  key={seat}
                  role="group"
                  aria-label={`${seatName(game, seat)} ${
                     play ? "played" : "card slot"
                  }`}
               >
                  <CardPlaceholder />
                  {play && (
                     <div
                        className="trick-card"
                        key={play.card}
                        ref={(element) => {
                           cards.current[seat] = element;
                        }}
                     >
                        <Card code={play.card} trump={game.trump} />
                     </div>
                  )}
               </div>
            );
         })}
      </div>
   );
}
