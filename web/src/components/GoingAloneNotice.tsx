import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCrown } from "@fortawesome/pro-solid-svg-icons/faCrown";
import { SuitIcon } from "@/components/Card";
import { partner, seatName, SUIT_NAMES, type Game } from "@/game/engine";
import type { OpeningStep } from "@/hooks/useOpeningSequence";
import "@/styles/going-alone.css";

/** Golf's announcement pattern, held by the opening sequence like foot pickup. */
export function GoingAloneNotice({
   game,
   step,
   spectating,
}: {
   game: Game;
   step: Extract<OpeningStep, { kind: "alone" }>;
   spectating: boolean;
}) {
   const sittingOut = partner(step.seat);
   const suitName = SUIT_NAMES[step.suit];
   return (
      <div
         className="going-alone-announcer"
         role="status"
         aria-label="Going alone"
         aria-live="polite"
         aria-atomic="true"
      >
         <div
            className="going-alone-ribbon"
            style={{ animationDuration: `${step.duration}ms` }}
         >
            <strong>
               <FontAwesomeIcon icon={faCrown} aria-hidden="true" />
               <span>
                  {step.seat === 0 && !spectating
                     ? "You are going alone"
                     : `${seatName(game, step.seat)} is going alone`}
               </span>
            </strong>
            <span className="going-alone-detail">
               <span>
                  <span aria-hidden="true"><SuitIcon suit={step.suit} /></span>{" "}
                  {suitName.charAt(0).toUpperCase() + suitName.slice(1)} are trump
               </span>
               <span aria-hidden="true"> · </span>
               <span>
                  {sittingOut === 0 && !spectating
                     ? "You sit out"
                     : `${seatName(game, sittingOut)} sits out`}
               </span>
            </span>
         </div>
      </div>
   );
}
