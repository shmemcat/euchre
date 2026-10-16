import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faUser,
   faRobot,
   faCrown,
   faCircleInfo,
} from "@fortawesome/pro-solid-svg-icons";
import { Navbar } from "@/components/Navbar";
import { Button, MenuLink } from "@/components/Buttons";
import { Card, SuitIcon } from "@/components/Card";
import { EuchreLogo } from "@/components/EuchreLogo";
import { Modal } from "@/components/Modal";
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
   type Seat,
   type Suit,
} from "@/game/engine";
import { asset } from "@/lib/assets";
import containers from "@/styles/containers.module.css";

function hint(
   phase: string,
   human: boolean,
   sittingOut: boolean
): string | null {
   if (["round_complete", "game_over"].includes(phase)) return null;
   if (sittingOut) return "Your partner is playing alone.";
   if (!human) return null;
   if (phase === "bidding1") return "Order up or pass.";
   if (phase === "bidding2") return "Choose trump or pass.";
   if (phase === "discard") return "Choose a card to discard.";
   return phase === "playing" ? "Your turn." : null;
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
   const phaseHint = hint(game.phase, humanTurn, game.sittingOut === 0);
   const last = game.results[game.results.length - 1];
   const won = !game.conceded && game.scores[0] >= 10;
   const seat = (s: Seat) => (
      <div
         className={`table-seat seat-${s} ${
            game.turn === s && !summary && game.phase !== "trick_complete"
               ? "seat-turn"
               : ""
         } ${game.sittingOut === s ? "seat-sitting-out" : ""}`}
      >
         <span className="seat-name">
            <FontAwesomeIcon icon={s === 0 ? faUser : faRobot} />{" "}
            {seatName(game, s)}{" "}
            {s === game.dealer && (
               <span className="dealer-badge" title="Dealer">
                  D
               </span>
            )}
         </span>
         <span className="seat-detail">
            {game.sittingOut === s ? (
               "Sitting out"
            ) : s === game.maker ? (
               <>
                  <FontAwesomeIcon icon={faCrown} />{" "}
                  {game.alone ? "Going alone" : "Maker"}
               </>
            ) : team(s) === 0 ? (
               "Your team"
            ) : (
               "Opponents"
            )}
         </span>
         {s !== 0 && (
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
            <Navbar />
            <div id="page-content" tabIndex={-1} className="game-content">
               <div className="game-info">
                  <span>Hand {game.handNumber}</span>
                  <span className="score-pill">
                     <strong>Us {game.scores[0]}</strong>
                     <span> / </span>
                     <strong>Them {game.scores[1]}</strong>
                  </span>
                  <span className="game-difficulty">{game.difficulty}</span>
               </div>
               <div className="trump-line">
                  {game.trump ? (
                     <span>
                        Trump <SuitIcon suit={game.trump} />{" "}
                        <span className="capitalize">
                           {SUIT_NAMES[game.trump]}
                        </span>
                     </span>
                  ) : (
                     <span>
                        Making trump · Round{" "}
                        {game.phase === "bidding2" ? "2" : "1"}
                     </span>
                  )}
                  <button
                     type="button"
                     className="icon-button"
                     aria-label="Game details"
                     onClick={() => setInfo(true)}
                  >
                     <FontAwesomeIcon icon={faCircleInfo} />
                  </button>
               </div>
               <div className="game-table">
                  {seat(2)}
                  {seat(1)}
                  {seat(3)}
                  {seat(0)}
                  <div className="table-center">
                     {bidding || game.phase === "discard" ? (
                        <div className="kitty-display">
                           <img
                              className="kitty-back"
                              src={asset("cards/back.svg")}
                              alt="Undealt cards"
                           />
                           {game.phase === "bidding1" ||
                           game.phase === "discard" ? (
                              <Card code={game.upCard} />
                           ) : (
                              <div className="turned-down-card">
                                 <Card code={game.upCard} />
                                 <span>Turned down</span>
                              </div>
                           )}
                        </div>
                     ) : (
                        <div className="trick-table" aria-label="Current trick">
                           {game.trick.map((play) => (
                              <div
                                 className={`trick-card trick-card-${play.seat}`}
                                 key={play.seat}
                              >
                                 <Card code={play.card} />
                                 <span>{seatName(game, play.seat)}</span>
                              </div>
                           ))}
                           {!game.trick.length && <EuchreLogo size={80} />}
                        </div>
                     )}
                  </div>
               </div>
               <div className="tricks-line">
                  Tricks this hand <strong>Us {game.tricks[0]}</strong>
                  <span>·</span>
                  <strong>Them {game.tricks[1]}</strong>
               </div>
               <p className="game-message" role="status" aria-live="polite">
                  {game.message}
               </p>
               <p
                  className={`phase-hint ${humanTurn ? "your-turn-hint" : ""}`}
                  style={phaseHint ? undefined : { visibility: "hidden" }}
                  aria-hidden={!phaseHint}
               >
                  {phaseHint ?? "\u00a0"}
               </p>
               {bidding && humanTurn && (
                  <div className="bid-controls">
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
                           : SUITS.filter((s) => s !== suitOf(game.upCard))
                        ).map((suit) => (
                           <button
                              key={suit}
                              type="button"
                              className="suit-button"
                              onClick={() => call(suit)}
                           >
                              <SuitIcon suit={suit} />{" "}
                              {game.phase === "bidding1" ? (
                                 game.dealer === 0 ? (
                                    "Pick up"
                                 ) : (
                                    "Order up"
                                 )
                              ) : (
                                 <span className="capitalize">
                                    {SUIT_NAMES[suit]}
                                 </span>
                              )}
                           </button>
                        ))}
                        <button
                           className="suit-button pass-button"
                           type="button"
                           onClick={() => act({ type: "pass" })}
                        >
                           Pass
                        </button>
                     </div>
                  </div>
               )}
               <div
                  className={`player-hand ${activeHand ? "hand-active" : ""}`}
                  aria-label="Your hand"
               >
                  {sortHand(game.hands[0], game.trump).map((card) => (
                     <div className="hand-card" key={card}>
                        <Card
                           code={card}
                           disabled={!activeHand || !legal.includes(card)}
                           onClick={() =>
                              act({
                                 type:
                                    game.phase === "discard"
                                       ? "discard"
                                       : "play",
                                 card,
                              })
                           }
                        />
                        {game.trump &&
                           effectiveSuit(card, game.trump) === game.trump &&
                           suitOf(card) !== game.trump && (
                              <span className="bower-tag">Left bower</span>
                           )}
                     </div>
                  ))}
               </div>
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
               <div className="game-footer">
                  <Link to="/">Home</Link>
                  <Link to="/rules">Rules</Link>
                  <Link to="/options">Options</Link>
                  <button
                     type="button"
                     onClick={() => setConcedeOpen(true)}
                     disabled={over}
                  >
                     Concede
                  </button>
               </div>
            </div>
         </main>
         {summary && !info && (
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
         {info && (
            <Modal title="Game Details" onClose={() => setInfo(false)}>
               <p>
                  Dealer: {seatName(game, game.dealer)}
                  <br />
                  Difficulty:{" "}
                  <span className="capitalize">{game.difficulty}</span>
               </p>
               <Button name="Back to Game" onClick={() => setInfo(false)} />
            </Modal>
         )}
      </>
   );
}
