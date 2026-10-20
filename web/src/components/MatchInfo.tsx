import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBars, faXmark } from "@fortawesome/pro-solid-svg-icons";
import { SuitIcon } from "@/components/Card";
import { seatName, SUIT_NAMES, team, type Game } from "@/game/engine";

type Props = {
   game: Game;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onConcede: () => void;
};

export function MatchInfo({ game, open, onOpenChange, onConcede }: Props) {
   const wrap = useRef<HTMLDivElement>(null);
   const trigger = useRef<HTMLButtonElement>(null);
   const close = () => {
      onOpenChange(false);
      trigger.current?.focus();
   };

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
               aria-labelledby="match-details-title"
            >
               <div className="match-panel-heading">
                  <h2 id="match-details-title">Match details</h2>
                  <button
                     type="button"
                     className="icon-button"
                     aria-label="Close match details"
                     onClick={close}
                  >
                     <FontAwesomeIcon icon={faXmark} />
                  </button>
               </div>
               <dl className="match-facts">
                  <div>
                     <dt>First to {game.target}</dt>
                     <dd>
                        Us {game.scores[0]} · Them {game.scores[1]}
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
               {game.results.length > 0 && (
                  <div className="match-history-section">
                     <h3>Previous hands</h3>
                     <ol className="match-history">
                        {game.results
                           .slice(-5)
                           .reverse()
                           .map((result) => (
                              <li key={result.hand}>
                                 <span>
                                    <span>Hand {result.hand}</span>
                                    <small>
                                       <SuitIcon suit={result.trump} />{" "}
                                       {result.tricks[team(result.maker)] < 3
                                          ? "Euchred"
                                          : result.tricks[
                                               team(result.maker)
                                            ] === 5
                                          ? result.alone
                                             ? "Lone-hand sweep"
                                             : "All five tricks"
                                          : `${seatName(
                                               game,
                                               result.maker
                                            )} called`}
                                    </small>
                                 </span>
                                 <strong>
                                    {result.points[0]
                                       ? `Us +${result.points[0]}`
                                       : `Them +${result.points[1]}`}
                                 </strong>
                              </li>
                           ))}
                     </ol>
                  </div>
               )}
               <div className="match-teams">
                  <span>You + Partner</span>
                  <span>West + East</span>
               </div>
               <div className="match-menu">
                  <Link to="/rules">Rules</Link>
                  <Link to="/options">Options</Link>
                  <Link to="/stats">Statistics</Link>
                  {game.phase !== "game_over" && (
                     <button type="button" onClick={onConcede}>
                        Concede
                     </button>
                  )}
               </div>
            </section>
         )}
      </div>
   );
}
