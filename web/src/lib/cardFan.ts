import type { CSSProperties } from "react";

/** The same gentle parabola is used for the Rules example and the live hand. */
export function cardFanStyle(index: number, count: number): CSSProperties {
   const distance = index - (count - 1) / 2;
   return {
      transform: `translateY(calc(${
         distance ** 2
      } * var(--hand-fan-arc, 2.5px))) rotate(calc(${distance} * var(--hand-fan-rotation, 5deg)))`,
      transformOrigin: "center bottom",
   };
}
