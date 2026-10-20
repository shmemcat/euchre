import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faCircle, faCrown, faShield } from "@fortawesome/pro-solid-svg-icons";
import { team, type Game, type Team } from "@/game/engine";

// Extend the crown's base into its lower margin without moving the points or score.
const scoreCrown: IconDefinition = {
   ...faCrown,
   icon: [
      576,
      512,
      [],
      faCrown.icon[3],
      "M313 87.2c9.2-7.3 15-18.6 15-31.2 0-22.1-17.9-40-40-40s-40 17.9-40 40c0 12.6 5.9 23.9 15 31.2L194.6 194.8c-10 15.7-31.3 19.6-46.2 8.4L88.9 158.7c4.5-6.4 7.1-14.3 7.1-22.7 0-22.1-17.9-40-40-40s-40 17.9-40 40c0 21.8 17.5 39.6 39.2 40L87.8 441.5c4.7 31.3 31.6 54.5 63.3 54.5l273.8 0c31.7 0 58.6-23.2 63.3-54.5L520.8 176c21.7-.4 39.2-18.2 39.2-40 0-22.1-17.9-40-40-40s-40 17.9-40 40c0 8.4 2.6 16.3 7.1 22.7l-59.4 44.6c-14.9 11.2-36.2 7.3-46.2-8.4L313 87.2z",
   ],
};

export function TeamScoreboard({ game, side }: { game: Game; side: Team }) {
   const name = side === 0 ? "Your team" : "Opponents";
   const bidding = game.phase === "bidding1" || game.phase === "bidding2";
   const role =
      bidding || game.maker === null
         ? "bidding"
         : team(game.maker) === side
         ? "maker"
         : "defender";
   const roleName =
      role === "bidding"
         ? "Choosing trump"
         : role === "maker"
         ? "Makers"
         : "Defenders";
   const tricks = bidding ? 0 : game.tricks[side];

   return (
      <div
         className={`team-scoreboard team-scoreboard-${
            side === 0 ? "you" : "opponents"
         }`}
         role="group"
         aria-label={`${name} scoreboard`}
         title={`${name} · ${game.scores[side]} points · ${tricks} of 5 tricks · ${roleName}`}
      >
         <span
            className="team-score-emblem"
            data-role={role}
            role="img"
            aria-label={`${name}: ${roleName}, ${game.scores[side]} points`}
         >
            <FontAwesomeIcon
               icon={
                  role === "bidding"
                     ? faCircle
                     : role === "maker"
                     ? scoreCrown
                     : faShield
               }
            />
            <strong aria-hidden="true">{game.scores[side]}</strong>
         </span>
         <span
            className="team-trick-track"
            role="img"
            aria-label={`${tricks} of 5 tricks won`}
            aria-description="Win 3 of the 5 tricks to win the hand."
         >
            {Array.from({ length: 5 }, (_, index) => (
               <span
                  className={`team-trick-dot${index < tricks ? " is-won" : ""}`}
                  key={index}
                  aria-hidden="true"
               />
            ))}
         </span>
      </div>
   );
}
