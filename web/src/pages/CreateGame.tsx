import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import { PageLayout } from "@/components/ui/PageLayout";
import { Button, MenuLink } from "@/components/Buttons";
import { Modal } from "@/components/Modal";
import { useGame } from "@/context/GameContext";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import containers from "@/styles/containers.module.css";
export default function CreateGame() {
   const navigate = useNavigate();
   const { preferences } = usePreferences();
   const { user } = useAuth();
   const { game, start } = useGame();
   const [difficulty, setDifficulty] = useState("easy");
   const [confirm, setConfirm] = useState(false);
   const active = game && game.phase !== "game_over";
   const create = () => {
      start(
         difficulty === "hard"
            ? preferences.hardLevel
            : (difficulty as "easy" | "medium"),
         user?.name ?? preferences.playerName
      );
      navigate("/game/single-play");
   };
   return (
      <>
         <Helmet>
            <title>Play | Euchre</title>
         </Helmet>
         <PageLayout title="CREATE GAME">
            <div className="create-body">
               <h2>Game Type</h2>
               <div className={containers["create-button-container"]}>
                  <label>
                     <input
                        type="radio"
                        name="gameType"
                        value="bots"
                        checked
                        readOnly
                     />
                     <span>Versus Bots</span>
                  </label>
               </div>
               <fieldset className="difficulty-fieldset">
                  <legend>Bot Difficulty</legend>
                  <div className={containers["create-button-container"]}>
                     {["easy", "medium", "hard"].map((value) => (
                        <label key={value}>
                           <input
                              type="radio"
                              name="difficulty"
                              value={value}
                              checked={difficulty === value}
                              onChange={() => setDifficulty(value)}
                           />
                           <span>{value}</span>
                        </label>
                     ))}
                  </div>
               </fieldset>
               <div className="button-stack">
                  <Button
                     name="Create Game"
                     style={{ height: 50 }}
                     onClick={() => (active ? setConfirm(true) : create())}
                  />
                  {active && (
                     <MenuLink to="/game/single-play" name="Resume Game" />
                  )}
                  <MenuLink to="/" name="Home" />
               </div>
            </div>
         </PageLayout>
         {confirm && (
            <Modal title="Start a new game?" onClose={() => setConfirm(false)}>
               <p>This will replace your unfinished game.</p>
               <div className="button-stack">
                  <Button name="Start New Game" onClick={create} />
                  <Button
                     name="Keep Playing"
                     onClick={() => {
                        setConfirm(false);
                        navigate("/game/single-play");
                     }}
                  />
               </div>
            </Modal>
         )}
      </>
   );
}
