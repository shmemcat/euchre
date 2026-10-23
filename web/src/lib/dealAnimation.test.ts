import { describe, expect, it } from "vitest";
import {
   dealCards,
   DEAL_HAND_REVEAL_MS,
   DEAL_KITTY_START_MS,
   DEAL_SHUFFLE_MS,
} from "./dealAnimation";

describe("Traditional Euchre deal", () => {
   it.each([0, 1, 2, 3] as const)(
      "deals two alternating passes from dealer %i",
      (dealer) => {
         const cards = dealCards(dealer);
         expect(Math.min(...cards.map((card) => card.start))).toBeGreaterThan(
            DEAL_SHUFFLE_MS
         );
         const packets = cards.reduce<{ seat: number; count: number }[]>(
            (packets, card) => {
               const last = packets[packets.length - 1];
               if (last?.seat === card.seat) last.count++;
               else packets.push({ seat: card.seat, count: 1 });
               return packets;
            },
            []
         );
         expect(packets.map((packet) => packet.count)).toEqual([
            3, 2, 3, 2, 2, 3, 2, 3,
         ]);
         expect(packets.map((packet) => packet.seat)).toEqual(
            Array.from({ length: 8 }, (_, index) => (dealer + 1 + index) % 4)
         );
         for (let seat = 0; seat < 4; seat++)
            expect(
               cards
                  .filter((card) => card.seat === seat)
                  .map((card) => card.index)
            ).toEqual([0, 1, 2, 3, 4]);
         expect(Math.max(...cards.map((card) => card.arrival))).toBeLessThan(
            DEAL_KITTY_START_MS
         );
         expect(DEAL_KITTY_START_MS).toBeLessThan(DEAL_HAND_REVEAL_MS);
      }
   );
});
