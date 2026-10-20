import type { CSSProperties } from "react";

/** The same gentle parabola is used for the Rules example and the live hand. */
export function cardFanStyle(index: number, count: number): CSSProperties {
   const distance = index - (count - 1) / 2;
   return {
      transform: `translateY(${distance ** 2 * 2.5}px) rotate(${
         distance * 5
      }deg)`,
      transformOrigin: "center bottom",
   };
}
