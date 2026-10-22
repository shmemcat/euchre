import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCrown, faUser, faRobot } from "@fortawesome/pro-solid-svg-icons";
import { Navbar } from "@/components/Navbar";
import { Button, MenuLink } from "@/components/Buttons";
import { Card, CardPlaceholder, SuitIcon } from "@/components/Card";
import { EuchreLogo } from "@/components/EuchreLogo";
import { Modal } from "@/components/Modal";
import { MatchInfo } from "@/components/MatchInfo";
import { TeamScoreboard } from "@/components/TeamScoreboard";
import { Trick } from "@/components/Trick";
import { Kitty } from "@/components/Kitty";
import { OpeningMotion } from "@/components/OpeningMotion";
import {
   OPENING_BOT_DELAY_MS,
   useOpeningSequence,
} from "@/hooks/useOpeningSequence";
import { useMultiplayerOpeningSequence } from "@/hooks/useMultiplayerOpeningSequence";
import { useGame } from "@/context/GameContext";
import { useSound } from "@/context/SoundContext";
import { mediumAction } from "@/game/ai";
import {
   effectiveSuit,
   legalCards,
   observe,
   seatName,
   sortHand,
   SUITS,
   SUIT_NAMES,
   suitOf,
   team,
   type Action,
   type Game,
   type Seat,
   type Suit,
} from "@/game/engine";
import { asset } from "@/lib/assets";
import { cardFanStyle } from "@/lib/cardFan";
import { getProfileIcon } from "@/lib/profileIcons";
import containers from "@/styles/containers.module.css";

function seatBadge(game: Game, seat: Seat): string {
   const name = seatName(game, seat);
   if (game.humanSeats?.[seat] ?? seat === 0)
      return name.trim().charAt(0).toUpperCase();
   const number = name.match(/^Bot\s+(\d+)$/i)?.[1] ??
      (game.humanSeats
         ? game.humanSeats.slice(0, seat + 1).filter((human) => !human).length
         : seat);
   return `B${number}`;
}

function hint(game: Game): string {
   if (["trick_complete", "round_complete", "game_over"].includes(game.phase))
      return game.message;
   if (game.sittingOut === 0) return "Your partner is playing alone.";
   if (game.phase === "discard")
      return game.turn === 0
         ? "Choose a card to discard."
         : `${seatName(game, game.turn)} is discarding…`;
   if (game.phase === "bidding1" || game.phase === "bidding2")
      return `${seatName(game, game.turn)} is choosing trump…`;
   if (game.turn !== 0) return `${seatName(game, game.turn)} is playing…`;
   if (!game.trick.length) return "Your turn · Lead a card.";
   const led = effectiveSuit(game.trick[0].card, game.trump);
   return game.hands[0].some((card) => effectiveSuit(card, game.trump) === led)
      ? `Your turn · Follow ${SUIT_NAMES[led]}.`
      : "Your turn · Play any card.";
}

export type OnlineGame = {
   game: Game;
   act: (action: Action) => void;
   saved: boolean;
   error: string;
   isHost: boolean;
   disabled: boolean;
   onRematch: () => void;
   onLobby: () => void;
   onLeave: () => void;
};
export default function GamePage({ online }: { online?: OnlineGame } = {}) {
   const single = useGame();
   const { game: currentGame, act: apply, saved, error } = online ?? single;
   const sound = useSound();
   const [alone, setAlone] = useState(false);
   const [info, setInfo] = useState(false);
   const singleOpening = useOpeningSequence(
      online ? null : currentGame,
      apply,
      info
   );
   const multiplayerOpening = useMultiplayerOpeningSequence(
      online ? currentGame : null,
      apply,
      info,
      online?.disabled ?? false
   );
   const game = online ? multiplayerOpening.game : currentGame;
   const opening = online ? multiplayerOpening : singleOpening;
   const act = opening.perform;
   const boardRef = useRef<HTMLElement>(null);
   const [botError, setBotError] = useState("");
   const lastSound = useRef("");
   const paused = info;
   const delay = game?.phase === "playing" ? 700 : OPENING_BOT_DELAY_MS;
   useEffect(() => {
      setAlone(false);
   }, [game?.handNumber, game?.phase]);
   useEffect(() => {
      if (!game) return;
      const key = `${game.id}:${game.handNumber}:${game.phase}:${game.completedTricks.length}:${game.trick.length}`;
      if (key === lastSound.current) return;
      lastSound.current = key;
      if (game.phase === "game_over") sound.play("win");
      else if (game.phase === "round_complete") sound.play("round");
      else if (
         (game.phase === "playing" || game.phase === "trick_complete") &&
         game.trick.length
      )
         sound.play("play");
      else if (game.phase === "bidding1" && game.passes === 0)
         sound.play("deal");
   }, [game, sound]);
   useEffect(() => {
      if (online || !game || paused || opening.busy) return;
      if (
         ["trick_complete", "round_complete", "game_over"].includes(
            game.phase
         ) ||
         game.turn === 0
      )
         return;
      const observation = observe(game);
      let disposed = false;
      let worker: Worker | undefined;
      let timer = 0;
      let watchdog = 0;
      const begin = performance.now();
      const deliver = (action: Action) => {
         if (disposed) return;
         clearTimeout(watchdog);
         worker?.terminate();
         timer = window.setTimeout(() => {
            if (!disposed) {
               setBotError("");
               act(action);
            }
         }, Math.max(0, delay - (performance.now() - begin)));
      };
      const fallback = () => {
         worker?.terminate();
         deliver(mediumAction(observation));
      };
      try {
         worker = new Worker(
            new URL("../game/bot.worker.ts", import.meta.url),
            { type: "module" }
         );
         worker.onmessage = (event) => {
            if (event.data.action) deliver(event.data.action);
            else fallback();
         };
         worker.onerror = fallback;
         worker.postMessage({ id: 1, observation });
         watchdog = window.setTimeout(() => {
            setBotError("Retrying…");
            fallback();
         }, 12000);
      } catch {
         fallback();
      }
      return () => {
         disposed = true;
         clearTimeout(timer);
         clearTimeout(watchdog);
         worker?.terminate();
      };
   }, [game, act, delay, paused, opening.busy, online]);
   if (!game)
      return (
         <main className={containers["content-border-container"]}>
            <Navbar />
            <div id="page-content" className="empty-game">
               <EuchreLogo size={100} />
               <h2>No active game</h2>
               <MenuLink to="/play" name="Create Game" />
            </div>
         </main>
      );
   const humanTurn = game.turn === 0;
   const bidding = game.phase === "bidding1" || game.phase === "bidding2";
   const legal =
      game.phase === "discard"
         ? game.hands[0]
         : game.phase === "playing"
         ? legalCards(game.hands[0], game.trick, game.trump)
         : [];
   const activeHand =
      humanTurn && (game.phase === "playing" || game.phase === "discard");
   const call = (suit: Suit) => act({ type: "call", suit, alone });
   const over = game.phase === "game_over";
   const passedOut = game.phase === "round_complete" && game.maker === null;
   const totalsOnly = over || passedOut;
   const summary = over || game.phase === "round_complete";
   const phaseHint = hint(game);
   const pickup =
      opening.step?.kind === "pickup" && opening.step.seat === 0
         ? opening.step
         : null;
   const discardedCard =
      opening.step?.kind === "discard" && opening.step.seat === 0
         ? opening.step.card
         : null;
   const hand = sortHand(
      pickup ? [...game.hands[0], pickup.card] : game.hands[0],
      pickup?.suit ?? game.trump
   );
   const last = game.results[game.results.length - 1];
   const scoreOrder = [0, 1].sort((a, b) => game.scores[b] - game.scores[a]);
   const winningTeam = game.scores[0] >= game.target ? 0 : 1;
   const winningTeamName =
      game.teamNames?.[winningTeam] ??
      (winningTeam === 0 ? "Your team" : "The opposing team");
   const seat = (s: Seat) => (
      <div
         className={`table-seat seat-${s} ${
            team(s) === 0 ? "seat-teammate" : ""
         } ${
            game.turn === s && !summary && game.phase !== "trick_complete"
               ? "seat-turn"
               : ""
         } ${game.sittingOut === s ? "seat-sitting-out" : ""}`}
      >
         <div className="seat-marker">
            <div
               className="player-seat-card"
               role="group"
               aria-label={`${seatName(game, s)}${
                  game.turn === s && !summary && game.phase !== "trick_complete"
                     ? " · Current turn"
                     : ""
               }`}
               aria-current={
                  game.turn === s && !summary && game.phase !== "trick_complete"
                     ? "true"
                     : undefined
               }
            >
               <span className="seat-name">
                  <FontAwesomeIcon
                     icon={
                        game.seatIcons && game.humanSeats?.[s]
                           ? getProfileIcon(game.seatIcons[s])
                           : (game.humanSeats ? game.humanSeats[s] : s === 0)
                           ? faUser
                           : faRobot
                     }
                     className="seat-icon"
                  />
                  <span className="seat-full-name">{seatName(game, s)}</span>
                  <span className="seat-badge" aria-hidden="true">
                     {seatBadge(game, s)}
                  </span>
                  {(s === game.dealer || s === game.maker) && (
                     <span className="seat-status">
                        {s === game.maker && (
                           <span
                              className="seat-maker-badge"
                              role="img"
                              aria-label={game.alone ? "Going alone" : "Maker"}
                              title={game.alone ? "Going alone" : "Maker"}
                           >
                              <FontAwesomeIcon icon={faCrown} />
                           </span>
                        )}
                        {s === game.dealer && (
                           <span
                              className="dealer-badge"
                              title="Dealer"
                              aria-label="Dealer"
                           >
                              <span>D</span>
                           </span>
                        )}
                     </span>
                  )}
               </span>
               {game.sittingOut === s ? (
                  <span className="seat-detail">Sitting out</span>
               ) : s === game.maker ? (
                  <span className="seat-detail">
                     <FontAwesomeIcon icon={faCrown} />{" "}
                     {game.alone ? "Going alone" : "Maker"}
                  </span>
               ) : (
                  <span className="seat-detail">
                     {game.teamNames?.[team(s)] ??
                        (team(s) === 0 ? "Your team" : "Opponents")}
                  </span>
               )}
            </div>
            {s === 3 && <TeamScoreboard game={game} side={1} />}
            {opening.step?.kind === "bid" && opening.step.seat === s && (
               <span className="bid-toast" role="status">
                  {opening.step.suit && <SuitIcon suit={opening.step.suit} />}
                  {opening.step.text}
               </span>
            )}
         </div>
         {s !== 0 && game.sittingOut !== s && (
            <div
               className="hidden-hand"
               aria-label={`${game.hands[s].length} cards remaining`}
            >
               {game.hands[s].map((_, index) => (
                  <img
                     key={index}
                     src={asset("cards/back.svg")}
                     alt=""
                     draggable={false}
                     style={{
                        transform: `rotate(${
                           (index - (game.hands[s].length - 1) / 2) * 8
                        }deg) translateY(${
                           Math.abs(index - (game.hands[s].length - 1) / 2) * 2
                        }px)`,
                     }}
                  />
               ))}
            </div>
         )}
      </div>
   );
   return (
      <>
         <Helmet>
            <title>Playing | Euchre</title>
         </Helmet>
         <main
            ref={boardRef}
            data-opening-paused={info}
            className={`${containers["content-border-container"]} game-container`}
         >
            <div className="game-header">
               <Navbar />
            </div>
            <div id="page-content" tabIndex={-1} className="game-content">
               <div className="play-board">
                  <div className="game-top-row">
                     {seat(2)}
                     <MatchInfo
                        game={game}
                        open={info}
                        onOpenChange={setInfo}
                     />
                  </div>
                  <div className="game-table">
                     {seat(1)}
                     {seat(3)}
                     <div className="table-center">
                        {bidding || game.phase === "discard" ? (
                           <Kitty game={game} step={opening.step} />
                        ) : (
                           <Trick
                              game={game}
                              paused={paused}
                              onCollected={() => {
                                 if (!online) act({ type: "advance" });
                              }}
                           />
                        )}
                     </div>
                  </div>
                  <div className="player-area">
                     <TeamScoreboard game={game} side={0} />
                     <div className="player-position">{seat(0)}</div>
                     <div
                        className="phase-area"
                        role="group"
                        aria-label="Game status and actions"
                     >
                        <span
                           className="sr-only"
                           role="status"
                           aria-live="polite"
                           aria-atomic="true"
                        >
                           {bidding && humanTurn
                              ? game.phase === "bidding1"
                                 ? "Your bid · Order up or pass."
                                 : "Your bid · Choose trump or pass."
                              : phaseHint}
                        </span>
                        {bidding && humanTurn ? (
                           <div
                              className={`bid-controls ${
                                 game.phase === "bidding2"
                                    ? "bid-round-two"
                                    : ""
                              }`}
                           >
                              <span className="sr-only">
                                 {game.phase === "bidding1"
                                    ? "Order up or pass"
                                    : "Choose trump or pass"}
                              </span>
                              {game.phase === "bidding2" && (
                                 <span className="bid-prompt">
                                    Choose trump
                                 </span>
                              )}
                              <label className="alone-label">
                                 <input
                                    type="checkbox"
                                    disabled={opening.busy}
                                    checked={alone}
                                    onChange={(e) => setAlone(e.target.checked)}
                                 />{" "}
                                 Go alone
                              </label>
                              <div className="bid-buttons">
                                 {(game.phase === "bidding1"
                                    ? [suitOf(game.upCard)]
                                    : SUITS.filter(
                                         (s) => s !== suitOf(game.upCard)
                                      )
                                 ).map((suit) => (
                                    <Button
                                       key={suit}
                                       name={
                                          game.phase === "bidding1"
                                             ? game.dealer === 0
                                                ? "Pick up"
                                                : "Order up"
                                             : SUIT_NAMES[suit]
                                       }
                                       size="compact"
                                       type="button"
                                       disabled={opening.busy}
                                       className="bid-action"
                                       aria-label={
                                          game.phase === "bidding1"
                                             ? `${
                                                  game.dealer === 0
                                                     ? "Pick up"
                                                     : "Order up"
                                               } ${SUIT_NAMES[suit]}`
                                             : SUIT_NAMES[suit]
                                       }
                                       onClick={() => call(suit)}
                                    >
                                       {game.phase === "bidding1" ? (
                                          game.dealer === 0 ? (
                                             "Pick up"
                                          ) : (
                                             "Order up"
                                          )
                                       ) : (
                                          <span className="capitalize suit-name">
                                             {SUIT_NAMES[suit]}
                                          </span>
                                       )}
                                       <SuitIcon suit={suit} />
                                    </Button>
                                 ))}
                                 <Button
                                    name="Pass"
                                    size="compact"
                                    variant="secondary"
                                    className="bid-action pass-button"
                                    type="button"
                                    disabled={opening.busy}
                                    onClick={() => act({ type: "pass" })}
                                 >
                                    Pass
                                 </Button>
                              </div>
                           </div>
                        ) : (
                           <p
                              className={`phase-hint ${
                                 humanTurn && activeHand ? "your-turn-hint" : ""
                              }`}
                              aria-hidden="true"
                           >
                              {phaseHint}
                           </p>
                        )}
                     </div>
                  </div>
               </div>
               <section className="hand-region" aria-label="Your hand">
                  <div
                     className={`player-hand ${
                        activeHand ? "hand-active" : ""
                     }${opening.step?.kind === "deal" ? " hand-dealing" : ""}`}
                     key={`${game.id}:${game.handNumber}`}
                     data-card-count={hand.length}
                  >
                     {hand.length === 0 && (
                        <CardPlaceholder className="hand-placeholder" />
                     )}
                     {hand.map((card, index) => (
                        <div
                           className={`hand-card${
                              pickup?.card === card
                                 ? " hand-card-in-flight"
                                 : ""
                           }`}
                           data-hand-card={card}
                           key={card}
                           style={cardFanStyle(index, hand.length)}
                        >
                           <div
                              className={`hand-card-motion${
                                 opening.step?.kind === "receive" &&
                                 opening.step.card === card
                                    ? " hand-card-received"
                                    : discardedCard === card
                                    ? " hand-card-discarding"
                                    : ""
                              }`}
                           >
                              <Card
                                 code={card}
                                 trump={game.trump}
                                 disabled={activeHand && !legal.includes(card)}
                                 interactionDisabled={opening.busy}
                                 onClick={
                                    activeHand
                                       ? () =>
                                            act({
                                               type:
                                                  game.phase === "discard"
                                                     ? "discard"
                                                     : "play",
                                               card,
                                            })
                                       : undefined
                                 }
                              />
                           </div>
                        </div>
                     ))}
                  </div>
               </section>
               <OpeningMotion
                  step={opening.step}
                  board={boardRef}
                  paused={info}
               />
               {(error || botError) && (
                  <p role="alert" className="inline-error">
                     {error || botError}
                  </p>
               )}
               {!saved && (
                  <p role="alert" className="inline-error">
                     Your browser couldn’t save this game. Keep this tab open to
                     continue.
                  </p>
               )}
            </div>
         </main>
         {summary && !info && (
            <Modal
               className="game-result-modal"
               title={
                  over
                     ? game.conceded
                        ? "Game conceded"
                        : `Game over — ${winningTeamName} wins!`
                     : game.message
               }
            >
               <EuchreLogo size={65} />
               {!totalsOnly && (
                  <p>
                     {last?.maker === 0
                        ? "You"
                        : seatName(game, last?.maker ?? 0)}{" "}
                     called {last ? SUIT_NAMES[last.trump] : "trump"}
                     {last?.alone ? " alone" : ""}.
                  </p>
               )}
               <table className="round-score-table">
                  <caption className="sr-only">
                     {over
                        ? "Final scores"
                        : passedOut
                        ? "Current scores"
                        : "Hand scores"}
                  </caption>
                  <thead>
                     <tr>
                        <th scope="col">Team</th>
                        {!totalsOnly && <th scope="col">Tricks</th>}
                        {!totalsOnly && <th scope="col">Points</th>}
                        <th scope="col">Total</th>
                     </tr>
                  </thead>
                  <tbody>
                     {scoreOrder.map((t) => (
                        <tr key={t}>
                           <th scope="row">
                              {game.teamNames?.[t] ?? (t === 0 ? "Us" : "Them")}
                           </th>
                           {!totalsOnly && <td>{last?.tricks[t]}</td>}
                           {!totalsOnly && <td>+{last?.points[t]}</td>}
                           <td>{game.scores[t]}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>
               <div className="button-stack">
                  {over ? (
                     online ? (
                        online.isHost ? (
                           <>
                              <Button
                                 name="Play Again"
                                 disabled={online.disabled}
                                 onClick={online.onRematch}
                              />
                              <Button
                                 name="Back to Lobby"
                                 disabled={online.disabled}
                                 onClick={online.onLobby}
                              />
                           </>
                        ) : (
                           <p role="status">
                              Waiting for the host to play again or return the
                              group to the lobby.
                           </p>
                        )
                     ) : (
                        <MenuLink to="/play" name="Play Again" />
                     )
                  ) : (
                     <Button
                        name={
                           online && !online.isHost
                              ? "Waiting for Host"
                              : "Next Hand"
                        }
                        disabled={
                           !!online && (!online.isHost || online.disabled)
                        }
                        onClick={() => act({ type: "advance" })}
                     />
                  )}
                  {over && <MenuLink to="/" name="Home" />}
                  {over && <MenuLink to="/leaderboard" name="Leaderboard" />}
               </div>
            </Modal>
         )}
      </>
   );
}
