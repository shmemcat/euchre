import type { CSSProperties } from "react";
import { asset } from "@/lib/assets";
export function EuchreLogo({
   size = 250,
   filled = false,
   style,
}: {
   size?: number;
   filled?: boolean;
   style?: CSSProperties;
}) {
   const mask = `url("${asset(
      filled ? "icons/moon-stars-fill.svg" : "icons/moon-stars-thin.svg"
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
