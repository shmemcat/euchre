import type { CSSProperties } from "react";
import { asset } from "@/lib/assets";
export function EuchreLogo({
   size = 250,
   style,
}: {
   size?: number;
   style?: CSSProperties;
}) {
   const mask = `url("${asset(
      "icons/moon-stars-thin.svg"
   )}") center / contain no-repeat`;
   return (
      <div
         aria-hidden="true"
         className="euchre-logo"
         style={{
            width: size,
            height: size,
            backgroundColor: "currentColor",
            mask,
            WebkitMask: mask,
            flexShrink: 0,
            ...style,
         }}
      />
   );
}
