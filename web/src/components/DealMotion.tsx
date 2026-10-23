import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Seat } from "@/game/engine";
import { useSound } from "@/context/SoundContext";
import { asset } from "@/lib/assets";
import {
   dealCards,
   DEAL_DURATION_MS,
   DEAL_HAND_REVEAL_MS,
   DEAL_KITTY_START_MS,
   DEAL_KITTY_ARRIVAL_MS,
   DEAL_PACKET_STARTS_MS,
   DEAL_SHUFFLE_MS,
} from "@/lib/dealAnimation";

/** Flights share the opening step's clock; pausing never restarts the deal. */
export function DealMotion({
   dealer,
   board,
   paused,
}: {
   dealer: Seat;
   board: RefObject<HTMLElement | null>;
   paused: boolean;
}) {
   const layer = useRef<HTMLDivElement>(null);
   const animations = useRef<Animation[]>([]);
   const { play } = useSound();
   const playSound = useRef(play);
   playSound.current = play;
   const soundClock = useRef({ elapsed: 0, played: new Set<number>() });

   useEffect(() => {
      const root = board.current;
      const overlay = layer.current;
      if (!root || !overlay) return;
      const dealerSeat = root.querySelector(
         `.seat-${dealer} .player-seat-card`
      );
      const kitty = root.querySelector(".upcard-stack");
      if (!dealerSeat || !kitty) return;
      const reduced = window.matchMedia?.(
         "(prefers-reduced-motion: reduce)"
      ).matches;
      const animate = (element: Element, frames: Keyframe[]) => {
         const animation = element.animate?.(frames, {
            duration: DEAL_DURATION_MS,
            fill: "both",
         });
         if (animation) animations.current.push(animation);
      };
      const rect = (element: Element) => {
         const box = element.getBoundingClientRect();
         return {
            x: box.left + window.scrollX + box.width / 2,
            y: box.top + window.scrollY + box.height / 2,
            width: box.width,
            height: box.height,
         };
      };
      const seatBox = dealerSeat.getBoundingClientRect();
      const stockOnRight = dealer === 1 || dealer === 2;
      // Clear the top player's card fan when a side seat deals on mobile.
      const stockOffsetY =
         (dealer === 1 || dealer === 3) &&
         window.matchMedia?.("(max-width: 768px)").matches
            ? 16
            : 0;
      // Keep the stock beside the label: top/west right, bottom/east left.
      const source = {
         x:
            window.scrollX +
            (stockOnRight ? seatBox.right + 10 + 17 : seatBox.left - 10 - 17),
         y: window.scrollY + seatBox.top + seatBox.height / 2 + stockOffsetY,
      };
      const deck = overlay.querySelector<HTMLElement>(".deal-stock")!;
      Object.assign(deck.style, {
         left: `${source.x - 17}px`,
         top: `${source.y - 24}px`,
         visibility: "visible",
      });
      animate(deck, [
         { opacity: 1, offset: 0 },
         { opacity: 1, offset: DEAL_KITTY_START_MS / DEAL_DURATION_MS },
         { opacity: 0, offset: (DEAL_KITTY_START_MS + 60) / DEAL_DURATION_MS },
         { opacity: 0, offset: 1 },
      ]);
      // Cards stay parallel and flutter down the stock's top-right diagonal.
      deck.querySelectorAll("img").forEach((card, index) => {
         const start = (index / 10) * DEAL_SHUFFLE_MS;
         const settle = ((index + 2) / 10) * DEAL_SHUFFLE_MS;
         const stacked = `translate(${index}px, ${-index}px)`;
         const lifted = reduced
            ? stacked
            : `translate(${index + 3}px, ${-index - 3}px)`;
         animate(card, [
            { opacity: 0, transform: lifted, offset: 0 },
            {
               opacity: 0,
               transform: lifted,
               offset: start / DEAL_DURATION_MS,
            },
            {
               opacity: 1,
               transform: lifted,
               offset: (start + 20) / DEAL_DURATION_MS,
               easing: "ease-out",
            },
            {
               opacity: 1,
               transform: reduced
                  ? stacked
                  : `translate(${index - 0.25}px, ${0.25 - index}px)`,
               offset: (settle - 30) / DEAL_DURATION_MS,
               easing: "ease-out",
            },
            {
               opacity: 1,
               transform: stacked,
               offset: settle / DEAL_DURATION_MS,
            },
            { opacity: 1, transform: stacked, offset: 1 },
         ]);
      });
      const cards = dealCards(dealer);
      overlay
         .querySelectorAll<HTMLElement>(".deal-flight")
         .forEach((flight, index) => {
            const card = cards[index];
            const target = card
               ? root.querySelector(
                    `.seat-${card.seat} [data-deal-card="${card.index}"]`
                 )
               : kitty;
            if (!target) return;
            const destination = rect(target);
            const start = card?.start ?? DEAL_KITTY_START_MS;
            const arrival = card?.arrival ?? DEAL_KITTY_ARRIVAL_MS;
            const rotation = card ? (card.index - 2) * 8 : 0;
            const from = `translate(${source.x - 17}px, ${source.y - 24}px)`;
            const to = `translate(${destination.x - 17}px, ${
               destination.y - 24
            }px) rotate(${rotation}deg) scale(${
               card ? 1 : destination.width / 34
            }, ${card ? 1 : destination.height / 48})`;
            animate(flight, [
               { opacity: 0, transform: reduced ? to : from, offset: 0 },
               {
                  opacity: 0,
                  transform: reduced ? to : from,
                  offset: start / DEAL_DURATION_MS,
               },
               {
                  opacity: 1,
                  transform: reduced ? to : from,
                  offset: (start + 1) / DEAL_DURATION_MS,
               },
               {
                  opacity: 1,
                  transform: to,
                  offset: (arrival - 1) / DEAL_DURATION_MS,
               },
               {
                  opacity: 0,
                  transform: to,
                  offset: arrival / DEAL_DURATION_MS,
               },
               { opacity: 0, transform: to, offset: 1 },
            ]);
         });
      const mini = root.querySelector(".seat-0 .hidden-hand");
      if (mini) {
         const from = rect(mini);
         root
            .querySelectorAll<HTMLElement>(".player-hand .hand-card")
            .forEach((card) => {
               const target = rect(card);
               const finalTransform = getComputedStyle(card).transform;
               const initialTransform = reduced
                  ? finalTransform
                  : `translate(${from.x - target.x}px, ${
                       from.y - target.y
                    }px) scale(0.38)`;
               animate(card, [
                  { opacity: 0, transform: initialTransform, offset: 0 },
                  {
                     opacity: 0,
                     transform: initialTransform,
                     offset: DEAL_HAND_REVEAL_MS / DEAL_DURATION_MS,
                  },
                  {
                     opacity: 1,
                     transform: initialTransform,
                     offset: (DEAL_HAND_REVEAL_MS + 1) / DEAL_DURATION_MS,
                     easing: "ease-out",
                  },
                  { opacity: 1, transform: finalTransform, offset: 1 },
               ]);
            });
      }
      // Responsive layouts can move the table while a phone rotates or resizes.
      // Finish in place on resize instead of leaving flights at stale coordinates.
      const finish = () =>
         animations.current.forEach((animation) => animation.finish());
      window.addEventListener("resize", finish);
      return () => {
         window.removeEventListener("resize", finish);
         animations.current.forEach((animation) => animation.cancel());
         animations.current = [];
      };
   }, [board, dealer]);

   useEffect(() => {
      animations.current.forEach((animation) =>
         paused ? animation.pause() : animation.play()
      );
   }, [paused]);

   useEffect(() => {
      if (paused) return;
      const started = performance.now();
      const cues = [
         { time: 0, sound: "deal" as const },
         ...[...DEAL_PACKET_STARTS_MS, DEAL_KITTY_START_MS].map((time) => ({
            time,
            sound: "shuffle" as const,
         })),
      ];
      const timers = cues.map(({ time, sound }, index) => {
         if (soundClock.current.played.has(index)) return;
         return window.setTimeout(() => {
            soundClock.current.played.add(index);
            playSound.current(sound);
         }, Math.max(0, time - soundClock.current.elapsed));
      });
      return () => {
         timers.forEach((timer) => window.clearTimeout(timer));
         soundClock.current.elapsed += performance.now() - started;
      };
   }, [paused]);

   return createPortal(
      <div ref={layer} className="deal-overlay" aria-hidden="true">
         <div className="deal-stock">
            {Array.from({ length: 4 }, (_, index) => (
               <img
                  key={index}
                  src={asset("cards/back.svg")}
                  alt=""
                  draggable={false}
               />
            ))}
         </div>
         {Array.from({ length: 24 }, (_, index) => (
            <img
               key={index}
               className="deal-flight"
               src={asset("cards/back.svg")}
               alt=""
               draggable={false}
            />
         ))}
      </div>,
      document.body
   );
}
