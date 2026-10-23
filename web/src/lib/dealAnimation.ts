import type { Seat } from "@/game/engine";
import type { CSSProperties } from "react";

// The short fan recording lasts 0.721s and finishes before the first packet.
export const DEAL_SHUFFLE_MS = 750;
export const DEAL_DURATION_MS = DEAL_SHUFFLE_MS + 3600;
export const DEAL_KITTY_START_MS = DEAL_SHUFFLE_MS + 2360;
export const DEAL_KITTY_ARRIVAL_MS = DEAL_SHUFFLE_MS + 2660;
export const DEAL_FLIP_MS = DEAL_SHUFFLE_MS + 2700;
export const DEAL_HAND_REVEAL_MS = DEAL_SHUFFLE_MS + 3180;
export const DEAL_PACKET_STARTS_MS = Array.from(
   { length: 8 },
   (_, packet) => DEAL_SHUFFLE_MS + 160 + packet * 250
);
export const dealTimingStyle = {
   "--deal-shuffle-duration": `${DEAL_SHUFFLE_MS}ms`,
} as CSSProperties;

export const shouldAnimateDeal = () =>
   !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Two clockwise passes, starting to the dealer's left. */
export function dealCards(dealer: Seat) {
   const counts = [0, 0, 0, 0];
   return [3, 2, 3, 2, 2, 3, 2, 3].flatMap((count, packet) => {
      const seat = ((dealer + 1 + packet) % 4) as Seat;
      return Array.from({ length: count }, (_, card) => ({
         seat,
         index: counts[seat]++,
         start: DEAL_PACKET_STARTS_MS[packet] + card * 45,
         arrival: DEAL_PACKET_STARTS_MS[packet] + card * 45 + 260,
      }));
   });
}

export function miniCardTransform(index: number, count: number) {
   const distance = index - (count - 1) / 2;
   return `rotate(${distance * 8}deg) translateY(${Math.abs(distance) * 2}px)`;
}
