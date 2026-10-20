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
import containers from "@/styles/containers.module.css";

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

export default function GamePage() {
   const { game, act, saved, error, concedeGame } = useGame();
   const sound = useSound();
   const [alone, setAlone] = useState(false);
   const [concedeOpen, setConcedeOpen] = useState(false);
   const [info, setInfo] = useState(false);
   const [botError, setBotError] = useState("");
   const lastSound = useRef("");
   const paused = concedeOpen || info;
   const delay = 700;
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
      else if (game.phase === "trick_complete") sound.play("trick");
      else if (game.phase === "playing" && game.trick.length)
         sound.play("play");
      else if (game.phase === "bidding1" && game.passes === 0)
         sound.play("deal");
   }, [game, sound]);
   useEffect(() => {
      if (!game || paused) return;
      if (game.phase === "trick_complete") {
         const timer = window.setTimeout(
            () => act({ type: "advance" }),
            Math.max(900, delay + 350)
         );
         return () => clearTimeout(timer);
      }
      if (
         ["round_complete", "game_over"].includes(game.phase) ||
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
   }, [game, act, delay, paused]);
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
   const summary = over || game.phase === "round_complete";
   const phaseHint = hint(game);
   const hand = sortHand(game.hands[0], game.trump);
   const last = game.results[game.results.length - 1];
   const won = !game.conceded && game.scores[0] >= 10;
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
                     icon={s === 0 ? faUser : faRobot}
                     className="seat-icon"
                  />
                  {seatName(game, s)}{" "}
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
               {game.sittingOut === s ? (
                  <span className="seat-detail">Sitting out</span>
               ) : s === game.maker ? (
                  <span className="seat-detail">
                     <FontAwesomeIcon icon={faCrown} />{" "}
                     {game.alone ? "Going alone" : "Maker"}
                  </span>
               ) : (
                  <span className="seat-detail">
                     {team(s) === 0 ? "Your team" : "Opponents"}
                  </span>
               )}
            </div>
            {s === 3 && <TeamScoreboard game={game} side={1} />}
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
            className={`${containers["content-border-container"]} game-container`}
         >
            <div className="game-header">
               <Navbar />
            </div>
            <div id="page-content" tabIndex={-1} className="game-content">
               <div className="game-top-row">
                  {seat(2)}
                  <MatchInfo
                     game={game}
                     open={info}
                     onOpenChange={setInfo}
                     onConcede={() => {
                        setInfo(false);
                        setConcedeOpen(true);
                     }}
                  />
               </div>
               <div className="game-table">
                  {seat(1)}
                  {seat(3)}
                  <div className="table-center">
                     {bidding || game.phase === "discard" ? (
                        <div className="kitty-display">
                           <div className="upcard-stack">
                              <img
                                 className="kitty-back"
                                 src={asset("cards/back.svg")}
                                 alt="Face-down cards beneath the upcard"
                                 draggable={false}
                              />
                              <Card code={game.upCard} trump={game.trump} />
                           </div>
                           <span className="upcard-label">
                              {game.phase === "bidding2"
                                 ? "Turned down"
                                 : game.phase === "discard"
                                 ? "Picked up"
                                 : "Upcard"}
                           </span>
                        </div>
                     ) : (
                        <div
                           className="trick-table"
                           role="group"
                           aria-label="Current trick"
                        >
                           {game.trump && (
                              <span
                                 className="table-trump"
                                 role="img"
                                 aria-label={`${SUIT_NAMES[game.trump]} trump`}
                                 title={`${SUIT_NAMES[game.trump]} trump`}
                              >
                                 <SuitIcon suit={game.trump} />
                              </span>
                           )}
                           {([0, 1, 2, 3] as Seat[])
                              .filter((s) => s !== game.sittingOut)
                              .map((s) => {
                                 const play = game.trick.find(
                                    (p) => p.seat === s
                                 );
                                 return (
                                    <div
                                       className={`trick-slot trick-slot-${s}`}
                                       key={s}
                                       role="group"
                                       aria-label={`${seatName(game, s)} ${
                                          play ? "played" : "card slot"
                                       }`}
                                    >
                                       <CardPlaceholder />
                                       {play && (
                                          <div
                                             className="trick-card"
                                             key={play.card}
                                          >
                                             <Card
                                                code={play.card}
                                                trump={game.trump}
                                             />
                                          </div>
                                       )}
                                    </div>
                                 );
                              })}
                        </div>
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
                              game.phase === "bidding2" ? "bid-round-two" : ""
                           }`}
                        >
                           <span className="sr-only">
                              {game.phase === "bidding1"
                                 ? "Order up or pass"
                                 : "Choose trump or pass"}
                           </span>
                           {game.phase === "bidding2" && (
                              <span className="bid-prompt">Choose trump</span>
                           )}
                           <label className="alone-label">
                              <input
                                 type="checkbox"
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
               <section className="hand-region" aria-label="Your hand">
                  <div
                     className={`player-hand ${
                        activeHand ? "hand-active" : ""
                     }`}
                     data-card-count={hand.length}
                  >
                     {hand.length === 0 && (
                        <CardPlaceholder className="hand-placeholder" />
                     )}
                     {hand.map((card, index) => (
                        <div
                           className="hand-card"
                           key={card}
                           style={cardFanStyle(index, hand.length)}
                        >
                           <Card
                              code={card}
                              trump={game.trump}
                              disabled={activeHand && !legal.includes(card)}
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
                     ))}
                  </div>
               </section>
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
         {summary && !info && !concedeOpen && (
            <Modal
               title={
                  over
                     ? game.conceded
                        ? "Game conceded"
                        : won
                        ? "You won!"
                        : "Game over"
                     : game.message
               }
            >
               <EuchreLogo size={65} />
               {!over && (
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
                     {over ? "Final scores" : "Hand scores"}
                  </caption>
                  <thead>
                     <tr>
                        <th>Team</th>
                        {!over && <th>Tricks</th>}
                        {!over && <th>Points</th>}
                        <th>Total</th>
                     </tr>
                  </thead>
                  <tbody>
                     {[0, 1].map((t) => (
                        <tr key={t}>
                           <th>{t === 0 ? "Us" : "Them"}</th>
                           {!over && <td>{last?.tricks[t]}</td>}
                           {!over && <td>+{last?.points[t]}</td>}
                           <td>{game.scores[t]}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>
               <div className="button-stack">
                  {over ? (
                     <MenuLink to="/play" name="Play Again" />
                  ) : (
                     <Button
                        name="Next Hand"
                        onClick={() => act({ type: "advance" })}
                     />
                  )}
                  <MenuLink to="/" name="Home" />
                  {over && <MenuLink to="/stats" name="Statistics" />}
               </div>
            </Modal>
         )}
         {concedeOpen && (
            <Modal
               title="Concede this game?"
               onClose={() => setConcedeOpen(false)}
            >
               <p>Conceding counts as a loss.</p>
               <div className="button-stack">
                  <Button
                     name="Keep Playing"
                     onClick={() => setConcedeOpen(false)}
                  />
                  <Button
                     name="Concede Game"
                     onClick={() => {
                        concedeGame();
                        setConcedeOpen(false);
                     }}
                  />
               </div>
            </Modal>
         )}
      </>
   );
}
