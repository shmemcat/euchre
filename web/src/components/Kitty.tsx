import { Card } from "@/components/Card";
import type { Game } from "@/game/engine";
import type { OpeningStep } from "@/hooks/useOpeningSequence";
import { asset } from "@/lib/assets";

export function Kitty({
   game,
   step,
}: {
   game: Game;
   step: OpeningStep | null;
}) {
   const faceDown = game.phase === "bidding2" || game.phase === "discard";
   const turning = step?.kind === "turn-down";
   const dealing = step?.kind === "deal";
   return (
      <div
         className={`kitty-display${turning ? " kitty-turning" : ""}${
            faceDown ? " kitty-facedown" : ""
         }${step?.kind === "pickup" ? " kitty-picking-up" : ""}${
            dealing ? " kitty-dealing" : ""
         }`}
         aria-hidden={dealing}
      >
         <div className="upcard-stack">
            {[3, 2, 1].map((index) => (
               <img
                  key={index}
                  className={`kitty-back kitty-back-${index}`}
                  src={asset("cards/back.svg")}
                  alt={index === 1 ? "Face-down cards beneath the upcard" : ""}
                  draggable={false}
                  aria-hidden={faceDown || index !== 1}
               />
            ))}
            <div className="upcard-flipper">
               <div className="upcard-front" aria-hidden={faceDown}>
                  <Card code={game.upCard} trump={game.trump} />
               </div>
               <img
                  className="upcard-reverse"
                  src={asset("cards/back.svg")}
                  alt={
                     game.phase === "discard" ? "Kitty" : "Turned-down upcard"
                  }
                  draggable={false}
                  aria-hidden={!faceDown}
               />
            </div>
         </div>
         <span className="upcard-label">
            {game.phase === "bidding2"
               ? "Turned down"
               : game.phase === "discard"
               ? "Kitty"
               : "Upcard"}
         </span>
      </div>
   );
}
