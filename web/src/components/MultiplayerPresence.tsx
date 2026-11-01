import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useMultiplayer } from "@/context/MultiplayerContext";

// Changing between a table's lobby and game keeps its connection. Leaving both
// screens releases presence while retaining the membership needed to resume.
export function MultiplayerPresence() {
   const { pathname } = useLocation();
   const { command } = useMultiplayer();
   const code =
      pathname.match(/^\/game\/(?:lobby|multi-play)\/([^/]+)/)?.[1] ?? null;
   const previous = useRef<string | null>(null);
   useEffect(() => {
      const departed = previous.current;
      previous.current = code;
      if (departed && departed !== code)
         void command({ type: "unwatch", code: departed }).catch(() => {});
   }, [code, command]);
   return null;
}
