import { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars } from "@fortawesome/pro-solid-svg-icons";
import { SuitIcon } from "@/components/Card";
import { Button } from "@/components/Buttons";
import { seatName, SUIT_NAMES, type Game } from "@/game/engine";

type Props = {
   game: Game;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onLeave: () => void;
   leaveDisabled?: boolean;
   leaveLabel?: string;
};

export function MatchInfo({
   game,
   open,
   onOpenChange,
   onLeave,
   leaveDisabled,
   leaveLabel = "Leave Game",
}: Props) {
   const wrap = useRef<HTMLDivElement>(null);
   const trigger = useRef<HTMLButtonElement>(null);

   useEffect(() => {
      if (!open) return;
      const outside = (event: PointerEvent) => {
         if (!wrap.current?.contains(event.target as Node)) onOpenChange(false);
      };
      const escape = (event: KeyboardEvent) => {
         if (event.key === "Escape") {
            onOpenChange(false);
            trigger.current?.focus();
         }
      };
      document.addEventListener("pointerdown", outside);
      document.addEventListener("keydown", escape);
      return () => {
         document.removeEventListener("pointerdown", outside);
         document.removeEventListener("keydown", escape);
      };
   }, [open, onOpenChange]);

   const maker =
      game.maker === 0
         ? "You"
         : game.maker === null
         ? null
         : seatName(game, game.maker);
   return (
      <div className="match-info" ref={wrap}>
         <span id="match-context" className="sr-only">
            Hand {game.handNumber}. Us {game.scores[0]}, Them {game.scores[1]}.{" "}
            {game.trump
               ? `${SUIT_NAMES[game.trump]} trump, ${maker}${
                    game.alone ? " alone" : " called"
                 }. Tricks Us ${game.tricks[0]}, Them ${game.tricks[1]}.`
               : `Bidding round ${game.phase === "bidding2" ? 2 : 1}.`}
         </span>
         <button
            ref={trigger}
            type="button"
            className="icon-button match-menu-toggle"
            aria-label="Match details"
            aria-describedby="match-context"
            aria-expanded={open}
            aria-controls="match-details"
            onClick={() => onOpenChange(!open)}
         >
            <FontAwesomeIcon icon={faBars} />
         </button>
         {open && (
            <section
               id="match-details"
               className="match-panel"
               aria-label="Match details"
            >
               <dl className="match-facts">
                  <div>
                     <dt>First to {game.target}</dt>
                     <dd>
                        {game.teamNames?.[0] ?? "Us"} {game.scores[0]} ·{" "}
                        {game.teamNames?.[1] ?? "Them"} {game.scores[1]}
                     </dd>
                  </div>
                  <div>
                     <dt>Hand</dt>
                     <dd>{game.handNumber}</dd>
                  </div>
                  <div>
                     <dt>Dealer</dt>
                     <dd>{seatName(game, game.dealer)}</dd>
                  </div>
                  <div>
                     <dt>{game.trump ? "Trump" : "Bidding"}</dt>
                     <dd>
                        {game.trump ? (
                           <>
                              <SuitIcon suit={game.trump} />{" "}
                              <span className="capitalize">
                                 {SUIT_NAMES[game.trump]}
                              </span>
                           </>
                        ) : (
                           `Round ${game.phase === "bidding2" ? 2 : 1}`
                        )}
                     </dd>
                  </div>
                  {maker && (
                     <div>
                        <dt>Called by</dt>
                        <dd>
                           {maker}
                           {game.alone ? " · Going alone" : ""}
                        </dd>
                     </div>
                  )}
                  <div>
                     <dt>Tricks this hand</dt>
                     <dd>
                        Us {game.tricks[0]} · Them {game.tricks[1]}
                     </dd>
                  </div>
                  <div>
                     <dt>Difficulty</dt>
                     <dd className="capitalize">{game.difficulty}</dd>
                  </div>
               </dl>
               <hr className="match-divider" />
               <Button
                  name={leaveLabel}
                  size="compact"
                  className="match-leave-button"
                  disabled={leaveDisabled}
                  onClick={() => {
                     trigger.current?.focus();
                     onLeave();
                  }}
               />
            </section>
         )}
      </div>
   );
}
