import { Fragment, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCrown, faUser, faRobot } from "@fortawesome/pro-solid-svg-icons";
import { Navbar } from "@/components/Navbar";
import { Button, MenuLink } from "@/components/Buttons";
import { Card, SuitIcon } from "@/components/Card";
import { EuchreLogo } from "@/components/EuchreLogo";
import { Modal } from "@/components/Modal";
import { Tooltip } from "@/components/Tooltip";
import { MatchInfo } from "@/components/MatchInfo";
import { TeamScoreboard } from "@/components/TeamScoreboard";
import { Trick } from "@/components/Trick";
import { Kitty } from "@/components/Kitty";
import { OpeningMotion } from "@/components/OpeningMotion";
import { DealMotion } from "@/components/DealMotion";
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
   type Card as CardCode,
   type Game,
   type Seat,
   type Suit,
} from "@/game/engine";
import { asset } from "@/lib/assets";
import { cardFanStyle } from "@/lib/cardFan";
import {
   dealCards,
   dealTimingStyle,
   miniCardTransform,
} from "@/lib/dealAnimation";
import { getProfileIcon } from "@/lib/profileIcons";
import containers from "@/styles/containers.module.css";

function seatBadge(game: Game, seat: Seat): string {
   const name = seatName(game, seat);
   const botNumber = name.match(/^Bot\s+(\d+)$/i)?.[1];
   if (game.humanSeats?.[seat] === false && botNumber)
      return `B${botNumber}`;
   return name.trim().charAt(0).toUpperCase();
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
   const navigate = useNavigate();
   const { game: currentGame, act: apply, saved, error } = online ?? single;
   const sound = useSound();
   const [alone, setAlone] = useState(false);
   const [info, setInfo] = useState(false);
   const [leaving, setLeaving] = useState(false);
   const paused = info || leaving;
   const singleOpening = useOpeningSequence(
      online ? null : currentGame,
      apply,
      paused
   );
   const multiplayerOpening = useMultiplayerOpeningSequence(
      online ? currentGame : null,
      apply,
      paused,
      online?.disabled ?? false
   );
   const game = online ? multiplayerOpening.game : currentGame;
   const opening = online ? multiplayerOpening : singleOpening;
   const act = opening.perform;
   const boardRef = useRef<HTMLElement>(null);
   const [botError, setBotError] = useState("");
   const [premove, setPremove] = useState<{
      gameId: string;
      handNumber: number;
      card: CardCode;
   } | null>(null);
   const lastSound = useRef("");
   useEffect(() => {
      // Keep the mini-hand opacity transitions on the opening's pause clock.
      boardRef.current?.querySelectorAll(".hidden-hand").forEach((hand) => {
         hand.getAnimations?.().forEach((animation) =>
            paused ? animation.pause() : animation.play()
         );
      });
   }, [paused, game?.phase]);
   const inputBlocked = paused || opening.busy || game !== currentGame;
   const canPremove =
      game &&
      game.sittingOut !== 0 &&
      (game.phase === "playing" || game.phase === "trick_complete");
   const premoveCard =
      canPremove &&
      premove?.gameId === game.id &&
      premove.handNumber === game.handNumber
         ? premove.card
         : null;
   const delay = game?.phase === "playing" ? 500 : OPENING_BOT_DELAY_MS;
   useEffect(() => {
      if (!premove) return;
      if (!game || !premoveCard || !game.hands[0].includes(premoveCard)) {
         setPremove(null);
         return;
      }
      if (game.phase !== "playing" || game.turn !== 0 || inputBlocked) return;
      // Consume the selection even when following suit makes it illegal.
      setPremove(null);
      if (
         legalCards(game.hands[0], game.trick, game.trump).includes(premoveCard)
      )
         act({ type: "play", card: premoveCard });
   }, [game, premove, premoveCard, inputBlocked, act]);
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
   const chooseCard = (card: CardCode) => {
      if (inputBlocked) return;
      if (activeHand) {
         setPremove(null);
         if (game.phase === "discard") sound.play("select");
         act({ type: game.phase === "discard" ? "discard" : "play", card });
      } else if (canPremove) {
         setPremove(
            premoveCard === card
               ? null
               : { gameId: game.id, handNumber: game.handNumber, card }
         );
         sound.play("select");
      }
   };
   const call = (suit: Suit) => act({ type: "call", suit, alone });
   const over = game.phase === "game_over";
   const passedOut = game.phase === "round_complete" && game.maker === null;
   const totalsOnly = over || passedOut;
   const summary = over || game.phase === "round_complete";
   const nextHandReady = !!online && !!game.nextHandReady?.[0];
   const dealing = opening.step?.kind === "deal";
   const dealingHint =
      game.dealer === 0
         ? "You are dealing…"
         : `${seatName(game, game.dealer)} is dealing…`;
   const deliveries = dealCards(game.dealer);
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
            game.turn === s &&
            !summary &&
            !dealing &&
            game.phase !== "trick_complete"
               ? "seat-turn"
               : ""
         } ${game.sittingOut === s ? "seat-sitting-out" : ""}`}
      >
         <div className="seat-marker">
            <div
               className="player-seat-card"
               role="group"
               aria-label={`${seatName(game, s)}${
                  game.turn === s &&
                  !summary &&
                  !dealing &&
                  game.phase !== "trick_complete"
                     ? " · Current turn"
                     : ""
               }`}
               aria-current={
                  game.turn === s &&
                  !summary &&
                  !dealing &&
                  game.phase !== "trick_complete"
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
         {(s !== 0 || dealing) && (
            <div
               className={`hidden-hand${dealing ? " deal-mini-hand" : ""}`}
               aria-label={
                  dealing
                     ? `Dealing to ${seatName(game, s)}`
                     : `${game.hands[s].length} cards remaining`
               }
            >
               {game.hands[s].map((_, index) => (
                  <span
                     key={index}
                     className={`hidden-card${
                        dealing ? " deal-hidden-card" : ""
                     }`}
                     data-deal-card={index}
                     style={{
                        transform: miniCardTransform(
                           index,
                           game.hands[s].length
                        ),
                        animationDelay: dealing
                           ? `${
                                deliveries.find(
                                   (card) =>
                                      card.seat === s && card.index === index
                                )?.arrival ?? 0
                             }ms`
                           : undefined,
                     }}
                  >
                     <img
                        src={asset("cards/back.svg")}
                        alt=""
                        draggable={false}
                     />
                  </span>
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
            data-opening-paused={paused}
            data-dealing={dealing}
            data-phase={game.phase}
            style={dealTimingStyle}
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
                        leaveDisabled={online?.disabled}
                        onLeave={() => {
                           setInfo(false);
                           if (online) online.onLeave();
                           else if (over) navigate("/play");
                           else setLeaving(true);
                        }}
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
                           {dealing
                              ? dealingHint
                              : bidding && humanTurn
                              ? game.phase === "bidding1"
                                 ? "Your bid · Order up or pass."
                                 : "Your bid · Choose trump or pass."
                              : phaseHint}
                        </span>
                        {dealing ? (
                           <p className="phase-hint" aria-hidden="true">
                              {dealingHint}
                           </p>
                        ) : bidding && humanTurn ? (
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
               <section
                  className="hand-region"
                  aria-label="Your hand"
                  aria-hidden={dealing}
               >
                  <div
                     className={`player-hand ${
                        activeHand ? "hand-active" : ""
                     }${dealing ? " hand-dealing" : ""}`}
                     key={`${game.id}:${game.handNumber}`}
                     data-card-count={hand.length}
                  >
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
                                 selected={premoveCard === card}
                                 disabled={activeHand && !legal.includes(card)}
                                 interactionDisabled={inputBlocked}
                                 onClick={
                                    activeHand || canPremove
                                       ? () => chooseCard(card)
                                       : undefined
                                 }
                              />
                           </div>
                        </div>
                     ))}
                  </div>
               </section>
               {dealing && (
                  <DealMotion
                     key={`${game.id}:${game.handNumber}`}
                     dealer={game.dealer}
                     board={boardRef}
                     paused={paused}
                  />
               )}
               <OpeningMotion
                  step={opening.step}
                  board={boardRef}
                  paused={paused}
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
         {leaving && !online && (
            <Modal title="Leave the game?" onClose={() => setLeaving(false)}>
               <p>This game will count as a loss.</p>
               <div className="button-stack">
                  <Button
                     name="Leave Game"
                     onClick={() => {
                        single.concedeGame();
                        navigate("/play");
                     }}
                  />
                  <Button
                     name="Keep Playing"
                     onClick={() => setLeaving(false)}
                  />
               </div>
            </Modal>
         )}
         {summary && !paused && (
            <Modal
               className={`game-result-modal${
                  over ? " game-complete-modal" : ""
               }`}
               title={over ? "Game Complete" : game.message}
            >
               {over && (
                  <h3 className="game-complete-winner">
                     {game.conceded
                        ? "Game conceded"
                        : `${winningTeamName} wins!`}
                  </h3>
               )}
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
               {over ? (
                  <div
                     className="game-final-scores"
                     role="group"
                     aria-label="Final scores"
                  >
                     {scoreOrder.map((t, index) => (
                        <Fragment key={t}>
                           {index > 0 && (
                              <span
                                 className="game-score-separator"
                                 aria-hidden="true"
                              >
                                 —
                              </span>
                           )}
                           <div
                              className={`game-final-team${
                                 !game.conceded && t === winningTeam
                                    ? " game-final-winner"
                                    : ""
                              }`}
                           >
                              <span className="game-final-total">
                                 {game.scores[t]}
                              </span>
                              <span className="game-final-name">
                                 {game.teamNames?.[t] ??
                                    (t === 0 ? "Us" : "Them")}
                              </span>
                           </div>
                        </Fragment>
                     ))}
                  </div>
               ) : (
                  <table className="round-score-table">
                     <caption className="sr-only">
                        {passedOut ? "Current scores" : "Hand scores"}
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
                                 {game.teamNames?.[t] ??
                                    (t === 0 ? "Us" : "Them")}
                              </th>
                              {!totalsOnly && <td>{last?.tricks[t]}</td>}
                              {!totalsOnly && <td>+{last?.points[t]}</td>}
                              <td>{game.scores[t]}</td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               )}
               {over && online && (
                  <div className="game-complete-status">
                     <p className="game-complete-status-title" role="status">
                        {online.isHost ? "Keep playing?" : "Waiting for host"}
                        {!online.isHost && (
                           <span
                              className="waiting-ellipsis"
                              aria-hidden="true"
                           >
                              <span>.</span>
                              <span>.</span>
                              <span>.</span>
                           </span>
                        )}
                     </p>
                     {!online.isHost && (
                        <p>
                           Stay here. Your host can start another game or take
                           everyone back to the lobby.
                        </p>
                     )}
                  </div>
               )}
               <div className={over ? "game-complete-actions" : "button-stack"}>
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
                                 variant="secondary"
                                 disabled={online.disabled}
                                 onClick={online.onLobby}
                              />
                           </>
                        ) : (
                           <>
                              <Tooltip content="Only the host can start another game.">
                                 <span
                                    tabIndex={0}
                                    style={{ cursor: "not-allowed" }}
                                 >
                                    <Button
                                       name="Play Again"
                                       disabled
                                       style={{ pointerEvents: "none" }}
                                    />
                                 </span>
                              </Tooltip>
                              <Tooltip content="Only the host can return the group to the lobby.">
                                 <span
                                    tabIndex={0}
                                    style={{ cursor: "not-allowed" }}
                                 >
                                    <Button
                                       name="Back to Lobby"
                                       variant="secondary"
                                       disabled
                                       style={{ pointerEvents: "none" }}
                                    />
                                 </span>
                              </Tooltip>
                           </>
                        )
                     ) : (
                        <MenuLink to="/play" name="Play Again" />
                     )
                  ) : (
                     <Button
                        name={
                           nextHandReady ? "Waiting for players..." : "Next Hand"
                        }
                        className="next-hand-button"
                        aria-label={nextHandReady ? "Waiting for players" : undefined}
                        disabled={
                           nextHandReady || (!!online && online.disabled)
                        }
                        onClick={() => act({ type: "advance" })}
                     >
                        {nextHandReady ? (
                           <span role="status">
                              Waiting
                              <span className="next-hand-waiting-detail">
                                 {" "}
                                 for players
                              </span>
                              <span
                                 className="waiting-ellipsis"
                                 aria-hidden="true"
                              >
                                 <span>.</span>
                                 <span>.</span>
                                 <span>.</span>
                              </span>
                           </span>
                        ) : undefined}
                     </Button>
                  )}
               </div>
               {over && (
                  <div className="game-complete-footer">
                     {online && (
                        <Button
                           name="Leave Lobby"
                           disabled={online.disabled}
                           onClick={online.onLeave}
                        />
                     )}
                     {error && (
                        <p role="alert" className="inline-error">
                           {error}
                        </p>
                     )}
                     <MenuLink to="/" name="Home" />
                  </div>
               )}
            </Modal>
         )}
      </>
   );
}
